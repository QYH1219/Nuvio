#!/usr/bin/env node
/**
 * Optional Authenticode signing for Windows artifacts.
 *
 * Nuvio currently ships a portable ZIP, which SmartScreen does not evaluate
 * as an executable. When a launcher .exe or installer is added later, sign it
 * here so Windows can build publisher reputation instead of showing
 * "Unknown publisher".
 *
 *   NUVIO_SIGN_CERT=C:\certs\nuvio.pfx
 *   NUVIO_SIGN_PASSWORD=...
 *   npm run sign -- dist/Nuvio.exe
 *
 * Without a real certificate this tool does nothing and says so; it never
 * fabricates a signature or claims an unsigned build is trusted.
 */
import { existsSync, readdirSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const EXTENSIONS = new Set(['.exe', '.msi', '.dll', '.node']);
const TIMESTAMP = process.env.NUVIO_SIGN_TIMESTAMP || 'http://timestamp.digicert.com';

function findSignTool() {
  if (process.env.SIGNTOOL) return process.env.SIGNTOOL;
  const probe = spawnSync('where', ['signtool'], { encoding: 'utf8', windowsHide: true });
  if (probe.status === 0) {
    const first = String(probe.stdout || '').split(/\r?\n/).find(Boolean);
    if (first && existsSync(first.trim())) return first.trim();
  }
  const kits = [
    process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)',
    process.env.ProgramFiles || 'C:\\Program Files',
  ];
  for (const base of kits) {
    const bin = join(base, 'Windows Kits', '10', 'bin');
    if (!existsSync(bin)) continue;
    let versions = [];
    try {
      versions = readdirSync(bin, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .sort()
        .reverse();
    } catch {
      continue;
    }
    for (const version of versions) {
      for (const arch of ['x64', 'x86', 'arm64']) {
        const candidate = join(bin, version, arch, 'signtool.exe');
        if (existsSync(candidate)) return candidate;
      }
    }
  }
  return null;
}

function collectTargets(args) {
  if (args.length) {
    return args.map((arg) => resolve(ROOT, arg)).filter((file) => {
      if (!existsSync(file) || !statSync(file).isFile()) {
        console.warn(`[sign] skip missing file: ${file}`);
        return false;
      }
      return EXTENSIONS.has(file.slice(file.lastIndexOf('.')).toLowerCase());
    });
  }
  const dist = join(ROOT, 'dist');
  if (!existsSync(dist)) return [];
  return readdirSync(dist)
    .filter((name) => EXTENSIONS.has(name.slice(name.lastIndexOf('.')).toLowerCase()))
    .map((name) => join(dist, name));
}

function main() {
  const targets = collectTargets(process.argv.slice(2));
  if (!targets.length) {
    console.log('[sign] nothing to sign (Nuvio currently ships a portable ZIP).');
    return;
  }
  if (process.platform !== 'win32') {
    console.log('[sign] Authenticode signing is Windows-only; skipped.');
    return;
  }
  const cert = process.env.NUVIO_SIGN_CERT;
  const password = process.env.NUVIO_SIGN_PASSWORD;
  if (!cert || !existsSync(cert)) {
    console.error('[sign] no certificate: set NUVIO_SIGN_CERT to a .pfx file.');
    console.error('[sign] unsigned artifacts keep the "Unknown publisher" SmartScreen prompt.');
    process.exitCode = 1;
    return;
  }
  const signtool = findSignTool();
  if (!signtool) {
    console.error('[sign] signtool.exe not found. Install the Windows SDK signing tools.');
    process.exitCode = 1;
    return;
  }
  for (const target of targets) {
    const args = [
      'sign',
      '/fd',
      'SHA256',
      '/f',
      cert,
      '/tr',
      TIMESTAMP,
      '/td',
      'SHA256',
    ];
    if (password) args.push('/p', password);
    args.push(target);
    console.log(`[sign] ${target}`);
    const result = spawnSync(signtool, args, { stdio: 'inherit', windowsHide: true });
    if (result.status !== 0) {
      console.error(`[sign] failed: ${target}`);
      process.exitCode = 1;
    }
  }
}

main();
