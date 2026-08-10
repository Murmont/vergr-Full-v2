// B6 (NATIVE_APP_PLAN Part B): tiny local cache for the home feed so the app
// renders the last-seen posts INSTANTLY on open (no skeleton, no wait), then
// silently refreshes from the network. This is the repeat-open Firestore-read
// + perceived-speed win — the user sees content the moment the screen mounts.
//
// We cache only the first page (MAX items) per tab. Firestore Timestamps are
// converted to millis (timeAgo() reads numbers fine) and the live
// DocumentSnapshot cursor (`_doc`/`_lastDoc`) is dropped — it can't be
// persisted, so infinite-scroll/pull-to-refresh resume once the fresh fetch
// lands (which happens immediately on mount).

const KEY = (tab) => `vergr.feedcache.${tab}`;
// Must match the For You fetch size (30). At 10 the cached paint was a different,
// smaller pool than the network paint, so the two rankings disagreed and the feed
// visibly reordered a second after every open. Cache what we actually fetch.
const MAX = 30;

function sanitize(post) {
  const { _doc, ...rest } = post;
  const out = { ...rest };
  for (const k of Object.keys(out)) {
    const v = out[k];
    if (v && typeof v.toMillis === 'function') {
      try { out[k] = v.toMillis(); } catch {}
    }
  }
  return out;
}

export function readFeedCache(tab) {
  try {
    const raw = localStorage.getItem(KEY(tab));
    if (!raw) return null;
    const arr = JSON.parse(raw);
    return Array.isArray(arr) && arr.length ? arr : null;
  } catch { return null; }
}

export function writeFeedCache(tab, posts) {
  try {
    if (!Array.isArray(posts) || !posts.length) return;
    const slim = posts.slice(0, MAX).map(sanitize);
    localStorage.setItem(KEY(tab), JSON.stringify(slim));
  } catch { /* quota / private mode — non-fatal */ }
}
