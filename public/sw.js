// Vergr Service Worker v3 — PWA cache only
// ─────────────────────────────────────────────────────────
// Intentionally NO third-party ad service worker here.
// Monetag's In-Page Push format spawns corner popups that look spammy
// and hurt app credibility, and AdSense explicitly forbids running a
// competing ad network's SW on the same origin as AdSense ads — keeping
// this file clean protects the AdSense account.
// ─────────────────────────────────────────────────────────

const CACHE_NAME = 'vergr-v7';

// Skip waiting immediately to replace old broken SW
self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim()) // Take control immediately
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);

  // NEVER intercept Firebase, Google APIs, or external service calls
  if (
    url.hostname.includes('firestore.googleapis.com') ||
    url.hostname.includes('firebase') ||
    url.hostname.includes('googleapis.com') ||
    url.hostname.includes('gstatic.com') ||
    url.hostname.includes('giphy.com') ||
    url.hostname.includes('rss2json.com') ||
    url.hostname.includes('dicebear.com') ||
    url.hostname !== self.location.hostname
  ) {
    return; // Let the browser handle it natively
  }

  // Only handle navigation requests (SPA routing)
  if (e.request.mode === 'navigate') {
    e.respondWith(
      fetch(e.request).catch(() => caches.match('/index.html'))
    );
    return;
  }

  // For same-origin assets, network-first with cache fallback
  e.respondWith(
    fetch(e.request)
      .then(response => {
        // Cache successful responses
        if (response && response.status === 200) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(e.request, clone));
        }
        return response;
      })
      .catch(() => caches.match(e.request))
  );
});
