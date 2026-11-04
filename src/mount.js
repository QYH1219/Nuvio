import { clamp, loadConfig, saveConfig, resetConfig } from './config.js';
import {
  probeAssets,
  loadImage,
  loadVideo,
  loadSceneWallpaper,
  startVideo,
  createFallbackBackground,
} from './assets.js';
import { BackgroundEngine } from './scene.js';
import { createHud, createHints, createPanel, createMock } from './ui.js';

const params = new URLSearchParams(location.search);

const GEAR_ICON = `
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
    <circle cx="12" cy="12" r="3.2"></circle>
    <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1 1.55V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.11-1.55 1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.7 1.7 0 0 0 .34-1.87 1.7 1.7 0 0 0-1.55-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.55-1.11 1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.7 1.7 0 0 0 1.87.34H9a1.7 1.7 0 0 0 1-1.55V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.55 1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.34 1.87V9a1.7 1.7 0 0 0 1.55 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"></path>
  </svg>
`;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
    return { engine: null, config, error };
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
  gear.className = 'cxd-gear';
  gear.type = 'button';
  gear.title = '背景设置 (G)';
  gear.innerHTML = GEAR_ICON;

  if (!embed) {
    root.append(hud, hints, mock, gear);
  }

  const statusEl = hud.querySelector('.cxd-status-text');
  const setStatus = (text) => {
    if (statusEl) statusEl.textContent = text;
  };

  let panelRef = null;
  const api = {
    engine,
    config,
    get assets() {
      return { ...assets };
    },
    setConfig(next) {
      Object.assign(config, next);
      engine.setConfig(config);
      saveConfig(config);
      syncUI();
    },
    reset() {
      Object.assign(config, resetConfig());
      engine.setConfig(config);
      syncUI();
    },
    dispose,
  };

  const assets = {
    videoUrl: null,
    imageUrl: null,
    modelUrl: null,
    sceneUrl: null,
    background: 'placeholder',
    model: 'placeholder',
  };

  // Background first so the first painted frame is not empty.
  try {
    const probed = await probeAssets();
    Object.assign(assets, probed);
    if (probed.videoUrl) {
      try {
        const video = await loadVideo(probed.videoUrl);
        await engine.setBackgroundVideo(video);
        startVideo(video);
        assets.background = 'video';
      } catch (error) {
        console.warn('[codex-bg] background video failed, trying image', error);
        assets.videoUrl = null;
      }
    }
    if (assets.background !== 'video' && probed.sceneUrl) {
      try {
        const scene = await loadSceneWallpaper(probed.sceneUrl);
        engine.setSceneWallpaper(scene);
        assets.background = 'scene';
        assets.scene = scene.meta;
      } catch (error) {
        console.warn('[codex-bg] scene wallpaper failed, trying image', error);
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
        await engine.setBackgroundImage(createFallbackBackground());
        assets.background = 'placeholder';
      }
    } else if (assets.background !== 'video' && assets.background !== 'scene') {
      await engine.setBackgroundImage(createFallbackBackground());
      assets.background = 'placeholder';
    }
  } catch (error) {
    console.warn('[codex-bg] background probe failed', error);
    await engine.setBackgroundImage(createFallbackBackground());
  }

  bar.style.width = '45%';
  setStatus(
    `背景 ${
      assets.background === 'video'
        ? '视频'
        : assets.background === 'scene'
          ? '场景壁纸'
        : assets.background === 'image'
          ? '自定义图'
          : '程序化'
    } · 模型加载中`,
  );

  if (assets.modelUrl) {
    try {
      await Promise.race([
        engine.loadModel(assets.modelUrl, (progress) => {
          bar.style.width = `${45 + Math.min(0.95, progress) * 50}%`;
        }),
        sleep(15000),
      ]);
      assets.model = 'glb';
    } catch (error) {
      console.warn('[codex-bg] model load failed, keeping placeholder', error);
      assets.model = 'placeholder';
    }
  }

  bar.style.width = '100%';
  setStatus(
    `背景 ${
      assets.background === 'video'
        ? '视频'
        : assets.background === 'scene'
          ? '场景壁纸'
        : assets.background === 'image'
          ? '自定义图'
          : '程序化'
    } · 模型 ${
      assets.model === 'glb' ? 'GLB' : '占位'
    }`,
  );

  engine.setConfig(config);
  engine.onFps = (fps) => {
    if (panelRef) panelRef.fps.textContent = `${fps} FPS`;
  };

  if (!embed) {
    panelRef = createPanel(
      config,
      () => {
        engine.setConfig(config);
        saveConfig(config);
        applyVisibility();
      },
      () => {
        Object.assign(config, resetConfig());
        engine.setConfig(config);
        panelRef.sync();
        applyVisibility();
      },
    );
    root.appendChild(panelRef.panel);
    panelRef.panel.dataset.open = String(Boolean(config.showPanel));
  }

  function applyVisibility() {
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
    } else {
      // Mirror the real Codex panel alphas so the preview matches injection.
      mock.style.setProperty('--cxd-surface-top', surface.toFixed(3));
      mock.style.setProperty('--cxd-surface-bottom', Math.min(1, surface * 1.35).toFixed(3));
    }
    hud.style.display = config.codexMock && !embed ? 'none' : '';
    if (panelRef) panelRef.panel.dataset.open = String(Boolean(config.showPanel));
  }

  function syncUI() {
    if (panelRef) panelRef.sync();
    applyVisibility();
  }

  applyVisibility();
  engine.start();

  setTimeout(() => loader.classList.add('done'), 650);
  setTimeout(() => loader.remove(), 1600);

  if (!embed) {
    const togglePanel = () => {
      config.showPanel = !config.showPanel;
      saveConfig(config);
      if (panelRef) panelRef.panel.dataset.open = String(config.showPanel);
    };

    gear.addEventListener('click', togglePanel);
    panelRef.panel.querySelector('[data-close]').addEventListener('click', () => {
      config.showPanel = false;
      saveConfig(config);
      panelRef.panel.dataset.open = 'false';
    });

    window.addEventListener('keydown', (event) => {
      if (event.target instanceof HTMLInputElement) return;
      const key = event.key.toLowerCase();
      if (key === 'g') togglePanel();
      if (key === 'h') root.classList.toggle('ui-hidden');
      if (key === 'escape' && config.showPanel) {
        config.showPanel = false;
        panelRef.panel.dataset.open = 'false';
      }
    });

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
    try {
      engine?.dispose();
    } catch (error) {
      console.warn('[codex-bg] dispose failed', error);
    }
    root.remove();
    document.body.classList.remove('cxd-embedded');
    if (window.cxdBg === api) {
      delete window.cxdBg;
    }
  }

  return api;
}
