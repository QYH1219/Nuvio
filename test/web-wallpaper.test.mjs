import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { importWebEntry } from '../tools/library.mjs';

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'nuvio-web-'));
  const source = join(root, 'source');
  mkdirSync(join(source, 'assets'), { recursive: true });
  writeFileSync(join(source, 'index.html'), '<html><body>wallpaper</body></html>');
  writeFileSync(join(source, 'assets', 'app.js'), 'console.log(1)');
  writeFileSync(join(source, 'preview.jpg'), Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
  return { root, source, target: join(root, 'library', '3819616718') };
}

test('importWebEntry copies a web wallpaper and writes a web manifest', () => {
  const { root, source, target } = fixture();
  try {
    const meta = importWebEntry(
      {
        id: '3819616718',
        dir: source,
        entry: 'index.html',
        title: '神圣奶蛙',
        preview: join(source, 'preview.jpg'),
        type: 'web',
      },
      target,
    );
    assert.equal(meta.kind, 'web');
    assert.equal(meta.sourceType, 'web');
    assert.equal(meta.entry, 'library/3819616718/web/index.html');
    assert.ok(existsSync(join(target, 'web', 'index.html')));
    assert.ok(existsSync(join(target, 'web', 'assets', 'app.js')));
    assert.ok(existsSync(join(target, 'preview.jpg')));

    const written = JSON.parse(readFileSync(join(target, 'meta.json'), 'utf8'));
    assert.equal(written.kind, 'web');
    assert.equal(written.title, '神圣奶蛙');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('importWebEntry refuses an entry outside the copied folder', () => {
  const { root, source, target } = fixture();
  try {
    const meta = importWebEntry(
      { id: '3819616718', dir: source, entry: '../../evil.html', title: 'x', preview: null },
      target,
    );
    assert.equal(meta.entry, 'library/3819616718/web/index.html');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('importWebEntry rejects a folder with no HTML entry', () => {
  const { root, source, target } = fixture();
  try {
    rmSync(join(source, 'index.html'));
    assert.throws(
      () => importWebEntry({ id: '3819616718', dir: source, entry: 'index.html' }, target),
      /缺少入口 HTML/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
