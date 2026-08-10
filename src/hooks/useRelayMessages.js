// useRelayMessages — chat hook that keeps messages OFF Firestore.
//
// FOUNDER MANDATE: message bodies must never be stored on the server.
// Architecture:
//   • Live updates: WebSocket relay (infra/chat → wss://chat.vergr.app/dm/…
//     or /group/…). Server fans out and forgets; ~60s ring buffer for
//     reconnect catch-up. No persistence on the relay.
//   • Local storage: Dexie (already used as a cache). Becomes the source of
//     truth for message history on each device.
//   • Firestore: only conversation METADATA (participants, lastMessageAt,
//     unread counters). NO message bodies.
//
// v1: plaintext over WS. No encryption. Encryption is a future phase that
// will be added on a separate branch when the storage architecture is proven.
//
// Interface mirrors src/hooks/UseMessages.js so swapping is one line in the
// screen. Returns: { messages, rawMessages, loading, sendMessage,
// removeLocalMessage, relayState }.

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  doc, getDoc, updateDoc, serverTimestamp, increment, onSnapshot, deleteField,
} from 'firebase/firestore';
import { db, auth } from '../firebase/config';
import {
  getCachedMessages, getCachedMessagesBefore, getLatestCachedTimestamp,
  upsertMessages, removeCachedMessage, clearChatCache,
} from '../utils/messageCache';
import { connectConversation } from '../utils/chatRelayConvo';
import { opsDocRef, pruneTombstones, getChatClearedAt, markChatCleared } from '../utils/chatOps';
import { fetchHistory, serverHistoryEnabled, mergeReactionMaps, postOp } from '../utils/chatHistoryApi';

function genId() {
  return `m_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function tsMs(x) {
  if (!x) return 0;
  if (typeof x === 'number') return x;
  if (typeof x === 'string') { const d = new Date(x); return isNaN(d) ? 0 : d.getTime(); }
  if (x?.toDate) return x.toDate().getTime();
  if (x?.seconds) return x.seconds * 1000;
  return 0;
}

function asCreatedAt(ms) {
  const d = new Date(ms || Date.now());
  return {
    toDate: () => d,
    seconds: Math.floor(d.getTime() / 1000),
    nanoseconds: 0,
  };
}

function sortByCreated(a, b) {
  return tsMs(a.createdAt) - tsMs(b.createdAt);
}

const MEDIA_PREVIEW = { image: '📷 Photo', video: '🎬 Video', videonote: '🎥 Video message', audio: '🎙 Voice', voice: '🎙 Voice', file: '📎 File', sticker: 'Sticker', giphy: 'GIF', clip: '🎬 Clip' };
function buildPreview(row) {
  if (!row) return '';
  return (row.text || '').slice(0, 140) || (row.contentUrl ? (MEDIA_PREVIEW[row.type] || 'New media') : '');
}

export default function useRelayMessages(chatId, messageLimit = 80) {
  const [rawMessages, setRawMessages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [relayState, setRelayState] = useState('idle');
  // Stranger-DM gate, reported by the relay on hello and whenever it changes.
  // Held here rather than derived on the client because the relay is the thing
  // that will actually refuse the send — a second, independent client-side
  // follow check could disagree with it and confuse the user.
  const [mediaBlocked, setMediaBlocked] = useState(false);
  const [hasMoreHistory, setHasMoreHistory] = useState(false);

  const messageMap = useRef(new Map());
  const convoMetaRef = useRef({ isGroup: false, participants: [] });
  const connRef = useRef(null);
  // Content-free op state from conversations/{id}/meta/ops (see chatOps.js):
  // reactions decorate render rows; tombstones remove rows everywhere.
  const opsRef = useRef({ reactions: {}, deleted: {} });
  const [opsTick, setOpsTick] = useState(0);
  // Local clear/delete watermark: anything at-or-before this ts must never
  // re-enter (the relay's 7-day backlog replays on every connect).
  const clearedAtRef = useRef(0);
  // Server-store (Telegram model) state: reactions + tombstones sourced from
  // GET /history and live `react`/`delete` op frames. Kept separate from the
  // Firestore ops doc (opsRef) so neither source clobbers the other during the
  // B2 transition; both are merged at render time.
  const serverReactionsRef = useRef({});
  const serverDeletedRef = useRef({});

  const rerender = useCallback(() => {
    setRawMessages(Array.from(messageMap.current.values()).sort(sortByCreated));
  }, []);

  const ingest = useCallback(async (row, { persist = true } = {}) => {
    if (!row?.id || !chatId) return;
    // Tombstoned messages never re-enter (backlog replays after a delete).
    if (opsRef.current.deleted[row.id]) return;
    // Cleared-chat watermark: backlog replays of pre-clear messages are dropped.
    if (clearedAtRef.current && tsMs(row.createdAt) <= clearedAtRef.current) return;
    messageMap.current.set(row.id, row);
    if (persist) await upsertMessages(chatId, [row]);
    rerender();
  }, [chatId, rerender]);

  // Apply an EDIT op (relay frame or replay) to an existing row.
  const applyEdit = useCallback(async (targetId, text, tsMs) => {
    if (!targetId || !chatId) return;
    const cur = messageMap.current.get(targetId);
    if (!cur) return; // not in our window — nothing to patch
    // Ignore stale edits (replays arrive out of order across buffer+backlog).
    if (cur.editedAtMs && tsMs && tsMs < cur.editedAtMs) return;
    const next = { ...cur, text: text || '', editedAt: asCreatedAt(tsMs || Date.now()), editedAtMs: tsMs || Date.now() };
    messageMap.current.set(targetId, next);
    await upsertMessages(chatId, [next]);
    rerender();
  }, [chatId, rerender]);

  // Map a server /history row (HistoryRow shape) to the local render/cache row.
  // Returns null for tombstones (handled by the caller). Preserves any edit we
  // already applied locally so a backfill can't revert it.
  const serverRowToLocal = useCallback((m) => {
    if (!m?.id || m.deleted) return null;
    const existing = messageMap.current.get(m.id);
    const hasMedia = !!(m.contentUrl || m.videoUrl);
    return {
      id: m.id,
      senderId: m.uid,
      text: existing?.editedAtMs ? existing.text : (m.text || ''),
      ...(existing?.editedAtMs
        ? { editedAt: existing.editedAt, editedAtMs: existing.editedAtMs }
        : (m.editedTs ? { editedAt: asCreatedAt(m.editedTs), editedAtMs: m.editedTs } : {})),
      type: m.mediaKind || (hasMedia ? 'media' : 'text'),
      contentUrl: m.contentUrl || existing?.contentUrl || '',
      videoUrl: m.videoUrl || existing?.videoUrl || '',
      ...(m.waveform || existing?.waveform ? { waveform: m.waveform || existing?.waveform } : {}),
      replyToId: m.replyToId || existing?.replyToId || '',
      // Bulk-imported history (Discord/WhatsApp): original-author blob
      // {name, avatar, source, authorId} — renders a "via Discord" chip.
      ...(m.imported ? { imported: m.imported } : {}),
      createdAt: asCreatedAt(m.ts || Date.now()),
      status: 'sent',
    };
  }, []);

  // Apply a live `react` op frame from the relay into the server-reactions map.
  const applyServerReaction = useCallback((msgId, emoji, uid, on) => {
    if (!msgId || !emoji || !uid) return;
    const map = serverReactionsRef.current;
    const forMsg = { ...(map[msgId] || {}) };
    const cur = new Set(Array.isArray(forMsg[emoji]) ? forMsg[emoji] : []);
    if (on) cur.add(uid); else cur.delete(uid);
    if (cur.size) forMsg[emoji] = Array.from(cur); else delete forMsg[emoji];
    serverReactionsRef.current = { ...map, [msgId]: forMsg };
    rerender();
  }, [rerender]);

  // Apply a server tombstone (live `delete` frame or /history deleted stub).
  const applyServerDelete = useCallback((msgId, ts) => {
    if (!msgId) return;
    serverDeletedRef.current[msgId] = ts || Date.now();
    messageMap.current.delete(msgId);
    removeCachedMessage(chatId, msgId).catch(() => {});
    rerender();
  }, [chatId, rerender]);

  // ──────────────────────────────────────────────────────────────
  // Mount: load convo meta, hydrate Dexie, open WS
  // ──────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!chatId || !auth.currentUser) { setLoading(false); return; }
    let cancelled = false;
    messageMap.current = new Map();
    clearedAtRef.current = getChatClearedAt(chatId);
    setLoading(true);

    (async () => {
      // 1. Conversation metadata (single Firestore read, no message bodies).
      let isGroup = false;
      let participants = [];
      try {
        const snap = await getDoc(doc(db, 'conversations', chatId));
        if (snap.exists()) {
          const d = snap.data() || {};
          isGroup = !!d.isGroup;
          participants = Array.isArray(d.participants) ? d.participants : [];
        }
      } catch {/* offline tolerated */}
      convoMetaRef.current = { isGroup, participants };

      // 2. Dexie hydrate — instant render of cached history.
      const cached = await getCachedMessages(chatId, messageLimit);
      if (cancelled) return;
      for (const m of cached) {
        if (clearedAtRef.current && tsMs(m.createdAt) <= clearedAtRef.current) continue;
        messageMap.current.set(m.id, m);
      }
      // A full initial window suggests older history exists in Dexie.
      setHasMoreHistory(cached.length >= messageLimit);
      rerender();
      setLoading(false);

      // 3. Open WS to relay. Reconnect logic + ring-buffer catch-up are
      //    handled by chatRelayConvo.
      const conn = await connectConversation({
        convoId: chatId,
        isGroup,
        getIdToken: () => auth.currentUser?.getIdToken(),
        // Never replay backlog from before the user's local clear/delete.
        catchupSince: clearedAtRef.current || 0,
        onState: (s) => { if (!cancelled) setRelayState(s); },
        onPolicy: (m) => { if (!cancelled) setMediaBlocked(!!m.noMedia); },
        onMessage: async (m) => {
          if (cancelled) return;
          // Op frames patch an existing row instead of inserting a new one.
          if (m.op === 'edit' && m.targetId) {
            await applyEdit(m.targetId, m.text || '', m.ts || Date.now());
            return;
          }
          // Server-store op frames (fanned out by POST /ops): reactions + delete.
          if (m.op === 'react' && m.targetId) {
            applyServerReaction(m.targetId, m.emoji, m.uid, !!m.on);
            return;
          }
          if (m.op === 'delete' && m.targetId) {
            applyServerDelete(m.targetId, m.ts || Date.now());
            return;
          }
          // Build the row. Sender's optimistic gets reconciled by id.
          const existing = messageMap.current.get(m.id);
          const row = {
            id: m.id,
            senderId: m.uid,
            // A buffer/backlog replay of the ORIGINAL must not clobber a
            // later edit we already applied.
            text: existing?.editedAtMs ? existing.text : (m.text || existing?.text || ''),
            ...(existing?.editedAtMs ? { editedAt: existing.editedAt, editedAtMs: existing.editedAtMs } : {}),
            type: m.mediaKind || (m.hasMedia ? 'media' : 'text'),
            contentUrl: existing?.contentUrl || m.contentUrl || '',
            videoUrl: existing?.videoUrl || m.videoUrl || '',
            ...(existing?.waveform || m.waveform ? { waveform: existing?.waveform || m.waveform } : {}),
            fileName: existing?.fileName || '',
            fileSize: existing?.fileSize || 0,
            replyToId: m.replyToId || existing?.replyToId || '',
            createdAt: asCreatedAt(m.ts || Date.now()),
            status: 'sent',
          };
          await ingest(row);
        },
        onReject: (m) => {
          // The relay is authoritative. If it refused a send for want of a
          // follow, our cached flag was stale — correct it so the UI explains
          // the failure instead of just showing a red bubble.
          if (m.reason === 'media-needs-follow' && !cancelled) setMediaBlocked(true);
          const id = m.id;
          if (id && messageMap.current.has(id)) {
            const cur = messageMap.current.get(id);
            messageMap.current.set(id, { ...cur, status: 'failed', failReason: m.reason || 'rejected' });
            rerender();
          }
        },
      });
      if (cancelled) { conn.close(); return; }
      connRef.current = conn;

      // 4. Server-store backfill (Telegram model), AFTER the WS is live so
      //    live messaging is never blocked on this fetch. Pulls anything newer
      //    than our newest cached message from the relay's SQLite history
      //    (GET /history?after=) — replaces the 7-day relay backlog and makes
      //    full history reachable on ANY device after a reinstall. Best-effort:
      //    failures leave Dexie + the live relay intact.
      if (await serverHistoryEnabled()) {
        try {
          const after = await getLatestCachedTimestamp(chatId);
          const { messages: srv, reactions, hiddenBefore } = await fetchHistory(chatId, { after, limit: 100 });
          if (cancelled) return;
          // Clear/Delete-chat watermark from ANOTHER device (Telegram converge):
          // the server tells us how far this user has cleared; purge anything
          // at/below it locally and persist the watermark so it sticks across
          // reloads (the Dexie-hydrate filter then drops them on future opens).
          if (hiddenBefore && hiddenBefore > clearedAtRef.current) {
            clearedAtRef.current = hiddenBefore;
            markChatCleared(chatId, hiddenBefore);
            connRef.current?.setCatchupCursor?.(hiddenBefore);
            for (const [id, mm] of messageMap.current) {
              if (tsMs(mm.createdAt) <= hiddenBefore) messageMap.current.delete(id);
            }
          }
          serverReactionsRef.current = mergeReactionMaps(serverReactionsRef.current, reactions);
          const toCache = [];
          for (const m of srv) {
            if (m.deleted) { applyServerDelete(m.id, m.ts); continue; }
            if (clearedAtRef.current && (m.ts || 0) <= clearedAtRef.current) continue;
            if (opsRef.current.deleted[m.id] || serverDeletedRef.current[m.id]) continue;
            const row = serverRowToLocal(m);
            if (row) { messageMap.current.set(row.id, row); toCache.push(row); }
          }
          if (toCache.length) await upsertMessages(chatId, toCache);
          if (!cancelled) rerender();
        } catch {/* server history unavailable — Dexie + relay still serve */}
      }
    })();

    return () => {
      cancelled = true;
      try { connRef.current?.close(); } catch {/* ignore */}
      connRef.current = null;
    };
  }, [chatId, messageLimit, ingest, rerender]);

  // ──────────────────────────────────────────────────────────────
  // Ops doc subscription: reactions + delete tombstones (content-free
  // metadata — syncs to devices that were offline when the op happened,
  // which the relay's ring buffer can't guarantee).
  // ──────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!chatId || !auth.currentUser) return;
    const unsub = onSnapshot(opsDocRef(chatId), (snap) => {
      const d = snap.exists() ? (snap.data() || {}) : {};
      opsRef.current = { reactions: d.reactions || {}, deleted: d.deleted || {} };
      // Tombstones: purge from memory + Dexie so the delete is permanent.
      let changed = false;
      for (const msgId of Object.keys(opsRef.current.deleted)) {
        if (messageMap.current.has(msgId)) {
          messageMap.current.delete(msgId);
          changed = true;
        }
        removeCachedMessage(chatId, msgId).catch(() => {});
      }
      if (changed) rerender();
      setOpsTick(t => t + 1);
      // Opportunistic bound on the tombstone map (one writer at a time is fine).
      pruneTombstones(chatId, opsRef.current.deleted).catch(() => {});
    }, () => {/* permission/offline — reactions just don't decorate */});
    return () => unsub();
  }, [chatId, rerender]);

  // Removed via FCM cross-device delete event (same as the legacy hook).
  useEffect(() => {
    if (!chatId) return;
    const handler = (e) => {
      const { chatId: evChatId, messageId } = e.detail || {};
      if (evChatId !== chatId || !messageId) return;
      messageMap.current.delete(messageId);
      rerender();
      removeCachedMessage(chatId, messageId).catch(() => {});
    };
    window.addEventListener('vergr:message-deleted', handler);
    return () => window.removeEventListener('vergr:message-deleted', handler);
  }, [chatId, rerender]);

  const removeLocalMessage = useCallback((messageId) => {
    if (!chatId || !messageId) return;
    messageMap.current.delete(messageId);
    rerender();
    removeCachedMessage(chatId, messageId).catch(() => {});
  }, [chatId, rerender]);

  // Rewrite the conversation's shared inbox preview to the current latest
  // (non-deleted) message. Call AFTER a delete-for-everyone so a deleted last
  // message stops lingering as the preview under the chat name. Caller must
  // have already removed the message from messageMap.
  const syncPreviewToLatest = useCallback(async () => {
    if (!chatId) return;
    const rows = Array.from(messageMap.current.values()).filter(m => !m.deleted).sort(sortByCreated);
    const last = rows[rows.length - 1];
    try {
      await updateDoc(doc(db, 'conversations', chatId), {
        lastMessageText: buildPreview(last),
        lastMessage: buildPreview(last),
      });
    } catch {/* offline tolerated */}
  }, [chatId]);

  // ──────────────────────────────────────────────────────────────
  // Send: optimistic insert + WS send + conversation metadata bump.
  // NEVER writes a message body to Firestore.
  // ──────────────────────────────────────────────────────────────
  const sendMessage = useCallback(async (payload) => {
    if (!chatId || !auth.currentUser) return null;
    const p = typeof payload === 'string' ? { text: payload, type: 'text' } : (payload || {});
    const meUid = auth.currentUser.uid;
    const id = genId();
    const now = Date.now();

    // Optimistic.
    const localRow = {
      id,
      senderId: meUid,
      text: p.text || '',
      type: p.type || 'text',
      contentUrl: p.contentUrl || '',
      videoUrl: p.videoUrl || '',
      ...(p.waveform ? { waveform: p.waveform } : {}),
      fileName: p.fileName || '',
      fileSize: p.fileSize || 0,
      replyToId: p.replyToId || p.replyTo?.id || '',
      replyTo: p.replyTo || null,
      createdAt: asCreatedAt(now),
      status: 'sending',
    };
    await ingest(localRow);

    // Relay frame. DM rooms in v1 accept plaintext via the `text` field too.
    // Media URLs (public R2/CDN links — not the message body) ride alongside so
    // the RECIPIENT can render the media; without them only the sender's
    // optimistic copy shows the photo/gif/clip. The relay forwards but never
    // persists these (same 60s ring-buffer model as `text`).
    const frame = {
      type: 'msg',
      id,
      text: p.text || '',
      contentUrl: p.contentUrl || '',
      videoUrl: p.videoUrl || '',
      ...(p.waveform ? { waveform: p.waveform } : {}),
      // `mediaKind` is how the message TYPE crosses the wire (the receiver reads
      // `type: m.mediaKind`). It's normally only set for media, but a 'system'
      // row (e.g. "X set messages to disappear after 1 day") has no media and
      // still must arrive AS a system row — otherwise the peer renders it as a
      // normal text bubble from the sender instead of a centered pill.
      mediaKind: p.contentUrl ? (p.type || 'file') : (p.type === 'system' ? 'system' : ''),
      hasMedia: !!p.contentUrl,
      replyToId: localRow.replyToId,
    };
    const sent = connRef.current?.send(frame);
    if (!sent) {
      // WS not open right now — chatRelayConvo will replay the frame on
      // reconnect (it queues internally). Show 'queued' state.
      messageMap.current.set(id, { ...localRow, status: 'queued' });
      rerender();
    }

    // Conversation metadata: one bounded preview string per conversation
    // (overwritten on each new message — never accumulates), so the inbox
    // list can render the same preview WhatsApp does without storing
    // per-message history on the server.
    const previewText = (p.text || '').slice(0, 140) ||
      (p.contentUrl ? ({ image: '📷 Photo', video: '🎬 Video', videonote: '🎥 Video message', audio: '🎙 Voice', voice: '🎙 Voice', file: '📎 File', sticker: 'Sticker', giphy: 'GIF', clip: '🎬 Clip' }[p.type] || 'New media') : '');
    const { participants } = convoMetaRef.current;
    const unread = {};
    // A new message resurrects the chat for anyone who had deleted it (Telegram
    // behavior): clear every participant's hiddenFor flag.
    const hiddenClear = {};
    for (const uid of participants) {
      if (uid && uid !== meUid) unread[`unreadCount.${uid}`] = increment(1);
      if (uid) hiddenClear[`hiddenFor.${uid}`] = deleteField();
    }
    hiddenClear[`hiddenFor.${meUid}`] = deleteField();
    try {
      await updateDoc(doc(db, 'conversations', chatId), {
        lastMessageAt: serverTimestamp(),
        lastMessageSenderId: meUid,
        lastMessageText: previewText,
        lastMessage: previewText,  // older field the legacy inbox also reads
        ...unread,
        ...hiddenClear,
      });
    } catch {/* offline tolerated */}

    return id;
  }, [chatId, ingest, rerender]);

  // Edit an existing message: patch locally + Dexie, then fan out an op
  // frame over the relay (buffer + 7-day backlog deliver it to the others).
  const editMessage = useCallback(async (messageId, newText) => {
    if (!chatId || !messageId) return;
    const now = Date.now();
    await applyEdit(messageId, newText, now);
    connRef.current?.send({
      type: 'msg', op: 'edit', id: genId(), targetId: messageId, text: newText || '',
    });
    // Refresh the inbox preview if we edited the latest message.
    const rows = Array.from(messageMap.current.values()).sort(sortByCreated);
    if (rows.length && rows[rows.length - 1]?.id === messageId) {
      try {
        await updateDoc(doc(db, 'conversations', chatId), {
          lastMessageText: (newText || '').slice(0, 140),
          lastMessage: (newText || '').slice(0, 140),
        });
      } catch {/* offline tolerated */}
    }
  }, [chatId, applyEdit]);

  // Infinite scroll-up: pull the next page of OLDER messages from Dexie.
  // Returns how many rows were added (0 = nothing left).
  const loadOlderMessages = useCallback(async (count = 60) => {
    if (!chatId) return 0;
    const rows = Array.from(messageMap.current.values()).sort(sortByCreated);
    const oldest = rows.length ? tsMs(rows[0].createdAt) : 0;
    if (!oldest) { setHasMoreHistory(false); return 0; }
    const older = await getCachedMessagesBefore(chatId, oldest, count);
    let added = 0;
    for (const m of older) {
      if (!m?.id) continue;
      if (clearedAtRef.current && tsMs(m.createdAt) <= clearedAtRef.current) continue;
      if (opsRef.current.deleted[m.id] || serverDeletedRef.current[m.id]) continue;
      if (!messageMap.current.has(m.id)) { messageMap.current.set(m.id, m); added++; }
    }
    // Dexie page exhausted — reach into the server store for older history
    // (full history forever, on any device after reinstall).
    if (older.length < count && await serverHistoryEnabled()) {
      try {
        const { messages: srv, reactions } = await fetchHistory(chatId, { before: oldest, limit: count });
        serverReactionsRef.current = mergeReactionMaps(serverReactionsRef.current, reactions);
        const toCache = [];
        for (const m of srv) {
          if (m.deleted) { serverDeletedRef.current[m.id] = m.ts; continue; }
          if (clearedAtRef.current && (m.ts || 0) <= clearedAtRef.current) continue;
          if (opsRef.current.deleted[m.id] || serverDeletedRef.current[m.id]) continue;
          const row = serverRowToLocal(m);
          if (row && !messageMap.current.has(row.id)) { messageMap.current.set(row.id, row); toCache.push(row); added++; }
        }
        if (toCache.length) await upsertMessages(chatId, toCache);
        setHasMoreHistory(srv.length >= count);
      } catch {
        setHasMoreHistory(false);
      }
    } else {
      setHasMoreHistory(older.length >= count);
    }
    if (added) rerender();
    return added;
  }, [chatId, rerender, serverRowToLocal]);

  // Local "clear chat" (WhatsApp semantics: clears YOUR copy only).
  // The watermark is what makes it STICK: without it the relay's 7-day
  // backlog replays every pre-clear message on the next connect.
  const clearLocalMessages = useCallback(async () => {
    if (!chatId) return;
    const now = Date.now();
    clearedAtRef.current = now;
    markChatCleared(chatId, now);
    connRef.current?.setCatchupCursor(now);
    messageMap.current = new Map();
    rerender();
    await clearChatCache(chatId);
    // Push the clear server-side so it survives reinstall and converges across
    // this account's other devices (deleteForMe watermark hides history ≤ now).
    if (await serverHistoryEnabled()) {
      try { await postOp(chatId, { op: 'deleteForMe', beforeTs: now }); } catch {/* offline */}
    }
  }, [chatId, rerender]);

  // Derived: day-separator grouping (matches the legacy hook's API).
  // opsTick is read so reaction updates re-derive the decorated rows.
  void opsTick;
  const reactionsByMsg = mergeReactionMaps(serverReactionsRef.current, opsRef.current.reactions);
  const visible = rawMessages
    .filter(m => !m.deleted && !opsRef.current.deleted[m.id] && !serverDeletedRef.current[m.id])
    .map(m => (reactionsByMsg[m.id] ? { ...m, reactions: reactionsByMsg[m.id] } : m));
  const messages = [];
  let lastDate = null;
  for (const msg of visible) {
    const ts = msg.createdAt?.toDate ? msg.createdAt.toDate()
             : msg.createdAt ? new Date(msg.createdAt)
             : new Date();
    const dateStr = ts.toDateString();
    if (dateStr !== lastDate) {
      messages.push({ _type: 'separator', date: dateStr, id: 'sep_' + dateStr });
      lastDate = dateStr;
    }
    messages.push(msg);
  }

  return { messages, rawMessages, loading, sendMessage, removeLocalMessage, syncPreviewToLatest, editMessage, clearLocalMessages, loadOlderMessages, hasMoreHistory, relayState, mediaBlocked };
}
