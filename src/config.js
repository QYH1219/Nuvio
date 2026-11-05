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
    hint: '1.0× 采样 · 30 FPS',
    dpr: 1,
    fps: 30,
  },
  balanced: {
    label: '平衡',
    hint: '1.25× 采样 · 30 FPS',
    dpr: 1.25,
    fps: 30,
  },
  high: {
    label: '高清',
    hint: '1.5× 采样 · 60 FPS',
    dpr: 1.5,
    fps: 60,
  },
};

/**
 * Quality changes sampling density and the frame cap only. It must never
 * change framing, aspect ratio, motion, bloom or particles: picking a tier is
 * a performance decision, not a different look.
 */
export const FIT_IDS = ['auto', 'cover', 'contain', 'stretch'];

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
  // Set by the auto governor when it lowers the tier. The panel uses it to
  // offer a one-click restore without forcing the user to restart Codex.
  autoQualityFrom: '',
  lowEndAuto: true,
  idlePause: true,
  pauseWhenUnfocused: true,
  rotationEnabled: false,
  rotationMinutes: 30,
  favoriteIds: [],
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
  sceneWater: 1,
  particles: true,
  webInteractive: false,
  showAdvanced: false,
  codexMock: true,
  surfaceOpacity: 0.22,
  showPanel: false,
};

export function loadConfig() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULTS, favoriteIds: [] };
    const parsed = JSON.parse(raw);
    const merged = { ...DEFAULTS, ...(parsed && typeof parsed === 'object' ? parsed : {}) };
    merged.quality = normalizeQuality(merged.quality);
    merged.autoQualityFrom = QUALITY[merged.autoQualityFrom] ? merged.autoQualityFrom : '';
    merged.showAdvanced = Boolean(merged.showAdvanced);
    merged.webInteractive = Boolean(merged.webInteractive);
    if (!FIT_IDS.includes(merged.fit)) merged.fit = DEFAULTS.fit;
    const rotation = Number(merged.rotationMinutes);
    merged.rotationMinutes = Number.isFinite(rotation)
      ? Math.min(1440, Math.max(1, Math.round(rotation)))
      : DEFAULTS.rotationMinutes;
    merged.favoriteIds = Array.isArray(merged.favoriteIds)
      ? [...new Set(merged.favoriteIds.filter((id) => /^\d{4,20}$/.test(String(id))).map(String))].slice(0, 200)
      : [];
    return merged;
  } catch {
    return { ...DEFAULTS, favoriteIds: [] };
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
  return { ...DEFAULTS, favoriteIds: [] };
}

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
