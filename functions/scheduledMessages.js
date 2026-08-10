// Scheduled messages (Lite/Pro). This callable validates the sender's tier +
// participation and writes a `scheduled_messages` doc; the vergr-chat relay
// (scheduled.go) executes due messages in-process (it owns the message store +
// fan-out + push). Cancel = the client deletes its own doc (rules allow owner
// delete).
//
// Media: the CLIENT uploads to R2 first and passes the resulting CDN url here,
// so a scheduled photo/video/file needs no storage of its own — the relay's
// deliverScheduled already carries contentUrl/videoUrl/mediaKind/hasMedia into
// the ChatMsg, exactly as a live send does. `mediaKind` IS the client's message
// `type` on the wire (see useRelayMessages.sendMessage), so it must stay in the
// same vocabulary. The url host is allowlisted: this doc is fanned out to other
// users, so an unchecked url would let a sender point a "photo" at any host.

const functions = require('firebase-functions/v2');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');

const db = getFirestore('vgrdb');
const REGION = 'europe-west1';

const ALLOWED_TIERS = new Set(['lite', 'pro']);
const ADMIN_EMAILS = new Set(['vergenerd@gmail.com']);

function tierOf(u) {
  const s = u && u.subscription;
  const t = typeof s === 'string' ? s : (s && s.tier);
  return t || 'free';
}
function isAdmin(u, email) {
  return (u && u.role === 'admin') || (email && ADMIN_EMAILS.has(String(email).toLowerCase()));
}

const MAX_TEXT = 4000;
const MIN_LEAD_MS = 30 * 1000;                 // at least ~a minute out
const MAX_LEAD_MS = 365 * 24 * 3600 * 1000;    // ≤ 1 year

// Must match the client's message `type` vocabulary (relay `mediaKind`).
const MEDIA_KINDS = new Set(['image', 'video', 'audio', 'voice', 'file', 'clip', 'videonote', 'sticker', 'giphy']);
// Where our own uploads live. A scheduled message is delivered to OTHER people,
// so the url can't be free-form.
const MEDIA_HOSTS = new Set(['cdn.vergr.app', 'firebasestorage.googleapis.com', 'media.giphy.com']);

function checkMediaUrl(url, label) {
  if (!url) return '';
  const s = String(url);
  let u;
  try { u = new URL(s); } catch { throw new functions.https.HttpsError('invalid-argument', `Invalid ${label}.`); }
  if (u.protocol !== 'https:' || !MEDIA_HOSTS.has(u.hostname)) {
    throw new functions.https.HttpsError('invalid-argument', `Unsupported ${label} host.`);
  }
  return s;
}

exports.scheduleMessage = functions.https.onCall(
  { region: REGION, cors: true },
  async (req) => {
    const uid = req.auth && req.auth.uid;
    if (!uid) throw new functions.https.HttpsError('unauthenticated', 'Sign in required.');

    const { convoId, text, sendAt, contentUrl, videoUrl, mediaKind } = req.data || {};
    if (!convoId || typeof convoId !== 'string') throw new functions.https.HttpsError('invalid-argument', 'Missing conversation.');
    const body = (text == null ? '' : String(text));
    if (body.length > MAX_TEXT) throw new functions.https.HttpsError('invalid-argument', 'Message too long.');

    // Media (optional). With media the text is just a caption, so it may be
    // empty; without media there must be something to send.
    const kind = mediaKind ? String(mediaKind) : '';
    if (kind && !MEDIA_KINDS.has(kind)) throw new functions.https.HttpsError('invalid-argument', 'Unsupported media type.');
    const media = checkMediaUrl(contentUrl, 'media url');
    const video = checkMediaUrl(videoUrl, 'video url');
    const hasMedia = !!media;
    if (hasMedia && !kind) throw new functions.https.HttpsError('invalid-argument', 'Missing media type.');
    if (!hasMedia && !body.trim()) throw new functions.https.HttpsError('invalid-argument', 'Message is empty.');

    const when = Number(sendAt);
    if (!Number.isFinite(when)) throw new functions.https.HttpsError('invalid-argument', 'Invalid time.');
    const now = Date.now();
    if (when < now + MIN_LEAD_MS) throw new functions.https.HttpsError('invalid-argument', 'Pick a time at least a minute from now.');
    if (when > now + MAX_LEAD_MS) throw new functions.https.HttpsError('invalid-argument', 'That is too far in the future.');

    // Tier gate (server-enforced): Lite / Pro / admin only.
    const userSnap = await db.collection('users').doc(uid).get();
    const u = userSnap.exists ? userSnap.data() : {};
    if (!isAdmin(u, req.auth.token && req.auth.token.email) && !ALLOWED_TIERS.has(tierOf(u))) {
      throw new functions.https.HttpsError('permission-denied', 'Scheduled messages are a Lite or Pro feature.');
    }

    // Participation check.
    const convoSnap = await db.collection('conversations').doc(convoId).get();
    if (!convoSnap.exists) throw new functions.https.HttpsError('not-found', 'Conversation not found.');
    const convo = convoSnap.data() || {};
    const participants = convo.participants || [];
    if (!participants.includes(uid)) throw new functions.https.HttpsError('permission-denied', 'You are not in this conversation.');

    // STRANGER-DM MEDIA GATE. deliverScheduled injects straight into the relay
    // in-process, so it never passes the per-peer check in dm.go — scheduling
    // would otherwise be a way to post a photo into a chat that refuses them
    // live. Groups are governed by their own permissions map, and a note to
    // yourself is never restricted.
    if (hasMedia && !convo.isGroup) {
      const other = participants.find((p) => p !== uid);
      if (other) {
        const follow = await db.collection('follows').doc(`${other}_${uid}`).get();
        if (!follow.exists) {
          throw new functions.https.HttpsError(
            'permission-denied',
            'They need to follow you back before you can send attachments.',
          );
        }
      }
    }

    const msgId = 'm_sch_' + Math.random().toString(36).slice(2, 12) + Date.now().toString(36);
    const ref = await db.collection('scheduled_messages').add({
      convoId,
      senderUid: uid,
      text: body,
      contentUrl: media,
      videoUrl: video,
      mediaKind: kind,
      hasMedia,
      msgId,
      sendAt: new Date(when),
      createdAt: FieldValue.serverTimestamp(),
    });
    return { id: ref.id, msgId, sendAt: when };
  }
);
