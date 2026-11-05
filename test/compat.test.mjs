import assert from 'node:assert/strict';
import test from 'node:test';

import { COMPAT_SURFACES, inspectCompat } from '../src/compat.js';

function fakeDoc(found) {
  return {
    documentElement: { dataset: {} },
    querySelector(selector) {
      return found.has(selector) ? {} : null;
    },
  };
}

test('compat probe reports ok when every known surface is present', () => {
  const found = new Set(COMPAT_SURFACES.flatMap((surface) => surface.selectors));
  const result = inspectCompat(fakeDoc(found));
  assert.equal(result.status, 'ok');
  assert.equal(result.matched, COMPAT_SURFACES.length);
  assert.deepEqual(result.missing, []);
});

test('compat probe reports partial and names the missing surface', () => {
  const composer = COMPAT_SURFACES.find((surface) => surface.id === 'composer');
  const found = new Set(
    COMPAT_SURFACES.filter((surface) => surface.id !== 'composer')
      .flatMap((surface) => surface.selectors),
  );
  const result = inspectCompat(fakeDoc(found));
  assert.equal(result.status, 'partial');
  assert.deepEqual(result.missing, [composer.label]);
});

test('compat probe degrades safely without a document', () => {
  const result = inspectCompat(null);
  assert.equal(result.status, 'unknown');
  assert.equal(result.missing.length, COMPAT_SURFACES.length);
});
