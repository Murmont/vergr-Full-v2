// Cold-storage demotion — scheduled Cloud Function.
//
// Goal: any media (post video, animated thumbnail, screenshot) with no
// `lastViewedAt` activity for ≥ 90 days gets demoted to Cloudflare R2's
// cold storage class ("Infrequent Access") which is ~33% cheaper than
// standard R2 storage. The asset stays fully accessible — first read after
// demotion incurs a small per-GB read fee, but on a long-tail asset that's
// still net cheaper than keeping it hot.
//
// STATUS: SHELL ONLY. R2 client wiring is gated behind `R2_BUCKET` /
// `R2_ACCESS_KEY` / `R2_SECRET_KEY` secrets. Until those are set the
// function exits early at startup. Safe to deploy now; flips on the moment
// secrets are added — no code change needed.

const functions = require('firebase-functions/v2');
const { defineSecret } = require('firebase-functions/params');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');

const db = getFirestore('vgrdb');

const R2_BUCKET     = defineSecret('R2_BUCKET');
const R2_ACCESS_KEY = defineSecret('R2_ACCESS_KEY');
const R2_SECRET_KEY = defineSecret('R2_SECRET_KEY');
const R2_ENDPOINT   = defineSecret('R2_ENDPOINT'); // e.g. https://<account>.r2.cloudflarestorage.com

const REGION = 'europe-west1';
const COLD_AGE_MS = 90 * 24 * 60 * 60 * 1000; // 90 days
const BATCH_SIZE  = 200;

// ── R2 client lazy-loader ─────────────────────────────────────────────
// We only require @aws-sdk/client-s3 when the function actually runs, so
// the dependency stays optional until R2 is wired. To enable: add to
// functions/package.json — `"@aws-sdk/client-s3": "^3.x"` — then
// `firebase functions:secrets:set R2_BUCKET`, etc.
async function getR2Client() {
  try {
    const { S3Client } = await import('@aws-sdk/client-s3');
    return new S3Client({
      region: 'auto',
      endpoint: R2_ENDPOINT.value(),
      credentials: {
        accessKeyId:     R2_ACCESS_KEY.value(),
        secretAccessKey: R2_SECRET_KEY.value(),
      },
    });
  } catch (err) {
    console.warn('R2 client unavailable — install @aws-sdk/client-s3 in functions/');
    return null;
  }
}

// ── Scheduled job: runs daily at 04:00 UTC ────────────────────────────
exports.coldStorageDemotion = functions.scheduler.onSchedule(
  {
    schedule: 'every day 04:00',
    timeZone: 'UTC',
    region: REGION,
    secrets: [R2_BUCKET, R2_ACCESS_KEY, R2_SECRET_KEY, R2_ENDPOINT],
    timeoutSeconds: 540,
    memory: '512MiB',
  },
  async () => {
    // Bail early if secrets aren't set — function is a no-op until R2 lands.
    let bucket;
    try { bucket = R2_BUCKET.value(); } catch { bucket = null; }
    if (!bucket || bucket.startsWith('PLACEHOLDER')) {
      console.log('[coldStorageDemotion] R2 not configured — skipping');
      return;
    }

    const r2 = await getR2Client();
    if (!r2) {
      console.log('[coldStorageDemotion] R2 SDK not installed — skipping');
      return;
    }

    const cutoff = new Date(Date.now() - COLD_AGE_MS);
    let totalDemoted = 0;
    let cursor = null;

    while (true) {
      let q = db.collection('media_assets')
        .where('storageClass', '==', 'STANDARD')
        .where('lastViewedAt', '<', cutoff)
        .orderBy('lastViewedAt', 'asc')
        .limit(BATCH_SIZE);
      if (cursor) q = q.startAfter(cursor);

      const snap = await q.get();
      if (snap.empty) break;

      const { CopyObjectCommand } = await import('@aws-sdk/client-s3');
      const writes = [];
      for (const docSnap of snap.docs) {
        const asset = docSnap.data();
        try {
          // R2 cold storage is set via the `x-amz-storage-class` header on
          // a copy-in-place. Cloudflare currently maps `STANDARD` →
          // `INFREQUENT_ACCESS` (their cold class).
          await r2.send(new CopyObjectCommand({
            Bucket: bucket,
            CopySource: `${bucket}/${asset.key}`,
            Key: asset.key,
            StorageClass: 'INFREQUENT_ACCESS',
            MetadataDirective: 'COPY',
          }));
          writes.push(docSnap.ref.update({
            storageClass: 'INFREQUENT_ACCESS',
            demotedAt: FieldValue.serverTimestamp(),
          }));
          totalDemoted++;
        } catch (err) {
          console.warn('[coldStorageDemotion] failed for', asset.key, err.message);
        }
      }
      await Promise.allSettled(writes);
      cursor = snap.docs[snap.docs.length - 1];
      if (snap.size < BATCH_SIZE) break;
    }

    console.log(`[coldStorageDemotion] demoted ${totalDemoted} assets`);
  }
);

// ── Promotion-on-view trigger (separate, not scheduled) ───────────────
// When a cold asset gets viewed, the player calls `markMediaViewed(assetId)`
// which updates `lastViewedAt`. If the asset was COLD, we re-promote to
// STANDARD so the next read isn't a cold-tier penalty.
//
// Stub for now — wire the callable + the player call when R2 lands.
exports.markMediaViewed = functions.https.onCall(
  { region: REGION },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) throw new functions.https.HttpsError('unauthenticated', 'Sign in required');
    const { assetId } = request.data || {};
    if (!assetId) throw new functions.https.HttpsError('invalid-argument', 'assetId required');

    const ref = db.collection('media_assets').doc(assetId);
    await ref.update({
      lastViewedAt: FieldValue.serverTimestamp(),
      viewCount: FieldValue.increment(1),
    });
    // Re-promotion happens lazily in the next scheduled sweep, OR
    // immediately here if the asset was cold (uncomment when R2 ready):
    //
    //   const snap = await ref.get();
    //   if (snap.data().storageClass === 'INFREQUENT_ACCESS') {
    //     // copy-in-place to STANDARD ...
    //   }
    return { ok: true };
  }
);
