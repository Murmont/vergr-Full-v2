// VERGR co-stream — invite + accept + decline + remove for co-host publishers.
//
// Architecture (CLAUDE.md):
//   - A co-stream is just a public live stream with kind='co_stream' and a
//     coHostUids[] array (up to 3 entries → 4 publishers total).
//   - Each publisher joins Pion SFU room `ingest_<streamId>` as a WebRTC publisher.
//   - vergr-cohost@<streamId>.service subscribes server-side, ffmpeg xstacks
//     to a composite, pushes RTMP loopback → HLS → R2 → CDN.
//   - Auth on the SFU side checks hostUid + coHostUids[] (see infra/sfu/main.go).
//
// Invitation flow:
//   1. Host calls inviteToCoStream({ streamId, inviteeUid }).
//   2. We write co_stream_invites/{id} with status='pending' + a notification.
//   3. Invitee opens /co-stream/invite/:id → calls acceptCoHostInvite or declineCoHostInvite.
//   4. On accept, we add the invitee to streams/{id}.coHostUids[].
//   5. removeCoHost lets the host kick a co-host (also drops them from SFU on next join attempt).

const functions = require('firebase-functions/v2');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');

const REGION = 'europe-west1';
const db = getFirestore('vgrdb');

const MAX_COHOSTS = 3; // 1 host + 3 cohosts = 4 publishers (matches mockups + SFU bench).

async function loadStream(streamId, uid, mustBeHost) {
  if (!streamId) throw new functions.https.HttpsError('invalid-argument', 'streamId required.');
  const ref = db.collection('streams').doc(streamId);
  const snap = await ref.get();
  if (!snap.exists) throw new functions.https.HttpsError('not-found', 'Stream not found.');
  const data = snap.data();
  if (mustBeHost && data.hostUid !== uid) {
    throw new functions.https.HttpsError('permission-denied', 'Host only.');
  }
  return { ref, data };
}

// ─────────────────────────────────────────────────────────────────────────────
// inviteToCoStream — host invites another user to co-host.
// ─────────────────────────────────────────────────────────────────────────────
exports.inviteToCoStream = functions.https.onCall({ region: REGION }, async (req) => {
  if (!req.auth) throw new functions.https.HttpsError('unauthenticated', 'Sign in required.');
  const uid = req.auth.uid;
  const { streamId, inviteeUid } = req.data || {};
  if (!inviteeUid) throw new functions.https.HttpsError('invalid-argument', 'inviteeUid required.');
  if (inviteeUid === uid) throw new functions.https.HttpsError('invalid-argument', 'You cannot invite yourself.');

  const { ref: streamRef, data: stream } = await loadStream(streamId, uid, true);
  // Multi-Guest: the host goes live with their OWN solo stream, then invites
  // partners from the live broadcaster screen (TikTok model — each linked
  // streamer is an independent live broadcaster). Any non-ended live stream can
  // invite; we do NOT require kind === 'co_stream'.
  if (stream.status === 'ended') {
    throw new functions.https.HttpsError('failed-precondition', 'Stream already ended.');
  }
  // Limit applies to Multi-Guest linked streams (1 host + up to 3 partners).
  const linked = stream.linkedStreamIds || [];
  if (linked.length >= MAX_COHOSTS) {
    throw new functions.https.HttpsError('failed-precondition', `Multi-Guest limit reached (${MAX_COHOSTS + 1} streams total).`);
  }
  // Check existing pending invite for this (stream, invitee).
  const dup = await db.collection('co_stream_invites')
    .where('streamId', '==', streamId)
    .where('inviteeUid', '==', inviteeUid)
    .where('status', '==', 'pending')
    .limit(1).get();
  if (!dup.empty) {
    throw new functions.https.HttpsError('already-exists', 'Already invited.');
  }

  // Load invitee profile for notification body.
  const inviteeSnap = await db.collection('users').doc(inviteeUid).get();
  if (!inviteeSnap.exists) throw new functions.https.HttpsError('not-found', 'Invitee not found.');

  const hostSnap = await db.collection('users').doc(uid).get();
  const hostData = hostSnap.exists ? hostSnap.data() : {};
  const hostName = hostData.displayName || hostData.username || 'A creator';

  const inviteRef = db.collection('co_stream_invites').doc();
  await inviteRef.set({
    streamId,
    hostUid: uid,
    hostName,
    hostAvatar: hostData.avatar || null,
    inviteeUid,
    streamTitle: stream.title || 'Untitled stream',
    status: 'pending',
    createdAt: FieldValue.serverTimestamp(),
    respondedAt: null,
  });

  await db.collection('notifications').add({
    recipientId: inviteeUid,
    type: 'co_stream_invite',
    title: `${hostName} invited you to co-stream`,
    body: stream.title ? `"${stream.title}" — tap to accept or decline.` : 'Tap to accept or decline.',
    data: { inviteId: inviteRef.id, streamId },
    actionUrl: `/co-stream/invite/${inviteRef.id}`,
    read: false,
    createdAt: FieldValue.serverTimestamp(),
  }).catch(() => null);

  return { ok: true, inviteId: inviteRef.id };
});

// ─────────────────────────────────────────────────────────────────────────────
// acceptCoHostInvite — TikTok Multi-Guest semantics.
//
// REQUIREMENT: invitee MUST be currently live with their own stream. There is
// no co-host concept anymore — every linked streamer is a fully independent
// broadcaster running their own solo ingest + HLS path.
//
// On accept, we write `linkedStreamIds[]` on BOTH stream docs. Each side
// keeps its own `streamKey`/`hlsUrl`/`viewerCount`. The viewer screen
// renders all linked streams' HLS feeds client-side.
// ─────────────────────────────────────────────────────────────────────────────
exports.acceptCoHostInvite = functions.https.onCall({ region: REGION }, async (req) => {
  if (!req.auth) throw new functions.https.HttpsError('unauthenticated', 'Sign in required.');
  const uid = req.auth.uid;
  const { inviteId } = req.data || {};
  if (!inviteId) throw new functions.https.HttpsError('invalid-argument', 'inviteId required.');

  const inviteRef = db.collection('co_stream_invites').doc(inviteId);

  // Pre-flight: look up the invitee's currently-live stream OUTSIDE the
  // transaction (queries aren't allowed inside runTransaction).
  const inviteSnapPre = await inviteRef.get();
  if (!inviteSnapPre.exists) throw new functions.https.HttpsError('not-found', 'Invite not found.');
  const invitePre = inviteSnapPre.data();
  if (invitePre.inviteeUid !== uid) throw new functions.https.HttpsError('permission-denied', 'Not your invite.');

  let inviteeLiveStreamId = null;
  try {
    const liveSnap = await db.collection('streams')
      .where('hostUid', '==', uid)
      .where('status', '==', 'live')
      .limit(1).get();
    if (!liveSnap.empty) inviteeLiveStreamId = liveSnap.docs[0].id;
  } catch (e) {
    console.warn('acceptCoHostInvite: live-stream lookup failed:', e);
  }

  if (!inviteeLiveStreamId) {
    throw new functions.https.HttpsError(
      'failed-precondition',
      'You must be live with your own stream to accept a Multi-Guest invite. Start your stream first, then accept.',
    );
  }

  const result = await db.runTransaction(async (tx) => {
    const inviteSnap = await tx.get(inviteRef);
    if (!inviteSnap.exists) throw new functions.https.HttpsError('not-found', 'Invite not found.');
    const invite = inviteSnap.data();
    if (invite.inviteeUid !== uid) throw new functions.https.HttpsError('permission-denied', 'Not your invite.');
    if (invite.status !== 'pending') throw new functions.https.HttpsError('failed-precondition', `Invite already ${invite.status}.`);

    const inviterStreamRef = db.collection('streams').doc(invite.streamId);
    const inviterSnap = await tx.get(inviterStreamRef);
    if (!inviterSnap.exists) throw new functions.https.HttpsError('not-found', 'Inviter stream no longer exists.');
    const inviterStream = inviterSnap.data();
    if (inviterStream.status !== 'live') {
      throw new functions.https.HttpsError('failed-precondition', 'Inviter stream is no longer live.');
    }

    // Recheck invitee live stream inside the transaction.
    const inviteeStreamRef = db.collection('streams').doc(inviteeLiveStreamId);
    const inviteeStreamSnap = await tx.get(inviteeStreamRef);
    if (!inviteeStreamSnap.exists || inviteeStreamSnap.data().status !== 'live') {
      throw new functions.https.HttpsError('failed-precondition', 'Your own live stream is no longer active.');
    }

    if ((inviterStream.linkedStreamIds || []).length >= MAX_COHOSTS) {
      throw new functions.https.HttpsError('failed-precondition', `Multi-Guest limit reached (${MAX_COHOSTS + 1} streams total).`);
    }

    // Delivery model: ONE server-side composite (vergr-cohost ffmpeg xstack)
    // rendered into the initiator's R2 path. Both stream docs reference the
    // same composite playlist via `compositeHlsUrl`. Each side keeps its own
    // streamKey, viewerCount, profile — only the playback URL is shared.
    // Viewer fetches 1× bandwidth, not N×.
    const compositeOwner = invite.streamId;
    const compositeHlsUrl = `https://cdn.vergr.app/streams/${inviterStream.streamKey}/index.m3u8`;

    tx.update(inviterStreamRef, {
      linkedStreamIds: FieldValue.arrayUnion(inviteeLiveStreamId),
      compositeHlsUrl,
      compositeOwner,
    });
    tx.update(inviteeStreamRef, {
      linkedStreamIds: FieldValue.arrayUnion(invite.streamId),
      compositeHlsUrl,
      compositeOwner,
    });
    tx.update(inviteRef, {
      status: 'accepted',
      respondedAt: FieldValue.serverTimestamp(),
      inviteeLiveStreamId,
    });
    return { streamId: invite.streamId, inviteeLiveStreamId, compositeOwner };
  });

  return {
    ok: true,
    streamId: result.streamId,            // the inviter's stream id (for navigation if needed)
    yourStreamId: result.inviteeLiveStreamId,
  };
});

// ─────────────────────────────────────────────────────────────────────────────
// declineCoHostInvite — invitee says no.
// ─────────────────────────────────────────────────────────────────────────────
exports.declineCoHostInvite = functions.https.onCall({ region: REGION }, async (req) => {
  if (!req.auth) throw new functions.https.HttpsError('unauthenticated', 'Sign in required.');
  const uid = req.auth.uid;
  const { inviteId } = req.data || {};
  if (!inviteId) throw new functions.https.HttpsError('invalid-argument', 'inviteId required.');

  const inviteRef = db.collection('co_stream_invites').doc(inviteId);
  const snap = await inviteRef.get();
  if (!snap.exists) throw new functions.https.HttpsError('not-found', 'Invite not found.');
  const invite = snap.data();
  if (invite.inviteeUid !== uid) throw new functions.https.HttpsError('permission-denied', 'Not your invite.');
  if (invite.status !== 'pending') return { ok: true, alreadyResponded: true };

  await inviteRef.update({ status: 'declined', respondedAt: FieldValue.serverTimestamp() });
  return { ok: true };
});

// ─────────────────────────────────────────────────────────────────────────────
// removeCoHost — host kicks a co-host. Also drops them from any future SFU join.
// ─────────────────────────────────────────────────────────────────────────────
exports.removeCoHost = functions.https.onCall({ region: REGION }, async (req) => {
  if (!req.auth) throw new functions.https.HttpsError('unauthenticated', 'Sign in required.');
  const uid = req.auth.uid;
  const { streamId, removeUid } = req.data || {};
  if (!removeUid) throw new functions.https.HttpsError('invalid-argument', 'removeUid required.');

  const { ref: streamRef, data: stream } = await loadStream(streamId, uid, true);

  // Remove from coHostUids (legacy publisher list — kept for older streams).
  const updates = {};
  if ((stream.coHostUids || []).includes(removeUid)) {
    updates.coHostUids = FieldValue.arrayRemove(removeUid);
  }

  // Multi-Guest unlink: if any linked stream belongs to removeUid, drop the
  // link from both docs. Composite fields cleared when no links remain.
  if (Array.isArray(stream.linkedStreamIds) && stream.linkedStreamIds.length > 0) {
    const linkedSnap = await db.collection('streams')
      .where('hostUid', '==', removeUid)
      .where('status', '==', 'live')
      .limit(1).get().catch(() => null);
    if (linkedSnap && !linkedSnap.empty) {
      const linkedId = linkedSnap.docs[0].id;
      if (stream.linkedStreamIds.includes(linkedId)) {
        updates.linkedStreamIds = FieldValue.arrayRemove(linkedId);
        if (stream.linkedStreamIds.length === 1) {
          updates.compositeHlsUrl = FieldValue.delete();
          updates.compositeOwner = FieldValue.delete();
        }
        await db.collection('streams').doc(linkedId).update({
          linkedStreamIds: FieldValue.arrayRemove(streamId),
          compositeHlsUrl: FieldValue.delete(),
          compositeOwner: FieldValue.delete(),
        }).catch(() => null);
      }
    }
  }

  if (Object.keys(updates).length === 0) {
    return { ok: true, alreadyRemoved: true };
  }
  await streamRef.update(updates);

  // Best-effort notification.
  await db.collection('notifications').add({
    recipientId: removeUid,
    type: 'co_stream_removed',
    title: 'Co-host removed',
    body: `The host removed you from "${stream.title || 'the stream'}".`,
    data: { streamId },
    actionUrl: null,
    read: false,
    createdAt: FieldValue.serverTimestamp(),
  }).catch(() => null);

  return { ok: true };
});

// ─────────────────────────────────────────────────────────────────────────────
// cancelCoHostInvite — host revokes a pending invite (no notif spam to invitee).
// ─────────────────────────────────────────────────────────────────────────────
exports.cancelCoHostInvite = functions.https.onCall({ region: REGION }, async (req) => {
  if (!req.auth) throw new functions.https.HttpsError('unauthenticated', 'Sign in required.');
  const uid = req.auth.uid;
  const { inviteId } = req.data || {};
  if (!inviteId) throw new functions.https.HttpsError('invalid-argument', 'inviteId required.');

  const inviteRef = db.collection('co_stream_invites').doc(inviteId);
  const snap = await inviteRef.get();
  if (!snap.exists) throw new functions.https.HttpsError('not-found', 'Invite not found.');
  const invite = snap.data();
  if (invite.hostUid !== uid) throw new functions.https.HttpsError('permission-denied', 'Host only.');
  if (invite.status !== 'pending') return { ok: true, alreadyResponded: true };

  await inviteRef.update({ status: 'cancelled', respondedAt: FieldValue.serverTimestamp() });
  return { ok: true };
});
