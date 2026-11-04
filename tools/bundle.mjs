#!/usr/bin/env node
/**
 * Portable wallpaper bundles: `.nuvio.zip`
 *
 *   npm run bundle -- export [--name 奶蛙] [--out file.nuvio.zip]
 *   npm run bundle -- import <file.nuvio.zip>
 *
 * A bundle carries the active artwork (scene folder or library entry), the
 * panel configuration, and a small manifest. Importing restores the files and,
 * when an injector is running, applies the config live and reloads the page.
 */
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, extname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createZip, readZip, writeZip } from './zip.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ASSETS = join(ROOT, 'public', 'assets');
const WALLPAPER = join(ASSETS, 'wallpaper');
const LIBRARY = join(ASSETS, 'library');
const ACTIVE_FILE = join(ASSETS, 'active.json');
const STATE_FILE = join(ROOT, '.cxd-inject.json');
const CONFIG_STORE = join(ROOT, '.nuvio', 'config.json');
const OUT_DIR = join(ROOT, 'exports');
const SCHEMA = 'nuvio.wallpaper/1';
const LIBRARY_ID = /^\d{4,20}$/;

const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));

function parseArgs(argv) {
  const options = { command: '', file: '', name: '', out: '', json: false, help: false };
  const rest = [...argv];
  while (rest.length) {
    const arg = rest.shift();
    if (arg === '--name') options.name = rest.shift() ?? '';
    else if (arg === '--out' || arg === '-o') options.out = rest.shift() ?? '';
    else if (arg === '--json') options.json = true;
    else if (arg === '--help' || arg === '-h') options.help = true;
    else if (!options.command) options.command = arg;
    else if (!options.file) options.file = arg;
    else throw new Error(`unexpected argument: ${arg}`);
  }
  return options;
}

function printHelp() {
  console.log(`
Nuvio bundle

Usage:
  npm run bundle -- export [--name 奶蛙] [--out exports/foo.nuvio.zip]
  npm run bundle -- import <file.nuvio.zip>

Exports the active wallpaper, its scene/mask files and the panel config into a
single .nuvio.zip. Import restores them into public/assets and applies the
config to the running Codex window when the injector is alive.
`);
}

function walk(dir, base = dir) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const item of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, item.name);
    if (item.isDirectory()) out.push(...walk(full, base));
    else if (item.isFile()) out.push({ full, rel: relative(base, full).replace(/\\/g, '/') });
  }
  return out;
}

function readJson(file) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function safeSegment(value) {
  return String(value)
    .replace(/[\\/:*?"<>|\s]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'wallpaper';
}

function timestamp() {
  const now = new Date();
  const pad = (value) => String(value).padStart(2, '0');
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(
    now.getHours(),
  )}${pad(now.getMinutes())}`;
}

async function readLiveConfig() {
  const state = readJson(STATE_FILE);
  if (!state?.controlPort) return null;
  try {
    const response = await fetch(`http://127.0.0.1:${state.controlPort}/config`, {
      headers: state.token ? { 'x-cxd-token': state.token } : {},
      signal: AbortSignal.timeout(2500),
    });
    if (!response.ok) return null;
    const payload = await response.json();
    return payload?.config || null;
  } catch {
    return null;
  }
}

async function applyLiveConfig(config) {
  if (!config) return { applied: false, reason: 'no config' };
  const state = readJson(STATE_FILE);
  if (!state?.controlPort) return { applied: false, reason: 'injector not running' };
  const headers = { 'content-type': 'application/json' };
  if (state.token) headers['x-cxd-token'] = state.token;
  try {
    const response = await fetch(`http://127.0.0.1:${state.controlPort}/config`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ config }),
      signal: AbortSignal.timeout(4000),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload.ok) {
      return { applied: false, reason: payload.error || `HTTP ${response.status}` };
    }
    await fetch(`http://127.0.0.1:${state.controlPort}/reload`, {
      method: 'POST',
      headers,
      body: '{}',
      signal: AbortSignal.timeout(4000),
    }).catch(() => {});
    return { applied: true };
  } catch (error) {
    return { applied: false, reason: error.message };
  }
}

function detectEntry() {
  const scene = join(WALLPAPER, 'scene.json');
  if (existsSync(scene)) {
    const data = readJson(scene);
    return { kind: 'wallpaper', dir: WALLPAPER, prefix: 'wallpaper', meta: data };
  }
  const active = readJson(ACTIVE_FILE);
  if (active?.entry && LIBRARY_ID.test(String(active.id))) {
    const dir = join(LIBRARY, String(active.id));
    if (existsSync(dir)) {
      return {
        kind: 'library',
        id: String(active.id),
        dir,
        prefix: `library/${active.id}`,
        meta: active,
      };
    }
  }
  return null;
}

async function exportBundle(options) {
  const entry = detectEntry();
  if (!entry) {
    throw new Error('没有可导出的壁纸：public/assets/wallpaper 为空，active.json 也不指向已导入条目');
  }

  const files = walk(entry.dir);
  if (!files.length) throw new Error(`壁纸目录为空: ${entry.dir}`);

  const config =
    (await readLiveConfig()) ||
    readJson(CONFIG_STORE) ||
    null;

  const fallbackName = entry.kind === 'wallpaper'
    ? entry.meta?.name || entry.meta?.title || 'wallpaper'
    : entry.meta?.title || entry.id;
  const name = options.name || fallbackName;
  const manifest = {
    schema: SCHEMA,
    name,
    createdAt: new Date().toISOString(),
    app: { name: pkg.name, version: pkg.version },
    entry: {
      kind: entry.kind === 'wallpaper' ? 'scene' : 'library',
      prefix: entry.prefix,
      id: entry.id || null,
    },
    config,
    files: files.map((file) => ({
      path: `${entry.prefix}/${file.rel}`,
      size: statSync(file.full).size,
    })),
  };

  const zipEntries = [
    { name: 'manifest.json', data: `${JSON.stringify(manifest, null, 2)}\n` },
    ...files.map((file) => ({
      name: `${entry.prefix}/${file.rel}`,
      data: readFileSync(file.full),
      // Photos and PNGs are already compressed; storing them is faster.
      store: ['.jpg', '.jpeg', '.png', '.webp', '.avif', '.mp4', '.webm'].includes(
        extname(file.rel).toLowerCase(),
      ),
    })),
  ];

  mkdirSync(OUT_DIR, { recursive: true });
  const out = resolve(
    options.out || join(OUT_DIR, `nuvio-${safeSegment(name)}-${timestamp()}.nuvio.zip`),
  );
  writeZip(out, zipEntries);

  const total = zipEntries.reduce((sum, item) => sum + Buffer.byteLength(item.data), 0);
  console.log(`[nuvio] bundled ${files.length} file(s) · ${(total / 1024).toFixed(1)} KB`);
  console.log(`[nuvio] bundle: ${out}`);
  if (config) console.log('[nuvio] config included');
  return out;
}

function assertSafePath(name) {
  const normalized = String(name).replace(/\\/g, '/');
  if (normalized.startsWith('/') || normalized.includes('../') || /^[a-zA-Z]:/.test(normalized)) {
    throw new Error(`unsafe path in bundle: ${name}`);
  }
  return normalized;
}

async function importBundle(options) {
  if (!options.file) throw new Error('usage: npm run bundle -- import <file.nuvio.zip>');
  const file = resolve(options.file);
  if (!existsSync(file)) throw new Error(`bundle not found: ${file}`);

  const entries = readZip(file);
  const manifestEntry = entries.find((entry) => entry.name === 'manifest.json');
  if (!manifestEntry) throw new Error('bundle 缺少 manifest.json');
  const manifest = JSON.parse(manifestEntry.data.toString('utf8'));
  if (manifest.schema !== SCHEMA) {
    throw new Error(`unsupported bundle schema: ${manifest.schema || 'missing'}`);
  }

  const kind = manifest.entry?.kind;
  let restored = 0;
  if (kind === 'scene') {
    rmSync(WALLPAPER, { recursive: true, force: true });
    mkdirSync(WALLPAPER, { recursive: true });
    for (const entry of entries) {
      const name = assertSafePath(entry.name);
      if (!name.startsWith('wallpaper/')) continue;
      const target = join(ASSETS, name);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, entry.data);
      restored += 1;
    }
    rmSync(ACTIVE_FILE, { force: true });
  } else if (kind === 'library') {
    const id = String(manifest.entry.id || '');
    if (!LIBRARY_ID.test(id)) throw new Error(`invalid library id: ${id}`);
    const dir = join(LIBRARY, id);
    rmSync(dir, { recursive: true, force: true });
    for (const entry of entries) {
      const name = assertSafePath(entry.name);
      if (!name.startsWith(`library/${id}/`)) continue;
      const target = join(ASSETS, name);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, entry.data);
      restored += 1;
    }
    const meta = readJson(join(dir, 'meta.json'));
    if (!meta?.entry) throw new Error('library bundle 缺少 meta.json 或 entry 字段');
    const payload = {
      version: 1,
      id,
      title: meta.title || manifest.name || id,
      kind: meta.kind,
      entry: meta.entry,
      appliedAt: new Date().toISOString(),
    };
    writeFileSync(ACTIVE_FILE, `${JSON.stringify(payload, null, 2)}\n`);
  } else {
    throw new Error(`unknown bundle entry kind: ${kind}`);
  }

  if (!restored) throw new Error('bundle 里没有可恢复的壁纸文件');

  if (manifest.config) {
    mkdirSync(dirname(CONFIG_STORE), { recursive: true });
    writeFileSync(CONFIG_STORE, `${JSON.stringify(manifest.config, null, 2)}\n`);
  }

  const live = await applyLiveConfig(manifest.config);
  console.log(`[nuvio] restored ${restored} file(s) · ${kind} · ${manifest.name || '(unnamed)'}`);
  console.log(`[nuvio] assets: ${kind === 'scene' ? WALLPAPER : join(LIBRARY, manifest.entry.id)}`);
  if (live.applied) console.log('[nuvio] config applied live; page reloaded');
  else if (manifest.config) console.log(`[nuvio] config saved to .nuvio/config.json (${live.reason})`);
  console.log('[nuvio] next: npm start -- --force');
  return file;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help || !options.command) {
    printHelp();
    if (!options.command) process.exitCode = options.help ? 0 : 1;
    return;
  }
  if (options.command === 'export') {
    const file = await exportBundle(options);
    if (options.json) console.log(JSON.stringify({ ok: true, file }));
    return;
  }
  if (options.command === 'import') {
    const file = await importBundle(options);
    if (options.json) console.log(JSON.stringify({ ok: true, file }));
    return;
  }
  throw new Error(`unknown command: ${options.command}`);
}

main().catch((error) => {
  console.error(`[nuvio] bundle failed: ${error.message}`);
  process.exitCode = 1;
});
