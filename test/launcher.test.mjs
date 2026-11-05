import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

test('hidden launcher starts start.cmd without a console window', () => {
  const vbs = readFileSync(join(ROOT, 'launch-hidden.vbs'), 'utf8');
  assert.match(vbs, /Option Explicit/);
  assert.match(vbs, /NUVIO_HIDDEN/);
  assert.match(vbs, /\\start\.cmd/);
  assert.match(vbs, /shell\.Run command, 0, False/);
});

test('hidden launch log is bounded instead of growing forever', () => {
  const cmd = readFileSync(join(ROOT, 'start.cmd'), 'utf8');
  assert.match(cmd, /set "NUVIO_LOG=%TEMP%\\nuvio-launch\.log"/);
  assert.match(cmd, /call :rotate_log/);
  assert.match(cmd, /:rotate_log/);
  assert.match(cmd, /GTR 262144/);
  assert.match(cmd, /move \/Y "%NUVIO_LOG%" "%NUVIO_LOG%\.1"/);
  assert.match(cmd, />>"%NUVIO_LOG%"/);
});
