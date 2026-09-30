// chatIdentity — live identity resolution for chat surfaces.
//
// THE BUG THIS FIXES: conversation docs snapshot `metadata[uid].name/avatar`
// once at creation and never again, so the inbox showed stale display names
// forever and never the @username. Lists now resolve the LIVE user doc
// (module-level TTL cache so the inbox doesn't refetch on every render) and
// apply the viewer's per-contact nickname (Telegram/WhatsApp "rename this
// contact"), stored at users/{me}.contactNicknames.{them}.
//
// Resolution order everywhere: nickname → displayName → @username.

import { getUserById } from '../firebase/firestore';

const cache = new Map(); // uid -> { user, at }
const TTL = 5 * 60_000;

// ── Persistent identity cache ────────────────────────────────────────────────
// The in-memory `cache` is empty on every cold page load, so the first paint of
// the inbox fell back to the conversation's FROZEN `metadata` snapshot (old
// display names / letter-avatars) before the async fetch resolved the live
// identity — a visible "old → real" blink on every refresh. We persist a small
// identity subset to localStorage and hydrate the cache synchronously at module
// load, so `peekChatUser` returns last-known-good LIVE identity on the very
// first render. The async fetch still runs to pick up any real change.
const LS_KEY = 'vergr_chat_identity_v1';
const MAX_PERSISTED = 300; // cap so localStorage can't grow unbounded

// Only the fields chat surfaces actually render — keeps the store small and
// predictable (never persist big arrays like following/followers/blocked).
function slimUser(u) {
  if (!u) return null;
  return {
    uid: u.uid,
    displayName: u.displayName || null,
    username: u.username || null,
    name: u.name || null,
    avatar: u.avatar || null,
    photoURL: u.photoURL || null,
    coinsSpent: u.coinsSpent || 0,
    isVerified: u.isVerified || false,
    verified: u.verified || false,
    tier: u.tier || null,
    subscription: u.subscription || null,
    vanguard: u.vanguard || null,
    role: u.role || null,
    accountType: u.accountType || null,
    // ⚠ COSMETICS BELONG IN THE PERSISTED SUBSET. Without these two, a COLD
    // start rendered every chat surface with no name colour, no typeface, no
    // name gradient and the default typing indicator until the async refetch
    // landed — the same flash of not-quite-right identity this cache exists to
    // prevent, just for cosmetics instead of names. They are small: an accent
    // hex, a font id, up to six gradient stops, a style id.
    // `vpLevel` rides along because every resolver re-checks the level against
    // the equipped id (typingStyleFor, isEffectOn), so persisting the choice
    // without the level would resolve everything back to the default anyway.
    vpLevel: u.vpLevel || null,
    cosmetics: u.cosmetics || null,
  };
}

function loadPersisted() {
  // RUNS ON EVERY PLATFORM. This used to early-return on isTauri() "so the fix
  // does not alter the working native app", which meant the native app kept the
  // bug: with no persisted store, peekChatUser() returns null on a cold start,
  // every chat surface falls back to the FROZEN conversations.metadata snapshot,
  // and the user watches old names/avatars flash before the live ones resolve.
  // localStorage works fine in the Tauri WebView (seenPosts, feedCache and
  // navBadges all rely on it). Do not re-gate this by platform.
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return;
    const obj = JSON.parse(raw);
    for (const [uid, user] of Object.entries(obj || {})) {
      // at:0 → stale, so resolveChatUser still refetches; peek serves it now.
      if (uid && user) cache.set(uid, { user, at: 0 });
    }
  } catch { /* ignore */ }
}
loadPersisted();

let persistScheduled = false;
function schedulePersist() {
  if (persistScheduled) return; // all platforms, see loadPersisted()
  persistScheduled = true;
  setTimeout(() => {
    persistScheduled = false;
    try {
      const entries = [...cache.entries()]
        .filter(([, v]) => v?.user)
        .slice(-MAX_PERSISTED);
      const obj = {};
      for (const [uid, v] of entries) obj[uid] = slimUser(v.user);
      localStorage.setItem(LS_KEY, JSON.stringify(obj));
    } catch { /* quota / private-mode — best-effort */ }
  }, 800);
}

export async function resolveChatUser(uid) {
  if (!uid) return null;
  const hit = cache.get(uid);
  if (hit && Date.now() - hit.at < TTL) return hit.user;
  try {
    const user = await getUserById(uid);
    cache.set(uid, { user: user || null, at: Date.now() });
    if (user) schedulePersist();
    return user || null;
  } catch {
    return hit?.user || null;
  }
}

/** Synchronous cache read (no fetch). Lets a screen render the live identity
 *  instantly when another surface (e.g. the inbox) already warmed the cache,
 *  avoiding a flash of the stale metadata snapshot. Returns null on a miss. */
export function peekChatUser(uid) {
  if (!uid) return null;
  const hit = cache.get(uid);
  return hit ? hit.user : null;
}

/** Every identity already in the cache, with no fetch. Feeds the @mention
 *  suggestions in comments, which must cost no read. */
export function peekChatUsers() {
  const out = [];
  for (const [uid, v] of cache.entries()) {
    if (v?.user) out.push({ ...v.user, uid: v.user.uid || uid });
  }
  return out;
}

/** Batch resolve. Returns { uid: user }. Missing/failed uids are omitted. */
export async function resolveChatUsers(uids) {
  const unique = [...new Set((uids || []).filter(Boolean))];
  const out = {};
  await Promise.all(unique.map(async (uid) => {
    const u = await resolveChatUser(uid);
    if (u) out[uid] = u;
  }));
  return out;
}

/** Primary display name for a chat partner.
 *  viewerProfile = the CURRENT user's profile doc (carries contactNicknames). */
export function chatDisplayName(uid, liveUser, viewerProfile, fallback) {
  const nick = viewerProfile?.contactNicknames?.[uid];
  if (nick) return nick;
  return liveUser?.displayName || liveUser?.username || fallback || 'Unknown';
}

/** Secondary line: @username (only when it adds information). */
export function chatUsername(liveUser) {
  const u = liveUser?.username;
  return u ? `@${u}` : '';
}

/** THE ONE resolver every chat surface must use for a conversation row/header.
 *
 *  WHY THIS EXISTS: this logic was copy-pasted into the desktop panel, the web
 *  mobile inbox, the native inbox, the thread header, the details drawer and the
 *  folder editor. They drifted: native never picked up peekChatUser, so it kept
 *  rendering the frozen metadata snapshot and flashing old names/avatars. Route
 *  every surface through here; nothing else should touch `conv.metadata`.
 *
 *  ORDER: live doc -> persisted/in-memory identity cache -> frozen snapshot.
 *  The snapshot is LAST RESORT ONLY, for a conversation whose partner this
 *  device has genuinely never resolved (otherwise a blank row is worse). When
 *  that happens `resolved` is false, so a caller that would rather show a
 *  neutral placeholder than someone's outdated name can do so.
 *
 *  @param liveUsers optional { uid: userDoc } map the screen already fetched.
 */
export function chatPartner(conv, me, viewerProfile, liveUsers) {
  const otherId = (conv?.participants || []).find((p) => p !== me) || null;
  // Official announcement channels. Their identity lives on the channel doc, not
  // on a user doc, and `participants` is just [me], so without this branch the
  // generic path below resolves otherId to null and renders "Unknown" with no
  // avatar. Handled here rather than at each callsite because this function is
  // the single resolver every chat surface uses.
  if (conv?.isOfficial) {
    const ch = conv.otherUsers?.[0] || {};
    return {
      otherId: null,
      channelId: conv.channelId || null,
      isOfficial: true,
      name: ch.displayName || 'Vergr',
      username: ch.username || '',
      avatar: ch.avatar || null,
      coinsSpent: 0,
      live: null,
      resolved: true, // the channel doc IS the live source; nothing to hydrate
    };
  }
  if (conv?.isGroup) {
    return {
      otherId: null,
      name: conv.groupName || 'Group',
      username: '',
      // TWO field names exist for the same thing and this resolver only knew
      // one of them:
      //   groupIcon   — written by GroupInfoScreen when a USER sets a group's
      //                 picture. What this line used to read.
      //   groupAvatar — written by the SERVER when it creates a group-shaped
      //                 conversation: supportChannel.js:184 (the support
      //                 thread) and officialChannels.js:641 (a community
      //                 channel's room).
      // So every server-created conversation rendered with no picture in the
      // inbox and fell through to UserAvatar's grey person placeholder. It
      // looked like a broken upload because `groupName` DID resolve — the name
      // was right and only the avatar was missing.
      // Both are read here rather than renaming either, because both have live
      // writers and readers elsewhere and a rename needs a data migration.
      avatar: conv.groupIcon || conv.groupAvatar || null,
      coinsSpent: 0,
      live: null,
      resolved: true, // group name/icon live on the conversation doc, never stale
    };
  }
  const snapshot = conv?.metadata?.[otherId] || {};
  const live = (liveUsers && liveUsers[otherId]) || peekChatUser(otherId) || null;
  return {
    otherId,
    name: chatDisplayName(otherId, live, viewerProfile, snapshot.name || 'Unknown'),
    username: chatUsername(live),
    avatar: live ? (live.avatar || live.photoURL || null) : (snapshot.avatar || null),
    coinsSpent: live?.coinsSpent ?? snapshot.coinsSpent ?? 0,
    live,
    resolved: !!live,
  };
}

/** Stable per-user accent colour for group sender names (Telegram-style). */
const SENDER_COLORS = ['#4DFFD4', '#B44FFF', '#F5C842', '#3D7FFF', '#F04060', '#C87FFF', '#7FE08A', '#FF9F5A'];
export function senderColor(uid) {
  let h = 0;
  for (let i = 0; i < (uid || '').length; i++) h = ((h << 5) - h + uid.charCodeAt(i)) | 0;
  return SENDER_COLORS[Math.abs(h) % SENDER_COLORS.length];
}
