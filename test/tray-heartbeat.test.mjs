import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { heartbeatFresh, parseHeartbeat } from '../tools/tray.mjs';

test('tray heartbeat carries pid, build and timestamp', () => {
  assert.deepEqual(parseHeartbeat('4321 6efd0fcc 1794383427460\n'), {
    pid: 4321,
    version: '6efd0fcc',
    at: 1794383427460,
  });
});

test('a half-written or stale heartbeat is not treated as alive', () => {
  const now = 1794383430000;
  assert.equal(heartbeatFresh(parseHeartbeat(''), now), false);
  assert.equal(heartbeatFresh(parseHeartbeat('4321 6efd0fcc'), now), false);
  assert.equal(heartbeatFresh(parseHeartbeat('4321 6efd0fcc 1794383427460'), now), true);
  assert.equal(heartbeatFresh(parseHeartbeat('4321 6efd0fcc 1'), now), false);
});

test('the icon survives injector replacement and is supervised', () => {
  const csharp = readFileSync(new URL('../tools/tray/tray.cs', import.meta.url), 'utf8');
  assert.match(csharp, /attempt < 8/,
    'a new tray must wait for the old mutex instead of exiting instantly');
  assert.match(csharp, /missingStateTicks >= 3/,
    'a relaunch deletes the state file for a moment; do not quit on the first tick');
  assert.match(csharp, /tray\.heartbeat/, 'the helper must publish a heartbeat');

  const inject = readFileSync(new URL('../tools/inject.mjs', import.meta.url), 'utf8');
  assert.match(inject, /import \{ ensureTray, trayAlive \}/);
  assert.match(inject, /maybeEnsureTray\(\);/,
    'the resident injector must restart a missing tray');

  const tray = readFileSync(new URL('../tools/tray.mjs', import.meta.url), 'utf8');
  assert.match(tray, /nuvio-tray-\$\{VERSION\}\.exe/,
    'compiling over a running exe fails on Windows; use a build-specific name');
});

test('offline Codex is reported, never restarted without a click', () => {
  const csharp = readFileSync(new URL('../tools/tray/tray.cs', import.meta.url), 'utf8');
  assert.match(csharp, /offlineTicks < 3/,
    'a slow Codex start must not raise a false alarm');
  assert.match(csharp, /Codex is running without CDP/);
  assert.match(csharp, /launch-hidden\.vbs/);

  const watch = csharp.slice(
    csharp.indexOf('private static void Watch()'),
    csharp.indexOf('private static void CheckConnection()'),
  );
  assert.doesNotMatch(watch, /Restore\(\)/,
    'the timer must only notify; restarting Codex requires a user click');
});
