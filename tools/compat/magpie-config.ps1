# Pure configuration helpers. Dot-sourcing this file never starts a process or
# reads the real Codex home, so fixtures can exercise Windows PowerShell 5.1.

function Get-RootConfigValue([string]$Text, [string]$Key) {
  $firstTable = [regex]::Match($Text, '(?m)^[\t ]*\[')
  $root = if ($firstTable.Success) { $Text.Substring(0, $firstTable.Index) } else { $Text }
  $pattern = '(?m)^[\t ]*' + [regex]::Escape($Key) + '[\t ]*=[\t ]*["'']([^"''\r\n]*)["'']'
  $match = [regex]::Match($root, $pattern)
  if ($match.Success) { return $match.Groups[1].Value }
  return $null
}

function Sync-MagpieSettings(
  [scriptblock]$ReadConfig, [scriptblock]$SetModel, [scriptblock]$SetEffort,
  [string]$Model, [string]$Effort
) {
  $text = & $ReadConfig
  if ((Get-RootConfigValue $text 'model') -ne $Model) {
    $null = & $SetModel $Model
    $text = & $ReadConfig
  }
  if ((Get-RootConfigValue $text 'model_reasoning_effort') -ne $Effort) {
    $null = & $SetEffort $Effort
  }
  $text = & $ReadConfig
  if ((Get-RootConfigValue $text 'model') -ne $Model -or
      (Get-RootConfigValue $text 'model_reasoning_effort') -ne $Effort) {
    throw 'Magpie did not apply the requested model and effort'
  }
  return $text
}

function Set-DesktopEffortList([string]$Text, [string]$Levels) {
  # Only this numeric-free array of quoted names is accepted. Never inject
  # arbitrary TOML supplied through a command-line argument.
  if ($Levels -notmatch '^\[\s*"[a-z]+"(?:\s*,\s*"[a-z]+")*\s*\]$') {
    throw 'Invalid effort list'
  }
  $newline = if ($Text.Contains("`r`n")) { "`r`n" } else { "`n" }
  $line = 'enabled-reasoning-efforts = ' + $Levels
  $table = [regex]::Match($Text, '(?m)^[\t ]*\[desktop\][\t ]*(?:#[^\r\n]*)?\r?$')
  if (-not $table.Success) {
    return $Text.TrimEnd("`r", "`n") + $newline + $newline + '[desktop]' + $newline + $line + $newline
  }
  $start = $table.Index + $table.Length
  $tail = $Text.Substring($start)
  $next = [regex]::Match($tail, '(?m)^[\t ]*\[')
  $length = if ($next.Success) { $next.Index } else { $tail.Length }
  $body = $tail.Substring(0, $length)
  # Match the entire array, including multiline arrays, but never cross into
  # another table. Other tables can legitimately have the same key.
  $setting = [regex]::Match($body, '(?m)^[\t ]*enabled-reasoning-efforts[\t ]*=[\t ]*\[[^\]]*\][\t ]*(?:#[^\r\n]*)?')
  if ($setting.Success) {
    $body = $body.Substring(0, $setting.Index) + $line + $body.Substring($setting.Index + $setting.Length)
  } else {
    $body = $newline + $line + $body
    if (-not $body.EndsWith($newline)) { $body += $newline }
  }
  return $Text.Substring(0, $start) + $body + $tail.Substring($length)
}

function Save-ConfigAtomically([string]$Path, [string]$Original, [string]$Updated) {
  if ($Original -ceq $Updated) { return }
  $utf8 = New-Object System.Text.UTF8Encoding($false)
  if ([IO.File]::ReadAllText($Path, $utf8) -cne $Original) { throw 'config.toml changed concurrently; retry next launch' }
  $suffix = [Guid]::NewGuid().ToString('N')
  $temporary = $Path + '.nuvio-tmp-' + $suffix
  $backup = $Path + '.nuvio-backup-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '-' + $suffix
  try {
    [IO.File]::WriteAllText($temporary, $Updated, $utf8)
    if ([IO.File]::ReadAllText($Path, $utf8) -cne $Original) { throw 'config.toml changed concurrently; retry next launch' }
    [IO.File]::Replace($temporary, $Path, $backup)
  } finally {
    if ([IO.File]::Exists($temporary)) { [IO.File]::Delete($temporary) }
  }
}
