import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ICON = join(ROOT, 'public', 'icon.ico');
const IS_WIN = process.platform === 'win32';

function parseArgs(argv) {
  const options = { name: '', onlyInject: false, remove: false, dryRun: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--name') {
      index += 1;
      options.name = argv[index] ?? '';
      continue;
    }
    if (arg === '--only-inject') options.onlyInject = true;
    else if (arg === '--remove') options.remove = true;
    else if (arg === '--dry-run') options.dryRun = true;
  }
  return options;
}

function psQuote(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function runPowerShell(script, dryRun) {
  if (dryRun) {
    console.log('[cxd] dry run, PowerShell script:');
    console.log(script.trim());
    return;
  }
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], {
    stdio: 'inherit',
    windowsHide: true,
  });
  if (result.status !== 0) throw new Error(`PowerShell exited with code ${result.status}`);
}

function shortcutScript({ name, target, description, remove }) {
  const lines = [
    "$ErrorActionPreference = 'Stop'",
    "$desktop = [Environment]::GetFolderPath('Desktop')",
    `$path = Join-Path $desktop ${psQuote(name)}`,
  ];

  if (remove) {
    lines.push('if (Test-Path -LiteralPath $path) { Remove-Item -LiteralPath $path -Force }');
    lines.push('Write-Host "[cxd] removed" $path');
    return lines.join('\n');
  }

  lines.push('$shell = New-Object -ComObject WScript.Shell');
  lines.push('$link = $shell.CreateShortcut($path)');
  lines.push(`$link.TargetPath = ${psQuote(target)}`);
  lines.push('$link.Arguments = ""');
  lines.push(`$link.WorkingDirectory = ${psQuote(ROOT)}`);
  lines.push(`$link.Description = ${psQuote(description)}`);
  if (existsSync(ICON)) lines.push(`$link.IconLocation = ${psQuote(`${ICON},0`)}`);
  lines.push('$link.WindowStyle = 1');
  lines.push('$link.Save()');
  lines.push('Write-Host "[cxd] shortcut" $path');
  return lines.join('\n');
}

function main() {
  if (!IS_WIN) {
    throw new Error('desktop shortcuts are Windows-only; on macOS/Linux add your own launcher');
  }

  const options = parseArgs(process.argv.slice(2));
  const onlyInject = options.onlyInject;
  const name = options.name || (onlyInject ? 'Codex 动态背景 - 仅注入.lnk' : 'Codex 动态背景.lnk');
  const target = join(ROOT, onlyInject ? 'start.cmd' : 'restart.cmd');

  if (!options.remove && !existsSync(target)) {
    throw new Error(`missing ${target}`);
  }

  runPowerShell(
    shortcutScript({
      name,
      target,
      description: onlyInject ? 'Codex 已带调试端口启动时，仅注入背景' : '重启 Codex 并注入动态壁纸',
      remove: options.remove,
    }),
    options.dryRun,
  );
  console.log(`[cxd] target: ${target}`);
}

try {
  main();
} catch (error) {
  console.error(`[cxd] ${error.message}`);
  process.exitCode = 1;
}
