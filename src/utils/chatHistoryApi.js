// chatHistoryApi — token-auth fetch against the chat relay's server-stored
// history (Telegram model, HANDOFF_CHAT_SERVER_STORE.md Phase B).
//
// The relay now persists DM/group bodies in SQLite (infra/chat/store.go) and
// exposes them over HTTP:
//   GET  /history/{convoId}?token=&after=&before=&limit=  → { messages, reactions }
//   POST /ops/{convoId}?token=  body { op, ... }
// Base mirrors the WS base (wss→https). All calls are best-effort: a failure
// here must never break chat — Dexie + the live relay still work.

import { auth, db } from '../firebase/config';
import { doc, getDoc } from 'firebase/firestore';

const HTTP_BASE = (import.meta.env.VITE_CHAT_WS_BASE || 'wss://chat.vergr.app')
  .replace(/^wss:/, 'https:')
  .replace(/^ws:/, 'http:');

async function idToken() {
  try { return auth.currentUser ? await auth.currentUser.getIdToken() : null; }
  catch { return null; }
}

// Boot flag (B4): app_config/general.chatServerHistory. Default ON; a literal
// `false` disables server history (falls back to Dexie + the relay backlog).
// Read once per session, cached.
let _flag; // undefined = unread, true/false once known
export async function serverHistoryEnabled() {
  if (_flag !== undefined) return _flag;
  try {
    const snap = await getDoc(doc(db, 'app_config', 'general'));
    const v = snap.exists() ? snap.data()?.chatServerHistory : undefined;
    _flag = v !== false;
  } catch { _flag = true; }
  return _flag;
}

// GET /history/{convoId} → { messages: HistoryRow[], reactions: {msgId:{emoji:[uids]}} }
// HistoryRow = { id, uid, ts, text?, mediaKind?, contentUrl?, videoUrl?,
//                waveform?, replyToId?, editedTs?, deleted? }
export async function fetchHistory(convoId, { after = 0, before = 0, limit = 80 } = {}) {
  const empty = { messages: [], reactions: {} };
  if (!convoId) return empty;
  const t = await idToken();
  if (!t) return empty;
  const qs = new URLSearchParams({ token: t, limit: String(limit) });
  if (after) qs.set('after', String(after));
  if (before) qs.set('before', String(before));
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  let res;
  try {
    res = await fetch(`${HTTP_BASE}/history/${encodeURIComponent(convoId)}?${qs.toString()}`, { signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) throw new Error(`history ${res.status}`);
  const data = await res.json();
  return {
    messages: Array.isArray(data.messages) ? data.messages : [],
    reactions: data.reactions || {},
    hiddenBefore: Number(data.hiddenBefore) || 0,
  };
}

// POST /ops/{convoId}. ops: deleteForEveryone {id} · deleteForMe {beforeTs} ·
// deleteChatForAll {alsoFor:true} · react {id, emoji, on}.
export async function postOp(convoId, body) {
  if (!convoId || !body?.op) return null;
  const t = await idToken();
  if (!t) return null;
  const res = await fetch(`${HTTP_BASE}/ops/${encodeURIComponent(convoId)}?token=${encodeURIComponent(t)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`ops ${res.status}`);
  return res.json();
}

// GET /search?q= → global cross-chat message search (02_MESSAGING 2.4).
//
// The relay owns the bodies, so only it can search chats this device has never
// opened — that is the whole point of this call vs the local Dexie search
// (searchAllMessages in messageCache.js), which only ever sees what THIS device
// has cached. The two are complementary: local answers instantly, this fills in
// everything else. Best-effort like the rest of this file: a failure returns []
// and the local results still stand.
//
// Rows: { convoId, id, uid, ts, text?, mediaKind? } — the relay scopes them to
// rooms the caller is a member of, so nothing needs filtering here.
export async function searchMessages(q, { limit = 50, signal } = {}) {
  const term = (q || '').trim();
  if (term.length < 2) return [];
  const t = await idToken();
  if (!t) return [];
  const qs = new URLSearchParams({ token: t, q: term, limit: String(limit) });
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  // Let the caller cancel a superseded keystroke as well as our own timeout.
  const onAbort = () => ctrl.abort();
  signal?.addEventListener('abort', onAbort);
  try {
    const res = await fetch(`${HTTP_BASE}/search?${qs.toString()}`, { signal: ctrl.signal });
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data.results) ? data.results : [];
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

// Merge two {msgId:{emoji:[uids]}} reaction maps, unioning uid lists. Used to
// combine server-stored reactions with the Firestore ops-doc reactions during
// the B2 transition.
export function mergeReactionMaps(a = {}, b = {}) {
  const out = {};
  for (const src of [a, b]) {
    for (const [msgId, emojis] of Object.entries(src || {})) {
      out[msgId] = out[msgId] || {};
      for (const [emoji, uids] of Object.entries(emojis || {})) {
        const set = new Set([...(out[msgId][emoji] || []), ...(Array.isArray(uids) ? uids : [])]);
        out[msgId][emoji] = Array.from(set);
      }
    }
  }
  return out;
}
