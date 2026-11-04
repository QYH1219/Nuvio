import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { inlineSceneAssets } from '../tools/inject.mjs';

test('inlineSceneAssets turns the default scene into data URLs', () => {
  const root = mkdtempSync(join(tmpdir(), 'cxd-scene-'));
  try {
    const wallpaper = join(root, 'wallpaper');
    mkdirSync(wallpaper);
    writeFileSync(
      join(wallpaper, 'scene.json'),
      JSON.stringify({
        image: 'scene.jpg',
        fit: 'stretch',
        pipeline: [{ type: 'shake', mask: 'mask_shake.png' }],
      }),
    );
    writeFileSync(join(wallpaper, 'scene.jpg'), Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
    writeFileSync(join(wallpaper, 'mask_shake.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));

    const scene = inlineSceneAssets(root);
    assert.ok(scene, 'scene should inline');
    assert.match(scene.image, /^data:image\/jpeg;base64,/);
    assert.match(scene.pipeline[0].mask, /^data:image\/png;base64,/);
    assert.equal(scene.fit, 'stretch');
    assert.equal(scene.inline, true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('inlineSceneAssets returns null when no default wallpaper exists', () => {
  const root = mkdtempSync(join(tmpdir(), 'cxd-scene-empty-'));
  try {
    assert.equal(inlineSceneAssets(root), null);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
