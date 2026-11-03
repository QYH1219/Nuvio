import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const three = join(root, 'node_modules', 'three', 'examples', 'jsm', 'libs');

const copies = [
  ['draco', 'draco_decoder.js'],
  ['draco', 'draco_decoder.wasm'],
  ['draco', 'draco_wasm_wrapper.js'],
  ['basis', 'basis_transcoder.js'],
  ['basis', 'basis_transcoder.wasm'],
];

let copied = 0;
for (const [sourceDir, file] of copies) {
  const source = join(three, sourceDir, file);
  if (!existsSync(source)) {
    console.warn(`[cxd] missing decoder: ${source}`);
    continue;
  }
  const targetDir = join(root, 'public', 'vendor', sourceDir);
  mkdirSync(targetDir, { recursive: true });
  copyFileSync(source, join(targetDir, file));
  copied += 1;
}

console.log(`[cxd] local decoders ready (${copied}/${copies.length})`);
