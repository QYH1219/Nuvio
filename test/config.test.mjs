import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULTS,
  MOTION_PRESETS,
  ROTATION_PRESETS,
  applyDerived,
  clamp,
  loadConfig,
  resetConfig,
  saveConfig,
} from '../src/config.js';

class MemoryStorage {
  constructor() {
    this.map = new Map();
  }

  getItem(key) {
    return this.map.has(key) ? this.map.get(key) : null;
  }

  setItem(key, value) {
    this.map.set(key, String(value));
  }

  removeItem(key) {
    this.map.delete(key);
  }
}

globalThis.localStorage = new MemoryStorage();

test('loadConfig returns an isolated copy of the defaults', () => {
  const first = loadConfig();
  first.dim = 0.99;
  assert.equal(loadConfig().dim, DEFAULTS.dim);
});

test('loadConfig merges partial saved state and ignores junk', () => {
  saveConfig({ dim: 0.3, theme: 'rain' });
  const config = loadConfig();
  assert.equal(config.dim, 0.3);
  assert.equal(config.theme, 'rain');
  assert.equal(config.quality, DEFAULTS.quality);

  localStorage.setItem('codex-dynamic-bg:v2', '{not json');
  assert.deepEqual(loadConfig(), DEFAULTS);
});

test('resetConfig clears storage and restores defaults', () => {
  saveConfig({ dim: 0.42 });
  assert.equal(loadConfig().dim, 0.42);
  assert.deepEqual(resetConfig(), DEFAULTS);
  assert.equal(localStorage.getItem('codex-dynamic-bg:v2'), null);
});

test('clamp keeps values inside the requested range', () => {
  assert.equal(clamp(-1, 0, 1), 0);
  assert.equal(clamp(2, 0, 1), 1);
  assert.equal(clamp(0.4, 0, 1), 0.4);
});

test('applyDerived expands the motion preset and power saver into legacy keys', () => {
  const config = { motionPreset: 'light', powerSaver: false, rotationMinutes: 30 };
  applyDerived(config);
  assert.equal(config.motion, MOTION_PRESETS.light.motion);
  assert.equal(config.parallax, MOTION_PRESETS.light.parallax);
  assert.equal(config.autoQuality, false);
  assert.equal(config.lowEndAuto, false);
  assert.equal(config.idlePause, false);
  assert.equal(config.pauseWhenUnfocused, false);

  const fallback = applyDerived({ motionPreset: 'missing' });
  assert.equal(fallback.motion, MOTION_PRESETS.standard.motion);
});

test('rotation minutes snap to the segment options the panel actually offers', () => {
  for (const minutes of [1, 37, 44, 75, 240, Number.NaN]) {
    const config = applyDerived({ motionPreset: 'standard', rotationMinutes: minutes });
    assert.ok(ROTATION_PRESETS.includes(config.rotationMinutes), String(minutes));
  }
  assert.equal(applyDerived({ motionPreset: 'standard', rotationMinutes: 44 }).rotationMinutes, 30);
  assert.equal(applyDerived({ motionPreset: 'standard', rotationMinutes: 46 }).rotationMinutes, 60);
});

test('favoriteIds never leaks the shared default array', () => {
  localStorage.removeItem('codex-dynamic-bg:v2');
  const first = loadConfig();
  first.favoriteIds.push('12345');
  assert.deepEqual(loadConfig().favoriteIds, []);
  assert.notEqual(loadConfig().favoriteIds, DEFAULTS.favoriteIds);

  const reset = resetConfig();
  reset.favoriteIds.push('99999');
  assert.deepEqual(resetConfig().favoriteIds, []);
});

test('favoriteIds are validated, deduplicated and capped', () => {
  saveConfig({
    favoriteIds: ['12345', '12345', 'abc', '', 67890, '12345678901234567890123'],
  });
  assert.deepEqual(loadConfig().favoriteIds, ['12345', '67890']);

  saveConfig({ favoriteIds: Array.from({ length: 260 }, (_, i) => String(10000 + i)) });
  assert.equal(loadConfig().favoriteIds.length, 200);

  saveConfig({ favoriteIds: 'nope' });
  assert.deepEqual(loadConfig().favoriteIds, []);
});

test('rotationMinutes is clamped then snapped to a panel preset', () => {
  saveConfig({ rotationMinutes: 0 });
  assert.equal(loadConfig().rotationMinutes, ROTATION_PRESETS[0]);
  saveConfig({ rotationMinutes: 99999 });
  assert.equal(loadConfig().rotationMinutes, ROTATION_PRESETS.at(-1));
  saveConfig({ rotationMinutes: 12.6 });
  assert.equal(loadConfig().rotationMinutes, 15);
  saveConfig({ rotationMinutes: 'soon' });
  assert.equal(loadConfig().rotationMinutes, DEFAULTS.rotationMinutes);
});

test('numeric settings are clamped on load and restore the default when invalid', () => {
  saveConfig({ dim: 5, motion: -1, grain: 9, modelScale: 0 });
  const config = loadConfig();
  assert.equal(config.dim, 0.8);
  assert.equal(config.motion, 0);
  assert.equal(config.grain, 1.5);
  assert.equal(config.modelScale, 0.4);

  saveConfig({ dim: 'nope', vignette: 'nope', bloom: null });
  const invalid = loadConfig();
  assert.equal(invalid.dim, DEFAULTS.dim);
  assert.equal(invalid.vignette, DEFAULTS.vignette);
  // null coerces to 0, which is a legal bloom value.
  assert.equal(invalid.bloom, 0);
});
