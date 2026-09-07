// VP bonus packs — server side.
//
// ⚠ MIRROR of src/utils/vpBonuses.js. Every id, price, duration, multiplier and
// scope below must match that file exactly; scripts/vp-mirror-check.mjs fails the
// build if one drifts. The client shows the price, this file charges it, and a UI
// that advertises its own numbers is how those two stop agreeing.
//
// ⚠ COINS ONLY. There is deliberately no VP price and none may be added: a
// VP-priced VP multiplier is an infinite loop (docs/VP_BONUS_PACKS_PLAN.md §11.2).
//
// Packs are also granted free by the VP ladder — see grantBonusPack(), called from
// vpLevel.js when a level carrying a pack is crossed.

const functions = require('firebase-functions/v2');
const { HttpsError } = require('firebase-functions/v2/https');
const admin = require('firebase-admin');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');

const db = () => getFirestore('vgrdb');

// MIRROR of VP_BONUS_PACKS in src/utils/vpBonuses.js.
//
// ⚠ TWO PRICES, AND THEY ARE NOT DERIVED FROM EACH OTHER.
//
//   coins    what it costs from the wallet
//   priceUSD what it costs in cash, when the wallet cannot cover it
//
// The rule, set 2026-08-28: priceUSD = charmRound(max(2 x coin-equivalent,
// $0.99)). Paying with coins is therefore always about HALF the cash price,
// which is what makes coins worth holding.
//
// ⚠⚠ NEVER price a pack at its coin count through playPriceFor(). That is the
// COIN REDEMPTION rate, and using it produced a 75-coin bonus costing $1.09,
// exactly what 78 coins cost. Nobody would ever buy it. The $0.99 term is
// Google Play's US minimum, which only binds on the 25-coin items.
const VP_BONUS_PACKS = [
  { id: 'happy_hour', name: 'Happy Hour',      mult: 3,    hours: 1,   coins: 25,  priceUSD: 0.99,  scope: 'all' },
  { id: 'flash',      name: 'Flash Surge',     mult: 3,    hours: 6,   coins: 75,  priceUSD: 0.99,  scope: 'all' },
  { id: 'half_day',   name: 'Half-Day Surge',  mult: 2.5,  hours: 12,  coins: 120, priceUSD: 1.59,  scope: 'all' },
  { id: 'day',        name: 'Day Surge',       mult: 2,    hours: 24,  coins: 200, priceUSD: 2.59,  scope: 'all' },
  { id: 'weekend',    name: 'Weekend Surge',   mult: 1.75, hours: 48,  coins: 350, priceUSD: 4.49,  scope: 'all' },
  { id: 'long',       name: 'Long Surge',      mult: 1.5,  hours: 168, coins: 900, priceUSD: 11.99, scope: 'all' },
  { id: 'creator',    name: 'Creator Surge',   mult: 3,    hours: 24,  coins: 150, priceUSD: 1.99,
    scope: ['create_post', 'go_live', 'stream_hour'] },
  { id: 'community',  name: 'Community Surge', mult: 3,    hours: 24,  coins: 150, priceUSD: 1.99,
    scope: ['get_like', 'get_comment', 'comment_post', 'like_post'] },
  { id: 'watcher',    name: 'Watcher Surge',   mult: 3,    hours: 24,  coins: 100, priceUSD: 1.29,
    scope: ['watch_stream_hour'] },
];

/** MIRROR of VP_BONUS_CEILING. Two 2x packs give 3x, never 4x. */
const VP_BONUS_CEILING = 3;

/** How many active bonuses one account may hold. Stops an unbounded array. */
const MAX_ACTIVE_BONUSES = 6;

const packById = (id) => VP_BONUS_PACKS.find((p) => p.id === id) || null;

const expiryMs = (b) => {
  const t = b && b.expiresAt;
  if (t == null) return 0;
  if (typeof t === 'number') return t;
  if (t && typeof t.toMillis === 'function') return t.toMillis();
  if (t && typeof t.seconds === 'number') return t.seconds * 1000;
  const n = Date.parse(t);
  return Number.isFinite(n) ? n : 0;
};

/** Unexpired bonuses. Evaluated at READ time — there is no cron and none is wanted. */
const activeBonuses = (user, now = Date.now()) =>
  (Array.isArray(user && user.vpBonuses) ? user.vpBonuses : []).filter((b) => b && expiryMs(b) > now);

const covers = (bonus, actionKey) => {
  const s = bonus && bonus.scope;
  if (!s || s === 'all') return true;
  return Array.isArray(s) ? s.includes(actionKey) : s === actionKey;
};

/**
 * The bonus multiplier for ONE action. MIRROR of activeBonusMult().
 *
 * ⚠ Additive on the excess, never multiplicative, capped — the same rule
 * boostReach() uses in streamBoost.js, so the product has one stacking model.
 *
 * ⚠ Takes the ALREADY-READ user document. Both VP credit paths fetch it for the
 * plan tier and vpLevel, so this costs zero extra reads. Do not make it fetch.
 */
const activeBonusMult = (user, actionKey, now = Date.now()) => {
  const applies = activeBonuses(user, now).filter((b) => covers(b, actionKey));
  if (!applies.length) return 1;
  const excess = applies.reduce((sum, b) => sum + Math.max(0, (Number(b.mult) || 1) - 1), 0);
  return Math.min(VP_BONUS_CEILING, 1 + excess);
};

/** Prune expired entries so the array cannot grow without bound. */
const prune = (user, now = Date.now()) => activeBonuses(user, now);

/**
 * Stamp a pack onto a user. Shared by the coin purchase and the ladder grant, so
 * a bought pack and an earned pack are the same object and expire identically.
 *
 * Must be called INSIDE a transaction that has already read `userRef`.
 */
const applyPack = (tx, userRef, user, pack, source, now = Date.now()) => {
  const kept = prune(user, now);
  if (kept.length >= MAX_ACTIVE_BONUSES) {
    throw new HttpsError('failed-precondition',
      `You already have ${MAX_ACTIVE_BONUSES} bonuses running. Let one finish first.`);
  }
  kept.push({
    id: pack.id,
    mult: pack.mult,
    scope: pack.scope,
    startedAt: now,
    expiresAt: now + pack.hours * 3600 * 1000,
    source,
  });
  tx.set(userRef, { vpBonuses: kept }, { merge: true });
  return kept;
};

/**
 * Buy a pack with COINS.
 *
 * ⚠ The price is read from the table here, never from the client. The client
 * sends WHAT, never HOW MUCH — the same rule every other purchase in the product
 * follows.
 */
exports.purchaseVpBonus = functions.https.onCall(
  { region: 'europe-west1' },
  async (request) => {
    const uid = request.auth && request.auth.uid;
    if (!uid) throw new HttpsError('unauthenticated', 'Sign in first.');

    const packId = String((request.data && request.data.packId) || '');
    const pack = packById(packId);
    if (!pack) throw new HttpsError('invalid-argument', 'Unknown bonus pack.');

    const d = db();
    const userRef = d.collection('users').doc(uid);
    const walletRef = d.collection('wallets').doc(uid);

    const result = await d.runTransaction(async (tx) => {
      const [userSnap, walletSnap] = await Promise.all([tx.get(userRef), tx.get(walletRef)]);
      if (!userSnap.exists) throw new HttpsError('not-found', 'No account.');

      const balance = Number((walletSnap.data() || {}).balance) || 0;
      if (balance < pack.coins) {
        throw new HttpsError('failed-precondition',
          `You need ${pack.coins} coins for ${pack.name}. You have ${balance}.`);
      }

      const now = Date.now();
      const kept = applyPack(tx, userRef, userSnap.data(), pack, 'purchase', now);

      tx.set(walletRef, {
        balance: FieldValue.increment(-pack.coins),
        totalSpent: FieldValue.increment(pack.coins),
      }, { merge: true });

      tx.set(d.collection('transactions').doc(), {
        userId: uid,
        type: 'vp_bonus_purchase',
        amount: -pack.coins,
        currency: 'coins',
        description: `${pack.name} — ${pack.mult}x VP for ${pack.hours}h`,
        packId: pack.id,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      return { expiresAt: now + pack.hours * 3600 * 1000, active: kept.length };
    });

    return { ok: true, packId: pack.id, ...result };
  },
);

/**
 * Grant a pack for free because a ladder level was crossed.
 *
 * ⚠ Runs its own transaction because vpLevel.js grants outside one. It is
 * best-effort by design: a level-up must never fail because a bonus could not be
 * stamped, so the caller swallows the error and the level still lands.
 */
const grantBonusPack = async (uid, packId, level) => {
  const pack = packById(packId);
  if (!pack) return false;
  const d = db();
  const userRef = d.collection('users').doc(uid);
  await d.runTransaction(async (tx) => {
    const snap = await tx.get(userRef);
    if (!snap.exists) return;
    const now = Date.now();
    const user = snap.data();
    // The ladder must not be blocked by the purchase ceiling: drop the
    // shortest-running bonus rather than refusing a reward the user earned.
    const kept = prune(user, now).sort((a, b) => expiryMs(a) - expiryMs(b));
    while (kept.length >= MAX_ACTIVE_BONUSES) kept.shift();
    kept.push({
      id: pack.id, mult: pack.mult, scope: pack.scope,
      startedAt: now, expiresAt: now + pack.hours * 3600 * 1000,
      source: `level_${level}`,
    });
    tx.set(userRef, { vpBonuses: kept }, { merge: true });
  });
  return true;
};

// Exported so a CASH purchase (Google Play IAP, or the PayRam card rail) can
// stamp the very same object a coin purchase stamps, inside the transaction
// that records the payment. A second grant path would be a second definition of
// what a bonus is, and the two would drift.
exports.applyPack = applyPack;
exports.VP_BONUS_PACKS = VP_BONUS_PACKS;
exports.VP_BONUS_CEILING = VP_BONUS_CEILING;
exports.activeBonusMult = activeBonusMult;
exports.grantBonusPack = grantBonusPack;
exports.packById = packById;
