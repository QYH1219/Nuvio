/**
 * Codex is an Electron app whose class names are hashed and whose React tree
 * changes between releases. Keep the selectors in one place, try every known
 * variant, and report a partial match instead of silently painting a white
 * panel when a future build renames a surface.
 */
export const COMPAT_SURFACES = [
  {
    id: 'shell',
    label: '主界面',
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
    selectors: [
      '[class*="ComposerLayoutRoot"]',
      '[data-testid*="composer"]',
      '[data-thread-scroll-footer]',
    ],
  },
];

export function inspectCompat(doc = globalThis.document) {
  if (!doc || typeof doc.querySelector !== 'function') {
    return {
      status: 'unknown',
      matched: 0,
      total: COMPAT_SURFACES.length,
      missing: COMPAT_SURFACES.map((surface) => surface.label),
      checkedAt: Date.now(),
    };
  }
  const missing = [];
  let matched = 0;
  for (const surface of COMPAT_SURFACES) {
    const found = surface.selectors.some((selector) => {
      try {
        return Boolean(doc.querySelector(selector));
      } catch {
        return false;
      }
    });
    if (found) matched += 1;
    else missing.push(surface.label);
  }
  return {
    status: missing.length ? 'partial' : 'ok',
    matched,
    total: COMPAT_SURFACES.length,
    missing,
    checkedAt: Date.now(),
  };
}

/**
 * Re-check after React re-renders. Returns a stop function so unmounting the
 * skin does not leave a polling timer behind in Codex.
 */
export function installCompatProbe(doc, onUpdate, { intervalMs = 5000 } = {}) {
  let lastKey = '';
  let debounce = 0;
  const run = () => {
    const result = inspectCompat(doc);
    const key = `${result.status}:${result.missing.join(',')}:${result.matched}`;
    try {
      if (doc?.documentElement) doc.documentElement.dataset.cxdCompat = result.status;
    } catch {
      /* ignore */
    }
    if (key !== lastKey) {
      lastKey = key;
      onUpdate?.(result);
    }
    return result;
  };

  run();
  const timer = setInterval(run, intervalMs);
  let observer = null;
  if (doc?.body && typeof MutationObserver !== 'undefined') {
    observer = new MutationObserver(() => {
      clearTimeout(debounce);
      debounce = setTimeout(run, 300);
    });
    observer.observe(doc.body, { childList: true, subtree: true });
  }

  return {
    refresh: run,
    stop() {
      clearInterval(timer);
      clearTimeout(debounce);
      observer?.disconnect();
    },
  };
}
