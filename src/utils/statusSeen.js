// Seen-state for status/stories rings — the core "what's new" signal that
// makes stories legible. A story GROUP (one author) is unseen when its newest
// status id isn't in the local seen set. Opening the group marks it seen.
//
// Device-local (localStorage), keyed by uid, like other per-device read state
// in the app (chat folders, nav badges). Statuses are ephemeral (24h) so the
// set is pruned opportunistically by only ever storing the LATEST seen id per
// author — it can't grow unbounded per author, and old authors age out when
// their entry is overwritten or simply goes stale.

const KEY = (uid) => `vergr.statusSeen.${uid || 'anon'}`;

function read(uid) {
  try {
    const raw = localStorage.getItem(KEY(uid));
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
}

function write(uid, map) {
  try { localStorage.setItem(KEY(uid), JSON.stringify(map)); } catch { /* ignore */ }
}

/** Has the viewer seen this author's NEWEST status (by id)? */
export function isGroupSeen(uid, authorId, newestStatusId) {
  if (!authorId || !newestStatusId) return true;
  return read(uid)[authorId] === newestStatusId;
}

/** Mark an author's group seen up to its newest status id. */
export function markGroupSeen(uid, authorId, newestStatusId) {
  if (!authorId || !newestStatusId) return;
  const map = read(uid);
  if (map[authorId] === newestStatusId) return;
  map[authorId] = newestStatusId;
  write(uid, map);
  try { window.dispatchEvent(new CustomEvent('vergr:status-seen-changed')); } catch { /* ignore */ }
}
