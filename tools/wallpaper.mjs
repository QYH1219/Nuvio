#!/usr/bin/env node
/**
 * Import a Wallpaper Engine wallpaper into Nuvio.
 *
 *   node tools/wallpaper.mjs --current
 *   node tools/wallpaper.mjs "D:\steam\steamapps\workshop\content\431960\3806385218"
 *   node tools/wallpaper.mjs 3806385218 --dry-run
 *
 * video  -> public/assets/background.mp4|webm
 * web    -> public/wallpaper/
 * scene  -> RePKG unpack, then public/assets/wallpaper/{scene.json,artwork,masks}
 *
 * The scene importer understands the two effect shaders used by most
 * illustrated scene wallpapers: `shake` (flow-map UV shake) and
 * `foliagesway` (UV mode). Other effects are reported and skipped.
 */
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { execFileSync } from 'node:child_process';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { homedir, tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const VIDEO_EXT = new Set(['.mp4', '.webm', '.m4v', '.mov']);
const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp']);
const WORKSHOP_APP_ID = '431960';

function usage() {
  console.log(`Nuvio wallpaper importer

Usage:
  node tools/wallpaper.mjs --current
  node tools/wallpaper.mjs <wallpaper-folder | workshop-id> [options]
  node tools/wallpaper.mjs --scene <unpacked-scene-folder> [options]

Options:
  --current        import the wallpaper currently selected in Wallpaper Engine
  --scene DIR      use an already unpacked scene folder (no RePKG needed)
  --out DIR        output directory (default: public/assets)
  --name NAME      base name for video output (default: background)
  --repkg PATH     path to RePKG.exe (auto-detected from %TEMP%\\repkg)
  --dry-run        inspect only, copy nothing
  --force          re-extract and overwrite existing output
  -h, --help       show this help

Supported project types:
  video    copied to <out>/<name>.mp4 (or .webm)
  web      copied to public/wallpaper/ for a compatibility pass
  scene    unpacked and converted to <out>/wallpaper/scene.json
`);
}

function parseArgs(argv) {
  const options = {
    source: '',
    sceneDir: '',
    out: join(ROOT, 'public', 'assets'),
    name: 'background',
    current: false,
    dryRun: false,
    force: false,
    repkg: '',
  };

  const queue = [...argv];
  while (queue.length) {
    const arg = queue.shift();
    if (arg === '--out') options.out = resolve(queue.shift() || options.out);
    else if (arg === '--name') options.name = queue.shift() || options.name;
    else if (arg === '--scene') options.sceneDir = resolve(queue.shift() || '');
    else if (arg === '--repkg') options.repkg = resolve(queue.shift() || '');
    else if (arg === '--current') options.current = true;
    else if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--force') options.force = true;
    else if (arg === '--help' || arg === '-h') {
      usage();
      process.exit(0);
    } else if (!arg.startsWith('-') && !options.source) options.source = arg;
  }

  return options;
}

function humanSize(bytes) {
  if (bytes > 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
  if (bytes > 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${Math.round(bytes / 1024)} KB`;
}

function readJson(file) {
  return JSON.parse(readFileSync(file, 'utf8'));
}

function num(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function pair(value, fallback) {
  if (Array.isArray(value) && value.length >= 2) {
    return [num(value[0], fallback[0]), num(value[1], fallback[1])];
  }
  if (typeof value === 'string') {
    const parts = value.trim().split(/\s+/).map(Number);
    if (parts.length >= 2 && parts.every(Number.isFinite)) return [parts[0], parts[1]];
  }
  return [...fallback];
}

function isDir(path) {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function isFile(path) {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------ */
/* Wallpaper Engine discovery                                          */
/* ------------------------------------------------------------------ */

function steamRoots() {
  const roots = [];
  const push = (value) => {
    if (value && !roots.includes(value)) roots.push(value);
  };

  if (process.env.WALLPAPER_ENGINE) push(resolve(process.env.WALLPAPER_ENGINE));
  push(join(process.env.ProgramFiles || 'C:\\Program Files', 'Steam', 'steamapps', 'common', 'wallpaper_engine'));
  push(
    join(
      process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)',
      'Steam',
      'steamapps',
      'common',
      'wallpaper_engine',
    ),
  );
  for (const drive of ['C:', 'D:', 'E:', 'F:', 'G:']) {
    push(`${drive}\\steam\\steamapps\\common\\wallpaper_engine`);
    push(`${drive}\\SteamLibrary\\steamapps\\common\\wallpaper_engine`);
  }
  return roots.filter((root) => isFile(join(root, 'config.json')));
}

function currentWallpaperFolder() {
  for (const root of steamRoots()) {
    let config;
    try {
      config = readJson(join(root, 'config.json'));
    } catch {
      continue;
    }
    for (const [key, monitorConfig] of Object.entries(config || {})) {
      if (key.startsWith('?')) continue;
      const selected = monitorConfig?.general?.wallpaperconfig?.selectedwallpapers || {};
      for (const entry of Object.values(selected)) {
        const file = entry?.file;
        if (typeof file === 'string' && file.length > 2) {
          return dirname(file);
        }
      }
    }
  }
  return null;
}

function workshopFolder(id) {
  const candidates = [];
  for (const root of steamRoots()) {
    const steamapps = dirname(dirname(root)); // .../steamapps
    candidates.push(join(steamapps, 'workshop', 'content', WORKSHOP_APP_ID, id));
  }
  for (const drive of ['C:', 'D:', 'E:', 'F:', 'G:']) {
    candidates.push(`${drive}\\steam\\steamapps\\workshop\\content\\${WORKSHOP_APP_ID}\\${id}`);
    candidates.push(`${drive}\\SteamLibrary\\steamapps\\workshop\\content\\${WORKSHOP_APP_ID}\\${id}`);
  }
  return candidates.find(isDir) || null;
}

function resolveSource(options) {
  if (options.sceneDir) return { sceneDir: options.sceneDir };
  if (options.current) {
    const folder = currentWallpaperFolder();
    if (!folder) {
      throw new Error('could not find the current Wallpaper Engine wallpaper; pass a folder instead');
    }
    return { projectDir: folder };
  }
  if (!options.source) throw new Error('missing wallpaper folder, workshop id, --scene, or --current');

  if (/^\d{6,}$/.test(options.source)) {
    const folder = workshopFolder(options.source);
    if (!folder) throw new Error(`workshop wallpaper ${options.source} was not found in a Steam library`);
    return { projectDir: folder };
  }

  const target = resolve(options.source);
  if (!existsSync(target)) throw new Error(`not found: ${target}`);
  if (isFile(target)) {
    if (basename(target).toLowerCase() === 'project.json') return { projectDir: dirname(target) };
    throw new Error(`expected project.json or a wallpaper folder: ${target}`);
  }
  return { projectDir: target };
}

function findProjectFile(dir) {
  const direct = join(dir, 'project.json');
  if (isFile(direct)) return direct;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const nested = join(dir, entry.name, 'project.json');
    if (isFile(nested)) return nested;
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Scene extraction                                                    */
/* ------------------------------------------------------------------ */

function findRepkg(options) {
  const candidates = [
    options.repkg,
    process.env.REPKG_PATH,
    join(tmpdir(), 'repkg', 'bin', 'RePKG.exe'),
    join(tmpdir(), 'repkg', 'RePKG.exe'),
    join(ROOT, 'tools', 'repkg', 'RePKG.exe'),
    join(homedir(), 'repkg', 'RePKG.exe'),
  ].filter(Boolean);
  return candidates.find(isFile) || null;
}

function walkForScene(dir, depth = 0) {
  if (depth > 3) return null;
  const direct = join(dir, 'scene.json');
  if (isFile(direct)) return direct;
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return null;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (entry.name === 'preview' || entry.name === 'thumbnail') continue;
    const found = walkForScene(join(dir, entry.name), depth + 1);
    if (found) return found;
  }
  return null;
}

function findSceneJson(dir) {
  if (isFile(join(dir, 'scene.json'))) return join(dir, 'scene.json');
  if (isFile(join(dir, 'extracted', 'scene.json'))) return join(dir, 'extracted', 'scene.json');
  return walkForScene(dir);
}

function extractScene(projectDir, project, options) {
  const direct = findSceneJson(projectDir);
  if (direct) {
    console.log('[wallpaper] scene:   already unpacked');
    return dirname(direct);
  }

  const pkgRel = project?.file || 'scene.pkg';
  let pkgPath = join(projectDir, pkgRel);
  if (!isFile(pkgPath)) {
    const found = readdirSync(projectDir)
      .filter((name) => name.toLowerCase().endsWith('.pkg'))
      .map((name) => join(projectDir, name))[0];
    if (found) pkgPath = found;
  }
  if (!isFile(pkgPath)) throw new Error(`scene package missing: ${pkgPath}`);

  const localExtract = join(projectDir, 'extracted');
  const outDir = join(tmpdir(), 'cxd-scene-' + basename(projectDir));
  const cached = findSceneJson(outDir) || findSceneJson(localExtract);
  if (cached && !options.force) {
    console.log('[wallpaper] scene:   reusing ' + dirname(cached));
    return dirname(cached);
  }

  const repkg = findRepkg(options);
  if (!repkg) {
    throw new Error(
      'RePKG not found. Download RePKG.exe from https://github.com/notscuffed/repkg/releases ' +
        'and pass --repkg "C:\\path\\RePKG.exe", or unpack the .pkg manually and use --scene <dir>',
    );
  }

  console.log('[wallpaper] repkg:   ' + repkg);
  console.log('[wallpaper] unpack:  ' + pkgPath);
  console.log('[wallpaper] target:  ' + outDir);
  if (options.dryRun) return null;

  mkdirSync(outDir, { recursive: true });
  execFileSync(repkg, ['extract', pkgPath, '-o', outDir], { stdio: 'inherit' });

  const sceneJson = findSceneJson(outDir);
  if (!sceneJson) throw new Error('RePKG finished but no scene.json was found');
  return dirname(sceneJson);
}

/* ------------------------------------------------------------------ */
/* Texture lookup                                                      */
/* ------------------------------------------------------------------ */

function findTexture(materialsRoot, ref) {
  if (!ref) return null;
  const clean = String(ref).replace(/\\/g, '/');
  const ext = extname(clean).toLowerCase();
  const withoutExt = IMAGE_EXT.has(ext) ? clean.slice(0, -ext.length) : clean;
  const candidates = [];
  for (const imageExt of IMAGE_EXT) candidates.push(join(materialsRoot, withoutExt + imageExt));
  for (const imageExt of IMAGE_EXT) {
    candidates.push(join(materialsRoot, clean.replace(/^materials[\\/]/, '') + imageExt));
  }
  const direct = candidates.find(isFile);
  if (direct) return direct;

  const wanted = basename(withoutExt).toLowerCase();
  const queue = [materialsRoot];
  while (queue.length) {
    const dir = queue.shift();
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        queue.push(full);
        continue;
      }
      if (!IMAGE_EXT.has(extname(entry.name).toLowerCase())) continue;
      if (basename(entry.name, extname(entry.name)).toLowerCase() === wanted) return full;
    }
  }
  return null;
}

function imageSize(file) {
  const buf = readFileSync(file);
  if (buf.length > 24 && buf.toString('ascii', 1, 4) === 'PNG') {
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  }
  if (buf.length > 4 && buf[0] === 0xff && buf[1] === 0xd8) {
    let offset = 2;
    while (offset + 9 < buf.length) {
      if (buf[offset] !== 0xff) {
        offset += 1;
        continue;
      }
      const marker = buf[offset + 1];
      if (marker === 0xd8 || marker === 0xd9 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
        offset += 2;
        continue;
      }
      const length = buf.readUInt16BE(offset + 2);
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { height: buf.readUInt16BE(offset + 5), width: buf.readUInt16BE(offset + 7) };
      }
      offset += 2 + length;
    }
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Importers                                                           */
/* ------------------------------------------------------------------ */

function importVideo(projectDir, project, options) {
  const files = readdirSync(projectDir, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => join(projectDir, entry.name));
  const file =
    (project.file && isFile(join(projectDir, project.file)) ? join(projectDir, project.file) : null) ||
    files.find((path) => VIDEO_EXT.has(extname(path).toLowerCase()));
  if (!file) throw new Error('project type is "video" but no video file was found');

  const ext = extname(file).toLowerCase();
  const target = join(options.out, options.name + (ext === '.webm' ? '.webm' : '.mp4'));
  console.log('[wallpaper] type:    video');
  console.log('[wallpaper] source:  ' + file);
  console.log('[wallpaper] size:    ' + humanSize(statSync(file).size));
  console.log('[wallpaper] target:  ' + target);

  if (options.dryRun) return { kind: 'video', target, copied: false };
  if (existsSync(target) && !options.force) {
    throw new Error(`target exists, use --force to overwrite: ${target}`);
  }

  mkdirSync(options.out, { recursive: true });
  copyFileSync(file, target);
  console.log('[wallpaper] copied. Restart the dev server or re-run the injector.');
  return { kind: 'video', target, copied: true };
}

function importWeb(projectDir, project, options) {
  const entry =
    (project.file && isFile(join(projectDir, project.file)) ? join(projectDir, project.file) : null) ||
    readdirSync(projectDir)
      .filter((name) => /\.html?$/i.test(name))
      .map((name) => join(projectDir, name))[0];
  if (!entry) throw new Error('project type is "web" but no HTML entry was found');

  const target = join(ROOT, 'public', 'wallpaper');
  console.log('[wallpaper] type:    web');
  console.log('[wallpaper] entry:   ' + entry);
  console.log('[wallpaper] target:  ' + target);
  console.log('[wallpaper] note:    web wallpapers need a compatibility pass');
  console.log('[wallpaper]          (property listeners / wallpaperEngine API / audio).');

  if (options.dryRun) return { kind: 'web', target, copied: false };

  mkdirSync(target, { recursive: true });
  cpSync(projectDir, target, {
    recursive: true,
    force: options.force,
    filter: (source) => !/(^|[\\/])(preview|thumbnail)\.[a-z0-9]+$/i.test(source),
  });
  console.log('[wallpaper] copied. Open public/wallpaper/' + basename(entry) + ' to inspect.');
  return { kind: 'web', target, copied: true };
}

function collectSceneEffects(sceneDir, object) {
  const materialsRoot = join(sceneDir, 'materials');
  const pipeline = [];
  const unsupported = new Set();

  for (const effect of object.effects || []) {
    if (effect.visible === false) continue;
    let definition = null;
    try {
      definition = readJson(join(sceneDir, effect.file));
    } catch {
      definition = null;
    }
    const type = String(definition?.replacementkey || basename(dirname(effect.file))).toLowerCase();
    if (type !== 'shake' && type !== 'foliagesway') {
      unsupported.add(type);
      continue;
    }

    for (const pass of effect.passes || []) {
      const values = pass.constantshadervalues || {};
      const maskRef = (pass.textures || []).find((value) => typeof value === 'string' && value.length);
      const maskPath = findTexture(materialsRoot, maskRef);

      if (type === 'shake') {
        pipeline.push({
          type: 'shake',
          maskSource: maskPath,
          params: {
            speed: num(values.speed, 1),
            strength: num(values.strength, 0.1),
            bounds: pair(values.bounds, [0, 1]),
            friction: pair(values.friction, [1, 1]),
          },
        });
      } else {
        pipeline.push({
          type: 'foliagesway',
          maskSource: maskPath,
          params: {
            speed: num(values.speeduv, 5),
            strength: num(values.strength, 0.4),
            phase: num(values.phase, 0.5),
            power: num(values.power, 1.11),
            ratio: num(values.ratio, 3.5),
            scale: num(values.scale, 0.05),
            direction: num(values.scrolldirection, 0),
          },
        });
      }
    }
  }

  return { pipeline, unsupported: [...unsupported] };
}

function importScene(options, projectDir, project) {
  const sceneDir = options.sceneDir || extractScene(projectDir, project, options);
  if (!sceneDir) return { kind: 'scene', dryRun: true };

  const sceneJson = findSceneJson(sceneDir);
  if (!sceneJson) throw new Error('scene.json not found under ' + sceneDir);
  const scene = readJson(sceneJson);
  const sceneRoot = dirname(sceneJson);
  const materialsRoot = join(sceneRoot, 'materials');

  const object = (scene.objects || []).find((entry) => entry.image) || (scene.objects || [])[0];
  if (!object) throw new Error('scene has no image object');

  let imagePath = null;
  try {
    const model = readJson(join(sceneRoot, object.image));
    const material = readJson(join(sceneRoot, model.material));
    const textureName = material.passes?.[0]?.textures?.[0];
    imagePath = findTexture(materialsRoot, textureName);
  } catch (error) {
    console.warn('[wallpaper] material lookup failed: ' + error.message);
  }
  if (!imagePath) imagePath = findTexture(materialsRoot, object.name);
  if (!imagePath) throw new Error('could not locate the scene artwork in materials/');

  const size = imageSize(imagePath);
  const { pipeline, unsupported } = collectSceneEffects(sceneRoot, object);
  const outDir = join(options.out, 'wallpaper');

  const normalizedPipeline = pipeline.map((entry, index) => ({
    type: entry.type,
    mask: entry.maskSource
      ? `mask_${entry.type}_${index + 1}${extname(entry.maskSource).toLowerCase()}`
      : null,
    params: entry.params,
  }));

  console.log('[wallpaper] type:    scene');
  console.log('[wallpaper] title:   ' + (project?.title || basename(projectDir || sceneRoot)));
  console.log('[wallpaper] artwork: ' + imagePath);
  console.log('[wallpaper] size:    ' + (size ? `${size.width}x${size.height}` : 'unknown'));
  console.log(
    '[wallpaper] effects: ' +
      (pipeline.length ? pipeline.map((entry) => entry.type).join(' -> ') : 'none (static image)'),
  );
  if (unsupported.length) {
    console.log('[wallpaper] skipped unsupported effects: ' + unsupported.join(', '));
  }
  console.log('[wallpaper] target:  ' + outDir);

  const normalized = {
    version: 1,
    generator: 'codex-dynamic-bg/tools/wallpaper.mjs',
    source: {
      id: basename(projectDir || sceneRoot),
      title: project?.title || basename(sceneRoot),
      description: project?.description || '',
      type: 'scene',
      width: size?.width || null,
      height: size?.height || null,
    },
    image: 'scene' + extname(imagePath).toLowerCase(),
    pipeline: normalizedPipeline,
    camera: {
      zoom: num(scene.general?.zoom, 1),
      fov: num(scene.general?.fov, 50),
      parallax: num(scene.general?.cameraparallaxamount, 0.1),
      parallaxInfluence: num(scene.general?.cameraparallaxmouseinfluence, 0.5),
      parallaxDelay: num(scene.general?.cameraparallaxdelay, 0.1),
    },
    note: 'Artwork and masks are user-supplied; public/assets is gitignored.',
  };

  if (options.dryRun) return { kind: 'scene', target: outDir, copied: false, normalized };

  mkdirSync(outDir, { recursive: true });
  let previous = null;
  try {
    previous = readJson(join(outDir, 'scene.json'));
  } catch {
    previous = null;
  }
  const sameSource =
    previous?.source?.type === 'scene' &&
    previous?.source?.id &&
    previous.source.id === normalized.source.id;
  const replaceOutput = options.force || !previous || !sameSource;
  const imageTarget = join(outDir, normalized.image);
  if (existsSync(imageTarget) && !replaceOutput) {
    console.log('[wallpaper] artwork exists, keeping it (use --force to overwrite)');
  } else {
    copyFileSync(imagePath, imageTarget);
  }

  for (let index = 0; index < pipeline.length; index += 1) {
    const source = pipeline[index].maskSource;
    const name = normalizedPipeline[index].mask;
    if (!source || !name) continue;
    const target = join(outDir, name);
    if (existsSync(target) && !replaceOutput) continue;
    copyFileSync(source, target);
  }

  writeFileSync(join(outDir, 'scene.json'), JSON.stringify(normalized, null, 2) + '\n', 'utf8');

  console.log('[wallpaper] wrote ' + join(outDir, 'scene.json'));
  console.log('[wallpaper] restart the dev server (or re-inject) to pick it up.');
  return { kind: 'scene', target: outDir, copied: true };
}

/* ------------------------------------------------------------------ */

function main() {
  const options = parseArgs(process.argv.slice(2));
  const source = resolveSource(options);
  const projectDir = source.projectDir || null;
  const projectFile = projectDir ? findProjectFile(projectDir) : null;
  const project = projectFile ? readJson(projectFile) : null;
  const type = String(project?.type || (options.sceneDir ? 'scene' : '')).toLowerCase();

  console.log('[wallpaper] folder:  ' + (projectDir || options.sceneDir));
  if (project) console.log('[wallpaper] project: ' + (project.title || basename(projectDir)));

  if (type === 'scene' || options.sceneDir) {
    importScene(options, projectDir, project);
  } else if (type === 'video') {
    importVideo(projectDir, project, options);
  } else if (type === 'web') {
    importWeb(projectDir, project, options);
  } else if (type === 'application') {
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
