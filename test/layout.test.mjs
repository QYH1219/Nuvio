import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const css = readFileSync(new URL('../src/style.css', import.meta.url), 'utf8');
const embed = readFileSync(new URL('../src/embed.js', import.meta.url), 'utf8');

test('compact panel keeps its narrower width inside the mobile breakpoint', () => {
  const start = css.indexOf('@media (max-width: 900px)');
  assert.ok(start >= 0, 'missing 900px breakpoint');

  const next = css.indexOf('@media (prefers-reduced-motion', start);
  const block = css.slice(start, next === -1 ? undefined : next);

  assert.match(block, /\.cxd-panel-compact\s*\{[^}]*width:\s*min\(292px/);
});

test('wallpaper mode removes stacked CSS blur and keeps sections hideable', () => {
  assert.match(
    css,
    /\.cxd-root:not\(\.cxd-wallpaper\)::after/,
    'the extra vignette must not stack on a wallpaper',
  );
  assert.match(
    css,
    /\.cxd-root\.cxd-wallpaper \.mock-main\s*\{[^}]*backdrop-filter:\s*none/,
    'wallpaper mode must drop the mock shell blur',
  );
  assert.match(
    css,
    /\.cxd-wallpaper-note\[hidden\][^}]*display:\s*none/,
    'the wallpaper note must honor the hidden attribute',
  );
  assert.match(
    css,
    /\.cxd-section\[hidden\][^}]*display:\s*none/,
    'the theme section must honor the hidden attribute',
  );
});

test('injected wallpaper mode turns off Codex workspace pseudo surfaces', () => {
  assert.match(embed, /html\[data-cxd-wallpaper="on"\]/);
  assert.match(
    embed,
    /\[class\*="WorkspaceContent"\]::before\s*\{[^}]*display:\s*none/s,
    'the WorkspaceContent surface pseudo-element must be removed',
  );
  assert.doesNotMatch(
    embed,
    /:is\([^)]*::before/,
    'pseudo-elements inside :is() are rejected by Chromium and silently drop the rule',
  );
});

test('wallpaper mode clears the sidebar and composer surfaces', () => {
  assert.match(
    embed,
    /aside\.app-shell-left-panel[\s\S]*?\[class\*="bg-surface"\][\s\S]*?background-color:\s*transparent !important/,
    'sidebar surface tokens must not paint an opaque panel',
  );
  assert.match(
    embed,
    /\[class\*="ComposerLayoutRoot"\][^}]*background-color:\s*var\(--cxd-composer-tint/,
    'the composer must use the lighter translucent composer tint',
  );
  assert.match(
    embed,
    /\[data-thread-scroll-footer\] \[class\*="background-"\][\s\S]*?\[class\*="fade-"\][\s\S]*?background-image:\s*none !important/,
    'the solid composer strip and its white fade must be removed',
  );
  assert.match(
    embed,
    /\[class\*="strip-"\] \[class\*="bg-surface-elevated-secondary"\]/,
    'the workspace tab pill needs its own translucent override',
  );
  assert.match(
    embed,
    /\[class\*="ComposerLayoutAttachments"\]/,
    'the composer attachment strip must not paint an opaque band',
  );
});

test('base panel tint stays out of wallpaper mode', () => {
  assert.match(
    embed,
    /html\[data-cxd-background\]:not\(\[data-cxd-wallpaper="on"\]\) body :is\(\s*aside\.app-shell-left-panel/,
    'the base sidebar tint must not outrank the wallpaper transparency rules',
  );
});

test('landing-page composer body and action bar are flattened', () => {
  assert.match(
    embed,
    /\[class\*="ComposerLayoutBody"\][\s\S]*?\[class\*="bg-background-composer-action-bar"\][\s\S]*?background-color:\s*transparent !important/,
    'the solid editor body and grey action bar must not paint over the wallpaper',
  );
  assert.match(
    embed,
    /\[class\*="ComposerLayoutRoot"\][^}]*background-color:\s*var\(--cxd-composer-tint/,
    'the composer root must use the dedicated translucent tint',
  );
});

test('wallpaper mode removes titlebar and thread hairline seams', () => {
  assert.match(
    embed,
    /\[data-app-shell-header-layout\]::after[\s\S]*?div\[class\*="shiftWithTranscript"\]\.h-px[\s\S]*?display:\s*none !important/,
    'only the 1px header/thread separators must be hidden',
  );
  assert.doesNotMatch(
    embed,
    /\[class\*="shiftWithTranscript"\]\s*\{[^}]*display:\s*none/s,
    'hiding the whole hashed class would remove the transcript and footer too',
  );
  assert.match(
    embed,
    /\[class\*="MainContentTopFade"\]\s*\{[^}]*display:\s*none !important/s,
    'the white top scroll fade must be removed over a wallpaper',
  );
});
