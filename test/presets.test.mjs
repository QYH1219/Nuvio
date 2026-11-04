import assert from 'node:assert/strict';
import test from 'node:test';
import {
  READABILITY,
  THEMES,
  applyReadability,
  applyTheme,
  applyWallpaperLook,
  getTheme,
} from '../src/presets.js';

test('themes have unique ids, palettes and effect values', () => {
  const ids = new Set();
  for (const theme of THEMES) {
    assert.match(theme.id, /^[a-z0-9-]+$/);
    assert.ok(!ids.has(theme.id), `duplicate theme id: ${theme.id}`);
    ids.add(theme.id);
    assert.ok(theme.name);
    for (const key of ['glowA', 'glowB', 'particleA', 'particleB', 'rimA', 'rimB']) {
      assert.match(theme.palette[key], /^#[0-9a-f]{6}$/i, `${theme.id}.${key}`);
    }
    for (const key of ['bloom', 'grain', 'dim', 'vignette', 'motion', 'parallax']) {
      assert.equal(typeof theme.effects[key], 'number', `${theme.id}.${key}`);
    }
    assert.equal(typeof theme.effects.particles, 'boolean');
  }
});

test('getTheme falls back to the first theme', () => {
  assert.equal(getTheme('missing-theme').id, THEMES[0].id);
  assert.equal(getTheme(THEMES[1].id).id, THEMES[1].id);
});

test('applyTheme mutates the config in place and keeps user assets', () => {
  const config = { imageUrl: '/assets/background.webp', dim: 0.9 };
  const result = applyTheme(config, 'cyber');
  assert.equal(result, config);
  assert.equal(config.theme, 'cyber');
  assert.equal(config.imageUrl, '/assets/background.webp');
  assert.equal(config.dim, THEMES.find((theme) => theme.id === 'cyber').effects.dim);
});

test('readability presets expose labels and numeric overrides', () => {
  for (const [id, preset] of Object.entries(READABILITY)) {
    assert.ok(preset.label, id);
    for (const key of ['surfaceOpacity', 'dim', 'vignette']) {
      assert.equal(typeof preset[key], 'number', `${id}.${key}`);
    }
  }
});

test('applyReadability falls back to balanced', () => {
  const config = {};
  applyReadability(config, 'unknown');
  assert.equal(config.readability, 'balanced');
  assert.equal(config.surfaceOpacity, READABILITY.balanced.surfaceOpacity);
});

test('wallpaper look keeps the desktop crisp and independent from themes', () => {
  const config = { theme: 'cyber', motion: 0.5, parallax: 0.7 };
  const result = applyWallpaperLook(config);
  assert.equal(result, config);
  assert.equal(config.theme, 'cyber');
  assert.equal(config.motion, 0.5);
  assert.equal(config.parallax, 0.7);
  assert.equal(config.readability, 'wallpaper');
  assert.equal(config.surfaceOpacity, READABILITY.wallpaper.surfaceOpacity);
  assert.equal(config.dim, READABILITY.wallpaper.dim);
  assert.equal(config.vignette, READABILITY.wallpaper.vignette);
  assert.equal(config.bloom, 0.42);
  assert.equal(config.grain, 0.18);
});
