import css from './style.css?inline';
import { mount } from './mount.js';

const CXD_CODEX_CSS = String.raw`
html[data-cxd-background],
html[data-cxd-background] body,
html[data-cxd-background] #root {
  isolation: isolate;
  background-color: transparent !important;
}

html[data-cxd-background] body main {
  background-color: transparent !important;
  background-image: none !important;
}

/* Codex applies a frosted-glass blur to its shell; with a wallpaper behind it
   that reads as "muddy" and hides the artwork. Keep the tint, drop the blur. */
html[data-cxd-background] body,
html[data-cxd-background] body :is(
  main.main-surface,
  [data-app-shell-main-surface="default"],
  aside.app-shell-left-panel,
  aside[data-testid="app-shell-floating-left-panel"].bg-surface,
  aside[data-app-shell-focus-area="right-panel"],
  [data-app-shell-header-edge-scroll],
  .thread-scroll-container[data-app-action-timeline-scroll]
) {
  backdrop-filter: none !important;
  -webkit-backdrop-filter: none !important;
}

/* Base tint only applies outside wallpaper mode. Inside wallpaper mode the
   dedicated rules below own these surfaces; keeping both would let this
   higher-specificity :is() list win and paint the panel solid again. */
html[data-cxd-background]:not([data-cxd-wallpaper="on"]) body :is(
  main.main-surface,
  [data-app-shell-main-surface="default"]
) {
  background-color: var(--cxd-ui-surface, rgba(9, 13, 17, 0.22)) !important;
}

html[data-cxd-background]:not([data-cxd-wallpaper="on"]) body :is(
  aside.app-shell-left-panel,
  aside[data-testid="app-shell-floating-left-panel"].bg-surface,
  aside[data-app-shell-focus-area="right-panel"]
) {
  background-color: var(--cxd-ui-surface-strong, rgba(12, 17, 21, 0.3)) !important;
}

html[data-cxd-background] body :is(
  aside[data-app-shell-focus-area="right-panel"] .bg-surface,
  [data-app-shell-header-edge-scroll],
  .thread-scroll-container[data-app-action-timeline-scroll]
) {
  background-color: transparent !important;
}

/* Desktop wallpaper mode. Codex paints its shell with several stacked opaque
   surfaces and pseudo-elements; lowering only the top-level alpha still leaves
   the wallpaper buried. Turn those specific layers off, but keep menus, dialogs
   and code blocks opaque so the result stays usable. */
html[data-cxd-wallpaper="on"] {
  /* Light themes need a white frost, dark themes a dark one. mount.js
     overwrites this with the user's surface-opacity slider. */
  --cxd-panel-tint: rgba(255, 255, 255, 0.16);
  --cxd-panel-hover: rgba(15, 23, 32, 0.07);
}

html[data-cxd-wallpaper="on"][data-theme="dark"] {
  --cxd-panel-tint: rgba(9, 13, 17, 0.34);
  --cxd-panel-hover: rgba(255, 255, 255, 0.08);
}

html[data-cxd-wallpaper="on"] body :is(
  main.main-surface,
  main[data-app-shell-main-surface],
  [data-app-shell-focus-area="main"]
) {
  background-color: var(--cxd-ui-surface, rgba(9, 13, 17, 0.08)) !important;
  background-image: none !important;
}

html[data-cxd-wallpaper="on"] body [data-app-shell-main-surface="default"] > div::before,
html[data-cxd-wallpaper="on"] body [class*="WorkspaceContent"]::before {
  display: none !important;
  background: transparent !important;
  background-image: none !important;
}

html[data-cxd-wallpaper="on"] body .sidebar-navigation:not(
    .sidebar-navigation .sidebar-navigation
  ) {
  background-color: var(--cxd-panel-tint, rgba(255, 255, 255, 0.16)) !important;
  background-image: none !important;
  backdrop-filter: none !important;
  -webkit-backdrop-filter: none !important;
}

/* The sidebar stacks a second surface inside .sidebar-navigation. Flatten every
   surface token there so the artwork reaches the window edge, then restore a
   subtle hover/selection tint for interaction feedback. */
html[data-cxd-wallpaper="on"] body :is(
  aside.app-shell-left-panel,
  aside[data-testid="app-shell-floating-left-panel"],
  aside[data-app-shell-focus-area="left-panel"]
) {
  background-color: transparent !important;
  background-image: none !important;
  backdrop-filter: none !important;
  -webkit-backdrop-filter: none !important;
}

/* Codex also paints the left panel through an inline/cascade rule that the
   generic :is() selector above can lose to. Dedicated selectors keep the
   wallpaper visible all the way to the window edge. */
html[data-cxd-wallpaper="on"] body aside.app-shell-left-panel,
html[data-cxd-wallpaper="on"] body aside[data-testid="app-shell-floating-left-panel"],
html[data-cxd-wallpaper="on"] body aside[data-app-shell-focus-area="left-panel"] {
  background-color: transparent !important;
  background-image: none !important;
}

/* Compatibility fallback for builds that keep the stable data-testid prefix
   but rename the component class. These three surfaces are the ones that
   historically produced the white sidebar / white composer / white seam. */
html[data-cxd-wallpaper="on"] body :is(
  [data-testid*="left-panel"],
  [data-testid*="main-surface"],
  [data-testid*="composer"]
) {
  background-color: transparent !important;
  background-image: none !important;
  backdrop-filter: none !important;
  -webkit-backdrop-filter: none !important;
}

html[data-cxd-wallpaper="on"] body :is(
  aside.app-shell-left-panel,
  aside[data-testid="app-shell-floating-left-panel"]
) :is([class*="bg-surface"], [class*="bg-token-surface"]) {
  background-color: transparent !important;
  background-image: none !important;
}

html[data-cxd-wallpaper="on"] body :is(
  aside.app-shell-left-panel,
  aside[data-testid="app-shell-floating-left-panel"]
) :is(a, button, [role="button"], [role="treeitem"]):hover {
  background-color: var(--cxd-panel-hover, rgba(15, 23, 32, 0.07)) !important;
}

/* Composer: Codex paints an opaque surface plus a long white fade above it. */
html[data-cxd-wallpaper="on"] body :is(
  [class*="ComposerLayoutRoot"],
  [class*="ComposerRoot"],
  [data-thread-scroll-footer]
) {
  background-color: transparent !important;
  background-image: none !important;
}

/* Newer Codex builds hash class names as ComposerLayoutRoot-XCKS7O, older
   ones as _ComposerLayoutRoot_xxxxxx. Match the component name only so the
   skin survives either naming scheme. */
html[data-cxd-wallpaper="on"] body [class*="ComposerLayoutRoot"] {
  background-color: var(--cxd-composer-tint, rgba(255, 255, 255, 0.06)) !important;
  border-color: var(--cxd-composer-border, rgba(255, 255, 255, 0.18)) !important;
  backdrop-filter: blur(6px) saturate(1.05) !important;
  -webkit-backdrop-filter: blur(6px) saturate(1.05) !important;
}

/* The landing-page composer paints an extra solid body plus a grey action bar
   inside the frosted root. Both cover the wallpaper like a white card. */
html[data-cxd-wallpaper="on"] body :is(
  [class*="ComposerLayoutBody"],
  [class*="ComposerLayoutFooter"],
  [class*="ComposerLayoutInput"],
  [class*="ComposerLayoutAttachments"],
  [class*="bg-background-composer-action-bar"]
) {
  background-color: transparent !important;
  background-image: none !important;
}

html[data-cxd-wallpaper="on"] body :is(
  [data-thread-scroll-footer] [class*="background-"],
  [data-thread-scroll-footer] [class*="fade-"],
  [data-app-action-timeline-scroll] [class*="fade-"]
) {
  background-color: transparent !important;
  background-image: none !important;
}

/* Active workspace tab: the pill is a separate background layer, not the tab
   element itself. */
html[data-cxd-wallpaper="on"] body [class*="strip-"] [class*="bg-surface-elevated-secondary"] {
  background-color: var(--cxd-panel-tint, rgba(255, 255, 255, 0.16)) !important;
}

html[data-cxd-wallpaper="on"] body :is(
  [data-app-shell-header-layout],
  [data-app-shell-main-titlebar],
  [data-app-shell-header-edge-scroll]
) {
  background-color: transparent !important;
  background-image: none !important;
  backdrop-filter: none !important;
  -webkit-backdrop-filter: none !important;
}

html[data-cxd-wallpaper="on"] body [class*="PageSurface"] {
  box-shadow: none !important;
}

/* Settings, archived chats and other utility routes replace the thread
   surface with an opaque electron:bg-surface sheet that covers the whole
   artwork. Clearing its parent is not enough — the sheet itself has to become
   the same frosted tint as the rest of the shell. */
html[data-cxd-wallpaper="on"] body main [class*="electron:bg-surface"][class*="rounded-tl-lg"] {
  background-color: var(--cxd-panel-tint, rgba(255, 255, 255, 0.16)) !important;
  background-image: none !important;
  backdrop-filter: none !important;
  -webkit-backdrop-filter: none !important;
}

/* Inside those routes Codex stacks white rounded-2xl cards on the sheet.
   They are the reason a settings/archive page still reads as a solid white
   page even after the sheet is tinted. group/settings is the stable wrapper
   Codex uses for every settings sub-route, including 已归档的聊天. */
html[data-cxd-wallpaper="on"] body main [class*="group/settings"] [class*="rounded-2xl"][class*="border-default"] {
  background-color: var(--cxd-panel-tint, rgba(255, 255, 255, 0.16)) !important;
  background-image: none !important;
}

/* Settings sub-pages (plugins, skills, integrations) render a sticky page
   header whose ::before is a solid white 77px band. It is not an element, so
   the surface rules above never see it; without this the top of those pages
   still cuts the artwork in half. */
html[data-cxd-wallpaper="on"] body main [data-app-shell-inline-page-header] [data-sticky]::before {
  background-color: var(--cxd-panel-tint, rgba(255, 255, 255, 0.16)) !important;
  background-image: none !important;
}

html[data-cxd-background] body .thread-scroll-container[data-app-action-timeline-scroll] [class*="bg-gradient-to-t"],
html[data-cxd-background] body [data-thread-scroll-footer="true"] [class*="bg-gradient-to-t"],
html[data-cxd-background] body [data-above-composer-portal] [class*="bg-gradient-to-t"] {
  background-image: none !important;
}

/* The turn-summary pill ("N 个文件已更改") floats above the composer and ships
   as a solid white card. Give it the same frosted tint as the rest of the shell
   so it reads as glass instead of a white patch over the artwork. */
html[data-cxd-wallpaper="on"] body [data-above-composer-portal] [class*="bg-surface-elevated-secondary"] {
  background-color: var(--cxd-chip-tint, rgba(255, 255, 255, 0.34)) !important;
  border-color: var(--cxd-composer-border, rgba(255, 255, 255, 0.18)) !important;
  backdrop-filter: blur(10px) saturate(1.1) !important;
  -webkit-backdrop-filter: blur(10px) saturate(1.1) !important;
}

html[data-cxd-wallpaper="on"][data-theme="dark"] body [data-above-composer-portal] [class*="bg-surface-elevated-secondary"] {
  background-color: rgba(9, 13, 17, 0.52) !important;
}

/* Codex paints a 40px white-to-transparent scroll fade at the top edge of the
   thread viewport. Over the procedural background it is invisible; over a
   wallpaper it reads as a hard white line spanning the whole window. Drop the
   overlay in wallpaper mode so the artwork stays continuous. */
html[data-cxd-wallpaper="on"] body [class*="MainContentTopFade"] {
  display: none !important;
}

/* Codex keeps two 1px separator layers around the titlebar/thread boundary.
   They are useful against the stock surface, but over artwork they read as a
   bright horizontal seam. Remove only those hairline layers; the transcript
   itself and the footer share the same hashed class and must stay visible. */
html[data-cxd-wallpaper="on"] body [data-app-shell-header-layout]::after,
html[data-cxd-wallpaper="on"] body div[class*="shiftWithTranscript"].h-px {
  display: none !important;
  background: transparent !important;
  background-image: none !important;
  box-shadow: none !important;
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

window.__CXD_EMBED__ = true;

// Page.addScriptToEvaluateOnNewDocument runs before the parser creates <html>
// and <body>. Defer the DOM work until the document is actually mountable.
function boot() {
  if (!document.body) {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
    return;
  }

  ensureStyle('cxd-bg-style', css);
  ensureStyle('cxd-bg-codex-style', CXD_CODEX_CSS);
  disposeExisting();

  const html = document.documentElement;
  html.dataset.cxdBackground = 'on';
  html.style.setProperty('--cxd-ui-surface', 'rgba(9, 13, 17, 0.22)');
  html.style.setProperty('--cxd-ui-surface-strong', 'rgba(12, 17, 21, 0.3)');

  let host = document.getElementById('cxd-bg-root');
  if (!host) {
    host = document.createElement('div');
    host.id = 'cxd-bg-root';
    host.dataset.cxdBackgroundLayer = '';
    host.style.cssText = 'position:fixed;inset:0;z-index:-1;pointer-events:none;contain:strict;';
    document.body.appendChild(host);
  }

  mount(host, { embed: true });
}

boot();
