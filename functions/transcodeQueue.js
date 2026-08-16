// Enqueue adaptive-video transcode jobs.
//
// A post with video lands here; a job goes in `transcode_jobs`; the worker boxes
// (infra/transcode/worker.js) claim and encode it.
//
// ── SAFETY ───────────────────────────────────────────────────────────
//
// This trigger writes ONE document to a collection nothing else reads. It never
// touches the post, the media, or any user data. If it throws, the post is
// already created and unaffected; if it never runs, adaptive video simply does
// not exist for that post and the original plays, which is the behaviour today.
//
// It is therefore impossible for this file to break posting or playback.

const functions = require('firebase-functions/v2');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');

const REGION = 'europe-west1';
const DB = 'vgrdb';
const db = getFirestore(DB);

/** Extensions worth transcoding. WebM from MediaRecorder and MP4 from uploads. */
const VIDEO_RE = /\.(mp4|webm|mov|m4v)(\?|#|$)/i;

/**
 * Only post types that actually carry a video. A photo post enqueuing a job
 * would waste a worker slot discovering it has no video stream.
 */
const VIDEO_POST_TYPES = new Set(['clip', 'short', 'video']);

exports.enqueueVideoTranscode = functions.firestore.onDocumentCreated(
  { document: 'posts/{postId}', region: REGION, database: DB },
  async (event) => {
    try {
      const post = event.data?.data();
      if (!post) return;

      const postId = event.params.postId;
      const urls = Array.isArray(post.mediaUrls) ? post.mediaUrls : [];

      // Type OR extension: `type` is the intent, the extension is the fact, and
      // a post can carry video without being typed as one.
      const videoUrl = urls.find((u) => typeof u === 'string' && VIDEO_RE.test(u));
      if (!videoUrl && !VIDEO_POST_TYPES.has(post.type)) return;
      if (!videoUrl) return;

      // A live-stream replay or an already-adaptive URL is not ours to re-encode.
      if (videoUrl.includes('/adaptive/')) return;
      // HLS is already adaptive by construction.
      if (/\.m3u8(\?|#|$)/i.test(videoUrl)) return;

      // Fragment-trimmed clips (`#t=start,end`) point at a VOD the user never
      // uploaded. Encoding those would duplicate an entire broadcast per clip.
      if (videoUrl.includes('#t=')) return;

      await db.collection('transcode_jobs').doc(postId).set({
        postId,
        sourceUrl: videoUrl,
        // Where the worker stamps `adaptiveRenditions` when it finishes. Passed
        // explicitly so the worker never has to guess a collection path.
        targetPath: `posts/${postId}`,
        ownerUid: post.userId || post.authorId || null,
        status: 'queued',
        attempts: 0,
        createdAt: FieldValue.serverTimestamp(),
        // Sorted on by the worker's claim query; a server timestamp is null for
        // a moment on the client's read, so a plain number is used for ordering.
        createdAtMs: Date.now(),
      }, { merge: false });

      functions.logger.info('transcode job queued', { postId });
    } catch (e) {
      // Never throw: a failed enqueue must not retry-loop a post trigger.
      functions.logger.warn('enqueueVideoTranscode failed', { message: e?.message });
    }
  },
);
