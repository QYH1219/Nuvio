import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  isPrivateAsset,
  listPrivateAssets,
  stripPrivateAssets,
} from '../tools/private-assets.mjs';

test('recognizes private artwork but keeps the assets README', () => {
  assert.equal(isPrivateAsset('assets/wallpaper/scene.jpg'), true);
  assert.equal(isPrivateAsset('assets/wallpaper/scene.json'), true);
  assert.equal(isPrivateAsset('assets/library/123/scene.jpg'), true);
  assert.equal(isPrivateAsset('assets/background.webp'), true);
  assert.equal(isPrivateAsset('assets/background.mp4'), true);
  assert.equal(isPrivateAsset('assets/model.glb'), true);
  assert.equal(isPrivateAsset('assets/README.md'), false);
  assert.equal(isPrivateAsset('vendor/draco/draco_decoder.js'), false);
  assert.equal(isPrivateAsset('icon.ico'), false);
});

test('lists and strips private assets from an output tree', () => {
  const root = mkdtempSync(join(tmpdir(), 'cxd-dist-'));
  try {
    mkdirSync(join(root, 'assets', 'wallpaper'), { recursive: true });
    mkdirSync(join(root, 'assets', 'library', '42'), { recursive: true });
    writeFileSync(join(root, 'assets', 'README.md'), 'readme');
    writeFileSync(join(root, 'assets', 'wallpaper', 'scene.jpg'), 'private');
    writeFileSync(join(root, 'assets', 'wallpaper', 'scene.json'), '{}');
    writeFileSync(join(root, 'assets', 'library', '42', 'background.mp4'), 'private');
    writeFileSync(join(root, 'assets', 'background.webp'), 'private');
    writeFileSync(join(root, 'assets', 'model.glb'), 'private');
    writeFileSync(join(root, 'index.html'), '<html></html>');

    assert.deepEqual(listPrivateAssets(root), [
      'assets/background.webp',
      'assets/library/42/background.mp4',
      'assets/model.glb',
      'assets/wallpaper/scene.jpg',
      'assets/wallpaper/scene.json',
    ]);

    const removed = stripPrivateAssets(root);
    assert.equal(removed.length, 5);
    assert.equal(existsSync(join(root, 'assets', 'README.md')), true);
    assert.equal(existsSync(join(root, 'assets', 'wallpaper')), false);
    assert.equal(existsSync(join(root, 'assets', 'library')), false);
    assert.equal(existsSync(join(root, 'index.html')), true);
    assert.deepEqual(listPrivateAssets(root), []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
