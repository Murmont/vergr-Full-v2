// Session cache of the viewer's followed uids, so the For You ranker
// (feedRank.rankForYou) can boost followed authors WITHOUT re-reading the
// whole `follows` collection on every feed render. Fetched once per session by
// HomeFeedScreen (via getFollowing), then kept in sync by followUser /
// unfollowUser in firestore.js (they call add/remove here). Pure store — it
// imports nothing so it can be imported from firestore.js with no cycle.

let _set = new Set();
let _loaded = false;

export const isFollowingLoaded = () => _loaded;

// Replace the whole set (called after the one-time getFollowing fetch).
export const setFollowingCache = (ids) => {
  _set = new Set((ids || []).filter(Boolean));
  _loaded = true;
};

export const getFollowingSet = () => _set;
export const isFollowingCached = (uid) => _set.has(uid);

export const addFollowingCache = (uid) => { if (uid) _set.add(uid); };
export const removeFollowingCache = (uid) => { if (uid) _set.delete(uid); };

// Force a re-fetch next time (e.g. account switch / logout).
export const resetFollowingCache = () => { _set = new Set(); _loaded = false; };
