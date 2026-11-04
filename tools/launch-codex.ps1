param(
  [int]$Port = 9222,
  [string]$AppPath = "",
  [switch]$KillExisting,
  [switch]$DryRun
)

$ErrorActionPreference = "Stop"

function Resolve-CodexApp {
  $candidates = New-Object System.Collections.Generic.List[string]

  $packages = Get-AppxPackage -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -match "Codex|ChatGPT" } |
    Sort-Object Version -Descending

  foreach ($package in $packages) {
    if (-not $package.InstallLocation) { continue }
    foreach ($relative in @("app\ChatGPT.exe", "ChatGPT.exe", "app\Codex.exe", "Codex.exe")) {
      $candidates.Add((Join-Path $package.InstallLocation $relative))
    }
  }

  $roots = @($env:LOCALAPPDATA, $env:ProgramFiles, ${env:ProgramFiles(x86)})
  foreach ($root in $roots) {
    if (-not $root) { continue }
    foreach ($relative in @(
      "Programs\ChatGPT\ChatGPT.exe",
      "Programs\Codex\Codex.exe",
      "ChatGPT\ChatGPT.exe",
      "Codex\Codex.exe"
    )) {
      $candidates.Add((Join-Path $root $relative))
    }
  }

  foreach ($candidate in $candidates) {
    if (Test-Path -LiteralPath $candidate) { return $candidate }
  }
  return ""
}

if (-not $AppPath) {
  $AppPath = Resolve-CodexApp
}

if (-not $AppPath -or -not (Test-Path -LiteralPath $AppPath)) {
  throw "ChatGPT.exe not found. Pass -AppPath 'C:\path\to\ChatGPT.exe'."
}

Write-Host "[cxd] app: $AppPath"
if ($DryRun) { return }

$existing = Get-CimInstance Win32_Process -Filter "Name = 'ChatGPT.exe'" -ErrorAction SilentlyContinue
if ($existing) {
  if (-not $KillExisting) {
    throw "Codex is already running. Close it first, or use -KillExisting. A new process cannot attach a debugging port to an already-running Electron instance."
  }

  $existing | ForEach-Object {
    Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
  }
  Start-Sleep -Milliseconds 900
}

$arguments = @(
  "--remote-debugging-port=$Port",
  "--remote-allow-origins=*"
)

Write-Host "[cxd] launching $AppPath"
Write-Host "[cxd] CDP: http://127.0.0.1:$Port"
Start-Process -FilePath $AppPath -ArgumentList $arguments
