import assert from 'node:assert/strict';
import test from 'node:test';
import { autoLook } from '../src/readability-auto.js';

test('a mid-tone wallpaper lands on the hand-tuned defaults', () => {
  const look = autoLook({ luminance: 0.35, edgeDensity: 0.35, busy: 0.35 });
  assert.ok(Math.abs(look.dim - 0.12) <= 0.02, `dim ${look.dim}`);
  assert.ok(Math.abs(look.surfaceOpacity - 0.22) <= 0.03, `surface ${look.surfaceOpacity}`);
});

test('bright busy artwork gets more dim and more frost than dark calm art', () => {
  const calm = autoLook({ luminance: 0.1, busy: 0.05 });
  const busy = autoLook({ luminance: 0.85, busy: 0.95 });
  assert.ok(busy.dim > calm.dim);
  assert.ok(busy.surfaceOpacity > calm.surfaceOpacity);
});

test('derived values stay inside the slider ranges', () => {
  for (const luminance of [-2, 0, 0.5, 1, 4]) {
    for (const busy of [-1, 0, 0.5, 1, 3]) {
      const look = autoLook({ luminance, busy });
      assert.ok(look.dim >= 0 && look.dim <= 0.8, `dim ${look.dim}`);
      assert.ok(look.surfaceOpacity >= 0 && look.surfaceOpacity <= 1, `surface ${look.surfaceOpacity}`);
    }
  }
});

test('missing analysis is a no-op', () => {
  assert.equal(autoLook(null), null);
});
