// v2: brighter defaults (lower dim / panel alpha) and the new vignette control.
const STORAGE_KEY = 'codex-dynamic-bg:v2';

/**
 * Three tiers, ordered from cheapest to heaviest. `saver` is the default: a
 * wallpaper should look like a wallpaper, not like a game running behind the
 * editor. Everything above it is opt-in.
 */
export const QUALITY = {
  saver: {
    label: '省电',
    hint: '1.0 DPR · 30 FPS · 无辉光 · 无粒子',
    dpr: 1,
    fps: 30,
    antialias: false,
    bloom: false,
    particles: false,
    particleScale: 0,
  },
  balanced: {
    label: '平衡',
    hint: '1.25 DPR · 30 FPS · 无辉光 · 无粒子',
    dpr: 1.25,
    fps: 30,
    antialias: false,
    bloom: false,
    particles: false,
    particleScale: 0,
  },
  high: {
    label: '高画质',
    hint: '1.5 DPR · 60 FPS · 辉光 · 粒子',
    dpr: 1.5,
    fps: 60,
    antialias: true,
    bloom: true,
    particles: true,
    particleScale: 1,
  },
};

/** Cheapest first. Used by the automatic downgrade governor. */
export const QUALITY_ORDER = ['saver', 'balanced', 'high'];

/** 0.2.x tier ids kept so old localStorage payloads still resolve. */
export const QUALITY_ALIASES = { low: 'saver', medium: 'balanced', high: 'high' };

export function normalizeQuality(value) {
  const id = QUALITY_ALIASES[value] || value;
  return QUALITY[id] ? id : 'saver';
}

export function qualityFor(value) {
  return QUALITY[normalizeQuality(value)];
}

/** Next cheaper tier, or null when already at the bottom. */
export function cheaperQuality(value) {
  const index = QUALITY_ORDER.indexOf(normalizeQuality(value));
  return index > 0 ? QUALITY_ORDER[index - 1] : null;
}

export const DEFAULTS = {
  theme: 'aurora',
  readability: 'balanced',
  wallpaperMode: false,
  quality: 'saver',
  autoQuality: true,
  idlePause: true,
  motion: 1,
  parallax: 1,
  bloom: 0.85,
  grain: 0.55,
  dim: 0.12,
  vignette: 0.45,
  fit: 'auto',
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

export function loadConfig() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULTS };
    const parsed = JSON.parse(raw);
    const merged = { ...DEFAULTS, ...(parsed && typeof parsed === 'object' ? parsed : {}) };
    merged.quality = normalizeQuality(merged.quality);
    if (!['auto', 'cover', 'stretch'].includes(merged.fit)) merged.fit = DEFAULTS.fit;
    return merged;
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
