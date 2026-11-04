import assert from 'node:assert/strict';
import test from 'node:test';

import { nextRotationEntry, rotationPool } from '../src/rotation.js';

const scene = (id, extra = {}) => ({
  id: String(id),
  title: `Wallpaper ${id}`,
  imported: true,
  kind: 'scene',
  ...extra,
});

test('rotationPool keeps imported video/scene/image wallpapers only', () => {
  const entries = [
    scene(1001),
    scene(1002, { kind: 'video' }),
    scene(1003, { kind: 'image' }),
    scene(1004, { kind: 'web' }),
    scene(1005, { imported: false }),
    scene(1006, { kind: null, type: 'scene' }),
    { id: '1007', imported: true, kind: 'application' },
    null,
  ];
  assert.deepEqual(
    rotationPool(entries).map((entry) => entry.id),
    ['1001', '1002', '1003', '1006'],
  );
});

test('favorites narrow the pool and stale favorites fall back to everything', () => {
  const entries = [scene(2001), scene(2002), scene(2003)];
  assert.deepEqual(
    rotationPool(entries, ['2001', '2003']).map((entry) => entry.id),
    ['2001', '2003'],
  );
  assert.deepEqual(
    rotationPool(entries, ['9999']).map((entry) => entry.id),
    ['2001', '2002', '2003'],
  );
});

test('nextRotationEntry advances in list order and wraps', () => {
  const entries = [scene(3001), scene(3002), scene(3003)];
  assert.equal(nextRotationEntry(entries, [], '3001').id, '3002');
  assert.equal(nextRotationEntry(entries, [], '3003').id, '3001');
  assert.equal(nextRotationEntry(entries, [], 'missing').id, '3001');
});

test('nextRotationEntry returns null when rotation cannot change anything', () => {
  assert.equal(nextRotationEntry([], [], '3001'), null);
  assert.equal(nextRotationEntry([scene(3001)], [], '3001'), null);
  assert.equal(nextRotationEntry([scene(3001), scene(3002)], [], '3001').id, '3002');
  assert.equal(nextRotationEntry([scene(3001), scene(3002)], ['3001'], '3002'), null);
  assert.equal(
    nextRotationEntry([scene(3001), scene(3002), scene(3003)], ['3001', '3003'], '3001').id,
    '3003',
  );
});
