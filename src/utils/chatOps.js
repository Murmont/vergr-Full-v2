// chatOps — content-free message operations for the RELAY chat path.
//
// Message BODIES never live on the server (founder mandate). But reactions,
// delete tombstones and read markers are metadata, not bodies, so they ride a
// single Firestore doc per conversation and sync to every device (including
// ones that were offline when the op happened — the relay's ring buffer /
// backlog can't guarantee that):
//
//   conversations/{id}/meta/ops = {
//     reactions: { [msgId]: { [emoji]: [uids] } },
//     deleted:   { [msgId]: <ms timestamp> },
//   }
//
// Read receipts ride the conversation doc itself (one field per member,
// written by the same updateDoc that zeroes unreadCount on chat open):
//
//   conversations/{id}.readAt.{uid} = <ms timestamp>
//
// Trust model: any participant may write the ops doc (rules enforce
// participant-only). Same trust level as the chat itself.

import {
  doc, setDoc, updateDoc, arrayUnion, arrayRemove, deleteField,
} from 'firebase/firestore';
import { db, auth } from '../firebase/config';
import { postOp } from './chatHistoryApi';
import { clearChatCache, purgeBefore } from './messageCache';

export function opsDocRef(chatId) {
  return doc(db, 'conversations', chatId, 'meta', 'ops');
}

/** Toggle the caller's reaction. `currentReactions` = the message's current
 *  { emoji: [uids] } map so we know whether this is an add or a remove. */
export async function toggleReaction(chatId, msgId, emoji, currentReactions) {
  const uid = auth.currentUser?.uid;
  if (!uid || !chatId || !msgId || !emoji) return;
  const mine = Array.isArray(currentReactions?.[emoji]) && currentReactions[emoji].includes(uid);
  // Server store (authoritative + fans out a live `react` frame).
  try { await postOp(chatId, { op: 'react', id: msgId, emoji, on: !mine }); } catch {/* offline */}
  // Dual-write the Firestore ops doc during the transition so old APK 1.0.44
  // clients (which only read the ops doc) still see reactions. Remove after the
  // next APK is fully rolled out.
  await setDoc(opsDocRef(chatId), {
    reactions: { [msgId]: { [emoji]: mine ? arrayRemove(uid) : arrayUnion(uid) } },
  }, { merge: true });
}

/** Delete-for-everyone: tombstone the message server-side (POST /ops) AND write
 *  the legacy Firestore tombstone (dual-write for old APK clients during
 *  transition). Every device's ops subscription / live `delete` frame removes
 *  the message from its local cache + UI. */
export async function tombstoneMessage(chatId, msgId) {
  if (!chatId || !msgId) return;
  try { await postOp(chatId, { op: 'deleteForEveryone', id: msgId }); } catch {/* offline */}
  await setDoc(opsDocRef(chatId), { deleted: { [msgId]: Date.now() } }, { merge: true });
}

// ───────── Whole-chat delete (Telegram parity) ─────────
// Replaces the old shared `status:'deleted'` write (which nuked the chat from
// the OTHER person's inbox — not WhatsApp/Telegram behavior). Per-user
// visibility now rides a `hiddenFor.{uid}` map on the convo doc; the inbox
// filters it out. A new message clears hiddenFor (sendMessage), so the chat
// resurrects on the next exchange. `status` stays for requests/blocking only.

/** Delete the chat for ME only. Server hides my history (deleteForMe
 *  watermark) and the convo drops out of my inbox. */
export async function deleteChatForMe(chatId) {
  const uid = auth.currentUser?.uid;
  if (!chatId || !uid) return;
  const now = Date.now();
  markChatCleared(chatId, now);
  // PHYSICALLY drop the local bodies. The watermark alone only HIDES history
  // at render time — the messages stayed on disk in Dexie, which meant
  // "delete chat" did not actually delete anything locally. Anything that
  // reads the cache directly would still surface them.
  try { await clearChatCache(chatId); } catch {/* ignore */}
  try { await postOp(chatId, { op: 'deleteForMe', beforeTs: now }); } catch {/* offline */}
  try { await updateDoc(doc(db, 'conversations', chatId), { [`hiddenFor.${uid}`]: true }); } catch {/* offline */}
}

/** Delete the chat for BOTH participants (1:1 DMs only — Telegram's "Also
 *  delete for X" checkbox). Server hides both participants' history; both
 *  inboxes drop it. */
export async function deleteChatForEveryone(chatId, otherUid) {
  const uid = auth.currentUser?.uid;
  if (!chatId || !uid) return;
  const now = Date.now();
  markChatCleared(chatId, now);
  try { await clearChatCache(chatId); } catch {/* ignore */} // see deleteChatForMe
  try { await postOp(chatId, { op: 'deleteChatForAll', alsoFor: true }); } catch {/* offline */}
  try {
    const updates = { [`hiddenFor.${uid}`]: true };
    if (otherUid) updates[`hiddenFor.${otherUid}`] = true;
    await updateDoc(doc(db, 'conversations', chatId), updates);
  } catch {/* offline */}
}

/** Keep the ops doc bounded: if the tombstone map grows past `cap`, drop the
 *  oldest entries (their messages are long gone from every cache by then). */
export async function pruneTombstones(chatId, deletedMap, cap = 400) {
  const entries = Object.entries(deletedMap || {});
  if (entries.length <= cap) return;
  entries.sort((a, b) => (a[1] || 0) - (b[1] || 0));
  const drop = entries.slice(0, entries.length - cap);
  const updates = {};
  for (const [msgId] of drop) updates[`deleted.${msgId}`] = deleteField();
  try { await updateDoc(opsDocRef(chatId), updates); } catch { /* best effort */ }
}

// ───────── Local clear/delete watermark ─────────
// Clear Chat / Delete Chat are LOCAL operations (WhatsApp semantics: your
// copy only). Wiping Dexie is not enough — the relay keeps a 7-day offline
// backlog and replays it on every connect (catchup since=0), so cleared
// messages resurrected on the next open. The watermark records WHEN this
// user cleared this chat on this device; the hook passes it as the relay
// catch-up cursor AND drops any replayed frame older than it.

function clearedAtKey(chatId) {
  const uid = auth.currentUser?.uid || 'anon';
  return `vergr.chatClearedAt.${uid}.${chatId}`;
}

export function getChatClearedAt(chatId) {
  if (!chatId) return 0;
  try { return Number(localStorage.getItem(clearedAtKey(chatId))) || 0; } catch { return 0; }
}

export function markChatCleared(chatId, ms = Date.now()) {
  if (!chatId) return;
  try { localStorage.setItem(clearedAtKey(chatId), String(ms)); } catch {/* ignore */}
}

/**
 * ONE-TIME MIGRATION. Clear/Delete-chat used to record a watermark and rely on
 * the UI to hide anything behind it — the message BODIES stayed in this
 * device's cache. Deletes now purge as they go, but devices that cleared a
 * chat BEFORE that fix are still holding those rows on disk.
 *
 * This walks every cleared-chat watermark for the signed-in user and physically
 * deletes the cached rows at/older than it. That set is precisely what the
 * thread already refuses to show, so nothing the user can still read is lost,
 * and chats that were never cleared have no watermark and are never touched.
 *
 * Runs once per user (flagged in localStorage) and never throws — a failed
 * migration must not block app start.
 */
export async function purgeClearedHistoryOnce() {
  const uid = auth.currentUser?.uid;
  if (!uid) return 0;
  const doneKey = `vergr.clearedPurgeDone.${uid}`;
  let jobs = [];
  try {
    if (localStorage.getItem(doneKey)) return 0;
    const prefix = `vergr.chatClearedAt.${uid}.`;
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k || !k.startsWith(prefix)) continue;
      const chatId = k.slice(prefix.length);
      const ms = Number(localStorage.getItem(k)) || 0;
      if (chatId && ms > 0) jobs.push([chatId, ms]);
    }
  } catch { return 0; }

  let removed = 0;
  for (const [chatId, ms] of jobs) {
    // eslint-disable-next-line no-await-in-loop
    removed += await purgeBefore(chatId, ms);
  }
  try { localStorage.setItem(doneKey, String(Date.now())); } catch {/* ignore */}
  if (removed) console.info(`[chat] purged ${removed} cached message(s) behind cleared watermarks`);
  return removed;
}

// ───────── Per-user mute ─────────
// conversations/{id}.muted.{uid} = true (forever) | <untilMs>.
// Legacy data: a plain boolean `muted` (shared by both sides — the old bug).
// We treat the legacy boolean as "muted for me" until the user touches the
// toggle, which rewrites it into the per-user map shape.

export function isChatMutedFor(chatInfo, uid) {
  const m = chatInfo?.muted;
  if (m == null) return false;
  if (typeof m === 'boolean') return m; // legacy shared flag
  const v = m?.[uid];
  if (v === true) return true;
  if (typeof v === 'number') return v > Date.now();
  return false;
}

/** value: true = forever, <ms> = until that time, false/null = unmute. */
export async function setChatMuted(chatId, value) {
  const uid = auth.currentUser?.uid;
  if (!uid || !chatId) return;
  // Dot-path write converts a legacy boolean `muted` into the map shape.
  await updateDoc(doc(db, 'conversations', chatId), {
    [`muted.${uid}`]: value || deleteField(),
  });
}

// ───────── Per-user pin + archive ─────────
// conversations/{id}.pinned.{uid}   = <ms when pinned>  (absent = not pinned)
// conversations/{id}.archived.{uid} = true              (absent = not archived)
// Per-user maps (same shape as mute) so pinning/archiving never affects the
// other side. Rules already allow any participant to update the convo doc.

export function isChatPinnedFor(chatInfo, uid) {
  return !!chatInfo?.pinned?.[uid];
}

export function chatPinnedAt(chatInfo, uid) {
  const v = chatInfo?.pinned?.[uid];
  return typeof v === 'number' ? v : (v ? 1 : 0);
}

export async function setChatPinned(chatId, on) {
  const uid = auth.currentUser?.uid;
  if (!uid || !chatId) return;
  await updateDoc(doc(db, 'conversations', chatId), {
    [`pinned.${uid}`]: on ? Date.now() : deleteField(),
  });
}

export function isChatArchivedFor(chatInfo, uid) {
  return !!chatInfo?.archived?.[uid];
}

export async function setChatArchived(chatId, on) {
  const uid = auth.currentUser?.uid;
  if (!uid || !chatId) return;
  await updateDoc(doc(db, 'conversations', chatId), {
    [`archived.${uid}`]: on ? true : deleteField(),
  });
}

/** Inbox ordering: pinned first (most recently pinned on top), then by
 *  lastMessageAt desc. Pass the raw conversation array. */
export function sortInboxChats(chats, uid) {
  const ts = (x) => x?.toDate ? x.toDate().getTime() : (x?.seconds ? x.seconds * 1000 : 0);
  return [...(chats || [])].sort((a, b) => {
    const pa = chatPinnedAt(a, uid), pb = chatPinnedAt(b, uid);
    if (!!pa !== !!pb) return pa ? -1 : 1;
    if (pa && pb && pa !== pb) return pb - pa;
    return ts(b?.lastMessageAt) - ts(a?.lastMessageAt);
  });
}

export const MUTE_OPTIONS = [
  { label: '8 hours', value: () => Date.now() + 8 * 3600_000 },
  { label: '1 week', value: () => Date.now() + 7 * 86400_000 },
  { label: 'Always', value: () => true },
];
