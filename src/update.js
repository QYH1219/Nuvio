/**
 * Manual update check.
 *
 * Nuvio never phones home on its own. This module only runs when the user
 * clicks "检查更新" in the panel, and it reads the public GitHub release feed.
 * When the local injector is running the request goes through it (Codex ships
 * a strict CSP that can block a renderer-side fetch); otherwise it falls back
 * to a direct fetch for `npm run dev`.
 */

import { controlRequest, hasWorkshopApi } from './workshop.js';

export const RELEASE_API =
  'https://api.github.com/repos/QYH1219/Nuvio/releases/latest';
export const RELEASES_PAGE = 'https://github.com/QYH1219/Nuvio/releases';

/** @returns {[number, number, number]|null} */
export function parseVersion(value) {
  const match = String(value ?? '')
    .trim()
    .match(/^v?(\d+)\.(\d+)\.(\d+)/i);
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

/** -1 when a < b, 0 when equal, 1 when a > b. Unparsable sorts lowest. */
export function compareVersions(a, b) {
  const left = parseVersion(a);
  const right = parseVersion(b);
  if (!left && !right) return 0;
  if (!left) return -1;
  if (!right) return 1;
  for (let index = 0; index < 3; index += 1) {
    if (left[index] === right[index]) continue;
    return left[index] < right[index] ? -1 : 1;
  }
  return 0;
}

export function normalizeVersion(value) {
  const parsed = parseVersion(value);
  return parsed ? parsed.join('.') : String(value ?? '').trim();
}

async function fetchLatestRelease(options = {}) {
  if (typeof options.fetchRelease === 'function') return options.fetchRelease();

  if (hasWorkshopApi()) {
    const payload = await controlRequest('/api/update/check');
    return payload?.release || null;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 9000);
  try {
    const res = await fetch(RELEASE_API, {
      cache: 'no-store',
      signal: controller.signal,
      headers: { accept: 'application/vnd.github+json' },
    });
    if (!res.ok) throw new Error(`GitHub 返回 ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * @param {string} currentVersion e.g. "0.6.0"
 * @returns {Promise<{current: string, latest: string, updateAvailable: boolean,
 *   url: string, publishedAt: string, name: string}>}
 */
export async function checkForUpdates(currentVersion, options = {}) {
  const current = normalizeVersion(currentVersion);
  const release = await fetchLatestRelease(options);
  const tag = String(release?.tag_name || release?.tag || '').trim();
  if (!parseVersion(tag)) throw new Error('发布信息里没有可识别的版本号');
  const latest = normalizeVersion(tag);
  return {
    current,
    latest,
    updateAvailable: compareVersions(latest, current) > 0,
    url: String(release?.html_url || release?.url || RELEASES_PAGE),
    publishedAt: String(release?.published_at || ''),
    name: String(release?.name || ''),
  };
}
