// HLS rendition ladder for uploaded shorts and clips.
//
// THE PROBLEM. An uploaded video is one file at one bitrate, so every viewer
// gets the same thing regardless of their connection. Someone on a weak network
// has nothing smaller to fall back to and simply waits — which is the loading
// spinner a short-form feed can never afford, because the whole interaction is
// "flick, watch, flick".
//
// THE SHAPE. Same pattern as the VOD archive, which is why it reuses that
// service rather than standing up another one:
//   1. A short/clip post is created with a CDN video URL.
//   2. This trigger POSTs the box (archive.vergr.app) with the source URL.
//   3. ffmpeg produces 720/480/360 renditions + a master playlist onto R2.
//   4. The box calls back `markLadderReady`, which stamps posts/{id}.hlsUrl.
//   5. ShortsDeck sees hlsUrl and plays through hls.js, which picks the
//      rendition from the measured connection.
//
// The ORIGINAL file is kept and remains the fallback: a post is playable the
// instant it is created, and the ladder is an upgrade that lands a minute later.
// Nothing depends on the ladder existing.

const functions = require('firebase-functions/v2');
const { onDocumentCreated } = require('firebase-functions/v2/firestore');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const { defineSecret } = require('firebase-functions/params');

const REGION = 'europe-west1';
const db = getFirestore('vgrdb');

const HOST_OPS_TOKEN = defineSecret('HOST_OPS_TOKEN');
const LADDER_BASE = process.env.VOD_LAUNCHER_BASE || 'https://archive.vergr.app';

// Only the formats that are actually watched in a swipe feed. Chat video is
// deliberately excluded: it is watched once by one person, so three renditions
// would be pure cost.
const LADDER_TYPES = new Set(['short', 'clip']);

// Our own CDN only. The source has to be something the box can fetch, and
// pointing ffmpeg at an arbitrary URL from a user document is an SSRF hole.
const ALLOWED_SOURCE = /^https:\/\/cdn\.vergr\.app\//;

function sourceUrlFor(post) {
  const candidates = [post.videoUrl, ...(Array.isArray(post.mediaUrls) ? post.mediaUrls : [])];
  for (const u of candidates) {
    if (typeof u === 'string' && ALLOWED_SOURCE.test(u) && /\.(mp4|webm|mov)(\?|#|$)/i.test(u)) {
      return u.split('#')[0];
    }
  }
  return null;
}

exports.dispatchVideoLadder = onDocumentCreated(
  { region: REGION, document: 'posts/{postId}', database: 'vgrdb', secrets: [HOST_OPS_TOKEN] },
  async (event) => {
    const post = event.data?.data();
    if (!post) return;
    if (!LADDER_TYPES.has(post.type)) return;

    const source = sourceUrlFor(post);
    if (!source) return;

    // Kill switch + a cheap way to turn this off if the box is ever busy.
    try {
      const cfg = await db.doc('app_config/general').get();
      if (cfg.exists && cfg.data().videoLadderEnabled === false) return;
    } catch { /* a config read failure must not block the pipeline */ }

    const postId = event.params.postId;

    // Mark first so a retry cannot dispatch twice.
    await event.data.ref.update({ ladderDispatchedAt: FieldValue.serverTimestamp() });

    try {
      const res = await fetch(`${LADDER_BASE}/ladder`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${HOST_OPS_TOKEN.value()}`,
        },
        body: JSON.stringify({
          sourceUrl: source,
          postId,
          callbackUrl: `https://${REGION}-${process.env.GCLOUD_PROJECT}.cloudfunctions.net/markLadderReady`,
        }),
      });
      if (!res.ok) throw new Error(`launcher returned ${res.status}`);
    } catch (err) {
      console.error('ladder dispatch failed', postId, err);
      // Clear the flag so it can be retried; the post plays from its original
      // file meanwhile, so this failing is a missed optimisation, not an outage.
      await event.data.ref.update({
        ladderDispatchedAt: null,
        ladderError: String(err.message || err).slice(0, 200),
      });
    }
  },
);

// Called by the box when the renditions are on R2.
exports.markLadderReady = functions.https.onRequest(
  { region: REGION, secrets: [HOST_OPS_TOKEN] },
  async (req, res) => {
    const auth = req.get('authorization') || '';
    if (auth !== `Bearer ${HOST_OPS_TOKEN.value()}`) {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }
    const { postId, hlsUrl, rungs } = req.body || {};
    if (!postId || !hlsUrl) {
      res.status(400).json({ error: 'postId and hlsUrl required' });
      return;
    }
    // The URL is built by the box from its own R2 base, but this endpoint is
    // reachable from the internet, so it gets validated like any other input.
    if (!/^https:\/\/cdn\.vergr\.app\/ladders\/[A-Za-z0-9_-]{1,64}\/master\.m3u8$/.test(hlsUrl)) {
      res.status(400).json({ error: 'bad hlsUrl' });
      return;
    }
    try {
      await db.doc(`posts/${postId}`).update({
        hlsUrl,
        ladderRungs: Array.isArray(rungs) ? rungs.slice(0, 6) : FieldValue.delete(),
        ladderReadyAt: FieldValue.serverTimestamp(),
      });
      res.json({ ok: true });
    } catch (err) {
      console.error('markLadderReady failed', postId, err);
      res.status(500).json({ error: 'update_failed' });
    }
  },
);
