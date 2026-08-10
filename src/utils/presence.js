// Shared online-presence predicate. Used wherever we render a status dot or
// "online" indicator for a user.
//
// A user counts as online when ALL of:
//   1. Their user doc says `isOnline === true` (set by usePresence on mount).
//   2. Their `lastSeen` is within the last 5 minutes. We need this floor
//      because the offline-flip only fires on `beforeunload` — browser
//      crashes or sudden network drops leave `isOnline` stuck `true` forever.
//   3. They haven't hidden their online status via privacy settings
//      (`settings.privacy.onlineStatus` — default true).
//
// Returns false for null/undefined users so call sites don't need defensive
// guards. Also returns false if the privacy setting is explicitly disabled,
// so the dot disappears for users who've opted out.

const FRESH_MS = 5 * 60 * 1000;

// Freshness window for RTDB `/status/{uid}` presence. A user counts as online
// only if their heartbeat (last_changed) is this recent — onDisconnect alone is
// unreliable (stale `online` states linger for days). Must be comfortably
// larger than the usePresence heartbeat interval (~60s) so a genuinely-online
// user is never flickered offline between beats.
export const PRESENCE_FRESH_MS = 3 * 60 * 1000;

// online = state 'online' AND last_changed within the freshness window.
// `s` = { state, ts } where ts is RTDB last_changed (ms since epoch).
export function isStatusOnline(s) {
  if (!s || s.state !== 'online') return false;
  const ts = typeof s.ts === 'number' ? s.ts : 0;
  if (!ts) return false; // online but no/zero timestamp → don't trust (stale)
  return (Date.now() - ts) < PRESENCE_FRESH_MS;
}

// Firestore-backed presence predicate (the cross-platform source of truth).
// IMPORTANT: RTDB does NOT work inside the native Tauri Android WebView — its
// WebSocket never connects, so `/status/{uid}` is never written or read on
// native (proven live: the usePresence heartbeat's Firestore write lands while
// the RTDB write in the SAME call silently fails). Firestore DOES work on
// native, so presence reads from `users/{uid}` instead: online when the
// heartbeat (`lastSeen`, refreshed ~60s by usePresence) is within the freshness
// window, the user hasn't explicitly signed out (`status:'offline'`), and they
// haven't hidden their online status. `data` = a users/{uid} doc.
export function isUserDocOnline(data) {
  if (!data) return false;
  if (data.settings?.privacy?.onlineStatus === false) return false;
  if (data.status === 'offline') return false; // explicit sign-out → instant offline
  const ls = tsMs(data.lastSeen);
  if (!ls) return false;
  return (Date.now() - ls) < PRESENCE_FRESH_MS;
}

const tsMs = (t) => {
  if (!t) return 0;
  if (typeof t === 'number') return t;
  if (typeof t.toMillis === 'function') return t.toMillis();
  if (typeof t.seconds === 'number') return t.seconds * 1000;
  const parsed = Date.parse(t);
  return Number.isNaN(parsed) ? 0 : parsed;
};

// DEPRECATED: online status now lives in RTDB `/status/{uid}`. Read it with the
// useOnlineStatus(uid) hook (single user) or usePresenceMap(uids) (lists), then
// gate visibility with presenceVisible() below. This Firestore-flag predicate
// is kept only for back-compat and will always report offline now that the
// `isOnline` field is no longer written.
export function isUserOnline(user) {
  if (!user) return false;
  if (user.settings?.privacy?.onlineStatus === false) return false;
  if (!user.isOnline) return false;
  const ls = tsMs(user.lastSeen);
  if (!ls) return true; // isOnline true but no lastSeen — trust the flag
  return (Date.now() - ls) < FRESH_MS;
}

// Helper for "should we render a dot at all for this user".
// Distinct from isUserOnline because we want to hide the dot entirely when
// the user has opted out — even an "offline" grey dot would leak the fact
// that they exist on the platform right now.
export function presenceVisible(user) {
  if (!user) return false;
  return user.settings?.privacy?.onlineStatus !== false;
}
