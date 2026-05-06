const functions = require('firebase-functions/v2');
const { S3Client, PutObjectCommand, CopyObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
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

const ALLOWED_KINDS = ['avatar', 'banner', 'post', 'short', 'clip', 'article', 'squad', 'tournament'];

function getClient() {
  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  return new S3Client({
    region: REGION,
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId, secretAccessKey },
  });
}

function getBucket() { return process.env.R2_BUCKET || 'vergr-media'; }
function getPublicBase() { return (process.env.R2_PUBLIC_BASE || 'https://cdn.vergr.app').replace(/\/$/, ''); }

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

  // Get user plan
  const db = getFirestore('vgrdb');
  const userDoc = await db.collection('users').doc(req.auth.uid).get();
  const plan = userDoc.exists ? (userDoc.data().subscription || 'free') : 'free';
  const cap = SIZE_CAPS[plan] || SIZE_CAPS.free;

  // Kill switch enforcement (free tier only — paid users always pass).
  if (plan === 'free' && cfg.freeUploadsPaused === true) {
    throw new functions.https.HttpsError('failed-precondition', 'Free uploads are temporarily paused. Please try again later.');
  }

  if (sizeBytes > cap) {
    const capMB = Math.round(cap / 1024 / 1024);
    throw new functions.https.HttpsError('resource-exhausted', `File exceeds your ${plan} plan limit of ${capMB}MB.`);
  }

  const ext = contentType.split('/')[1].replace('quicktime', 'mov').replace('mpeg', 'mp3');
  const key = `${kind}/${req.auth.uid}/${Date.now()}_${crypto.randomBytes(6).toString('hex')}.${ext}`;

  const client = getClient();
  const command = new PutObjectCommand({
    Bucket: getBucket(),
    Key: key,
    ContentType: contentType,
    ContentLength: sizeBytes,
  });

  const uploadUrl = await getSignedUrl(client, command, { expiresIn: 300 });
  const publicUrl = `${getPublicBase()}/${key}`;

  return { uploadUrl, publicUrl, key };
});

// Scheduled weekly — engagement-aware tiering.
// DORMANT until the platform passes ACTIVATION_THRESHOLD posts. Below that, the
// R2 bucket lifecycle rule (90-day IA transition) handles cold-tiering by
// itself, and running this function would cost more in Firestore reads than it
// saves in storage. Once the platform scales, this function takes over to do
// engagement-driven tiering: posts viewed in the last 90 days stay hot, the
// rest go cold. Posts that suddenly start trending while cold get auto-promoted.
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
