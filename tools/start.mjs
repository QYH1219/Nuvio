import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const BUNDLE = join(ROOT, 'dist-embed', 'codex-dynamic-bg.iife.js');
const VENDOR_DRACO = join(ROOT, 'public', 'vendor', 'draco', 'draco_decoder.js');
const IS_WIN = process.platform === 'win32';

function parseArgs(argv) {
  const options = {
    port: 9222,
    wait: 45,
    build: false,
    noBuild: false,
    launch: true,
    restart: true,
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
  --no-restart     fail instead of restarting a Codex that has no CDP port
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
  const pids = listCodexPids();
  for (const pid of pids) {
    spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], {
      stdio: 'ignore',
      windowsHide: true,
    });
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
  spawnSync('taskkill', ['/PID', String(status.pid), '/T', '/F'], {
    stdio: 'ignore',
    windowsHide: true,
  });
  await sleep(600);
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

function launchCodex(port) {
  if (!IS_WIN) {
    throw new Error(
      'automatic launch is Windows-only. Start Codex Desktop with ' +
        `--remote-debugging-port=${port}, then run: npm start -- --no-launch`,
    );
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

  console.log('[nuvio] Codex Dynamic Background');

  if (!existsSync(join(ROOT, 'node_modules', 'three'))) {
    console.log('[nuvio] installing dependencies ...');
    installDependencies();
  }

  if (!options.noBuild && (options.build || !existsSync(BUNDLE) || !existsSync(VENDOR_DRACO))) {
    console.log('[nuvio] building the injection bundle ...');
    runNpm('embed');
  }

  if (!existsSync(BUNDLE)) {
    throw new Error('missing dist-embed bundle; run npm run embed (or drop --no-build)');
  }

  // A resident injector already keeps the saved layer alive across page
  // reloads. Double-clicking the desktop shortcut again should be harmless,
  // not a second asset server and a second control server.
  const existing = await probeInjector();
  if (existing && options.force) {
    console.log(`[nuvio] replacing the running injector (pid ${existing.pid}) ...`);
    await stopInjector(existing);
  } else if (existing) {
    const cdpAlive = await probeCdp(options.port);
    if (cdpAlive) {
      console.log(`[nuvio] already running (pid ${existing.pid}); the saved background is active.`);
      console.log('[nuvio] use --force to reload the injector.');
      return;
    }
    console.log('[nuvio] stale injector detected; restarting it ...');
    await stopInjector(existing);
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
        throw new Error(
          `Codex is already running (${running.join(', ')}) without a debugging port.\n` +
            'Quit Codex completely (including the tray icon), then run npm start again.\n' +
            'If you accept restarting it, run: npm run launch:codex -- -KillExisting',
        );
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
    '15',
    ...options.forward,
  ];
  console.log('[nuvio] injecting ...');

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
}

main().catch((error) => {
  console.error(`[nuvio] ${error.message}`);
  process.exitCode = 1;
});
