/**
 * Local asset library.
 *
 * Files picked from the settings panel are stored as Blobs in IndexedDB, so a
 * normal user can swap artwork without touching `public/assets` or the CLI.
 * Object URLs are created per mount and revoked by the caller.
 */

const DB_NAME = 'codex-dynamic-bg';
const DB_VERSION = 1;
const STORE = 'assets';

export const ASSET_SLOTS = ['background', 'model'];

export const ASSET_LIMITS = {
  background: 192 * 1024 * 1024,
  model: 128 * 1024 * 1024,
};

const IMAGE_EXTS = ['.png', '.jpg', '.jpeg', '.webp', '.avif', '.gif'];
const VIDEO_EXTS = ['.mp4', '.webm', '.mov', '.m4v'];
const MODEL_EXTS = ['.glb', '.gltf'];

let dbPromise = null;

function extensionOf(name) {
  const value = String(name || '').toLowerCase();
  const dot = value.lastIndexOf('.');
  return dot >= 0 ? value.slice(dot) : '';
}

/** Return `image`, `video`, `model`, or null for an unsupported file. */
export function classifyAsset(file) {
  if (!file) return null;
  const type = String(file.type || '').toLowerCase();
  const ext = extensionOf(file.name);
  if (type.startsWith('image/') || IMAGE_EXTS.includes(ext)) return 'image';
  if (type.startsWith('video/') || VIDEO_EXTS.includes(ext)) return 'video';
  if (
    MODEL_EXTS.includes(ext) ||
    type === 'model/gltf-binary' ||
    type === 'model/gltf+json' ||
    type === 'application/octet-stream' && ext === '.glb'
  ) {
    return 'model';
  }
  return null;
}

export function formatBytes(bytes) {
  const value = Number(bytes) || 0;
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

/** Validate and describe a file before it touches IndexedDB. */
export function describeAsset(file, slot) {
  if (!ASSET_SLOTS.includes(slot)) throw new Error(`unknown asset slot: ${slot}`);
  const kind = classifyAsset(file);
  if (!kind) throw new Error('不支持的文件类型；请选择图片、MP4/WebM 视频或 GLB 模型');
  if (slot === 'model' && kind !== 'model') throw new Error('模型位置只接受 .glb 文件');
  if (slot === 'model') {
    const ext = extensionOf(file.name);
    const type = String(file.type || '').toLowerCase();
    if (ext !== '.glb' && type !== 'model/gltf-binary') {
      throw new Error('素材库只接受单文件 .glb；.gltf 的外部 .bin / 贴图无法一起导入，请先打包为 GLB');
    }
  }
  if (slot === 'background' && kind === 'model') throw new Error('背景位置请选择图片或视频');
  const limit = ASSET_LIMITS[slot];
  if (Number(file.size) > limit) {
    throw new Error(`文件过大（${formatBytes(file.size)}），上限 ${formatBytes(limit)}`);
  }
  return {
    slot,
    kind,
    name: String(file.name || 'asset'),
    type: String(file.type || ''),
    size: Number(file.size) || 0,
  };
}

function openDb() {
  if (typeof indexedDB === 'undefined') {
    return Promise.reject(new Error('IndexedDB 不可用'));
  }
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'slot' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('IndexedDB 打开失败'));
    request.onblocked = () => reject(new Error('IndexedDB 被其他标签页阻塞'));
  });
  return dbPromise;
}

function requestToPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('IndexedDB 请求失败'));
  });
}

function transactionDone(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error || new Error('IndexedDB 事务失败'));
    transaction.onabort = () => reject(transaction.error || new Error('IndexedDB 事务取消'));
  });
}

export async function getAssetRecord(slot) {
  const db = await openDb();
  const transaction = db.transaction(STORE, 'readonly');
  const request = transaction.objectStore(STORE).get(slot);
  return (await requestToPromise(request)) || null;
}

export async function listAssetRecords() {
  const db = await openDb();
  const transaction = db.transaction(STORE, 'readonly');
  const request = transaction.objectStore(STORE).getAll();
  const rows = await requestToPromise(request);
  return Array.isArray(rows) ? rows.filter((row) => row && ASSET_SLOTS.includes(row.slot)) : [];
}

export async function saveAsset(slot, file) {
  const meta = describeAsset(file, slot);
  const db = await openDb();
  const transaction = db.transaction(STORE, 'readwrite');
  const done = transactionDone(transaction);
  transaction.objectStore(STORE).put({
    ...meta,
    blob: file,
    updatedAt: new Date().toISOString(),
  });
  await done;
  return meta;
}

export async function deleteAsset(slot) {
  const db = await openDb();
  const transaction = db.transaction(STORE, 'readwrite');
  const done = transactionDone(transaction);
  transaction.objectStore(STORE).delete(slot);
  await done;
}

/**
 * Put a previously read record back after a failed import. Used to roll back a
 * new file that passed metadata checks but failed during the final render.
 */
export async function restoreAssetRecord(record) {
  if (!record || !ASSET_SLOTS.includes(record.slot) || !record.blob) {
    throw new Error('invalid asset record');
  }
  const db = await openDb();
  const transaction = db.transaction(STORE, 'readwrite');
  const done = transactionDone(transaction);
  transaction.objectStore(STORE).put(record);
  await done;
}

/**
 * Resolve stored Blobs into object URLs. `cleanup()` must be called when the
 * mounted background is disposed or reloaded.
 */
export async function loadUserAssetUrls(options = {}) {
  const urls = { background: null, model: null };
  const created = [];

  try {
    const records = await listAssetRecords();
    records.forEach((record) => {
      if (!record?.blob) return;
      const url = URL.createObjectURL(record.blob);
      created.push(url);
      urls[record.slot] = {
        url,
        kind: record.kind,
        name: record.name,
        type: record.type,
        size: record.size,
        updatedAt: record.updatedAt,
      };
    });
  } catch (error) {
    created.forEach((url) => {
      try {
        URL.revokeObjectURL(url);
      } catch {
        /* ignore */
      }
    });
    if (options.strict) throw error;
    console.warn('[codex-bg] local asset library unavailable', error);
  }

  return {
    background: urls.background,
    model: urls.model,
    cleanup(slots = ASSET_SLOTS) {
      slots.forEach((slot) => {
        const url = urls[slot]?.url;
        if (!url) return;
        try {
          URL.revokeObjectURL(url);
        } catch {
          /* ignore */
        }
      });
      // Keep the list only for internal error cleanup; slot-based cleanup above
      // avoids revoking an unchanged asset's URL.
      created.length = 0;
    },
  };
}
