// Hype train, SERVER SIDE. CJS mirror of src/utils/hypeTrain.js.
//
// ⚠⚠ THIS FILE EXPORTS NO CLOUD FUNCTION, ON PURPOSE. Founder, 2026-09-07:
// "adding a function costs me money, isnt there a free way to do it?" He is
// right. Invocations here are inside the free tier, but Cloud Functions v2
// stores a container image in Artifact Registry PER FUNCTION (free to 0.5 GB,
// then $0.10/GB/month) and this project already has ~335 of them, so every new
// function is a small permanent line item. New secrets and new Cloud Scheduler
// jobs are the other real per-item costs.
//
// So the train adds nothing billable:
//   PROGRESS   rides `sendTip`, already deployed, already running on every tip,
//              and already doing a streams/{id} get + update post-commit. The
//              train reads and writes inside those, so it costs ZERO extra
//              reads and ZERO extra writes.
//   SETTLEMENT rides `endStreamSession`, already deployed, inside the
//              transaction that already reads and updates the same doc.
//   EXPIRY     evaluated at read time, exactly as boosts and VP bonuses do.
//              NO CRON. A Cloud Scheduler job is one of the few things here
//              that genuinely costs money.
//   SEED       generated with crypto.randomBytes at settle time. NO SECRET
//              MANAGER entry, and nothing extra stored.
//
// ⚠ THE NUMBERS BELOW ARE MIRRORED FROM src/utils/hypeTrain.js AND THE BUILD
// FAILS ON DRIFT. Same rule as boosts.js and vpBonuses.js: the client promises
// what the server pays, so a disagreement is a lie to a creator.
'use strict';

const crypto = require('crypto');

// ── 1. SHAPE ────────────────────────────────────────────────────────────────
const TRAIN_GOAL_COEFF = 316;
const TRAIN_MAX_LEVEL = 5;
const TRAIN_LEVEL_STEP = 0.5;
const TRAIN_SOLO_CAP = 0.4;
const TRAIN_WINDOW_MS = 300000;
const TRAIN_EXTEND_MS = 30000;
const TRAIN_MAX_MS = 900000;

const trainBaseGoal = (viewers) =>
  Math.round(TRAIN_GOAL_COEFF * Math.sqrt(Math.max(1, Number(viewers) || 1)));

const trainLevelGoal = (base, level) =>
  Math.round(base * (1 + TRAIN_LEVEL_STEP * (level - 1)));

// ── 2. THE REWARD DIALS, ALL FOUNDER-APPROVED 2026-09-07 ────────────────────
const TRAIN_BONUS_PCT = 0.20;
const TRAIN_COIN_CAP = 5000;
const TRAIN_VP_PER_LEVEL = 50;
const TRAIN_VP_WEIGHT = 0.65;
const TRAIN_MIN_COIN_BONUS = 25;

// ── 3. THE MACHINE THAT GUARANTEES A PROFIT ─────────────────────────────────
//
// ⚠⚠ FOUNDER RULE, VERBATIM: "when giving coins, the rule is that i should
// ALWAYS make money and never lose money." Enforced by the clamp below, not by
// TRAIN_BONUS_PCT happening to be small.
const TARGET_NET_USD_PER_COIN = 0.011628;   // storePricing.js, the ladder FLOOR
const OWED_USD_PER_COIN = 0.01;             // COIN_MICRO_USD 10_000 / 1e6
const WORST_ONWARD_SHARE = 0.80;            // top of REVENUE_SHARE_RATES
const TRAIN_MARGIN_FLOOR = 0.50;

function trainMarginUsd(received, share) {
  const s = typeof share === 'number' ? share : WORST_ONWARD_SHARE;
  return Math.max(0, received || 0) * (TARGET_NET_USD_PER_COIN - OWED_USD_PER_COIN * s);
}

function maxSafeCoinBonus(received, share) {
  const spendable = trainMarginUsd(received, share) * (1 - TRAIN_MARGIN_FLOOR);
  return Math.floor(spendable / (OWED_USD_PER_COIN * WORST_ONWARD_SHARE));
}

function coinBonusFor(received, share) {
  return Math.max(0, Math.min(
    Math.floor(Math.max(0, received || 0) * TRAIN_BONUS_PCT),
    TRAIN_COIN_CAP,
    maxSafeCoinBonus(received, share),
  ));
}

const vpBonusFor = (level) => Math.max(1, Math.round(level || 1)) * TRAIN_VP_PER_LEVEL;

// ── 4. THE RANDOMISER ───────────────────────────────────────────────────────
//
// ⚠ THE MAPPING IS THE MIRROR; WHERE THE SEED COMES FROM IS THE CALLER'S
// DECISION. The preview mints one at train start so its outcome is stable
// across re-renders. The server mints one with crypto.randomBytes INSIDE the
// settling transaction, which is unpredictable, uninfluenceable by anything
// anyone spent, and needs no secret and no stored field.
//
// ⚠ IDEMPOTENCY COMES FROM THE SETTLED MARKER, NOT FROM THE SEED. The
// transaction refuses to settle a train that already carries `settledAt`, the
// same shape `coinLedger.settleEarnedShare` uses. A Firestore transaction retry
// regenerates the seed, which is harmless: nothing was committed.
//
// ⚠ THE AVALANCHE STEP IS NOT DECORATION. Plain FNV-1a maps adjacent inputs to
// adjacent hashes; measured, it produced runs of 211 identical outcomes while
// still splitting 64.92/35.08 and passing a naive uniformity test.
function trainRoll(seed) {
  const s = String(seed || '');
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  h ^= h >>> 16; h = Math.imul(h, 2246822507) >>> 0;
  h ^= h >>> 13; h = Math.imul(h, 3266489909) >>> 0;
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

const trainOutcome = (seed) => (trainRoll(seed) < TRAIN_VP_WEIGHT ? 'vp' : 'coins');

const newSeed = () => crypto.randomBytes(16).toString('hex');

// ── 5. THE ONE SETTLEMENT ───────────────────────────────────────────────────
/** Exactly one reward. Never both, never neither. */
function settleTrain(opts) {
  const o = opts || {};
  const got = Math.max(0, Math.floor(o.received || 0));
  if (got <= 0) return null;
  const lvl = Math.max(1, Math.round(o.level || 1));
  const share = typeof o.share === 'number' ? o.share : WORST_ONWARD_SHARE;
  const coins = coinBonusFor(got, share);
  const kind = (trainOutcome(o.seed) === 'coins' && coins >= TRAIN_MIN_COIN_BONUS) ? 'coins' : 'vp';
  return {
    kind,
    coins: kind === 'coins' ? coins : 0,
    vp: kind === 'vp' ? vpBonusFor(lvl) : 0,
    level: lvl,
    received: got,
    costUsd: kind === 'coins' ? coins * OWED_USD_PER_COIN * WORST_ONWARD_SHARE : 0,
  };
}

// ── 6. ADVANCING A TRAIN, PURE ──────────────────────────────────────────────
/**
 * Fold one contribution into the train state.
 *
 * ⚠ AN EXPIRED TRAIN IS RETURNED FOR SETTLEMENT AND A FRESH ONE STARTS. That is
 * how expiry works with no cron: the next tip closes the old window. A stream
 * that goes quiet leaves its train to be settled by `endStreamSession`.
 *
 * ⚠ ONE PERSON CANNOT MAKE A TRAIN. Above the per-level cap the tip still lands
 * in full and the creator still receives all of it; only what it adds to the
 * METER is limited. 40% is the largest cap that still forces three people.
 *
 * @returns {{train: object, expired: object|null}}
 */
function advanceTrain(prev, opts) {
  const o = opts || {};
  const now = o.nowMs || Date.now();
  const amount = Math.max(0, Math.floor(o.coins || 0));
  const uid = o.uid;
  if (!amount || !uid) return { train: prev || null, expired: null };

  let expired = null;
  let base = prev && prev.endsAtMs > now && !prev.settledAt ? prev : null;
  if (prev && !base) expired = prev;

  if (!base) {
    // ⚠ THE VIEWER COUNT IS FROZEN AT THE START. A goal that tracked live
    // numbers would move while the room was pushing at it, and a bar that
    // recedes as you fill it is a broken promise.
    const viewers = Math.max(1, Number(o.viewers) || 1);
    base = {
      level: 1,
      into: 0,
      riders: {},
      perLevel: {},
      received: 0,
      startedAtMs: now,
      endsAtMs: now + TRAIN_WINDOW_MS,
      baseGoal: trainBaseGoal(viewers),
      viewers,
    };
  }

  let level = base.level;
  let goal = trainLevelGoal(base.baseGoal, level);
  let perLevel = Object.assign({}, base.perLevel);
  const cap = Math.max(1, Math.round(goal * TRAIN_SOLO_CAP));
  const counts = Math.max(0, Math.min(amount, cap - (perLevel[uid] || 0)));
  perLevel[uid] = (perLevel[uid] || 0) + counts;

  let into = base.into + counts;
  while (into >= goal && level < TRAIN_MAX_LEVEL) {
    into -= goal;
    level += 1;
    goal = trainLevelGoal(base.baseGoal, level);
    // The cap is per LEVEL, so a new level is a clean slate. Otherwise one
    // person is locked out of a train they helped start.
    perLevel = {};
  }
  if (level >= TRAIN_MAX_LEVEL) into = Math.min(into, goal);

  const riders = Object.assign({}, base.riders);
  // The FULL tip is what the creator got, so it is what the bonus is a
  // percentage of. The cap only ever limited the meter.
  riders[uid] = (riders[uid] || 0) + amount;

  // ⚠⚠ THE LEADER IS DENORMALISED HERE, AND THAT IS A COST DECISION. The bar
  // names the person carrying the train, which is the whole point of the
  // feature: nobody pushes a meter to be an anonymous blob. Resolving that name
  // and picture on the client would be a Firestore read per rider, per viewer,
  // per train. `sendTip` has ALREADY loaded the sender's name and avatar for the
  // tip alert, so carrying them costs nothing.
  //
  // ⚠ ONLY THE LEADER IS CARRIED, not a name for every rider. The riders map can
  // hold hundreds of uids and the stream doc is world-readable and re-sent to
  // every viewer on every change; a name and a URL each would bloat the payload
  // the whole room downloads.
  let topUid = base.topUid || null;
  let topCoins = base.topCoins || 0;
  let topName = base.topName || null;
  let topAvatar = base.topAvatar || null;
  if (riders[uid] > topCoins) {
    topUid = uid;
    topCoins = riders[uid];
    topName = o.name || topName;
    topAvatar = o.avatar || null;
  }

  return {
    train: Object.assign({}, base, {
      level,
      into,
      goal,
      maxLevel: TRAIN_MAX_LEVEL,
      received: base.received + amount,
      perLevel,
      riders,
      riderCount: Object.keys(riders).length,
      topUid, topCoins, topName, topAvatar,
      endsAtMs: Math.min(base.startedAtMs + TRAIN_MAX_MS, now + TRAIN_EXTEND_MS),
    }),
    expired,
  };
}

// ── 7. GRANTING IT ─────────────────────────────────────────────────────────
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const dbOf = () => getFirestore('vgrdb');

/**
 * Settle a completed train and pay the creator, once.
 *
 * ⚠⚠ IDEMPOTENT VIA A MARKER IN THE TRANSACTION. `settledAt` is written on the
 * train in the same transaction that credits the wallet, so a retry, a
 * reconnect or both callers racing pay exactly one bonus. This is the shape
 * `coinLedger.settleEarnedShare` already uses.
 *
 * ⚠ VP IS CREDITED FLAT, WITH NO PLAN OR RANK MULTIPLIER, AND THAT IS
 * DELIBERATE. Every other VP award multiplies by plan (Pro 2x), rank and any
 * active bonus pack. Stacking those on a reward that is ITSELF a bonus would
 * compound them: a Pro host on a 3x pack would take 250 VP to 1,500, six times
 * a figure that was priced to sit beside "host a live event, 150". The train
 * pays what the level says and nothing else.
 *
 * ⚠ COINS GO TO `balance`, NOT to the earned/revenue-share path. They are a
 * bonus the platform mints out of margin already banked, not revenue a viewer
 * paid the creator, so routing them through `earnedShareCredit` would inflate
 * lifetime gross earnings and move the creator up the payout ladder on money
 * nobody spent.
 *
 * @returns {Promise<object|null>} the bonus paid, or null if there was nothing
 *   to settle or it was already settled
 */
async function settleAndGrant(streamId, hostUid, train) {
  if (!streamId || !hostUid || !train || !train.received) return null;
  const db = dbOf();
  const streamRef = db.collection('streams').doc(streamId);
  const walletRef = db.collection('wallets').doc(hostUid);

  return db.runTransaction(async (tx) => {
    const snap = await tx.get(streamRef);
    if (!snap.exists) return null;
    const live = (snap.data() || {}).hypeTrain || null;
    // Only settle the train that is actually on the doc, and only once.
    if (!live || live.startedAtMs !== train.startedAtMs || live.settledAt) return null;

    const bonus = settleTrain({
      received: live.received,
      level: live.level,
      seed: newSeed(),
      // No share is passed, so the clamp assumes the WORST tier (80%). A higher
      // creator share means less margin means a tighter clamp, so assuming the
      // top of the ladder is the conservative direction and saves a read of the
      // wallet's lifetime gross.
    });
    if (!bonus) return null;

    if (bonus.kind === 'coins') {
      tx.set(walletRef, { balance: FieldValue.increment(bonus.coins) }, { merge: true });
    } else {
      tx.set(walletRef, { vp: FieldValue.increment(bonus.vp) }, { merge: true });
    }

    tx.set(db.collection('transactions').doc(), {
      userId: hostUid,
      type: 'hype_train_bonus',
      amount: bonus.kind === 'coins' ? bonus.coins : 0,
      vp: bonus.vp,
      streamId,
      // The audit record. The seed is not stored, so this row IS the evidence
      // of what the train paid and why.
      meta: {
        kind: bonus.kind, level: bonus.level, received: bonus.received,
        pct: TRAIN_BONUS_PCT, cap: TRAIN_COIN_CAP,
      },
      description: bonus.kind === 'coins'
        ? 'Hype train level ' + bonus.level + ': ' + bonus.coins + ' coins'
        : 'Hype train level ' + bonus.level + ': ' + bonus.vp + ' VP',
      createdAt: FieldValue.serverTimestamp(),
    });

    tx.update(streamRef, {
      'hypeTrain.settledAt': Date.now(),
      'hypeTrain.bonus': bonus,
    });
    return bonus;
  });
}

module.exports = {
  settleAndGrant,
  TRAIN_GOAL_COEFF, TRAIN_MAX_LEVEL, TRAIN_LEVEL_STEP, TRAIN_SOLO_CAP,
  TRAIN_WINDOW_MS, TRAIN_EXTEND_MS, TRAIN_MAX_MS,
  TRAIN_BONUS_PCT, TRAIN_COIN_CAP, TRAIN_VP_PER_LEVEL, TRAIN_VP_WEIGHT,
  TRAIN_MIN_COIN_BONUS, TRAIN_MARGIN_FLOOR,
  OWED_USD_PER_COIN, WORST_ONWARD_SHARE, TARGET_NET_USD_PER_COIN,
  trainBaseGoal, trainLevelGoal, trainMarginUsd, maxSafeCoinBonus,
  coinBonusFor, vpBonusFor, trainRoll, trainOutcome, settleTrain,
  advanceTrain, newSeed,
};
