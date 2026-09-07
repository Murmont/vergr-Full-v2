// VERGR per-stream chat moderation — broadcaster controls.
//
// Three knobs on streams/{streamId}:
//   - mutedUids: { [uid]: untilMs }    // soft mute, per-uid timeout
//   - bannedUids: string[]             // hard ban, kicked + blocked
//   - bannedWords: string[]            // local host-curated word filter
//
// The vergr-chat WS relay reads these on peer-join and on each message:
//   - hostUid (allowed to send)
//   - bannedUids includes sender → reject with "banned"
//   - mutedUids[sender] && Date.now() < value → reject with "muted"
//   - text matches bannedWords case-insensitive → replace with "■■■■" and
//     fan out (DOES NOT block — host's choice is purely visual).
//
// No Gemini needed for bannedWords (host-curated). bannedWords are surface-
// level lexical: just plaintext (lowercased) substring match.

const functions = require('firebase-functions/v2');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');

const REGION = 'europe-west1';
const db = getFirestore('vgrdb');

async function loadStream(streamId, uid) {
  if (!streamId) throw new functions.https.HttpsError('invalid-argument', 'streamId required.');
  const ref = db.collection('streams').doc(streamId);
  const snap = await ref.get();
  if (!snap.exists) throw new functions.https.HttpsError('not-found', 'Stream not found.');
  const data = snap.data();
  if (data.hostUid !== uid) {
    throw new functions.https.HttpsError('permission-denied', 'Host only.');
  }
  return { ref, data };
}

// Like loadStream, but the host OR a designated stream moderator passes. Used
// by the per-viewer actions (mute/ban/pin) so the host can delegate chat
// moderation. Stream-config actions (slow mode, banned words, followers-only)
// stay host-only via loadStream.
async function loadStreamForMod(streamId, uid) {
  if (!streamId) throw new functions.https.HttpsError('invalid-argument', 'streamId required.');
  const ref = db.collection('streams').doc(streamId);
  const snap = await ref.get();
  if (!snap.exists) throw new functions.https.HttpsError('not-found', 'Stream not found.');
  const data = snap.data();
  const mods = Array.isArray(data.moderatorUids) ? data.moderatorUids : [];
  if (data.hostUid !== uid && !mods.includes(uid)) {
    throw new functions.https.HttpsError('permission-denied', 'Host or moderator only.');
  }
  return { ref, data, isHost: data.hostUid === uid };
}

// ─────────────────────────────────────────────────────────────────────────────
// setStreamModerator — host designates (or removes) a chat moderator. Mods get
// the shield badge in chat + mute/ban/pin powers. Stored on
// streams/{id}.moderatorUids[]; the chat relay reads it on its 10s mod refresh.
// ─────────────────────────────────────────────────────────────────────────────
exports.setStreamModerator = functions.https.onCall({ region: REGION }, async (req) => {
  if (!req.auth) throw new functions.https.HttpsError('unauthenticated', 'Sign in required.');
  const { streamId, viewerUid, on = true } = req.data || {};
  if (!viewerUid) throw new functions.https.HttpsError('invalid-argument', 'viewerUid required.');
  const { ref, data } = await loadStream(streamId, req.auth.uid);
  if (viewerUid === data.hostUid) throw new functions.https.HttpsError('invalid-argument', 'Host is already a moderator.');
  await ref.update({
    moderatorUids: on ? FieldValue.arrayUnion(viewerUid) : FieldValue.arrayRemove(viewerUid),
  });
  return { ok: true, on: !!on };
});

// ─────────────────────────────────────────────────────────────────────────────
// muteViewer — soft mute a specific viewer from chat for N minutes.
// ─────────────────────────────────────────────────────────────────────────────
exports.muteViewer = functions.https.onCall({ region: REGION }, async (req) => {
  if (!req.auth) throw new functions.https.HttpsError('unauthenticated', 'Sign in required.');
  const { streamId, viewerUid, durationMinutes = 10 } = req.data || {};
  if (!viewerUid) throw new functions.https.HttpsError('invalid-argument', 'viewerUid required.');
  const dur = Math.max(1, Math.min(1440, Math.floor(durationMinutes)));
  const { ref } = await loadStreamForMod(streamId, req.auth.uid);
  const until = Date.now() + dur * 60_000;
  await ref.update({
    [`mutedUids.${viewerUid}`]: until,
  });
  return { ok: true, until };
});

exports.unmuteViewer = functions.https.onCall({ region: REGION }, async (req) => {
  if (!req.auth) throw new functions.https.HttpsError('unauthenticated', 'Sign in required.');
  const { streamId, viewerUid } = req.data || {};
  if (!viewerUid) throw new functions.https.HttpsError('invalid-argument', 'viewerUid required.');
  const { ref } = await loadStreamForMod(streamId, req.auth.uid);
  await ref.update({
    [`mutedUids.${viewerUid}`]: FieldValue.delete(),
  });
  return { ok: true };
});

// ─────────────────────────────────────────────────────────────────────────────
// banViewer — hard ban: drop from this stream + block re-connect.
// ─────────────────────────────────────────────────────────────────────────────
exports.banViewer = functions.https.onCall({ region: REGION }, async (req) => {
  if (!req.auth) throw new functions.https.HttpsError('unauthenticated', 'Sign in required.');
  const { streamId, viewerUid } = req.data || {};
  if (!viewerUid) throw new functions.https.HttpsError('invalid-argument', 'viewerUid required.');
  const { ref } = await loadStreamForMod(streamId, req.auth.uid);
  await ref.update({
    bannedUids: FieldValue.arrayUnion(viewerUid),
  });
  return { ok: true };
});

exports.unbanViewer = functions.https.onCall({ region: REGION }, async (req) => {
  if (!req.auth) throw new functions.https.HttpsError('unauthenticated', 'Sign in required.');
  const { streamId, viewerUid } = req.data || {};
  if (!viewerUid) throw new functions.https.HttpsError('invalid-argument', 'viewerUid required.');
  const { ref } = await loadStreamForMod(streamId, req.auth.uid);
  await ref.update({
    bannedUids: FieldValue.arrayRemove(viewerUid),
  });
  return { ok: true };
});

// ─────────────────────────────────────────────────────────────────────────────
// setStreamBannedWords — host-curated word filter for THIS stream.
//   Words are lowercased + trimmed server-side. Max 100 entries, each 1-32 chars.
//   Stored on streams/{id}.bannedWords. The chat relay applies a case-
//   insensitive substring match per word and replaces hits with "■■■■".
// ─────────────────────────────────────────────────────────────────────────────
exports.setStreamBannedWords = functions.https.onCall({ region: REGION }, async (req) => {
  if (!req.auth) throw new functions.https.HttpsError('unauthenticated', 'Sign in required.');
  const { streamId, words = [] } = req.data || {};
  if (!Array.isArray(words)) {
    throw new functions.https.HttpsError('invalid-argument', 'words must be array.');
  }
  if (words.length > 100) {
    throw new functions.https.HttpsError('invalid-argument', 'Max 100 banned words.');
  }
  const cleaned = [];
  for (const raw of words) {
    if (typeof raw !== 'string') continue;
    const w = raw.trim().toLowerCase();
    if (w.length < 1 || w.length > 32) continue;
    if (!cleaned.includes(w)) cleaned.push(w);
  }
  const { ref } = await loadStream(streamId, req.auth.uid);
  await ref.update({ bannedWords: cleaned });
  return { ok: true, count: cleaned.length };
});

// ─────────────────────────────────────────────────────────────────────────────
// setStreamSlowMode — per-uid send cooldown (seconds). 0 disables.
//   Relay enforces: a non-host sender's messages < slowModeSec apart are
//   rejected with "slow-mode".
// ─────────────────────────────────────────────────────────────────────────────
exports.setStreamSlowMode = functions.https.onCall({ region: REGION }, async (req) => {
  if (!req.auth) throw new functions.https.HttpsError('unauthenticated', 'Sign in required.');
  const { streamId, seconds = 0 } = req.data || {};
  const s = Math.max(0, Math.min(300, Math.floor(Number(seconds) || 0)));
  const { ref } = await loadStream(streamId, req.auth.uid);
  await ref.update({ slowModeSec: s });
  return { ok: true, seconds: s };
});

// ─────────────────────────────────────────────────────────────────────────────
// setStreamFollowersOnly — when true, only the host's followers (+ host +
// Vanguard) may send. Relay resolves follower status once per connection.
// ─────────────────────────────────────────────────────────────────────────────
exports.setStreamFollowersOnly = functions.https.onCall({ region: REGION }, async (req) => {
  if (!req.auth) throw new functions.https.HttpsError('unauthenticated', 'Sign in required.');
  const { streamId, enabled = false } = req.data || {};
  const { ref } = await loadStream(streamId, req.auth.uid);
  await ref.update({ followersOnly: !!enabled });
  return { ok: true, enabled: !!enabled };
});

// ─────────────────────────────────────────────────────────────────────────────
// setStreamSubscribersOnly — when true, only the host's ACTIVE members (+ host
// + Vanguard) may send.
//
// ⚠⚠ THE TOGGLE EXISTED BEFORE THIS DID. "Subscribers-only" has been offered in
// the moderation menu while the relay had never heard of it and this file wrote
// no such field, so switching it on changed nothing at all: an inert control,
// the same class as the boost that bought a badge and the three kill switches.
//
// ⚠ IT COSTS NO EXTRA READ AT THE RELAY. Subscriber status is already resolved
// once per connection for the member gem (member_subscriptions/{host}_{uid}),
// and that badge is only set when the doc says status === 'active'. The relay
// gate reuses it rather than looking anything up per message.
//
// ⚠ HOST-ONLY, like every other chat RULE. loadStream is host-only on purpose;
// loadStreamForMod (host OR moderator) is for the per-viewer actions. A
// moderator may mute somebody, not re-write who is allowed to speak.
// ─────────────────────────────────────────────────────────────────────────────
exports.setStreamSubscribersOnly = functions.https.onCall({ region: REGION }, async (req) => {
  if (!req.auth) throw new functions.https.HttpsError('unauthenticated', 'Sign in required.');
  const { streamId, enabled = false } = req.data || {};
  const { ref } = await loadStream(streamId, req.auth.uid);
  await ref.update({ subsOnly: !!enabled });
  return { ok: true, enabled: !!enabled };
});

// ─────────────────────────────────────────────────────────────────────────────
// setStreamTts — effect 13. When true, viewers who have earned the unlock (or
// hold Pro) may send a message that EVERY VIEWER'S CLIENT SPEAKS ALOUD.
//
// ⚠ OFF BY DEFAULT AND HOST-ONLY, deliberately. This hands a stranger a
// loudspeaker into the audience's ears, so it is the broadcaster's call and
// nobody else's. `loadStream` already restricts to the host — do NOT relax this
// to loadStreamForMod: a chat moderator pinning a message is not the same
// authority as opening the room's audio to viewers.
//
// The relay reads `streams/{id}.ttsEnabled` on its periodic mod refresh
// (StreamMod.TtsEnabled), so this takes effect without a relay restart.
// Doc: docs/effects/13-tts-on-stream.md
// ─────────────────────────────────────────────────────────────────────────────
exports.setStreamTts = functions.https.onCall({ region: REGION }, async (req) => {
  if (!req.auth) throw new functions.https.HttpsError('unauthenticated', 'Sign in required.');
  const { streamId, enabled = false } = req.data || {};
  const { ref } = await loadStream(streamId, req.auth.uid);
  await ref.update({ ttsEnabled: !!enabled });
  return { ok: true, enabled: !!enabled };
});

// ─────────────────────────────────────────────────────────────────────────────
// pinStreamMessage — pin/unpin a chat message. Stored on
// streams/{id}.pinnedMessage = { id, text, name, at } (or null to unpin).
// ChatPanel reads it from the stream doc and renders a banner; no relay change.
// ─────────────────────────────────────────────────────────────────────────────
exports.pinStreamMessage = functions.https.onCall({ region: REGION }, async (req) => {
  if (!req.auth) throw new functions.https.HttpsError('unauthenticated', 'Sign in required.');
  const { streamId, message = null } = req.data || {};
  const { ref } = await loadStreamForMod(streamId, req.auth.uid);
  if (!message) {
    await ref.update({ pinnedMessage: FieldValue.delete() });
    return { ok: true, pinned: false };
  }
  const pinned = {
    id: String(message.id || '').slice(0, 80),
    text: String(message.text || '').slice(0, 240),
    name: String(message.name || '').slice(0, 60),
    at: Date.now(),
  };
  await ref.update({ pinnedMessage: pinned });
  return { ok: true, pinned: true };
});
