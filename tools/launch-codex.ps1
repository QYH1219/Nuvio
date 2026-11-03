param(
  [int]$Port = 9222,
  [string]$AppPath = "",
  [switch]$KillExisting
)

$ErrorActionPreference = "Stop"

if (-not $AppPath) {
  $package = Get-AppxPackage -Name "OpenAI.Codex" -ErrorAction SilentlyContinue |
    Sort-Object Version -Descending |
    Select-Object -First 1

  if ($package) {
    $candidate = Join-Path $package.InstallLocation "app\ChatGPT.exe"
    if (Test-Path -LiteralPath $candidate) {
      $AppPath = $candidate
    }
  }
}

if (-not $AppPath -or -not (Test-Path -LiteralPath $AppPath)) {
  throw "ChatGPT.exe not found. Pass -AppPath 'C:\path\to\ChatGPT.exe'."
}

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
