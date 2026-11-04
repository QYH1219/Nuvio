import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ARTWORK_TEXTURE_EDGE,
  EFFECT_TEXTURE_EDGE,
  fitWithin,
  summarizeTextures,
  textureInfo,
} from '../src/texture.js';

test('fitWithin keeps aspect ratio and never upscales', () => {
  assert.deepEqual(fitWithin(3840, 2160, 4096), {
    width: 3840,
    height: 2160,
    scale: 1,
    downscaled: false,
  });

  const small = fitWithin(800, 600, 4096);
  assert.equal(small.width, 800);
  assert.equal(small.height, 600);
  assert.equal(small.downscaled, false);
});

test('fitWithin caps an 8K artwork on the long edge', () => {
  const fit = fitWithin(7680, 4320, ARTWORK_TEXTURE_EDGE);
  assert.equal(Math.max(fit.width, fit.height), 4096);
  assert.equal(fit.width, 4096);
  assert.equal(fit.height, 2304);
  assert.equal(fit.downscaled, true);
});

test('effect textures get a smaller budget than artwork', () => {
  assert.ok(EFFECT_TEXTURE_EDGE < ARTWORK_TEXTURE_EDGE);
  const fit = fitWithin(4096, 2048, EFFECT_TEXTURE_EDGE);
  assert.equal(Math.max(fit.width, fit.height), EFFECT_TEXTURE_EDGE);
  assert.equal(fit.height, 1024);
});

test('textureInfo reports upload size and byte cost', () => {
  const texture = {
    image: { width: 2048, height: 1024 },
    userData: {
      nuvio: {
        originalWidth: 7680,
        originalHeight: 4320,
        width: 2048,
        height: 1024,
        downscaled: true,
        maxEdge: 4096,
      },
    },
  };
  const info = textureInfo(texture, 'artwork');
  assert.equal(info.width, 2048);
  assert.equal(info.height, 1024);
  assert.equal(info.bytes, 2048 * 1024 * 4);
  assert.equal(info.downscaled, true);
});

test('summarizeTextures aggregates count, bytes and downscale state', () => {
  const make = (width, height, downscaled) => ({
    image: { width, height },
    userData: { nuvio: { width, height, downscaled } },
  });
  const summary = summarizeTextures([
    make(1920, 1080, false),
    make(512, 512, true),
  ]);
  assert.equal(summary.textureCount, 2);
  assert.equal(summary.textureBytes, (1920 * 1080 + 512 * 512) * 4);
  assert.equal(summary.textureDownscaled, true);
  assert.deepEqual(summary.textureItems.map((item) => item.role), [
    'artwork',
    'effect-1',
  ]);
});
