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
  const pages = targets.filter((target) => target.type === 'page' && target.webSocketDebuggerUrl);
  if (!pages.length) throw new Error('No page targets found. Is Codex running with --remote-debugging-port?');
  if (!filter) {
    const candidates = pages.filter((target) => !/^devtools:/i.test(target.url || ''));
    return (candidates.length ? candidates : pages).sort((a, b) => scoreTarget(b) - scoreTarget(a))[0];
  }
  const needle = filter.toLowerCase();
  const matched = pages.filter((target) =>
    [target.id, target.title, target.url].filter(Boolean).some((value) => value.toLowerCase().includes(needle)),
  );
  return (matched.length ? matched : pages).sort((a, b) => scoreTarget(b) - scoreTarget(a))[0];
}
