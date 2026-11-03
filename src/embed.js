import css from './style.css?inline';
import { mount } from './mount.js';

const CXD_CODEX_CSS = String.raw`
html[data-cxd-background] body {
  isolation: isolate;
  background-color: transparent !important;
}

html[data-cxd-background] body :is(
  main.main-surface,
  [data-app-shell-main-surface="default"]
) {
  background-color: var(--cxd-ui-surface, rgba(9, 13, 17, 0.48)) !important;
}

html[data-cxd-background] body :is(
  aside.app-shell-left-panel,
  aside[data-testid="app-shell-floating-left-panel"].bg-surface,
  aside[data-app-shell-focus-area="right-panel"]
) {
  background-color: var(--cxd-ui-surface-strong, rgba(12, 17, 21, 0.66)) !important;
}

html[data-cxd-background] body :is(
  aside[data-app-shell-focus-area="right-panel"] .bg-surface,
  [data-app-shell-header-edge-scroll],
  .thread-scroll-container[data-app-action-timeline-scroll]
) {
  background-color: transparent !important;
}

/* Settings and utility pages share the shell but use a different surface. */
html[data-cxd-background] body :is(
  main.main-surface,
  [data-app-shell-main-surface="default"]
):has(
  [data-app-shell-focus-area="main"] > div > div[class*="electron\:bg-surface"][class*="rounded-tl-lg"]
) {
  background-color: transparent !important;
  background-image: none !important;
}

html[data-cxd-background] body .thread-scroll-container[data-app-action-timeline-scroll] [class*="bg-gradient-to-t"],
html[data-cxd-background] body [data-thread-scroll-footer="true"] [class*="bg-gradient-to-t"],
html[data-cxd-background] body [data-above-composer-portal] [class*="bg-gradient-to-t"] {
  background-image: none !important;
}

html[data-cxd-background] [data-cxd-background-layer] {
  position: fixed !important;
  inset: 0 !important;
  width: 100vw !important;
  height: 100vh !important;
  z-index: -1 !important;
  pointer-events: none !important;
  contain: strict;
  overflow: hidden !important;
  background: #030509;
}

html[data-cxd-background] [data-cxd-background-layer] > * {
  position: absolute !important;
  inset: 0 !important;
  width: 100% !important;
  height: 100% !important;
  pointer-events: none !important;
}
`;

function ensureStyle(id, text) {
  const old = document.getElementById(id);
  if (old) old.remove();
  const style = document.createElement('style');
  style.id = id;
  style.textContent = text;
  document.head.appendChild(style);
}

function disposeExisting() {
  if (window.cxdBg && typeof window.cxdBg.dispose === 'function') {
    try {
      window.cxdBg.dispose();
    } catch (error) {
      console.warn('[codex-bg] previous instance cleanup failed', error);
    }
  }
  document.getElementById('cxd-bg-root')?.remove();
}

ensureStyle('cxd-bg-style', css);
ensureStyle('cxd-bg-codex-style', CXD_CODEX_CSS);
disposeExisting();

const html = document.documentElement;
html.dataset.cxdBackground = 'on';
html.style.setProperty('--cxd-ui-surface', 'rgba(9, 13, 17, 0.48)');
html.style.setProperty('--cxd-ui-surface-strong', 'rgba(12, 17, 21, 0.66)');

let host = document.getElementById('cxd-bg-root');
if (!host) {
  host = document.createElement('div');
  host.id = 'cxd-bg-root';
  host.dataset.cxdBackgroundLayer = '';
  host.style.cssText = 'position:fixed;inset:0;z-index:-1;pointer-events:none;contain:strict;';
  document.body.appendChild(host);
}

window.__CXD_EMBED__ = true;
mount(host, { embed: true });
