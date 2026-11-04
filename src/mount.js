import {
  clamp,
  loadConfig,
  saveConfig,
  resetConfig,
  DEFAULTS,
  QUALITY,
  normalizeQuality,
  qualityFor,
} from './config.js';
import {
  probeAssets,
  loadImage,
  loadVideo,
  loadSceneWallpaper,
  startVideo,
  createFallbackBackground,
} from './assets.js';
import {
  loadUserAssetUrls,
  saveAsset,
  deleteAsset,
  describeAsset,
  getAssetRecord,
  restoreAssetRecord,
  formatBytes,
} from './library.js';
import { BackgroundEngine } from './scene.js';
import { PerfGovernor } from './perf.js';
import { validateModelUrl } from './scene/model.js';
import {
  THEMES,
  READABILITY,
  getTheme,
  applyTheme,
  applyReadability,
  applyWallpaperLook,
} from './presets.js';
import { createHud, createHints, createPanel, createMock } from './ui.js';

const params = new URLSearchParams(location.search);

const GEAR_ICON = `
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
    <circle cx="12" cy="12" r="3.2"></circle>
    <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1 1.55V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.11-1.55 1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.7 1.7 0 0 0 .34-1.87 1.7 1.7 0 0 0-1.55-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.55-1.11 1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.7 1.7 0 0 0 1.87.34H9a1.7 1.7 0 0 0 1-1.55V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.55 1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.34 1.87V9a1.7 1.7 0 0 0 1.55 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"></path>
  </svg>
`;

const THEME_IDS = new Set(THEMES.map((theme) => theme.id));
const FIT_IDS = new Set(['auto', 'cover', 'stretch']);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createUserAssetState(background, model) {
  const state = {
    background,
    model,
    cleanup(slots = ['background', 'model']) {
      slots.forEach((slot) => {
        const url = state[slot]?.url;
        if (!url) return;
        try {
          URL.revokeObjectURL(url);
        } catch {
          /* ignore */
        }
      });
    },
  };
  return state;
}

function disposeMediaElement(media) {
  if (!media) return;
  try {
    media.pause();
    media.removeAttribute('src');
    media.load();
  } catch {
    /* ignore */
  }
}

function isTypingTarget(target) {
  if (!(target instanceof Element)) return false;
  const tag = target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  return target.isContentEditable || Boolean(target.closest('[contenteditable="true"]'));
}

/** Keep imported JSON to known config keys and primitive types. */
function sanitizeConfigPatch(input) {
  const patch = {};
  if (!input || typeof input !== 'object' || Array.isArray(input)) return patch;

  Object.keys(DEFAULTS).forEach((key) => {
    if (key === 'showPanel') return;
    if (!Object.prototype.hasOwnProperty.call(input, key)) return;
    const value = input[key];
    if (value === null || typeof value === 'object' || typeof value === 'function') return;
    if (typeof value === 'string' && value.length > 64) return;

    if (key === 'theme' && !THEME_IDS.has(value)) return;
    if (key === 'readability' && value !== 'custom' && !READABILITY[value]) return;
    if (key === 'quality') {
      const normalized = normalizeQuality(value);
      // Reject unknown ids instead of silently forcing the cheapest tier.
      if (!QUALITY[normalized] || (normalized === 'saver' && value !== 'saver' && value !== 'low')) return;
      patch[key] = normalized;
      return;
    }
    if (key === 'fit') {
      if (!FIT_IDS.has(value)) return;
      patch[key] = value;
      return;
    }
    if (typeof DEFAULTS[key] === 'boolean' && typeof value !== 'boolean') return;
    if (typeof DEFAULTS[key] === 'number') {
      const numeric = Number(value);
      if (!Number.isFinite(numeric)) return;
      patch[key] = numeric;
      return;
    }
    patch[key] = value;
  });

  return patch;
}

export async function mount(host, options = {}) {
  const embed = options.embed ?? params.get('embed') === '1';
  const config = loadConfig();

  if (embed) {
    config.codexMock = false;
    config.showPanel = false;
  }
  if (params.get('mock') === '1') config.codexMock = true;
  if (params.get('mock') === '0') config.codexMock = false;
  if (params.get('panel') === '1') config.showPanel = true;

  const root = document.createElement('div');
  root.className = 'cxd-root' + (embed ? ' cxd-embedded' : '');
  root.dataset.cxdMounted = 'true';
  host.appendChild(root);
  if (embed) document.body.classList.add('cxd-embedded');

  let disposed = false;
  let engine = null;
  try {
    engine = new BackgroundEngine(root, config);
  } catch (error) {
    console.error('[codex-bg] WebGL init failed', error);
    root.style.background =
      'radial-gradient(60% 60% at 62% 62%, rgba(52,180,175,.28), transparent 70%), radial-gradient(50% 50% at 20% 18%, rgba(120,92,180,.22), transparent 70%), #04060b';
    root.remove();
    document.body.classList.remove('cxd-embedded');
    return { engine: null, config, error };
  }

  // In embed mode the background layer sits at z-index:-1 and accepts no
  // pointer events, so settings UI lives in its own top-level host instead.
  const uiLayer = embed ? document.createElement('div') : root;
  if (embed) {
    uiLayer.className = 'cxd-ui-layer';
    document.body.appendChild(uiLayer);
  }

  const loader = document.createElement('div');
  loader.className = 'cxd-loader';
  loader.innerHTML = `
    <div class="cxd-loader-inner">
      <div class="cxd-loader-ring"></div>
      <div class="cxd-loader-text">building scene</div>
      <div class="cxd-loader-bar"><i></i></div>
    </div>
  `;
  root.appendChild(loader);
  const bar = loader.querySelector('.cxd-loader-bar i');
  if (embed) loader.style.display = 'none';

  const hud = createHud();
  const hints = createHints();
  const mock = createMock();
  const gear = document.createElement('button');
  gear.className = 'cxd-gear' + (embed ? ' cxd-gear-embed' : '');
  gear.type = 'button';
  gear.title = '背景设置 (G)';
  gear.setAttribute('aria-label', '背景设置');
  gear.setAttribute('aria-expanded', 'false');
  gear.innerHTML = GEAR_ICON;

  if (!embed) {
    root.append(hud, hints, mock);
  }
  uiLayer.appendChild(gear);

  const statusEl = hud.querySelector('.cxd-status-text');
  const setStatus = (text) => {
    if (statusEl) statusEl.textContent = text;
  };

  let panelRef = null;

  const assets = {
    videoUrl: null,
    imageUrl: null,
    modelUrl: null,
    sceneUrl: null,
    background: 'placeholder',
    model: 'placeholder',
  };

  let userAssets = { background: null, model: null, cleanup() {} };
  let assetQueue = Promise.resolve();

  function backgroundIsArtwork() {
    return assets.background === 'video' || assets.background === 'scene' || assets.background === 'image';
  }

  /**
   * A selected wallpaper owns the visual language. Keep it crisp and move the
   * config to the neutral desktop look once, then leave manual tuning alone.
   */
  function syncWallpaperMode({ applyLook = false } = {}) {
    const artwork = backgroundIsArtwork();
    root.classList.toggle('cxd-wallpaper', artwork);
    document.documentElement.dataset.cxdWallpaper = artwork ? 'on' : 'off';
    // The procedural crystal belongs to the generated themes, not to a photo.
    engine.setModelEnabled(!artwork);
    // Artwork mode drops the environment map, lights, particles and composer.
    engine.setArtworkMode(artwork);
    engine.setFit(config.fit);

    if (artwork && applyLook && !config.wallpaperMode) {
      applyWallpaperLook(config);
      config.wallpaperMode = true;
      saveConfig(config);
    } else if (!artwork && config.wallpaperMode) {
      config.wallpaperMode = false;
      // The wallpaper look is intentionally flatter than the procedural
      // themes. Restore the selected theme and a readable surface when the
      // artwork is removed so the two modes do not bleed into each other.
      applyTheme(config, config.theme);
      if (config.readability === 'wallpaper') {
        applyReadability(config, 'balanced');
      }
      saveConfig(config);
    }

    return artwork;
  }

  function queueAsset(work) {
    const next = assetQueue.then(work, work);
    assetQueue = next.catch(() => {});
    return next;
  }

  const api = {
    engine,
    config,
    get assets() {
      return { ...assets };
    },
    setConfig(next) {
      const patch = sanitizeConfigPatch(next);
      if (patch.theme) applyTheme(config, patch.theme);
      if (patch.readability && patch.readability !== 'custom') {
        applyReadability(config, patch.readability);
      }
      Object.assign(config, patch);
      syncWallpaperMode({ applyLook: true });
      engine.setConfig(config);
      saveConfig(config);
      syncUI();
      refreshFallbackTexture();
    },
    reset() {
      Object.assign(config, resetConfig());
      syncWallpaperMode({ applyLook: true });
      engine.setConfig(config);
      saveConfig(config);
      syncUI();
      refreshFallbackTexture();
    },
    openPanel() {
      setPanelOpen(true);
    },
    closePanel() {
      setPanelOpen(false);
    },
    togglePanel() {
      setPanelOpen(!config.showPanel);
    },
    dispose,
  };

  let fallbackToken = 0;
  async function refreshFallbackTexture() {
    if (!engine || assets.background !== 'placeholder') return;
    const token = ++fallbackToken;
    try {
      const image = createFallbackBackground(2048, 1152, getTheme(config.theme).palette);
      if (disposed || token !== fallbackToken || assets.background !== 'placeholder') return;
      await engine.setBackgroundImage(image);
    } catch (error) {
      console.warn('[codex-bg] fallback repaint failed', error);
    }
  }

  /** Stored user art wins over CLI/disk assets for the same slot. */
  function mergedAssets(probed) {
    const custom = userAssets.background;
    if (!custom && probed.active) {
      // The library manifest is a single explicit choice: do not let the
      // built-in scene or a stale candidate silently outrank it.
      const kind = String(probed.active.kind || probed.activeKind || '').toLowerCase();
      return {
        videoUrl: kind === 'video' ? probed.videoUrl : null,
        imageUrl: kind === 'image' ? probed.imageUrl : null,
        sceneUrl: kind === 'scene' ? probed.sceneUrl : null,
        sceneData: null,
        modelUrl: userAssets.model?.url || probed.modelUrl,
      };
    }
    return {
      videoUrl: custom ? (custom.kind === 'video' ? custom.url : null) : probed.videoUrl,
      imageUrl: custom ? (custom.kind === 'image' ? custom.url : null) : probed.imageUrl,
      sceneUrl: custom ? null : probed.sceneUrl,
      sceneData: custom ? null : probed.sceneData,
      modelUrl: userAssets.model?.url || probed.modelUrl,
    };
  }

  function backgroundLabel() {
    return assets.background === 'video'
      ? '视频'
      : assets.background === 'scene'
        ? '场景壁纸'
        : assets.background === 'image'
          ? '自定义图'
          : '程序化';
  }

  function updateStatus() {
    setStatus(`背景 ${backgroundLabel()} · 模型 ${assets.model === 'glb' ? 'GLB' : '占位'}`);
  }

  async function applyBackground(probed) {
    assets.videoUrl = probed.videoUrl || null;
    assets.imageUrl = probed.imageUrl || null;
    assets.sceneUrl = probed.sceneUrl || null;
    assets.background = 'placeholder';

    if (probed.videoUrl) {
      try {
        const video = await loadVideo(probed.videoUrl);
        await engine.setBackgroundVideo(video);
        startVideo(video);
        assets.background = 'video';
      } catch (error) {
        console.warn('[codex-bg] background video failed, trying next source', error);
        assets.videoUrl = null;
      }
    }

    if (assets.background !== 'video' && (probed.sceneData || probed.sceneUrl)) {
      try {
        const scene = await loadSceneWallpaper(probed.sceneUrl, probed.sceneData);
        engine.setSceneWallpaper(scene);
        assets.background = 'scene';
        assets.scene = scene.meta;
      } catch (error) {
        console.warn('[codex-bg] scene wallpaper failed, trying next source', error);
        assets.sceneUrl = null;
      }
    }

    if (assets.background !== 'video' && assets.background !== 'scene' && probed.imageUrl) {
      try {
        const img = await loadImage(probed.imageUrl);
        await engine.setBackgroundImage(img);
        assets.background = 'image';
      } catch (error) {
        console.warn('[codex-bg] background decode failed', error);
        assets.imageUrl = null;
      }
    }

    if (assets.background === 'placeholder') {
      await engine.setBackgroundImage(
        createFallbackBackground(2048, 1152, getTheme(config.theme).palette),
      );
    }

    updateStatus();
    return assets.background;
  }

  async function applyModel(url, options = {}) {
    if (!url) {
      engine.clearModel();
      assets.modelUrl = null;
      assets.model = 'placeholder';
      updateStatus();
      return 'placeholder';
    }

    try {
      const loading = engine.loadModel(url, options.onProgress);
      if (options.timeout) {
        await Promise.race([
          loading,
          sleep(options.timeout).then(() => {
            throw new Error('model load timeout');
          }),
        ]);
      } else {
        await loading;
      }
      assets.modelUrl = url;
      assets.model = 'glb';
      engine.setModelEnabled(true);
      updateStatus();
      return 'glb';
    } catch (error) {
      console.warn('[codex-bg] model load failed', error);
      if (options.strict) throw error;
      engine.clearModel();
      assets.modelUrl = null;
      assets.model = 'placeholder';
      updateStatus();
      return 'placeholder';
    }
  }

  async function reloadUserAssets() {
    const next = await loadUserAssetUrls();
    userAssets.cleanup();
    userAssets = next;
  }

  async function validatePickedAsset(slot, file) {
    const meta = describeAsset(file, slot);
    const tempUrl = URL.createObjectURL(file);
    try {
      if (slot === 'model') {
        await validateModelUrl(tempUrl, engine.renderer);
      } else if (meta.kind === 'video') {
        disposeMediaElement(await loadVideo(tempUrl));
      } else {
        await loadImage(tempUrl);
      }
    } catch (error) {
      console.warn('[codex-bg] asset validation failed', error);
      const reason =
        meta.kind === 'model'
          ? '模型文件已损坏，或不是有效的单文件 GLB'
          : meta.kind === 'video'
            ? '视频编码不受支持，或文件已损坏'
            : '图片编码不受支持，或文件已损坏';
      throw new Error(`素材无法加载：${reason}`);
    } finally {
      URL.revokeObjectURL(tempUrl);
    }
    return meta;
  }

  async function rollbackAssetRecord(slot, record) {
    try {
      await deleteAsset(slot);
      if (record) await restoreAssetRecord(record);
    } catch (error) {
      console.warn('[codex-bg] asset record rollback failed', error);
    }
  }

  async function restoreVisibleAsset(slot, previous) {
    try {
      const probed = await probeAssets();
      if (slot === 'model') {
        await applyModel(previous.model?.url || probed.modelUrl, { timeout: 15000 });
      } else {
        await applyBackground(mergedAssets(probed));
        syncWallpaperMode({ applyLook: true });
        engine.setConfig(config);
      }
    } catch (error) {
      console.warn('[codex-bg] visible asset rollback failed', error);
    }
  }

  /**
   * Validate first, then persist, then render. The old record and old object
   * URLs stay alive until the new asset has actually painted.
   */
  async function installUserAsset(slot, file) {
    const previous = userAssets;
    await validatePickedAsset(slot, file);

    const previousRecord = await getAssetRecord(slot);
    await saveAsset(slot, file);

    let loaded;
    try {
      loaded = await loadUserAssetUrls({ strict: true });
    } catch (error) {
      await rollbackAssetRecord(slot, previousRecord);
      throw error;
    }

    const other = slot === 'background' ? 'model' : 'background';
    loaded.cleanup([other]);

    const next = createUserAssetState(
      slot === 'background' ? loaded.background : previous.background,
      slot === 'model' ? loaded.model : previous.model,
    );
    userAssets = next;

    try {
      if (slot === 'model') {
        if (!next.model?.url) throw new Error('素材库没有返回模型文件');
        await applyModel(next.model.url, { strict: true, timeout: 60000 });
      } else {
        const expected = next.background?.kind;
        await applyBackground(mergedAssets(await probeAssets()));
        if (!expected || assets.background !== expected) {
          throw new Error('素材加载失败：编码可能不受支持，或文件已损坏');
        }
        syncWallpaperMode({ applyLook: true });
        engine.setConfig(config);
        panelRef?.sync();
      }
    } catch (error) {
      userAssets = previous;
      next.cleanup([slot]);
      await rollbackAssetRecord(slot, previousRecord);
      await restoreVisibleAsset(slot, previous);
      throw error;
    }

    previous.cleanup([slot]);
    updateStatus();
    panelRef?.refreshAssets();
  }

  async function clearUserAsset(slot) {
    const previous = userAssets;
    const previousRecord = await getAssetRecord(slot);
    if (!previousRecord) return;

    await deleteAsset(slot);

    const next = createUserAssetState(
      slot === 'background' ? null : previous.background,
      slot === 'model' ? null : previous.model,
    );
    userAssets = next;

    try {
      const probed = await probeAssets();
      if (slot === 'model') {
        await applyModel(probed.modelUrl || null, { timeout: 15000 });
      } else {
        await applyBackground(mergedAssets(probed));
        syncWallpaperMode({ applyLook: true });
        engine.setConfig(config);
        panelRef?.sync();
      }
    } catch (error) {
      userAssets = previous;
      await rollbackAssetRecord(slot, previousRecord);
      await restoreVisibleAsset(slot, previous);
      throw error;
    }

    previous.cleanup([slot]);
    updateStatus();
    panelRef?.refreshAssets();
  }

  // Background first so the first painted frame is not empty.
  try {
    await reloadUserAssets();
    const probed = await probeAssets();
    const effective = mergedAssets(probed);
    await applyBackground(effective);
    syncWallpaperMode({ applyLook: true });

    bar.style.width = '45%';
    setStatus(`背景 ${backgroundLabel()} · 模型加载中`);
    if (effective.modelUrl) {
      await applyModel(effective.modelUrl, {
        timeout: 15000,
        onProgress: (progress) => {
          bar.style.width = `${45 + Math.min(0.95, progress) * 50}%`;
        },
      });
    }
  } catch (error) {
    console.warn('[codex-bg] background probe failed', error);
    await engine.setBackgroundImage(
      createFallbackBackground(2048, 1152, getTheme(config.theme).palette),
    );
    assets.background = 'placeholder';
    syncWallpaperMode();
  }

  bar.style.width = '100%';
  updateStatus();

  engine.setConfig(config);
  let lastQuality = normalizeQuality(config.quality);
  const governor = new PerfGovernor({
    onDowngrade: (tier) => {
      config.quality = tier;
      lastQuality = tier;
      engine.setConfig(config);
      saveConfig(config);
      panelRef?.sync();
      updateTierLabel();
      setStatus(`性能不足，已自动降到「${qualityFor(tier).label}」`);
    },
  });

  function updateTierLabel() {
    if (!panelRef?.fps) return;
    const tier = qualityFor(config.quality);
    panelRef.fps.textContent = `${engine.fps || 0} FPS · ${tier.label}`;
  }

  engine.onFps = (fps) => {
    if (panelRef) panelRef.fps.textContent = `${fps} FPS · ${qualityFor(config.quality).label}`;
    governor.sample(fps, config.quality, Boolean(config.autoQuality));
    try {
      window.__CXD_STATS__ = {
        ...engine.stats(),
        fps,
        autoDowngraded: governor.applied,
      };
    } catch {
      /* ignore */
    }
  };
  updateTierLabel();

  panelRef = createPanel(
    config,
    {
      onChange: () => {
        const tier = normalizeQuality(config.quality);
        if (tier !== lastQuality) {
          lastQuality = tier;
          governor.reset();
        }
        engine.setConfig(config);
        engine.setFit(config.fit);
        saveConfig(config);
        applyVisibility();
        refreshFallbackTexture();
        updateTierLabel();
      },
      onReset: () => {
        const wasOpen = Boolean(config.showPanel);
        Object.assign(config, resetConfig(), { showPanel: wasOpen });
        syncWallpaperMode({ applyLook: true });
        engine.setConfig(config);
        saveConfig(config);
        panelRef.sync();
        applyVisibility();
        refreshFallbackTexture();
      },
      onImport: (data) => {
        const patch = sanitizeConfigPatch(data);
        const wasOpen = Boolean(config.showPanel);
        const next = { ...DEFAULTS };
        if (patch.theme) applyTheme(next, patch.theme);
        if (patch.readability && patch.readability !== 'custom') {
          applyReadability(next, patch.readability);
        }
        Object.keys(config).forEach((key) => delete config[key]);
        Object.assign(config, next, patch, { showPanel: wasOpen });
        if (embed) config.codexMock = false;
        syncWallpaperMode({ applyLook: true });
        engine.setConfig(config);
        saveConfig(config);
        panelRef.sync();
        applyVisibility();
        refreshFallbackTexture();
      },
      onAsset: async (slot, file) => {
        await queueAsset(() => installUserAsset(slot, file));
      },
      onClearAsset: async (slot) => {
        await queueAsset(() => clearUserAsset(slot));
      },
      onWorkshopApplied: async () => {
        const previous = userAssets;
        userAssets = createUserAssetState(null, previous.model);
        previous.cleanup(['background']);
        await queueAsset(async () => {
          const probed = await probeAssets();
          await applyBackground(mergedAssets(probed));
          syncWallpaperMode({ applyLook: true });
          engine.setConfig(config);
          updateStatus();
        });
        panelRef?.refreshAssets();
      },
      getAssetSummary: () => ({
        kind: assets.background,
        background: userAssets.background
          ? `${userAssets.background.name} · ${formatBytes(userAssets.background.size)}`
          : backgroundFallbackLabel(),
        backgroundCustom: Boolean(userAssets.background),
        backgroundArtwork: backgroundIsArtwork(),
        model: userAssets.model
          ? `${userAssets.model.name} · ${formatBytes(userAssets.model.size)}`
          : modelFallbackLabel(),
        modelCustom: Boolean(userAssets.model),
      }),
    },
    {
      compact: embed,
      subtitle: embed ? '嵌入模式 · 实时生效' : 'Codex Dynamic Background',
    },
  );
  uiLayer.appendChild(panelRef.panel);

  function backgroundFallbackLabel() {
    const labels = {
      video: '项目背景 / 视频',
      scene: '项目背景 / 场景壁纸',
      image: '项目背景 / 图片',
    };
    return labels[assets.background] || '程序化背景';
  }

  function modelFallbackLabel() {
    return assets.model === 'glb' ? '项目模型 / GLB' : '项目模型 / 占位水晶';
  }

  function syncPanelState() {
    if (!panelRef) return;
    const open = Boolean(config.showPanel);
    panelRef.panel.dataset.open = String(open);
    panelRef.panel.inert = !open;
    panelRef.panel.setAttribute('aria-hidden', String(!open));
    gear.classList.toggle('on', open);
    gear.setAttribute('aria-expanded', String(open));
  }

  function setPanelOpen(open, persist = true) {
    const restoreGearFocus = Boolean(
      !open && document.activeElement && panelRef?.panel.contains(document.activeElement),
    );
    config.showPanel = Boolean(open);
    if (persist) saveConfig(config);
    syncPanelState();
    if (open) {
      panelRef?.panel.querySelector('[data-close]')?.focus({ preventScroll: true });
    } else if (restoreGearFocus) {
      gear.focus({ preventScroll: true });
    }
  }

  function applyVisibility() {
    syncWallpaperMode();
    mock.style.display = config.codexMock && !embed ? '' : 'none';
    const surface = clamp(Number(config.surfaceOpacity ?? 0.22), 0, 1);
    if (embed) {
      // Real Codex panels read these custom properties from CXD_CODEX_CSS.
      const doc = document.documentElement;
      doc.style.setProperty('--cxd-ui-surface', `rgba(9, 13, 17, ${surface.toFixed(3)})`);
      doc.style.setProperty(
        '--cxd-ui-surface-strong',
        `rgba(12, 17, 21, ${Math.min(1, surface * 1.35).toFixed(3)})`,
      );
      // Light Codex themes use dark text, so a white frost keeps labels readable
      // while still letting the wallpaper colors through. Dark themes get the
      // opposite tint. The slider scales both.
      const light = doc.dataset.theme !== 'dark';
      // Keep the frost light enough that the wallpaper reads as a wallpaper,
      // not as a white sheet. The slider still scales it up for readability.
      const alpha = clamp(0.04 + surface * 0.55, 0.03, 0.72);
      doc.style.setProperty(
        '--cxd-panel-tint',
        light
          ? `rgba(255, 255, 255, ${alpha.toFixed(3)})`
          : `rgba(9, 13, 17, ${clamp(alpha * 1.6, 0.1, 0.9).toFixed(3)})`,
      );
      const composerAlpha = clamp(0.02 + surface * 0.4, 0.02, 0.55);
      doc.style.setProperty(
        '--cxd-composer-tint',
        light
          ? `rgba(255, 255, 255, ${composerAlpha.toFixed(3)})`
          : `rgba(9, 13, 17, ${clamp(composerAlpha * 2.2, 0.06, 0.8).toFixed(3)})`,
      );
      doc.style.setProperty(
        '--cxd-composer-border',
        light ? 'rgba(255, 255, 255, 0.3)' : 'rgba(255, 255, 255, 0.1)',
      );
    } else {
      // Mirror the real Codex panel alphas so the preview matches injection.
      mock.style.setProperty('--cxd-surface-top', surface.toFixed(3));
      mock.style.setProperty('--cxd-surface-bottom', Math.min(1, surface * 1.35).toFixed(3));
    }
    hud.style.display = config.codexMock && !embed ? 'none' : '';
    syncPanelState();
  }

  function syncUI() {
    if (panelRef) panelRef.sync();
    applyVisibility();
  }

  applyVisibility();
  engine.start();

  setTimeout(() => loader.classList.add('done'), 650);
  setTimeout(() => loader.remove(), 1600);

  const togglePanel = () => setPanelOpen(!config.showPanel);

  gear.addEventListener('click', togglePanel);
  panelRef.panel.querySelector('[data-close]').addEventListener('click', () => {
    setPanelOpen(false);
  });

  const onKeyDown = (event) => {
    if (event.defaultPrevented) return;
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (isTypingTarget(event.target)) return;
    const key = event.key.toLowerCase();
    if (key === 'g') {
      event.preventDefault();
      togglePanel();
      return;
    }
    if (!embed && key === 'h') {
      event.preventDefault();
      root.classList.toggle('ui-hidden');
      return;
    }
    if (key === 'escape' && config.showPanel) {
      event.preventDefault();
      setPanelOpen(false);
    }
  };
  window.addEventListener('keydown', onKeyDown, true);

  if (!embed) {
    root.addEventListener('pointerdown', (event) => {
      if (event.target.closest('.cxd-panel, .cxd-gear')) return;
      const ripple = document.createElement('span');
      ripple.className = 'cxd-ripple';
      const rect = root.getBoundingClientRect();
      ripple.style.left = `${event.clientX - rect.left}px`;
      ripple.style.top = `${event.clientY - rect.top}px`;
      root.appendChild(ripple);
      setTimeout(() => ripple.remove(), 950);
    });
  }

  window.cxdBg = api;
  window.dispatchEvent(new CustomEvent('cxdbg-ready', { detail: api }));

  function dispose() {
    if (disposed) return;
    disposed = true;
    window.removeEventListener('keydown', onKeyDown, true);
    try {
      userAssets.cleanup();
    } catch {
      /* ignore */
    }
    try {
      engine?.dispose();
    } catch (error) {
      console.warn('[codex-bg] dispose failed', error);
    }
    root.remove();
    if (uiLayer !== root) uiLayer.remove();
    delete document.documentElement.dataset.cxdWallpaper;
    document.body.classList.remove('cxd-embedded');
    if (window.cxdBg === api) {
      delete window.cxdBg;
    }
  }

  return api;
}
