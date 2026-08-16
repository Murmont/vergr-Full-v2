/**
 * Content Packs: a saved, titled, priced SET a creator can send again and again.
 *
 * ## The problem this solves
 *
 * Mundane and real. Without it, a creator selling the same ten photos to forty
 * different fans reopens their gallery and reselects those ten photos forty
 * times, and uploads them forty times. A pack is uploaded once and sent in one
 * tap.
 *
 * ## It is not a new kind of purchase
 *
 * Sending a pack writes exactly the same locked message a fresh upload writes,
 * through the same `writeLockedMessage`, and the buyer's entitlement stays keyed
 * to the MESSAGE (`message_{chatId}:{messageId}_{buyer}`). So a pack sent to two
 * people is two independent sales, and someone who bought it in one conversation
 * has not bought it in another.
 *
 * Keying the entitlement to the PACK would have meant one purchase unlocking
 * every future send of it, including sends to other people. That is not the
 * product, and it would be a hole rather than a feature.
 *
 * ## Where the bytes live
 *
 * The pack document holds PUBLIC metadata only: title, price, and the blurred
 * previews. The private object keys live in
 * `users/{uid}/private/mediaPackFiles`, which rules deny to every client, and
 * are copied onto the message's own private entry at send time. The client never
 * holds an object key at any point in this flow.
 */
const functions = require('firebase-functions/v2');
const { HttpsError } = require('firebase-functions/v2/https');
const { FieldValue } = require('firebase-admin/firestore');

const {
  writeLockedMessage,
  parseScope,
  assertChatMember,
  publicBase,
  MIN_PRICE_COINS,
  MAX_PRICE_COINS,
  MAX_ITEMS_PER_SEND,
  requireAuth,
  db,
  REGION,
} = require('./lockedMessages')._internal;

const clampDim = (v) => Math.min(20000, Math.max(0, Math.floor(Number(v) || 0)));

function assertPrice(priceCoins) {
  if (priceCoins < MIN_PRICE_COINS || priceCoins > MAX_PRICE_COINS) {
    throw new HttpsError(
      'invalid-argument',
      `Price must be between ${MIN_PRICE_COINS} and ${MAX_PRICE_COINS} coins.`,
    );
  }
}

/**
 * Save an already-uploaded set for reuse.
 *
 * The files are uploaded through the ordinary `getLockedMessageUploadUrl` path
 * first, so by the time this runs the bytes are already on the private prefix
 * and this is pure bookkeeping.
 */
exports.createMediaPack = functions.https.onCall(
  { region: REGION, cors: true },
  async (request) => {
    const uid = requireAuth(request);
    const title = String(request.data?.title || '').trim().slice(0, 60);
    const priceCoins = Math.floor(Number(request.data?.priceCoins) || 0);
    const rawItems = Array.isArray(request.data?.items) ? request.data.items : [];

    if (!title) throw new HttpsError('invalid-argument', 'Give the pack a title.');
    if (!rawItems.length) throw new HttpsError('invalid-argument', 'A pack needs at least one item.');
    if (rawItems.length > MAX_ITEMS_PER_SEND) {
      throw new HttpsError('invalid-argument', `A pack may hold at most ${MAX_ITEMS_PER_SEND} items.`);
    }
    assertPrice(priceCoins);

    const items = rawItems.map((it) => {
      const key = String(it?.mediaKey || '');
      const preview = String(it?.previewUrl || '');
      // Same ownership check as a send. Without it a caller could name someone
      // else's private object and then sell access to it.
      if (!key.startsWith(`locked/${uid}/`)) {
        throw new HttpsError('permission-denied', 'That file is not yours.');
      }
      if (preview && !preview.startsWith(`${publicBase()}/lockedpreview/${uid}/`)) {
        throw new HttpsError('permission-denied', 'That preview is not yours.');
      }
      const vid = it?.isVideo === true;
      return {
        mediaKey: key,
        previewUrl: preview || null,
        isVideo: vid,
        previewW: clampDim(it?.previewW),
        previewH: clampDim(it?.previewH),
        durationMs: vid
          ? Math.min(24 * 3600 * 1000, Math.max(0, Math.floor(Number(it?.durationMs) || 0)))
          : 0,
      };
    });

    const packRef = db.collection('users').doc(uid).collection('mediaPacks').doc();
    const batch = db.batch();

    // PUBLIC half. Owner-readable only (firestore.rules) and holding no object
    // keys, so even a rules mistake leaks blurred previews rather than media.
    batch.set(packRef, {
      title,
      priceCoins,
      itemCount: items.length,
      coverPreviewUrl: items[0].previewUrl,
      items: items.map((it) => ({
        previewUrl: it.previewUrl,
        isVideo: it.isVideo,
        previewW: it.previewW,
        previewH: it.previewH,
        durationMs: it.durationMs,
      })),
      sendCount: 0,
      createdAt: FieldValue.serverTimestamp(),
    });

    // PRIVATE half: the object keys, denied to every client.
    batch.set(
      db.collection('users').doc(uid).collection('private').doc('mediaPackFiles'),
      {
        [packRef.id]: {
          keys: items.map((it) => ({ mediaKey: it.mediaKey, isVideo: it.isVideo })),
          createdAt: Date.now(),
        },
      },
      { merge: true },
    );

    await batch.commit();
    return { ok: true, packId: packRef.id };
  },
);

/**
 * Delete a saved pack.
 *
 * The R2 objects are deliberately LEFT IN PLACE. Somebody may already have paid
 * for a message that references them, and deleting the bytes would retroactively
 * empty a purchase made in good faith. This removes the shortcut, not the sales.
 */
exports.deleteMediaPack = functions.https.onCall(
  { region: REGION, cors: true },
  async (request) => {
    const uid = requireAuth(request);
    const packId = String(request.data?.packId || '');
    if (!packId) throw new HttpsError('invalid-argument', 'packId required.');

    const batch = db.batch();
    batch.delete(db.collection('users').doc(uid).collection('mediaPacks').doc(packId));
    batch.set(
      db.collection('users').doc(uid).collection('private').doc('mediaPackFiles'),
      { [packId]: FieldValue.delete() },
      { merge: true },
    );
    await batch.commit();
    return { ok: true };
  },
);

/**
 * Send a saved pack into a chat as an ordinary locked message.
 *
 * The price may be overridden per send: the same set is worth different amounts
 * to different people, and forcing a creator to duplicate a pack in order to
 * charge one fan less would be silly. The pack's own price is the default.
 *
 * NO CONTENT SCAN HERE, deliberately. Every image was scanned when the pack was
 * created, the bytes are immutable on a private prefix, and re-scanning the same
 * objects on every send would spend a Vision call per fan to re-derive an answer
 * already on file.
 */
exports.sendMediaPack = functions.https.onCall(
  { region: REGION, cors: true },
  async (request) => {
    const uid = requireAuth(request);
    const packId = String(request.data?.packId || '');
    const chatId = String(request.data?.chatId || '');
    const scope = parseScope(request.data);
    const caption = String(request.data?.caption || '').slice(0, 500);

    if (!packId) throw new HttpsError('invalid-argument', 'packId required.');
    if (!chatId) throw new HttpsError('invalid-argument', 'chatId required.');

    await assertChatMember(scope, chatId, uid);

    const [packSnap, filesSnap] = await Promise.all([
      db.collection('users').doc(uid).collection('mediaPacks').doc(packId).get(),
      db.collection('users').doc(uid).collection('private').doc('mediaPackFiles').get(),
    ]);
    if (!packSnap.exists) throw new HttpsError('not-found', 'That pack no longer exists.');

    const pack = packSnap.data() || {};
    const keys = filesSnap.exists ? (filesSnap.data()?.[packId]?.keys || []) : [];
    if (!keys.length) throw new HttpsError('failed-precondition', 'That pack has no files.');

    const priceCoins = request.data?.priceCoins != null
      ? Math.floor(Number(request.data.priceCoins) || 0)
      : Math.floor(pack.priceCoins || 0);
    assertPrice(priceCoins);

    // Rejoin the public metadata with the private keys, in stored order.
    const meta = Array.isArray(pack.items) ? pack.items : [];
    const items = keys.map((k, i) => ({
      mediaKey: k.mediaKey,
      isVideo: !!k.isVideo,
      previewUrl: meta[i]?.previewUrl || null,
      previewW: Math.floor(meta[i]?.previewW || 0),
      previewH: Math.floor(meta[i]?.previewH || 0),
      durationMs: Math.floor(meta[i]?.durationMs || 0),
    }));

    const res = await writeLockedMessage({
      uid, scope, chatId, caption, priceCoins, items,
      moderation: null,
      messageId: request.data?.messageId,
    });

    // How often a pack gets used is the one number a creator wants, and it must
    // never be able to fail the send.
    packSnap.ref.update({ sendCount: FieldValue.increment(1) }).catch(() => {});

    return res;
  },
);
