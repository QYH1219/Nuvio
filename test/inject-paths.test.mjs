import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { test } from 'node:test';
import { safeJoin } from '../tools/inject.mjs';

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
