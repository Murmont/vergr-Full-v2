// Coin sale promos: "buy a pack, get extra coins or extra VP".
//
// THE ONE RULE THAT KEEPS PAYMENTS UNTOUCHED
//
// A promo changes the QUANTITY DELIVERED, never the PRICE CHARGED.
//
// PayRam and Play Billing keep charging exactly the same USD. The server adds
// bonus coins or VP when it credits the purchase. Nothing in pricing, checkout,
// cart, tax or settlement changes, which is the whole reason this is safe to
// ship next to a live payment rail. Discounting the price instead would touch
// every one of those.
//
// This is not a new mechanism either: COIN_PACKS already carries `vpBonus`, live
// on Titan (+1,500) and Ascendant (+3,000). A promo is that field, made
// temporary and configurable.
//
// ONE RESOLVER, BOTH RAILS
//
// There are two independent pack maps with deliberately different coin counts,
// because Play takes 30%:
//
//   web     functions/payram.js      COIN_PACKS       pro: 815 coins / $9.99
//   android functions/playBilling.js PLAY_PRODUCTS    coins_pro: 1000 coins
//
// A promo applied to one and not the other silently works on web and not on
// Android. This codebase has been bitten by mirrored constants repeatedly, so
// this module is the single source both rails require. Never copy it.
//
// EXPOSURE, AND WHY IT IS CAPPED
//
// The old "never discount coins" warning was about buy-cheap, tip, withdraw.
// Withdrawal is deleted, so that loop is gone. What remains is the revenue
// share: a creator receiving a tip accrues real USD in `wallets.owedMicroUsd` at
// the full rate, so bonus coins tipped onward do become a real liability.
// Founder call (2026-08-17) is to accept that as a marketing cost, so every
// promo carries a HARD issuance cap and the cap is enforced inside the credit
// transaction, not before it.

const functions = require('firebase-functions/v2');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const { requireAdminScreen } = require('./adminAccess');
const { adminRateLimit, auditAdminAction, extractRequestMeta } = require('./adminSecurity');

const db = getFirestore('vgrdb');
const REGION = 'europe-west1';
const HttpsError = functions.https.HttpsError;
const SCREEN = 'economy';

const COL = 'coin_promos';
const REDEMPTIONS = 'promo_redemptions';

const BONUS_KINDS = ['coins_pct', 'coins_flat', 'vp_flat', 'vp_pct'];

// Ceilings on what a single promo can be configured to do. These are not the
// per-promo cap (that is `totalBonusCoinsCap`), they are the guard against a
// typo: an extra zero in a percentage field should be rejected, not honoured.
const MAX_PCT = 100;
const MAX_FLAT_COINS = 25_000;
const MAX_FLAT_VP = 100_000;

const toMs = (t) => (t && typeof t.toMillis === 'function' ? t.toMillis() : (t ? Number(t) : null));

/**
 * The single active promo, or null.
 *
 * If more than one is active the HIGHEST bonus wins and the overlap is logged.
 * Stacking promos is how you give away the treasury by accident, so they never
 * combine.
 */
async function resolveActivePromo(now = Date.now()) {
  const snap = await db.collection(COL).where('active', '==', true).limit(10).get();
  if (snap.empty) return null;

  const live = snap.docs
    .map((d) => ({ promoId: d.id, ...d.data() }))
    .filter((p) => {
      const s = toMs(p.startsAt);
      const e = toMs(p.endsAt);
      if (s && now < s) return false;
      if (e && now > e) return false;
      return true;
    });
  if (!live.length) return null;
  if (live.length > 1) {
    console.warn('coinPromos: %d promos active at once, taking the largest:',
      live.length, live.map((p) => p.promoId).join(', '));
  }
  // Rank by a rough magnitude so "highest bonus wins" is deterministic rather
  // than whichever document came back first.
  const rank = (p) => {
    const b = p.bonus || {};
    if (b.kind === 'coins_pct') return b.value * 100;
    if (b.kind === 'coins_flat') return b.value;
    if (b.kind === 'vp_pct') return b.value * 10;
    return (b.value || 0) / 10;
  };
  return live.sort((a, b) => rank(b) - rank(a))[0];
}

/**
 * What this purchase earns on top of the pack.
 *
 * Pure and synchronous so it is unit-testable and so both rails compute an
 * identical answer from an identical promo document.
 *
 * The CLIENT never calls this. Per reference-client-side-price-constant the
 * client sends WHAT is being bought, never HOW MUCH it is worth, and that rule
 * extends to bonuses.
 */
function bonusFor({ promo, packId, coins, priceUSD }) {
  const none = { bonusCoins: 0, bonusVp: 0, promoId: null };
  if (!promo || !promo.bonus) return none;

  const applies = promo.appliesTo;
  if (applies && applies !== 'all') {
    const ids = applies.packIds || [];
    if (!packId || !ids.includes(packId)) return none;
  }
  // A custom amount is excluded unless the promo says otherwise: custom amounts
  // have no pack id, so "all packs" should not silently include them.
  if (!packId && !(applies === 'all' && promo.includeCustomAmounts === true)) return none;

  const b = promo.bonus;
  if (b.minSpendUSD && (priceUSD || 0) < b.minSpendUSD) return none;

  const base = Math.max(0, Number(coins) || 0);
  let bonusCoins = 0;
  let bonusVp = 0;
  switch (b.kind) {
    case 'coins_pct':  bonusCoins = Math.floor(base * (Number(b.value) || 0) / 100); break;
    case 'coins_flat': bonusCoins = Math.floor(Number(b.value) || 0); break;
    case 'vp_pct':     bonusVp = Math.floor(base * (Number(b.value) || 0) / 100); break;
    case 'vp_flat':    bonusVp = Math.floor(Number(b.value) || 0); break;
    default: return none;
  }
  if (bonusCoins <= 0 && bonusVp <= 0) return none;
  return { bonusCoins, bonusVp, promoId: promo.promoId };
}

/**
 * Claim a bonus for one order, atomically.
 *
 * Every limit is checked INSIDE the transaction alongside the redemption
 * record, so a webhook replay, a double settlement or two purchases landing at
 * once cannot exceed a cap or issue twice. Checking first and writing after is
 * exactly how a cap gets breached under load.
 *
 * Returns the bonus actually granted, which may be zero if a limit was hit.
 * Never throws: a promo problem must never fail a purchase the user has already
 * paid for. The worst case is that they get the coins they bought and no bonus.
 */
async function claimBonus({ promoId, uid, orderId, bonusCoins, bonusVp }) {
  if (!promoId || !uid || !orderId) return { bonusCoins: 0, bonusVp: 0 };
  const promoRef = db.collection(COL).doc(promoId);
  const redemptionRef = db.collection(REDEMPTIONS).doc(`${promoId}__${uid}__${orderId}`);

  try {
    return await db.runTransaction(async (tx) => {
      const [pSnap, rSnap] = await Promise.all([tx.get(promoRef), tx.get(redemptionRef)]);
      // Already granted for this order. Idempotent by construction.
      if (rSnap.exists) return { bonusCoins: 0, bonusVp: 0, duplicate: true };
      if (!pSnap.exists) return { bonusCoins: 0, bonusVp: 0 };
      const p = pSnap.data();
      if (p.active !== true) return { bonusCoins: 0, bonusVp: 0 };

      // The hard cap. This is the number that bounds the exposure, so it is
      // checked here and nowhere else.
      const capCoins = Number(p.totalBonusCoinsCap) || 0;
      if (capCoins > 0 && (Number(p.bonusCoinsIssued) || 0) + bonusCoins > capCoins) {
        return { bonusCoins: 0, bonusVp: 0, capped: true };
      }
      if (p.totalLimit && (Number(p.redemptions) || 0) >= p.totalLimit) {
        return { bonusCoins: 0, bonusVp: 0, capped: true };
      }
      if (p.perUserLimit) {
        // Counted from the user's own tally on the promo rather than a query,
        // so it stays inside the transaction.
        const used = Number(p.perUser?.[uid]) || 0;
        if (used >= p.perUserLimit) return { bonusCoins: 0, bonusVp: 0, capped: true };
      }

      tx.set(redemptionRef, {
        promoId, uid, orderId, bonusCoins, bonusVp, createdAt: FieldValue.serverTimestamp(),
      });
      tx.update(promoRef, {
        redemptions: FieldValue.increment(1),
        bonusCoinsIssued: FieldValue.increment(bonusCoins),
        bonusVpIssued: FieldValue.increment(bonusVp),
        ...(p.perUserLimit ? { [`perUser.${uid}`]: FieldValue.increment(1) } : {}),
      });
      return { bonusCoins, bonusVp };
    });
  } catch (e) {
    console.warn('coinPromos.claimBonus failed', promoId, orderId, e?.message || e);
    return { bonusCoins: 0, bonusVp: 0 };
  }
}

/**
 * The one call both rails make: resolve, compute, and return the bonus to add.
 *
 * `dryRun` computes without claiming, for the store badge and the admin
 * projection.
 */
async function applyPromo({ packId, coins, priceUSD, uid, orderId, dryRun = false }) {
  const promo = await resolveActivePromo();
  const calc = bonusFor({ promo, packId, coins, priceUSD });
  if (!calc.promoId) return { bonusCoins: 0, bonusVp: 0, promoId: null };
  if (dryRun) return calc;
  const granted = await claimBonus({
    promoId: calc.promoId, uid, orderId,
    bonusCoins: calc.bonusCoins, bonusVp: calc.bonusVp,
  });
  return { ...granted, promoId: granted.bonusCoins || granted.bonusVp ? calc.promoId : null };
}

// ────────────────────────────────────────────────────────────────────
// ADMIN
// ────────────────────────────────────────────────────────────────────

exports.adminUpsertCoinPromo = functions.https.onCall(
  { region: REGION, cors: true },
  async (request) => {
    const uid = request.auth?.uid;
    await requireAdminScreen(uid, SCREEN);
    await adminRateLimit(uid, 'promo_upsert', { perHour: 30, perDay: 100 });

    const {
      promoId = null, name, bonusKind, bonusValue, minSpendUSD = null,
      appliesTo = 'all', packIds = [], includeCustomAmounts = false,
      startsAt = null, endsAt = null, perUserLimit = null, totalLimit = null,
      totalBonusCoinsCap = null, active = false,
    } = request.data || {};

    if (!name || String(name).trim().length < 2) {
      throw new HttpsError('invalid-argument', 'Give the promo a name.');
    }
    if (!BONUS_KINDS.includes(bonusKind)) {
      throw new HttpsError('invalid-argument', `bonusKind must be one of ${BONUS_KINDS.join(', ')}.`);
    }
    const value = Number(bonusValue) || 0;
    if (value <= 0) throw new HttpsError('invalid-argument', 'The bonus has to be more than zero.');
    if (bonusKind.endsWith('_pct') && value > MAX_PCT) {
      throw new HttpsError('invalid-argument', `A percentage bonus cannot be more than ${MAX_PCT}%.`);
    }
    if (bonusKind === 'coins_flat' && value > MAX_FLAT_COINS) {
      throw new HttpsError('invalid-argument', `A flat coin bonus cannot be more than ${MAX_FLAT_COINS}.`);
    }
    if (bonusKind === 'vp_flat' && value > MAX_FLAT_VP) {
      throw new HttpsError('invalid-argument', `A flat VP bonus cannot be more than ${MAX_FLAT_VP}.`);
    }
    // A coin promo without a cap is an unbounded liability, because bonus coins
    // tipped onward accrue real USD to a creator. VP has no path out, so it does
    // not need one.
    const cap = Number(totalBonusCoinsCap) || 0;
    if (bonusKind.startsWith('coins_') && cap <= 0) {
      throw new HttpsError('invalid-argument',
        'A coin promo needs a total cap on bonus coins. Bonus coins can be tipped, '
        + 'and a tip becomes real money Vergr owes a creator, so the giveaway has to be bounded.');
    }

    const ref = promoId ? db.collection(COL).doc(String(promoId)) : db.collection(COL).doc();
    const existing = await ref.get();
    const fields = {
      name: String(name).trim().slice(0, 60),
      bonus: {
        kind: bonusKind,
        value,
        minSpendUSD: minSpendUSD ? Number(minSpendUSD) : null,
      },
      appliesTo: appliesTo === 'packs' ? { packIds: (packIds || []).slice(0, 20) } : 'all',
      includeCustomAmounts: !!includeCustomAmounts,
      startsAt: startsAt ? new Date(Number(startsAt)) : null,
      endsAt: endsAt ? new Date(Number(endsAt)) : null,
      perUserLimit: perUserLimit ? Number(perUserLimit) : null,
      totalLimit: totalLimit ? Number(totalLimit) : null,
      totalBonusCoinsCap: cap || null,
      active: !!active,
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: uid,
    };
    if (!existing.exists) {
      fields.redemptions = 0;
      fields.bonusCoinsIssued = 0;
      fields.bonusVpIssued = 0;
      fields.createdAt = FieldValue.serverTimestamp();
      fields.createdBy = uid;
    }
    await ref.set(fields, { merge: true });

    const meta = extractRequestMeta(request);
    await auditAdminAction({
      actor: uid,
      action: existing.exists ? 'promo_update' : 'promo_create',
      target: { type: 'coin_promo', id: ref.id },
      before: existing.exists ? { active: existing.data().active } : null,
      after: { name: fields.name, kind: bonusKind, value, active: fields.active, cap },
      ip: meta.ip, userAgent: meta.userAgent,
      stepUpEnforced: false, stepUpFresh: false,
    }).catch(() => {});

    return { ok: true, promoId: ref.id };
  },
);

exports.adminListCoinPromos = functions.https.onCall(
  { region: REGION, cors: true },
  async (request) => {
    const uid = request.auth?.uid;
    await requireAdminScreen(uid, SCREEN);
    const snap = await db.collection(COL).orderBy('createdAt', 'desc').limit(50).get();
    const now = Date.now();
    return {
      rows: snap.docs.map((d) => {
        const p = d.data();
        const s = toMs(p.startsAt);
        const e = toMs(p.endsAt);
        const issued = Number(p.bonusCoinsIssued) || 0;
        const cap = Number(p.totalBonusCoinsCap) || 0;
        return {
          promoId: d.id,
          name: p.name,
          active: p.active === true,
          // "live" is the honest state: active AND inside its window.
          live: p.active === true && (!s || now >= s) && (!e || now <= e),
          bonus: p.bonus || {},
          appliesTo: p.appliesTo === 'all' ? 'all' : (p.appliesTo?.packIds || []),
          startsAt: s, endsAt: e,
          perUserLimit: p.perUserLimit || null,
          totalLimit: p.totalLimit || null,
          totalBonusCoinsCap: cap || null,
          redemptions: Number(p.redemptions) || 0,
          bonusCoinsIssued: issued,
          bonusVpIssued: Number(p.bonusVpIssued) || 0,
          capUsedPct: cap > 0 ? Math.min(100, Math.round((issued / cap) * 100)) : null,
        };
      }),
    };
  },
);

exports.adminSetCoinPromoActive = functions.https.onCall(
  { region: REGION, cors: true },
  async (request) => {
    const uid = request.auth?.uid;
    await requireAdminScreen(uid, SCREEN);
    const { promoId, active } = request.data || {};
    if (!promoId) throw new HttpsError('invalid-argument', 'promoId required.');
    await db.collection(COL).doc(String(promoId)).update({ active: !!active });

    const meta = extractRequestMeta(request);
    await auditAdminAction({
      actor: uid, action: active ? 'promo_activate' : 'promo_deactivate',
      target: { type: 'coin_promo', id: String(promoId) },
      before: null, after: { active: !!active },
      ip: meta.ip, userAgent: meta.userAgent,
      stepUpEnforced: false, stepUpFresh: false,
    }).catch(() => {});
    return { ok: true };
  },
);

/**
 * What the store should show. Read-only, no claim.
 *
 * The client renders the badge from this and NEVER computes a bonus itself, so
 * the number on the card is by construction the number the server will credit.
 */
exports.getActiveCoinPromo = functions.https.onCall(
  { region: REGION, cors: true },
  async () => {
    const promo = await resolveActivePromo();
    if (!promo) return { promo: null };
    const cap = Number(promo.totalBonusCoinsCap) || 0;
    // A promo whose cap is spent is over, whatever the dates say. Showing a
    // badge for a bonus that will not be credited is worse than showing none.
    if (cap > 0 && (Number(promo.bonusCoinsIssued) || 0) >= cap) return { promo: null };
    return {
      promo: {
        promoId: promo.promoId,
        name: promo.name,
        kind: promo.bonus?.kind,
        value: promo.bonus?.value,
        minSpendUSD: promo.bonus?.minSpendUSD || null,
        packIds: promo.appliesTo === 'all' ? null : (promo.appliesTo?.packIds || []),
        endsAt: toMs(promo.endsAt),
      },
    };
  },
);

module.exports.resolveActivePromo = resolveActivePromo;
module.exports.bonusFor = bonusFor;
module.exports.claimBonus = claimBonus;
module.exports.applyPromo = applyPromo;
module.exports._internal = { BONUS_KINDS, MAX_PCT, MAX_FLAT_COINS, MAX_FLAT_VP };
