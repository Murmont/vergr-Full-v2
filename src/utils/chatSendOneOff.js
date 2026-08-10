// chatSendOneOff — fire-and-forget send to a conversation we don't already
// have a relay connection open for. Used by ForwardModal and any other
// "send once, no UI subscription" path.
//
// Flow: read convo meta (one Firestore read) → open WS → send → close.
// Heavier per-call than the hook's persistent connection, but acceptable
// for infrequent one-off paths (~1s).

import { doc, getDoc } from 'firebase/firestore';
import { db, auth } from '../firebase/config';
import { connectConversation } from './chatRelayConvo';
import { encryptForRecipient } from './chatCrypto';
import { upsertMessages } from './messageCache';

function genId() {
  return `m_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

export async function sendOneOffMessage(convoId, payload) {
  const me = auth.currentUser;
  if (!me) throw new Error('not-signed-in');
  if (!convoId) throw new Error('no-convo-id');

  // Convo meta.
  const snap = await getDoc(doc(db, 'conversations', convoId));
  if (!snap.exists()) throw new Error('conversation-not-found');
  const d = snap.data() || {};
  const isGroup = !!d.isGroup;
  const participants = Array.isArray(d.participants) ? d.participants : [];
  if (!participants.includes(me.uid)) throw new Error('not-a-participant');
  const otherUid = isGroup ? null : participants.find(u => u !== me.uid) || null;

  // Build frame.
  const id = genId();
  let frame;
  if (isGroup) {
    frame = {
      type: 'msg', id,
      text: payload.text || '',
      mediaKind: payload.contentUrl ? (payload.type || 'file') : '',
      hasMedia: !!payload.contentUrl,
    };
  } else {
    if (!otherUid) throw new Error('no-recipient');
    const body = JSON.stringify({
      t: payload.text || '',
      u: payload.contentUrl || '',
      n: payload.fileName || '',
      s: payload.fileSize || 0,
      k: payload.type || 'text',
      f: !!payload.forwarded,
      ff: payload.forwardedFrom || '',
    });
    const ct = await encryptForRecipient(body, otherUid);
    frame = {
      type: 'msg', id, ct,
      mediaKind: payload.contentUrl ? (payload.type || 'file') : '',
      hasMedia: !!payload.contentUrl,
    };
  }

  // Open WS → send → close.
  await new Promise((resolve, reject) => {
    let done = false;
    const finish = (err) => { if (done) return; done = true; err ? reject(err) : resolve(); };
    let conn;
    const t = setTimeout(() => { try { conn?.close(); } catch {} finish(new Error('timeout')); }, 5000);
    connectConversation({
      convoId,
      isGroup,
      getIdToken: () => me.getIdToken(),
      onState: (s) => {
        if (s === 'open') {
          conn.send(frame);
          // Give the server a tick to ACK by echoing our msg back, then close.
          setTimeout(() => { clearTimeout(t); try { conn.close(); } catch {} finish(); }, 250);
        } else if (s === 'closed') {
          clearTimeout(t);
          finish();
        }
      },
      onReject: (m) => {
        clearTimeout(t); try { conn?.close(); } catch {}
        finish(new Error(m.reason || 'rejected'));
      },
    }).then(c => { conn = c; }).catch(finish);
  });

  // Mirror to Dexie on the sender's side so the message appears in their own
  // forwarded-to conversation without waiting for the next time they open it.
  await upsertMessages(convoId, [{
    id,
    senderId: me.uid,
    text: payload.text || '',
    type: payload.type || 'text',
    contentUrl: payload.contentUrl || '',
    fileName: payload.fileName || '',
    fileSize: payload.fileSize || 0,
    forwarded: !!payload.forwarded,
    forwardedFrom: payload.forwardedFrom || '',
    createdAt: new Date().toISOString(),
    status: 'sent',
  }]);

  return id;
}
