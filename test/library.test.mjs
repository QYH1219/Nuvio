import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ASSET_LIMITS,
  classifyAsset,
  describeAsset,
  formatBytes,
} from '../src/library.js';

function asset(name, type, size = 16) {
  return new File([new Uint8Array(size)], name, { type });
}

test('classifyAsset distinguishes images, videos and models', () => {
  assert.equal(classifyAsset(asset('art.webp', 'image/webp')), 'image');
  assert.equal(classifyAsset(asset('loop.mp4', 'video/mp4')), 'video');
  assert.equal(classifyAsset(asset('figure.glb', 'model/gltf-binary')), 'model');
  assert.equal(classifyAsset(asset('notes.txt', 'text/plain')), null);
  assert.equal(classifyAsset(null), null);
});

test('describeAsset accepts a normal background', () => {
  const meta = describeAsset(asset('wallpaper.png', 'image/png', 32), 'background');
  assert.equal(meta.slot, 'background');
  assert.equal(meta.kind, 'image');
  assert.equal(meta.name, 'wallpaper.png');
  assert.equal(meta.size, 32);
});

test('describeAsset accepts a single-file GLB model', () => {
  const meta = describeAsset(asset('hero.glb', 'model/gltf-binary'), 'model');
  assert.equal(meta.kind, 'model');
});

test('model slot rejects images and external glTF files', () => {
  assert.throws(
    () => describeAsset(asset('wallpaper.png', 'image/png'), 'model'),
    /模型位置只接受/,
  );
  assert.throws(
    () => describeAsset(asset('hero.gltf', 'model/gltf+json'), 'model'),
    /单文件 \.glb/,
  );
});

test('background slot rejects models', () => {
  assert.throws(
    () => describeAsset(asset('hero.glb', 'model/gltf-binary'), 'background'),
    /背景位置/,
  );
});

test('describeAsset enforces per-slot size limits', () => {
  const tooLarge = {
    name: 'huge.mp4',
    type: 'video/mp4',
    size: ASSET_LIMITS.background + 1,
  };
  assert.throws(() => describeAsset(tooLarge, 'background'), /文件过大/);
});

test('formatBytes uses readable units', () => {
  assert.equal(formatBytes(512), '512 B');
  assert.equal(formatBytes(1536), '1.5 KB');
  assert.equal(formatBytes(2 * 1024 * 1024), '2.0 MB');
});
