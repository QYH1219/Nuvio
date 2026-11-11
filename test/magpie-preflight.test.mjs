import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { readZip } from '../tools/zip.mjs';
import { EventEmitter } from 'node:events';
import { runMagpiePreflight, startMagpieWatch } from '../tools/magpie-preflight.mjs';

const root = new URL('..', import.meta.url);

test('preflight skips non-Windows, no-launch and explicit opt-out without spawning', async () => {
  for (const options of [{ platform: 'linux' }, { platform: 'win32', launch: false },
    { platform: 'win32', env: { NUVIO_SKIP_MAGPIE: '1' } }]) {
    assert.equal(await runMagpiePreflight({ ...options,
      spawnProcess: () => { throw new Error('must not spawn'); },
    }), 'skipped');
  }
});

test('preflight starts one hidden process and reports CLI failure', async () => {
  let calls = 0;
  const logs = [];
  assert.equal(await runMagpiePreflight({ platform: 'win32', env: {}, log: (s) => logs.push(s),
    spawnProcess(command, args, options) {
      calls++;
      assert.equal(command, 'powershell.exe');
      assert.ok(args.includes('-NonInteractive'));
      assert.equal(options.windowsHide, true);
      assert.equal(options.stdio, 'ignore');
      const child = new EventEmitter();
      queueMicrotask(() => child.emit('exit', 1));
      return child;
    },
  }), 'failed');
  assert.equal(calls, 1);
  assert.equal(logs.length, 1);
});

test('preflight timeout terminates only its own process tree and returns', async () => {
  const commands = [];
  assert.equal(await runMagpiePreflight({ platform: 'win32', env: {}, timeoutMs: 10, log: () => {},
    spawnProcess(command, args, options) {
      commands.push({ command, args, options });
      return Object.assign(new EventEmitter(), { pid: 12345 });
    },
  }), 'timed out');
  assert.equal(commands.length, 2);
  assert.equal(commands[1].command, 'taskkill.exe');
  assert.deepEqual(commands[1].args, ['/PID', '12345', '/T', '/F']);
});

test('portable archive includes Magpie compatibility scripts', () => {
  const dir = mkdtempSync(join(tmpdir(), 'nuvio-pack-'));
  try {
    const archive = join(dir, 'portable.zip');
    const result = spawnSync(process.execPath, ['tools/pack.mjs', '--skip-build-check', '--out', archive], {
      cwd: root, encoding: 'utf8', windowsHide: true,
    });
    assert.equal(result.status, 0, result.stderr);
    const names = readZip(archive).map((entry) => entry.name);
    assert.ok(names.some((name) => name.endsWith('/tools/compat/magpie-ultra.ps1')),
      'portable installs must receive the same preflight as source installs');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('shared launcher runs preflight before probing or restarting Codex', () => {
  const source = readFileSync(new URL('../tools/start.mjs', import.meta.url), 'utf8');
  const main = source.slice(source.indexOf('async function main()'));
  assert.ok(main.indexOf('runMagpiePreflight(') > main.indexOf('if (options.help)'));
  assert.ok(main.indexOf('runMagpiePreflight(') < main.indexOf('await cleanupOrphanInjector('));
});

test('post-launch watch is detached, hidden and skippable', () => {
  assert.equal(startMagpieWatch({ platform: 'linux', spawnProcess: () => {
    throw new Error('must not spawn');
  } }), false);
  assert.equal(startMagpieWatch({ platform: 'win32', env: { NUVIO_SKIP_MAGPIE: '1' },
    spawnProcess: () => { throw new Error('must not spawn'); } }), false);

  let seen = null;
  const child = { unref() { seen.unref = true; } };
  assert.equal(startMagpieWatch({
    platform: 'win32', env: {}, seconds: 45,
    spawnProcess(command, args, options) {
      seen = { command, args, options };
      return child;
    },
  }), true);
  assert.equal(seen.command, 'powershell.exe');
  assert.ok(seen.args.includes('-Watch'));
  assert.ok(seen.args.includes('-Quiet'));
  assert.equal(seen.args[seen.args.indexOf('-WatchSeconds') + 1], '45');
  assert.equal(seen.options.detached, true);
  assert.equal(seen.options.windowsHide, true);
  assert.equal(seen.options.stdio, 'ignore');
  assert.equal(seen.unref, true);
});

test('Codex restart stops the old injector before it relaunches the app', () => {
  const source = readFileSync(new URL('../tools/start.mjs', import.meta.url), 'utf8');
  const branch = source.slice(source.indexOf('restarting it once'));
  const stop = branch.indexOf('await stopInjector(existing);');
  const relaunch = branch.indexOf('await stopCodex();');
  assert.ok(stop > 0, 'restart branch must stop the resident injector');
  assert.ok(relaunch > stop, 'the injector must be replaced before Codex restarts');
});

test('early returns from the resident-injector branch keep the ultra watch armed', () => {
  const source = readFileSync(new URL('../tools/start.mjs', import.meta.url), 'utf8');
  const start = source.indexOf('const existing = await probeInjector();');
  const branch = source.slice(start, source.indexOf('let cdpReady ='));
  const armed = branch.match(/startMagpieWatch\(\);/g) || [];
  const returns = branch.match(/^\s+return;$/gm) || [];
  assert.equal(returns.length, 2, 'the branch has two early exits');
  assert.ok(armed.length >= returns.length,
    'a relaunch must not skip the reconciler that keeps ultra pinned');
});

test('an injector from an older build is replaced instead of trusted', () => {
  const start = readFileSync(new URL('../tools/start.mjs', import.meta.url), 'utf8');
  const branch = start.slice(start.indexOf('const existing = await probeInjector();'),
    start.indexOf('let cdpReady ='));
  assert.match(branch, /existing\.version !== VERSION/,
    'the launcher must compare the resident injector build with its own');
  assert.match(branch, /existing\.build !== INJECTOR_BUILD/,
    'semver alone misses two different builds of the same version');
  const stale = branch.indexOf('if (stale)');
  assert.ok(stale > 0 && branch.indexOf('await stopInjector(existing);', stale) > stale,
    'a stale injector must be stopped so the new code actually runs');

  const inject = readFileSync(new URL('../tools/inject.mjs', import.meta.url), 'utf8');
  assert.match(inject, /version: VERSION/, 'the injector must report its build in /status');
  assert.match(inject, /build: BUILD/, 'the injector must report a content hash in /status');
});

test('explicit --no-restart takes precedence over --yes', () => {
  const result = spawnSync(process.execPath, ['tools/start.mjs', '--help'], {
    cwd: root, encoding: 'utf8', windowsHide: true,
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /--no-restart/);
  const source = readFileSync(new URL('../tools/start.mjs', import.meta.url), 'utf8');
  assert.match(source, /restart === false/);
  assert.doesNotMatch(source, /restart: false,/);
});

test('console entry consumes --console and forwards --help', { skip: process.platform !== 'win32' }, () => {
  // When the suite itself runs inside a Nuvio-launched Codex, NUVIO_HIDDEN is
  // inherited and start.cmd would (correctly) redirect output to its log.
  const env = { ...process.env };
  delete env.NUVIO_HIDDEN;
  const result = spawnSync('cmd.exe', ['/d', '/c', 'start.cmd --console --help'], {
    cwd: root, encoding: 'utf8', windowsHide: true, timeout: 10000, env,
  });
  assert.equal(result.status, 0, result.stderr || result.error?.message);
  assert.match(result.stdout, /Nuvio · one-command start/);
  assert.doesNotMatch(result.stdout, /unknown option/);
});
