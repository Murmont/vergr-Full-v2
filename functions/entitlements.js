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

const { earnedCoinCredit, settleEarnedShare } = require('./coinLedger');

const REGION = 'europe-west1';
const db = getFirestore('vgrdb');

const R2_SECRETS = [ 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY'];

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
/**
 * @deprecated UNUSED since 2026-08-14 — feePctFor() returns 0 under the
 * one-rate revenue-share model. FEE_PCT_PRO is kept because the Pro perk it
 * encoded is an OPEN founder decision, not a deleted feature: see the note in
 * feePctFor() below.
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

/**
 * The same, for video.
 *
 * A stream URL has to survive the whole playback, not just the start of it: the
 * browser re-requests byte ranges as the viewer watches and seeks, and once the
 * signature expires those requests 403 and the player stalls partway through
 * something the viewer has already paid for. Five minutes is therefore a bug for
 * anything longer than five minutes. An hour covers any clip that can be
 * uploaded under the plan caps while still expiring well inside a session.
 */
const VIDEO_SIGNED_URL_TTL_SECONDS = 3600;

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
/**
 * Refuse anyone not on a private session's guest list.
 *
 * Applies BEFORE price, because a free 1:1 is still private: "it costs nothing"
 * is not the same as "anyone may watch". It also applies before purchase, so a
 * stranger holding the id cannot buy their way into a session that was never
 * offered to them — otherwise the paywall would function as a public door with
 * a cover charge.
 *
 * A session with no list at all is left alone rather than closed: sessions
 * created before this shipped have no `inviteUids`, and locking their
 * participants out of something they are already in would be a worse failure
 * than the one being fixed. New sessions always carry a list.
 */
/**
 * Age-verify before ANY exposure to adult Content.
 *
 * ## Why this exists when `purchaseAccess` deliberately has no KYC gate
 *
 * The founder decision of 2026-08-08 (documented on purchaseAccess) was that
 * locked content is a GATING product, not adult commerce, so identity had no
 * business being checked on an ordinary unlock. That reasoning is untouched:
 * this never fires on ordinary locked content.
 *
 * It fires only where the seller marked the item NSFW. There the thing being
 * sold IS adult content, and a paywall is not an age gate: buying coins needs
 * no identity check either, so a minor holding someone else's card walks
 * straight through a price. Self-declaring 18 at signup is not age assurance
 * and would not be accepted as such by an app store or a regulator.
 *
 * Checked on BOTH the buy path and the view path on purpose. Gating only the
 * purchase would leave every already-entitled viewer, and every FREE NSFW item,
 * completely open.
 */
// eslint-disable-next-line no-unused-vars
async function assertNsfwViewerAllowed(resolved, uid) {
  // NO-OP since 2026-08-14. The adult marker is an ADVISORY LABEL now, not a
  // gate, and this function is kept only so the two call sites below stay
  // wired and the gate can be restored by putting its body back.
  //
  // Why it went: nudity and sexual content are prohibited on every surface
  // (Acceptable Use Policy s.3), and real nudity never reaches storage because
  // the scanner refuses it at upload with a "block" verdict. What is left that
  // can carry contentRating "nsfw" is the softer band the scanner reports as
  // adult-but-not-explicit: mature language, dark humour, adult subject matter.
  // A viewer deserves to be told that is what they are opening. Demanding a
  // government identity document to read a swear word is not proportionate,
  // and it put a KYC wall in front of content that is not adult content.
  //
  // Restoring the gate means restoring this body AND the feed filter in
  // src/utils/feedRank.js and the discovery filter in functions/streaming.js.
  // They were switched off together and only make sense together.
}

function assertInvited(resolved, uid) {
  if (!Array.isArray(resolved.inviteUids) || resolved.inviteUids.length === 0) return;
  if (resolved.sellerUid === uid) return;
  if (resolved.inviteUids.includes(uid)) return;
  // Deliberately the same wording a viewer would see for a session that has
  // ended: confirming that a private session exists at this id tells an
  // uninvited stranger something they should not learn from a probe.
  throw new HttpsError('not-found', 'That session is not available.');
}

/**
 * The public, non-secret shape of a locked item: blurred preview, dimensions,
 * whether it is video, how long it runs.
 *
 * None of this is sensitive — the preview URL is a deliberately destroyed
 * public object, and the dimensions of a photo are not the photo. It is
 * returned because the CLIENT often cannot see it: on the relay chat path the
 * message list is built from relay frames, which carry a fixed field set and no
 * `locked` block at all, so the receiving bubble has no idea what shape to be
 * and every locked message would fall back to the same default rectangle.
 * getAccess is already the authority on the price for exactly that reason; this
 * makes it the authority on the shape too.
 */
function previewMetaFrom(locked) {
  if (!locked) return null;
  const items = Array.isArray(locked.items) ? locked.items : [];
  return {
    previewUrl: locked.previewUrl || null,
    previewW: Math.floor(locked.previewW || 0),
    previewH: Math.floor(locked.previewH || 0),
    isVideo: !!locked.isVideo,
    durationMs: Math.floor(locked.durationMs || 0),
    unlockCount: Math.floor(locked.unlockCount || 0),
    // A locked send may be a SET, bought once. The count drives the "3 PICS"
    // label and the carousel dots; the per-item previews are already public
    // objects, so passing them costs nothing and is what lets the relay chat
    // path render a set at all.
    itemCount: Math.max(1, Math.floor(locked.itemCount || items.length || 1)),
    items: items.map((it) => ({
      previewUrl: it?.previewUrl || null,
      isVideo: !!it?.isVideo,
      previewW: Math.floor(it?.previewW || 0),
      previewH: Math.floor(it?.previewH || 0),
      durationMs: Math.floor(it?.durationMs || 0),
    })),
  };
}

const RESOLVERS = {
  async post(resourceId) {
    const ref = db.collection('posts').doc(resourceId);
    const snap = await ref.get();
    if (!snap.exists) throw new HttpsError('not-found', 'Post not found.');
    const p = snap.data();
    return {
      ref,
      sellerUid: p.authorId || null,
      contentRating: p.contentRating === 'nsfw' ? 'nsfw' : 'general',
      priceCoins: Math.floor(p.locked?.priceCoins || 0),
      audience: p.locked?.audience || 'public',
      title: 'a locked post',
      mediaOwnerUid: p.authorId || null,
      mediaDocPath: `users/${p.authorId}/private/lockedPostFiles`,
      counterField: 'locked.unlockCount',
      preview: previewMetaFrom(p.locked),
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
      contentRating: s.contentRating === 'nsfw' ? 'nsfw' : 'general',
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
      // A 1:1 names its guests. Absent on a broadcast, where the gate is the
      // audience and the price rather than a list of people.
      inviteUids: Array.isArray(s.inviteUids) ? s.inviteUids : null,
      sessionType: s.sessionType || 'broadcast',
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
      preview: previewMetaFrom(m.locked),
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
  // ONE RATE (2026-08-14, docs/REVENUE_SHARE_PLAN.md). The surface fee is gone:
  // the full price is gross revenue and Vergr's share is taken once, at the
  // revenue-share step (coinLedger.js → shareForEarnings), when the seller's
  // earned coins become gems. Charging 8-10% here as well was the double
  // deduction the whole model exists to remove.
  //
  // ⚠ OPEN FOUNDER DECISION — the Pro perk this used to carry.
  // Pro sellers paid 8% instead of 10%. That perk is advertised and paid for,
  // and returning 0 here deletes it silently, which is exactly what the "never
  // remove a feature without permission" rule is about. It is NOT restored
  // arbitrarily either, because inventing a replacement rate is a financial
  // decision that is not mine to make.
  //
  // The natural replacement is a one-tier share bump for Pro sellers in
  // shareForEarnings(). Until the founder sets that, Pro and free are equal
  // here and the perk is dormant, not removed: FEE_PCT_PRO is retained at the
  // top of this file so the intent stays visible in the code.
  return 0;
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
    assertInvited(resolved, uid);
    await assertNsfwViewerAllowed(resolved, uid);
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

      // feePct is 0 under the one-rate model; the seller accrues the full price
      // as earned value and Vergr's share is taken at conversion. Kept as a
      // variable rather than inlined so the ledger row shape does not change
      // and so a future founder decision can reinstate a surface fee here.
      const platformFee = Math.floor(price * feePct);
      const sellerNet = price - platformFee;

      tx.update(buyerWalletRef, {
        balance: FieldValue.increment(-price),
        totalSpent: FieldValue.increment(price),
        updatedAt: FieldValue.serverTimestamp(),
      });

      // This is creator earnings, same class as a tip, so it counts toward
      // earnedBalance and accrues revenue share in settleEarnedShare below.
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
        // Coin-denominated GROSS. The creator's share of it accrues in
        // settleEarnedShare below, which writes its own `earning: true` row.
        // This row is the sale record, not the income record, so it must not
        // be stamped as earnings or the two would double-count.
        currency: 'coins',
        amount: sellerNet,
        resourceType,
        resourceId,
        buyerId: uid,
        platformFee,
        description: `Sold access to ${fresh.title}`,
        createdAt: FieldValue.serverTimestamp(),
      });

      tx.set(db.collection('notifications').doc(), {
        // recipientId, NOT userId. The notifications drawer queries on
        // recipientId, so this notification was written but never delivered.
        recipientId: sellerUid,
        type: 'content_unlocked',
        title: 'Someone unlocked your content',
        body: `+${sellerNet} coins from ${fresh.title}`,
        resourceType,
        resourceId,
        read: false,
        createdAt: FieldValue.serverTimestamp(),
      });

      return { alreadyOwned: false, pricePaid: price, platformFee, sellerNet, sellerUid };
    });

    // Accrue the seller's revenue share. Every other earning surface does this
    // and locked content did not, so unlock revenue sat in the spendable coin
    // pool forever: never accrued, never payable, and invisible on the Earnings
    // screen. Post-commit and idempotent on the entitlement id, matching the
    // pattern in memberships and eventTickets.
    if (!result.alreadyOwned && result.sellerNet > 0) {
      await settleEarnedShare(db, {
        uid: result.sellerUid,
        coins: result.sellerNet,
        source: 'content_unlock',
        sourceId: `unlock:${entitlementId(resourceType, resourceId, uid)}`,
      });
    }

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
    assertInvited(resolved, uid);
    await assertNsfwViewerAllowed(resolved, uid);
    const price = resolved.priceCoins;

    // Not for sale, or the caller owns it: nothing to buy.
    if (price <= 0 || resolved.sellerUid === uid) {
      const urls = await signAll(resolved, resourceId);
      return {
        hasAccess: true,
        priceCoins: 0,
        isOwner: resolved.sellerUid === uid,
        preview: resolved.preview || null,
        mediaUrl: urls[0] || null,
        mediaUrls: urls,
        ...(await playbackFor(resolved)),
      };
    }

    const entSnap = await db
      .collection('entitlements')
      .doc(entitlementId(resourceType, resourceId, uid))
      .get();
    const hasAccess = entSnap.exists && entSnap.data().status === 'active';
    const urls = hasAccess ? await signAll(resolved, resourceId) : [];

    return {
      hasAccess,
      isOwner: false,
      priceCoins: price,
      sellerUid: resolved.sellerUid,
      preview: resolved.preview || null,
      unlockedAt: hasAccess ? entSnap.data().createdAt || null : null,
      mediaUrl: urls[0] || null,
      mediaUrls: urls,
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
  const urls = await signAll(resolved, resourceId);
  return urls.length ? urls[0] : null;
}

/**
 * Every private object behind one resource, signed, in order.
 *
 * A locked message can carry a SET ("3 PICS"), bought once. The keys live in an
 * array on the private document; older single-item sends have only `key`, so
 * both shapes are read here rather than migrated — a migration would rewrite
 * documents nothing is broken by.
 */
async function signAll(resolved, resourceId) {
  if (!resolved.mediaDocPath) return [];
  const snap = await db.doc(resolved.mediaDocPath).get();
  if (!snap.exists) return [];
  // Keyed by the resource id so one document holds every locked file a creator
  // owns, exactly like `vergrMeProductFiles`.
  const entry = snap.data()?.[resourceId];
  if (!entry) return [];

  const list = Array.isArray(entry.keys) && entry.keys.length
    ? entry.keys
    : (entry.key ? [{ key: entry.key, contentType: entry.contentType }] : []);

  const out = [];
  for (const item of list) {
    const key = item?.key;
    if (!key) continue;

    // The key must live under the seller's own prefix. Rules already stop a
    // client writing this document, so reaching here with a foreign key should
    // be impossible; it is checked anyway because the failure mode is handing a
    // paying stranger a signed URL to a third party's private file, and "should
    // be impossible" is not a good enough reason to skip four lines.
    if (resolved.mediaOwnerUid && !String(key).startsWith(`locked/${resolved.mediaOwnerUid}/`)) {
      console.error(`[entitlements] key ${key} does not belong to ${resolved.mediaOwnerUid}`);
      continue;
    }

    // A five-minute URL cannot serve a twenty-minute video: the player would die
    // mid-playback with no explanation, and the buyer would have paid for it.
    // The window is therefore chosen by media type, which is why the file type
    // is recorded alongside the key at upload time rather than inferred from the
    // extension. An image keeps the short window, because a still is fetched
    // once and a pasted URL should be dead on arrival.
    const expiresIn = item.contentType === 'video'
      ? VIDEO_SIGNED_URL_TTL_SECONDS
      : SIGNED_URL_TTL_SECONDS;

    out.push(await getSignedUrl(
      r2Client(),
      new GetObjectCommand({ Bucket: bucket(), Key: key }),
      { expiresIn },
    ));
  }
  return out;
}
