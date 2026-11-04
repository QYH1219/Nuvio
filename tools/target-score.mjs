// Codex opens several app:// windows (main window, spotlight overlay, ...). The
// spotlight page loads first and is titled "ChatGPT", so a naive "first codex-looking
// target" match injects the background into a window nobody is looking at.
export function scoreTarget(target) {
  const url = target.url || '';
  const title = target.title || '';
  let score = 0;
  if (/^app:\/\//i.test(url)) score += 40;
  if (/initialroute=(%2f|\/)spotlight/i.test(url)) score -= 120;
  if (/[?&]initialRoute=/i.test(url)) score -= 10;
  if (/^app:\/\/-\/index\.html\/?$/i.test(url)) score += 60;
  if (/codex|chatgpt/i.test(`${title} ${url}`)) score += 10;
  if (/^chatgpt$/i.test(title.trim())) score -= 15;
  // Browser tabs live in the same CDP endpoint as the Codex shell. Never let a
  // regular web page outrank an app:// window when the caller did not pass
  // --target explicitly.
  if (/^https?:/i.test(url)) score -= 120;
  if (/codex-sandbox:|devtools:/i.test(url)) score -= 200;
  return score;
}

export function selectTarget(targets, filter) {
  const target = selectTargetOrNull(targets, filter);
  if (!target) throw new Error('No page targets found. Is Codex running with --remote-debugging-port?');
  return target;
}

/**
 * Same ranking as `selectTarget`, but returns null instead of throwing when
 * Codex is mid-restart and the CDP endpoint has no page window yet. Codex
 * reloads its renderer on update and on `Page.reload`, so "zero pages" is a
 * normal transient state, never a fatal one.
 */
export function selectTargetOrNull(targets, filter) {
  const list = Array.isArray(targets) ? targets : [];
  const pages = list.filter((target) => target && target.type === 'page' && target.webSocketDebuggerUrl);
  if (!pages.length) return null;
  if (!filter) {
    // Codex shares its CDP endpoint with in-app browser tabs and sandbox
    // frames. Injecting the wallpaper into a random web tab is never correct,
    // so wait for an app:// window instead of falling back to any page.
    const candidates = pages.filter((target) => !/^(devtools|https?|codex-sandbox):/i.test(target.url || ''));
    if (!candidates.length) return null;
    return candidates.sort((a, b) => scoreTarget(b) - scoreTarget(a))[0];
  }
  const needle = filter.toLowerCase();
  const matched = pages.filter((target) =>
    [target.id, target.title, target.url].filter(Boolean).some((value) => value.toLowerCase().includes(needle)),
  );
  // An explicit --target still wins, even for a browser tab.
  return (matched.length ? matched : pages).sort((a, b) => scoreTarget(b) - scoreTarget(a))[0];
}

/**
 * Poll until a real page window exists. `getTargets`/`sleep`/`now` are
 * injectable so the retry policy is unit-testable without a live CDP port.
 *
 * Returns the picked target, or null when the budget runs out.
 */
export async function waitForPageTarget({
  getTargets,
  filter,
  seconds = 45,
  intervalMs = 500,
  sleep,
  now = Date.now,
} = {}) {
  if (typeof getTargets !== 'function') throw new TypeError('getTargets must be a function');
  if (typeof sleep !== 'function') throw new TypeError('sleep must be a function');
  const deadline = now() + Math.max(0, Number(seconds) || 0) * 1000;
  for (;;) {
    try {
      const target = selectTargetOrNull(await getTargets(), filter);
      if (target) return target;
    } catch {
      /* CDP still booting; retry until the deadline */
    }
    if (now() >= deadline) return null;
    await sleep(intervalMs);
  }
}
