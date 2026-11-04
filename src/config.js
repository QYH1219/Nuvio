// v2: brighter defaults (lower dim / panel alpha) and the new vignette control.
const STORAGE_KEY = 'codex-dynamic-bg:v2';

export const DEFAULTS = {
  quality: 'high',
  motion: 1,
  parallax: 1,
  bloom: 0.85,
  grain: 0.55,
  dim: 0.12,
  vignette: 0.45,
  modelScale: 1,
  modelSpin: 0.35,
  modelX: 0.18,
  modelY: -0.02,
  sceneShake: 1,
  sceneSway: 1,
  particles: true,
  codexMock: true,
  surfaceOpacity: 0.22,
  showPanel: false,
};

export const QUALITY = {
  low: { dpr: 1, bloom: false, particleScale: 0.35, shadow: false },
  medium: { dpr: 1.5, bloom: true, particleScale: 0.7, shadow: false },
  high: { dpr: 2, bloom: true, particleScale: 1, shadow: true },
};

export function loadConfig() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULTS };
    const parsed = JSON.parse(raw);
    return { ...DEFAULTS, ...(parsed && typeof parsed === 'object' ? parsed : {}) };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveConfig(config) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  } catch {
    /* storage can be unavailable in embedded contexts */
  }
}

export function resetConfig() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
  return { ...DEFAULTS };
}

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
