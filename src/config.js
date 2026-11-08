// v2: brighter defaults (lower dim / panel alpha) and the new vignette control.
// 0.7 keeps the same key so existing installs migrate instead of resetting.
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
 *
 * 0.7 keeps two framing choices: stretch fills the window without cropping
 * (the default, so the whole wallpaper is visible) and contain letterboxes.
 * `auto` / `cover` from older builds migrate to stretch.
 */
export const FIT_IDS = ['stretch', 'contain'];

/** One motion control instead of separate motion/parallax/grain sliders. */
export const MOTION_PRESETS = {
  off: { label: '关闭', motion: 0, parallax: 0 },
  light: { label: '轻微', motion: 0.55, parallax: 0.6 },
  standard: { label: '标准', motion: 1, parallax: 1 },
};

/** Rotation presets; a slider with 240 stops was never worth the space. */
export const ROTATION_PRESETS = [15, 30, 60, 120];

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
  // 0.7: one switch replaces the four perf toggles above, one preset replaces
  // the motion/parallax sliders, and readability is sampled from the artwork.
  powerSaver: true,
  motionPreset: 'standard',
  autoReadability: true,
  sceneBake: true,
  rotationEnabled: false,
  rotationMinutes: 30,
  favoriteIds: [],
  motion: 1,
  parallax: 1,
  bloom: 0.85,
  grain: 0.55,
  dim: 0.12,
  vignette: 0.45,
  fit: 'stretch',
  modelScale: 1,
  modelSpin: 0.35,
  modelX: 0.18,
  modelY: -0.02,
  sceneShake: 1,
  sceneSway: 1,
  sceneWater: 1,
  particles: true,
  webInteractive: false,
  codexMock: true,
  surfaceOpacity: 0.22,
  showPanel: false,
};

/**
 * Keep the legacy per-key values in sync with the two preset controls. The
 * renderer and the scene shaders still read motion/parallax/autoQuality/…, so
 * deriving them here means the engine never has to know about presets.
 */
export function applyDerived(config) {
  const preset = MOTION_PRESETS[config.motionPreset] || MOTION_PRESETS.standard;
  config.motion = preset.motion;
  config.parallax = preset.parallax;
  // The panel only offers four rotation gaps now; snap older values so the
  // segmented control always has an active option.
  const minutes = Number(config.rotationMinutes);
  config.rotationMinutes = ROTATION_PRESETS.reduce(
    (best, candidate) =>
      Math.abs(candidate - minutes) < Math.abs(best - minutes) ? candidate : best,
    ROTATION_PRESETS[0],
  );
  const saver = config.powerSaver !== false;
  config.autoQuality = saver;
  config.lowEndAuto = saver;
  config.idlePause = saver;
  config.pauseWhenUnfocused = saver;
  return config;
}

/**
 * Slider bounds live in one table so the panel, config import and the
 * localStorage restore agree on what "in range" means. Without this an
 * imported `{"dim": 5}` multiplies the shader by -4 and paints the window
 * black with no way back except a full reset.
 */
export const NUMERIC_LIMITS = {
  surfaceOpacity: [0, 1],
  dim: [0, 0.8],
  vignette: [0, 1],
  motion: [0, 2],
  parallax: [0, 2],
  bloom: [0, 2],
  grain: [0, 1.5],
  sceneShake: [0, 2],
  sceneSway: [0, 2],
  sceneWater: [0, 2],
  modelScale: [0.4, 2],
  modelSpin: [0, 1.5],
  modelX: [-1, 1],
  modelY: [-1, 1],
  rotationMinutes: [1, 240],
};

/** Clamp a finite number into its control range; unknown keys pass through. */
export function clampNumber(key, value) {
  const range = NUMERIC_LIMITS[key];
  if (!range) return value;
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return DEFAULTS[key];
  return Math.min(range[1], Math.max(range[0], numeric));
}

export function loadConfig() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return applyDerived({ ...DEFAULTS, favoriteIds: [] });
    const parsed = JSON.parse(raw);
    const merged = { ...DEFAULTS, ...(parsed && typeof parsed === 'object' ? parsed : {}) };
    merged.quality = normalizeQuality(merged.quality);
    merged.autoQualityFrom = QUALITY[merged.autoQualityFrom] ? merged.autoQualityFrom : '';
    merged.webInteractive = Boolean(merged.webInteractive);
    if (!FIT_IDS.includes(merged.fit)) merged.fit = DEFAULTS.fit;
    const saved = parsed && typeof parsed === 'object' ? parsed : {};
    if (typeof saved.powerSaver !== 'boolean') {
      // First run on 0.7: the old defaults were all-on, so only opt out when
      // the saved payload explicitly disabled every switch.
      merged.powerSaver = Boolean(
        saved.autoQuality !== false ||
        saved.lowEndAuto !== false ||
        saved.idlePause !== false ||
        saved.pauseWhenUnfocused !== false,
      );
    }
    if (!MOTION_PRESETS[saved.motionPreset]) {
      const motion = Number(saved.motion ?? merged.motion);
      merged.motionPreset = motion >= 0.9 ? 'standard' : motion >= 0.4 ? 'light' : 'off';
    }
    merged.autoReadability = merged.autoReadability !== false;
    merged.sceneBake = merged.sceneBake !== false;
    Object.keys(NUMERIC_LIMITS).forEach((key) => {
      const value = Number(merged[key]);
      merged[key] = Number.isFinite(value) ? clampNumber(key, value) : DEFAULTS[key];
    });
    merged.rotationMinutes = Math.round(merged.rotationMinutes);
    merged.favoriteIds = Array.isArray(merged.favoriteIds)
      ? [...new Set(merged.favoriteIds.filter((id) => /^\d{4,20}$/.test(String(id))).map(String))].slice(0, 200)
      : [];
    return applyDerived(merged);
  } catch {
    return applyDerived({ ...DEFAULTS, favoriteIds: [] });
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
  return applyDerived({ ...DEFAULTS, favoriteIds: [] });
}

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
