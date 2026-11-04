/**
 * Built-in looks. Each theme only drives palette + effect values; user assets
 * (image / video / scene) stay untouched and keep their own colours on top.
 */
export const THEMES = [
  {
    id: 'aurora',
    name: '极光',
    hint: '青绿 × 紫罗兰，默认外观',
    palette: {
      glowA: '#1b6f78',
      glowB: '#4b3f9e',
      particleA: '#71f0e2',
      particleB: '#9d8cff',
      rimA: '#3fe0d4',
      rimB: '#8b6bff',
    },
    effects: { bloom: 0.95, grain: 0.45, dim: 0.1, vignette: 0.4, motion: 1, parallax: 1, particles: true },
  },
  {
    id: 'deep-space',
    name: '深空',
    hint: '冷蓝 × 靛紫，安静',
    palette: {
      glowA: '#123a6b',
      glowB: '#3b1b6e',
      particleA: '#6fa8ff',
      particleB: '#b18cff',
      rimA: '#2f7fe0',
      rimB: '#7b5cff',
    },
    effects: { bloom: 0.75, grain: 0.65, dim: 0.16, vignette: 0.55, motion: 0.8, parallax: 1.2, particles: true },
  },
  {
    id: 'cyber',
    name: '赛博',
    hint: '青蓝 × 洋红，高对比',
    palette: {
      glowA: '#0e5f6e',
      glowB: '#8a1c74',
      particleA: '#38f2ff',
      particleB: '#ff4fd8',
      rimA: '#00e5ff',
      rimB: '#ff2bd6',
    },
    effects: { bloom: 1.2, grain: 0.3, dim: 0.12, vignette: 0.5, motion: 1.2, parallax: 1.4, particles: true },
  },
  {
    id: 'rain',
    name: '雨夜',
    hint: '钢蓝灰，低辉光',
    palette: {
      glowA: '#1d3b4a',
      glowB: '#2c3550',
      particleA: '#8fc7d8',
      particleB: '#7f93b8',
      rimA: '#4a8fa8',
      rimB: '#5f6fa8',
    },
    effects: { bloom: 0.5, grain: 0.85, dim: 0.26, vignette: 0.65, motion: 1.1, parallax: 0.6, particles: true },
  },
  {
    id: 'paper',
    name: '纸感',
    hint: '暖棕 × 米金，无粒子',
    palette: {
      glowA: '#6b4a2a',
      glowB: '#8a6b3f',
      particleA: '#ffd9a0',
      particleB: '#d8b07a',
      rimA: '#ffcf9a',
      rimB: '#c99a5f',
    },
    effects: { bloom: 0.3, grain: 1.05, dim: 0.04, vignette: 0.22, motion: 0.5, parallax: 0.35, particles: false },
  },
  {
    id: 'mono',
    name: '纯黑省电',
    hint: '近黑灰，最低渲染开销',
    palette: {
      glowA: '#2a2f33',
      glowB: '#3a4148',
      particleA: '#9aa4ab',
      particleB: '#c3cbd1',
      rimA: '#8c969e',
      rimB: '#5f686f',
    },
    effects: { bloom: 0.2, grain: 0.25, dim: 0.3, vignette: 0.7, motion: 0.35, parallax: 0.3, particles: false },
  },
];

export const READABILITY = {
  wallpaper: { label: '桌面', surfaceOpacity: 0.08, dim: 0.02, vignette: 0.08 },
  clear: { label: '清晰', surfaceOpacity: 0.1, dim: 0.06, vignette: 0.32 },
  balanced: { label: '平衡', surfaceOpacity: 0.22, dim: 0.12, vignette: 0.45 },
  immersive: { label: '沉浸', surfaceOpacity: 0.38, dim: 0.22, vignette: 0.62 },
};

export function getTheme(id) {
  return THEMES.find((theme) => theme.id === id) || THEMES[0];
}

/** Apply a theme in place; returns the same config object. */
export function applyTheme(config, id) {
  const theme = getTheme(id);
  Object.assign(config, theme.effects, { theme: theme.id });
  return config;
}

/** Apply a readability preset in place; returns the same config object. */
export function applyReadability(config, id) {
  const preset = READABILITY[id] || READABILITY.balanced;
  Object.assign(config, {
    readability: READABILITY[id] ? id : 'balanced',
    surfaceOpacity: preset.surfaceOpacity,
    dim: preset.dim,
    vignette: preset.vignette,
  });
  return config;
}

/**
 * A real wallpaper should look like the desktop: crisp, nearly undimmed, and
 * independent from the procedural-background themes. This is applied once when
 * an image/video/scene is selected; later manual slider changes are preserved.
 */
export function applyWallpaperLook(config) {
  Object.assign(config, {
    readability: 'wallpaper',
    surfaceOpacity: READABILITY.wallpaper.surfaceOpacity,
    dim: READABILITY.wallpaper.dim,
    vignette: READABILITY.wallpaper.vignette,
    bloom: 0.42,
    grain: 0.18,
  });
  return config;
}
