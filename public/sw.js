// Vergr service worker.
//
// Intentionally NO third-party ad service worker here. Monetag's In-Page Push
// format spawns corner popups that look spammy and hurt app credibility, and
// AdSense explicitly forbids running one. Keeping this file clean protects the
// AdSense account.
//
// ⚠ FILE SIZE. This file was 6.29 MB on disk between commit 687802d and
// 2026-08-20 — a single comment line had grown to 2.8 million characters of
// repeatedly double-encoded mojibake (an em dash re-encoded on every edit).
// Every visitor downloaded it, and the browser re-fetches a service worker on
// each update check. It is 6 KB again. If it ever grows past ~20 KB, something
// has re-encoded it: check with `awk 'length($0)>400' public/sw.js` and never
// edit this file with a tool that rewrites its encoding.

const CACHE_NAME = 'vergr-v206';

// Avatars: a dedicated, size-bounded cache so inbox + chat rows paint their
// profile pictures instantly (and offline). Scoped to small IMAGE responses
// only so chat/clip VIDEOS are never cached here. Bounded (FIFO) to ~200
// entries. Kept across SW updates (the activate cleanup preserves it).
const AVATAR_CACHE = 'vergr-avatars';
const AVATAR_MAX_ENTRIES = 200;
const AVATAR_MAX_BYTES = 512 * 1024;

function isCacheableAvatar(url, req) {
  if (req.method !== 'GET' || req.headers.has('range')) return false;
  if (url.hostname.endsWith('googleusercontent.com')) return true; // Google profile pics
  if (url.hostname === 'cdn.vergr.app') {
    if (/\.(mp4|webm|m3u8|m4s|ts|mov)(\?|$)/i.test(url.pathname)) return false; // never videos
    return /\.(png|jpe?g|webp|gif|avif)(\?|$)/i.test(url.pathname) || /avatar|profile/i.test(url.pathname);
  }
  return false;
}

async function trimAvatarCache(cache) {
  const keys = await cache.keys();
  if (keys.length <= AVATAR_MAX_ENTRIES) return;
  for (let i = 0; i < keys.length - AVATAR_MAX_ENTRIES; i++) await cache.delete(keys[i]);
}

async function avatarCacheFirst(request) {
  const cache = await caches.open(AVATAR_CACHE);
  const hit = await cache.match(request);
  if (hit) return hit;
  try {
    const resp = await fetch(request);
    // isCacheableAvatar already scoped these to avatar hosts + non-video paths.
    // CORS-enabled responses (status 200) get the extra image/size guard.
    if (resp) {
      if (resp.type === 'opaque') {
        cache.put(request, resp.clone()).then(() => trimAvatarCache(cache)).catch(() => {});
      } else if (resp.status === 200) {
        const ct = resp.headers.get('Content-Type') || '';
        const len = Number(resp.headers.get('Content-Length') || 0);
        if (ct.startsWith('image/') && (!len || len <= AVATAR_MAX_BYTES)) {
          cache.put(request, resp.clone()).then(() => trimAvatarCache(cache)).catch(() => {});
        }
      }
    }
    return resp;
  } catch {
    return (await cache.match(request)) || Response.error();
  }
}

// Static media bundled for INSTANT load (and offline). Adding a file here makes
// it precache on the next SW activation (bump CACHE_NAME when you change this).
const PRECACHE = [
  '/index.html', '/',
  // Plain-zero override for DM Mono (see index.html @font-face)
  '/fonts/dmmono-zero-v2.ttf',
  '/backgrounds/static/bg_1.png', '/backgrounds/static/bg_2.png', '/backgrounds/static/bg_3.png',
  '/backgrounds/static/bg_4.png', '/backgrounds/static/bg_5.png', '/backgrounds/static/bg_6.png',
  '/backgrounds/static/bg_7.png',
  '/backgrounds/static/bg_1_Desktop.webp', '/backgrounds/static/bg_2_Desktop.webp',
  '/backgrounds/static/bg_3_Desktop.webp', '/backgrounds/static/bg_4_Desktop.webp',
  '/backgrounds/static/bg_5_Desktop.webp', '/backgrounds/static/bg_6_Desktop.webp',
  // Notification + ringtone sounds
  '/sounds/message.mp3', '/sounds/social.mp3', '/sounds/tournament.mp3', '/sounds/default.mp3',
  // Core icons + brand chrome
  '/icons/icon-192-v2.png', '/icons/icon-512-v2.png', '/icons/badge-v.png',
  '/icons/apple-touch-icon-v2.png', '/brand/logo.png', '/brand/loader-nebula.webp',
];

// Skip waiting immediately to replace an old broken SW + precache static media.
// Resilient: one missing file must NOT fail the whole install, so we add each
// entry individually (cache.addAll rejects atomically; allSettled does not).
self.addEventListener('install', (e) => {
  self.skipWaiting();
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      Promise.allSettled(PRECACHE.map((u) => cache.add(u)))
    )
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then(keys =>
      // AVATAR_CACHE is deliberately preserved: it is expensive to refill and
      // self-bounds, so wiping it on every update would defeat the point.
      Promise.all(keys.filter(k => k !== CACHE_NAME && k !== AVATAR_CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim()) // Take control immediately
  );
});

/**
 * Always resolve to a real Response.
 *
 * `caches.match()` resolves to UNDEFINED on a miss, and passing undefined to
 * respondWith() makes the browser throw "Failed to convert value to 'Response'"
 * and turn the request into a network error. The navigation branch below has
 * guarded against this for a while; the asset branch did not, which is what
 * produced the console pair:
 *     The FetchEvent for "..." resulted in a network error response
 *     Uncaught (in promise) TypeError: Failed to convert value to 'Response'
 * Both branches now go through here.
 */
async function cacheOrOffline(request, { shell = false } = {}) {
  const hit = shell
    ? (await caches.match('/index.html')) || (await caches.match('/')) || (await caches.match(request))
    : await caches.match(request);
  if (hit) return hit;
  if (shell) {
    return new Response(
      '<meta charset="utf-8"><body style="margin:0;background:#07080D;color:#fff;'
      + 'font:14px system-ui,-apple-system,sans-serif"><p style="padding:24px">'
      + 'Connection lost. Reload to continue.</p></body>',
      { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } },
    );
  }
  // A missing asset is not a page: hand back a real, empty error Response
  // rather than undefined, so the request fails normally instead of throwing.
  return new Response('', { status: 504, statusText: 'Offline' });
}

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);

  // Avatars go to the bounded avatar cache. MUST be checked before the
  // cross-origin guard below, which would otherwise let these bypass the SW.
  if (isCacheableAvatar(url, e.request)) {
    e.respondWith(avatarCacheFirst(e.request));
    return;
  }

  // NEVER intercept Firebase, Google APIs, or external service calls
  if (
    url.hostname.includes('firestore.googleapis.com')
    || url.hostname.includes('firebase')
    || url.hostname.includes('googleapis.com')
    || url.hostname.includes('gstatic.com')
    || url.hostname.includes('giphy.com')
    || url.hostname.includes('rss2json.com')
    || url.hostname.includes('dicebear.com')
    || url.hostname !== self.location.hostname
  ) {
    return; // Let the browser handle it natively
  }

  // VLink is a SEPARATE product served from this same origin (/vlink/** and
  // /l/** are Hosting rewrites to VLink's Cloud Functions). Do not touch its
  // requests, same rule and same reason as the guards above.
  //
  // WHY THIS EXISTS. The navigation branch below caches EVERY successful
  // navigation under one shared key, '/index.html', and serves that key on any
  // fetch failure. With two products on one origin that key is whichever page
  // loaded last. A merchant who had used vergr.app stored the logged-in Vergr
  // shell there; when the Shopify admin then framed a VLink URL and the request
  // failed (a Cloud Functions cold start is exactly when it does), the catch
  // served Vergr's app INSIDE the Shopify admin, account page and checkout
  // included. Shopify App Review saw it and paused the submission under
  // requirement 1.2.1, ref 126602.
  if (url.pathname.startsWith('/vlink') || url.pathname.startsWith('/l/')) {
    return; // VLink's own service worker handles these
  }

  // Navigation (SPA routing): network-first, cache the shell on every success,
  // and always resolve to a real Response on failure.
  if (e.request.mode === 'navigate') {
    e.respondWith(
      fetch(e.request)
        .then((resp) => {
          if (resp && resp.status === 200) {
            const clone = resp.clone();
            caches.open(CACHE_NAME).then((c) => c.put('/index.html', clone));
          }
          return resp;
        })
        .catch(() => cacheOrOffline(e.request, { shell: true })),
    );
    return;
  }

  // ⚠⚠ /assets/** IS CACHE-FIRST, AND NOT CLONED ON THE CRITICAL PATH.
  //
  // THE BUG THIS FIXES: the app hung on the boot splash, repeatedly, after a deploy.
  // Measured during a hang — entry chunk 200 and byte-identical (3,745,141 bytes via
  // SW, network and cache), 8.2s to deliver, readyState complete, NO console error,
  // no further module fetched, React never mounted (#root still held #boot-splash).
  // A second reload always fixed it.
  //
  // The asset branch used to network-first and then `response.clone()` + `cache.put`
  // on EVERY same-origin file. For the 3.7MB entry module that means cloning multi-
  // megabyte bodies while the page is trying to stream and evaluate the same bytes;
  // both branches of a cloned stream must be buffered until each is consumed, which
  // is the classic way to stall a large response inside a worker.
  //
  // And it bought NOTHING: firebase.json serves /assets/** as
  //     public, max-age=31536000, immutable
  // on content-hashed filenames. The browser HTTP cache already holds them for a year
  // and they can never go stale, so a second copy in the Cache API was pure cost.
  //
  // Cache-first is always correct for an immutable hashed URL: a hit is guaranteed
  // right, needs no network, and does no cloning. A miss fetches once and stores it
  // in waitUntil — off the response path, so a slow put can never hold up the page.
  if (url.pathname.startsWith('/assets/')) {
    e.respondWith((async () => {
      const hit = await caches.match(e.request);
      if (hit) return hit;
      try {
        const fresh = await fetch(e.request);
        if (fresh && fresh.status === 200) {
          const copy = fresh.clone();
          e.waitUntil(caches.open(CACHE_NAME).then((c) => c.put(e.request, copy)));
        }
        return fresh;
      } catch {
        return cacheOrOffline(e.request);
      }
    })());
    return;
  }

  // Everything else same-origin: network-first with cache fallback.
  e.respondWith(
    fetch(e.request)
      .then((response) => {
        if (response && response.status === 200) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(e.request, clone));
        }
        return response;
      })
      .catch(() => cacheOrOffline(e.request)),
  );
});
