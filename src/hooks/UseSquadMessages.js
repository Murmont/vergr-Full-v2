// useSquadMessages — Dexie-first, relay-driven hook for squad chat rooms.
//
// Mirrors useMessages.js for DMs/group conversations, but routes through the
// relay's /squad/<squadId> endpoint and keys Dexie rows by `chatId = "squad:<id>"`
// so they namespace cleanly alongside conversation messages.
//
// Squad messages are PLAINTEXT (founder decision — many participants make
// per-recipient encryption impractical and groups don't need it). Storage is
// still device-local; the relay fans out + forgets.

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  collection, query, orderBy, limit as fsLimit, getDocs,
} from 'firebase/firestore';
import { db, auth } from '../firebase/config';
import {
  getCachedMessages, upsertMessages, removeCachedMessage,
  addToOutbox, getOutboxMessages, removeFromOutbox,
} from '../utils/messageCache';
import { connectConversation } from '../utils/chatRelayConvo';

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
  return { toDate: () => d, seconds: Math.floor(d.getTime() / 1000), nanoseconds: 0 };
}

export default function useSquadMessages(squadId, messageLimit = 80) {
  const chatId = squadId ? `squad:${squadId}` : null;
  const [rawMessages, setRawMessages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [relayState, setRelayState] = useState('idle');

  const messageMap = useRef(new Map());
  const connRef = useRef(null);
  const latestTsRef = useRef(0);

  const rerender = useCallback(() => {
    setRawMessages(Array.from(messageMap.current.values()).sort(sortByCreated));
  }, []);

  const ingest = useCallback(async (row) => {
    if (!row?.id || !chatId) return;
    messageMap.current.set(row.id, row);
    const ms = tsMs(row.createdAt);
    if (ms > latestTsRef.current) latestTsRef.current = ms;
    await upsertMessages(chatId, [row]);
    rerender();
  }, [chatId, rerender]);

  useEffect(() => {
    if (!squadId || !auth.currentUser) { setLoading(false); return; }
    let cancelled = false;
    messageMap.current = new Map();
    latestTsRef.current = 0;
    setLoading(true);

    (async () => {
      // Hydrate Dexie.
      let cached = await getCachedMessages(chatId, messageLimit);

      // One-time backfill from squads/{id}/messages.
      const migKey = `vergr.squadmig.${squadId}`;
      const alreadyMigrated = (() => { try { return !!localStorage.getItem(migKey); } catch { return false; } })();
      if (!cached.length && !alreadyMigrated) {
        try {
          const q = query(collection(db, 'squads', squadId, 'messages'), orderBy('createdAt', 'desc'), fsLimit(messageLimit * 3));
          const snap = await getDocs(q);
          const rows = snap.docs.map(d => ({ id: d.id, ...d.data() }));
          if (rows.length) {
            await upsertMessages(chatId, rows);
            cached = await getCachedMessages(chatId, messageLimit);
          }
        } catch (err) {
          console.warn('squad backfill failed:', err);
        }
        try { localStorage.setItem(migKey, String(Date.now())); } catch {/* ignore */}
      }

      if (cancelled) return;
      for (const m of cached) {
        messageMap.current.set(m.id, m);
        const ms = tsMs(m.createdAt);
        if (ms > latestTsRef.current) latestTsRef.current = ms;
      }
      rerender();
      setLoading(false);

      // Open WS to /squad/<squadId>.
      const conn = await connectConversation({
        convoId: squadId,
        isSquad: true,
        getIdToken: () => auth.currentUser?.getIdToken(),
        catchupSince: latestTsRef.current,
        onState: (s) => { if (!cancelled) setRelayState(s); },
        onHello: () => { drainSquadOutbox(chatId, conn).catch(() => {}); },
        onMessage: async (m) => {
          if (cancelled) return;
          const existing = messageMap.current.get(m.id);
          await ingest({
            id: m.id,
            senderId: m.uid,
            text: m.text || '',
            type: m.mediaKind || (m.hasMedia ? 'media' : 'text'),
            contentUrl: existing?.contentUrl || '',
            fileName: existing?.fileName || '',
            fileSize: existing?.fileSize || 0,
            replyToId: m.replyToId || existing?.replyToId || '',
            createdAt: asCreatedAt(m.ts),
            status: 'sent',
          });
        },
        onReject: (m) => {
          const id = m.id;
          if (id && messageMap.current.has(id)) {
            const cur = messageMap.current.get(id);
            messageMap.current.set(id, { ...cur, status: 'failed', failReason: m.reason });
            rerender();
          }
        },
      });
      if (cancelled) { conn.close(); return; }
      connRef.current = conn;
    })();

    return () => {
      cancelled = true;
      try { connRef.current?.close(); } catch {/* ignore */}
      connRef.current = null;
    };
  }, [squadId, chatId, messageLimit, ingest, rerender]);

  const removeLocalMessage = useCallback((messageId) => {
    if (!chatId || !messageId) return;
    messageMap.current.delete(messageId);
    rerender();
    removeCachedMessage(chatId, messageId).catch(() => {});
  }, [chatId, rerender]);

  const sendMessage = useCallback(async (payload) => {
    if (!squadId || !auth.currentUser) return;
    const meUid = auth.currentUser.uid;
    const id = genId();
    const now = Date.now();

    const localRow = {
      id,
      senderId: meUid,
      text: payload?.text || '',
      type: payload?.type || 'text',
      contentUrl: payload?.contentUrl || '',
      fileName: payload?.fileName || '',
      fileSize: payload?.fileSize || 0,
      replyToId: payload?.replyToId || payload?.replyTo?.id || '',
      replyTo: payload?.replyTo || null,
      senderName: payload?.senderName || '',
      senderAvatar: payload?.senderAvatar || '',
      createdAt: asCreatedAt(now),
      status: 'sending',
    };
    await ingest(localRow);

    const frame = {
      type: 'msg', id,
      text: payload?.text || '',
      mediaKind: payload?.contentUrl ? (payload?.type || 'file') : '',
      hasMedia: !!payload?.contentUrl,
      replyToId: localRow.replyToId,
    };
    const queued = !connRef.current?.send(frame);
    if (queued) {
      try { await addToOutbox(chatId, { frame }); } catch {/* ignore */}
    }
    return id;
  }, [squadId, chatId, ingest]);

  // Day-separator grouping for UI parity with useMessages.
  const visible = rawMessages.filter(m => !m.deleted);
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

  return { messages, rawMessages, loading, sendMessage, removeLocalMessage, relayState };
}

function sortByCreated(a, b) {
  return tsMs(a.createdAt) - tsMs(b.createdAt);
}

async function drainSquadOutbox(chatId, conn) {
  const queued = await getOutboxMessages('pending').catch(() => []);
  for (const row of queued) {
    if (row.chatId !== chatId) continue;
    const frame = row.payload?.frame || row.frame;
    if (!frame) { await removeFromOutbox(row.localId).catch(() => {}); continue; }
    if (conn.send(frame)) await removeFromOutbox(row.localId).catch(() => {});
  }
}
