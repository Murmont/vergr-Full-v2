// Real files on the phone, addressed by a name we can work out ourselves.
//
// THE WHOLE POINT: a React render cannot await anything. The previous cache kept
// media as Blobs in IndexedDB, and finding one meant asking a database — which
// is asynchronous — so every picture in the app rendered a grey placeholder,
// waited, and then popped the real image in. That flicker was structural, not a
// tuning problem.
//
// Here the filename is derived from the URL by hashing it, so nothing needs
// looking up. The only genuinely unknown thing is WHETHER we have the file, and
// that is answered once at startup by the native manifest and held in a Set. So
// by the time the first frame renders, the answer is already in memory and the
// correct pixels can be painted immediately.
//
// Android only. Desktop has no bridge yet and falls back to the existing Dexie
// path (see deviceMediaCache.js), which is why every function here degrades to
// "we have nothing" rather than throwing when the bridge is absent.

import { convertFileSrc } from '@tauri-apps/api/core';

// Static import, NOT a dynamic one. Everywhere else in the app this is
// `await import('@tauri-apps/api/core')`, which is fine when the caller is
// already async — but localSrcFor() is called during render and must return a
// value in the same tick, so the module has to be loaded up front.

const bridge = () => (typeof window !== 'undefined' ? window.VergrCache : null);

/** Is the native store available on this device/build? */
export function isFileCacheAvailable() {
  try { return !!bridge()?.available?.(); } catch { return false; }
}

// key -> tier (0 permanent, 1 temp, 2 downloaded video). Populated once by
// initFileCache().
const have = new Map();
let permBase = '';
let tempBase = '';
let videoBase = '';
let ready = false;

export const TIER_PERM = 0;
export const TIER_TEMP = 1;
export const TIER_VIDEO = 2;

/**
 * Ask the native side what it has. Called ONCE, before React renders.
 *
 * This is a synchronous bridge call, which blocks the JS thread while Android
 * lists two directories. That is a deliberate trade: a few milliseconds at
 * startup buys every subsequent lookup being free. Doing it asynchronously would
 * reintroduce exactly the await-during-render problem this file exists to remove.
 */
export function initFileCache() {
  if (ready || !isFileCacheAvailable()) return;
  try {
    const raw = bridge().manifest();
    const m = JSON.parse(raw);
    permBase = m.perm || '';
    tempBase = m.temp || '';
    videoBase = m.video || '';
    for (const [key, tier] of Object.entries(m.files || {})) {
      // Skip half-written downloads; the native side renames on completion, so
      // a .part file means an interrupted fetch, not a usable image.
      if (!key.endsWith('.part')) have.set(key, tier);
    }
    ready = true;
  } catch {
    // A malformed manifest means no head start, never a broken app.
  }
}

/**
 * Stable filename for a URL.
 *
 * Two FNV-1a passes with different seeds, concatenated to 16 hex characters.
 * One 32-bit pass would start colliding in the low tens of thousands of files
 * (birthday bound), and a collision here means showing the wrong person's face,
 * which is a much worse failure than a cache miss.
 */
export function keyFor(url) {
  if (!url) return '';
  let a = 0x811c9dc5;
  let b = 0x01000193;
  for (let i = 0; i < url.length; i++) {
    const c = url.charCodeAt(i);
    a ^= c; a = Math.imul(a, 0x01000193) >>> 0;
    b = (b + c) >>> 0; b = Math.imul(b ^ (b >>> 13), 0x85ebca6b) >>> 0;
  }
  const hex = (a >>> 0).toString(16).padStart(8, '0') + (b >>> 0).toString(16).padStart(8, '0');
  return hex + extFor(url);
}

function extFor(url) {
  const m = /\.([a-z0-9]{2,5})(?:[?#]|$)/i.exec(url || '');
  const e = m ? m[1].toLowerCase() : '';
  // Allowlist rather than trusting whatever is in the path — the extension ends
  // up in a filename on disk.
  return ['jpg', 'jpeg', 'png', 'webp', 'gif', 'mp4', 'webm', 'mov'].includes(e) ? `.${e}` : '.bin';
}

/**
 * A renderable local source for this URL, or null. SYNCHRONOUS — safe to call
 * during render, which is the entire reason this module exists.
 */
export function localSrcFor(url) {
  if (!ready || !url) return null;
  const key = keyFor(url);
  const tier = have.get(key);
  if (tier === undefined) return null;
  const base = tier === TIER_VIDEO ? videoBase : tier === TIER_PERM ? permBase : tempBase;
  if (!base) return null;
  try { return convertFileSrc(`${base}/${key}`); } catch { return null; }
}

/** Do we already hold this one? Sync. */
export function hasLocal(url) {
  return !!(ready && url && have.has(keyFor(url)));
}

// Requests we are waiting on, so N views of the same avatar cause one fetch.
const pending = new Map();

/**
 * Download and keep a file. Resolves true if it is now on disk.
 *
 * `permanent` should be true for avatars, banners and chat backgrounds (small,
 * long-lived, most visible when missing) and false for chat media, which lives
 * in the OS-reclaimable cache directory.
 */
export function storeMedia(url, { permanent = false, tier, onProgress } = {}) {
  if (!ready || !url) return Promise.resolve(false);
  const wantTier = tier !== undefined ? tier : (permanent ? TIER_PERM : TIER_TEMP);
  const key = keyFor(url);
  if (have.has(key)) return Promise.resolve(true);
  const existing = pending.get(key);
  if (existing) return existing;

  const p = new Promise((resolve) => {
    const reqId = `c${Date.now()}${Math.random().toString(36).slice(2, 7)}`;
    let done = false;
    const finish = (ok) => {
      if (done) return;
      done = true;
      window.removeEventListener('vergr:cache-stored', onEvent);
      window.removeEventListener('vergr:cache-progress', onProg);
      clearTimeout(timer);
      pending.delete(key);
      if (ok) have.set(key, wantTier);
      resolve(ok);
    };
    const onEvent = (e) => {
      const d = e?.detail;
      if (!d || d.reqId !== reqId) return;
      finish(!!d.ok);
    };
    const onProg = (e) => {
      const d = e?.detail;
      if (!d || d.reqId !== reqId) return;
      // Each byte that arrives is also proof the transfer is alive, so the
      // watchdog below is pushed out rather than firing mid-download.
      bump();
      if (typeof onProgress === 'function') onProgress(d.got, d.total);
    };

    // A dropped connection can mean the event never arrives. Without this the
    // promise and its listener would leak for the life of the session. A video
    // gets a rolling window instead of a fixed one — a large file on a slow
    // connection is legitimately slow, and killing it at a flat 60s would make
    // downloads impossible on exactly the connections that need them most.
    let timer;
    const bump = () => {
      clearTimeout(timer);
      timer = setTimeout(() => finish(false), wantTier === TIER_VIDEO ? 90000 : 60000);
    };
    bump();

    window.addEventListener('vergr:cache-stored', onEvent);
    window.addEventListener('vergr:cache-progress', onProg);
    try {
      const b = bridge();
      if (wantTier === TIER_VIDEO && typeof b.storeTier === 'function') {
        b.storeTier(url, key, wantTier, reqId);
      } else {
        b.store(url, key, wantTier === TIER_PERM, reqId);
      }
    } catch {
      finish(false);
    }
  });

  pending.set(key, p);
  return p;
}

/**
 * Download a video and keep it. Separate entry point from storeMedia because
 * this one is only ever reached by an explicit tap on the download button —
 * videos are never fetched in the background, which is the founder's rule and
 * also the difference between a media cache and an unasked-for data bill.
 */
export function downloadVideo(url, onProgress) {
  return storeMedia(url, { tier: TIER_VIDEO, onProgress });
}

/** Drop a downloaded video. Frees the space without touching anything else. */
export function removeVideo(url) {
  if (!url) return;
  const key = keyFor(url);
  have.delete(key);
  try { bridge()?.removeVideo?.(key); } catch { /* best effort */ }
}

/**
 * Forget a file we thought we had.
 *
 * Android may clear the temp tier whenever the phone is short on space, without
 * telling us. When that happens our manifest is stale and an <img> pointed at
 * the missing file fails to load. The image handler calls this, we drop the key,
 * and the next render falls through to the remote URL. Without it a single OS
 * cleanup would leave permanently broken images until the app restarted.
 */
export function forgetLocal(url) {
  if (!url) return;
  const key = keyFor(url);
  have.delete(key);
  try { bridge()?.remove?.(key); } catch { /* best effort */ }
}

/** Bytes and file counts per tier, for the Storage settings screen. */
export function cacheUsage() {
  try {
    const raw = bridge()?.usage?.();
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

/** Wipe everything. Backs the Clear cache button. */
export function clearFileCache() {
  try { bridge()?.clear?.(); } catch { /* best effort */ }
  have.clear();
}

// Caps. Only the reclaimable tier gets a size limit: avatars and backgrounds are
// ~20KB each, so capping their COUNT would be theatre. What they actually need
// is ageing out, which is what collects when someone changes their profile
// picture and the old URL is orphaned.
const MAX_TEMP_BYTES = 512 * 1024 * 1024;
const MAX_AGE_DAYS = 90;

// Downloaded videos get their own budget, matched to Telegram's per-file
// ceiling. Deliberately not aged out: someone who tapped download meant it, and
// a clip disappearing on a timer would be worse than one that has to be
// re-downloaded when the budget finally runs out.
export const MAX_VIDEO_BYTES = 2 * 1024 * 1024 * 1024;

/** Housekeeping. Fire and forget at boot, never awaited. */
export function runCacheEviction() {
  try { bridge()?.evict?.(MAX_TEMP_BYTES, MAX_AGE_DAYS, MAX_VIDEO_BYTES); } catch { /* best effort */ }
}
