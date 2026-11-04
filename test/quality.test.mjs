import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULTS,
  QUALITY,
  QUALITY_ORDER,
  cheaperQuality,
  normalizeQuality,
  qualityFor,
} from '../src/config.js';
import { PerfGovernor } from '../src/perf.js';

test('quality aliases keep old localStorage payloads working', () => {
  assert.equal(normalizeQuality('low'), 'saver');
  assert.equal(normalizeQuality('medium'), 'balanced');
  assert.equal(normalizeQuality('high'), 'high');
  assert.equal(normalizeQuality('nonsense'), 'saver');
});

test('quality tiers step down from high to saver and stop there', () => {
  assert.equal(cheaperQuality('high'), 'balanced');
  assert.equal(cheaperQuality('balanced'), 'saver');
  assert.equal(cheaperQuality('saver'), null);
});

test('saver is the default and 30 FPS tiers use timer scheduling', () => {
  assert.equal(DEFAULTS.quality, 'saver');
  assert.equal(DEFAULTS.autoQuality, true);
  assert.equal(DEFAULTS.idlePause, true);
  assert.equal(qualityFor('saver').fps, 30);
  assert.equal(qualityFor('balanced').fps, 30);
  assert.equal(qualityFor('high').fps, 60);
});

test('quality tiers change sampling and frame rate only', () => {
  const allowed = new Set(['label', 'hint', 'dpr', 'fps']);
  for (const tier of QUALITY_ORDER) {
    assert.deepEqual(new Set(Object.keys(QUALITY[tier])), allowed);
  }
  assert.deepEqual(
    QUALITY_ORDER.map((tier) => QUALITY[tier].dpr),
    [1, 1.25, 1.5],
  );
});

test('performance governor downgrades once after sustained low FPS', () => {
  const drops = [];
  const governor = new PerfGovernor({
    warmupMs: 0,
    samplesNeeded: 3,
    onDowngrade: (next) => drops.push(next),
  });

  assert.equal(governor.sample(18, 'high', true), null);
  assert.equal(governor.sample(18, 'high', true), null);
  assert.equal(governor.sample(18, 'high', true), 'balanced');
  assert.deepEqual(drops, ['balanced']);

  // One downgrade per session; further low samples do not cascade.
  assert.equal(governor.sample(12, 'balanced', true), null);
  assert.deepEqual(drops, ['balanced']);
});

test('performance governor scales the failure line to the tier target', () => {
  const governor = new PerfGovernor({
    warmupMs: 0,
    samplesNeeded: 3,
    onDowngrade: () => {
      throw new Error('balanced at 24 FPS must not downgrade');
    },
  });
  for (let index = 0; index < 6; index += 1) {
    assert.equal(governor.sample(24, 'balanced', true), null);
  }

  const disabled = new PerfGovernor({ warmupMs: 0, samplesNeeded: 1 });
  assert.equal(disabled.sample(5, 'high', false), null);
});
