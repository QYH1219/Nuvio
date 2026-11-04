/**
 * Low-end GPU detection.
 *
 * The wallpaper layer runs at a fixed frame cap chosen by the quality tier.
 * On software rasterizers and old integrated GPUs that cap alone can still
 * eat a full CPU core, so we lower the *frame rate only* — never the sampling
 * density, fit or composition. The picture must look identical, it just moves
 * less often.
 *
 * Everything here is pure so it can be unit tested without WebGL.
 */

export const LOW_END_FPS_CAP = 24;

/** Renderer strings that reliably mean "this will not hold 30 FPS". */
const LOW_END_PATTERNS = [
  /swiftshader/i,
  /\bllvmpipe\b/i,
  /software\s*rasterizer/i,
  /microsoft\s*basic\s*render/i,
  /\bintel\(r\)\s+(hd|uhd)\s+graphics\b/i,
  /\bintel\s+(hd|uhd)\s+graphics\b/i,
  /adreno\s*(?:\(tm\))?\s*(?:[345]\d{2})\b/i,
  // Mali-G3x/G4x/G5x are the budget tiers; G7x/G9x must stay un-flagged.
  /\bmali-[gt](?:3\d|4\d|5\d)\b/i,
  /\bpowervr\s*(?:sgx|rogue)?\s*\d{3}\b/i,
];

/**
 * @param {string} rendererString unmasked WebGL renderer, or an empty string
 * @returns {boolean} true when the adapter counts as low end
 */
export function detectLowEndGpu(rendererString) {
  const text = String(rendererString || '');
  if (!text) return false;
  return LOW_END_PATTERNS.some((pattern) => pattern.test(text));
}

/**
 * Effective frame cap. `lowEndAuto` off means the tier cap is used verbatim.
 *
 * @param {{tierFps?: number, lowEnd?: boolean, lowEndAuto?: boolean}} options
 * @returns {number}
 */
export function resolveFpsCap({ tierFps, lowEnd, lowEndAuto } = {}) {
  const base = Number(tierFps) > 0 ? Number(tierFps) : 60;
  if (lowEndAuto && lowEnd) return Math.min(base, LOW_END_FPS_CAP);
  return base;
}

/**
 * Read the real adapter name. Browsers return a generic "WebGL" string unless
 * `WEBGL_debug_renderer_info` is available, which is why a missing name is a
 * valid result rather than an error.
 */
export function readGpuString(renderer) {
  try {
    const gl = renderer?.getContext?.();
    if (!gl) return '';
    const ext = gl.getExtension?.('WEBGL_debug_renderer_info');
    const raw = ext
      ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)
      : gl.getParameter?.(gl.RENDERER);
    return String(raw || '');
  } catch {
    return '';
  }
}

/** Collapse whitespace and keep the diagnostics row from exploding. */
export function describeGpu(rendererString, maxLength = 90) {
  const text = String(rendererString || '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) return 'unknown';
  return text.length > maxLength ? `${text.slice(0, Math.max(1, maxLength - 1))}…` : text;
}
