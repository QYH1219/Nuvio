#!/usr/bin/env node
/**
 * Build a portable release archive that runs without `npm install`.
 *
 *   npm run pack
 *
 * The injection bundle is prebuilt, so the zip only needs Node 22+, start.cmd,
 * the tools, the vendor decoders and the public assets README. User wallpaper
 * artwork is never included.
 */
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
} from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeZip } from './zip.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
const BUNDLE = join(ROOT, 'dist-embed', 'codex-dynamic-bg.iife.js');

function parseArgs(argv) {
  const options = { out: '', skipBuildCheck: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--out' || arg === '-o') options.out = argv[++index] ?? '';
    else if (arg === '--skip-build-check') options.skipBuildCheck = true;
    else if (arg === '--help' || arg === '-h') options.help = true;
    else throw new Error(`unknown option: ${arg}`);
  }
  return options;
}

function walk(dir) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const item of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, item.name);
    if (item.isDirectory()) out.push(...walk(full));
    else if (item.isFile()) out.push(full);
  }
  return out;
}

function collect() {
  const files = [
    'package.json',
    'start.cmd',
    'start.sh',
    'restart.cmd',
    'README.md',
    'README.en.md',
    'CHANGELOG.md',
    'LICENSE',
    'THIRD_PARTY_NOTICES.md',
    'public/icon.ico',
    'public/assets/README.md',
    'dist-embed/codex-dynamic-bg.iife.js',
    'tools/launch-codex.ps1',
    'tools/launch-codex.sh',
  ];
  for (const file of walk(join(ROOT, 'tools'))) {
    if (file.endsWith('.mjs')) files.push(relative(ROOT, file).replace(/\\/g, '/'));
  }
  for (const file of walk(join(ROOT, 'public', 'vendor'))) {
    files.push(relative(ROOT, file).replace(/\\/g, '/'));
  }
  return [...new Set(files)].filter((file) => existsSync(join(ROOT, file)));
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log('Usage: node tools/pack.mjs [--out dist/nuvio-<version>.zip]');
    return;
  }
  if (!existsSync(BUNDLE) && !options.skipBuildCheck) {
    throw new Error('missing dist-embed bundle; run npm run build:all first');
  }

  const files = collect();
  const entries = files.map((file) => ({
    name: `nuvio-${pkg.version}/${file}`,
    data: readFileSync(join(ROOT, file)),
    store: /\.(png|jpg|jpeg|webp|avif|ico|mp4|webm|woff2?)$/i.test(file),
  }));

  const out = resolve(
    options.out || join(ROOT, 'dist', `nuvio-${pkg.version}-portable.zip`),
  );
  mkdirSync(dirname(out), { recursive: true });
  writeZip(out, entries);

  const size = statSync(out).size;
  console.log(`[nuvio] packaged ${files.length} file(s) · ${(size / 1024).toFixed(1)} KB`);
  console.log(`[nuvio] release: ${out}`);
  console.log('[nuvio] requires Node.js 22+; no npm install needed to run');
}

try {
  main();
} catch (error) {
  console.error(`[nuvio] pack failed: ${error.message}`);
  process.exitCode = 1;
}
