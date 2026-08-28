// Official channels, client side.
//
// Vergr's own accounts appear in the message list as chats. See
// docs/ANNOUNCEMENTS_PLAN.md section 2. The two facts that shape this file:
//
// 1. A channel is ONE shared doc with ONE shared messages subcollection. The
//    inbox row is SYNTHESISED here rather than being a `conversations` doc,
//    because `getConversations` filters on `participants array-contains uid` and
//    a shared doc would appear in nobody's inbox.
//
// 2. `buildOfficialRows` deliberately emits rows in the EXACT shape the existing
//    chatOps helpers already read (`muted[uid]`, `pinned[uid]`, `archived[uid]`,
//    `unreadCount[uid]`, `lastMessageAt`). That is why the inbox needs no new
//    row component, no new sort and no new archive logic: isChatMutedFor,
//    isChatPinnedFor, isChatArchivedFor and sortInboxChats all work unchanged.
//
// Per-user state lives in ONE doc, `channel_state/{uid}`. There is NO
// unsubscribe field and no code path that would create one: founder decision D1
// is that a user may mute, clear or delete their own view of a channel but can
// never stop delivery.

import {
  collection, doc, query, where, orderBy, limit as fbLimit,
  onSnapshot, getDocs, getDoc, setDoc, serverTimestamp,
} from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { db } from './config';

/**
 * Ask the server which restricted channels this user can see, granting or
 * revoking their membership rows to match what they currently ARE.
 *
 * Membership is evaluated, never stamped once: a criteria channel has to stay
 * correct as people become creators, change tier or get banned. Called on app
 * open; idempotent, and it only writes when membership actually changed.
 */
export function resolveMyChannels() {
  return httpsCallable(getFunctions(undefined, 'europe-west1'), 'resolveMyChannels')({})
    .then((r) => r.data)
    .catch(() => ({ channels: [] }));
}

// What the inbox row says before anything has been posted. A channel is shown
// as soon as someone belongs to it, so this is the first thing a new creator or
// a user looking for help actually reads.
const EMPTY_PREVIEW = {
  broadcast: 'No messages yet',
  support: 'Tap to message us',
  community: 'Tap to open the room',
};

/**
 * Branded fallback avatar for a channel with no artwork.
 *
 * A channel is not a person, but with `avatarUrl: null` it fell through to
 * UserAvatar's PLACEHOLDER_AVATAR — the generic grey person silhouette. Vergr
 * Support shipped exactly like that (functions/supportChannel.js creates it
 * with `avatarUrl: null` and no support image exists in the repo), so the one
 * row a confused user is most likely to reach looked broken next to Offers and
 * Update Logs, which do have art.
 *
 * Built here rather than in the row components so every surface gets it from
 * one place: web inbox, native inbox, MessagesListPanel and the drawer all
 * consume buildOfficialRows(). Drop a real image on the channel doc's
 * `avatarUrl` at any time and it wins automatically.
 *
 * An inline data URI, not a remote request, matching the reasoning on
 * UserAvatar's own placeholder: this renders on list rows, and a network fetch
 * per empty row is what that constant exists to avoid.
 */
function channelFallbackAvatar(name, accent) {
  const letter = String(name || 'V').trim().charAt(0).toUpperCase() || 'V';
  const color = /^#[0-9a-f]{3,8}$/i.test(accent || '') ? accent : '#7B1FFF';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">`
    + `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">`
    + `<stop offset="0" stop-color="${color}"/><stop offset="1" stop-color="${color}" stop-opacity="0.55"/>`
    + `</linearGradient></defs>`
    + `<rect width="64" height="64" rx="32" fill="url(#g)"/>`
    + `<text x="32" y="33" text-anchor="middle" dominant-baseline="central" `
    + `font-family="Syne, Inter, system-ui, sans-serif" font-size="30" font-weight="800" fill="#fff">${letter}</text>`
    + `</svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

const CHANNELS = 'official_channels';
const STATE = 'channel_state';
// Server-built index of the CLOSED channels this user belongs to.
const MEMBER_INDEX = 'channel_members';

/** Synthetic inbox row ids are namespaced so nothing can confuse one with a
 *  real conversation id. */
export const officialRowId = (channelId) => `official:${channelId}`;
export const channelIdFromRowId = (rowId) =>
  (typeof rowId === 'string' && rowId.startsWith('official:') ? rowId.slice(9) : null);

const tsMs = (t) => {
  if (!t) return 0;
  if (typeof t.toMillis === 'function') return t.toMillis();
  if (typeof t.seconds === 'number') return t.seconds * 1000;
  if (typeof t === 'number') return t;
  return 0;
};

// ────────────────────────────────────────────────────────────────
// SUBSCRIPTIONS
// ────────────────────────────────────────────────────────────────

/**
 * Active channels, in display order.
 *
 * Two sources, because they have to be:
 *
 *  1. OPEN channels (`restricted == false`) come from one query. The equality on
 *     `restricted` is not optional: rules gate a closed channel on membership,
 *     and Firestore requires a query to be provably allowed across its ENTIRE
 *     result set, so a query that could return a closed channel is denied
 *     outright rather than filtered. Asking only for open ones keeps it provable.
 *
 *  2. CLOSED channels this user belongs to are read by id, from the server-built
 *     index at `channel_members/{uid}`.
 *
 * A handful of docs either way, and the SDK caches them between app opens.
 */
export function subscribeOfficialChannels(uid, cb) {
  let open = [];
  let closed = [];
  const emit = () => cb([...open, ...closed].sort((a, b) => (a.order ?? 100) - (b.order ?? 100)));

  const unsubOpen = onSnapshot(
    query(collection(db, CHANNELS), where('active', '==', true), where('restricted', '==', false), orderBy('order')),
    (snap) => { open = snap.docs.map((d) => ({ channelId: d.id, ...d.data() })); emit(); },
    (err) => {
      // permission-denied fires briefly during sign-out token transitions.
      if (err?.code !== 'permission-denied') console.warn('officialChannels subscribe:', err);
      open = []; emit();
    },
  );

  let unsubClosed = () => {};
  if (uid) {
    // Re-evaluate criteria membership for THIS user before reading the index.
    // Without it a creator who enrolled since their last visit would not be in
    // the Creators channel, and someone who stopped qualifying would still be.
    // Cheap (a few reads about one user) and it only writes when the answer
    // changed, so it is safe to call on every app open.
    resolveMyChannels().catch(() => {});
    unsubClosed = onSnapshot(
      doc(db, MEMBER_INDEX, uid),
      async (snap) => {
        const ids = (snap.exists() ? snap.data()?.channels : null) || [];
        if (!ids.length) { closed = []; emit(); return; }
        const docs = await Promise.all(ids.map((id) => getDoc(doc(db, CHANNELS, id)).catch(() => null)));
        closed = docs
          .filter((d) => d && d.exists() && d.data()?.active !== false)
          .map((d) => ({ channelId: d.id, ...d.data() }));
        emit();
      },
      () => { closed = []; emit(); },
    );
  }

  return () => { unsubOpen(); unsubClosed(); };
}

/** This user's per-channel state. One document, one read. */
export function subscribeChannelState(uid, cb) {
  if (!uid) { cb({}); return () => {}; }
  return onSnapshot(
    doc(db, STATE, uid),
    (snap) => cb((snap.exists() ? snap.data()?.channels : null) || {}),
    (err) => {
      if (err?.code !== 'permission-denied') console.warn('channelState subscribe:', err);
      cb({});
    },
  );
}

/** Messages in one channel, newest last (the thread renders bottom-up).
 *  `clearedAt` is applied here so a cleared thread cannot be resurrected by a
 *  cache read, which is the exact bug reference-cleared-chat-watermark records. */
export function subscribeChannelMessages(channelId, clearedAt, cb, max = 100) {
  if (!channelId) { cb([]); return () => {}; }
  const q = query(
    collection(db, CHANNELS, channelId, 'messages'),
    orderBy('createdAt', 'desc'),
    fbLimit(max),
  );
  return onSnapshot(
    q,
    (snap) => {
      const rows = snap.docs
        .map((d) => ({ id: d.id, ...d.data(), createdAtMs: tsMs(d.data().createdAt) }))
        .filter((m) => m.createdAtMs > (clearedAt || 0))
        .reverse();
      cb(rows);
    },
    (err) => {
      if (err?.code !== 'permission-denied') console.warn('channelMessages subscribe:', err);
      cb([]);
    },
  );
}

export async function getChannel(channelId) {
  if (!channelId) return null;
  const snap = await getDoc(doc(db, CHANNELS, channelId));
  return snap.exists() ? { channelId: snap.id, ...snap.data() } : null;
}

// ────────────────────────────────────────────────────────────────
// ROW BUILDER (pure, unit-tested)
// ────────────────────────────────────────────────────────────────

/**
 * Should this channel's row render for this viewer?
 *
 * Applies ONLY to `visibility.mode === 'segment'`, which is a SOFT filter:
 * curation, not secrecy. An open channel's messages are world-readable, so a
 * segment decides what is shown, never what is permitted.
 *
 * `mode === 'members'` needs no check here at all. Those channels are gated by
 * security rules, and a non-member's client never receives the document in the
 * first place, so anything that reaches this function is already permitted.
 */
export function channelVisibleTo(channel, profile) {
  const vis = channel?.visibility;
  if (!vis || vis.mode !== 'segment') return true;
  const seg = vis.segment || {};

  if (Array.isArray(seg.tiers) && seg.tiers.length) {
    const tier = profile?.subscription?.tier || profile?.subscription || 'free';
    if (!seg.tiers.includes(tier)) return false;
  }
  if (seg.creatorOnly && !(profile?.creator || profile?.payoutEnrolled)) return false;
  if (Array.isArray(seg.roles) && seg.roles.length) {
    if (!seg.roles.includes(profile?.role || 'user')) return false;
  }
  return true;
}

/**
 * Turn channels + per-user state into inbox rows.
 *
 * Render rules, from the plan's section 2.3 table. Getting these wrong is how
 * "delete" silently becomes "unsubscribe", so they are spelled out:
 *
 *   - Show the row unless the user deleted it AND nothing has arrived since.
 *     A deleted channel therefore REAPPEARS on the next message, which is what
 *     makes delete a tidy-up rather than an opt-out.
 *   - Unread counts messages newer than lastReadAt.
 *   - A muted channel still shows and still counts its own unread; it just does
 *     not contribute to the global badge (`countsTowardBadge: false`) and gets no
 *     push (enforced server side too).
 */
export function buildOfficialRows(channels, state, uid, profile = null) {
  if (!uid || !Array.isArray(channels)) return [];
  const rows = [];

  for (const ch of channels) {
    if (ch?.active === false) continue;
    if (!channelVisibleTo(ch, profile)) continue;

    const st = (state && state[ch.channelId]) || {};
    const lastMessageAtMs = tsMs(ch.lastMessageAt);
    const clearedAt = Number(st.clearedAt) || 0;
    const deletedAt = Number(st.deletedAt) || 0;
    const lastReadAt = Number(st.lastReadAt) || 0;

    const kind = ch.kind || (ch.oneWay === false ? 'support' : 'broadcast');

    // Deleted and nothing newer since: stay hidden.
    if (deletedAt && lastMessageAtMs <= deletedAt) continue;
    // Cleared and nothing newer since: the row would have no content to show.
    if (clearedAt && lastMessageAtMs <= clearedAt) continue;
    // A channel appears as soon as the user is IN it, message or not.
    //
    // It used to be hidden until something had been posted, which made
    // membership depend on an admin having spoken first: a creator who
    // qualified next week would not see the Creators channel unless a message
    // happened to exist, and nobody could open support to ask a question.
    // Belonging to a channel is the thing worth showing, so the row leads with
    // an honest empty preview instead of being withheld.

    const muted = st.mutedUntil === true
      || (typeof st.mutedUntil === 'number' && st.mutedUntil > Date.now());

    // Exact count needs the subcollection; the row only needs "is there
    // something new", so this is a floor of 1 rather than a read per row.
    const hasUnread = lastMessageAtMs > lastReadAt;

    rows.push({
      id: officialRowId(ch.channelId),
      isOfficial: true,
      channelId: ch.channelId,
      kind,
      roomConvoId: ch.roomConvoId || null,
      isGroup: kind === 'community',
      participants: [uid],
      lastMessage: ch.lastMessage || EMPTY_PREVIEW[kind] || EMPTY_PREVIEW.broadcast,
      lastMessageAt: ch.lastMessageAt || null,
      lastMessageAtMs: lastMessageAtMs || tsMs(ch.createdAt),
      lastSenderId: ch.channelId,
      oneWay: ch.oneWay !== false,
      accentColor: ch.accentColor || '#7B1FFF',
      // Shapes below match chatOps.js exactly so every existing helper works.
      muted: st.mutedUntil != null ? { [uid]: st.mutedUntil } : {},
      pinned: st.pinned ? { [uid]: st.pinned } : {},
      archived: st.archived ? { [uid]: true } : {},
      unreadCount: { [uid]: hasUnread ? 1 : 0 },
      countsTowardBadge: !muted,
      otherUsers: [{
        id: ch.channelId,
        uid: ch.channelId,
        displayName: ch.name || ch.channelId,
        username: ch.handle || ch.channelId,
        avatar: ch.avatarUrl || channelFallbackAvatar(ch.name || ch.channelId, ch.accentColor),
        isOfficial: true,
        accentColor: ch.accentColor || '#7B1FFF',
      }],
    });
  }
  return rows;
}

// ────────────────────────────────────────────────────────────────
// MUTATIONS (one merge write each)
// ────────────────────────────────────────────────────────────────

async function patchChannelState(uid, channelId, patch) {
  if (!uid || !channelId) return;
  await setDoc(
    doc(db, STATE, uid),
    { channels: { [channelId]: patch }, updatedAt: serverTimestamp() },
    { merge: true },
  );
}

/** value: true = forever, <ms> = until, null = unmute. Mirrors MUTE_OPTIONS. */
export const setChannelMuted = (uid, channelId, value) =>
  patchChannelState(uid, channelId, { mutedUntil: value ?? null });

export const markChannelRead = (uid, channelId, atMs = Date.now(), lastId = null) =>
  patchChannelState(uid, channelId, { lastReadAt: atMs, lastReadId: lastId });

export const setChannelPinned = (uid, channelId, on) =>
  patchChannelState(uid, channelId, { pinned: on ? Date.now() : null });

export const setChannelArchived = (uid, channelId, on) =>
  patchChannelState(uid, channelId, { archived: !!on });

/** Clear chat: hide everything up to now, keep the row in the list. */
export const clearChannel = (uid, channelId, atMs = Date.now()) =>
  patchChannelState(uid, channelId, { clearedAt: atMs, lastReadAt: atMs });

/**
 * Delete chat: remove the row from the inbox.
 *
 * NOT an unsubscribe. The next message newer than `deletedAt` brings the row
 * back carrying only that message. `clearedAt` moves too, so the returning
 * thread does not show history the user deleted.
 */
export const deleteChannelChat = (uid, channelId, atMs = Date.now()) =>
  patchChannelState(uid, channelId, { deletedAt: atMs, clearedAt: atMs, lastReadAt: atMs });

/** Exact unread count for the thread header. One count query, only when opened. */
export async function countChannelUnread(channelId, sinceMs) {
  if (!channelId) return 0;
  try {
    const snap = await getDocs(query(
      collection(db, CHANNELS, channelId, 'messages'),
      orderBy('createdAt', 'desc'),
      fbLimit(50),
    ));
    return snap.docs.filter((d) => tsMs(d.data().createdAt) > (sinceMs || 0)).length;
  } catch {
    return 0;
  }
}

/**
 * Where an official row actually goes when the user taps it.
 *
 * The three kinds live in different places, so a single hardcoded
 * `/messages/c/:id` was only ever right for a broadcast:
 *
 *   broadcast : the shared channel thread.
 *   support   : the user's OWN conversation, created on first tap. This is why
 *               the function is async, and why a support row can be tapped
 *               before anyone has said anything.
 *   community : the group room behind the channel.
 *
 * Returns a path to navigate to, or null when there is nothing to open yet
 * (a community channel whose room the admin has not created).
 */
export async function resolveChannelTarget(row) {
  const kind = row?.kind || 'broadcast';
  if (kind === 'community') {
    return row.roomConvoId ? `/messages/${row.roomConvoId}` : null;
  }
  if (kind === 'support') {
    const fn = httpsCallable(getFunctions(undefined, 'europe-west1'), 'openSupportThread');
    const { data } = await fn({ channelId: row.channelId });
    return data?.convoId ? `/messages/${data.convoId}` : null;
  }
  return `/messages/c/${row.channelId}`;
}

/**
 * Open this user's support thread, from anywhere in the app.
 *
 * The server resolves which support channel to use and provisions the default
 * one if none exists, so this ALWAYS returns an in-app conversation path.
 *
 * There is deliberately no help-centre fallback. Someone tapping "contact
 * support" wants a person, and answering that by sending them out to a public
 * FAQ page is how you lose them. If this throws, the caller shows an error and
 * keeps them where they are.
 */
export async function openSupportPath() {
  const fn = httpsCallable(getFunctions(undefined, 'europe-west1'), 'openSupportThread');
  const { data } = await fn({});
  if (!data?.convoId) throw new Error('Could not open support');
  return `/messages/${data.convoId}`;
}

/**
 * Keep this device's channel push subscriptions in step with what the user is
 * in and what they have muted.
 *
 * Channel pushes are TOPIC sends (one FCM call per post, regardless of audience
 * size), so a device receives them only if it is subscribed to `chan_<id>`.
 * Nothing subscribed devices, which meant a channel post landed in the thread
 * and pushed to nobody.
 *
 * Mute is enforced HERE, at the transport, rather than by dropping the
 * notification on arrival: an unsubscribed device is never sent the push at all.
 * That is the only way a mute can be honest on a topic send.
 *
 * The last applied state is remembered per device so a normal app open makes
 * zero calls. Keyed by token as well as channel, because a new token is a new
 * subscription.
 */
export async function syncChannelPushSubscriptions(channels, state, token) {
  if (!token || !Array.isArray(channels) || !channels.length) return;
  const fn = httpsCallable(getFunctions(undefined, 'europe-west1'), 'setChannelPushSubscription');
  const now = Date.now();

  for (const ch of channels) {
    if (!ch?.channelId) continue;
    const st = (state && state[ch.channelId]) || {};
    const muted = st.mutedUntil === true
      || (typeof st.mutedUntil === 'number' && st.mutedUntil > now);
    const want = ch.active !== false && !muted;

    const key = `vergr.chanpush.${token.slice(-12)}.${ch.channelId}`;
    let had = null;
    try { had = localStorage.getItem(key); } catch { /* private mode */ }
    if (had === String(want)) continue;

    try {
      const { data } = await fn({ token, channelId: ch.channelId, subscribe: want });
      // Only remember it when the server confirms, or a failed subscribe would
      // be cached as done and never retried.
      if (data?.ok) { try { localStorage.setItem(key, String(want)); } catch { /* ignore */ } }
    } catch { /* offline or stale token: retried on the next app open */ }
  }
}
