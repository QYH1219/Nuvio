import assert from 'node:assert/strict';
import test from 'node:test';
import { buildCleanupExpression } from '../tools/cleanup-expression.mjs';

test('cleanup expression disposes the runtime and removes injected nodes', () => {
  const source = buildCleanupExpression();
  assert.match(source, /window\.cxdBg\.dispose/);
  assert.match(source, /'cxd-bg-root'/);
  assert.match(source, /'cxd-bg-style', 'cxd-bg-codex-style'/);
  assert.match(source, /removeAttribute\('data-cxd-background'\)/);
  assert.match(source, /localStorage\.removeItem\('codex-dynamic-bg:v2'\)/);
  assert.match(source, /const keepConfig = false;/);
});

test('keepConfig preserves the saved configuration', () => {
  const source = buildCleanupExpression({ keepConfig: true });
  assert.match(source, /const keepConfig = true;/);
  assert.match(source, /if \(!keepConfig\)/);
});
