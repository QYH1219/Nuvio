#!/usr/bin/env node
/**
 * Log-in autostart without admin rights.
 *
 *   npm run autostart -- enable
 *   npm run autostart -- disable
 *   npm run autostart -- status
 *
 * Uses the per-user Startup folder. The shortcut starts minimized; start.mjs
 * detaches the injector and exits, so nothing stays on screen.
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ICON = join(ROOT, 'public', 'icon.ico');
const NAME = 'Nuvio.lnk';

function psQuote(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function runPowerShell(script) {
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  const result = spawnSync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded],
    { stdio: 'inherit', windowsHide: true },
  );
  if (result.status !== 0) throw new Error(`PowerShell exited with code ${result.status}`);
}

function scriptFor(action) {
  const lines = [
    "$ErrorActionPreference = 'Stop'",
    "$startup = [Environment]::GetFolderPath('Startup')",
    `$path = Join-Path $startup ${psQuote(NAME)}`,
  ];
  if (action === 'status') {
    lines.push("if (Test-Path -LiteralPath $path) { Write-Host '[nuvio] autostart: enabled'; Write-Host $path } else { Write-Host '[nuvio] autostart: disabled' }");
    return lines.join('\n');
  }
  if (action === 'disable') {
    lines.push("if (Test-Path -LiteralPath $path) { Remove-Item -LiteralPath $path -Force; Write-Host '[nuvio] autostart disabled' } else { Write-Host '[nuvio] autostart already disabled' }");
    return lines.join('\n');
  }
  lines.push('$shell = New-Object -ComObject WScript.Shell');
  lines.push('$link = $shell.CreateShortcut($path)');
  lines.push(`$link.TargetPath = ${psQuote(join(ROOT, 'start.cmd'))}`);
  lines.push('$link.Arguments = ""');
  lines.push(`$link.WorkingDirectory = ${psQuote(ROOT)}`);
  lines.push("$link.Description = 'Nuvio · 登录时恢复动态壁纸'");
  if (existsSync(ICON)) lines.push(`$link.IconLocation = ${psQuote(`${ICON},0`)}`);
  lines.push('$link.WindowStyle = 7');
  lines.push('$link.Save()');
  lines.push("Write-Host '[nuvio] autostart enabled' $path");
  return lines.join('\n');
}

function main() {
  if (process.platform !== 'win32') {
    throw new Error('autostart is Windows-only; use a login item on macOS/Linux');
  }
  const action = process.argv[2] || 'status';
  if (!['enable', 'disable', 'status'].includes(action)) {
    throw new Error('usage: npm run autostart -- enable|disable|status');
  }
  runPowerShell(scriptFor(action));
}

try {
  main();
} catch (error) {
  console.error(`[nuvio] autostart failed: ${error.message}`);
  process.exitCode = 1;
}
