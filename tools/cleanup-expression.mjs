export function buildCleanupExpression({ keepConfig = false } = {}) {
  return `(() => {
    const keepConfig = ${keepConfig ? 'true' : 'false'};
    const result = { disposed: false, roots: 0, styles: 0, uiHosts: 0 };
    try {
      if (window.cxdBg && typeof window.cxdBg.dispose === 'function') {
        window.cxdBg.dispose();
        result.disposed = true;
      }
    } catch (error) {
      result.error = String(error);
    }
    for (const id of ['cxd-bg-root']) {
      const el = document.getElementById(id);
      if (el) { el.remove(); result.roots += 1; }
    }
    document.querySelectorAll('.cxd-ui-layer').forEach((el) => {
      el.remove();
      result.uiHosts += 1;
    });
    for (const id of ['cxd-bg-style', 'cxd-bg-codex-style']) {
      const el = document.getElementById(id);
      if (el) { el.remove(); result.styles += 1; }
    }
    document.documentElement.removeAttribute('data-cxd-background');
    document.documentElement.style.removeProperty('--cxd-ui-surface');
    document.documentElement.style.removeProperty('--cxd-ui-surface-strong');
    document.body.classList.remove('cxd-embedded');
    try { delete window.__CXD_ASSET_BASE__; } catch {}
    try { delete window.__CXD_ASSETS__; } catch {}
    try { delete window.__CXD_EMBED__; } catch {}
    if (!keepConfig) {
      try { localStorage.removeItem('codex-dynamic-bg:v2'); } catch {}
    }
    return result;
  })()`;
}
