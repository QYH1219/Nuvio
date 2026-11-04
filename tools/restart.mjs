import { spawn, spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const IS_WIN = process.platform === 'win32';

function parseArgs(argv) {
  const options = { port: 9222, wait: 45, yes: false, dryRun: false, forward: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--port' || arg === '--wait') {
      index += 1;
      const value = Number(argv[index]);
      if (!Number.isFinite(value) || value <= 0) throw new Error(`invalid value for ${arg}`);
      options[arg.slice(2)] = value;
      continue;
    }
    if (arg === '--yes' || arg === '-y') {
      options.yes = true;
      continue;
    }
    if (arg === '--dry-run') {
      options.dryRun = true;
      continue;
    }
    options.forward = argv.slice(index);
    break;
  }
  return options;
}

function sleep(ms) {
  return new Promise((done) => setTimeout(done, ms));
}

function listCodex() {
  if (!IS_WIN) return [];
  const result = spawnSync('tasklist', ['/FI', 'IMAGENAME eq ChatGPT.exe', '/FO', 'CSV', '/NH'], {
    encoding: 'utf8',
    windowsHide: true,
    maxBuffer: 4 * 1024 * 1024,
  });
  const output = (result.stdout || '').trim();
  if (!output || /no tasks are running/i.test(output)) return [];
  return output
    .split(/\r?\n/)
    .map((line) => line.match(/^"([^"]+)","(\d+)"/))
    .filter(Boolean)
    .map((match) => ({ image: match[1], pid: Number(match[2]) }));
}

async function main() {
  if (!IS_WIN) {
    throw new Error('restart is Windows-only; run `npm start` after quitting Codex manually');
  }

  const options = parseArgs(process.argv.slice(2));
  const running = listCodex();

  if (options.dryRun) {
    console.log(`[cxd] dry run · port ${options.port}`);
    console.log(
      running.length
        ? `[cxd] would stop Codex (${running.map((item) => item.pid).join(', ')}) and relaunch it with CDP`
        : '[cxd] Codex is not running; would launch it with CDP',
    );
    console.log('[cxd] then inject dist-embed/codex-dynamic-bg.iife.js');
    return;
  }

  if (running.length) {
    console.log(`[cxd] Codex is running (${running.length} process(es)).`);
    console.log('[cxd] Injecting a background layer needs a debugging port, which only exists at launch.');
    if (!options.yes) {
      console.log('[cxd] Restarting Codex in 3s. Press Ctrl+C to abort.');
      await sleep(3000);
    }

    for (const item of running) {
      spawnSync('taskkill', ['/PID', String(item.pid), '/T', '/F'], {
        stdio: 'ignore',
        windowsHide: true,
      });
    }

    const deadline = Date.now() + 15000;
    while (Date.now() < deadline && listCodex().length) await sleep(300);
    await sleep(1200);

    const left = listCodex();
    if (left.length) {
      throw new Error(`Codex did not exit (pid ${left.map((item) => item.pid).join(', ')}). Close it from the tray and retry.`);
    }
    console.log('[cxd] Codex stopped.');
  }

  const args = [join(ROOT, 'tools', 'start.mjs'), '--port', String(options.port), '--wait', String(options.wait), ...options.forward];
  const child = spawn(process.execPath, args, { cwd: ROOT, stdio: 'inherit' });
  child.on('exit', (code) => {
    process.exitCode = code ?? 1;
  });
}

main().catch((error) => {
  console.error(`[cxd] ${error.message}`);
  process.exitCode = 1;
});
