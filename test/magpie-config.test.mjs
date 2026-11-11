import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

test('PowerShell edits only desktop efforts, preserves Unicode, and backs up original bytes',
  { skip: process.platform !== 'win32' }, () => {
    const dir = mkdtempSync(join(tmpdir(), 'nuvio-config-'));
    try {
      const source = 'model = "keep-model"\r\nmodel_reasoning_effort = "max"\r\n' +
        '[projects."C:/项目/奶蛙"]\r\ntrust_level = "trusted"\r\n' +
        'enabled-reasoning-efforts = ["leave-me"]\r\n' +
        '[desktop] # keep table comment\r\nother = "keep"\r\n' +
        'enabled-reasoning-efforts = [\r\n  "low",\r\n  "max",\r\n]\r\n' +
        '[other]\r\nmodel = "nested-model"\r\n';
      const config = join(dir, 'config.toml');
      writeFileSync(config, source);
      const helper = resolve('tools/compat/magpie-config.ps1').replaceAll("'", "''");
      const script = join(dir, 'fixture.ps1');
      writeFileSync(script, `\uFEFF
$ErrorActionPreference = 'Stop'
. '${helper}'
$path = Join-Path $PSScriptRoot 'config.toml'
$text = [IO.File]::ReadAllText($path)
if ((Get-RootConfigValue $text 'model') -ne 'keep-model') { throw 'wrong model scope' }
$updated = Set-DesktopEffortList $text '["ultra", "high", "medium"]'
Save-ConfigAtomically $path $text $updated
if ((Set-DesktopEffortList $updated '["ultra", "high", "medium"]') -cne $updated) { throw 'not idempotent' }
$nested = "[other]" + [Environment]::NewLine + 'model = "nested"'
if ($null -ne (Get-RootConfigValue $nested 'model')) { throw 'nested value leaked' }
$missing = Set-DesktopEffortList $nested '["ultra", "high", "medium"]'
if ($missing -notmatch '(?m)^\[desktop\]') { throw 'missing table was not added' }
$noList = "[desktop]" + [Environment]::NewLine + 'other = 1' + [Environment]::NewLine + '[next]'
$added = Set-DesktopEffortList $noList '["ultra", "high", "medium"]'
if ($added.IndexOf('enabled-reasoning-efforts') -gt $added.IndexOf('[next]')) { throw 'wrong insertion scope' }
# A concurrent editor must not be overwritten.
[IO.File]::WriteAllText($path, $updated + '# concurrent')
try { Save-ConfigAtomically $path $updated ($updated + '# ours'); throw 'missed conflict' }
catch { if ($_.Exception.Message -notmatch 'changed concurrently') { throw } }
[IO.File]::WriteAllText($path, $updated)
# Changing model can reset effort even when the old model was already ultra.
$script:state = 'model = "old"' + "\n" + 'model_reasoning_effort = "ultra"'
$script:calls = @()
$read = { $script:state }
$model = { param($value) $script:calls += 'model'; $script:state = 'model = "new"' + "\n" + 'model_reasoning_effort = "max"' }
$effort = { param($value) $script:calls += 'effort'; $script:state = 'model = "new"' + "\n" + 'model_reasoning_effort = "ultra"' }
$null = Sync-MagpieSettings $read $model $effort 'new' 'ultra'
if (($script:calls -join ',') -ne 'model,effort') { throw 'stale effort after model change' }
$script:calls = @()
$null = Sync-MagpieSettings $read $model $effort 'new' 'ultra'
if ($script:calls.Count -ne 0) { throw 'matching settings should not call CLI' }
$script:state = 'model = "old"'
$badModel = { param($value) throw 'CLI failed' }
try { $null = Sync-MagpieSettings $read $badModel $effort 'new' 'ultra'; throw 'missed CLI failure' }
catch { if ($_.Exception.Message -ne 'CLI failed') { throw } }
`, 'utf8');
      const result = spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script], {
        encoding: 'utf8', windowsHide: true, timeout: 15000,
      });
      assert.equal(result.status, 0, result.stderr || result.error?.message);
      const updated = readFileSync(config, 'utf8');
      assert.ok(updated.includes('[projects."C:/项目/奶蛙"]'));
      assert.ok(updated.includes('enabled-reasoning-efforts = ["leave-me"]'));
      assert.ok(updated.includes('[desktop] # keep table comment\r\n'));
      assert.ok(updated.includes('enabled-reasoning-efforts = ["ultra", "high", "medium"]\r\n'));
      assert.equal(updated.replaceAll('\r\n', '').includes('\n'), false);
      const backups = readdirSync(dir).filter((name) => name.includes('.nuvio-backup-'));
      assert.equal(backups.length, 1);
      assert.equal(readFileSync(join(dir, backups[0]), 'utf8'), source);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
