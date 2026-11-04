import * as THREE from 'three';

/**
 * A 4K artwork is already 3840x2160. Going above 4096 on the long edge buys
 * almost nothing on a desktop wallpaper but can cost hundreds of megabytes of
 * VRAM once masks, normal maps and phase maps are added. Keep the artwork
 * crisp, but stop 8K phone dumps and multi-layer scenes from exhausting the
 * GPU.
 */
export const ARTWORK_TEXTURE_EDGE = 4096;
export const EFFECT_TEXTURE_EDGE = 2048;

export function sourceSize(source) {
  if (!source) return { width: 1, height: 1 };
  return {
    width: Math.max(
      1,
      Number(source.naturalWidth || source.videoWidth || source.width) || 1,
    ),
    height: Math.max(
      1,
      Number(source.naturalHeight || source.videoHeight || source.height) || 1,
    ),
  };
}

/**
 * Return the size a source should be uploaded at, preserving aspect ratio.
 * Pure so it can be unit tested without a DOM.
 */
export function fitWithin(width, height, maxEdge) {
  const w = Math.max(1, Number(width) || 1);
  const h = Math.max(1, Number(height) || 1);
  const edge = Math.max(1, Number(maxEdge) || ARTWORK_TEXTURE_EDGE);
  const scale = Math.min(1, edge / Math.max(w, h));
  return {
    width: Math.max(1, Math.round(w * scale)),
    height: Math.max(1, Math.round(h * scale)),
    scale,
    downscaled: scale < 0.999,
  };
}

export function prepareSource(source, maxEdge = ARTWORK_TEXTURE_EDGE) {
  const original = sourceSize(source);
  const fit = fitWithin(original.width, original.height, maxEdge);
  if (!fit.downscaled || typeof document === 'undefined') {
    return {
      source,
      ...fit,
      originalWidth: original.width,
      originalHeight: original.height,
      maxEdge,
    };
  }

  const canvas = document.createElement('canvas');
  canvas.width = fit.width;
  canvas.height = fit.height;
  const ctx = canvas.getContext('2d', { alpha: true });
  if (!ctx) {
    return {
      source,
      ...fit,
      originalWidth: original.width,
      originalHeight: original.height,
      maxEdge,
    };
  }
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, 0, 0, fit.width, fit.height);
  return {
    source: canvas,
    ...fit,
    originalWidth: original.width,
    originalHeight: original.height,
    maxEdge,
  };
}

/**
 * Create a texture from an image/canvas while keeping the source dimensions in
 * `userData.nuvio`. Diagnostics use that to report the real upload cost even
 * after downsampling.
 */
export function makeImageTexture(
  source,
  {
    renderer,
    srgb = false,
    repeat = false,
    flipY = false,
    maxEdge = ARTWORK_TEXTURE_EDGE,
  } = {},
) {
  const prepared = prepareSource(source, maxEdge);
  const texture = new THREE.Texture(prepared.source);
  texture.flipY = flipY;
  texture.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  const wrap = repeat ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  texture.wrapS = wrap;
  texture.wrapT = wrap;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  if (renderer?.capabilities?.getMaxAnisotropy) {
    texture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  }
  texture.userData.nuvio = {
    originalWidth: prepared.originalWidth,
    originalHeight: prepared.originalHeight,
    width: prepared.width,
    height: prepared.height,
    downscaled: prepared.downscaled,
    maxEdge: prepared.maxEdge,
  };
  texture.needsUpdate = true;
  return { texture, info: texture.userData.nuvio };
}

/** Read dimensions/estimated RGBA bytes from any Texture, including video. */
export function textureInfo(texture, role = 'texture') {
  const size = sourceSize(texture?.image);
  const meta = texture?.userData?.nuvio || {};
  return {
    role,
    width: meta.width || size.width,
    height: meta.height || size.height,
    bytes: (meta.width || size.width) * (meta.height || size.height) * 4,
    downscaled: Boolean(meta.downscaled),
    maxEdge: meta.maxEdge || null,
  };
}

export function textureInfoList(textures = []) {
  return textures.map((texture, index) =>
    textureInfo(texture, index === 0 ? 'artwork' : `effect-${index}`),
  );
}

export function summarizeTextures(textures = []) {
  const items = textureInfoList(textures);
  return {
    textureCount: items.length,
    textureBytes: items.reduce((sum, item) => sum + item.bytes, 0),
    textureDownscaled: items.some((item) => item.downscaled),
    textureItems: items,
  };
}
