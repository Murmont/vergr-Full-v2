/**
 * On-device persistent media cache (Telegram-style).
 *
 * WHY: avatars / banners / chat photos live on cdn.vergr.app. On the native
 * Android shell the Service Worker does NOT run (Tauri serves the app from
 * `tauri.localhost`, a different origin than the SW is scoped to) and the CDN
 * only whitelists CORS for the vergr.app web origin, so nothing persists — every
 * render is a cold `cdn.vergr.app` fetch and the picture blinks in a second
 * later. This module fixes that by storing the actual image bytes ON THE PHONE
 * in the app's PRIVATE (hidden) data directory:
 *
 *   - We keep a Dexie/IndexedDB blob store. In the native WebView IndexedDB is
 *     backed by real files under /data/data/com.vergr.desktop/... — the same
 *     private, user-invisible location Telegram uses for its own media cache.
 *   - On the FIRST sighting of an image we fetch the raw bytes and save the blob.
 *     Every later view (this session OR after an app restart) renders instantly
 *     from a local object URL, with ZERO network. Works offline too.
 *
 * LOCAL-FIRST: on a cold restart the in-memory map is empty. We therefore check
 * the on-device store BEFORE ever touching the network — a cached image shows
 * from the local blob after just a fast IndexedDB read (no slow remote fetch,
 * no cold-CDN round trip). Only a true miss falls back to the remote URL (first
 * sight) while caching in the background for next time.
 *
 * CORS: reading raw bytes cross-origin needs either an allowed Origin (web:
 * vergr.app is whitelisted, so window.fetch works) OR a native HTTP client that
 * ignores the browser CORS wall (native/desktop shell: tauri-plugin-http fetches
 * in Rust). We pick the path by `isTauri()`. `<img>` DISPLAY never needs CORS.
 *
 * SCOPE: still images only (avatars/banners/photos). Video is intentionally NOT
 * cached here — a blob store breaks range/streaming playback; that needs a
 * separate streaming cache.
 */

import { useState, useEffect } from 'react';
import Dexie from 'dexie';
import { isTauri } from './platform';
import { shouldAutoDownloadMedia } from './networkPolicy';
import { isFileCacheAvailable, localSrcFor, storeMedia, forgetLocal } from './fileMediaCache';

const db = new Dexie('vergr-media-v1');
db.version(1).stores({
  // Keyed by the full URL (which is stable per upload — the path carries an
  // upload timestamp + hash — so a NEW avatar is a new key and the old one
  // ages out; no manual invalidation needed).
  media: '&url, ts',
});

// Store hygiene (NOT economic limits — pure device-storage bounds). LRU by
// insert time. Small: avatars/banners are ~40-120KB each.
const MAX_ENTRIES = 1200;
const MAX_BYTES = 200 * 1024 * 1024; // 200MB ceiling for the whole image cache
const PER_FILE_MAX = 6 * 1024 * 1024; // never store a single image > 6MB here

// Session maps: url -> object URL (created lazily, reused across mounts so a
// re-render is a sync hit) and url -> in-flight network promise (dedupe).
const objUrls = new Map();
const netInflight = new Map();

export function isCacheable(url) {
  if (!url || typeof url !== 'string') return false;
  if (url.startsWith('data:') || url.startsWith('blob:')) return false;
  // Never treat a video URL as a still image.
  if (/\.(mp4|webm|m3u8|m4s|ts|mov|mkv)(\?|$)/i.test(url)) return false;
  return (
    url.includes('cdn.vergr.app') ||
    // Legacy avatars/banners uploaded before the R2/CDN migration still live on
    // Firebase Storage (e.g. the @Vergr account). Without this they were never
    // cached — the one avatar that blanked offline + blinked online.
    url.includes('firebasestorage.googleapis.com') ||
    url.includes('googleusercontent.com')
  );
}

async function fetchBytes(url) {
  if (isTauri()) {
    // Native/desktop shell: fetch in Rust (no WebView CORS restriction).
    const { fetch: tauriFetch } = await import('@tauri-apps/plugin-http');
    const res = await tauriFetch(url, { method: 'GET' });
    if (!res.ok) throw new Error('http ' + res.status);
    return await res.blob();
  }
  // Web/PWA: cdn.vergr.app whitelists the vergr.app origin for CORS reads.
  const res = await fetch(url, { mode: 'cors', credentials: 'omit' });
  if (!res.ok) throw new Error('http ' + res.status);
  return await res.blob();
}

function makeObjUrl(url, blob) {
  const existing = objUrls.get(url);
  if (existing) return existing;
  const o = URL.createObjectURL(blob);
  objUrls.set(url, o);
  return o;
}

/** Sync peek — a ready object URL if this url was resolved THIS session. */
export function peekCachedMedia(url) {
  return (url && objUrls.get(url)) || null;
}

/**
 * Register a ready-to-render source for a url WITHOUT any device read, so the
 * very next `peekCachedMedia` for it is a synchronous hit.
 *
 * THIS EXISTS FOR ONE REASON. The self-profile snapshot holds the viewer's own
 * avatar as a data URI, so the first frame after launch paints their real face.
 * Then the Firestore user doc lands, `profile.avatar` flips from that data URI
 * to the remote cdn.vergr.app url, and `useCachedImage` looks that url up,
 * misses (the in-memory map is empty at boot — warmMedia is queued but async),
 * and blanks the image while it reads IndexedDB. Net result: the face appeared
 * instantly and then vanished and popped back in, which looks WORSE than never
 * having the head start at all.
 *
 * Seeding the remote url with the bytes we already hold makes that transition a
 * no-op: same src before and after, no repaint, no blank, no request.
 */
export function seedCachedMedia(url, src) {
  if (!url || !src || objUrls.has(url)) return;
  objUrls.set(url, src);
}

/**
 * The raw stored blob for a url, or null. Exists so callers that need the BYTES
 * (rather than an object URL) can get them without a second network round trip —
 * selfProfileCache turns the viewer's own avatar into a data URI this way.
 *
 * Reading from here matters on native specifically: `window.fetch` of
 * cdn.vergr.app is CORS-blocked inside the Tauri WebView, so anything that tries
 * to re-download bytes there fails silently. These bytes are already on disk,
 * fetched through tauri-plugin-http by fetchBytes().
 */
export async function getCachedBlob(url) {
  if (!url) return null;
  try {
    const row = await db.media.get(url);
    return row?.blob || null;
  } catch {
    return null;
  }
}

/**
 * LOCAL-ONLY resolve: returns a local object URL if the image is already on the
 * device (memory or IndexedDB), else null. NEVER touches the network — so it's
 * fast and safe to call on the cold-boot render path.
 */
async function getLocalObjectUrl(url) {
  const mem = objUrls.get(url);
  if (mem) return mem;
  try {
    const row = await db.media.get(url);
    if (row?.blob) return makeObjUrl(url, row.blob);
  } catch {
    /* ignore */
  }
  return null;
}

let pruneScheduled = false;
function schedulePrune() {
  if (pruneScheduled) return;
  pruneScheduled = true;
  setTimeout(async () => {
    pruneScheduled = false;
    try {
      const rows = await db.media.orderBy('ts').toArray();
      let total = rows.reduce((s, r) => s + (r.bytes || 0), 0);
      let over = rows.length - MAX_ENTRIES;
      for (const r of rows) {
        if (over <= 0 && total <= MAX_BYTES) break;
        await evictOne(r.url);
        total -= r.bytes || 0;
        over -= 1;
      }
    } catch {
      /* ignore */
    }
  }, 1500);
}

async function evictOne(url) {
  try {
    await db.media.delete(url);
  } catch {
    /* ignore */
  }
  const o = objUrls.get(url);
  if (o) {
    URL.revokeObjectURL(o);
    objUrls.delete(url);
  }
}

/** Fetch bytes over the network and persist them (once). Returns the local
 *  object URL, or null if the fetch failed. Deduped per url. */
function cacheFromNetwork(url) {
  // WEB/PWA: cdn.vergr.app does NOT send an Access-Control-Allow-Origin header
  // for a cross-origin byte read, so a fetch() here only ever throws a CORS
  // error (and a noisy net::ERR_FAILED). The device blob store is a native-only
  // optimisation anyway — on the web the browser's own HTTP cache already
  // persists these images (R2 serves them immutable/max-age=1y), and <img>
  // DISPLAY needs no CORS. So skip the byte-fetch entirely off-native.
  if (!isTauri()) return Promise.resolve(null);
  if (netInflight.has(url)) return netInflight.get(url);
  const p = (async () => {
    let blob = null;
    try {
      blob = await fetchBytes(url);
    } catch {
      return null;
    }
    if (!blob) return null;
    try {
      if (blob.size <= PER_FILE_MAX) {
        await db.media.put({ url, blob, ts: Date.now(), bytes: blob.size || 0 });
        schedulePrune();
      }
    } catch {
      /* quota / private-mode — best-effort */
    }
    return makeObjUrl(url, blob);
  })();
  netInflight.set(url, p);
  p.finally(() => netInflight.delete(url));
  return p;
}

/**
 * Full resolve: local-first, then network. Returns a local object URL once the
 * bytes are on-device, else null. Used by warmMedia (pre-fetch).
 */
export async function resolveCachedMedia(url) {
  if (!isCacheable(url)) return null;
  const local = await getLocalObjectUrl(url);
  if (local) return local;
  return cacheFromNetwork(url);
}

/**
 * Pre-fetch a set of images into the on-device store BEFORE they're on screen
 * (e.g. your own avatar/banner + recent chat avatars on app boot), so they're
 * already local (sync hit) when they render. Bounded concurrency; silent.
 */
export async function warmMedia(urls) {
  const list = [...new Set((urls || []).filter(isCacheable))];
  if (!list.length) return;
  let i = 0;
  const worker = async () => {
    while (i < list.length) {
      const u = list[i++];
      if (objUrls.has(u)) continue;
      try {
        await resolveCachedMedia(u);
      } catch {
        /* ignore */
      }
    }
  };
  await Promise.all([worker(), worker(), worker()]);
}

/**
 * React hook: the best src to render RIGHT NOW for an image url.
 * - Sync hit (already resolved this session): the local object URL, instantly.
 * - Otherwise we read the ON-DEVICE store FIRST (fast, no network): a cached
 *   image shows from its local blob with no cold-CDN fetch; a true miss shows
 *   the remote url (first sight) and caches in the background for next time.
 *
 * While the (fast) local read is pending we return '' so the caller paints its
 * placeholder rather than kicking off a slow remote load we may not need.
 */
export function useCachedImage(url, opts = {}) {
  // policyGated = true for CHAT media (respects the auto-download setting);
  // avatars/banners leave it false so they always persist (instant-avatar UX).
  const policyGated = !!opts.policyGated;
  // permanent = avatars, banners, chat backgrounds. Small, long-lived, and the
  // things whose absence is most obvious, so they go in storage Android will not
  // reclaim. Everything else lands in the OS-reclaimable tier.
  const permanent = !!opts.permanent;
  // Native shell = the device blob cache (instant avatars). Web/PWA has no such
  // cache (the cross-origin byte read is CORS-blocked and pointless — the
  // browser HTTP-caches these images itself), so it renders the remote URL
  // directly: no '' placeholder flash, no failing fetch, no console errors.
  const native = isTauri();

  // ── Preferred path: real files on disk, addressed by a name we can compute.
  // Nothing here awaits, so the first painted frame is already correct. The
  // Dexie path below is kept for desktop (no bridge yet) and for anyone still
  // on an older build.
  const useFiles = native && isFileCacheAvailable();
  const [fileSrc, setFileSrc] = useState(() => (useFiles ? localSrcFor(url) || url || '' : ''));

  useEffect(() => {
    if (!useFiles) return undefined;
    const local = localSrcFor(url);
    if (local) { setFileSrc(local); return undefined; }
    setFileSrc(url || '');
    if (!url || !isCacheable(url)) return undefined;
    if (policyGated && !shouldAutoDownloadMedia()) return undefined;
    // Deliberately NOT swapping to the local file once it lands. The remote copy
    // is already on screen by then, so switching would force a second decode of
    // an identical image for no visible gain. The saved file is for next time.
    storeMedia(url, { permanent }).catch(() => {});
    return undefined;
  }, [url, useFiles, permanent, policyGated]);

  const [src, setSrc] = useState(() =>
    native ? (peekCachedMedia(url) || (isCacheable(url) ? '' : url || '')) : (url || ''),
  );

  useEffect(() => {
    if (useFiles) return undefined;
    if (!native) {
      setSrc(url || '');
      return undefined;
    }
    if (!url) {
      setSrc('');
      return;
    }
    const mem = peekCachedMedia(url);
    if (mem) {
      setSrc(mem);
      return;
    }
    if (!isCacheable(url)) {
      setSrc(url);
      return;
    }
    let alive = true;
    setSrc(''); // placeholder while we check on-device (no slow remote yet)
    getLocalObjectUrl(url).then((local) => {
      if (!alive) return;
      if (local) {
        setSrc(local); // cached on device → instant, zero network
        return;
      }
      setSrc(url); // miss → show remote now (first sight)
      // Persist for next time — unless this is policy-gated chat media the
      // user's auto-download setting says not to cache on this network.
      if (!policyGated || shouldAutoDownloadMedia()) cacheFromNetwork(url);
    });
    return () => {
      alive = false;
    };
  }, [url, policyGated, native, useFiles]);

  return useFiles ? fileSrc : src;
}

/**
 * Call from an <img> onError when the rendered source was a local file.
 *
 * Android can clear the reclaimable cache tier at any time without telling us,
 * which leaves our in-memory manifest claiming a file that no longer exists.
 * Forgetting the key here is what lets the next render fall through to the
 * remote URL; without it a single OS cleanup would leave broken images for the
 * rest of the session.
 */
export function reportImageError(url) {
  try { forgetLocal(url); } catch { /* best effort */ }
}
