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

/** Shortcuts created by earlier versions; removed so the desktop keeps one entry. */
const LEGACY_NAMES = ['Codex 动态背景.lnk', 'Codex 动态背景 - 仅注入.lnk'];

function psQuote(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function runPowerShell(script, dryRun) {
  if (dryRun) {
    console.log('[nuvio] dry run, PowerShell script:');
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

function shortcutScript({ name, target, description, remove, cleanup = [] }) {
  const all = [name, ...cleanup];
  const list = `@(${all.map(psQuote).join(', ')})`;
  const lines = [
    "$ErrorActionPreference = 'Stop'",
    "$desktop = [Environment]::GetFolderPath('Desktop')",
    `$path = Join-Path $desktop ${psQuote(name)}`,
  ];

  if (remove) {
    lines.push(`foreach ($item in ${list}) {`);
    lines.push('  $p = Join-Path $desktop $item');
    lines.push("  if (Test-Path -LiteralPath $p) { Remove-Item -LiteralPath $p -Force; Write-Host '[nuvio] removed' $p }");
    lines.push('}');
    return lines.join('\n');
  }

  lines.push(`foreach ($item in ${list}) {`);
  lines.push('  if ($item -ne ' + psQuote(name) + ') {');
  lines.push('    $stale = Join-Path $desktop $item');
  lines.push("    if (Test-Path -LiteralPath $stale) { Remove-Item -LiteralPath $stale -Force; Write-Host '[nuvio] removed legacy' $stale }");
  lines.push('  }');
  lines.push('}');
  lines.push('$shell = New-Object -ComObject WScript.Shell');
  lines.push('$link = $shell.CreateShortcut($path)');
  lines.push(`$link.TargetPath = ${psQuote(target)}`);
  lines.push('$link.Arguments = ""');
  lines.push(`$link.WorkingDirectory = ${psQuote(ROOT)}`);
  lines.push(`$link.Description = ${psQuote(description)}`);
  if (existsSync(ICON)) lines.push(`$link.IconLocation = ${psQuote(`${ICON},0`)}`);
  // Keep the resident injector out of the way; the user can restore the
  // console from the taskbar when they need to read the log.
  lines.push('$link.WindowStyle = 7');
  lines.push('$link.Save()');
  lines.push('Write-Host "[nuvio] shortcut" $path');
  return lines.join('\n');
}

function main() {
  if (!IS_WIN) {
    throw new Error('desktop shortcuts are Windows-only; on macOS/Linux add your own launcher');
  }

  const options = parseArgs(process.argv.slice(2));
  if (options.onlyInject) {
    console.log('[nuvio] --only-inject is deprecated: start.cmd now injects or restarts by itself');
  }
  const name = options.name || 'Nuvio.lnk';
  const target = join(ROOT, 'start.cmd');

  if (!options.remove && !existsSync(target)) {
    throw new Error(`missing ${target}`);
  }

  runPowerShell(
    shortcutScript({
      name,
      target,
      description: '打开即注入已保存的动态壁纸背景（需要时会自动重启一次 Codex）',
      remove: options.remove,
      cleanup: LEGACY_NAMES,
    }),
    options.dryRun,
  );
  console.log(`[nuvio] target: ${target}`);
}

try {
  main();
} catch (error) {
  console.error(`[nuvio] ${error.message}`);
  process.exitCode = 1;
}
