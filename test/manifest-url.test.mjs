import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { probeAssets } from '../src/assets.js';

const originalWindow = globalThis.window;
const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.window = originalWindow;
  globalThis.fetch = originalFetch;
});

function json(body) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

test('probeAssets resolves a web manifest entry under /assets/', async () => {
  globalThis.window = { __CXD_ASSET_BASE__: 'http://127.0.0.1:5275/' };
  const calls = [];
  globalThis.fetch = async (url, options = {}) => {
    const target = String(url);
    calls.push({ url: target, method: options.method || 'GET' });
    if (target === 'http://127.0.0.1:5275/assets/active.json') {
      return json({
        version: 1,
        id: '3819616718',
        kind: 'web',
        entry: 'library/3819616718/web/index.html',
      });
    }
    if (target === 'http://127.0.0.1:5275/assets/library/3819616718/web/index.html') {
      return new Response('<html></html>', {
        status: 200,
        headers: { 'content-type': 'text/html; charset=utf-8' },
      });
    }
    return new Response('', { status: 404, headers: { 'content-type': 'text/plain' } });
  };

  const probed = await probeAssets();
  assert.equal(
    probed.webUrl,
    'http://127.0.0.1:5275/assets/library/3819616718/web/index.html',
  );
  assert.equal(probed.activeKind, 'web');
  assert.equal(probed.active?.id, '3819616718');
  assert.ok(
    calls.some((call) => call.url === 'http://127.0.0.1:5275/assets/active.json'),
    'the manifest request must actually run (guards against a TDZ throw)',
  );
});

test('probeAssets ignores an image entry that only returns the SPA fallback', async () => {
  globalThis.window = { __CXD_ASSET_BASE__: 'http://127.0.0.1:5275/' };
  globalThis.fetch = async (url) => {
    const target = String(url);
    if (target === 'http://127.0.0.1:5275/assets/active.json') {
      return json({ version: 1, kind: 'image', entry: 'library/1/missing.jpg' });
    }
    // Vite-style SPA fallback: 200 + text/html for a file that is not there.
    return new Response('<!doctype html>', {
      status: 200,
      headers: { 'content-type': 'text/html' },
    });
  };

  const probed = await probeAssets();
  assert.equal(probed.imageUrl, null);
  assert.equal(probed.active, undefined);
});
