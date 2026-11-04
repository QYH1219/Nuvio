import assert from 'node:assert/strict';
import test from 'node:test';
import {
  RELEASE_API,
  checkForUpdates,
  compareVersions,
  normalizeVersion,
  parseVersion,
} from '../src/update.js';

test('version parsing accepts v-prefixed semver and rejects junk', () => {
  assert.deepEqual(parseVersion('v0.6.0'), [0, 6, 0]);
  assert.deepEqual(parseVersion('1.2.3-beta.1'), [1, 2, 3]);
  assert.equal(parseVersion('latest'), null);
  assert.equal(parseVersion(''), null);
  assert.equal(normalizeVersion('v1.4.0'), '1.4.0');
});

test('version comparison orders numerically, not lexically', () => {
  assert.equal(compareVersions('0.10.0', '0.9.0'), 1);
  assert.equal(compareVersions('v0.6.0', '0.6.0'), 0);
  assert.equal(compareVersions('0.5.2', '0.6.0'), -1);
  assert.equal(compareVersions('1.0.0', '1.0.1'), -1);
  assert.equal(compareVersions('', '0.0.1'), -1);
  assert.equal(compareVersions('0.0.1', ''), 1);
});

test('checkForUpdates reports an available update without touching the network', async () => {
  const result = await checkForUpdates('0.6.0', {
    fetchRelease: async () => ({
      tag_name: 'v0.6.1',
      html_url: 'https://example.test/release',
      published_at: '2026-11-04T00:00:00Z',
    }),
  });
  assert.deepEqual(result, {
    current: '0.6.0',
    latest: '0.6.1',
    updateAvailable: true,
    url: 'https://example.test/release',
    publishedAt: '2026-11-04T00:00:00Z',
    name: '',
  });
});

test('checkForUpdates reports current when the release is not newer', async () => {
  const result = await checkForUpdates('0.6.0', {
    fetchRelease: async () => ({ tag_name: 'v0.6.0' }),
  });
  assert.equal(result.updateAvailable, false);
  assert.equal(result.url, 'https://github.com/QYH1219/Nuvio/releases');
});

test('a malformed release feed is an explicit error, not a silent "up to date"', async () => {
  await assert.rejects(
    () => checkForUpdates('0.6.0', { fetchRelease: async () => ({ name: 'no tag' }) }),
    /版本号/,
  );
});

test('release endpoint points at the public repository', () => {
  assert.equal(
    RELEASE_API,
    'https://api.github.com/repos/QYH1219/Nuvio/releases/latest',
  );
});
