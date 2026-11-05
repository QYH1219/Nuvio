/**
 * Wallpaper rotation is intentionally small and synchronous: the caller owns
 * the timer and the workshop request, while these helpers only decide which
 * entries are eligible and what comes next.
 */

const ROTATABLE_KINDS = new Set(['video', 'scene', 'image', 'web']);

/** Imported video/scene/image/web wallpapers; favorites narrow the pool. */
export function rotationPool(entries, favoriteIds = []) {
  const usable = (Array.isArray(entries) ? entries : []).filter((entry) => {
    if (!entry || !entry.imported) return false;
    const kind = String(entry.kind || entry.type || '').toLowerCase();
    return ROTATABLE_KINDS.has(kind);
  });
  if (!usable.length) return [];

  const favorites = new Set(
    (Array.isArray(favoriteIds) ? favoriteIds : []).map(String),
  );
  if (!favorites.size) return usable;

  const picked = usable.filter((entry) => favorites.has(String(entry.id)));
  // Stale favorites must not stop rotation entirely.
  return picked.length ? picked : usable;
}

/**
 * Next entry in list order. Returns null when rotation would not change the
 * wallpaper (fewer than two usable entries, or the same id comes back).
 */
export function nextRotationEntry(entries, favoriteIds = [], currentId = '') {
  const pool = rotationPool(entries, favoriteIds);
  if (pool.length < 2) return null;

  const current = String(currentId ?? '');
  const index = pool.findIndex((entry) => String(entry.id) === current);
  const next = pool[(index + 1 + pool.length) % pool.length];
  if (!next || String(next.id) === current) return null;
  return next;
}
