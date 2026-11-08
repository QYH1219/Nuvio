/**
 * Sample a wallpaper once and derive the two values that decide whether UI
 * text stays readable on top of it: how dark the backdrop needs to be, and how
 * much frost the panels need.
 *
 * Everything runs on a 32×32 offscreen canvas — one drawImage and one
 * getImageData per wallpaper switch. That is cheap enough to keep enabled by
 * default, and it replaces two sliders most users never tuned correctly.
 */

const SAMPLE = 32;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function round2(value) {
  return Math.round(value * 100) / 100;
}

function sourceSize(source) {
  return {
    width: Number(source?.naturalWidth || source?.videoWidth || source?.width) || 0,
    height: Number(source?.naturalHeight || source?.videoHeight || source?.height) || 0,
  };
}

/**
 * @param {CanvasImageSource} source decoded image or a video element
 * @returns {{ luminance:number, edgeDensity:number, contrast:number, busy:number } | null}
 */
export function analyzeArtwork(source) {
  if (!source || typeof document === 'undefined') return null;
  const { width, height } = sourceSize(source);
  if (!width || !height) return null;

  const canvas = document.createElement('canvas');
  canvas.width = SAMPLE;
  canvas.height = SAMPLE;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  try {
    ctx.drawImage(source, 0, 0, SAMPLE, SAMPLE);
  } catch {
    // Tainted canvas (remote cross-origin art) or an undecoded video frame.
    return null;
  }
  let pixels;
  try {
    pixels = ctx.getImageData(0, 0, SAMPLE, SAMPLE).data;
  } catch {
    return null;
  }

  const lum = new Float32Array(SAMPLE * SAMPLE);
  let sum = 0;
  for (let i = 0; i < lum.length; i += 1) {
    const p = i * 4;
    const value = (0.2126 * pixels[p] + 0.7152 * pixels[p + 1] + 0.0722 * pixels[p + 2]) / 255;
    lum[i] = value;
    sum += value;
  }
  const luminance = sum / lum.length;

  // Mean central-difference gradient: a good proxy for "busy" detail, which is
  // what makes text hard to read even when the average brightness is low.
  let edge = 0;
  let edgeCount = 0;
  let variance = 0;
  for (let y = 0; y < SAMPLE; y += 1) {
    for (let x = 0; x < SAMPLE; x += 1) {
      const i = y * SAMPLE + x;
      variance += (lum[i] - luminance) ** 2;
      if (x === 0 || y === 0 || x === SAMPLE - 1 || y === SAMPLE - 1) continue;
      const gx = lum[i + 1] - lum[i - 1];
      const gy = lum[i + SAMPLE] - lum[i - SAMPLE];
      edge += Math.hypot(gx, gy);
      edgeCount += 1;
    }
  }
  const edgeDensity = clamp(edge / Math.max(1, edgeCount) / 0.32, 0, 1);
  const contrast = clamp(Math.sqrt(variance / lum.length) * 3.2, 0, 1);
  const busy = clamp(edgeDensity * 0.7 + contrast * 0.3, 0, 1);

  return {
    luminance: round2(luminance),
    edgeDensity: round2(edgeDensity),
    contrast: round2(contrast),
    busy: round2(busy),
  };
}

/** Map an analysis to the two values the renderer actually consumes. */
export function autoLook(analysis) {
  if (!analysis) return null;
  const luminance = clamp(Number(analysis.luminance) || 0, 0, 1);
  const busy = clamp(Number(analysis.busy ?? analysis.edgeDensity) || 0, 0, 1);
  // Bright art needs a light darkening pass, busy art needs some panel frost.
  // Keep both intentionally low: the wallpaper should still read as artwork,
  // not as a dimmed backdrop. The manual slider remains available when a
  // specific screen needs more contrast.
  const dim = round2(clamp(0.03 + Math.max(0, luminance - 0.35) * 0.32 + busy * 0.04, 0.03, 0.28));
  const surfaceOpacity = round2(clamp(0.08 + busy * 0.2 + Math.max(0, luminance - 0.6) * 0.3, 0.08, 0.42));
  return { dim, surfaceOpacity };
}
