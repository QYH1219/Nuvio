import {
  applyWorkshop,
  deleteWorkshop,
  hasWorkshopApi,
  importProgress,
  importWorkshop,
  listWorkshop,
  previewUrl,
  WORKSHOP_TYPES,
} from '../workshop.js';

const POLL_MS = 800;
// The injector watches the Steam library itself, so the list only needs a slow
// safety poll for when Windows drops a filesystem event.
const IDLE_POLL_MS = 15_000;

/**
 * Wallpaper Engine card list.
 *
 * Only wallpapers already downloaded into
 * `<steam>/steamapps/workshop/content/431960/<id>` show up: the scanner reads
 * local project.json files and never talks to the Steam network.
 */
export function createWorkshopSection(options = {}) {
  const onApplied = options.onApplied || (() => {});
  const onMessage = options.onMessage || (() => {});
  const isFavorite = options.isFavorite || (() => false);
  const onToggleFavorite = options.onToggleFavorite || null;

  const el = document.createElement('div');
  el.className = 'cxd-workshop';
  el.innerHTML = `
    <div class="cxd-workshop-head">
      <span class="cxd-workshop-title">创意工坊壁纸</span>
    </div>
    <p class="cxd-asset-hint" data-hint></p>
    <div class="cxd-workshop-tools">
      <input type="search" data-search placeholder="搜索标题" aria-label="搜索壁纸标题" />
      <select data-filter aria-label="按类型筛选">
        <option value="all">全部类型</option>
        <option value="video">视频</option>
        <option value="scene">场景</option>
        <option value="web">网页</option>
        <option value="favorite">★ 收藏</option>
      </select>
    </div>
    <div class="cxd-workshop-list" data-list></div>
  `;

  const hint = el.querySelector('[data-hint]');
  const list = el.querySelector('[data-list]');
  const search = el.querySelector('[data-search]');
  const filter = el.querySelector('[data-filter]');

  let entries = [];
  let busy = '';
  let loaded = false;
  let pollTimer = 0;
  let scannedAt = '';
  let disposed = false;
  const activeJobs = new Map();

  if (!hasWorkshopApi()) {
    hint.textContent = '未连接本地壁纸服务。用 npm start 注入 Codex 后可用。';
    search.disabled = true;
    filter.disabled = true;
    return { el, refresh: async () => {} };
  }

  function visibleEntries() {
    const query = search.value.trim().toLowerCase();
    const type = filter.value;
    return entries.filter((entry) => {
      if (type === 'favorite') {
        if (!isFavorite(entry.id)) return false;
      } else if (type !== 'all' && entry.type !== type) {
        return false;
      }
      if (!query) return true;
      return String(entry.title || '').toLowerCase().includes(query);
    });
  }

  function typeLabel(type) {
    return WORKSHOP_TYPES[type] || type || '未知';
  }

  function badge(entry) {
    if (entry.active) return '<b class="cxd-ws-badge on">当前使用</b>';
    if (entry.imported) return '<b class="cxd-ws-badge">已导入</b>';
    return '';
  }

  function render() {
    const rows = visibleEntries();
    list.textContent = '';
    if (!loaded) {
      list.innerHTML = '<div class="cxd-ws-empty">正在索引本机壁纸…</div>';
      return;
    }
    if (!entries.length) {
      list.innerHTML =
        '<div class="cxd-ws-empty">正在自动索引本机 Wallpaper Engine 壁纸…<br>在创意工坊订阅并下载后会自动出现在这里，不需要手动扫描。</div>';
      return;
    }
    if (!rows.length) {
      list.innerHTML = '<div class="cxd-ws-empty">没有匹配的壁纸。</div>';
      return;
    }

    const frag = document.createDocumentFragment();
    rows.forEach((entry) => {
      const card = document.createElement('div');
      card.className = 'cxd-ws-card' + (entry.active ? ' is-active' : '');
      card.dataset.id = entry.id;

      const thumb = document.createElement('div');
      thumb.className = 'cxd-ws-thumb';
      if (entry.hasPreview) {
        const img = document.createElement('img');
        img.loading = 'lazy';
        img.decoding = 'async';
        img.alt = '';
        img.src = previewUrl(entry.id);
        thumb.appendChild(img);
      }
      thumb.appendChild(Object.assign(document.createElement('span'), {
        className: 'cxd-ws-type',
        textContent: typeLabel(entry.type),
      }));

      const meta = document.createElement('div');
      meta.className = 'cxd-ws-meta';
      const title = document.createElement('span');
      title.className = 'cxd-ws-title';
      title.textContent = entry.title || entry.id;
      title.title = entry.title || entry.id;
      const sub = document.createElement('span');
      sub.className = 'cxd-ws-sub';
      sub.innerHTML = `${entry.id} ${badge(entry)}`;
      meta.append(title, sub);

      const action = document.createElement('button');
      action.type = 'button';
      action.className = 'cxd-asset-btn cxd-ws-use';
      action.textContent = entry.active ? '重新应用' : '使用';
      action.disabled = Boolean(busy);
      if (entry.type === 'web') action.title = '以沙盒 iframe 渲染网页壁纸';
      action.addEventListener('click', () => use(entry));

      const fav = document.createElement('button');
      fav.type = 'button';
      const favorited = Boolean(isFavorite(entry.id));
      fav.className = 'cxd-ws-fav' + (favorited ? ' on' : '');
      fav.textContent = favorited ? '★' : '☆';
      fav.title = favorited ? '取消收藏（轮播优先使用收藏）' : '收藏（轮播优先使用收藏）';
      fav.setAttribute('aria-pressed', String(favorited));
      fav.setAttribute('aria-label', `${favorited ? '取消收藏' : '收藏'} ${entry.title || entry.id}`);
      fav.disabled = !onToggleFavorite;
      fav.addEventListener('click', () => {
        if (!onToggleFavorite) return;
        onToggleFavorite(entry.id);
        render();
      });

      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'cxd-asset-clear';
      remove.textContent = '×';
      remove.title = '删除已导入的文件';
      remove.setAttribute('aria-label', `删除 ${entry.title || entry.id}`);
      remove.disabled = !entry.imported || Boolean(busy);
      remove.addEventListener('click', () => removeEntry(entry));

      card.append(thumb, meta, fav, action, remove);
      frag.appendChild(card);
    });
    list.appendChild(frag);
  }

  function applyPayload(payload) {
    entries = Array.isArray(payload.entries) ? payload.entries : [];
    scannedAt = payload.scannedAt || scannedAt;
    loaded = true;
    hint.textContent = payload.dirs?.length
      ? `已自动索引 ${payload.dirs.length} 个 Steam 库，共 ${entries.length} 个已下载壁纸。`
      : '未找到 Steam 库。确认 Wallpaper Engine 已安装并至少下载过一个壁纸。';
    const note = payload.note;
    if (note && !payload.dirs?.length) hint.textContent = note;
  }

  async function refresh(force = true) {
    if (busy) return;
    try {
      applyPayload(await listWorkshop(force));
    } catch (error) {
      loaded = true;
      entries = [];
      hint.textContent = error.message || '扫描失败';
    } finally {
      render();
    }
  }

  function schedulePoll() {
    if (disposed) return;
    pollTimer = setTimeout(async () => {
      pollTimer = 0;
      try {
        // Cached read: the injector watcher already refreshed the index.
        const payload = await listWorkshop(false);
        if (!busy && payload.scannedAt && payload.scannedAt !== scannedAt) {
          applyPayload(payload);
          render();
        }
      } catch {
        /* the local service may be restarting; the next tick retries */
      }
      schedulePoll();
    }, IDLE_POLL_MS);
    pollTimer.unref?.();
  }

  async function use(entry) {
    if (busy) return;
    busy = entry.id;
    render();
    try {
      const state = activeJobs.get(entry.id);
      if (!entry.imported || state === 'error') {
        await runImport(entry);
      }
      const applied = await applyWorkshop(entry.id);
      await onApplied(applied);
      onMessage(`已切换：${entry.title || entry.id}`);
      await refresh();
    } catch (error) {
      onMessage(error.message || '切换失败');
      render();
    } finally {
      busy = '';
      render();
    }
  }

  async function runImport(entry) {
    onMessage(`正在导入 ${entry.title || entry.id}…`);
    await importWorkshop(entry.id);
    activeJobs.set(entry.id, 'running');
    render();

    const started = Date.now();
    while (Date.now() - started < 180000) {
      await sleep(POLL_MS);
      const progress = await importProgress(entry.id);
      if (progress.state === 'done') {
        activeJobs.set(entry.id, 'done');
        entry.imported = true;
        return;
      }
      if (progress.state === 'error') {
        activeJobs.set(entry.id, 'error');
        throw new Error(progress.message || '导入失败');
      }
      if (progress.message) onMessage(progress.message);
    }
    activeJobs.set(entry.id, 'error');
    throw new Error('导入超时');
  }

  async function removeEntry(entry) {
    if (busy) return;
    busy = entry.id;
    render();
    try {
      await deleteWorkshop(entry.id);
      entry.imported = false;
      entry.active = false;
      onMessage('已删除本地副本');
      await refresh();
    } catch (error) {
      onMessage(error.message || '删除失败');
    } finally {
      busy = '';
      render();
    }
  }

  search.addEventListener('input', render);
  filter.addEventListener('change', render);

  refresh(true);
  schedulePoll();

  return {
    el,
    refresh,
    dispose() {
      disposed = true;
      if (pollTimer) clearTimeout(pollTimer);
      pollTimer = 0;
    },
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
