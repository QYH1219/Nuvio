#!/usr/bin/env node
/**
 * Find Wallpaper Engine wallpapers that are already downloaded on this machine.
 *
 * Read-only: it parses `steamapps/libraryfolders.vdf` for library roots, then
 * reads every `workshop/content/431960/<id>/project.json`. It never talks to
 * Steam and never downloads anything.
 *
 *   node tools/workshop-scan.mjs
 *   node tools/workshop-scan.mjs --json
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const WORKSHOP_APP_ID = '431960';
const CACHE_TTL_MS = 45_000;
const MAX_PROJECT_BYTES = 512 * 1024;
const CACHE_VERSION = 2;

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export function cacheFile() {
  const base = process.env.LOCALAPPDATA || process.env.XDG_CACHE_HOME || join(ROOT, '.cache');
  return join(base, 'codex-dynamic-bg', 'workshop-cache.json');
}

function isDir(path) {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

/** Windows paths are case-insensitive; "d:\\steam" and "D:\\Steam" are one library. */
function pathKey(path) {
  return process.platform === 'win32' ? path.toLowerCase() : path;
}

function regQuery(key, value) {
  if (process.platform !== 'win32') return null;
  try {
    const out = execFileSync('reg', ['query', key, '/v', value], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 4000,
    });
    const line = out.split(/\r?\n/).find((row) => row.includes(value) && /REG_SZ/i.test(row));
    if (!line) return null;
    const match = line.split(/REG_SZ/i);
    return match[1] ? match[1].trim() : null;
  } catch {
    return null;
  }
}

function defaultSteamPaths() {
  const paths = [];
  const push = (value) => {
    if (value && !paths.includes(value)) paths.push(value);
  };
  if (process.env.STEAM_PATH) push(resolve(process.env.STEAM_PATH));
  const programFiles = process.env.ProgramFiles || 'C:\\Program Files';
  const programFilesX86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
  push(join(programFiles, 'Steam'));
  push(join(programFilesX86, 'Steam'));
  for (const drive of ['C:', 'D:', 'E:', 'F:', 'G:']) {
    push(`${drive}\\Steam`);
    push(`${drive}\\SteamLibrary`);
  }
  return paths;
}

/** Best-effort list of Steam install roots (each contains a `steamapps` dir). */
export function steamRoots() {
  const roots = [];
  const seen = new Set();
  const push = (value) => {
    if (!value) return;
    const path = resolve(String(value).replace(/["']/g, '').replace(/\//g, '\\'));
    const key = pathKey(path);
    if (!seen.has(key) && existsSync(join(path, 'steamapps'))) {
      seen.add(key);
      roots.push(path);
    }
  };

  push(regQuery('HKCU\\Software\\Valve\\Steam', 'SteamPath'));
  push(regQuery('HKLM\\SOFTWARE\\WOW6432Node\\Valve\\Steam', 'InstallPath'));
  push(regQuery('HKLM\\SOFTWARE\\Valve\\Steam', 'InstallPath'));
  defaultSteamPaths().forEach(push);
  return roots;
}

/** Every Steam library folder (Steam lets a user spread games over drives). */
export function steamLibraries() {
  const libraries = [];
  const seen = new Set();
  const push = (value) => {
    if (!value) return;
    const path = resolve(String(value).replace(/\\/g, '\\'));
    const key = pathKey(path);
    if (!seen.has(key) && existsSync(join(path, 'steamapps'))) {
      seen.add(key);
      libraries.push(path);
    }
  };

  for (const root of steamRoots()) {
    push(root);
    const vdf = join(root, 'steamapps', 'libraryfolders.vdf');
    if (!existsSync(vdf)) continue;
    let text = '';
    try {
      text = readFileSync(vdf, 'utf8');
    } catch {
      continue;
    }
    for (const match of text.matchAll(/"path"\s+"([^"]+)"/gi)) {
      push(match[1].replace(/\\\\/g, '\\'));
    }
  }
  return libraries;
}

function readProject(dir) {
  const file = join(dir, 'project.json');
  try {
    const stat = statSync(file);
    if (stat.size > MAX_PROJECT_BYTES) return null;
    const data = JSON.parse(readFileSync(file, 'utf8'));
    if (!data || typeof data !== 'object') return null;
    const previewName = typeof data.preview === 'string' ? data.preview : '';
    const preview = previewName ? containedFile(dir, previewName) : null;
    return {
      file,
      mtimeMs: Math.round(stat.mtimeMs),
      title: typeof data.title === 'string' && data.title.trim() ? data.title.trim() : '',
      type: String(data.type || '').toLowerCase(),
      entry: typeof data.file === 'string' ? data.file : '',
      preview,
    };
  } catch {
    return null;
  }
}

/** Resolve `name` under `root`, refusing anything that escapes it. */
function containedFile(root, name) {
  if (!name || name.includes('\0')) return null;
  const base = resolve(root) + sep;
  const target = resolve(root, name);
  if (!target.startsWith(base)) return null;
  try {
    return statSync(target).isFile() ? target : null;
  } catch {
    return null;
  }
}

/**
 * @param {{ force?: boolean }} options
 * @returns {{ libraries: string[], entries: object[], cached: boolean, scannedAt: string }}
 */
export function scanWorkshop(options = {}) {
  const cache = options.force ? null : readCache();
  if (cache && Date.now() - Date.parse(cache.scannedAt) < CACHE_TTL_MS) {
    return { ...cache, cached: true };
  }

  const libraries = steamLibraries();
  const entries = [];
  const seenIds = new Set();

  for (const library of libraries) {
    const contentRoot = join(library, 'steamapps', 'workshop', 'content', WORKSHOP_APP_ID);
    if (!isDir(contentRoot)) continue;
    let names = [];
    try {
      names = readdirSync(contentRoot, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && /^\d{4,20}$/.test(entry.name))
        .map((entry) => entry.name);
    } catch {
      continue;
    }
    for (const id of names) {
      const dir = join(contentRoot, id);
      const project = readProject(dir);
      if (!project) continue;
      if (seenIds.has(id)) continue;
      seenIds.add(id);
      entries.push({
        id,
        dir,
        title: project.title || `Wallpaper ${id}`,
        type: project.type || 'unknown',
        entry: project.entry,
        preview: project.preview,
        mtimeMs: project.mtimeMs,
        library,
      });
    }
  }

  entries.sort((a, b) => a.title.localeCompare(b.title, 'zh-Hans-CN'));
  const result = {
    version: CACHE_VERSION,
    libraries,
    entries,
    cached: false,
    scannedAt: new Date().toISOString(),
  };
  writeCache(result);
  return result;
}

export function readCache() {
  try {
    const data = JSON.parse(readFileSync(cacheFile(), 'utf8'));
    if (!data || data.version !== CACHE_VERSION || !Array.isArray(data.entries) || !data.scannedAt) {
      return null;
    }
    return data;
  } catch {
    return null;
  }
}

function writeCache(result) {
  try {
    mkdirSync(dirname(cacheFile()), { recursive: true });
    // Cache absolute paths: it never leaves this machine and is only read back
    // by the same scanner.
    writeFileSync(cacheFile(), `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  } catch {
    /* cache is optional */
  }
}

/** Public shape: no absolute paths. */
export function publicEntry(entry) {
  return {
    id: entry.id,
    title: entry.title,
    type: entry.type,
    hasPreview: Boolean(entry.preview),
  };
}

/** Resolve an id against the scan result so arbitrary paths are rejected. */
export function findEntry(id, options = {}) {
  const { entries } = scanWorkshop(options);
  return entries.find((entry) => entry.id === String(id)) || null;
}

function main() {
  const json = process.argv.includes('--json');
  const result = scanWorkshop({ force: !process.argv.includes('--cached') });
  if (json) {
    console.log(JSON.stringify({ libraries: result.libraries, entries: result.entries.map(publicEntry) }, null, 2));
    return;
  }
  console.log(`[workshop] steam libraries: ${result.libraries.length}`);
  result.libraries.forEach((library) => console.log(`  - ${library}`));
  console.log(`[workshop] downloaded wallpapers: ${result.entries.length}`);
  result.entries.slice(0, 40).forEach((entry) => {
    console.log(`  ${entry.id}  ${entry.type.padEnd(8)} ${entry.title}`);
  });
  if (result.entries.length > 40) console.log(`  … ${result.entries.length - 40} more`);
  console.log(`[workshop] cache: ${cacheFile()}`);
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main();
}
