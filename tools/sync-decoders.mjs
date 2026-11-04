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

const licenses = [
  ['node_modules/three/LICENSE', 'public/vendor/three/LICENSE'],
  ['licenses/Apache-2.0.txt', 'public/vendor/draco/LICENSE'],
  ['licenses/Apache-2.0.txt', 'public/vendor/basis/LICENSE'],
];

let copied = 0;
for (const [sourceDir, file] of copies) {
  const source = join(three, sourceDir, file);
  if (!existsSync(source)) {
    console.warn(`[nuvio] missing decoder: ${source}`);
    continue;
  }
  const targetDir = join(root, 'public', 'vendor', sourceDir);
  mkdirSync(targetDir, { recursive: true });
  copyFileSync(source, join(targetDir, file));
  copied += 1;
}

let licenseCount = 0;
for (const [sourceRel, targetRel] of licenses) {
  const source = join(root, sourceRel);
  if (!existsSync(source)) {
    console.warn(`[nuvio] missing license: ${source}`);
    continue;
  }
  const target = join(root, targetRel);
  mkdirSync(dirname(target), { recursive: true });
  copyFileSync(source, target);
  licenseCount += 1;
}

console.log(`[nuvio] local decoders ready (${copied}/${copies.length})`);
console.log(`[nuvio] third-party licenses ready (${licenseCount}/${licenses.length})`);
