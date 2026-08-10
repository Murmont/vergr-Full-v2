// Session-persistent "seen posts" ring buffer (device-local). A post is marked
// seen when its card has been substantially visible for ~1s (HomeFeedScreen
// attaches a cheap IntersectionObserver). feedRank.rankForYou lightly demotes
// seen posts so the feed doesn't feel frozen between sessions. Pure localStorage
// — no reads, no writes to Firestore.

const KEY = 'vergr_seen_posts_v1';
const CAP = 600;
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // prune entries older than 7 days

let _map = null; // { [id]: seenAtMs }

const _load = () => {
  if (_map) return _map;
  try {
    const raw = JSON.parse(localStorage.getItem(KEY)) || {};
    const now = Date.now();
    _map = {};
    for (const [id, t] of Object.entries(raw)) {
      if (typeof t === 'number' && now - t < MAX_AGE_MS) _map[id] = t;
    }
  } catch { _map = {}; }
  return _map;
};

let _flushTimer = null;
const _flush = () => {
  if (_flushTimer) return;
  _flushTimer = setTimeout(() => {
    _flushTimer = null;
    try {
      const m = _load();
      // Cap: keep the most recently seen CAP ids.
      const entries = Object.entries(m);
      if (entries.length > CAP) {
        entries.sort((a, b) => b[1] - a[1]);
        _map = Object.fromEntries(entries.slice(0, CAP));
      }
      localStorage.setItem(KEY, JSON.stringify(_map));
    } catch {}
  }, 800);
};

export const markSeen = (id) => {
  if (!id) return;
  const m = _load();
  if (m[id]) return; // already recorded (keep original timestamp)
  m[id] = Date.now();
  _flush();
};

export const hasSeen = (id) => !!_load()[id];

// A Set of all seen ids, for feeding into the ranker.
export const getSeenSet = () => new Set(Object.keys(_load()));
