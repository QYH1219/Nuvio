<#
  Nuvio / Magpie coexistence preflight.

  Magpie rewrites Codex's config.toml whenever it starts or attaches to a new
  Codex instance, which drops the model back to its own default and removes the
  ultra effort from the picker. This script runs before Nuvio launches Codex
  and:

    1. starts Magpie in tray mode when it is installed but not running
    2. waits for the local gateway on 127.0.0.1:3425 and for config.toml to
       stop changing
    3. pins the Codex model and effort through magpie's own CLI, so magpie's
       stored settings and config.toml stay in agreement
    4. trims [desktop].enabled-reasoning-efforts to ultra/high/medium
    5. re-checks the values for a few seconds and re-pins on drift

  -Watch keeps checking in the background after Codex has started. Magpie's
  own autostart rewrites the file a few seconds after Codex comes up, which is
  after the one-shot preflight has already returned.

  Missing Magpie is optional. Other failures are logged and reported to the
  launcher, which continues without claiming that compatibility succeeded.
#>
param(
  [string]$Model = '88api/gpt-6.1-sol',
  [string]$Effort = 'ultra',
  [string]$Levels = '["ultra", "high", "medium"]',
  [int]$WaitSeconds = 60,
  [int]$SettleSeconds = 2,
  [int]$StableSeconds = 3,
  [int]$VerifySeconds = 10,
  [int]$WatchSeconds = 0,
  [switch]$Watch,
  [switch]$Quiet
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'magpie-config.ps1')

$logDir = Join-Path $env:TEMP 'nuvio'
$null = New-Item -ItemType Directory -Force -Path $logDir
$logFile = Join-Path $logDir 'magpie-ultra.log'
if ((Test-Path -LiteralPath $logFile) -and ((Get-Item -LiteralPath $logFile).Length -gt 65536)) {
  Remove-Item -LiteralPath $logFile -Force -ErrorAction SilentlyContinue
}
function Write-Log([string]$message) {
  $line = ('[{0}] {1}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $message)
  if (-not $Quiet) { Write-Host $line }
  try { Add-Content -LiteralPath $logFile -Value $line -Encoding UTF8 } catch { }
}

$magpie = Join-Path $env:LOCALAPPDATA 'Programs\Magpie\magpie.exe'
if (-not (Test-Path -LiteralPath $magpie)) {
  $cmd = Get-Command magpie.exe -ErrorAction SilentlyContinue
  if ($cmd) { $magpie = $cmd.Source } else {
    Write-Log 'magpie not installed; skipping'
    exit 0
  }
}

$cfgPath = Join-Path $env:USERPROFILE '.codex\config.toml'
if (-not (Test-Path -LiteralPath $cfgPath)) {
  Write-Log 'config.toml not found; skipping'
  exit 0
}

$utf8 = New-Object System.Text.UTF8Encoding($false)

# Validate the effort list once so a typo fails before anything touches disk.
try { $null = Set-DesktopEffortList '' $Levels } catch {
  Write-Log 'invalid -Levels value; skipping'
  exit 1
}

function Test-Gateway {
  $client = New-Object System.Net.Sockets.TcpClient
  try {
    $task = $client.ConnectAsync('127.0.0.1', 3425)
    if (-not $task.Wait(500)) { return $false }
    return $client.Connected
  } catch {
    return $false
  } finally {
    $client.Close()
  }
}

function Read-Config {
  # File.Replace and Magpie's own writer can hold the file for a few ms.
  for ($i = 0; $i -lt 6; $i++) {
    try { return [System.IO.File]::ReadAllText($cfgPath, $utf8) } catch {
      Start-Sleep -Milliseconds 120
    }
  }
  throw 'config.toml is unreadable'
}

function Get-ConfigStamp {
  try { return (Get-Item -LiteralPath $cfgPath).LastWriteTimeUtc.Ticks } catch { return 0 }
}

function Test-Desired([string]$text) {
  if ($null -eq $text) { return $false }
  if ((Get-RootConfigValue $text 'model') -ne $Model) { return $false }
  if ((Get-RootConfigValue $text 'model_reasoning_effort') -ne $Effort) { return $false }
  try { return ((Set-DesktopEffortList $text $Levels) -ceq $text) } catch { return $false }
}

function Wait-ConfigQuiet([int]$quiet, [int]$maximum) {
  $deadline = (Get-Date).AddSeconds($maximum)
  $last = -1
  $since = Get-Date
  while ((Get-Date) -lt $deadline) {
    $stamp = Get-ConfigStamp
    if ($stamp -ne $last) {
      $last = $stamp
      $since = Get-Date
    } elseif (((Get-Date) - $since).TotalSeconds -ge $quiet) {
      return $true
    }
    Start-Sleep -Milliseconds 250
  }
  return $false
}

function Invoke-MagpieCommand([string[]]$Arguments) {
  # Start-Process -Wait also waits for descendants and has no timeout in 5.1.
  # A hung CLI must not leave the detached watch alive forever.
  $budget = 10000
  if ($Watch -and $null -ne $script:watchDeadline) {
    $budget = [int][Math]::Min($budget, ($script:watchDeadline - (Get-Date)).TotalMilliseconds)
  }
  if ($budget -le 0) { throw 'Magpie command deadline exceeded' }
  $child = Start-Process -FilePath $magpie -ArgumentList $Arguments -WindowStyle Hidden -PassThru
  try {
    if (-not $child.WaitForExit($budget)) {
      # Use the process handle, not a later PID lookup that could be reused.
      $child.Kill()
      $null = $child.WaitForExit(1000)
      throw 'Magpie command timed out'
    }
    if ($child.ExitCode -ne 0) { throw ('Magpie command failed (' + $child.ExitCode + ')') }
  } finally {
    $child.Dispose()
  }
}

function Invoke-Pin([string]$reason) {
  Write-Log ('pinning ({0})' -f $reason)
  $read = { Read-Config }
  $setModel = {
    param($value)
    Write-Log ('magpie model -> ' + $value)
    # magpie.exe is a GUI-subsystem binary: `& magpie` returns immediately and
    # leaves $LASTEXITCODE unset, which used to look like a CLI failure. Use
    # Start-Process so we actually wait for the exit code. Output is discarded
    # on purpose: provider errors may contain credentials.
    Invoke-MagpieCommand @('codex', $value)
  }
  $setEffort = {
    param($value)
    Write-Log ('magpie effort -> ' + $value)
    Invoke-MagpieCommand @('codex', 'effort', $value)
  }
  $text = Sync-MagpieSettings $read $setModel $setEffort $Model $Effort
  $updated = Set-DesktopEffortList $text $Levels
  if ($updated -cne $text) {
    Save-ConfigAtomically $cfgPath $text $updated
    Write-Log 'trimmed enabled-reasoning-efforts to ultra/high/medium'
  }
}

function Remove-OldBackups([int]$keep) {
  try {
    $parent = Split-Path -Parent $cfgPath
    $leaf = Split-Path -Leaf $cfgPath
    $files = @(Get-ChildItem -LiteralPath $parent -Filter ($leaf + '.nuvio-backup-*') -File -ErrorAction SilentlyContinue |
      Sort-Object LastWriteTime -Descending)
    if ($files.Count -le $keep) { return }
    $files | Select-Object -Skip $keep | ForEach-Object {
      Remove-Item -LiteralPath $_.FullName -Force -ErrorAction SilentlyContinue
    }
  } catch { }
}

if ($Watch) {
  # Repeated launches need at most one reconciler for this profile. A kernel
  # mutex is released even if the watch is terminated or crashes.
  $hash = [Security.Cryptography.SHA256]::Create()
  try { $key = [BitConverter]::ToString($hash.ComputeHash($utf8.GetBytes($cfgPath.ToLowerInvariant()))).Replace('-', '') }
  finally { $hash.Dispose() }
  $watchMutex = New-Object System.Threading.Mutex($false, ('Local\Nuvio-MagpieWatch-' + $key))
  $ownsWatch = $false
  try {
  try { $ownsWatch = $watchMutex.WaitOne(0) }
  catch [System.Threading.AbandonedMutexException] { $ownsWatch = $true }
  if (-not $ownsWatch) { exit 0 }
  # Background reconciler: Codex is already up, Magpie may still be writing.
  $gatewayDeadline = (Get-Date).AddSeconds(20)
  while (-not (Test-Gateway)) {
    if ((Get-Date) -gt $gatewayDeadline) {
      Write-Log 'watch: gateway never came up; nothing to reconcile'
      exit 0
    }
    Start-Sleep -Milliseconds 500
  }
  Write-Log 'watch: gateway is up; reconciling'
  $deadline = (Get-Date).AddSeconds($WatchSeconds)
  $script:watchDeadline = $deadline
  $lastPin = [DateTime]::MinValue
  $pins = 0
  $drifts = 0
  while ((Get-Date) -lt $deadline) {
    Start-Sleep -Milliseconds 1000
    try {
      $text = Read-Config
      if (Test-Desired $text) { continue }
      $drifts += 1
      if ($pins -ge 8) {
        Write-Log ('watch: still drifting after {0} re-pins; giving up' -f $pins)
        break
      }
      if (((Get-Date) - $lastPin).TotalSeconds -lt 1.5) { continue }
      Write-Log ('watch: config drifted (model={0} effort={1}); re-pinning' -f `
        (Get-RootConfigValue $text 'model'), (Get-RootConfigValue $text 'model_reasoning_effort'))
      Invoke-Pin 'watch'
      $pins += 1
      $lastPin = Get-Date
    } catch {
      Write-Log ('watch: {0}' -f $_.Exception.Message)
    }
  }
  Remove-OldBackups 5
  if (Test-Desired (Read-Config)) { exit 0 }
  Write-Log ('watch: final state is not the requested one (drifts={0} pins={1})' -f $drifts, $pins)
  exit 1
  } finally {
    if ($ownsWatch) { $watchMutex.ReleaseMutex() }
    $watchMutex.Dispose()
  }
}

$gatewayWasUp = Test-Gateway
$magpieRunning = $false
$startedByUs = $false
$proc = Get-Process -Name magpie -ErrorAction SilentlyContinue
if ($proc) { $magpieRunning = $true }

if (-not $gatewayWasUp) {
  if (-not $magpieRunning) {
    Write-Log 'starting magpie in tray mode'
    try {
      Start-Process -FilePath $magpie -ArgumentList 'tray' -WindowStyle Hidden
      $startedByUs = $true
    } catch {
      Write-Log ('failed to start magpie: ' + $_.Exception.Message)
    }
  } else {
    Write-Log 'magpie is running but the gateway is not up yet; waiting'
  }

  $deadline = (Get-Date).AddSeconds($WaitSeconds)
  while ((Get-Date) -lt $deadline) {
    if (Test-Gateway) { break }
    Start-Sleep -Milliseconds 500
  }

  if (-not (Test-Gateway) -and $startedByUs) {
    Write-Log 'tray start did not bring the gateway up; trying a normal launch'
    try {
      Start-Process -FilePath $magpie -WindowStyle Hidden | Out-Null
    } catch {
      Write-Log ('fallback launch failed: ' + $_.Exception.Message)
    }
    $deadline = (Get-Date).AddSeconds(30)
    while ((Get-Date) -lt $deadline) {
      if (Test-Gateway) { break }
      Start-Sleep -Milliseconds 500
    }
  }
}

if (-not (Test-Gateway)) {
  Write-Log ('gateway 127.0.0.1:3425 did not come up within {0}s; leaving config untouched' -f $WaitSeconds)
  exit 1
}
Write-Log 'gateway is up'

try {
  $text = Read-Config
  # Preserve the original before either Magpie CLI command can rewrite it.
  if ((Get-RootConfigValue $text 'model') -ne $Model -or
      (Get-RootConfigValue $text 'model_reasoning_effort') -ne $Effort) {
    $backup = $cfgPath + '.nuvio-backup-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '-' + [Guid]::NewGuid().ToString('N')
    [IO.File]::Copy($cfgPath, $backup, $false)
    Write-Log 'backed up config before Magpie CLI changes'
  }

  # Magpie writes its defaults during its own startup. Pinning before that
  # settles races it and loses, so wait for the file to stop changing.
  if (-not $gatewayWasUp) {
    $null = Wait-ConfigQuiet $SettleSeconds (($SettleSeconds + 8))
  }

  Invoke-Pin 'startup'

  # Short verification window: catches a late Magpie write without making
  # every launch wait for the full window.
  $verifyDeadline = (Get-Date).AddSeconds($VerifySeconds)
  $stableSince = $null
  $lastPin = Get-Date
  while ((Get-Date) -lt $verifyDeadline) {
    Start-Sleep -Milliseconds 500
    try {
      $current = Read-Config
      if (Test-Desired $current) {
        if ($null -eq $stableSince) { $stableSince = Get-Date }
        elseif (((Get-Date) - $stableSince).TotalSeconds -ge $StableSeconds) { break }
        continue
      }
      $stableSince = $null
      if (((Get-Date) - $lastPin).TotalSeconds -lt 1.5) { continue }
      Write-Log ('config drifted after pin (model={0} effort={1}); re-pinning' -f `
        (Get-RootConfigValue $current 'model'), (Get-RootConfigValue $current 'model_reasoning_effort'))
      Invoke-Pin 'drift'
      $lastPin = Get-Date
    } catch {
      Write-Log ('verify: {0}' -f $_.Exception.Message)
    }
  }

  Remove-OldBackups 5
  $final = Read-Config
  if (-not (Test-Desired $final)) {
    Write-Log ('final state is not the requested one (model={0} effort={1})' -f `
      (Get-RootConfigValue $final 'model'), (Get-RootConfigValue $final 'model_reasoning_effort'))
    exit 1
  }
  Write-Log ('final model=' + (Get-RootConfigValue $final 'model') + ' effort=' + (Get-RootConfigValue $final 'model_reasoning_effort'))
  exit 0
} catch {
  Write-Log ('preflight failed; settings were not confirmed: ' + $_.Exception.Message + ' (CLI output withheld)')
  exit 1
}
