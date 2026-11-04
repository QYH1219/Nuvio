#!/usr/bin/env node
/**
 * Log-in autostart without admin rights.
 *
 *   npm run autostart -- enable
 *   npm run autostart -- disable
 *   npm run autostart -- status
 *
 * Only one shortcut is ever written: `%APPDATA%\...\Startup\Nuvio.lnk`.
 * The desktop shortcut is not touched. The injector imports these helpers so
 * the settings panel and the CLI share exactly the same code path.
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ICON = join(ROOT, 'public', 'icon.ico');
const NAME = 'Nuvio.lnk';

export function autostartSupported() {
  return process.platform === 'win32';
}

function psQuote(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function runPowerShell(script) {
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  const result = spawnSync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded],
    { encoding: 'utf8', windowsHide: true },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout || '').trim();
    throw new Error(`PowerShell exited with code ${result.status}${detail ? `: ${detail}` : ''}`);
  }
  return (result.stdout || '').trim();
}

function statusScript() {
  return [
    "$ErrorActionPreference = 'Stop'",
    "$startup = [Environment]::GetFolderPath('Startup')",
    `$path = Join-Path $startup ${psQuote(NAME)}`,
    '[pscustomobject]@{ enabled = (Test-Path -LiteralPath $path); path = $path } | ConvertTo-Json -Compress',
  ].join('\n');
}

export function getAutostartStatus() {
  if (!autostartSupported()) {
    return { supported: false, enabled: false, path: '', platform: process.platform };
  }
  const output = runPowerShell(statusScript());
  let parsed = null;
  try {
    parsed = JSON.parse(output);
  } catch {
    parsed = null;
  }
  return {
    supported: true,
    enabled: Boolean(parsed?.enabled),
    path: typeof parsed?.path === 'string' ? parsed.path : '',
    platform: process.platform,
  };
}

export function enableAutostart() {
  if (!autostartSupported()) {
    throw new Error('开机自启仅支持 Windows；macOS/Linux 请使用系统登录项');
  }
  const lines = [
    "$ErrorActionPreference = 'Stop'",
    "$startup = [Environment]::GetFolderPath('Startup')",
    `$path = Join-Path $startup ${psQuote(NAME)}`,
    '$shell = New-Object -ComObject WScript.Shell',
    '$link = $shell.CreateShortcut($path)',
    `$link.TargetPath = ${psQuote(join(ROOT, 'start.cmd'))}`,
    '$link.Arguments = ""',
    `$link.WorkingDirectory = ${psQuote(ROOT)}`,
    "$link.Description = 'Nuvio · 登录时恢复动态壁纸'",
  ];
  if (existsSync(ICON)) lines.push(`$link.IconLocation = ${psQuote(`${ICON},0`)}`);
  lines.push('$link.WindowStyle = 7');
  lines.push('$link.Save()');
  runPowerShell(lines.join('\n'));
  return getAutostartStatus();
}

export function disableAutostart() {
  if (!autostartSupported()) {
    return { supported: false, enabled: false, path: '', platform: process.platform };
  }
  const lines = [
    "$ErrorActionPreference = 'Stop'",
    "$startup = [Environment]::GetFolderPath('Startup')",
    `$path = Join-Path $startup ${psQuote(NAME)}`,
    'if (Test-Path -LiteralPath $path) { Remove-Item -LiteralPath $path -Force }',
  ];
  runPowerShell(lines.join('\n'));
  return getAutostartStatus();
}

export function setAutostart(enabled) {
  return enabled ? enableAutostart() : disableAutostart();
}

function main() {
  const action = process.argv[2] || 'status';
  if (!['enable', 'disable', 'status'].includes(action)) {
    throw new Error('usage: npm run autostart -- enable|disable|status');
  }
  if (action === 'status') {
    const status = getAutostartStatus();
    console.log(
      status.supported
        ? `[nuvio] autostart: ${status.enabled ? 'enabled' : 'disabled'}${status.path ? ` (${status.path})` : ''}`
        : '[nuvio] autostart: unsupported on this platform',
    );
    return;
  }
  const status = setAutostart(action === 'enable');
  console.log(`[nuvio] autostart ${action === 'enable' ? 'enabled' : 'disabled'}: ${status.path}`);
}

const isCli = (() => {
  if (!process.argv[1]) return false;
  try {
    return resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
})();

if (isCli) {
  try {
    main();
  } catch (error) {
    console.error(`[nuvio] autostart failed: ${error.message}`);
    process.exitCode = 1;
  }
}
