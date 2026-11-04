#!/usr/bin/env node
/**
 * Imported-wallpaper library.
 *
 *   public/assets/active.json          <- what the page should load
 *   public/assets/library/<id>/meta.json
 *   public/assets/library/<id>/background.mp4        (video)
 *   public/assets/library/<id>/wallpaper/scene.json  (scene)
 *
 * A library entry is only created from an id returned by the local workshop
 * scanner, never from a path supplied over HTTP.
 */
import { spawn } from 'node:child_process';
import {
  copyFileSync,
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { findEntry, publicEntry, scanWorkshop } from './workshop-scan.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const ASSETS_DIR = join(ROOT, 'public', 'assets');
export const LIBRARY_DIR = join(ASSETS_DIR, 'library');
export const ACTIVE_FILE = join(ASSETS_DIR, 'active.json');
export const LIBRARY_ID = /^\d{4,20}$/;
const IMPORT_TIMEOUT_MS = 180_000;

const jobs = new Map();

function readJson(file) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function contained(root, id) {
  if (!LIBRARY_ID.test(String(id))) return null;
  const base = resolve(root) + sep;
  const target = resolve(root, String(id));
  return target.startsWith(base) ? target : null;
}

export function entryDir(id) {
  return contained(LIBRARY_DIR, id);
}

export function readActive() {
  const data = readJson(ACTIVE_FILE);
  return data && data.entry ? data : null;
}

export function listLibrary() {
  if (!existsSync(LIBRARY_DIR)) return [];
  let names = [];
  try {
    names = readdirSync(LIBRARY_DIR, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && LIBRARY_ID.test(entry.name))
      .map((entry) => entry.name);
  } catch {
    return [];
  }
  const active = readActive();
  return names
    .map((id) => {
      const meta = readJson(join(LIBRARY_DIR, id, 'meta.json'));
      if (!meta) return null;
      return {
        id,
        title: meta.title || id,
        kind: meta.kind,
        entry: meta.entry,
        importedAt: meta.importedAt || null,
        active: active?.id === id,
      };
    })
    .filter(Boolean);
}

export function jobState(id) {
  return jobs.get(String(id)) || { state: 'idle', message: '' };
}

/**
 * Convert one downloaded wallpaper into `public/assets/library/<id>`.
 * Reuses `tools/wallpaper.mjs` in a child process so the conversion logic
 * (RePKG unpacking, effect extraction, video copying) lives in one place.
 */
export function importWorkshopEntry(id, options = {}) {
  const key = String(id);
  if (!LIBRARY_ID.test(key)) throw new Error('invalid workshop id');
  const running = jobs.get(key);
  if (running && running.state === 'running') return running;

  // Re-scan so a stale cache cannot smuggle in a removed folder.
  const entry = findEntry(key, { force: false });
  if (!entry) throw new Error('该壁纸不在本机已下载列表中');
  if (String(entry.type) === 'application') throw new Error('应用类壁纸无法嵌入，请提供预览视频');

  const target = entryDir(key);
  if (!target) throw new Error('invalid workshop id');

  // Web wallpapers are self-contained HTML folders. There is nothing to
  // transcode, so copy the directory and finish synchronously.
  if (String(entry.type) === 'web') {
    const job = { state: 'running', message: '正在复制网页壁纸…', startedAt: Date.now() };
    jobs.set(key, job);
    try {
      const meta = importWebEntry(entry, target);
      job.state = 'done';
      job.message = '导入完成';
      job.meta = meta;
    } catch (error) {
      job.state = 'error';
      job.message = error.message;
    }
    return job;
  }

  const job = { state: 'running', message: '准备导入…', startedAt: Date.now() };
  jobs.set(key, job);

  const child = spawn(
    process.execPath,
    [join(ROOT, 'tools', 'wallpaper.mjs'), entry.dir, '--out', target, '--name', 'background', '--force'],
    { cwd: ROOT, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] },
  );

  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    job.state = 'error';
    job.message = '导入超时（超过 3 分钟）';
    try {
      child.kill();
    } catch {
      /* ignore */
    }
  }, IMPORT_TIMEOUT_MS);
  timer.unref?.();

  const onLine = (line) => {
    const text = String(line || '').trim();
    if (!text) return;
    job.message = text.replace(/^\[wallpaper\]\s*/, '');
  };

  let stdout = '';
  child.stdout?.on('data', (chunk) => {
    stdout += chunk.toString();
    const lines = stdout.split(/\r?\n/);
    stdout = lines.pop() || '';
    lines.forEach(onLine);
  });
  let stderr = '';
  child.stderr?.on('data', (chunk) => {
    stderr += chunk.toString();
    const lines = stderr.split(/\r?\n/);
    stderr = lines.pop() || '';
    lines.forEach(onLine);
  });

  child.on('error', (error) => {
    clearTimeout(timer);
    job.state = 'error';
    job.message = error.message;
  });

  child.on('close', (code) => {
    clearTimeout(timer);
    if (timedOut) return;
    if (code !== 0) {
      job.state = 'error';
      job.message = job.message || `转换失败（exit ${code}）`;
      return;
    }
    try {
      const meta = finalizeImport(entry, target);
      job.state = 'done';
      job.message = '导入完成';
      job.meta = meta;
    } catch (error) {
      job.state = 'error';
      job.message = error.message;
    }
  });

  return job;
}

function finalizeImport(entry, target) {
  const scene = join(target, 'wallpaper', 'scene.json');
  let kind = null;
  let relative = null;
  if (existsSync(scene)) {
    kind = 'scene';
    relative = 'library/' + entry.id + '/wallpaper/scene.json';
  } else {
    for (const ext of ['.mp4', '.webm']) {
      const file = join(target, `background${ext}`);
      if (existsSync(file)) {
        kind = 'video';
        relative = `library/${entry.id}/background${ext}`;
        break;
      }
    }
  }
  if (!kind) throw new Error('转换完成但没有找到输出文件');

  const preview = copyPreview(entry, target);
  const meta = {
    id: entry.id,
    title: entry.title,
    sourceType: entry.type,
    kind,
    entry: relative,
    preview,
    importedAt: new Date().toISOString(),
    generator: 'codex-dynamic-bg/tools/library.mjs',
  };
  writeFileSync(join(target, 'meta.json'), `${JSON.stringify(meta, null, 2)}\n`, 'utf8');
  return meta;
}

/**
 * Copy a Wallpaper Engine `web` project into `library/<id>/web/`.
 *
 * The entry HTML is usually a single self-contained file with inline data
 * URIs, but we still copy every sibling asset so relative references keep
 * working. Paths are validated against the copied folder before the manifest
 * is written.
 */
export function importWebEntry(entry, target) {
  const source = entry.dir;
  if (!source || !existsSync(source)) throw new Error('网页壁纸目录不存在');
  const webDir = join(target, 'web');
  rmSync(target, { recursive: true, force: true });
  mkdirSync(webDir, { recursive: true });

  let copied = 0;
  let bytes = 0;
  cpSync(source, webDir, {
    recursive: true,
    dereference: false,
    filter: (src) => {
      try {
        const stat = lstatSync(src);
        if (stat.isSymbolicLink()) return false;
        if (stat.isFile()) {
          copied += 1;
          bytes += stat.size;
          // Refuse pathological workshop folders instead of filling the disk.
          if (copied > 4000 || bytes > 400 * 1024 * 1024) return false;
        }
        return true;
      } catch {
        return false;
      }
    },
  });

  const requested = normalize(String(entry.entry || 'index.html')).replace(/^([/\\])+/, '');
  const candidates = [requested, 'index.html'];
  let relative = null;
  for (const name of candidates) {
    if (!name || name.split(/[/\\]/).includes('..')) continue;
    const file = join(webDir, name);
    if (existsSync(file) && statSync(file).isFile()) {
      relative = name.split('\\').join('/');
      break;
    }
  }
  if (!relative) throw new Error('网页壁纸缺少入口 HTML');

  const preview = copyPreview(entry, target);
  const meta = {
    id: entry.id,
    title: entry.title,
    sourceType: 'web',
    kind: 'web',
    entry: `library/${entry.id}/web/${relative}`,
    preview,
    importedAt: new Date().toISOString(),
    generator: 'codex-dynamic-bg/tools/library.mjs',
  };
  writeFileSync(join(target, 'meta.json'), `${JSON.stringify(meta, null, 2)}\n`, 'utf8');
  return meta;
}

function copyPreview(entry, target) {
  if (!entry.preview || !existsSync(entry.preview)) return null;
  const ext = extname(entry.preview).toLowerCase() || '.jpg';
  const name = `preview${ext}`;
  try {
    copyFileSync(entry.preview, join(target, name));
    return name;
  } catch {
    return null;
  }
}

export function applyLibraryEntry(id) {
  const dir = entryDir(id);
  if (!dir) throw new Error('invalid workshop id');
  const meta = readJson(join(dir, 'meta.json'));
  if (!meta || !meta.entry) throw new Error('该壁纸还没有导入');
  const payload = {
    version: 1,
    id: meta.id,
    title: meta.title,
    kind: meta.kind,
    entry: meta.entry,
    appliedAt: new Date().toISOString(),
  };
  mkdirSync(ASSETS_DIR, { recursive: true });
  writeFileSync(ACTIVE_FILE, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  return payload;
}

export function deleteLibraryEntry(id) {
  const dir = entryDir(id);
  if (!dir) throw new Error('invalid workshop id');
  const active = readActive();
  if (active?.id === String(id)) {
    try {
      rmSync(ACTIVE_FILE, { force: true });
    } catch {
      /* ignore */
    }
  }
  rmSync(dir, { recursive: true, force: true });
  jobs.delete(String(id));
  return { removed: true, clearedActive: active?.id === String(id) };
}

/** Combined view for the settings panel. */
export function listWorkshop({ force = false } = {}) {
  const scan = scanWorkshop({ force });
  const library = listLibrary();
  const active = readActive();
  const imported = new Map(library.map((item) => [item.id, item]));
  const scannedIds = new Set();
  const entries = scan.entries.map((entry) => {
    scannedIds.add(entry.id);
    const local = imported.get(entry.id);
    return {
      ...publicEntry(entry),
      imported: Boolean(local),
      active: Boolean(active && active.id === entry.id),
      kind: local?.kind || null,
    };
  });
  // Keep imported wallpapers usable after the Steam copy disappears (uninstall,
  // moved library, offline drive). They are local files under public/assets.
  for (const item of library) {
    if (scannedIds.has(item.id)) continue;
    const meta = readJson(join(LIBRARY_DIR, item.id, 'meta.json'));
    const preview = meta?.preview ? join(LIBRARY_DIR, item.id, meta.preview) : null;
    entries.push({
      id: item.id,
      title: item.title || item.id,
      type: item.kind || 'unknown',
      hasPreview: Boolean(preview && existsSync(preview)),
      imported: true,
      active: Boolean(active && active.id === item.id),
      kind: item.kind || null,
      orphaned: true,
    });
  }
  return {
    dirs: scan.libraries,
    entries,
    cached: scan.cached,
    note: scan.entries.length
      ? ''
      : '未找到已下载的壁纸：先在 Wallpaper Engine 里订阅并下载。',
  };
}

function main() {
  const [command, arg] = process.argv.slice(2);
  if (!command || command === 'list') {
    const scan = scanWorkshop({ force: command === 'list' });
    console.log(`[library] steam libraries: ${scan.libraries.length}`);
    console.log(`[library] downloaded wallpapers: ${scan.entries.length}`);
    scan.entries.forEach((entry) => console.log(`  ${entry.id}  ${entry.type.padEnd(8)} ${entry.title}`));
    console.log('[library] imported:');
    listLibrary().forEach((item) => {
      console.log(`  ${item.id}  ${item.active ? '*' : ' '} ${item.kind.padEnd(6)} ${item.title}`);
    });
    return;
  }
  if (command === 'apply') {
    console.log(JSON.stringify(applyLibraryEntry(arg), null, 2));
    return;
  }
  if (command === 'delete') {
    console.log(JSON.stringify(deleteLibraryEntry(arg), null, 2));
    return;
  }
  if (command === 'import') {
    const job = importWorkshopEntry(arg);
    const tick = setInterval(() => {
      console.log(`[library] ${job.state}: ${job.message}`);
      if (job.state !== 'running') {
        clearInterval(tick);
        process.exitCode = job.state === 'done' ? 0 : 1;
      }
    }, 500);
    return;
  }
  console.log('usage: node tools/library.mjs [list|apply <id>|import <id>|delete <id>]');
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  try {
    main();
  } catch (error) {
    console.error(`[library] ${error.message}`);
    process.exit(1);
  }
}
