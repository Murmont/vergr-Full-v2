// Device-local "read" cutoffs for the side-nav unread badges.
//
// Squad-chat unread and missed-call unread have no per-user server primitive
// (squad messages track readBy per-message; calls_history has no seen flag), so
// we keep a lightweight per-device cutoff in localStorage instead of adding
// Firestore reads/writes. A nav badge doesn't need cross-device sync.
//
// Changing a cutoff dispatches a window event so NotificationContext recomputes
// its badge counts immediately (it already holds the raw squad/call docs in
// memory from its listeners — no extra reads).

const SQUAD_KEY = 'vergr_squad_read_v1';
const CALLS_KEY = 'vergr_calls_seen_at';
export const NAV_BADGES_EVENT = 'vergr:nav-badges-changed';

function readMap(key) {
  try { return JSON.parse(localStorage.getItem(key) || '{}') || {}; } catch { return {}; }
}

export function getSquadReadMap() { return readMap(SQUAD_KEY); }

// Stamp a squad's chat as read up to now (called while its chat is open).
export function markSquadRead(squadId) {
  if (!squadId) return;
  try {
    const m = readMap(SQUAD_KEY);
    const now = Date.now();
    if (m[squadId] && now - m[squadId] < 2000) return; // debounce snapshot spam
    m[squadId] = now;
    localStorage.setItem(SQUAD_KEY, JSON.stringify(m));
    window.dispatchEvent(new Event(NAV_BADGES_EVENT));
  } catch { /* ignore */ }
}

export function getCallsSeenAt() {
  try { return Number(localStorage.getItem(CALLS_KEY)) || 0; } catch { return 0; }
}

// Stamp the call log as seen (called when the calls screen opens).
export function markCallsSeen() {
  try {
    localStorage.setItem(CALLS_KEY, String(Date.now()));
    window.dispatchEvent(new Event(NAV_BADGES_EVENT));
  } catch { /* ignore */ }
}
