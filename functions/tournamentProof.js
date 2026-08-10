// Tournament two-camera proof feed (high-stakes matches >5,000c entry).
//
// Players client-side composite their game capture + webcam into a single
// canvas, MediaRecorder chops it into 10s WebM chunks, each chunk is PUT to
// R2 via the standard `getR2UploadUrl` presigned flow, then the client calls
// `appendProofChunk` to register the chunk URL on the match doc.
//
// Result: `tournaments/{tId}/matches/{mId}.proofFeed[uid] = {
//   startedAt, lastChunkAt, chunks: [{ idx, url, key, t, durationMs }]
// }` — mods + spectators play chunks back sequentially via a viewer
// component to verify the player was at their machine the whole match.
//
// Auth: caller must be the recording player (one of match.player1 / .player2),
// match must be in progress, tournament must be active. Founders bypass.

const functions = require('firebase-functions/v2');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');

const REGION = 'europe-west1';
const db = getFirestore('vgrdb');

exports.appendProofChunk = functions.https.onCall(
  { region: REGION },
  async (req) => {
    if (!req.auth) throw new functions.https.HttpsError('unauthenticated', 'Sign in required.');
    const uid = req.auth.uid;
    const { tournamentId, matchId, url, key, t: chunkTs, durationMs, idx } = req.data || {};
    if (!tournamentId || !matchId || !url || !key || typeof idx !== 'number') {
      throw new functions.https.HttpsError('invalid-argument', 'tournamentId, matchId, url, key, idx required.');
    }

    const tRef = db.collection('tournaments').doc(tournamentId);
    const mRef = tRef.collection('matches').doc(matchId);
    const [tSnap, mSnap, uSnap] = await Promise.all([tRef.get(), mRef.get(), db.collection('users').doc(uid).get()]);
    if (!tSnap.exists) throw new functions.https.HttpsError('not-found', 'Tournament not found.');
    if (!mSnap.exists) throw new functions.https.HttpsError('not-found', 'Match not found.');
    const t = tSnap.data();
    const m = mSnap.data();
    const isFounder = uSnap.exists && uSnap.data()?.role === 'admin';

    if (!isFounder) {
      if (t.status !== 'active') throw new functions.https.HttpsError('failed-precondition', 'Tournament not active.');
      if (m.status === 'completed') throw new functions.https.HttpsError('failed-precondition', 'Match already completed.');
      if (m.player1 !== uid && m.player2 !== uid) {
        throw new functions.https.HttpsError('permission-denied', 'Only match participants record proof.');
      }
    }

    const chunk = {
      idx: Math.floor(idx),
      url: String(url).slice(0, 500),
      key: String(key).slice(0, 200),
      t: Number(chunkTs) || Date.now(),
      durationMs: Math.max(0, Math.floor(durationMs || 0)),
    };

    // First chunk for this uid sets startedAt; every chunk updates lastChunkAt.
    const existing = m.proofFeed?.[uid] || null;
    await mRef.set({
      proofFeed: {
        [uid]: {
          startedAt: existing?.startedAt || FieldValue.serverTimestamp(),
          lastChunkAt: FieldValue.serverTimestamp(),
          chunks: FieldValue.arrayUnion(chunk),
        },
      },
    }, { merge: true });

    return { ok: true, idx: chunk.idx };
  }
);
