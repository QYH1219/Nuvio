#!/usr/bin/env node
/** Print raw and gzip sizes for the shipped bundles. */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { gzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));

function kb(bytes) {
  return `${(bytes / 1024).toFixed(1)} KB`;
}

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.(js|css|html|json)$/i.test(entry.name)) out.push(full);
  }
  return out;
}

let raw = 0;
let gz = 0;
for (const dir of ['dist-embed', 'dist']) {
  const files = walk(join(ROOT, dir));
  if (!files.length) continue;
  console.log(`\n${dir}`);
  for (const file of files.sort((a, b) => statSync(b).size - statSync(a).size)) {
    const body = readFileSync(file);
    const packed = gzipSync(body, { level: 6 });
    raw += body.length;
    gz += packed.length;
    console.log(
      `  ${file.slice(ROOT.length + 1).padEnd(46)} ${kb(body.length).padStart(9)}  →  ${kb(packed.length).padStart(9)} gzip`,
    );
  }
}
console.log(`\ntotal: ${kb(raw)} raw → ${kb(gz)} gzip`);
console.log('The injected runtime is served gzip-compressed and cached over HTTP in lazy mode.');
