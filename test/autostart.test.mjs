import test from 'node:test';
import assert from 'node:assert/strict';
import { autostartSupported, getAutostartStatus } from '../tools/autostart.mjs';

test('autostart status is read-only and reports the platform', () => {
  const before = getAutostartStatus();
  assert.equal(before.supported, autostartSupported());
  assert.equal(typeof before.enabled, 'boolean');
  assert.equal(typeof before.path, 'string');

  const after = getAutostartStatus();
  assert.equal(after.enabled, before.enabled, 'status checks must not toggle autostart');
  assert.equal(after.path, before.path);
});
