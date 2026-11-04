#!/usr/bin/env node
/**
 * Inspect a Wallpaper Engine wallpaper folder and import what this renderer can use.
 *
 * Usage:
 *   node tools/wallpaper.mjs "C:\...\steamapps\workshop\content\431960\123456789"
 *   node tools/wallpaper.mjs <folder> --out public/assets --name background
 *   node tools/wallpaper.mjs <folder> --dry-run
 */
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
} from 'node:fs';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const VIDEO_EXT = new Set(['.mp4', '.webm', '.m4v', '.mov']);

function usage() {
  console.log(`codex-dynamic-bg wallpaper importer

Usage:
  node tools/wallpaper.mjs <wallpaper-folder> [options]

Options:
  --out DIR        output directory (default: public/assets)
  --name NAME      base name for video output (default: background)
  --dry-run        inspect only, copy nothing
  --force          overwrite an existing target file
  -h, --help       show this help

Supported Wallpaper Engine project types:
  video    copied to <out>/<name>.mp4 (or .webm)
  web      copied to public/wallpaper/ for a compatibility pass
  scene    inspected; needs RePKG to unpack scene.pkg
`);
}

function parseArgs(argv) {
  const options = {
    source: '',
    out: join(ROOT, 'public', 'assets'),
    name: 'background',
    dryRun: false,
    force: false,
  };

  const queue = [...argv];
  while (queue.length) {
    const arg = queue.shift();
    if (arg === '--out') options.out = resolve(queue.shift() || options.out);
    else if (arg === '--name') options.name = queue.shift() || options.name;
    else if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--force') options.force = true;
    else if (arg === '--help' || arg === '-h') {
      usage();
      process.exit(0);
    } else if (!arg.startsWith('-') && !options.source) options.source = arg;
  }

  return options;
}

function findProjectFile(input) {
  const target = resolve(input);
  if (!existsSync(target)) throw new Error(`not found: ${target}`);
  if (statSync(target).isFile()) {
    if (basename(target).toLowerCase() === 'project.json') return target;
    throw new Error(`expected project.json or a wallpaper folder: ${target}`);
  }

  const direct = join(target, 'project.json');
  if (existsSync(direct)) return direct;

  // Steam sometimes nests the project one level down.
  for (const entry of readdirSync(target, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const nested = join(target, entry.name, 'project.json');
    if (existsSync(nested)) return nested;
  }
  throw new Error(`no project.json found under ${target}`);
}

function pickFile(dir, preferred, type) {
  const candidate = preferred ? join(dir, preferred) : null;
  if (candidate && existsSync(candidate) && statSync(candidate).isFile()) return candidate;

  const files = readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => join(dir, entry.name));

  if (type === 'video') return files.find((file) => VIDEO_EXT.has(extname(file).toLowerCase())) || null;
  if (type === 'web') return files.find((file) => /\.html?$/i.test(file)) || null;
  return candidate && existsSync(candidate) ? candidate : null;
}

function humanSize(bytes) {
  if (bytes > 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
  if (bytes > 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${Math.round(bytes / 1024)} KB`;
}

function importVideo(projectDir, project, options) {
  const file = pickFile(projectDir, project.file, 'video');
  if (!file) throw new Error('project type is "video" but no video file was found');

  const ext = extname(file).toLowerCase();
  const targetExt = ext === '.webm' ? '.webm' : '.mp4';
  const target = join(options.out, options.name + targetExt);
  const size = statSync(file).size;

  console.log(`[wallpaper] type:    video`);
  console.log(`[wallpaper] source:  ${file}`);
  console.log(`[wallpaper] size:    ${humanSize(size)}`);
  console.log(`[wallpaper] target:  ${target}`);

  if (options.dryRun) return { kind: 'video', target, copied: false };
  if (existsSync(target) && !options.force) {
    throw new Error(`target exists, use --force to overwrite: ${target}`);
  }

  mkdirSync(options.out, { recursive: true });
  copyFileSync(file, target);
  console.log('[wallpaper] copied. Restart the dev server or re-run the injector.');
  if (ext === '.webm') {
    console.log('[wallpaper] note: background.webm is checked after background.mp4.');
  }
  return { kind: 'video', target, copied: true };
}

function importWeb(projectDir, project, options) {
  const file = pickFile(projectDir, project.file, 'web');
  if (!file) throw new Error('project type is "web" but no HTML entry was found');

  const target = join(ROOT, 'public', 'wallpaper');
  console.log('[wallpaper] type:    web');
  console.log('[wallpaper] entry:   ' + file);
  console.log('[wallpaper] target:  ' + target);
  console.log('[wallpaper] note:    web wallpapers need a compatibility pass');
  console.log('[wallpaper]          (property listeners / wallpaperEngine API / audio).');

  if (options.dryRun) return { kind: 'web', target, copied: false };

  mkdirSync(target, { recursive: true });
  // Skip the huge preview/thumbnail files; keep the runtime entry and its assets.
  cpSync(projectDir, target, {
    recursive: true,
    force: options.force,
    filter: (source) => !/(^|[\\/])(preview|thumbnail)\.[a-z0-9]+$/i.test(source),
  });
  console.log('[wallpaper] copied. Open public/wallpaper/' + basename(file) + ' to inspect.');
  return { kind: 'web', target, copied: true };
}

function importScene(projectDir, project, options) {
  const pkg = project.file || 'scene.pkg';
  const pkgPath = join(projectDir, pkg);
  console.log('[wallpaper] type:    scene');
  console.log('[wallpaper] package: ' + pkgPath);

  if (!existsSync(pkgPath)) {
    throw new Error(`scene package missing: ${pkgPath}`);
  }

  console.log('[wallpaper] A scene wallpaper is a package of layers, materials and effects.');
  console.log('[wallpaper] Unpack it first (RePKG):');
  console.log(`[wallpaper]   repkg extract "${pkgPath}" -o "${join(projectDir, 'extracted')}"`);
  console.log('[wallpaper] Then hand over the extracted scene.json + textures, or ask for a rebuild.');
  console.log('[wallpaper] Full fidelity is not automatic; layers/effects need a manual Three.js port.');
  return { kind: 'scene', target: pkgPath, copied: false };
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (!options.source) {
    usage();
    process.exit(1);
  }

  const projectFile = findProjectFile(options.source);
  const projectDir = dirname(projectFile);
  const project = JSON.parse(readFileSync(projectFile, 'utf8'));
  const type = String(project.type || '').toLowerCase();

  console.log(`[wallpaper] project: ${project.title || basename(projectDir)}`);
  console.log(`[wallpaper] folder:  ${projectDir}`);

  if (type === 'video') importVideo(projectDir, project, options);
  else if (type === 'web') importWeb(projectDir, project, options);
  else if (type === 'scene') importScene(projectDir, project, options);
  else if (type === 'application') {
    console.log('[wallpaper] type: application');
    console.log('[wallpaper] Native application wallpapers cannot be embedded in a browser surface.');
    console.log('[wallpaper] Give me the preview video instead and it can be rebuilt as a video background.');
  } else {
    throw new Error(`unsupported project type: ${type || '(missing)'}`);
  }
}

try {
  main();
} catch (error) {
  console.error(`[wallpaper] ${error.message}`);
  process.exit(1);
}
