const IMAGE_CANDIDATES = [
  'assets/background.webp',
  'assets/background.png',
  'assets/background.jpg',
  'assets/background.jpeg',
  'assets/background.avif',
];

const MODEL_CANDIDATES = ['assets/model.glb', 'assets/model.gltf'];

const VIDEO_CANDIDATES = ['assets/background.mp4', 'assets/background.webm'];

const SCENE_CANDIDATES = ['assets/wallpaper/scene.json'];

/**
 * Library manifest written by `npm run library -- apply <id>`. It points at an
 * imported wallpaper folder so a single slot can hold many wallpapers without
 * copying artwork around on every switch.
 */
const ACTIVE_MANIFEST = 'assets/active.json';

export function assetBaseUrl() {
  return window.__CXD_ASSET_BASE__ || './';
}

export function assetUrl(path) {
  const base = assetBaseUrl();
  if (/^https?:|^data:|^blob:/.test(path)) return path;
  if (base.endsWith('/')) return base + path;
  return base + '/' + path;
}

function join(base, path) {
  if (/^https?:|^data:|^blob:/.test(path)) return path;
  if (base.endsWith('/')) return base + path;
  return base + '/' + path;
}

async function exists(url, allowHtml = false) {
  try {
    const res = await fetch(url, { method: 'HEAD', cache: 'no-store' });
    if (!res.ok) return false;
    const type = (res.headers.get('content-type') || '').toLowerCase();
    // Vite/SPA fallbacks answer missing files with index.html; treat that as absent.
    // A web wallpaper entry, however, is legitimately an HTML document.
    if (!allowHtml && type.includes('text/html')) return false;
    return true;
  } catch {
    return false;
  }
}

async function readActiveManifest(base) {
  const manifestUrl = join(base, ACTIVE_MANIFEST);
  try {
    const res = await fetch(manifestUrl, { cache: 'no-store' });
    if (!res.ok) return null;
    const data = await res.json();
    if (!data || typeof data !== 'object' || !data.entry) return null;
    const kind = String(data.kind || '').toLowerCase();
    if (!['image', 'video', 'scene', 'web'].includes(kind)) return null;
    // Manifest entries are relative to `public/assets`, while candidate paths
    // above already carry the `assets/` prefix. Keep both conventions aligned;
    // joining `library/...` against the server root would 404.
    const url = join(base, `assets/${String(data.entry)}`);
    // A stale manifest after a manual delete must fall back to legacy probing.
    if (!(await exists(url, kind === 'web'))) return null;
    return { kind, url, meta: data };
  } catch {
    return null;
  }
}

export async function probeAssets() {
  const base = assetBaseUrl();
  const explicit = window.__CXD_ASSETS__ || {};
  const result = {
    videoUrl: explicit.videoUrl || explicit.video || null,
    imageUrl: explicit.imageUrl || explicit.background || null,
    modelUrl: explicit.modelUrl || explicit.model || null,
    sceneUrl: explicit.sceneUrl || explicit.scene || null,
    webUrl: explicit.webUrl || explicit.web || null,
    sceneData: explicit.sceneData || null,
  };

  // CLI/injector-provided sources are explicit user intent and win over the
  // library manifest. In normal `npm start` runs there is no explicit source,
  // so the wallpaper chosen in the panel is authoritative.
  const hasExplicit = Boolean(explicit.videoUrl || explicit.video || explicit.imageUrl ||
    explicit.background || explicit.sceneUrl || explicit.scene || explicit.webUrl || explicit.web);
  const active = hasExplicit ? null : await readActiveManifest(base);
  if (active) {
    if (active.kind === 'image' && !result.imageUrl) result.imageUrl = active.url;
    if (active.kind === 'video' && !result.videoUrl) result.videoUrl = active.url;
    if (active.kind === 'scene' && !result.sceneUrl) result.sceneUrl = active.url;
    if (active.kind === 'web' && !result.webUrl) result.webUrl = active.url;
    result.active = active.meta;
    result.activeKind = active.kind;
  }

  if (!active && !result.videoUrl) {
    for (const path of VIDEO_CANDIDATES) {
      const url = join(base, path);
      if (await exists(url)) {
        result.videoUrl = url;
        break;
      }
    }
  }
  if (!active && !result.imageUrl) {
    for (const path of IMAGE_CANDIDATES) {
      const url = join(base, path);
      if (await exists(url)) {
        result.imageUrl = url;
        break;
      }
    }
  }
  if (!result.modelUrl) {
    for (const path of MODEL_CANDIDATES) {
      const url = join(base, path);
      if (await exists(url)) {
        result.modelUrl = url;
        break;
      }
    }
  }
  // A manifest is authoritative: do not let stale background.mp4 / scene.json
  // files of another kind win after the user switched to a library wallpaper.
  if (!active && !result.sceneUrl) {
    for (const path of SCENE_CANDIDATES) {
      const url = join(base, path);
      if (await exists(url)) {
        result.sceneUrl = url;
        break;
      }
    }
  }
  return result;
}

async function loadSceneJson(url) {
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`scene json failed: ${url}`);
  const data = await res.json();
  if (!data || !data.image) throw new Error(`scene json has no image: ${url}`);
  return data;
}

function resolveAsset(name, sceneUrl) {
  if (/^https?:|^data:|^blob:/.test(name)) return name;
  if (!sceneUrl) return name;
  const absolute = new URL(sceneUrl, location.href);
  return new URL(name, new URL('.', absolute)).href;
}

/**
 * Load a normalized scene wallpaper produced by `tools/wallpaper.mjs`.
 *
 * Every pipeline entry may reference a mask, a normal map and a phase map.
 * Images are deduplicated by URL, which matters because water scenes often
 * reuse one mask across several passes.
 */
export async function loadSceneWallpaper(url, inlineData = null) {
  const data = inlineData || (await loadSceneJson(url));
  const imageUrl = resolveAsset(data.image, url);
  const image = await loadImage(imageUrl);

  const pipeline = Array.isArray(data.pipeline) ? data.pipeline : [];
  const cache = new Map();
  // A missing effect texture used to be a console.warn nobody reads. Keep the
  // failure and report it in the panel, otherwise a scene silently loses its
  // water ripple and looks "broken" with no explanation.
  const missing = new Map();
  const loadRef = async (ref, role) => {
    if (!ref) return null;
    const absolute = resolveAsset(ref, url);
    if (!cache.has(absolute)) {
      cache.set(
        absolute,
        loadImage(absolute).catch((error) => {
          console.warn('[codex-bg] scene texture failed', ref, error);
          if (!missing.has(absolute)) {
            missing.set(absolute, {
              role: role || 'texture',
              url: absolute,
              name: fileNameOf(absolute),
            });
          }
          return null;
        }),
      );
    }
    return cache.get(absolute);
  };

  const resolved = [];
  for (const entry of pipeline) {
    if (!entry || !entry.type) continue;
    const refs = entry.textures || (entry.mask ? { mask: entry.mask } : {});
    const [mask, normal, phase] = await Promise.all([
      loadRef(refs.mask, 'mask'),
      loadRef(refs.normal, 'normal'),
      loadRef(refs.phase, 'phase'),
    ]);
    resolved.push({
      type: entry.type,
      params: entry.params || {},
      images: { mask, normal, phase },
    });
  }

  return {
    image,
    fit: data.fit || 'cover',
    pipeline: resolved,
    meta: data.source || {},
    camera: data.camera || {},
    missingTextures: [...missing.values()],
  };
}

function fileNameOf(url) {
  const raw = String(url || '');
  const tail = raw.split(/[\\/]/).pop() || raw;
  const clean = tail.split(/[?#]/)[0];
  try {
    return decodeURIComponent(clean);
  } catch {
    return clean;
  }
}

export function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('image load failed: ' + url));
    img.src = url;
  });
}

/**
 * Load a muted, looping, inline video and wait until its dimensions are known.
 * Muted + playsInline is what makes autoplay legal in Chromium/Electron.
 */
export function loadVideo(url) {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    video.src = url;
    video.muted = true;
    video.defaultMuted = true;
    video.loop = true;
    video.autoplay = true;
    video.playsInline = true;
    video.preload = 'auto';
    video.crossOrigin = 'anonymous';
    video.disablePictureInPicture = true;
    video.setAttribute('aria-hidden', 'true');

    const cleanup = () => {
      video.removeEventListener('loadedmetadata', onReady);
      video.removeEventListener('error', onError);
    };
    const onReady = () => {
      cleanup();
      if (!video.videoWidth || !video.videoHeight) {
        reject(new Error('video has no dimensions: ' + url));
        return;
      }
      resolve(video);
    };
    const onError = () => {
      cleanup();
      reject(new Error('video load failed: ' + url));
    };

    video.addEventListener('loadedmetadata', onReady, { once: true });
    video.addEventListener('error', onError, { once: true });
    video.load();
  });
}

export async function startVideo(video) {
  // A previous wallpaper's refused-autoplay retry must not resurrect it.
  stopVideoRetry();
  if (!video || video.paused === false) return;

  const attempt = async () => {
    try {
      await video.play();
      return true;
    } catch {
      return false;
    }
  };

  if (await attempt()) return;

  // Autoplay can be refused until the page has a user gesture. Retry once on
  // the first interaction; the paused first frame is still rendered meanwhile.
  const retry = async () => {
    if (await attempt()) stopVideoRetry();
  };
  window.addEventListener('pointerdown', retry);
  window.addEventListener('keydown', retry);
  activeVideoRetry = retry;
}

let activeVideoRetry = null;

/**
 * Drop the pending autoplay retry listener. Without this every wallpaper
 * switch that hit an autoplay block left two window listeners behind forever.
 */
export function stopVideoRetry() {
  if (!activeVideoRetry) return;
  window.removeEventListener('pointerdown', activeVideoRetry);
  window.removeEventListener('keydown', activeVideoRetry);
  activeVideoRetry = null;
}

function drawThumb(source, width, height, maxWidth = 480) {
  if (!width || !height) return '';
  try {
    const w = Math.max(1, Math.min(maxWidth, Math.round(width)));
    const h = Math.max(1, Math.round((w * height) / width));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return '';
    ctx.drawImage(source, 0, 0, w, h);
    return canvas.toDataURL('image/jpeg', 0.72);
  } catch {
    // Tainted canvas (remote cross-origin art) or an undecoded frame.
    return '';
  }
}

/** Static thumb for an already decoded image / scene artwork. */
export function captureImageThumb(image) {
  return drawThumb(image, image?.naturalWidth || image?.width, image?.naturalHeight || image?.height);
}

/**
 * First presented video frame as a small data URL. Resolves '' when the frame
 * is not available yet, so the caller can keep the placeholder card.
 */
export function captureVideoThumb(video, { timeoutMs = 1500 } = {}) {
  if (!video || !video.videoWidth) return Promise.resolve('');
  const draw = () => drawThumb(video, video.videoWidth, video.videoHeight);
  return new Promise((resolve) => {
    let settled = false;
    let timer = 0;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      // The frame callback usually wins; leaving the fallback timer armed would
      // keep one timer per wallpaper switch alive until it expires.
      if (timer) clearTimeout(timer);
      timer = 0;
      resolve(value);
    };
    // Arm the fallback before registering the frame callback so a callback
    // that fires synchronously still gets its timer cleared.
    timer = setTimeout(() => finish(draw()), timeoutMs);
    if (typeof video.requestVideoFrameCallback === 'function') {
      video.requestVideoFrameCallback(() => finish(draw()));
    }
  });
}

/** Procedural fallback so the demo looks finished before real art arrives. */
const FALLBACK_PALETTE = {
  glowA: '#48d6cc',
  glowB: '#7e62c4',
};

function hexToRgba(hex, alpha) {
  const value = String(hex || '').replace('#', '');
  const normalized = value.length === 3 ? value.split('').map((c) => c + c).join('') : value;
  const int = Number.parseInt(normalized, 16);
  if (!Number.isFinite(int)) return `rgba(72, 214, 204, ${alpha})`;
  const r = (int >> 16) & 255;
  const g = (int >> 8) & 255;
  const b = int & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export function createFallbackBackground(width = 2048, height = 1152, palette = FALLBACK_PALETTE) {
  const colors = { ...FALLBACK_PALETTE, ...(palette || {}) };
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');

  const sky = ctx.createLinearGradient(0, 0, 0, height);
  sky.addColorStop(0, '#050810');
  sky.addColorStop(0.4, '#0a1824');
  sky.addColorStop(0.7, '#0f2d37');
  sky.addColorStop(1, '#04080c');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, width, height);

  const glow = ctx.createRadialGradient(
    width * 0.62,
    height * 0.66,
    0,
    width * 0.62,
    height * 0.66,
    width * 0.55,
  );
  glow.addColorStop(0, hexToRgba(colors.glowA, 0.4));
  glow.addColorStop(0.35, hexToRgba(colors.glowA, 0.22));
  glow.addColorStop(1, 'rgba(0, 0, 0, 0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, width, height);

  const warm = ctx.createRadialGradient(
    width * 0.18,
    height * 0.2,
    0,
    width * 0.18,
    height * 0.2,
    width * 0.42,
  );
  warm.addColorStop(0, hexToRgba(colors.glowB, 0.2));
  warm.addColorStop(1, 'rgba(0, 0, 0, 0)');
  ctx.fillStyle = warm;
  ctx.fillRect(0, 0, width, height);

  const band = ctx.createLinearGradient(0, height * 0.38, 0, height * 0.7);
  band.addColorStop(0, 'rgba(46, 168, 176, 0)');
  band.addColorStop(0.5, hexToRgba(colors.glowA, 0.1));
  band.addColorStop(1, 'rgba(46, 168, 176, 0)');
  ctx.fillStyle = band;
  ctx.fillRect(0, height * 0.36, width, height * 0.36);

  let seed = 1337;
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };

  for (let i = 0; i < 900; i += 1) {
    const x = rand() * width;
    const y = rand() * height * 0.92;
    const r = Math.pow(rand(), 3) * 2.2 + 0.2;
    ctx.fillStyle = `rgba(${180 + rand() * 70},${210 + rand() * 45},255,${rand() * 0.55})`;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  for (let i = 0; i < 26; i += 1) {
    const x = rand() * width;
    const y = height * (0.35 + rand() * 0.6);
    const r = 60 + rand() * 240;
    const fog = ctx.createRadialGradient(x, y, 0, x, y, r);
    fog.addColorStop(0, `rgba(40,120,130,${0.02 + rand() * 0.035})`);
    fog.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = fog;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  const floor = ctx.createLinearGradient(0, height * 0.72, 0, height);
  floor.addColorStop(0, 'rgba(3,8,10,0)');
  floor.addColorStop(1, 'rgba(1,3,5,0.85)');
  ctx.fillStyle = floor;
  ctx.fillRect(0, height * 0.6, width, height * 0.4);

  return canvas;
}
