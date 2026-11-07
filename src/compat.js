/**
 * Codex is an Electron app whose class names are hashed and whose React tree
 * changes between releases. Keep the selectors in one place, try every known
 * variant, and report a partial match instead of silently painting a white
 * panel when a future build renames a surface.
 *
 * `required` surfaces are always on screen and drive the health number.
 * Optional surfaces only appear on some pages (settings dialog, archived
 * threads, plug-ins), so they are reported separately instead of turning
 * every page into a permanent warning.
 */
export const COMPAT_SURFACES = [
  {
    id: 'shell',
    label: '主界面',
    required: true,
    selectors: [
      'main.main-surface',
      'main[data-app-shell-main-surface]',
      '[data-app-shell-focus-area="main"]',
      '[data-app-shell-main-surface="default"]',
    ],
  },
  {
    id: 'sidebar',
    label: '左侧栏',
    required: true,
    selectors: [
      'aside.app-shell-left-panel',
      'aside[data-testid="app-shell-floating-left-panel"]',
      'aside[data-testid*="left-panel"]',
      'aside[data-app-shell-focus-area="left-panel"]',
    ],
  },
  {
    id: 'composer',
    label: '输入框',
    required: true,
    selectors: [
      '[class*="ComposerLayoutRoot"]',
      '[data-testid*="composer"]',
      '[data-thread-scroll-footer]',
    ],
  },
  {
    id: 'pageSurface',
    label: '页面容器',
    required: false,
    selectors: [
      '[data-app-shell-page-surface]',
      '[class*="PageSurface-"]',
    ],
  },
  {
    id: 'mainContent',
    label: '主内容区',
    required: false,
    selectors: [
      '[class*="MainContentSurface-"]',
      '[data-codex-history-swipe-page]',
      '[class*="MainContentClip-"]',
    ],
  },
  {
    id: 'transcript',
    label: '对话区',
    required: false,
    selectors: [
      '[data-thread-find-target="conversation"]',
      '[class*="transcriptContent-"]',
      '[data-thread-user-message-navigation-content]',
    ],
  },
  {
    id: 'dialog',
    label: '设置/弹窗',
    required: false,
    selectors: [
      '[role="dialog"]',
      '[data-testid*="settings"]',
      '[data-testid*="modal"]',
    ],
  },
  {
    id: 'featureNav',
    label: '功能导航',
    required: false,
    selectors: ['[data-app-shell-feature-navigation]'],
  },
  {
    id: 'portal',
    label: '浮层门户',
    required: false,
    selectors: [
      '[data-mcp-app-portal-target]',
      '[data-above-composer-portal]',
    ],
  },
  {
    id: 'toast',
    label: '提示条',
    required: false,
    selectors: ['[class*="codex-toast-area"]', '[data-sonner-toaster]'],
  },
];

const REQUIRED = COMPAT_SURFACES.filter((surface) => surface.required !== false);

function matchesAny(doc, selectors) {
  for (const selector of selectors) {
    try {
      if (doc.querySelector(selector)) return true;
    } catch {
      /* invalid selector in an older build — keep trying the rest */
    }
  }
  return false;
}

export function inspectCompat(doc = globalThis.document) {
  if (!doc || typeof doc.querySelector !== 'function') {
    return {
      status: 'unknown',
      matched: 0,
      total: REQUIRED.length,
      missing: REQUIRED.map((surface) => surface.label),
      optionalMissing: [],
      surfaces: [],
      fallback: [],
    };
  }

  const surfaces = COMPAT_SURFACES.map((surface) => ({
    id: surface.id,
    label: surface.label,
    required: surface.required !== false,
    present: matchesAny(doc, surface.selectors),
  }));
  const missing = surfaces
    .filter((surface) => surface.required && !surface.present)
    .map((surface) => surface.label);
  const optionalMissing = surfaces
    .filter((surface) => !surface.required && !surface.present)
    .map((surface) => surface.label);
  const matched = surfaces.filter((surface) => surface.required && surface.present).length;

  return {
    status: matched === REQUIRED.length ? 'ok' : 'partial',
    matched,
    total: REQUIRED.length,
    missing,
    optionalMissing,
    surfaces,
    fallback: [],
  };
}

/* ------------------------------------------------------------------ */
/* Heuristic fallback                                                  */
/* ------------------------------------------------------------------ */

function parseAlpha(color) {
  if (!color) return 0;
  if (color === 'transparent') return 0;
  const rgba = /rgba?\(([^)]+)\)/.exec(color);
  if (!rgba) return 1;
  const parts = rgba[1].split(/[,/]/).map((part) => part.trim());
  return parts.length >= 4 ? Number(parts[3]) : 1;
}

function opaque(element, view) {
  try {
    const cs = view.getComputedStyle(element);
    if (!cs) return false;
    if (cs.backgroundImage && cs.backgroundImage !== 'none') return true;
    return parseAlpha(cs.backgroundColor) >= 0.5;
  } catch {
    return false;
  }
}

function areaRatio(element, view) {
  const rect = element.getBoundingClientRect?.();
  if (!rect) return 0;
  return (rect.width * rect.height) / Math.max(1, view.width * view.height);
}

function insideNuvio(element) {
  return Boolean(element.closest?.('.cxd-root, #cxd-bg-root, .cxd-panel'));
}

/**
 * When Codex renames a class the painted surface is still in the DOM: a big
 * opaque rectangle with the same geometry. Mark the best candidates with
 * `data-cxd-surface-fallback` so CXD_CODEX_CSS can neutralise only the paint,
 * never layout, and only for a surface whose primary selector is gone.
 */
export function applyCompatFallbacks(doc = globalThis.document, view = globalThis) {
  if (!doc || typeof doc.querySelectorAll !== 'function') return [];
  if (typeof view.getComputedStyle !== 'function') return [];
  const width = Number(view.innerWidth) || 0;
  const height = Number(view.innerHeight) || 0;
  if (width < 200 || height < 200) return [];

  const state = inspectCompat(doc);
  const missing = new Set(
    state.surfaces.filter((surface) => surface.required && !surface.present).map((s) => s.id),
  );
  if (!missing.size) return [];

  let candidates;
  try {
    candidates = [...doc.querySelectorAll('body *')].slice(0, 6000);
  } catch {
    return [];
  }

  const applied = [];
  const take = (id, predicate) => {
    if (!missing.has(id)) return;
    let best = null;
    let bestScore = 0;
    for (const element of candidates) {
      if (insideNuvio(element)) continue;
      if (element.hasAttribute?.('data-cxd-surface-fallback')) continue;
      if (!opaque(element, view)) continue;
      const score = predicate(element);
      if (score > bestScore) {
        best = element;
        bestScore = score;
      }
    }
    if (best) {
      best.setAttribute('data-cxd-surface-fallback', id);
      applied.push(id);
    }
  };

  take('shell', (element) => {
    const ratio = areaRatio(element, { width, height });
    if (ratio < 0.45) return 0;
    const tag = element.tagName?.toLowerCase();
    return ratio + (tag === 'main' ? 0.5 : 0);
  });

  take('sidebar', (element) => {
    const rect = element.getBoundingClientRect?.();
    if (!rect) return 0;
    if (rect.width < 120 || rect.width > width * 0.35) return 0;
    if (rect.height < height * 0.55) return 0;
    if (rect.left > 8) return 0;
    return (rect.width * rect.height) / Math.max(1, width * height);
  });

  take('composer', (element) => {
    const rect = element.getBoundingClientRect?.();
    if (!rect) return 0;
    if (rect.width < width * 0.3) return 0;
    if (rect.bottom < height * 0.7) return 0;
    return (rect.width * rect.height) / Math.max(1, width * height);
  });

  return applied;
}

export function installCompatProbe(doc, onUpdate, { intervalMs = 5000 } = {}) {
  let lastKey = '';
  const run = () => {
    const state = inspectCompat(doc);
    state.fallback = applyCompatFallbacks(doc, globalThis);
    if (state.fallback.length) state.status = 'partial';
    const key = JSON.stringify([
      state.status,
      state.missing,
      state.fallback,
      state.optionalMissing,
    ]);
    if (doc?.documentElement) doc.documentElement.dataset.cxdCompat = state.status;
    if (key !== lastKey) {
      lastKey = key;
      try {
        onUpdate?.(state);
      } catch (error) {
        console.warn('[codex-bg] compat probe callback failed', error);
      }
    }
    return state;
  };
  run();
  const timer = setInterval(run, Math.max(1000, Number(intervalMs) || 5000));
  timer.unref?.();
  const stop = () => clearInterval(timer);
  // Callers historically used both `probe()` and `probe.stop()`; support both
  // so a dispose path can never leave the 5s timer running.
  stop.stop = stop;
  return stop;
}
