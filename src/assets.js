const IMAGE_CANDIDATES = [
  'assets/background.webp',
  'assets/background.png',
  'assets/background.jpg',
  'assets/background.jpeg',
];

const MODEL_CANDIDATES = ['assets/model.glb', 'assets/model.gltf'];

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

async function exists(url) {
  try {
    const res = await fetch(url, { method: 'HEAD', cache: 'no-store' });
    if (!res.ok) return false;
    const type = (res.headers.get('content-type') || '').toLowerCase();
    // Vite/SPA fallbacks answer missing files with index.html; treat that as absent.
    if (type.includes('text/html')) return false;
    return true;
  } catch {
    return false;
  }
}

export async function probeAssets() {
  const base = assetBaseUrl();
  const explicit = window.__CXD_ASSETS__ || {};
  const result = {
    imageUrl: explicit.imageUrl || explicit.background || null,
    modelUrl: explicit.modelUrl || explicit.model || null,
  };

  if (!result.imageUrl) {
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
  return result;
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

/** Procedural fallback so the demo looks finished before real art arrives. */
export function createFallbackBackground(width = 2048, height = 1152) {
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
  glow.addColorStop(0, 'rgba(72, 214, 204, 0.40)');
  glow.addColorStop(0.35, 'rgba(34, 112, 136, 0.22)');
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
  warm.addColorStop(0, 'rgba(126, 98, 196, 0.20)');
  warm.addColorStop(1, 'rgba(0, 0, 0, 0)');
  ctx.fillStyle = warm;
  ctx.fillRect(0, 0, width, height);

  const band = ctx.createLinearGradient(0, height * 0.38, 0, height * 0.7);
  band.addColorStop(0, 'rgba(46, 168, 176, 0)');
  band.addColorStop(0.5, 'rgba(52, 178, 182, 0.10)');
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
