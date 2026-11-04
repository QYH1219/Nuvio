import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline/promises';
import { waitForPageTarget } from './target-score.mjs';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const BUNDLE = join(ROOT, 'dist-embed', 'codex-dynamic-bg.iife.js');
const VENDOR_DRACO = join(ROOT, 'public', 'vendor', 'draco', 'draco_decoder.js');
const STATE_FILE = join(ROOT, '.cxd-inject.json');
const LOG_FILE = join(ROOT, '.nuvio', 'injector.log');
const IS_WIN = process.platform === 'win32';
const VERSION = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version;

function parseArgs(argv) {
  const options = {
    port: 9222,
    wait: 45,
    build: false,
    noBuild: false,
    launch: true,
    restart: false,
    yes: false,
    detach: true,
    force: false,
    forward: [],
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--') {
      options.forward = argv.slice(index + 1);
      break;
    }
    if (arg === '--port' || arg === '--wait') {
      index += 1;
      const value = Number(argv[index]);
      if (!Number.isFinite(value) || value <= 0) throw new Error(`invalid value for ${arg}`);
      options[arg.slice(2)] = value;
      continue;
    }
    if (arg === '--build') options.build = true;
    else if (arg === '--no-build') options.noBuild = true;
    else if (arg === '--no-launch') options.launch = false;
    else if (arg === '--no-restart') options.restart = false;
    else if (arg === '--restart') options.restart = true;
    else if (arg === '--yes' || arg === '-y') options.yes = true;
    else if (arg === '--foreground' || arg === '--no-detach') options.detach = false;
    else if (arg === '--force') options.force = true;
    else if (arg === '--help' || arg === '-h') options.help = true;
    else {
      // Anything the launcher does not own belongs to tools/inject.mjs. npm already
      // consumes its own `--`, so forwarding the tail keeps `npm start -- --once`
      // working without asking users to type a second separator.
      options.forward = argv.slice(index);
      break;
    }
  }
  return options;
}

function printHelp() {
  console.log(`
Nuvio · one-command start

Usage:
  npm start -- [options] [injector options]

Options:
  --port 9222      CDP port
  --wait 45        seconds to wait for Codex / CDP
  --build          force a rebuild of the injection bundle
  --no-build       never build; fail if the bundle is missing
  --no-launch      do not launch Codex; expect CDP to already be up
  --restart        restart Codex automatically when it has no CDP port
  --no-restart     never restart; fail with instructions instead
  -y, --yes        assume "yes" for the restart prompt
  --foreground     keep the injector attached to this console
  --force          replace a resident injector instead of reusing it
  -h, --help       show this help

Examples:
  npm start
  npm start -- --surface 0.15 --dim 0.05
  npm start -- --no-launch --once
`);
}

function sleep(ms) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: ROOT,
    stdio: 'inherit',
    windowsHide: true,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} exited with code ${result.status}`);
  }
}

function runNpmCommand(args) {
  if (IS_WIN) {
    run('cmd.exe', ['/d', '/s', '/c', `npm ${args.join(' ')}`]);
  } else {
    run('npm', args);
  }
}

function runNpm(script) {
  runNpmCommand(['run', script]);
}

function killTree(pid) {
  const value = Number(pid);
  if (!Number.isInteger(value) || value <= 0) return;
  if (IS_WIN) {
    spawnSync('taskkill', ['/PID', String(value), '/T', '/F'], {
      stdio: 'ignore',
      windowsHide: true,
    });
    return;
  }
  try {
    process.kill(value, 'SIGTERM');
  } catch {
    /* already gone */
  }
}

function installDependencies() {
  runNpmCommand(['install']);
}

function findCodexProcesses() {
  if (!IS_WIN) return [];
  try {
    const result = spawnSync('tasklist', ['/FO', 'CSV', '/NH'], {
      encoding: 'utf8',
      windowsHide: true,
      maxBuffer: 8 * 1024 * 1024,
    });
    const names = (result.stdout || '')
      .split(/\r?\n/)
      .map((line) => line.split('","')[0].replace(/^"/, ''))
      .filter((name) => /^chatgpt(\.exe)?$/i.test(name));
    return [...new Set(names)];
  } catch {
    return [];
  }
}

function listCodexPids() {
  if (!IS_WIN) return [];
  try {
    const result = spawnSync('tasklist', ['/FO', 'CSV', '/NH'], {
      encoding: 'utf8',
      windowsHide: true,
      maxBuffer: 8 * 1024 * 1024,
    });
    return (result.stdout || '')
      .split(/\r?\n/)
      .map((line) => line.match(/^"([^"]+)","(\d+)"/))
      .filter(Boolean)
      .filter((match) => /^(chatgpt|codex)(\.exe)?$/i.test(match[1]))
      .map((match) => Number(match[2]));
  } catch {
    return [];
  }
}

/**
 * Codex only accepts a debugging port at launch, so a running instance that
 * was started normally has to be restarted once. The saved appearance lives in
 * the renderer localStorage, so restarting does not reset the user's wallpaper.
 */
async function stopCodex() {
  if (!IS_WIN) {
    throw new Error(
      'restarting Codex automatically is Windows-only. Quit Codex, then relaunch it with ' +
        '--remote-debugging-port=9222 (tools/launch-codex.sh) and run npm start again.',
    );
  }
  const pids = listCodexPids();
  for (const pid of pids) {
    killTree(pid);
  }
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline && listCodexPids().length) await sleep(300);
  await sleep(1200);
  if (listCodexPids().length) {
    throw new Error('Codex did not exit; close it from the tray and run start again.');
  }
}

async function probeInjector() {
  try {
    const response = await fetch('http://127.0.0.1:5276/status', {
      signal: AbortSignal.timeout(800),
    });
    if (!response.ok) return null;
    const status = await response.json();
    return status && status.ok ? status : null;
  } catch {
    return null;
  }
}

async function stopInjector(status) {
  if (!status?.pid) return;
  killTree(status.pid);
  await sleep(600);
}

function readState() {
  try {
    return JSON.parse(readFileSync(STATE_FILE, 'utf8'));
  } catch {
    return null;
  }
}

function commandLineOf(pid) {
  if (!IS_WIN) {
    try {
      const result = spawnSync('ps', ['-p', String(Number(pid)), '-o', 'command='], {
        encoding: 'utf8',
        timeout: 4000,
      });
      return result.stdout || '';
    } catch {
      return '';
    }
  }
  try {
    const result = spawnSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        `$p = Get-CimInstance Win32_Process -Filter "ProcessId=${Number(pid)}"; if ($p) { $p.CommandLine }`,
      ],
      { encoding: 'utf8', windowsHide: true, timeout: 8000 },
    );
    return result.stdout || '';
  } catch {
    return '';
  }
}

function pidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * A crashed start can leave a detached injector that no longer answers on its
 * control port. Only kill a pid that is provably our inject.mjs, never a random
 * Node process that happens to have reused the pid.
 */
async function cleanupOrphanInjector() {
  const state = readState();
  if (!state?.pid || !pidAlive(Number(state.pid))) return;
  // A healthy injector answers on its control port; never kill it just because
  // the user double-clicked the shortcut again.
  if (await probeInjector()) return;
  const command = commandLineOf(Number(state.pid));
  if (!/inject\.mjs/i.test(command)) return;
  console.log(`[nuvio] cleaning up stale injector (pid ${state.pid}) ...`);
  killTree(state.pid);
}

async function waitForInjector(seconds) {
  const deadline = Date.now() + seconds * 1000;
  while (Date.now() < deadline) {
    const status = await probeInjector();
    if (status) return status;
    await sleep(400);
  }
  return null;
}

function printInjectorLogTail(lines = 18) {
  try {
    const content = readFileSync(LOG_FILE, 'utf8').trimEnd().split(/\r?\n/);
    if (!content.length) return;
    console.log('[nuvio] last injector log lines:');
    for (const line of content.slice(-lines)) console.log(`  ${line}`);
  } catch {
    /* no daemon log yet */
  }
}

async function askYesNo(question) {
  if (!process.stdin.isTTY) return false;
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await rl.question(question);
    return /^y(es)?$/i.test(answer.trim());
  } finally {
    rl.close();
  }
}

/** Non-blocking release check: one short lookup, never a hard dependency. */
async function checkForUpdate() {
  if (process.env.NUVIO_NO_UPDATE_CHECK === '1') return;
  try {
    const response = await fetch('https://api.github.com/repos/QYH1219/Nuvio/releases/latest', {
      headers: { 'user-agent': `nuvio/${VERSION}` },
      signal: AbortSignal.timeout(1500),
    });
    if (!response.ok) return;
    const data = await response.json();
    const latest = String(data.tag_name || '').replace(/^v/i, '');
    if (!latest || latest === VERSION) return;
    const compare = (a, b) => {
      const left = a.split('.').map(Number);
      const right = b.split('.').map(Number);
      for (let index = 0; index < 3; index += 1) {
        if ((left[index] || 0) !== (right[index] || 0)) return (left[index] || 0) - (right[index] || 0);
      }
      return 0;
    };
    if (compare(latest, VERSION) > 0) {
      console.log(`[nuvio] update available: v${latest} (you have v${VERSION})`);
      console.log(`[nuvio] ${data.html_url || 'https://github.com/QYH1219/Nuvio/releases'}`);
    }
  } catch {
    /* offline or rate limited — stay quiet */
  }
}

async function probeCdp(port) {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/json/list`, {
      signal: AbortSignal.timeout(1500),
    });
    return response.ok;
  } catch {
    return false;
  }
}

async function waitForCdp(port, seconds) {
  const deadline = Date.now() + seconds * 1000;
  let announced = false;
  while (Date.now() < deadline) {
    if (await probeCdp(port)) return true;
    if (!announced) {
      console.log(`[nuvio] waiting for CDP on 127.0.0.1:${port} (up to ${seconds}s) ...`);
      announced = true;
    }
    await sleep(500);
  }
  return false;
}

async function fetchTargets(port) {
  const response = await fetch(`http://127.0.0.1:${port}/json/list`, {
    signal: AbortSignal.timeout(1500),
  });
  if (!response.ok) throw new Error(`CDP target list failed: HTTP ${response.status}`);
  return response.json();
}

/**
 * Codex briefly reports zero page windows while it restarts. Replacing the
 * resident injector in that window used to stop a healthy injector and then
 * fail to start a new one, wiping the user's background. Always confirm a page
 * window exists before touching the running injector.
 */
async function waitForPageWindow(port, seconds) {
  return waitForPageTarget({
    getTargets: () => fetchTargets(port),
    seconds,
    sleep: (ms) => sleep(ms),
  });
}

function launchCodex(port) {
  if (!IS_WIN) {
    const script = join(ROOT, 'tools', 'launch-codex.sh');
    if (!existsSync(script)) {
      throw new Error(`missing ${script}; start Codex with --remote-debugging-port=${port}`);
    }
    // The script execs Codex, so it must not block the launcher.
    const child = spawn('bash', [script, String(port)], {
      cwd: ROOT,
      stdio: 'ignore',
      detached: true,
    });
    child.on('error', () => {});
    child.unref();
    return;
  }
  run('powershell.exe', [
    '-NoProfile',
    '-ExecutionPolicy',
    'Bypass',
    '-File',
    join(ROOT, 'tools', 'launch-codex.ps1'),
    '-Port',
    String(port),
  ]);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }

  const nodeMajor = Number(process.versions.node.split('.')[0]);
  if (nodeMajor < 22) {
    throw new Error(`Node.js 22+ is required, found ${process.version}`);
  }

  console.log(`[nuvio] Nuvio v${VERSION}`);

  const needsBuild = options.build || !existsSync(BUNDLE) || !existsSync(VENDOR_DRACO);
  if (needsBuild && !options.noBuild) {
    if (!existsSync(join(ROOT, 'node_modules', 'three'))) {
      console.log('[nuvio] installing dependencies (first build only) ...');
      installDependencies();
    }
    console.log('[nuvio] building the injection bundle ...');
    runNpm('embed');
  }

  if (!existsSync(BUNDLE)) {
    throw new Error('missing dist-embed bundle; run npm run embed (or drop --no-build)');
  }

  await cleanupOrphanInjector();

  // A resident injector already keeps the saved layer alive across page
  // reloads. Double-clicking the desktop shortcut again should be harmless,
  // not a second asset server and a second control server.
  const existing = await probeInjector();
  if (existing && options.force) {
    // Never stop a working injector until Codex actually has a page window to
    // attach to. Otherwise a restart-in-progress turns into "no background".
    const page = await waitForPageWindow(options.port, Math.min(Math.max(options.wait, 8), 30));
    if (!page) {
      console.log(
        `[nuvio] Codex has no page window right now; keeping the resident injector (pid ${existing.pid}) alive.`,
      );
      console.log('[nuvio] it reattaches by itself as soon as the window is back. Nothing was changed.');
      return;
    }
    console.log(`[nuvio] replacing the running injector (pid ${existing.pid}) ...`);
    await stopInjector(existing);
  } else if (existing) {
    const cdpAlive = await probeCdp(options.port);
    if (cdpAlive) {
      console.log(`[nuvio] already running (pid ${existing.pid}); the saved background is active.`);
      console.log('[nuvio] use --force to reload the injector.');
      await checkForUpdate();
      return;
    }
    // Keep the injector: it reattaches by itself as soon as Codex is back with
    // the same debugging port. Killing it would only lose the saved session.
    console.log(`[nuvio] injector (pid ${existing.pid}) is waiting for Codex ...`);
  }

  let cdpReady = await probeCdp(options.port);
  if (!cdpReady) {
    if (!options.launch) {
      throw new Error(`CDP is not reachable on 127.0.0.1:${options.port}`);
    }

    const running = findCodexProcesses();
    if (running.length) {
      // The process may have just been launched with CDP and still be starting.
      cdpReady = await waitForCdp(options.port, Math.min(options.wait, 5));
    }
    if (running.length && !cdpReady) {
      if (!options.restart) {
        if (!options.yes) {
          console.log('');
          console.log(`[nuvio] Codex is running (${running.join(', ')}) without a debugging port.`);
          console.log('[nuvio] Nuvio can only attach through Chromium CDP, so Codex has to restart once.');
          console.log('[nuvio] Your saved wallpaper lives in the renderer profile and comes back automatically.');
        }
        const accepted =
          options.yes || (await askYesNo('[nuvio] Restart Codex now? [y/N] '));
        if (!accepted) {
          throw new Error(
            'Codex is running without a debugging port.\n' +
              'Quit Codex completely (including the tray icon) and double-click Nuvio again,\n' +
              'or rerun with --restart to allow one automatic restart.',
          );
        }
      }
      console.log('[nuvio] Codex is running without a debugging port; restarting it once ...');
      await stopCodex();
    }

    launchCodex(options.port);
    cdpReady = await waitForCdp(options.port, options.wait);
    if (!cdpReady) {
      throw new Error(
        `Codex started, but CDP did not respond on 127.0.0.1:${options.port} within ${options.wait}s.\n` +
          'Run npm run doctor for details, or launch with an explicit app path.',
      );
    }
  }

  const injectArgs = [
    join(ROOT, 'tools', 'inject.mjs'),
    '--port',
    String(options.port),
    '--wait',
    String(Math.max(20, Math.min(options.wait, 60))),
    ...(options.detach && !options.forward.includes('--once') ? ['--daemon'] : []),
    ...options.forward,
  ];
  console.log('[nuvio] injecting ...');

  if (options.detach && !options.forward.includes('--once')) {
    let status = null;
    for (let attempt = 1; attempt <= 2 && !status; attempt += 1) {
      const child = spawn(process.execPath, injectArgs, {
        cwd: ROOT,
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
      });
      child.unref();
      status = await waitForInjector(attempt === 1 ? 25 : 20);
      if (!status && attempt === 1) {
        console.log('[nuvio] injector did not report ready; retrying once ...');
        printInjectorLogTail(6);
      }
    }
    if (!status) {
      printInjectorLogTail();
      throw new Error(
        'the injector did not report ready within 25s; run npm start -- --foreground to see live logs',
      );
    }
    console.log(`[nuvio] ready (pid ${status.pid}) · ${status.target || 'Codex window'}`);
    console.log('[nuvio] the background is resident; this window can close.');
    await checkForUpdate();
    return;
  }

  const child = spawn(process.execPath, injectArgs, {
    cwd: ROOT,
    stdio: 'inherit',
  });

  child.on('error', (error) => {
    console.error(`[nuvio] ${error.message}`);
    process.exitCode = 1;
  });
  child.on('exit', (code, signal) => {
    if (signal) {
      console.log(`[nuvio] injector stopped (${signal})`);
      process.exitCode = 0;
      return;
    }
    process.exitCode = code ?? 1;
  });
  await checkForUpdate();
}

main().catch((error) => {
  console.error(`[nuvio] ${error.message}`);
  process.exitCode = 1;
});
