// requestStreamClip — engine-independent server-side stream clipping.
//
// The client-side path (useStreamClipBuffer + MediaRecorder) only works on
// Chromium-class webviews; on Apple webviews (macOS/iOS = WebKit) the
// cross-origin <video> taints captureStream. This callable lets ANY device cut
// a clip: it validates auth + tier quota, then asks the Hetzner vod-archive box
// to ffmpeg-cut the last N seconds from the live HLS into an mp4 on R2, and
// returns the URL. The client then creates the (user-chosen) clip post.
//
// Tier gates mirror the client path: Free 30s/3, Lite 60s/5, Pro 90s/unlimited
// per stream session, counted in stream_clip_quota/{streamId}_{uid}.

const functions = require('firebase-functions/v2');
const { defineSecret } = require('firebase-functions/params');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');

const REGION = 'europe-west1';
const db = getFirestore('vgrdb');
const HOST_OPS_TOKEN = defineSecret('HOST_OPS_TOKEN');
const VOD_LAUNCHER_BASE = process.env.VOD_LAUNCHER_BASE || 'https://archive.vergr.app';
const CDN_BASE = process.env.R2_PUBLIC_BASE || 'https://cdn.vergr.app';

const CLIP_TIER = {
  free: { sec: 30, max: 3 },
  lite: { sec: 60, max: 5 },
  pro:  { sec: 90, max: Infinity },
};

exports.requestStreamClip = functions.https.onCall(
  { region: REGION, secrets: [HOST_OPS_TOKEN] },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) throw new functions.https.HttpsError('unauthenticated', 'Sign in required.');

    const { streamId, durationSec } = request.data || {};
    if (!streamId) throw new functions.https.HttpsError('invalid-argument', 'streamId required');

    const sSnap = await db.collection('streams').doc(streamId).get();
    if (!sSnap.exists) throw new functions.https.HttpsError('not-found', 'Stream not found');
    const s = sSnap.data();

    // Viewer tier → duration cap + per-stream count cap.
    const uSnap = await db.collection('users').doc(uid).get();
    const sub = uSnap.data()?.subscription;
    const t = typeof sub === 'string' ? sub : sub?.tier;
    const tier = t === 'pro' || t === 'lite' ? t : 'free';
    const cfg = CLIP_TIER[tier];
    const want = Math.min(Math.max(Number(durationSec) || cfg.sec, 5), cfg.sec);

    // Atomic per-stream quota.
    const qRef = db.collection('stream_clip_quota').doc(`${streamId}_${uid}`);
    await db.runTransaction(async (tx) => {
      const q = await tx.get(qRef);
      const used = q.exists ? (q.data().count || 0) : 0;
      if (used >= cfg.max) {
        throw new functions.https.HttpsError('resource-exhausted',
          `Clip limit reached (${cfg.max} per stream on ${tier}).`);
      }
      tx.set(qRef, { count: used + 1, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    });

    const sourceHls = s.compositeHlsUrl || s.hlsUrl
      || (s.streamKey ? `${CDN_BASE}/streams/${s.streamKey}/index.m3u8` : null);
    if (!sourceHls) throw new functions.https.HttpsError('failed-precondition', 'Stream has no playable source');

    const targetKey = `clips/${uid}-${Date.now()}.mp4`;
    let result;
    try {
      const res = await fetch(`${VOD_LAUNCHER_BASE}/clip`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${HOST_OPS_TOKEN.value()}` },
        body: JSON.stringify({ sourceHls, durationSec: want, targetKey }),
      });
      result = await res.json();
      if (!res.ok) throw new Error(result?.error || `clipper ${res.status}`);
    } catch (err) {
      // Refund the quota slot on failure so a transient error doesn't burn a clip.
      await qRef.set({ count: FieldValue.increment(-1) }, { merge: true }).catch(() => {});
      throw new functions.https.HttpsError('internal', String(err.message || err).slice(0, 200));
    }

    return { clipUrl: result.url, durationSec: want };
  },
);
