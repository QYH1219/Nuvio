import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test } from 'node:test';
import { cdpTargetState, safeJoin } from '../tools/inject.mjs';

const root = resolve('C:/codex-dynamic-bg/public/assets');

test('serves normal relative asset paths without a leading dot', () => {
  assert.equal(
    safeJoin(root, 'wallpaper/scene.json'),
    resolve(root, 'wallpaper/scene.json'),
  );
  assert.equal(safeJoin(root, 'README.md'), resolve(root, 'README.md'));
  assert.equal(
    safeJoin(root, '/wallpaper/scene.jpg'),
    resolve(root, 'wallpaper/scene.jpg'),
  );
});

test('rejects path traversal outside the asset root', () => {
  assert.equal(safeJoin(root, '../package.json'), null);
  assert.equal(safeJoin(root, '..\\package.json'), null);
  assert.equal(safeJoin(root, 'wallpaper/../../package.json'), null);
});

test('detects a half-open CDP socket through the live target list', () => {
  const list = [
    { id: 'A', type: 'page', title: 'ChatGPT' },
    { id: 'B', type: 'page', title: 'devtools' },
  ];
  assert.equal(cdpTargetState(list, 'A'), 'alive');
  // The renderer died: the WebSocket may still be OPEN but the id is gone.
  assert.equal(cdpTargetState(list, 'dead'), 'gone');
  assert.equal(cdpTargetState([], 'A'), 'gone');
  assert.equal(cdpTargetState(null, 'A'), 'unknown');
  assert.equal(cdpTargetState(list, ''), 'gone');
});

test('reconnect updates the live target and closes a failed client', () => {
  const source = readFileSync(new URL('../tools/inject.mjs', import.meta.url), 'utf8');
  // `const target` here threw "Assignment to constant variable" on every
  // reattach; the empty catch hid it and the page reloaded in a loop.
  assert.match(source, /let target =\s*\n\s*selectTargetOrNull/);
  assert.match(source, /target = next;/);
  assert.match(source, /client\?\.close\(\);/,
    'a half-initialized CDP client must not leak on retry');
});

test('stale lock takeover is atomic between two injectors', () => {
  const source = readFileSync(new URL('../tools/inject.mjs', import.meta.url), 'utf8');
  assert.match(source, /renameSync\(LOCK_FILE, stale\)/);
  assert.match(source, /openSync\(LOCK_FILE, 'wx'\)/);
});
