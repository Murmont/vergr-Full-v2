const functions = require('firebase-functions/v2');
const { S3Client, PutObjectCommand, CopyObjectCommand, DeleteObjectCommand, PutBucketCorsCommand, GetBucketCorsCommand, ListBucketsCommand, HeadBucketCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const { getFirestore } = require('firebase-admin/firestore');
const crypto = require('crypto');

const REGION = 'auto';

// Size caps per plan (bytes). Mirrors src/utils/mediaCompression.js → TIER_MAX_BYTES.
// Sized for gaming content: free=5-min 720p clip, lite=15-min 1080p, pro=full-match VOD.
const SIZE_CAPS = {
  free: 200 * 1024 * 1024,
  lite: 1024 * 1024 * 1024,
  pro: 5 * 1024 * 1024 * 1024,
};

const ALLOWED_TYPES = [
  'image/jpeg', 'image/png', 'image/webp', 'image/gif',
  'video/mp4', 'video/webm', 'video/quicktime',
  'audio/mpeg', 'audio/ogg', 'audio/wav', 'audio/webm',
];

// 'announcement' covers channel-message media and channel avatars. Admin-only in
// practice (the callables that reference it are admin-guarded), but the kind is
// listed here because getR2UploadUrl validates against this list.
const ALLOWED_KINDS = ['avatar', 'banner', 'post', 'short', 'clip', 'article', 'squad', 'announcement', 'tournament', 'tournament-proof', 'ambiance', 'chat', 'comment'];

// ⚠ 'chat' and 'comment' added 2026-09-06. Until then `uploadMediaFile()` in
// mediaHelpers.js carried a NO-OP ternary (`folder.startsWith('post') ? 'post'
// : 'post'`), so every DM photo, video and voice note was written to
// `post/<uid>/...`, INDISTINGUISHABLE from real feed media. That is why the
// nightly chat-media expiry sweep could never be repointed at R2: an age-based
// delete over `post/` would have taken users' actual posts with it.
//
// ⚠ EXISTING chat media stays at `post/...` and is NEVER swept. Message docs
// store the absolute URL, so re-keying old objects would break every DM that
// already contains one. Only NEW uploads land under `chat/` and `comment/`.

// ⚠ 'ambiance' (profile ambiance audio, docs/effects/09) has its OWN cap, not
// the plan cap (free 200MB / lite 1GB / pro 5GB, sized for gaming VODs).
//
// ⚠ THE REASON IS NOT VERGR'S BANDWIDTH BILL, and an earlier version of this
// comment said it was. R2 serves cdn.vergr.app at $0 EGRESS, so however many
// visitors fetch this file, Vergr pays nothing to send it. The real reasons:
//
//   1. It AUTOPLAYS. A 5GB clip is only fetched when a viewer presses play; this
//      starts on its own the moment someone opens the profile. The cost lands on
//      the VISITOR's mobile data and battery, and they never chose to spend it.
//   2. Time to first sound. A loop that has to buffer is not ambiance.
//   3. R2 STORAGE, not egress, is the metered resource (10GB free tier).
//
// 2MB is generous for a 30s loop: 30s of 128kbps MP3 is roughly 480KB.
const AMBIANCE_MAX_BYTES = 2 * 1024 * 1024;
// An animated banner renders in a ~1049x220 strip. 6MB is generous for the 8s,
// 480px-short-side, ~1.2Mbps clip the client produces, and still small enough
// that a profile visit does not cost a video-sized download.
const BANNER_VIDEO_MAX_BYTES = 6 * 1024 * 1024;

// Trim every secret value — they were stored with trailing newlines (likely
// set via `echo "x" | firebase functions:secrets:set` which appends \n).
// That newline broke the AWS SDK ("Invalid character in header content") and
// the bucket-name in the URL ("/vergr-media%0A/..."). Defending here instead
// of forcing a secret rotation.
const env = (name) => (process.env[name] || '').replace(/[\s\r\n]+$/g, '').trim();

function getClient() {
  const accountId = env('R2_ACCOUNT_ID');
  const accessKeyId = env('R2_ACCESS_KEY_ID');
  const secretAccessKey = env('R2_SECRET_ACCESS_KEY');
  return new S3Client({
    region: REGION,
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId, secretAccessKey },
    // AWS SDK v3 (≥3.730) auto-injects an x-amz-sdk-checksum-algorithm=CRC32
    // header/query param on PutObject. Cloudflare R2's CORS implementation
    // doesn't match the wildcard AllowedHeaders against that header, so
    // browser preflights fail with "No Access-Control-Allow-Origin header
    // is present". Setting these two options to WHEN_REQUIRED stops the SDK
    // from sending the checksum on requests that don't actually need it
    // (PutObject doesn't), so the signed URL stays plain and R2's CORS is
    // happy. https://github.com/aws/aws-sdk-js-v3/issues/6810
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
  });
}

function getBucket() { return env('R2_BUCKET') || 'vergr-media'; }
function getPublicBase() { return (env('R2_PUBLIC_BASE') || 'https://cdn.vergr.app').replace(/\/$/, ''); }

exports.getR2UploadUrl = functions.https.onCall({
  secrets: ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET', 'R2_PUBLIC_BASE'],
  region: 'europe-west1',
}, async (req) => {
  if (!req.auth) throw new functions.https.HttpsError('unauthenticated', 'Sign in required.');

  // Emergency kill switch — flip to true in app_config/general to halt all
  // free-tier uploads in 5 seconds without redeploying. Paid tiers bypass.
  const cfgSnap = await getFirestore('vgrdb').collection('app_config').doc('general').get();
  const cfg = cfgSnap.exists ? cfgSnap.data() : {};

  const { contentType, sizeBytes, kind } = req.data;

  if (!ALLOWED_TYPES.includes(contentType)) {
    throw new functions.https.HttpsError('invalid-argument', `Content type ${contentType} not allowed.`);
  }
  if (!ALLOWED_KINDS.includes(kind)) {
    throw new functions.https.HttpsError('invalid-argument', `Kind ${kind} not allowed.`);
  }
  if (!sizeBytes || sizeBytes <= 0) {
    throw new functions.https.HttpsError('invalid-argument', 'sizeBytes required.');
  }

  // Get user plan. Admins (founder/ops) bypass every paywall → treated as 'pro'.
  const db = getFirestore('vgrdb');
  const userDoc = await db.collection('users').doc(req.auth.uid).get();
  const _ud = userDoc.exists ? userDoc.data() : {};
  const isAdmin = _ud.role === 'admin' || (_ud.email || '').toLowerCase() === 'vergenerd@gmail.com';
  const plan = isAdmin ? 'pro' : (userDoc.exists ? (userDoc.data().subscription || 'free') : 'free');
  // ⚠ AN ANIMATED BANNER IS NOT A GAMING VOD, and must not inherit the plan cap.
  // `banner` fell under SIZE_CAPS, so a free user could have pushed a 200MB file
  // that then loads on EVERY visit to their profile. Founder, 2026-08-27:
  // "videos need to be compressed or it will slow the page down and probably
  // cost me money in the form of storage."
  //
  // The client compresses to far below this (8s, 480px short side, ~1.2Mbps,
  // see uploadBanner). This is the BACKSTOP for anything that bypasses it.
  const isBannerVideo = kind === 'banner' && String(contentType || '').startsWith('video/');
  const cap = kind === 'ambiance' ? AMBIANCE_MAX_BYTES
    : isBannerVideo ? BANNER_VIDEO_MAX_BYTES
    : (SIZE_CAPS[plan] || SIZE_CAPS.free);

  // Kill switch enforcement (free tier only — paid users always pass).
  if (plan === 'free' && cfg.freeUploadsPaused === true) {
    throw new functions.https.HttpsError('failed-precondition', 'Free uploads are temporarily paused. Please try again later.');
  }

  // Audio only, for an audio-only kind. Without this an image could be stored
  // under a key the public profile later hands to an <audio> element.
  if (kind === 'ambiance' && !contentType.startsWith('audio/')) {
    throw new functions.https.HttpsError('invalid-argument', 'Profile ambiance must be an audio file.');
  }
  if (sizeBytes > cap) {
    const capMB = Math.round(cap / 1024 / 1024);
    // ⚠ Say WHICH limit. The ambiance and banner-video caps are per-KIND, not
    // per plan, so "your free plan limit" would send someone to the upgrade page
    // to fix something upgrading cannot fix.
    const why = kind === 'ambiance' ? `Profile music is limited to ${capMB}MB.`
      : isBannerVideo ? `An animated banner is limited to ${capMB}MB.`
      : `File exceeds your ${plan} plan limit of ${capMB}MB.`;
    throw new functions.https.HttpsError('resource-exhausted', why);
  }

  const ext = contentType.split('/')[1].replace('quicktime', 'mov').replace('mpeg', 'mp3');
  const key = `${kind}/${req.auth.uid}/${Date.now()}_${crypto.randomBytes(6).toString('hex')}.${ext}`;

  // B9: every object key is content-unique (timestamp + random), so the object
  // at a given URL never changes. Mark it immutable + 1-year max-age so the CDN
  // and device HTTP cache keep it forever and avatars/thumbnails fetch once.
  // This becomes a signed header, so the client PUT MUST send the same value
  // (r2Storage.js mirrors it) or the signature won't match.
  const cacheControl = 'public, max-age=31536000, immutable';

  const client = getClient();
  const command = new PutObjectCommand({
    Bucket: getBucket(),
    Key: key,
    ContentType: contentType,
    ContentLength: sizeBytes,
    CacheControl: cacheControl,
  });

  const uploadUrl = await getSignedUrl(client, command, { expiresIn: 300 });
  const publicUrl = `${getPublicBase()}/${key}`;

  return { uploadUrl, publicUrl, key, cacheControl };
});

// Presign a WhatsApp "Export chat" .txt into the import STAGING prefix
// (imports/whatsapp/<uid>/). Deliberately separate from getR2UploadUrl: the
// media kind/type matrix doesn't apply (text file, fixed 30MB cap — WhatsApp
// caps text exports at ~40k messages so real files are single-digit MB), and
// the key prefix is what importWhatsAppExport + the box worker validate.
exports.getImportUploadUrl = functions.https.onCall({
  secrets: ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET', 'R2_PUBLIC_BASE'],
  region: 'europe-west1',
}, async (req) => {
  if (!req.auth) throw new functions.https.HttpsError('unauthenticated', 'Sign in required.');
  const sizeBytes = Number(req.data?.sizeBytes) || 0;
  if (sizeBytes <= 0 || sizeBytes > 30 * 1024 * 1024) {
    throw new functions.https.HttpsError('invalid-argument', 'Export file must be under 30MB (export "Without media").');
  }
  const key = `imports/whatsapp/${req.auth.uid}/${Date.now()}_${crypto.randomBytes(6).toString('hex')}.txt`;
  const client = getClient();
  const command = new PutObjectCommand({
    Bucket: getBucket(),
    Key: key,
    ContentType: 'text/plain',
    ContentLength: sizeBytes,
  });
  const uploadUrl = await getSignedUrl(client, command, { expiresIn: 300 });
  return { uploadUrl, key };
});

// Admin-only diagnostic. Reports everything we need to root-cause R2 upload
// failures: what bucket name the function thinks it's using, what buckets the
// token can actually see, whether the bucket exists, what CORS R2 reports on
// the bucket right now (NOT what the Cloudflare dashboard claims), and a
// fresh presigned URL so we can inspect it. Then tries to WRITE a correct
// CORS policy — that may 403 if the token is Object-scoped but we report
// the exact error either way.
exports.setR2CorsPolicy = functions.https.onCall({
  secrets: ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET', 'R2_PUBLIC_BASE'],
  region: 'europe-west1',
}, async (req) => {
  if (!req.auth) throw new functions.https.HttpsError('unauthenticated', 'Sign in required.');
  const db = getFirestore('vgrdb');
  const userDoc = await db.collection('users').doc(req.auth.uid).get();
  if (!userDoc.exists || userDoc.data().role !== 'admin') {
    throw new functions.https.HttpsError('permission-denied', 'Admin only.');
  }

  const report = {
    configuredBucket: getBucket(),
    accountId: env('R2_ACCOUNT_ID'),
    publicBase: getPublicBase(),
    endpoint: `https://${env('R2_ACCOUNT_ID')}.r2.cloudflarestorage.com`,
  };
  const client = getClient();

  // 1. Can we even reach R2? List the buckets the token can see.
  try {
    const list = await client.send(new ListBucketsCommand({}));
    report.visibleBuckets = (list.Buckets || []).map(b => b.Name);
  } catch (e) {
    report.listBucketsError = `${e.name}: ${e.message}`;
  }

  // 2. Does the bucket we're targeting actually exist?
  try {
    await client.send(new HeadBucketCommand({ Bucket: getBucket() }));
    report.bucketExists = true;
  } catch (e) {
    report.bucketExists = false;
    report.headBucketError = `${e.name}: ${e.message}`;
  }

  // 3. What does R2 say the current CORS rules ARE? This is the ground truth.
  try {
    const got = await client.send(new GetBucketCorsCommand({ Bucket: getBucket() }));
    report.currentCorsRules = got.CORSRules;
  } catch (e) {
    report.currentCorsError = `${e.name}: ${e.message}`;
  }

  // 4. Try to write the correct CORS. If token is Object-only this 403s.
  const desiredCors = {
    CORSRules: [{
      AllowedOrigins: [
        'https://vergr.app', 'https://www.vergr.app',
        'https://vergr-44494.web.app', 'https://vergr-44494.firebaseapp.com',
        'http://localhost:5173', 'http://localhost:5174',
        // NATIVE SHELL. Uploads go direct to R2 from the WebView via a
        // presigned PUT, and the Android WebView's origin is
        // http://tauri.localhost (Tauri serves custom protocols over http on
        // Android + Windows, https elsewhere). Without these, EVERY native
        // upload — voice notes, video messages, photos — dies with
        // "Failed to fetch" and reads to the user as a broken feature.
        'http://tauri.localhost', 'https://tauri.localhost',
        'http://asset.localhost', 'https://asset.localhost',
      ],
      AllowedMethods: ['GET', 'PUT', 'HEAD', 'POST', 'DELETE'],
      AllowedHeaders: ['*'],
      ExposeHeaders: ['ETag'],
      MaxAgeSeconds: 3600,
    }],
  };
  try {
    await client.send(new PutBucketCorsCommand({
      Bucket: getBucket(),
      CORSConfiguration: desiredCors,
    }));
    report.putCorsSucceeded = true;
    // Read it back.
    try {
      const got = await client.send(new GetBucketCorsCommand({ Bucket: getBucket() }));
      report.corsAfterWrite = got.CORSRules;
    } catch (e) { report.corsAfterWriteError = `${e.name}: ${e.message}`; }
  } catch (e) {
    report.putCorsSucceeded = false;
    report.putCorsError = `${e.name}: ${e.message} (Code=${e.Code || e.$metadata?.httpStatusCode})`;
  }

  // 5. Generate a fresh presigned URL exactly like the upload path would, so
  // the caller can see the URL shape and signed-headers list.
  try {
    const command = new PutObjectCommand({
      Bucket: getBucket(),
      Key: `_diagnostic/${Date.now()}.png`,
      ContentType: 'image/png',
      ContentLength: 1024,
    });
    const url = await getSignedUrl(client, command, { expiresIn: 60 });
    report.samplePresignedUrl = url;
    try {
      const u = new URL(url);
      report.samplePresignedHost = u.host;
      report.samplePresignedPath = u.pathname;
      report.samplePresignedSignedHeaders = u.searchParams.get('X-Amz-SignedHeaders');
    } catch {}
  } catch (e) {
    report.presignError = `${e.name}: ${e.message}`;
  }

  return report;
});

// Scheduled weekly — engagement-aware tiering. DORMANT (totalPosts=0 < 5000).
//
// ⚠⚠ DO NOT ARM THIS, AND DO NOT RE-CREATE THE BUCKET LIFECYCLE RULE.
// The comment that used to sit here said the "R2 bucket lifecycle rule (90-day
// IA transition) handles cold-tiering by itself", as though that were a saving.
// It was the opposite. On 2026-08-12 that rule moved the oldest 38 objects
// (32 MB) into Infrequent Access and produced the first Cloudflare bill this
// project ever got: $9.92. The rule was DISABLED on 2026-09-06 and the objects
// were copied back to STANDARD. Measured facts:
//
//   * Infrequent Access has NO free tier. Standard's 10 GB / 1M Class A /
//     10M Class B allowance does not apply to it at all.
//   * Every IA line item rounds UP to a whole billing unit, so 38 transitions
//     were billed as a full million operations at $9.00.
//   * Cost therefore scales with OBJECT COUNT, not bytes. An 11 KB avatar
//     costs exactly the same transition as a 5 GB video. 13 of those 38 were
//     2 MB OTA bundles; 5 were avatars under 60 KB.
//   * Break-even against Standard is ~1.8 TB stored. The bucket is 0.74 GB.
//
// If cold tiering is ever wanted it belongs HERE and not in a lifecycle rule,
// because a lifecycle rule filters on PREFIX ONLY and the keys are
// `post/<uid>/...`, which cannot express a plan. Founder's stated intent
// (2026-09-06) is that cold storage apply to PAYING PRO USERS ONLY. This
// function has NO tier filter today, so arming it as written repeats the bug.
// Any future version needs BOTH a Pro-tier check AND a minimum object size,
// since IA only ever pays for few-and-large objects.
exports.coldStorageDemotion = functions.scheduler.onSchedule({
  schedule: '0 3 * * 0', // Sunday 03:00 UTC
  region: 'europe-west1',
  secrets: ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET'],
}, async () => {
  const ACTIVATION_THRESHOLD = 5000;

  const db = getFirestore('vgrdb');
  const cfgSnap = await db.collection('app_config').doc('general').get();
  const cfg = cfgSnap.exists ? cfgSnap.data() : {};

  // Manual override: admin can force-enable from app_config/general.tieringEnabled.
  const force = cfg.tieringEnabled === true;
  const totalPosts = cfg.totalPosts || 0;

  if (!force && totalPosts < ACTIVATION_THRESHOLD) {
    console.log(`coldStorageDemotion: dormant (totalPosts=${totalPosts} < ${ACTIVATION_THRESHOLD}). R2 lifecycle handles cold-tiering.`);
    return;
  }

  const ninetyDaysAgo = Date.now() - 90 * 24 * 3600 * 1000;
  const stale = await db.collection('posts')
    .where('lastViewedAt', '<', ninetyDaysAgo)
    .where('storageTier', '!=', 'cold')
    .limit(500)
    .get();

  if (stale.empty) { console.log('coldStorageDemotion: nothing to demote.'); return; }

  const client = getClient();
  const bucket = getBucket();
  let demoted = 0;

  for (const docSnap of stale.docs) {
    const data = docSnap.data();
    const key = data.mediaKey; // r2 object key, set on upload
    if (!key) continue;
    try {
      // R2 copy-in-place with new storage class.
      await client.send(new CopyObjectCommand({
        Bucket: bucket,
        CopySource: `${bucket}/${key}`,
        Key: key,
        StorageClass: 'STANDARD_IA',
        MetadataDirective: 'COPY',
      }));
      await docSnap.ref.update({ storageTier: 'cold', tieredAt: Date.now() });
      demoted++;
    } catch (e) {
      console.warn('demote failed', key, e.message);
    }
  }
  console.log(`coldStorageDemotion: demoted ${demoted}/${stale.size} posts to IA.`);
});
