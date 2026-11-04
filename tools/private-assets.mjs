/**
 * Private/user-supplied artwork must never end up in a published build.
 *
 * Vite copies `public/` into `dist/` as-is, and this project keeps the user's
 * wallpapers in `public/assets/`. A local build would therefore package the
 * artwork into a zip or a GitHub Release by accident. This module is shared by
 * the Vite build hook and the CI check so both use exactly the same rules.
 */

import { existsSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';

const PRIVATE_PATTERNS = [
  // Local shader-preview fixtures. They are extracted from a user's Wallpaper
  // Engine scene purely for development and must never reach a release build.
  /^__shader-preview__\//i,
  /^assets\/wallpaper\//i,
  /^assets\/library\//i,
  // `active.json` is a pointer at the user's current library entry. Shipping
  // it would make every fresh install try to load artwork that was stripped
  // from the archive, which shows up as a blank/fallback background.
  /^assets\/active\.json$/i,
  /^assets\/background\.(png|jpe?g|webp|avif|gif|mp4|webm|m4v|mov)$/i,
  /^assets\/model\.(glb|gltf|bin)$/i,
];

export function normalizeRelative(file) {
  return String(file)
    .split(sep)
    .join('/')
    .replace(/^\.\//, '')
    .replace(/^\/+/, '');
}

export function isPrivateAsset(file) {
  const normalized = normalizeRelative(file);
  return PRIVATE_PATTERNS.some((pattern) => pattern.test(normalized));
}

export function listPrivateAssets(dir) {
  if (!existsSync(dir)) return [];
  const found = [];

  const walk = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (!entry.isFile()) continue;
      const rel = normalizeRelative(relative(dir, full));
      if (isPrivateAsset(rel)) found.push(rel);
    }
  };

  walk(dir);
  return found.sort();
}

/**
 * Remove private assets from a build output directory. Returns the removed
 * relative paths so the build log can state exactly what was stripped.
 */
export function stripPrivateAssets(dir) {
  const root = resolve(dir);
  if (!existsSync(root)) return [];

  const removed = [];
  for (const rel of listPrivateAssets(root)) {
    const target = resolve(root, rel);
    const inside = relative(root, target);
    if (!inside || inside.startsWith('..') || inside.includes(`..${sep}`)) {
      throw new Error(`refusing to remove path outside build output: ${target}`);
    }
    rmSync(target, { force: true });
    removed.push(rel);
  }

  // Drop now-empty directories so the artifact listing stays clean.
  const prune = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const full = join(current, entry.name);
      prune(full);
      if (readdirSync(full).length === 0) rmSync(full, { recursive: true, force: true });
    }
  };
  prune(root);

  return removed;
}

export function outputLooksClean(dir) {
  return listPrivateAssets(dir).length === 0;
}

export function statIfExists(file) {
  try {
    return statSync(file);
  } catch {
    return null;
  }
}
