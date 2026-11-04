#!/usr/bin/env node
/**
 * One-shot asset installer: point it at a picture, a video, a GLB, a Wallpaper
 * Engine folder, or an already-unpacked scene directory. It normalizes the file
 * names that the runtime probes and removes the higher-priority entries that
 * would otherwise hide what you just installed.
 *
 *   npm run use -- "C:\Pictures\foo.png"
 *   npm run use -- "D:\steam\...\431960\3806385218"
 *   npm run use -- --scene "C:\Temp\cxd-scene-3806385218"
 *   npm run use -- --clear
 */
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ASSETS = join(ROOT, 'public', 'assets');
const WALLPAPER = join(ASSETS, 'wallpaper');

const IMAGE_EXTS = ['.png', '.jpg', '.jpeg', '.webp', '.avif'];
const VIDEO_EXTS = ['.mp4', '.webm'];
const MODEL_EXTS = ['.glb', '.gltf'];

const IMAGE_TARGETS = IMAGE_EXTS.map((ext) => join(ASSETS, `background${ext}`));
const VIDEO_TARGETS = VIDEO_EXTS.map((ext) => join(ASSETS, `background${ext}`));
const MODEL_TARGETS = MODEL_EXTS.map((ext) => join(ASSETS, `model${ext}`));

function parseArgs(argv) {
  const options = {
    source: '',
    scene: '',
    clear: false,
    dryRun: false,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = () => {
      index += 1;
      if (index >= argv.length) throw new Error(`missing value for ${arg}`);
      return argv[index];
    };
    if (arg === '--clear') options.clear = true;
    else if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--scene') options.scene = next();
    else if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg.startsWith('-')) throw new Error(`unknown option: ${arg}`);
    else if (!options.source) options.source = arg;
    else throw new Error(`unexpected argument: ${arg}`);
  }
  return options;
}

function printHelp() {
  console.log(`
codex-dynamic-bg asset installer

Usage:
  npm run use -- <file-or-folder> [options]
  npm run use -- --clear

Accepts:
  image     .png .jpg .jpeg .webp .avif        -> public/assets/background.<ext>
  video     .mp4 .webm (or .mov when ffmpeg)    -> public/assets/background.<ext>
  model     .glb .gltf                          -> public/assets/model.<ext>
  folder    Wallpaper Engine project folder     -> tools/wallpaper.mjs
  folder    unpacked scene directory            -> public/assets/wallpaper/
  folder    folder with a single asset          -> installed by type

Options:
  --scene DIR   treat DIR as an unpacked scene directory
  --clear       remove the current background (image / video / scene)
  --dry-run     print the plan without touching files
  -h, --help    show this help
`);
}

function log(message) {
  console.log(`[use] ${message}`);
}

function samePath(a, b) {
  const normalize = (value) => resolve(value).replace(/[\\/]+$/, '');
  if (process.platform === 'win32') {
    return normalize(a).toLowerCase() === normalize(b).toLowerCase();
  }
  return normalize(a) === normalize(b);
}

function remove(target, dryRun) {
  if (!existsSync(target)) return;
  if (dryRun) {
    log(`would remove ${target}`);
    return;
  }
  rmSync(target, { recursive: true, force: true });
  log(`removed ${target}`);
}

function removeAll(targets, dryRun) {
  targets.forEach((target) => remove(target, dryRun));
}

function clearBackground(dryRun) {
  removeAll([...IMAGE_TARGETS, ...VIDEO_TARGETS], dryRun);
  remove(WALLPAPER, dryRun);
  log('background cleared; models are untouched');
}

function copyInto(source, target, dryRun) {
  if (dryRun) {
    log(`would copy ${source} -> ${target}`);
    return;
  }
  mkdirSync(dirname(target), { recursive: true });
  copyFileSync(source, target);
  log(`${basename(source)} -> ${target.replace(ROOT + '\\', '').replace(ROOT + '/', '')}`);
}

function installImage(source, dryRun) {
  const ext = extname(source).toLowerCase();
  if (!IMAGE_EXTS.includes(ext)) throw new Error(`unsupported image: ${ext}`);
  // Video and scene outrank a still image in the probe order, so drop them.
  removeAll([...VIDEO_TARGETS], dryRun);
  remove(WALLPAPER, dryRun);
  removeAll(IMAGE_TARGETS, dryRun);
  copyInto(source, join(ASSETS, `background${ext}`), dryRun);
  log('image background installed');
}

function installVideo(source, dryRun) {
  const ext = extname(source).toLowerCase();
  const isMov = ext === '.mov';
  const targetExt = isMov ? '.mp4' : ext;
  if (!VIDEO_EXTS.includes(targetExt)) throw new Error(`unsupported video: ${ext}`);

  removeAll([...IMAGE_TARGETS], dryRun);
  remove(WALLPAPER, dryRun);
  removeAll(VIDEO_TARGETS, dryRun);

  if (isMov) {
    const probe = spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' });
    if (probe.status !== 0) {
      throw new Error('ffmpeg is required to convert .mov; install ffmpeg or export mp4/webm first');
    }
    const target = join(ASSETS, 'background.mp4');
    if (dryRun) {
      log(`would transcode ${source} -> ${target}`);
      return;
    }
    mkdirSync(ASSETS, { recursive: true });
    const run = spawnSync(
      'ffmpeg',
      ['-y', '-i', source, '-an', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', target],
      { stdio: 'inherit' },
    );
    if (run.status !== 0) throw new Error('ffmpeg transcode failed');
    log('video background installed (transcoded from .mov)');
    return;
  }

  copyInto(source, join(ASSETS, `background${targetExt}`), dryRun);
  log('video background installed');
}

function installModel(source, dryRun) {
  const ext = extname(source).toLowerCase();
  if (!MODEL_EXTS.includes(ext)) throw new Error(`unsupported model: ${ext}`);
  removeAll(MODEL_TARGETS, dryRun);
  copyInto(source, join(ASSETS, `model${ext}`), dryRun);
  log('model installed');
}

function installSceneDir(source, dryRun) {
  const files = readdirSync(source, { withFileTypes: true }).filter((entry) => entry.isFile());
  if (!files.some((entry) => entry.name === 'scene.json')) {
    throw new Error(`scene directory has no scene.json: ${source}`);
  }
  if (samePath(source, WALLPAPER)) {
    log('scene wallpaper is already installed; nothing to copy');
    return;
  }
  removeAll([...IMAGE_TARGETS, ...VIDEO_TARGETS], dryRun);
  remove(WALLPAPER, dryRun);
  if (dryRun) {
    log(`would copy ${files.length} files -> ${WALLPAPER}`);
    return;
  }
  // Stage first so a failed copy never destroys the wallpaper that is already
  // working, and so `--scene <public/assets/wallpaper>` cannot self-delete.
  const stage = mkdtempSync(join(tmpdir(), 'cxd-scene-'));
  try {
    files.forEach((entry) => copyFileSync(join(source, entry.name), join(stage, entry.name)));
    mkdirSync(WALLPAPER, { recursive: true });
    readdirSync(stage).forEach((name) => copyFileSync(join(stage, name), join(WALLPAPER, name)));
  } finally {
    rmSync(stage, { recursive: true, force: true });
  }
  log(`scene wallpaper installed (${files.length} files)`);
}

function runWallpaperImporter(source, asScene = false) {
  const args = [join(ROOT, 'tools', 'wallpaper.mjs')];
  if (asScene) args.push('--scene', source);
  else args.push(source);
  log('detected a Wallpaper Engine project; handing off to tools/wallpaper.mjs');
  const run = spawnSync(process.execPath, args, { stdio: 'inherit' });
  if (run.status !== 0) throw new Error('wallpaper importer failed');
}

/** True when scene.json is our normalized manifest rather than a raw WE scene. */
function isNormalizedScene(sceneJsonPath) {
  try {
    const data = JSON.parse(readFileSync(sceneJsonPath, 'utf8'));
    return Boolean(data && typeof data.image === 'string');
  } catch {
    return false;
  }
}

function installFromDirectory(source, options) {
  if (existsSync(join(source, 'project.json')) || existsSync(join(source, 'scene.pkg'))) {
    runWallpaperImporter(source);
    return;
  }
  if (existsSync(join(source, 'scene.json'))) {
    if (isNormalizedScene(join(source, 'scene.json'))) {
      installSceneDir(source, options.dryRun);
    } else {
      // Raw Wallpaper Engine scene dump: normalize it first.
      runWallpaperImporter(source, true);
    }
    return;
  }
  const entries = readdirSync(source, { withFileTypes: true }).filter((entry) => entry.isFile());
  const assets = entries.filter((entry) => {
    const ext = extname(entry.name).toLowerCase();
    return IMAGE_EXTS.includes(ext) || VIDEO_EXTS.includes(ext) || MODEL_EXTS.includes(ext);
  });
  if (assets.length === 1) {
    installFile(join(source, assets[0].name), options);
    return;
  }
  throw new Error(
    `cannot classify directory: ${source}\n` +
      `expected project.json / scene.pkg / scene.json, or exactly one image/video/model file`,
  );
}

function installFile(source, options) {
  const ext = extname(source).toLowerCase();
  if (IMAGE_EXTS.includes(ext)) return installImage(source, options.dryRun);
  if (VIDEO_EXTS.includes(ext) || ext === '.mov') return installVideo(source, options.dryRun);
  if (MODEL_EXTS.includes(ext)) return installModel(source, options.dryRun);
  throw new Error(`unsupported file type: ${ext || '(none)'}`);
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }
  if (options.clear) {
    clearBackground(options.dryRun);
    return;
  }
  if (options.scene) {
    const sceneDir = resolve(options.scene);
    if (!existsSync(sceneDir) || !statSync(sceneDir).isDirectory()) {
      throw new Error(`scene directory not found: ${sceneDir}`);
    }
    if (isNormalizedScene(join(sceneDir, 'scene.json'))) {
      installSceneDir(sceneDir, options.dryRun);
    } else {
      runWallpaperImporter(sceneDir, true);
    }
    return;
  }
  if (!options.source) {
    printHelp();
    throw new Error('no source given');
  }
  const source = resolve(options.source);
  if (!existsSync(source)) throw new Error(`not found: ${source}`);

  const stat = statSync(source);
  if (stat.isDirectory()) installFromDirectory(source, options);
  else installFile(source, options);

  log('done. next: npm run embed && npm run inject');
}

try {
  main();
} catch (error) {
  console.error(`[use] ${error.message}`);
  process.exit(1);
}
