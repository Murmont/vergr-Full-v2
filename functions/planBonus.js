// functions/planBonus.js — the Lite/Pro bonus (boost coins + VP), paid ONCE PER
// PAID PERIOD, the moment that period is paid for.
//
// Until 2026-09-28 it was paid by a calendar cron on the 1st of the month, so a
// user who subscribed on the 2nd waited a month for the bonus they had paid for
// (founder: "logically stupid"). Every rail now calls grantPlanBonus when it
// grants or renews a period: coins (subscribe + auto-renew), card (settleOrder),
// Google Play and Huawei (redeem + the daily store sync, which sees a new expiry
// at each renewal), and admin comps.
//
// Idempotency lives in quest_claims (server-only in firestore.rules), never on
// the wallet: the wallet rule is a denylist and its create rule allows new
// fields, so a wallet marker could be reset from the client to farm bonuses.
//   quest_claims/{uid}_plan_bonus_last = { at, plan, periodEnd }
// A period is paid when its periodEnd differs from the last one paid AND at least
// MIN_GAP_MS has passed (a store can nudge an expiry by hours; that must not pay
// twice), or when the plan went UP from lite to pro (a paid upgrade).
//
// ⚠ Coins go to boostCoins, NEVER balance (founder, 2026-09-27): bonus coins buy
// boosts and VP packs only and can never be tipped. ad-reward-check guards the
// list of files allowed to touch boostCoins.

const { FieldValue } = require('firebase-admin/firestore');

const MONTHLY_VP_BONUS = { free: 0, lite: 1000, pro: 3000 };
const MONTHLY_COIN_BONUS = { free: 0, lite: 50, pro: 150 };
const MIN_GAP_MS = 20 * 24 * 3600 * 1000;

const toMs = (v) => {
  if (v == null) return 0;
  if (typeof v === 'number') return v;
  if (typeof v.toMillis === 'function') return v.toMillis();
  if (v.seconds) return v.seconds * 1000;
  return 0;
};

/** Pure decision, exported for tests. */
function shouldPay(last, plan, periodEndMs, now) {
  if (!MONTHLY_VP_BONUS[plan] && !MONTHLY_COIN_BONUS[plan]) return false;
  if (!last) return true;
  if (plan === 'pro' && last.plan === 'lite' && Number(last.periodEnd) !== Number(periodEndMs)) return true;
  if (Number(last.periodEnd) === Number(periodEndMs)) return false;
  return now - toMs(last.at) >= MIN_GAP_MS;
}

/**
 * Grant the bonus for one paid period. Safe to call repeatedly: the second call
 * for the same period does nothing. Never throws (a bonus must never fail a
 * purchase); returns { paid, reason }.
 */
async function grantPlanBonus(db, uid, plan, periodEndMs, source) {
  try {
    if (!uid || !periodEndMs) return { paid: false, reason: 'missing' };
    const lastRef = db.collection('quest_claims').doc(`${uid}_plan_bonus_last`);
    const walletRef = db.collection('wallets').doc(uid);
    const now = Date.now();
    const monthKey = new Date(now).toISOString().slice(0, 7);
    // The calendar cron's claim for this month (before 2026-09-28). A user it
    // already paid this month is not paid again for the same period.
    const legacyRef = db.collection('quest_claims').doc(`${uid}_plan_bonus_${monthKey}`);

    return await db.runTransaction(async (tx) => {
      const lastSnap = await tx.get(lastRef);
      let last = lastSnap.exists ? lastSnap.data() : null;
      if (!last) {
        const legacy = await tx.get(legacyRef);
        if (legacy.exists) {
          const l = legacy.data();
          // Treat the cron payment as this period's bonus.
          tx.set(lastRef, { userId: uid, at: toMs(l.claimedAt) || now, plan: l.plan || plan, periodEnd: periodEndMs, source: 'legacy_cron' });
          return { paid: false, reason: 'paid_by_cron_this_month' };
        }
      }
      if (!shouldPay(last, plan, periodEndMs, now)) return { paid: false, reason: 'already_paid' };

      const vp = MONTHLY_VP_BONUS[plan];
      const coins = MONTHLY_COIN_BONUS[plan];
      const ws = await tx.get(walletRef);
      tx.set(walletRef, {
        boostCoins: FieldValue.increment(coins),
        vp: FieldValue.increment(vp),
        tier: plan,
        updatedAt: new Date(now),
        ...(!ws.exists ? { createdAt: new Date(now), balance: 0, totalSpent: 0 } : {}),
      }, { merge: true });
      tx.set(lastRef, { userId: uid, at: now, plan, periodEnd: periodEndMs, source: source || null });
      tx.set(db.collection('quest_claims').doc(`${uid}_plan_bonus_p${periodEndMs}`), {
        userId: uid, questId: 'plan_bonus', plan, coins, vp, periodEnd: periodEndMs, source: source || null, claimedAt: new Date(now),
      });
      tx.set(db.collection('transactions').doc(), {
        userId: uid, type: 'plan_bonus', amount: coins, currency: 'boost_coins',
        description: `${plan === 'pro' ? 'Pro' : 'Lite'} bonus: +${coins} boost coins + ${vp} VP`,
        createdAt: new Date(now),
      });
      tx.set(db.collection('notifications').doc(), {
        recipientId: uid, type: 'coins',
        title: `+${coins} boost coins + ${vp} VP`,
        body: `Your ${plan === 'pro' ? 'Pro' : 'Lite'} bonus is here. Boost coins buy boosts and VP packs.`,
        read: false, data: { type: 'plan_bonus', plan, coins, vp }, createdAt: new Date(now),
      });
      return { paid: true };
    });
  } catch (e) {
    console.error('grantPlanBonus failed', uid, plan, e && e.message);
    return { paid: false, reason: 'error' };
  }
}

module.exports = { grantPlanBonus, shouldPay, MONTHLY_VP_BONUS, MONTHLY_COIN_BONUS, MIN_GAP_MS };
