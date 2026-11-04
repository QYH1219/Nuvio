import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULTS, clamp, loadConfig, resetConfig, saveConfig } from '../src/config.js';

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
