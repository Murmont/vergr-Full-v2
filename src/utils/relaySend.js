// relaySend — one-shot message send to ANY conversation over the relay,
// without mounting that conversation's hook. Used by Forward (the open WS in
// ChatThreadScreen only talks to the CURRENT chat's room).
//
// Opens a short-lived socket to the target room, sends the frame, waits for
// the server echo (= ack) or a short timeout, closes. Also bumps the target
// conversation's metadata + unread counters and caches the row into Dexie so
// the sender sees the forwarded message instantly when they open that chat.

import { doc, getDoc, updateDoc, serverTimestamp, increment } from 'firebase/firestore';
import { db, auth } from '../firebase/config';
import { connectConversation } from './chatRelayConvo';
import { upsertMessages } from './messageCache';

function genId() {
  return `m_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

export async function sendRelayMessageTo(convoId, payload) {
  const me = auth.currentUser?.uid;
  if (!me || !convoId) throw new Error('not-signed-in');

  // Target conversation meta (isGroup decides the WS path; participants
  // drive the unread fan-out).
  let isGroup = false;
  let participants = [];
  try {
    const snap = await getDoc(doc(db, 'conversations', convoId));
    if (snap.exists()) {
      const d = snap.data() || {};
      isGroup = !!d.isGroup;
      participants = Array.isArray(d.participants) ? d.participants : [];
    }
  } catch {/* metadata bump below will also fail — surfaced to caller */}

  const id = genId();
  const frame = {
    type: 'msg',
    id,
    text: payload.text || '',
    contentUrl: payload.contentUrl || '',
    videoUrl: payload.videoUrl || '',
    // 'system' rides mediaKind so receivers type the row correctly (centered
    // pill, no bubble) — the relay just forwards the field.
    mediaKind: payload.contentUrl ? (payload.type || 'file') : (payload.type === 'system' ? 'system' : ''),
    hasMedia: !!payload.contentUrl,
  };

  await new Promise((resolve, reject) => {
    let conn = null;
    let settled = false;
    const finish = (err) => {
      if (settled) return;
      settled = true;
      try { conn?.close(); } catch {/* ignore */}
      err ? reject(err) : resolve();
    };
    const timeout = setTimeout(() => finish(new Error('relay-timeout')), 6000);

    connectConversation({
      convoId,
      isGroup,
      getIdToken: () => auth.currentUser?.getIdToken(),
      onState: (s) => { if (s === 'open') conn?.send(frame); },
      onMessage: (m) => { if (m.id === id) { clearTimeout(timeout); finish(); } },
      onReject: (m) => { clearTimeout(timeout); finish(new Error(m.reason || 'rejected')); },
    }).then((c) => {
      conn = c;
      // connectConversation resolves after the first connect attempt; if the
      // socket is already open the onState('open') above may have fired
      // before conn was assigned — send again (relay dedupes by echo, and
      // double-send is prevented by the settled flag on the echo).
      if (!settled) c.send(frame);
    }).catch((e) => { clearTimeout(timeout); finish(e); });
  });

  // Sender-side cache so the forwarded message is there when they open the chat.
  await upsertMessages(convoId, [{
    id,
    senderId: me,
    text: payload.text || '',
    type: payload.type || 'text',
    contentUrl: payload.contentUrl || '',
    videoUrl: payload.videoUrl || '',
    // System pills (group renamed / photo changed / …) go through this same
    // one-shot sender but are NOT forwards — flagging them as such made them
    // render with forward chrome and preview as "Forwarded message".
    forwarded: payload.type !== 'system',
    forwardedFrom: payload.forwardedFrom || '',
    createdAt: new Date().toISOString(),
    status: 'sent',
  }]);

  // Conversation metadata + unread counters (same shape as useRelayMessages).
  // System pills carry an `{actor}` token so the THREAD can resolve the actor's
  // current name at render time. The inbox preview is a stored snapshot with no
  // renderer, so substitute a real name here — otherwise the conversation list
  // literally reads "{actor} renamed the group…".
  const actorName = auth.currentUser?.displayName || 'Someone';
  const previewText = (payload.text || '').replace(/\{actor\}/g, actorName).slice(0, 140) ||
    ({ image: '📷 Photo', video: '🎬 Video', videonote: '🎥 Video message', audio: '🎙 Voice', voice: '🎙 Voice', file: '📎 File', sticker: 'Sticker', giphy: 'GIF', clip: '🎬 Clip' }[payload.type] || 'Forwarded message');
  const unread = {};
  for (const uid of participants) {
    if (uid && uid !== me) unread[`unreadCount.${uid}`] = increment(1);
  }
  try {
    await updateDoc(doc(db, 'conversations', convoId), {
      lastMessageAt: serverTimestamp(),
      lastMessageSenderId: me,
      lastMessageText: previewText,
      lastMessage: previewText,
      ...unread,
    });
  } catch {/* offline tolerated */}

  return id;
}
