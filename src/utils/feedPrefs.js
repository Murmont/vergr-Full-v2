// Viewer feed preferences — behavioral-first, content-agnostic. We accumulate
// three weight maps from what the viewer actually engages with, PLUS explicit
// negatives. All device-local (localStorage) so it's free + instant. These work
// on EVERY post regardless of topic (a meme, an IRL clip, a game highlight):
//   • authorWeights  — engaged-with creators (the biggest signal, TikTok-style)
//   • hashtagWeights — engaged-with hashtags (generalizes to any content)
//   • topicWeights   — inferred/declared topics (a lighter secondary boost)
// Read by feedRank.rankForYou; written by captureInterest + the PostCard
// "Not interested" controls. The topic map is later mirrored to the user doc.

const AUTHORS_KEY  = 'vergr_author_weights_v1';
const HASHTAGS_KEY = 'vergr_hashtag_weights_v1';
const TOPICS_KEY   = 'vergr_topic_weights_v1';
const NEG_KEY      = 'vergr_feed_negatives_v2'; // { authors:[], topics:[] }

const _read = (k, fallback) => { try { return JSON.parse(localStorage.getItem(k)) || fallback; } catch { return fallback; } };
const _write = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };

// ── Weekly ×0.95 decay applied lazily on read, per map ─────────────────────
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const _decay = (key, map) => {
  try {
    const stamp = `${key}__decay_at`;
    const last = Number(localStorage.getItem(stamp)) || 0;
    const now = Date.now();
    if (now - last >= WEEK_MS) {
      const weeks = last ? Math.min(8, Math.floor((now - last) / WEEK_MS)) : 0;
      if (weeks > 0) {
        const f = Math.pow(0.95, weeks);
        for (const k of Object.keys(map)) { map[k] *= f; if (map[k] < 0.05) delete map[k]; }
        _write(key, map);
      }
      localStorage.setItem(stamp, String(now));
    }
  } catch {}
  return map;
};

// Cap map size so localStorage can't grow unbounded (keep the heaviest N).
const _cap = (map, n) => {
  const keys = Object.keys(map);
  if (keys.length <= n) return map;
  const top = keys.sort((a, b) => map[b] - map[a]).slice(0, n);
  const out = {}; for (const k of top) out[k] = map[k]; return out;
};

const _bump = (key, ids, amount, cap) => {
  const list = [...(ids || [])].filter(Boolean);
  if (list.length === 0) return;
  const map = _read(key, {});
  for (const id of list) map[id] = (map[id] || 0) + amount;
  _write(key, _cap(map, cap));
  scheduleFlush();
};

// ── Author affinity ────────────────────────────────────────────────────────
export const getAuthorWeights = () => _decay(AUTHORS_KEY, _read(AUTHORS_KEY, {}));
export const bumpAuthor = (authorId, amount = 1) => _bump(AUTHORS_KEY, [authorId], amount, 400);

// ── Hashtag affinity ───────────────────────────────────────────────────────
const cleanTag = (t) => String(t).toLowerCase().replace(/^#/, '').trim();
export const getHashtagWeights = () => _decay(HASHTAGS_KEY, _read(HASHTAGS_KEY, {}));
export const bumpHashtags = (tags, amount = 1) => _bump(HASHTAGS_KEY, (tags || []).map(cleanTag), amount, 600);

// ── Topic affinity (lighter, secondary) ────────────────────────────────────
export const getTopicWeights = () => _decay(TOPICS_KEY, _read(TOPICS_KEY, {}));
export const bumpTopics = (topics, amount = 1) => _bump(TOPICS_KEY, (topics || []).map(t => String(t).toLowerCase()), amount, 60);

// ── Explicit negatives ("Not interested" / "See less") ─────────────────────
export const getNegatives = () => {
  const n = _read(NEG_KEY, { authors: [], topics: [] });
  return {
    authors: new Set(n.authors || []),
    topics: new Set((n.topics || []).map(t => String(t).toLowerCase())),
  };
};
export const addNegativeAuthor = (uid) => {
  if (!uid) return;
  const n = _read(NEG_KEY, { authors: [], topics: [] });
  if (!(n.authors || []).includes(uid)) { n.authors = [...(n.authors || []), uid]; _write(NEG_KEY, n); scheduleFlush(); }
};
// Negative "topic" is matched against both post topics AND hashtags at score
// time, so this covers "see less of #tag" and "see less of {topic}" uniformly.
export const addNegativeTopic = (topic) => {
  if (!topic) return;
  const t = cleanTag(topic);
  const n = _read(NEG_KEY, { authors: [], topics: [] });
  if (!(n.topics || []).map(cleanTag).includes(t)) { n.topics = [...(n.topics || []), topic]; _write(NEG_KEY, n); scheduleFlush(); }
};
export const removeNegativeAuthor = (uid) => {
  const n = _read(NEG_KEY, { authors: [], topics: [] });
  n.authors = (n.authors || []).filter(a => a !== uid); _write(NEG_KEY, n);
  scheduleFlush();
};

// ── Cross-device sync (SLICE 3) ────────────────────────────────────────────
// Mirror the three weight maps + negatives to an OWNER-ONLY private user doc
// (users/{uid}/private/feedPrefs) so ranking follows the viewer across devices.
// Reads happen once on the For You load; writes are debounced to at most one
// every ~45s of activity. Both are zero-fan-out own-doc ops.
let _flush = null;          // () => Promise, registered by initPrefsSync
let _flushTimer = null;
let _merged = false;

export const scheduleFlush = () => {
  if (!_flush || _flushTimer) return;
  _flushTimer = setTimeout(() => { _flushTimer = null; try { _flush(); } catch {} }, 45000);
};
export const flushNow = () => {
  if (_flushTimer) { clearTimeout(_flushTimer); _flushTimer = null; }
  if (_flush) { try { _flush(); } catch {} }
};

export const exportPrefs = () => ({
  authorWeights: _read(AUTHORS_KEY, {}),
  hashtagWeights: _read(HASHTAGS_KEY, {}),
  topicWeights: _read(TOPICS_KEY, {}),
  negatives: _read(NEG_KEY, { authors: [], topics: [] }),
});

const _mergeMap = (key, remote, cap) => {
  if (!remote || typeof remote !== 'object') return;
  const map = _read(key, {});
  for (const [k, v] of Object.entries(remote)) map[k] = Math.max(map[k] || 0, Number(v) || 0);
  _write(key, _cap(map, cap));
};

// Merge a remote prefs blob into the local maps ONCE per session (union of
// weights = max, union of negatives). Safe to call with null/partial.
export const mergeRemotePrefs = (remote) => {
  if (_merged || !remote) return;
  _merged = true;
  _mergeMap(AUTHORS_KEY, remote.authorWeights, 400);
  _mergeMap(HASHTAGS_KEY, remote.hashtagWeights, 600);
  _mergeMap(TOPICS_KEY, remote.topicWeights, 60);
  if (remote.negatives) {
    const local = _read(NEG_KEY, { authors: [], topics: [] });
    const au = new Set([...(local.authors || []), ...(remote.negatives.authors || [])]);
    const to = new Set([...(local.topics || []), ...(remote.negatives.topics || [])]);
    _write(NEG_KEY, { authors: [...au], topics: [...to] });
  }
};

// writeFn: (prefsObject) => Promise — e.g. (p) => saveFeedPrefs(uid, p).
export const initPrefsSync = (writeFn) => { _flush = () => writeFn(exportPrefs()); };
