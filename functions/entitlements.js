/**
 * ONE entitlement system, for every "pay to see this" in the app.
 *
 * There are already four near-identical purchase systems here: `event_tickets`,
 * `event_season_passes`, `vergrme_purchases` and `member_subscriptions`. Locked
 * posts, locked chat media and paid streams would have made seven, each with its
 * own price re-read, its own idempotency scheme and its own refund story. This
 * is the one they all share instead.
 *
 * ## The doc id IS the idempotency
 *
 * `entitlements/{resourceType}_{resourceId}_{buyerUid}`. A second tap on Unlock
 * cannot create a second purchase because there is nowhere for it to go: the
 * transaction reads that exact id first and refuses. No lock, no dedupe key, no
 * window where two in-flight calls both win.
 *
 * ## The client never sends a price
 *
 * Same rule as `vergrMeShop.js`, and the reason is the same: a number that
 * arrives from a phone is a number an attacker chose. Every resolver below
 * re-reads the price from the resource document inside the transaction, and the
 * only thing the caller gets to pick is WHICH resource.
 *
 * ## Coins on both sides. Founder decision, 2026-08-07
 *
 * Buyers pay coins and sellers are credited coins, exactly like tips, tickets
 * and memberships. A gems-direct payout was proposed and overruled. So unlock
 * revenue is `earnedCoinCredit`, meaning it is convertible and it pays the
 * normal coin-to-gem commission on withdrawal like every other creator earning.
 * See docs/CREATOR_MONETIZATION_PLAN.md section 6.2 before "simplifying" this.
 *
 * ## What is NOT here
 *
 * The existing four systems are not migrated. They work, the web depends on
 * them, and a migration buys nothing but risk. Ticketed tournaments keep using
 * `event_tickets`; the Kotlin app simply never creates one.
 */
const functions = require('firebase-functions/v2');
const { HttpsError } = require('firebase-functions/v2/https');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const { S3Client, GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

const { earnedCoinCredit } = require('./coinLedger');

const REGION = 'europe-west1';
const db = getFirestore('vgrdb');

const R2_SECRETS = ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET'];

/**
 * Platform fee on an unlock. LOCKED, plan section 6.1 and 6.5.
 *
 * 10%, half of what OnlyFans and Fansly take, which is a migration argument a
 * creator can act on. Pro sells 8%. Both numbers already exist elsewhere in the
 * app rather than being invented for this.
 *
 * A fee can be cut as a promotion and can never be raised without a revolt, so
 * 10% is the floor to start from, not the target.
 */
const FEE_PCT = 0.10;
const FEE_PCT_PRO = 0.08;

/**
 * Price bounds. LOCKED, plan section 6.3.
 *
 * Below 50 coins the 10% fee rounds to nothing and the ledger write costs more
 * than the sale. The ceiling reuses the tournament entry cap rather than
 * inventing a second number, and it exists for laundering control: without one,
 * a pair of stolen accounts listing and buying a 500,000-coin post is a
 * clearing house.
 */
const MIN_PRICE_COINS = 50;
const MAX_PRICE_COINS = 10_000;

/** How long a signed media URL lives. Long enough to start a download, short
 *  enough that a shared link is worthless by the time it is pasted. */
const SIGNED_URL_TTL_SECONDS = 300;

const RESOURCE_TYPES = new Set(['post', 'stream', 'message', 'creator', 'call']);

const env = (name) => (process.env[name] || '').replace(/[\s\r\n]+$/g, '').trim();
const bucket = () => env('R2_BUCKET') || 'vergr-media';

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

const entitlementId = (resourceType, resourceId, buyerUid) =>
  `${resourceType}_${resourceId}_${buyerUid}`;

function requireAuth(request) {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in required.');
  return uid;
}

function parseArgs(data) {
  const resourceType = String(data?.resourceType || '');
  const resourceId = String(data?.resourceId || '').slice(0, 200);
  if (!RESOURCE_TYPES.has(resourceType)) {
    throw new HttpsError('invalid-argument', 'Unknown resourceType.');
  }
  if (!resourceId) throw new HttpsError('invalid-argument', 'resourceId required.');
  return { resourceType, resourceId };
}

// ─────────────────────────────────────────────────────────── resolvers

/**
 * Every resource type answers the same four questions, so the purchase path
 * below has no idea what it is selling.
 *
 * A resolver returns:
 *   { ref, sellerUid, priceCoins, audience, title, mediaOwnerUid, mediaDocPath }
 *
 * `priceCoins` of 0 means "not for sale", which is the correct answer for the
 * overwhelming majority of posts and streams and must never be an error.
 *
 * The media fields point at where the PRIVATE object key lives, never at the key
 * itself: keys live in `users/{uid}/private/...`, which no client can read, and
 * are resolved only after access is proven.
 */
const RESOLVERS = {
  async post(resourceId) {
    const ref = db.collection('posts').doc(resourceId);
    const snap = await ref.get();
    if (!snap.exists) throw new HttpsError('not-found', 'Post not found.');
    const p = snap.data();
    return {
      ref,
      sellerUid: p.authorId || null,
      priceCoins: Math.floor(p.locked?.priceCoins || 0),
      audience: p.locked?.audience || 'public',
      title: 'a locked post',
      mediaOwnerUid: p.authorId || null,
      mediaDocPath: `users/${p.authorId}/private/lockedPostFiles`,
      counterField: 'locked.unlockCount',
    };
  },

  async stream(resourceId) {
    const ref = db.collection('streams').doc(resourceId);
    const snap = await ref.get();
    if (!snap.exists) throw new HttpsError('not-found', 'Stream not found.');
    const s = snap.data();
    // A stream is only sellable while it is a paid one. `access.mode` is set by
    // Go Live; anything else (free, followers, subscribers) is enforced by the
    // audience gate, not by a purchase.
    const paid = s.access?.mode === 'paid';
    return {
      ref,
      sellerUid: s.hostUid || null,
      priceCoins: paid ? Math.floor(s.access?.priceCoins || 0) : 0,
      // The stream's own audience still applies on top of the ticket price: a
      // followers-only paid stream means followers who have also paid.
      audience: s.audience || 'public',
      title: s.title ? `"${String(s.title).slice(0, 60)}"` : 'a live stream',
      mediaOwnerUid: null, // not an R2 object; the playlist lives on the CDN
      mediaDocPath: null,
      // Written by createStreamSession for paid streams only, and denied to
      // every client by rules. This is what makes the gate real rather than
      // cosmetic: the stream document is world-readable, so the URL cannot
      // live on it.
      playbackDocPath: `streams/${resourceId}/private/playback`,
      counterField: 'access.unlockCount',
    };
  },

  async message(resourceId) {
    // `resourceId` is `{chatId}:{messageId}` because a message id is only unique
    // within its chat, and an entitlement id has to be globally unique.
    //
    // The collection is `conversations`, NOT `chats`. This read `chats` when the
    // resolver shipped, which meant every locked-message lookup resolved against
    // a collection that does not exist in this project and answered "not found"
    // for content that was there. Nothing had written a price to a message yet,
    // so it never fired in production.
    // Two shapes, because squad chat does not live in `conversations`:
    //   "{chatId}:{messageId}"          → conversations/{chatId}/messages
    //   "squad:{squadId}:{messageId}"   → squads/{squadId}/messages
    // The prefix is explicit rather than inferred from the part count so a chat
    // id that happened to contain a colon could never be read as a squad path.
    const parts = resourceId.split(':');
    const isSquad = parts[0] === 'squad';
    const [chatId, messageId] = isSquad ? [parts[1], parts[2]] : [parts[0], parts[1]];
    if (!chatId || !messageId) {
      throw new HttpsError('invalid-argument', 'message resourceId must be "chatId:messageId" or "squad:squadId:messageId".');
    }
    const ref = isSquad
      ? db.collection('squads').doc(chatId).collection('messages').doc(messageId)
      : db.collection('conversations').doc(chatId).collection('messages').doc(messageId);
    const snap = await ref.get();
    if (!snap.exists) throw new HttpsError('not-found', 'Message not found.');
    const m = snap.data();
    return {
      ref,
      sellerUid: m.senderId || null,
      priceCoins: Math.floor(m.locked?.priceCoins || 0),
      // Chat is already a closed room. Whoever can see the message may buy it;
      // there is no second audience to check.
      audience: 'public',
      title: 'a locked message',
      mediaOwnerUid: m.senderId || null,
      mediaDocPath: `users/${m.senderId}/private/lockedMessageFiles`,
      counterField: 'locked.unlockCount',
    };
  },

  /**
   * A paid 1:1 (or group) call. `resourceId` is the chat id, because that is
   * what `calls/{chatId}` is keyed by and what both sides already hold.
   *
   * The seller is the CALLER: they set the price and they are the one being
   * paid for their time. Anyone else on the call is a buyer, which is what
   * makes this work for a group session as well as a two-person one.
   */
  async call(resourceId) {
    const ref = db.collection('calls').doc(resourceId);
    const snap = await ref.get();
    if (!snap.exists) throw new HttpsError('not-found', 'That call has ended.');
    const c = snap.data();
    return {
      ref,
      sellerUid: c.callerId || null,
      priceCoins: Math.floor(c.priceCoins || 0),
      // The room is already closed: only people in the conversation can be rung
      // by it, so there is no second audience gate to apply.
      audience: 'public',
      title: 'a 1:1 session',
      mediaOwnerUid: null,
      mediaDocPath: null,
      counterField: 'paidJoinCount',
    };
  },

  async creator(resourceId) {
    // Whole-creator access: one payment for everything they have locked. The
    // price lives on the creator's own profile.
    const ref = db.collection('users').doc(resourceId);
    const snap = await ref.get();
    if (!snap.exists) throw new HttpsError('not-found', 'Creator not found.');
    const u = snap.data();
    return {
      ref,
      sellerUid: resourceId,
      priceCoins: Math.floor(u.lockedAccess?.priceCoins || 0),
      audience: 'public',
      title: `everything from @${u.username || 'this creator'}`,
      mediaOwnerUid: null,
      mediaDocPath: null,
      counterField: 'lockedAccess.unlockCount',
    };
  },
};

/**
 * The seller's fee rate. Pro pays 8%, everyone else 10%.
 *
 * Read from the SELLER, not the buyer: the discount is a Pro perk for the person
 * earning, which is the only reading under which it pays for itself.
 */
async function feePctFor(sellerUid) {
  const snap = await db.collection('users').doc(sellerUid).get();
  const tier = snap.exists ? snap.data()?.subscription?.tier : null;
  return tier === 'pro' ? FEE_PCT_PRO : FEE_PCT;
}

// ─────────────────────────────────────────────────────── purchaseAccess

/**
 * Buy access to one resource.
 *
 * ## NO KYC on an unlock. Founder decision, 2026-08-08
 *
 * This briefly called `assertKycVerified`, on a reading of plan section 3b that
 * treated locked content as an adult-content product needing an age-verified
 * buyer. The founder corrected the premise: **the product is the ability to gate
 * content**, not adult commerce. The reference case is a creator selling a
 * ticket to an exclusive stream for fans they do not know. What anyone puts
 * behind the gate is their own business, and the platform is not in the business
 * of assuming.
 *
 * The decisive argument is his: identity is not checked when someone BUYS coins,
 * so checking it when they SPEND coins they already own gates the wrong end of
 * the transaction. Where identity actually bites is coin-to-gem conversion, and
 * it is enforced there already.
 *
 * `assertRegionAllowed` stays, because that is about blocked jurisdictions
 * rather than identity.
 *
 * Note that admin bypasses every paywall and server limit by standing rule; a
 * KYC gate here also broke that, since an identity check is not something the
 * admin bypass covers.
 */
exports.purchaseAccess = functions.https.onCall(
  { region: REGION, cors: true, secrets: ['VERGR_GEO_TOKEN'] },
  async (request) => {
    const uid = requireAuth(request);
    const { resourceType, resourceId } = parseArgs(request.data);

    // Pre-reads: queries cannot run inside a transaction, and the audience gate
    // needs one. The price read here is only for gating; the price that is
    // CHARGED is re-read inside the transaction below.
    const resolved = await RESOLVERS[resourceType](resourceId);
    const { sellerUid } = resolved;
    if (!sellerUid) throw new HttpsError('failed-precondition', 'This has no owner to pay.');
    if (sellerUid === uid) {
      throw new HttpsError('failed-precondition', "You can't buy your own content.");
    }
    if (resolved.priceCoins <= 0) {
      throw new HttpsError('failed-precondition', 'This is not for sale.');
    }

    const { assertAudienceAllowed } = require('./eventTickets');
    await assertAudienceAllowed(resolved.audience, uid, sellerUid, []);

    const { assertRegionAllowed } = require('./geo');
    await assertRegionAllowed(request);

    const feePct = await feePctFor(sellerUid);

    const entRef = db.collection('entitlements').doc(entitlementId(resourceType, resourceId, uid));
    const buyerWalletRef = db.collection('wallets').doc(uid);
    const sellerWalletRef = db.collection('wallets').doc(sellerUid);

    const result = await db.runTransaction(async (tx) => {
      const [entSnap, buyerWalletSnap, resourceSnap] = await Promise.all([
        tx.get(entRef),
        tx.get(buyerWalletRef),
        tx.get(resolved.ref),
      ]);

      if (entSnap.exists && entSnap.data().status === 'active') {
        // Not an error the UI should shout about: the common cause is a double
        // tap or a retry after a dropped response. Report it as success.
        return { alreadyOwned: true, pricePaid: entSnap.data().pricePaid || 0 };
      }
      if (!resourceSnap.exists) throw new HttpsError('not-found', 'This no longer exists.');

      // THE AUTHORITATIVE PRICE. Re-read inside the transaction so a price
      // changed between the pre-read and the commit charges the new one.
      const fresh = await RESOLVERS[resourceType](resourceId);
      const price = fresh.priceCoins;
      if (price < MIN_PRICE_COINS || price > MAX_PRICE_COINS) {
        throw new HttpsError('failed-precondition', 'This has no valid price.');
      }

      const balance = buyerWalletSnap.exists ? (buyerWalletSnap.data().balance || 0) : 0;
      if (balance < price) {
        throw new HttpsError('failed-precondition', 'Not enough coins.');
      }

      const platformFee = Math.floor(price * feePct);
      const sellerNet = price - platformFee;

      tx.update(buyerWalletRef, {
        balance: FieldValue.increment(-price),
        totalSpent: FieldValue.increment(price),
        updatedAt: FieldValue.serverTimestamp(),
      });

      // Convertible: this is creator earnings, same class as a tip, so it counts
      // toward earnedBalance and pays the coin-to-gem commission on withdrawal.
      tx.set(sellerWalletRef, {
        ...earnedCoinCredit(sellerNet),
        totalEarned: FieldValue.increment(sellerNet),
        totalReceived: FieldValue.increment(sellerNet),
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });

      tx.set(entRef, {
        buyerUid: uid,
        sellerUid,
        resourceType,
        resourceId,
        pricePaid: price,
        platformFee,
        sellerNet,
        feePct,
        status: 'active',
        createdAt: FieldValue.serverTimestamp(),
      });

      // Public unlock counter on the resource itself, so a card can show "48
      // people unlocked this" without reading the entitlements collection.
      tx.set(resolved.ref, {
        [resolved.counterField]: FieldValue.increment(1),
      }, { merge: true });

      tx.set(db.collection('transactions').doc(), {
        userId: uid,
        type: 'content_unlock',
        amount: -price,
        balance: balance - price,
        resourceType,
        resourceId,
        sellerId: sellerUid,
        description: `Unlocked ${fresh.title}`,
        createdAt: FieldValue.serverTimestamp(),
      });
      tx.set(db.collection('transactions').doc(), {
        userId: sellerUid,
        type: 'content_unlock_sale',
        amount: sellerNet,
        resourceType,
        resourceId,
        buyerId: uid,
        platformFee,
        description: `Sold access to ${fresh.title}`,
        createdAt: FieldValue.serverTimestamp(),
      });

      tx.set(db.collection('notifications').doc(), {
        userId: sellerUid,
        type: 'content_unlocked',
        title: 'Someone unlocked your content',
        body: `+${sellerNet} coins from ${fresh.title}`,
        resourceType,
        resourceId,
        read: false,
        createdAt: FieldValue.serverTimestamp(),
      });

      return { alreadyOwned: false, pricePaid: price, platformFee, sellerNet };
    });

    return { ok: true, ...result };
  },
);

// ────────────────────────────────────────────────────────────── getAccess

/**
 * Does the caller have access, and if so how do they fetch the bytes.
 *
 * Safe to call for anything: an unowned free resource answers
 * `{ hasAccess: true, priceCoins: 0 }` and a locked one answers with the price
 * so the UI can render the paywall from one call.
 *
 * The signed URL is minted here and nowhere else. That is the entire security
 * model for locked media: the object lives on a private prefix with no public
 * URL, so possession of the post id buys you nothing.
 */
exports.getAccess = functions.https.onCall(
  { region: REGION, cors: true, secrets: R2_SECRETS },
  async (request) => {
    const uid = requireAuth(request);
    const { resourceType, resourceId } = parseArgs(request.data);

    const resolved = await RESOLVERS[resourceType](resourceId);
    const price = resolved.priceCoins;

    // Not for sale, or the caller owns it: nothing to buy.
    if (price <= 0 || resolved.sellerUid === uid) {
      return {
        hasAccess: true,
        priceCoins: 0,
        isOwner: resolved.sellerUid === uid,
        mediaUrl: await signIfPossible(resolved, resourceId),
        ...(await playbackFor(resolved)),
      };
    }

    const entSnap = await db
      .collection('entitlements')
      .doc(entitlementId(resourceType, resourceId, uid))
      .get();
    const hasAccess = entSnap.exists && entSnap.data().status === 'active';

    return {
      hasAccess,
      isOwner: false,
      priceCoins: price,
      sellerUid: resolved.sellerUid,
      unlockedAt: hasAccess ? entSnap.data().createdAt || null : null,
      mediaUrl: hasAccess ? await signIfPossible(resolved, resourceId) : null,
      ...(hasAccess ? await playbackFor(resolved) : {}),
    };
  },
);

/**
 * A paid stream's playback URLs, for a caller who has already been proven
 * entitled by the code above.
 *
 * Returns an empty object rather than nulls so spreading it into a free
 * resource's response adds nothing at all, and a client cannot tell the
 * difference between "no playback because it is free" and "no playback because
 * you have not paid" by looking at which keys exist.
 */
async function playbackFor(resolved) {
  if (!resolved.playbackDocPath) return {};
  const snap = await db.doc(resolved.playbackDocPath).get();
  if (!snap.exists) return {};
  const d = snap.data() || {};
  return { hlsUrl: d.hlsUrl || null, lowLatencyHlsUrl: d.lowLatencyHlsUrl || null };
}

/**
 * A presigned GET for the resource's private object, or null.
 *
 * Null is a normal answer, not a failure: a stream has no object to sign, and a
 * post whose private key document has not been written yet (M2 writes it) simply
 * has nothing to hand over. Callers render the unlocked state either way.
 */
async function signIfPossible(resolved, resourceId) {
  if (!resolved.mediaDocPath) return null;
  const snap = await db.doc(resolved.mediaDocPath).get();
  if (!snap.exists) return null;
  // Keyed by the resource id so one document holds every locked file a creator
  // owns, exactly like `vergrMeProductFiles`.
  const key = snap.data()?.[resourceId]?.key;
  if (!key) return null;

  // The key must live under the seller's own prefix. Rules already stop a client
  // writing this document, so reaching here with a foreign key should be
  // impossible; it is checked anyway because the failure mode is handing a
  // paying stranger a signed URL to a third party's private file, and "should be
  // impossible" is not a good enough reason to skip four lines.
  if (resolved.mediaOwnerUid && !String(key).startsWith(`locked/${resolved.mediaOwnerUid}/`)) {
    console.error(`[entitlements] key ${key} does not belong to ${resolved.mediaOwnerUid}`);
    return null;
  }

  return getSignedUrl(
    r2Client(),
    new GetObjectCommand({ Bucket: bucket(), Key: key }),
    { expiresIn: SIGNED_URL_TTL_SECONDS },
  );
}
