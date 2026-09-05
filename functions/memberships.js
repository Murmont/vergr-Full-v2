// VERGR creator memberships — coin-funded monthly support (Patreon/Twitch model).
//
// Fans pay coins monthly to a creator's MembershipTier (set up in Creator Studio →
// Memberships, stored at `creators/{uid}.membershipTiers`). Active subs live in
// `member_subscriptions`.
//
// ⚠⚠ THIS HEADER USED TO SAY "10% platform fee, creator keeps 90% (mirrors tips)".
// THAT IS WRONG AND HAS BEEN WRONG SINCE THE REVENUE-SHARE MIGRATION. Read the code:
// `creatorAmount = price` — the FULL tier price is credited as GROSS earned coins, and
// Vergr's share is taken ONCE, later, at accrual in `coinLedger.settleEarnedShare`,
// on the 50%→80% ladder keyed to lifetime gross earned. There is no 10% membership fee
// and there is no tip fee either (`entitlements.feePctFor()` returns 0).
//
// A stale comment like that one is worse than no comment: it gets quoted to founders,
// processors and future sessions as if it were the model. Grep the code before
// repeating any rate from a header.
//
// - subscribeMembership      — debit fan wallet, credit the creator the FULL price as
//                              gross earned coins, open an auto-renewing sub
// - cancelMembership         — flip autoRenew=false; access stays until periodEnd
// - getMyMemberships         — fan's active/lapsing subs, enriched with creator profile
// - renewMemberSubscriptions — daily cron: auto-debit due subs, lapse the rest
//
// The data-shape reconciliation: the old subscribeMembership read a `memberships`
// collection that nothing ever wrote. This module reads the creator doc the editor
// actually saves to, so the feature works end-to-end.

const functions = require('firebase-functions/v2');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const { settleEarnedShare, earnedCoinCredit } = require('./coinLedger');

const REGION = 'europe-west1';
const db = getFirestore('vgrdb');

const PERIOD_MS = 30 * 24 * 3600 * 1000;
/**
 * @deprecated UNUSED since 2026-08-14. The 10% surface fee was removed when the
 * revenue-share model replaced both deductions with one rate taken at the
 * revenue-share step (coinLedger.js → shareForEarnings). Retained only as a
 * marker of what the rate used to be; delete once the migration is signed off.
 */
const PLATFORM_FEE_PCT = 0.10;

// Find a published tier by id on a creator's profile doc. Returns { tier, creator }.
async function loadTier(creatorId, tierId) {
  const snap = await db.collection('creators').doc(creatorId).get();
  if (!snap.exists) throw new functions.https.HttpsError('not-found', 'Creator not found.');
  const tiers = snap.data().membershipTiers || [];
  const tier = tiers.find((t) => t.id === tierId);
  if (!tier) throw new functions.https.HttpsError('not-found', 'Membership tier not found.');
  if (tier.published === false) throw new functions.https.HttpsError('failed-precondition', 'This tier is not available.');
  return { tier, creatorData: snap.data() };
}

// Count active subs on a tier (for seat limits). Pre-transaction, best-effort.
async function activeSeatCount(creatorId, tierId) {
  const snap = await db.collection('member_subscriptions')
    .where('creatorId', '==', creatorId)
    .where('tierId', '==', tierId)
    .where('status', '==', 'active')
    .count().get();
  return snap.data().count || 0;
}

// ─────────────────────────────────────────────────────────────────────
// subscribeMembership — fan pays coins, sub opens immediately + auto-renews.
// ─────────────────────────────────────────────────────────────────────
// GIFT A SUB. Founder decisions, 2026-09-02, all three enforced here:
//   NO GIFTER GATE      anyone may gift; no follower or tier requirement
//   NO RENEWAL          autoRenew is FALSE, so a gift is one month and stops
//   BULK IS qty x price WITH NO DISCOUNT
//
// THE NO-DISCOUNT RULE IS ENFORCED BY THE SHAPE, NOT BY A COMMENT. The total is
// `price * granted.length` and there is no quantity table, no ladder and no
// percentage anywhere in this function, so there is nowhere for a discount to be
// introduced by accident. Changing that is an economy change and a founder call.
//
// RECIPIENTS ARE EXPLICIT. The client picks names (it already has the viewer
// list); the server never invents one. Gifting to "whoever" would mean the server
// choosing who receives money-backed value, which nobody has specified.
//
// ALREADY-ACTIVE MEMBERS ARE FILTERED OUT AND NOT CHARGED FOR. One active sub per
// fan per creator is the existing rule, so a gift to someone who already has one
// cannot grant anything, and taking coins for it would be charging for a no-op.
exports.giftMembership = functions.https.onCall(
  { region: REGION, cors: true },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) throw new functions.https.HttpsError('unauthenticated', 'Sign in required.');
    const { creatorId, tierId, recipients } = request.data || {};
    if (!creatorId || !tierId) throw new functions.https.HttpsError('invalid-argument', 'creatorId and tierId required');
    const wanted = Array.from(new Set((Array.isArray(recipients) ? recipients : []).filter((r) => typeof r === 'string' && r)));
    if (!wanted.length) throw new functions.https.HttpsError('invalid-argument', 'Pick who the gift is for.');
    if (wanted.length > 25) throw new functions.https.HttpsError('invalid-argument', 'Up to 25 gifts at a time.');
    if (wanted.includes(creatorId)) throw new functions.https.HttpsError('failed-precondition', 'A creator cannot be gifted their own membership.');

    const { tier } = await loadTier(creatorId, tierId);
    const price = Math.max(0, Math.floor(tier.priceCoins || 0));
    if (price <= 0) throw new functions.https.HttpsError('failed-precondition', 'This tier has no price set.');

    // Filter to the people a gift can actually reach.
    const granted = [];
    for (const r of wanted) {
      const existing = await db.collection('member_subscriptions')
        .where('userId', '==', r).where('creatorId', '==', creatorId)
        .where('status', '==', 'active').limit(1).get();
      if (existing.empty) granted.push(r);
    }
    if (!granted.length) throw new functions.https.HttpsError('already-exists', 'Everyone you picked is already a member.');

    // Seat limit, best-effort, same as the paid path.
    if (tier.seatLimit && Number(tier.seatLimit) > 0) {
      const taken = await activeSeatCount(creatorId, tierId);
      if (taken + granted.length > Number(tier.seatLimit)) {
        throw new functions.https.HttpsError('resource-exhausted', 'That tier does not have enough seats left.');
      }
    }

    const total = price * granted.length;
    const now = Date.now();
    const periodEnd = now + PERIOD_MS;
    const groupIds = (tier.communities || [])
      .filter((c) => c.type === 'vergr_group' && c.groupId).map((c) => c.groupId);

    const result = await db.runTransaction(async (tx) => {
      const walletRef = db.collection('wallets').doc(uid);
      const wallet = await tx.get(walletRef);
      const balance = wallet.exists ? (wallet.data().balance || 0) : 0;
      if (balance < total) {
        throw new functions.https.HttpsError('failed-precondition',
          'Need ' + total + ' coins for ' + granted.length + ' gifts. You have ' + balance + '.');
      }
      tx.update(walletRef, {
        balance: FieldValue.increment(-total),
        totalSpent: FieldValue.increment(total),
        updatedAt: FieldValue.serverTimestamp(),
      });
      // ONE RATE. The whole price is gross revenue; Vergr takes its share once at
      // accrual, never twice. Same as the paid path.
      tx.set(db.collection('wallets').doc(creatorId), {
        ...earnedCoinCredit(total),
        totalEarned: FieldValue.increment(total),
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });

      for (const r of granted) {
        tx.set(db.collection('member_subscriptions').doc(creatorId + '_' + r), {
          userId: r, creatorId, tierId,
          tierName: tier.name || 'Member',
          priceCoins: price,
          badge: tier.badge || null,
          communityGroupIds: groupIds,
          paymentType: 'coins',
          status: 'active',
          // A GIFT DOES NOT RENEW. The recipient never entered payment details and
          // must not be billed when the month ends.
          autoRenew: false,
          giftedBy: uid,
          startedAt: FieldValue.serverTimestamp(),
          periodStart: now,
          periodEnd,
          renewsAt: null,
          createdAt: FieldValue.serverTimestamp(),
        });
        tx.set(db.collection('notifications').doc(), {
          recipientId: r, type: 'membership',
          title: 'You were gifted a membership',
          body: 'Someone gifted you a month of ' + (tier.name || 'membership') + '.',
          senderId: uid, read: false, data: { creatorId, tierId }, createdAt: FieldValue.serverTimestamp(),
        });
      }

      tx.set(db.collection('transactions').doc(), {
        userId: uid, type: 'membership_gift', amount: -total, currency: 'coins',
        description: 'Gifted ' + granted.length + ' x ' + (tier.name || 'membership'),
        meta: { creatorId, tierId, count: granted.length }, createdAt: FieldValue.serverTimestamp(),
      });
      tx.set(db.collection('notifications').doc(), {
        recipientId: creatorId, type: 'membership',
        title: 'Memberships gifted!',
        body: 'Someone gifted ' + granted.length + ' membership(s) to your channel',
        senderId: uid, read: false, data: { tierId }, createdAt: FieldValue.serverTimestamp(),
      });
      tx.set(db.collection('app_config').doc('general'), { membershipsActive: true }, { merge: true });
      return { ok: true, granted: granted.length, total };
    });

    // Post-commit, exactly like the paid path: this transaction never reads the
    // creator's wallet, so there is no VP here to price the share with.
    await settleEarnedShare(db, {
      uid: creatorId, coins: result.total,
      source: 'membership', sourceId: 'membership_gift:' + creatorId + ':' + uid + ':' + now,
    });
    return result;
  },
);
exports.subscribeMembership = functions.https.onCall(
  { region: REGION, cors: true },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) throw new functions.https.HttpsError('unauthenticated', 'Sign in required.');
    const { creatorId, tierId, paymentType = 'coins' } = request.data || {};
    if (!creatorId || !tierId) throw new functions.https.HttpsError('invalid-argument', 'creatorId and tierId required.');
    if (creatorId === uid) throw new functions.https.HttpsError('failed-precondition', "You can't subscribe to yourself.");
    if (paymentType !== 'coins') throw new functions.https.HttpsError('unimplemented', 'Card subscriptions coming soon.');

    const { tier } = await loadTier(creatorId, tierId);
    const price = Math.max(0, Math.floor(tier.priceCoins || 0));
    if (price <= 0) throw new functions.https.HttpsError('failed-precondition', 'This tier has no price set.');

    // One active sub per fan→creator (changing tier cancels the old one first, handled client-side).
    const existing = await db.collection('member_subscriptions')
      .where('userId', '==', uid).where('creatorId', '==', creatorId)
      .where('status', '==', 'active').limit(1).get();
    if (!existing.empty) throw new functions.https.HttpsError('already-exists', "You're already a member of this creator.");

    // Seat limit (best-effort pre-check).
    if (tier.seatLimit && Number(tier.seatLimit) > 0) {
      const taken = await activeSeatCount(creatorId, tierId);
      if (taken >= Number(tier.seatLimit)) throw new functions.https.HttpsError('resource-exhausted', 'This tier is sold out.');
    }

    const now = Date.now();
    const periodEnd = now + PERIOD_MS;
    // ONE RATE (2026-08-14). See the renewal path below for the full note: the
    // whole price is gross revenue, Vergr's share is taken once at the
    // revenue-share step, never twice.
    const platformFee = 0;
    const creatorAmount = price;
    // Native VERGR groups linked to this tier → auto-invite after payment.
    const groupIds = (tier.communities || [])
      .filter((c) => c.type === 'vergr_group' && c.groupId).map((c) => c.groupId);

    return db.runTransaction(async (tx) => {
      const walletRef = db.collection('wallets').doc(uid);
      const wallet = await tx.get(walletRef);
      const balance = wallet.exists ? (wallet.data().balance || 0) : 0;
      if (balance < price) throw new functions.https.HttpsError('failed-precondition', `Need ${price} coins. You have ${balance}.`);

      tx.update(walletRef, {
        balance: FieldValue.increment(-price),
        totalSpent: FieldValue.increment(price),
        updatedAt: FieldValue.serverTimestamp(),
      });
      tx.set(db.collection('wallets').doc(creatorId), {
        // earnedCoinCredit supplies balance + earnedBalance +
        // totalEarnedCoinsGross. That last field drives the revenue share
        // ladder, and this write used to omit it, so a creator earning only
        // through memberships stayed on the bottom rate forever.
        ...earnedCoinCredit(creatorAmount),
        totalEarned: FieldValue.increment(creatorAmount),
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });

      const subRef = db.collection('member_subscriptions').doc(`${creatorId}_${uid}`);
      tx.set(subRef, {
        userId: uid, creatorId, tierId,
        tierName: tier.name || 'Member',
        priceCoins: price,
        badge: tier.badge || null,
        communityGroupIds: groupIds,
        paymentType: 'coins',
        status: 'active',
        autoRenew: true,
        startedAt: FieldValue.serverTimestamp(),
        periodStart: now,
        periodEnd,
        renewsAt: periodEnd,
        createdAt: FieldValue.serverTimestamp(),
      });

      tx.set(db.collection('transactions').doc(), {
        userId: uid, type: 'membership', amount: -price, currency: 'coins',
        description: `Subscribed to ${tier.name || 'membership'}`,
        meta: { creatorId, tierId }, createdAt: FieldValue.serverTimestamp(),
      });
      tx.set(db.collection('notifications').doc(), {
        recipientId: creatorId, type: 'membership',
        title: 'New member!', body: `Someone joined your ${tier.name || 'membership'} tier`,
        senderId: uid, read: false, data: { tierId }, createdAt: FieldValue.serverTimestamp(),
      });

      // Arm the daily renewal cron. Until the first sub ever exists, the cron
      // early-returns on one cheap read instead of running two queries a day.
      tx.set(db.collection('app_config').doc('general'), { membershipsActive: true }, { merge: true });

      return { ok: true, subscriptionId: subRef.id, periodEnd, creatorAmount };
    }).then(async (result) => {
      // AUTO-CONVERT AT RECEIPT: the creator's share becomes gems immediately, at
      // their commission rate right now, rather than whatever rate they hold when
      // they later choose to cash out. Post-commit because this transaction never
      // reads the creator's wallet (it uses set/merge), so there is no VP here to
      // price with. See coinLedger.js → settleEarnedShare.
      await settleEarnedShare(db, {
        uid: creatorId, coins: result.creatorAmount,
        source: 'membership', sourceId: `membership:${result.subscriptionId}`,
      });

      // Community auto-invite: add the new member to each linked native VERGR group
      // the creator actually owns/admins. Best-effort, post-commit. Discord/Telegram
      // stay as shared invite links (we can't programmatically add to those for free).
      for (const gid of groupIds) {
        try {
          const gRef = db.collection('conversations').doc(gid);
          const g = await gRef.get();
          if (!g.exists || !g.data().isGroup) continue;
          const gd = g.data();
          const ownsGroup = gd.createdBy === creatorId || (Array.isArray(gd.admins) && gd.admins.includes(creatorId));
          if (!ownsGroup) continue; // never auto-add to a group the creator doesn't run
          if ((gd.participants || []).includes(uid)) continue; // already in
          let name = 'Vergr Member', avatar = null;
          const u = await db.collection('users').doc(uid).get();
          if (u.exists) { name = u.data().displayName || u.data().username || name; avatar = u.data().avatar || u.data().photoURL || null; }
          await gRef.update({
            participants: FieldValue.arrayUnion(uid),
            [`metadata.${uid}`]: { name, avatar },
            lastMessageText: `${name} joined as a ${tier.name || 'member'}`,
            lastMessageAt: FieldValue.serverTimestamp(),
          });
        } catch (e) { /* one group failing must not break the subscribe */ }
      }

      // Stream "just subscribed" alert: if the creator is live right now, stamp the
      // stream doc so the overlay fires (mirrors lastTip). Best-effort, post-commit,
      // only on NEW subs (renewals don't alert). Both broadcaster + viewers already
      // subscribe to the stream doc, so this is crowd-visible at zero extra reads.
      try {
        const live = await db.collection('streams')
          .where('hostUid', '==', creatorId).where('status', '==', 'live').limit(1).get();
        if (!live.empty) {
          let fromName = 'Someone';
          const u = await db.collection('users').doc(uid).get();
          if (u.exists) fromName = u.data().displayName || u.data().username || 'Someone';
          await live.docs[0].ref.update({
            lastSub: { tierName: tier.name || 'Member', fromName, priceCoins: price, badge: tier.badge || null, ts: Date.now() },
          });
        }
      } catch (e) { /* alert is best-effort */ }
      return result;
    });
  }
);

// ─────────────────────────────────────────────────────────────────────
// cancelMembership — stop auto-renew; access stays until periodEnd.
// ─────────────────────────────────────────────────────────────────────
exports.cancelMembership = functions.https.onCall(
  { region: REGION, cors: true },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) throw new functions.https.HttpsError('unauthenticated', 'Sign in required.');
    const { subscriptionId } = request.data || {};
    if (!subscriptionId) throw new functions.https.HttpsError('invalid-argument', 'subscriptionId required.');
    const subRef = db.collection('member_subscriptions').doc(subscriptionId);
    const sub = await subRef.get();
    if (!sub.exists) throw new functions.https.HttpsError('not-found', 'Subscription not found.');
    if (sub.data().userId !== uid) throw new functions.https.HttpsError('permission-denied', 'Not your subscription.');
    await subRef.update({
      autoRenew: false,
      cancelAtPeriodEnd: true,
      cancelledAt: FieldValue.serverTimestamp(),
    });
    return { ok: true, activeUntil: sub.data().periodEnd || null };
  }
);

// ─────────────────────────────────────────────────────────────────────
// getMyMemberships — fan's subs (active + lapsing), enriched with creator profile.
// ─────────────────────────────────────────────────────────────────────
exports.getMyMemberships = functions.https.onCall(
  { region: REGION, cors: true },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) throw new functions.https.HttpsError('unauthenticated', 'Sign in required.');
    const snap = await db.collection('member_subscriptions')
      .where('userId', '==', uid)
      .where('status', '==', 'active')
      .limit(100).get();
    const subs = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    // Enrich with creator display info.
    const creatorIds = [...new Set(subs.map((s) => s.creatorId))];
    const profiles = {};
    await Promise.all(creatorIds.map(async (cid) => {
      const u = await db.collection('users').doc(cid).get();
      if (u.exists) {
        const d = u.data();
        profiles[cid] = { username: d.username || d.displayName || 'creator', displayName: d.displayName || d.username || 'Creator', avatar: d.avatar || d.photoURL || null, isVerified: !!d.isVerified };
      }
    }));
    return {
      memberships: subs.map((s) => ({
        id: s.id, creatorId: s.creatorId, tierId: s.tierId, tierName: s.tierName,
        priceCoins: s.priceCoins, badge: s.badge || null,
        autoRenew: s.autoRenew !== false, cancelAtPeriodEnd: !!s.cancelAtPeriodEnd,
        periodEnd: s.periodEnd || null, renewsAt: s.renewsAt || s.periodEnd || null,
        startedAt: s.periodStart || null,
        creator: profiles[s.creatorId] || null,
      })),
    };
  }
);

// ─────────────────────────────────────────────────────────────────────
// renewMemberSubscriptions — daily cron. Folded into cronDaily (defer shim).
// 1. Auto-debit active+autoRenew subs whose period is ending, if the fan has coins.
// 2. Lapse subs that ended without renewal (cancelled, or insufficient coins).
// ─────────────────────────────────────────────────────────────────────
const defer = (_opts, fn) => fn; // cron-consolidation shim (see index.js cronDaily)
exports.renewMemberSubscriptions = defer(
  { schedule: '0 3 * * *', region: REGION, timeZone: 'UTC' },
  async () => {
    // Cheap gate: the very first subscribeMembership sets this flag. Until then,
    // the cron does nothing (one doc read), so it never runs queries on an empty
    // app. Once memberships exist it stays armed.
    const cfg = await db.collection('app_config').doc('general').get();
    if (cfg.data()?.membershipsActive !== true) { console.log('renewMemberSubscriptions: no memberships yet, skipping'); return; }

    const now = Date.now();
    const oneHour = 3600 * 1000;
    let renewed = 0, failed = 0, lapsed = 0;

    // ─── Step 1: auto-debit subs ending within the next hour ───
    const due = await db.collection('member_subscriptions')
      .where('status', '==', 'active')
      .where('autoRenew', '==', true)
      .where('periodEnd', '<=', now + oneHour)
      .limit(500).get();

    for (const docSnap of due.docs) {
      const s = docSnap.data();
      const price = Math.max(0, Math.floor(s.priceCoins || 0));
      if (price <= 0) continue;
      // ONE RATE (2026-08-14). No surface fee here any more: the full price is
      // gross revenue, and Vergr's share is taken once, at the revenue-share
      // step in coinLedger.js. Taking 10% here AND the ladder later was the
      // double deduction the revenue-share model exists to remove.
      const platformFee = 0;
      const creatorAmount = price;
      const newPeriodEnd = (s.periodEnd || now) + PERIOD_MS;
      try {
        await db.runTransaction(async (tx) => {
          const walletRef = db.collection('wallets').doc(s.userId);
          const wallet = await tx.get(walletRef);
          const balance = wallet.exists ? (wallet.data().balance || 0) : 0;
          if (balance < price) throw new Error('insufficient_coins');

          tx.update(walletRef, { balance: FieldValue.increment(-price), totalSpent: FieldValue.increment(price) });
          tx.set(db.collection('wallets').doc(s.creatorId), {
            // See the first-subscription write above. This object also used to
            // declare totalEarned twice.
            ...earnedCoinCredit(creatorAmount),
            totalEarned: FieldValue.increment(creatorAmount),
          }, { merge: true });
          tx.update(docSnap.ref, { periodStart: s.periodEnd || now, periodEnd: newPeriodEnd, renewsAt: newPeriodEnd });
          tx.set(db.collection('transactions').doc(), {
            userId: s.userId, type: 'membership_renewal', amount: -price, currency: 'coins',
            description: `${s.tierName || 'Membership'} auto-renewed (${price} coins)`,
            meta: { creatorId: s.creatorId, tierId: s.tierId }, createdAt: FieldValue.serverTimestamp(),
          });
          tx.set(db.collection('notifications').doc(), {
            recipientId: s.userId, type: 'membership',
            title: `${s.tierName || 'Membership'} renewed`,
            body: `${price} coins charged. Next renewal ${new Date(newPeriodEnd).toLocaleDateString()}.`,
            read: false, createdAt: FieldValue.serverTimestamp(),
          });
        });
        renewed++;
        // Auto-convert the creator's share at their CURRENT rate, post-commit.
        // Idempotent on the period end, so a cron retry over the same renewal
        // cannot convert twice.
        await settleEarnedShare(db, {
          uid: s.creatorId, coins: creatorAmount,
          source: 'membership_renewal',
          sourceId: `membership_renewal:${docSnap.id}:${newPeriodEnd}`,
        });
      } catch (e) {
        failed++;
        // Insufficient coins → nudge the fan, leave the sub to lapse in Step 2 once expired.
        await db.collection('member_subscriptions').doc(docSnap.id).update({ autoRenew: false, renewFailedAt: FieldValue.serverTimestamp() }).catch(() => {});
        await db.collection('notifications').add({
          recipientId: s.userId, type: 'membership_topup_needed',
          title: `Top up to keep your ${s.tierName || 'membership'}`,
          body: `Buy ${price} coins to stay subscribed to your creator.`,
          read: false, data: { action: 'buy_coins' }, createdAt: FieldValue.serverTimestamp(),
        }).catch(() => {});
      }
    }

    // ─── Step 2: lapse subs whose period has passed without renewal ───
    const ended = await db.collection('member_subscriptions')
      .where('status', '==', 'active')
      .where('periodEnd', '<', now - oneHour)
      .limit(500).get();
    for (const docSnap of ended.docs) {
      const s = docSnap.data();
      if (s.autoRenew === true) continue; // still renewing (race) — leave it
      await docSnap.ref.update({ status: 'expired', expiredAt: FieldValue.serverTimestamp() });
      // Remove the lapsed member from any auto-invited VERGR groups.
      for (const gid of (s.communityGroupIds || [])) {
        try {
          await db.collection('conversations').doc(gid).update({
            participants: FieldValue.arrayRemove(s.userId),
            [`metadata.${s.userId}`]: FieldValue.delete(),
          });
        } catch (e) { /* best-effort */ }
      }
      await db.collection('notifications').add({
        recipientId: s.userId, type: 'membership_expired',
        title: `Your ${s.tierName || 'membership'} ended`,
        body: 'Resubscribe anytime to get your perks and badge back.',
        read: false, data: { creatorId: s.creatorId }, createdAt: FieldValue.serverTimestamp(),
      }).catch(() => {});
      lapsed++;
    }

    console.log(`renewMemberSubscriptions: renewed=${renewed} failed=${failed} lapsed=${lapsed}`);
  }
);
