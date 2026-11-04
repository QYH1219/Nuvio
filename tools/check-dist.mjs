#!/usr/bin/env node
/**
 * Fail CI when a build output contains user artwork.
 *
 * Set CXD_ALLOW_PRIVATE_ASSETS=1 only for a private, never-published build.
 */

import { resolve } from 'node:path';
import { listPrivateAssets } from './private-assets.mjs';

const root = resolve(process.cwd());
const outputs = ['dist', 'dist-embed'];
const allow = process.env.CXD_ALLOW_PRIVATE_ASSETS === '1';
let failed = false;

for (const output of outputs) {
  const found = listPrivateAssets(resolve(root, output));
  if (!found.length) {
    console.log(`[nuvio] ${output}: clean`);
    continue;
  }
  if (allow) {
    console.warn(`[nuvio] ${output}: ${found.length} private asset(s) allowed by CXD_ALLOW_PRIVATE_ASSETS=1`);
    continue;
  }
  failed = true;
  console.error(`[nuvio] ${output}: private assets must not be published:`);
  for (const rel of found) console.error(`  - ${rel}`);
}

if (failed) {
  console.error(
    '\nRemove the files or rebuild with the normal build (private assets are stripped automatically).',
  );
  process.exit(1);
}
