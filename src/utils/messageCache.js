/**
 * Dexie-backed message cache + outbox.
 *
 * Why:
 *  - Firestore reads cost money. Reloading every message on every chat open
 *    burns the free-tier quota fast.
 *  - Messages cache locally so repeat visits are instant and we only ask
 *    Firestore for NEW messages (those newer than our latest cached one).
 *  - Offline sends go into an outbox and are retried when connectivity returns.
 *
 * Cross-device sync: messages still live in Firestore, so opening a chat on
 * another device pulls history once and then caches locally — same as WhatsApp.
 */

import Dexie from 'dexie';

const DB_NAME = 'vergr-msg-v2';

const db = new Dexie(DB_NAME);
db.version(1).stores({
  // Compound unique key prevents duplicates across chats
  messages: '&[chatId+id], chatId, createdAtMs',
  // Outbox for offline sends
  outbox:   '++localId, chatId, status, createdAt',
  // Per-chat metadata (lastSyncAt)
  meta:     'chatId',
});

function toMs(ts) {
  if (!ts) return 0;
  if (typeof ts === 'number') return ts;
  if (ts.toDate) return ts.toDate().getTime();
  if (ts.seconds) return ts.seconds * 1000;
  if (ts instanceof Date) return ts.getTime();
  try { return new Date(ts).getTime() || 0; } catch { return 0; }
}

/** Serialize Firestore Timestamps so they round-trip through IDB. */
function serialize(msg) {
  const clone = { ...msg };
  if (clone.createdAt?.toDate) clone.createdAt = clone.createdAt.toDate().toISOString();
  if (clone.editedAt?.toDate) clone.editedAt = clone.editedAt.toDate().toISOString();
  if (clone.readAt?.toDate) clone.readAt = clone.readAt.toDate().toISOString();
  return clone;
}

/** Re-hydrate createdAt into a Date-ish shape the UI can use. */
function hydrate(row) {
  if (!row) return null;
  const { chatId, createdAtMs, ...rest } = row;
  const out = { ...rest };
  if (typeof rest.createdAt === 'string') {
    const d = new Date(rest.createdAt);
    out.createdAt = {
      toDate: () => d,
      seconds: Math.floor(d.getTime() / 1000),
      nanoseconds: 0,
    };
  }
  return out;
}

// ─────────── Message cache ───────────

export async function getCachedMessages(chatId, maxCount = 200) {
  if (!chatId) return [];
  try {
    const rows = await db.messages
      .where('chatId').equals(chatId)
      .sortBy('createdAtMs');
    return rows.slice(-maxCount).map(hydrate);
  } catch {
    return [];
  }
}

/** Page of messages strictly OLDER than `beforeMs` (newest-last). Drives
 *  infinite scroll-up — the initial window only loads the last N. */
export async function getCachedMessagesBefore(chatId, beforeMs, count = 60) {
  if (!chatId || !beforeMs) return [];
  try {
    const rows = await db.messages
      .where('chatId').equals(chatId)
      .and(r => (r.createdAtMs || 0) < beforeMs)
      .sortBy('createdAtMs');
    return rows.slice(-count).map(hydrate);
  } catch {
    return [];
  }
}

export async function getLatestCachedTimestamp(chatId) {
  if (!chatId) return 0;
  try {
    const m = await db.meta.get(chatId);
    return m?.lastSyncAt || 0;
  } catch {
    return 0;
  }
}

export async function upsertMessages(chatId, messages) {
  if (!chatId || !messages?.length) return;
  try {
    let maxTs = 0;
    const rows = [];
    for (const m of messages) {
      if (!m.id) continue;
      const createdAtMs = toMs(m.createdAt);
      if (createdAtMs > maxTs) maxTs = createdAtMs;
      rows.push({ chatId, createdAtMs, ...serialize(m) });
    }
    if (rows.length) await db.messages.bulkPut(rows);

    const prev = (await db.meta.get(chatId))?.lastSyncAt || 0;
    await db.meta.put({ chatId, lastSyncAt: Math.max(prev, maxTs) });
  } catch {
    /* swallow — cache failures must never break chat */
  }
}

export async function removeCachedMessage(chatId, messageId) {
  if (!chatId || !messageId) return;
  try {
    await db.messages.where({ chatId, id: messageId }).delete();
  } catch {/* ignore */}
}

/**
 * Delete cached rows for one chat at/older than a cutoff. This is exactly the
 * set the thread already HIDES behind a cleared-chat watermark, so purging it
 * removes no message the user can still see. Returns the number of rows gone.
 */
export async function purgeBefore(chatId, cutoffMs) {
  if (!chatId || !cutoffMs) return 0;
  try {
    return await db.messages
      .where('chatId').equals(chatId)
      .and((r) => (r.createdAtMs || 0) <= cutoffMs)
      .delete();
  } catch {
    return 0;
  }
}

export async function clearChatCache(chatId) {
  if (!chatId) return;
  try {
    await db.messages.where('chatId').equals(chatId).delete();
    await db.meta.delete(chatId);
  } catch {/* ignore */}
}

/** Global message search across EVERY cached chat (relay history is local,
 *  so Dexie IS the message store). Case-insensitive substring on text;
 *  newest first. Bounded by the per-chat prune cap, so the scan stays small. */
export async function searchAllMessages(term, maxResults = 30) {
  const q = (term || '').trim().toLowerCase();
  if (q.length < 2) return [];
  try {
    const rows = await db.messages
      .filter(r => typeof r.text === 'string' && r.text.toLowerCase().includes(q))
      .toArray();
    rows.sort((a, b) => (b.createdAtMs || 0) - (a.createdAtMs || 0));
    return rows.slice(0, maxResults).map(r => ({ chatId: r.chatId, ...hydrate(r) }));
  } catch {
    return [];
  }
}

/** Prune cache to keep only recent N messages per chat (avoid unbounded growth). */
export async function pruneCache(maxPerChat = 500) {
  try {
    const allChatIds = await db.messages.orderBy('chatId').uniqueKeys();
    for (const chatId of allChatIds) {
      const rows = await db.messages.where('chatId').equals(chatId).sortBy('createdAtMs');
      const excess = rows.slice(0, Math.max(0, rows.length - maxPerChat));
      if (excess.length) {
        await db.messages.bulkDelete(excess.map(r => [r.chatId, r.id]));
      }
    }
  } catch {/* ignore */}
}

// ─────────── Outbox (offline send queue) ───────────

/** Add a message to the offline outbox. Returns the localId. */
export async function addToOutbox(chatId, payload) {
  try {
    return await db.outbox.add({
      chatId,
      payload,
      status: 'pending',
      retryCount: 0,
      createdAt: Date.now(),
      nextAttemptAt: Date.now(),
    });
  } catch { return null; }
}

export async function getOutboxMessages(status = null) {
  try {
    if (status) return await db.outbox.where('status').equals(status).toArray();
    return await db.outbox.toArray();
  } catch { return []; }
}

export async function removeFromOutbox(localId) {
  try { await db.outbox.delete(localId); } catch {/* ignore */}
}

export async function updateOutboxStatus(localId, patch) {
  try { await db.outbox.update(localId, patch); } catch {/* ignore */}
}

export { db as _dexie };
