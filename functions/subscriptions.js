// VERGR subscriptions — coin-funded. Users buy coins via PayRam, then spend
// coins to subscribe. This module handles:
//
// - subscribeWithCoins      — debit user's wallet, activate tier instantly (Tier B)
// - cancelSubscription      — flip autoRenew=false; existing period stays active
// - renewExpiringSubscriptions — daily cron, sends VERGR-branded reminder push
//                              + email + in-app banner 3 days before expiry
// - chargeAutoRenewCoinSubs   — same daily cron, debits coin-funded subs
//                              the moment their period ends if they have coins

const functions = require('firebase-functions/v2');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');

const REGION = 'europe-west1';
const db = getFirestore('vgrdb');

// Mirror of TIERS in src/utils/tierSystem.js (price-only). Update both together.
const TIER_COIN_PRICE = { lite: 500, pro: 1000 };
const TIER_EUR_PRICE  = { lite: 4.99, pro: 9.99 };
const PERIOD_MS = 30 * 24 * 3600 * 1000;
const RENEWAL_REMINDER_DAYS = [3, 1]; // send reminders at T-3 and T-1 days

// ─────────────────────────────────────────────────────────────────────
// subscribeWithCoins — Tier B. User debits their VERGR coin wallet for
// a month of Lite/Pro. Instant activation, no NOWPayments call.
// ─────────────────────────────────────────────────────────────────────
exports.subscribeWithCoins = functions.https.onCall(
  { region: REGION, cors: true },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) throw new functions.https.HttpsError('unauthenticated', 'Sign in required.');
    const { tier } = request.data || {};
    const cost = TIER_COIN_PRICE[tier];
    if (!cost) throw new functions.https.HttpsError('invalid-argument', 'Unknown tier');

    const now = Date.now();
    const periodEnd = now + PERIOD_MS;

    const out = await db.runTransaction(async (tx) => {
      const walletRef = db.collection('wallets').doc(uid);
      const userRef = db.collection('users').doc(uid);
      const wallet = await tx.get(walletRef);
      if (!wallet.exists) throw new functions.https.HttpsError('failed-precondition', 'Wallet not found.');
      const balance = wallet.data().balance || 0;
      if (balance < cost) {
        throw new functions.https.HttpsError('failed-precondition',
          `Need ${cost} coins for ${tier === 'lite' ? 'Lite' : 'Pro'}. You have ${balance}.`);
      }

      tx.update(walletRef, {
        balance: FieldValue.increment(-cost),
        totalSpent: FieldValue.increment(cost),
      });

      tx.update(userRef, {
        subscription: tier,
        subscriptionPeriodStart: now,
        subscriptionPeriodEnd: periodEnd,
        subscriptionAutoRenew: true,
        subscriptionPreferredMethod: 'coins',
      });

      tx.set(db.collection('subscriptions').doc(`${uid}_${now}`), {
        userId: uid, tier, method: 'coins', coinsCharged: cost,
        periodStart: now, periodEnd, status: 'active',
        createdAt: FieldValue.serverTimestamp(),
      });

      tx.set(db.collection('transactions').doc(), {
        userId: uid, type: 'subscription_coins',
        amount: -cost, currency: 'coins',
        description: `${tier === 'lite' ? 'Lite' : 'Pro'} subscription — 1 month (${cost} coins)`,
        meta: { tier },
        createdAt: FieldValue.serverTimestamp(),
      });

      tx.set(db.collection('notifications').doc(), {
        recipientId: uid, type: 'subscription',
        title: `${tier === 'lite' ? 'Lite' : 'Pro'} active!`,
        body: `${cost} coins charged. Renews on ${new Date(periodEnd).toLocaleDateString()}.`,
        read: false, data: { tier },
        createdAt: FieldValue.serverTimestamp(),
      });

      return { ok: true, tier, periodEnd };
    });

    // Coins spent HERE never become anyone's withdrawable balance, so the payout
    // liability accrued when they were sold is released in full. This is the
    // most profitable thing a coin can do: ~500 coins spent on Lite return the
    // full sticker, the same coins tipped return 22-36%. Nothing was counting
    // it, so nobody could tell whether the sink mattered.
    //
    // Post-commit and separately guarded: bookkeeping must never fail a
    // subscription the user has already been told is active. Idempotent on
    // sourceId, so a transaction retry cannot double-release.
    try {
      const { bookPlatformSink } = require('./platformRevenue');
      await bookPlatformSink({
        uid, coins: cost, sink: `subscription_${tier}`, sourceId: `sub:${uid}:${now}`,
      });
    } catch (e) {
      console.error('bookPlatformSink failed', uid, e?.message || e);
    }

    return out;
  }
);

// ─────────────────────────────────────────────────────────────────────
// cancelSubscription — flip autoRenew=false. User keeps tier until period end.
// ─────────────────────────────────────────────────────────────────────
exports.cancelSubscription = functions.https.onCall(
  { region: REGION, cors: true },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) throw new functions.https.HttpsError('unauthenticated', 'Sign in required.');
    const userRef = db.collection('users').doc(uid);
    await userRef.update({
      subscriptionAutoRenew: false,
      subscriptionCancelledAt: FieldValue.serverTimestamp(),
    });
    const snap = await userRef.get();
    return {
      ok: true,
      activeUntil: snap.data().subscriptionPeriodEnd || null,
    };
  }
);

// ─────────────────────────────────────────────────────────────────────
// renewExpiringSubscriptions — daily cron at 06:00 UTC.
// 1. Coin-funded subs (Tier B) where periodEnd ≤ now + 1 hour AND
//    autoRenew=true AND wallet has enough coins → auto-debit + extend
// 2. Card subs (Tier A) where periodEnd is T-3 or T-1 → send reminder
//    push + email + in-app banner via FCM (VERGR-branded, not NOWPayments)
// 3. Subs where periodEnd has passed AND no autoRenew or insufficient coins
//    → downgrade user to free tier
// ─────────────────────────────────────────────────────────────────────
const defer = (_opts, fn) => fn; // cron-consolidation shim (see index.js cronDaily)
exports.renewExpiringSubscriptions = defer(
  { schedule: '0 6 * * *', region: REGION, timeZone: 'UTC' },
  async () => {
    const now = Date.now();
    const oneHour = 3600 * 1000;
    const threeDays = 3 * 24 * oneHour;
    const oneDay = 24 * oneHour;

    // ─── Step 1: Auto-debit Tier B (coins) subs that are ending ───
    const coinSubsExpiring = await db.collection('users')
      .where('subscriptionAutoRenew', '==', true)
      .where('subscriptionPreferredMethod', '==', 'coins')
      .where('subscriptionPeriodEnd', '<=', now + oneHour)
      .where('subscriptionPeriodEnd', '>', now - oneDay)
      .limit(500)
      .get();

    let renewed = 0, failed = 0;
    for (const doc of coinSubsExpiring.docs) {
      const u = doc.data();
      const cost = TIER_COIN_PRICE[u.subscription];
      if (!cost) continue;
      try {
        await db.runTransaction(async (tx) => {
          const walletRef = db.collection('wallets').doc(doc.id);
          const wallet = await tx.get(walletRef);
          const balance = wallet.exists ? (wallet.data().balance || 0) : 0;
          if (balance < cost) throw new Error('insufficient_coins');

          const newPeriodEnd = (u.subscriptionPeriodEnd || now) + PERIOD_MS;
          tx.update(walletRef, {
            balance: FieldValue.increment(-cost),
            totalSpent: FieldValue.increment(cost),
          });
          tx.update(doc.ref, {
            subscriptionPeriodStart: u.subscriptionPeriodEnd || now,
            subscriptionPeriodEnd: newPeriodEnd,
          });
          tx.set(db.collection('subscriptions').doc(`${doc.id}_${now}`), {
            userId: doc.id, tier: u.subscription, method: 'coins',
            coinsCharged: cost, periodStart: u.subscriptionPeriodEnd || now,
            periodEnd: newPeriodEnd, status: 'active',
            renewalOf: true,
            createdAt: FieldValue.serverTimestamp(),
          });
          tx.set(db.collection('transactions').doc(), {
            userId: doc.id, type: 'subscription_coins_renewal',
            amount: -cost, currency: 'coins',
            description: `${u.subscription} subscription auto-renewed (${cost} coins)`,
            meta: { tier: u.subscription },
            createdAt: FieldValue.serverTimestamp(),
          });
          tx.set(db.collection('notifications').doc(), {
            recipientId: doc.id, type: 'subscription',
            title: `${u.subscription === 'lite' ? 'Lite' : 'Pro'} renewed!`,
            body: `${cost} coins charged. Next renewal: ${new Date(newPeriodEnd).toLocaleDateString()}.`,
            read: false, data: { tier: u.subscription },
            createdAt: FieldValue.serverTimestamp(),
          });
        });
        renewed++;
      } catch (e) {
        failed++;
        // Coin-funded auto-renew failed (insufficient coins) — send a top-up nudge
        await db.collection('notifications').add({
          recipientId: doc.id, type: 'subscription_topup_needed',
          title: `Top up to keep ${u.subscription === 'lite' ? 'Lite' : 'Pro'}`,
          body: `Your subscription expires ${new Date(u.subscriptionPeriodEnd).toLocaleDateString()}. Buy ${TIER_COIN_PRICE[u.subscription]} coins to renew.`,
          read: false, data: { tier: u.subscription, action: 'buy_coins' },
          createdAt: FieldValue.serverTimestamp(),
        });
      }
    }

    // ─── Step 2: Send reminders to Tier A (card) subs at T-3 and T-1 ───
    for (const days of RENEWAL_REMINDER_DAYS) {
      const target = now + days * oneDay;
      const cardRemindable = await db.collection('users')
        .where('subscriptionAutoRenew', '==', true)
        .where('subscriptionPreferredMethod', '==', 'card')
        .where('subscriptionPeriodEnd', '>', target - oneHour)
        .where('subscriptionPeriodEnd', '<=', target + oneHour)
        .limit(500)
        .get();
      for (const doc of cardRemindable.docs) {
        const u = doc.data();
        const lastReminderKey = `subscriptionRemindedDays${days}`;
        if (u[lastReminderKey] && (now - u[lastReminderKey]) < oneDay) continue; // already reminded
        await doc.ref.update({ [lastReminderKey]: now });
        await db.collection('notifications').add({
          recipientId: doc.id, type: 'subscription_renewal_reminder',
          title: `${u.subscription === 'lite' ? 'Lite' : 'Pro'} renews in ${days} day${days === 1 ? '' : 's'}`,
          body: `€${TIER_EUR_PRICE[u.subscription]} on ${new Date(u.subscriptionPeriodEnd).toLocaleDateString()}. Tap to confirm or cancel.`,
          read: false, data: { tier: u.subscription, action: 'renew_card', days },
          createdAt: FieldValue.serverTimestamp(),
        });
      }
    }

    // ─── Step 3: Downgrade users whose period ended without renewal ───
    const expired = await db.collection('users')
      .where('subscriptionPeriodEnd', '<', now - oneHour)
      .where('subscription', 'in', ['lite', 'pro'])
      .limit(500)
      .get();
    let downgraded = 0;
    for (const doc of expired.docs) {
      await doc.ref.update({
        subscription: 'free',
        subscriptionDowngradedFrom: doc.data().subscription,
        subscriptionDowngradedAt: FieldValue.serverTimestamp(),
      });
      await db.collection('notifications').add({
        recipientId: doc.id, type: 'subscription_expired',
        title: `Your ${doc.data().subscription === 'lite' ? 'Lite' : 'Pro'} plan ended`,
        body: `Resubscribe anytime to get your perks back. Your stats and content are safe.`,
        read: false, data: { tier: doc.data().subscription },
        createdAt: FieldValue.serverTimestamp(),
      });
      downgraded++;
    }

    console.log(`renewExpiringSubscriptions: renewed=${renewed} failed=${failed} downgraded=${downgraded}`);
  }
);
