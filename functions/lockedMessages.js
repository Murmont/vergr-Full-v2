/**
 * Locked media in a conversation: DMs, group chats and squad chats.
 *
 * M3 of docs/CREATOR_MONETIZATION_PLAN.md. `entitlements.js` already has the
 * `message` resolver and has had it since M0; what was missing was anything that
 * writes a price onto a message. This is that.
 *
 * ## Why this is not just `sendMessage` with a price field
 *
 * The same reason `lockedPosts.js` exists separately from `getR2UploadUrl`: an
 * ordinary chat attachment is uploaded to the public CDN prefix, so a "locked"
 * message whose bytes are already at a `cdn.vergr.app` URL is not locked, it is
 * merely undisplayed. Locked chat media goes to `locked/{uid}/`, which has no
 * public base, and the object key is filed in
 * `users/{uid}/private/lockedMessageFiles` where firestore.rules denies every
 * client. `getAccess` mints a five-minute signed GET after proving the caller
 * paid, and that is the only route back to the bytes.
 *
 * ## The sender must be in the room
 *
 * A message id is only unique within its chat, so an entitlement is keyed
 * `message_{chatId}:{messageId}_{buyer}`. That means the chat id arrives from the
 * client, and a caller who could name any chat could plant a priced message in a
 * conversation they are not part of. Membership is checked against the chat
 * document before anything is written.
 *
 * ## Scanning
 *
 * Plan section 3b, and this is the surface the policy was written for: ordinary
 * private conversation is not scanned and that does not change. This media is
 * scanned because it carries a PRICE, never because it is in a DM, and the
 * verdict policy is `scanPricedImage` (CSAM and NCII block, nudity passes) not
 * the public-feed one.
 */
const functions = require('firebase-functions/v2');
const { HttpsError } = require('firebase-functions/v2/https');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const { S3Client, PutObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const crypto = require('crypto');

const REGION = 'europe-west1';
const db = getFirestore('vgrdb');

const R2_SECRETS = ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET', 'R2_PUBLIC_BASE'];

/** Mirrors entitlements.js and lockedPosts.js. Same numbers, plan section 6.3. */
const MIN_PRICE_COINS = 50;
const MAX_PRICE_COINS = 10_000;

const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/webm'];
const SIZE_CAPS = { free: 200 * 1024 * 1024, lite: 1024 * 1024 * 1024, pro: 5 * 1024 * 1024 * 1024 };

const env = (name) => (process.env[name] || '').replace(/[\s\r\n]+$/g, '').trim();
const bucket = () => env('R2_BUCKET') || 'vergr-media';
const publicBase = () => env('R2_PUBLIC_BASE') || 'https://cdn.vergr.app';

function r2Client() {
  return new S3Client({
    region: 'auto',
    endpoint: `https://${env('R2_ACCOUNT_ID')}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: env('R2_ACCESS_KEY_ID'),
      secretAccessKey: env('R2_SECRET_ACCESS_KEY'),
    },
  });
}

function requireAuth(request) {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in required.');
  return uid;
}

async function planFor(uid) {
  const snap = await db.collection('users').doc(uid).get();
  const u = snap.exists ? snap.data() : {};
  const isAdmin = u.role === 'admin' || (u.email || '').toLowerCase() === 'vergenerd@gmail.com';
  if (isAdmin) return 'pro';
  const tier = u.subscription?.tier || u.subscription || 'free';
  return ['free', 'lite', 'pro'].includes(tier) ? tier : 'free';
}

/**
 * Is `uid` allowed to post in this chat.
 *
 * Chats carry `participants` (DMs and groups). Squad chats key off the squad's
 * member list instead, so both shapes are accepted rather than assuming one.
 */
async function assertChatMember(scope, chatId, uid) {
  if (scope === 'squad') {
    const sq = await db.collection('squads').doc(chatId).get();
    if (!sq.exists) throw new HttpsError('not-found', 'Squad not found.');
    const members = sq.data().memberIds || [];
    if (!members.includes(uid)) {
      throw new HttpsError('permission-denied', 'You are not in this squad.');
    }
    return sq.data();
  }

  const snap = await db.collection('conversations').doc(chatId).get();
  if (!snap.exists) throw new HttpsError('not-found', 'Conversation not found.');
  const c = snap.data() || {};

  const participants = Array.isArray(c.participants) ? c.participants
    : Array.isArray(c.memberIds) ? c.memberIds
      : [];
  if (participants.includes(uid)) return c;

  throw new HttpsError('permission-denied', 'You are not in this conversation.');
}

/** DMs and groups live in `conversations`; squad chat lives under the squad. */
const parseScope = (data) => (data?.scope === 'squad' ? 'squad' : 'conversation');

const chatDocRef = (scope, chatId) => (scope === 'squad'
  ? db.collection('squads').doc(chatId)
  : db.collection('conversations').doc(chatId));

/**
 * The globally-unique resource id an entitlement is keyed by, and the same
 * string `entitlements.js` parses back apart. The `squad:` prefix is explicit
 * rather than inferred from a part count, so a conversation id that happened to
 * contain a colon could never be resolved against the squads collection.
 */
const resourceIdFor = (scope, chatId, messageId) => (scope === 'squad'
  ? `squad:${chatId}:${messageId}`
  : `${chatId}:${messageId}`);

/**
 * Presign the locked object and its public blurred preview, same pair as
 * `getLockedUploadUrl` in lockedPosts.js.
 *
 * The preview is produced on the SENDER's device and uploaded as an ordinary
 * public object: they already hold the full-resolution bytes, so downscaling and
 * blurring locally gives the same guarantee (a recipient never receives full
 * bytes) with no image library in the functions bundle. A blur applied on the
 * RECIPIENT's device would be a CSS filter over bytes already downloaded, and is
 * forbidden here for the same reason it is forbidden for posts.
 */
exports.getLockedMessageUploadUrl = functions.https.onCall(
  { region: REGION, cors: true, secrets: R2_SECRETS },
  async (request) => {
    const uid = requireAuth(request);
    const chatId = String(request.data?.chatId || '');
    const contentType = String(request.data?.contentType || '');
    const sizeBytes = Math.floor(Number(request.data?.sizeBytes) || 0);

    if (!chatId) throw new HttpsError('invalid-argument', 'chatId required.');
    if (!ALLOWED_TYPES.includes(contentType)) {
      throw new HttpsError('invalid-argument', `Content type ${contentType} not allowed.`);
    }
    if (sizeBytes <= 0) throw new HttpsError('invalid-argument', 'sizeBytes required.');

    // Checked before handing out an upload URL, not just before the send, so a
    // stranger cannot use this to write objects into our bucket at all.
    await assertChatMember(parseScope(request.data), chatId, uid);

    const plan = await planFor(uid);
    const cap = SIZE_CAPS[plan];
    if (sizeBytes > cap) {
      throw new HttpsError(
        'resource-exhausted',
        `File exceeds your ${plan} plan limit of ${Math.round(cap / 1024 / 1024)}MB.`,
      );
    }

    const stamp = `${Date.now()}_${crypto.randomBytes(6).toString('hex')}`;
    const ext = contentType.split('/')[1];
    const mediaKey = `locked/${uid}/${stamp}.${ext}`;
    const previewKey = `lockedpreview/${uid}/${stamp}.jpg`;
    const cacheControl = 'public, max-age=31536000, immutable';
    const client = r2Client();

    const [mediaUploadUrl, previewUploadUrl] = await Promise.all([
      getSignedUrl(client, new PutObjectCommand({
        Bucket: bucket(), Key: mediaKey, ContentType: contentType,
        ContentLength: sizeBytes, CacheControl: cacheControl,
      }), { expiresIn: 300 }),
      getSignedUrl(client, new PutObjectCommand({
        Bucket: bucket(), Key: previewKey, ContentType: 'image/jpeg', CacheControl: cacheControl,
      }), { expiresIn: 300 }),
    ]);

    return {
      mediaUploadUrl,
      mediaKey,
      previewUploadUrl,
      previewUrl: `${publicBase()}/${previewKey}`,
      cacheControl,
    };
  },
);

/**
 * Write the priced message and file its private key.
 *
 * Both writes go in one batch for the same reason as a locked post: a message
 * without its key entry is unopenable even by its sender, and a key entry with
 * no message is an orphan nothing will clean up.
 */
exports.sendLockedMessage = functions.https.onCall(
  { region: REGION, cors: true, secrets: [...R2_SECRETS, 'GEMINI_POST_IMAGE_KEY'] },
  async (request) => {
    const uid = requireAuth(request);

    const chatId = String(request.data?.chatId || '');
    const mediaKey = String(request.data?.mediaKey || '');
    const previewUrl = String(request.data?.previewUrl || '');
    const caption = String(request.data?.caption || '').slice(0, 500);
    const priceCoins = Math.floor(Number(request.data?.priceCoins) || 0);
    const isVideo = request.data?.isVideo === true;
    const scope = parseScope(request.data);

    if (!chatId) throw new HttpsError('invalid-argument', 'chatId required.');
    if (priceCoins < MIN_PRICE_COINS || priceCoins > MAX_PRICE_COINS) {
      throw new HttpsError(
        'invalid-argument',
        `Price must be between ${MIN_PRICE_COINS} and ${MAX_PRICE_COINS} coins.`,
      );
    }
    // Without this a caller could name someone else's locked object and sell
    // access to content they do not own.
    if (!mediaKey.startsWith(`locked/${uid}/`)) {
      throw new HttpsError('permission-denied', 'That file is not yours.');
    }
    if (previewUrl && !previewUrl.startsWith(`${publicBase()}/lockedpreview/${uid}/`)) {
      throw new HttpsError('permission-denied', 'That preview is not yours.');
    }

    await assertChatMember(scope, chatId, uid);

    // SCAN BEFORE SELLING. Reached because the media carries a price, never
    // because it is in a conversation: unpriced private chat stays exactly as
    // unscanned as it is today. Verdict policy is the priced one, so nudity
    // passes and only CSAM/NCII blocks.
    let moderation = null;
    if (!isVideo) {
      const { scanPricedImage } = require('./contentAi');
      const scanUrl = await getSignedUrl(
        r2Client(),
        new GetObjectCommand({ Bucket: bucket(), Key: mediaKey }),
        { expiresIn: 60 },
      );
      const verdict = await scanPricedImage(scanUrl, process.env.GEMINI_POST_IMAGE_KEY);
      if (verdict.verdict === 'block') {
        // The message is never created, and the error does not name the signal
        // that tripped: that would be a tuning guide for the person you least
        // want to help.
        throw new HttpsError(
          'failed-precondition',
          'This media cannot be sold on Vergr. If you believe that is wrong, contact support.',
        );
      }
      if (verdict.verdict === 'flag') {
        moderation = { status: 'review', category: verdict.category || 'none', reason: verdict.reason || '' };
      }
    }

    const chatRef = chatDocRef(scope, chatId);
    // The CLIENT may name the message. On the relay chat path the message list is
    // built from relay frames, not from Firestore, so the client sends its own
    // frame with this id; the doc written here exists for the entitlement
    // resolver (price) and would otherwise be invisible. Both must agree on one
    // id or the paywall would point at a message nobody can see.
    const suppliedId = String(request.data?.messageId || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64);
    const msgRef = suppliedId
      ? chatRef.collection('messages').doc(suppliedId)
      : chatRef.collection('messages').doc();
    const batch = db.batch();

    batch.set(msgRef, {
      senderId: uid,
      type: 'locked',
      text: caption,
      // NO mediaUrl / mediaUrls. Their absence is what makes every renderer fall
      // through to the locked state instead of trying to show bytes it cannot
      // have.
      locked: {
        priceCoins,
        previewUrl: previewUrl || null,
        unlockCount: 0,
        isVideo,
      },
      moderation,
      createdAt: FieldValue.serverTimestamp(),
    });

    if (moderation) {
      batch.set(db.collection('reports').doc(), {
        type: 'priced_media_review',
        chatId,
        messageId: msgRef.id,
        reportedUserId: uid,
        reason: `Automatic review: ${moderation.category} — ${moderation.reason}`,
        status: 'open',
        source: 'scanner',
        createdAt: FieldValue.serverTimestamp(),
      });
    }

    // The preview text says "locked media" rather than the caption, so a chat
    // list never leaks what was sent to someone who has not paid.
    batch.set(chatRef, {
      lastMessage: '🔒 Locked media',
      lastMessageAt: FieldValue.serverTimestamp(),
      lastSenderId: uid,
    }, { merge: true });

    // Keyed by message id, one document per creator, exactly the
    // `lockedPostFiles` shape and read only by getAccess.
    batch.set(
      db.collection('users').doc(uid).collection('private').doc('lockedMessageFiles'),
      {
        // Keyed by the FULL resource id the resolver will look up, which is
        // scope-prefixed for a squad. Keying it by message id alone would make a
        // squad message and a conversation message with the same id collide in
        // this one document.
        [resourceIdFor(scope, chatId, msgRef.id)]: {
          key: mediaKey,
          contentType: isVideo ? 'video' : 'image',
          createdAt: Date.now(),
        },
      },
      { merge: true },
    );

    await batch.commit();
    return { ok: true, messageId: msgRef.id, chatId, resourceId: resourceIdFor(scope, chatId, msgRef.id) };
  },
);
