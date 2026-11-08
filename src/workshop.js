/**
 * Client for the local wallpaper service exposed by `tools/inject.mjs`.
 *
 * The injector writes `window.__CXD_CONTROL__ = { base, token }` into the page
 * before the bundle runs. Without that prelude (plain `npm run dev`, static
 * preview) every call throws a readable error and the panel hides the section.
 */

export function controlInfo() {
  const info = globalThis.__CXD_CONTROL__;
  if (!info || typeof info.base !== 'string' || !info.base) return null;
  return info;
}

export function hasWorkshopApi() {
  return Boolean(controlInfo());
}

async function request(path, options = {}) {
  const info = controlInfo();
  if (!info) throw new Error('本地壁纸服务未启动（请用 npm start 注入 Codex）');

  const url = new URL(path, info.base);
  if (info.token && !url.searchParams.has('token')) {
    url.searchParams.set('token', info.token);
  }
  const res = await fetch(url, {
    cache: 'no-store',
    ...options,
    headers: {
      ...(options.body ? { 'content-type': 'application/json' } : {}),
      ...(info.token ? { 'x-cxd-token': info.token } : {}),
      ...(options.headers || {}),
    },
  });
  const text = await res.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    throw new Error(`壁纸服务返回了非 JSON 响应（${res.status}）`);
  }
  if (!res.ok || payload?.ok === false) {
    throw new Error(payload?.error || `请求失败（${res.status}）`);
  }
  return payload;
}

/** Shared transport for other local-service endpoints (e.g. update checks). */
export function controlRequest(path, options = {}) {
  return request(path, options);
}

export function listWorkshop(force = false) {
  return request(`/api/workshop/list${force ? '?force=1' : ''}`);
}

export function importWorkshop(id) {
  return request('/api/workshop/import', {
    method: 'POST',
    body: JSON.stringify({ id }),
  });
}

export function importProgress(id) {
  return request(`/api/workshop/progress?id=${encodeURIComponent(id)}`);
}

export function applyWorkshop(id) {
  return request('/api/library/apply', {
    method: 'POST',
    body: JSON.stringify({ id }),
  });
}

export function deleteWorkshop(id) {
  return request('/api/library/delete', {
    method: 'POST',
    body: JSON.stringify({ id }),
  });
}

export function getAutostart() {
  return request('/api/autostart');
}

export function setAutostart(enabled) {
  return request('/api/autostart', {
    method: 'POST',
    body: JSON.stringify({ enabled: Boolean(enabled) }),
  });
}

export function previewUrl(id) {
  const info = controlInfo();
  if (!info) return '';
  // No extension: the local service reads meta.json / project.json and serves
  // whatever preview file Steam actually downloaded (jpg, png, gif, webp…).
  const url = new URL(`/workshop/${encodeURIComponent(id)}/preview`, info.base);
  if (info.token) url.searchParams.set('token', info.token);
  return url.href;
}

export const WORKSHOP_TYPES = {
  video: '视频',
  scene: '场景',
  web: '网页',
  application: '应用',
};
