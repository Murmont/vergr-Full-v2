// The hype train: shape, reward, and the machine that decides which reward.
//
// ⚠⚠ THIS FILE IS THE ONE DEFINITION. The preview simulator and the (not yet
// built) Cloud Function both settle a train through `settleTrain()` below. Two
// copies of "what a completed train pays" is how the theme system died: the
// swatch previewed one thing and the profile drew another, and neither file
// showed the disagreement.
//
// Full working, including the derivation of every number: docs/HYPE_TRAIN_PLAN.md.

import { TARGET_NET_USD_PER_COIN } from './storePricing.js';

// ── 1. SHAPE ─────────────────────────────────────────────────────────────────
//
// ⚠ THE GOAL SCALES WITH THE ROOM, SUB-LINEARLY. Founder anchor: 10 viewers,
// ~1,000 coins for level 1. Linear scaling would put a 1,000-viewer stream at
// 100,000 coins, which no room reaches, so the feature would exist only for
// small streams, which is backwards. The goal tracks LIKELY TIPPERS rather than
// heads, and participation rate falls as a room grows, so it is a square root.
export const TRAIN_GOAL_COEFF = 316;      // G = 316 * sqrt(viewers); 10 -> 1,000
export const TRAIN_MAX_LEVEL = 5;
export const TRAIN_LEVEL_STEP = 0.5;      // level n costs G * (1 + 0.5(n-1))
export const TRAIN_SOLO_CAP = 0.4;        // one person counts for <=40% of a level
export const TRAIN_WINDOW_MS = 300_000;   // 5 min
export const TRAIN_EXTEND_MS = 30_000;    // each contribution pushes it out
export const TRAIN_MAX_MS = 900_000;      // and it can never run past 15 min
export const TRAIN_TOP_RIDERS = 5;        // faces on the bar: the conductor + 4 riders

export const trainBaseGoal = (viewers = 0) =>
  Math.round(TRAIN_GOAL_COEFF * Math.sqrt(Math.max(1, viewers)));

export const trainLevelGoal = (base, level) =>
  Math.round(base * (1 + TRAIN_LEVEL_STEP * (level - 1)));

// ── 2. THE REWARD DIALS ──────────────────────────────────────────────────────
//
// ⚠⚠ EVERY NUMBER IN THIS BLOCK IS A FOUNDER DECISION, NEVER A SESSION ONE.
// They are the economy. Changing one changes what the platform pays out.
export const TRAIN_BONUS_PCT = 0.20;      // founder, 2026-09-06

// ⚠ FOUNDER-APPROVED 2026-09-07. THE CAP IS WHY THE ABSOLUTE CANNOT RUN AWAY. A percentage keeps the RATIO
// safe at any size and does nothing to bound the number of coins minted: the
// full-train bonus is 632 * sqrt(viewers), so a 10,000-viewer room would mint
// 63,200 coins off one train. The cap is what stops that, and it deliberately
// does not bind until roughly 63 viewers, because the whole case for the
// feature is the small room.
export const TRAIN_COIN_CAP = 5_000;          // founder-approved 2026-09-07

// ⚠ VP IS PRICED OFF THE LEVEL REACHED, NOT OFF THE COINS. Pricing it off the
// coin count was the single worst error in the first build: a 13,590-coin train
// paid 2,718 VP, which is FIVE TIMES the VP that entire tipping event generated
// for every tipper combined (a tip pays the sender 1 VP per 25 coins), and about
// 18 times the largest single VP award anywhere in the product (host a live
// event, 150). Coins and VP are not the same unit and must not share a number.
//
// Priced per level, a max train pays 250 VP, which sits beside "host a live
// event" instead of dwarfing it, cannot be inflated by a whale because it never
// reads the coin total, and self-limits down the ladder: 250 VP is 12.5% of an
// early level and a rounding error at L90.
export const TRAIN_VP_PER_LEVEL = 50;         // founder-approved 2026-09-07

// ⚠ THREE OUTCOMES, ONE PER TRAIN, AT RANDOM (founder, 2026-09-27): coins, VP
// or boost coins, "cycled so that its random and not always real coins". Real
// coins get whatever the other two leave (20%; odds 40/40/20, founder 2026-09-27). VP and boost coins are the
// cheap branches: VP costs only what it brings forward on the level ladder
// (about 0.0081 coins per VP), and boost coins buy boosts and VP packs only, so
// neither can become revenue share Vergr owes. Was 65/35 VP/coins (2026-09-07).
export const TRAIN_VP_WEIGHT = 0.40;
export const TRAIN_BOOST_WEIGHT = 0.40;

// ⚠ A COIN RESULT SMALLER THAN THIS PAYS VP INSTEAD. Landing on the coin branch
// and being handed 4 coins reads as being fobbed off, and it is worth less to
// the creator than the branch it beat. Not a second reward: still exactly one.
export const TRAIN_MIN_COIN_BONUS = 25;

// ── 3. THE MACHINE THAT GUARANTEES A PROFIT ──────────────────────────────────
//
// ⚠⚠ FOUNDER RULE, 2026-09-07, VERBATIM: "when giving coins, the rule is that i
// should ALWAYS make money and never lose money." That is enforced HERE, in
// code, rather than by the percentage happening to be small enough. If anyone
// ever raises TRAIN_BONUS_PCT, or the revenue-share ladder moves, the clamp
// below catches it and the guarantee still holds.
//
// The arithmetic, every term from source:
//
//   Every coin in a train was BOUGHT before it was tipped, netting us $0.011628
//   (TARGET_NET_USD_PER_COIN, the ladder FLOOR, so this is the worst per-coin
//   rate any pack in the ladder produces).
//
//   We owe the creator `share x $0.01` of it (COIN_MICRO_USD = 10_000).
//
//   Margin already banked, per coin tipped:
//     $0.003628 at an 80% creator, $0.006628 at a 50% creator.
//
//   A bonus coin costs us at most $0.008: coins are never withdrawable, so the
//   only way one becomes a liability is the creator tipping it onward to another
//   creator, at that creator's share, worst case 80%. Spent on a boost, a pack,
//   a membership or an unlock it costs nothing at all.
export const OWED_USD_PER_COIN = 0.01;    // COIN_MICRO_USD 10_000 / 1e6
export const WORST_ONWARD_SHARE = 0.80;   // top of REVENUE_SHARE_RATES

// ⚠ WE KEEP AT LEAST THIS MUCH OF THE MARGIN, ON EVERY TRAIN, WHATEVER ELSE
// CHANGES. Break-even would not arrive until about 45% given back; this floor
// stops the clamp at 22.7% of the raise at the tightest tier, so the current 20%
// never reaches it. It is a safety net, not the mechanism.
export const TRAIN_MARGIN_FLOOR = 0.50;

/** USD margin already banked on `received` coins, before any bonus. */
export function trainMarginUsd(received = 0, share = WORST_ONWARD_SHARE) {
  return Math.max(0, received) * (TARGET_NET_USD_PER_COIN - OWED_USD_PER_COIN * share);
}

/**
 * The largest coin bonus that still leaves TRAIN_MARGIN_FLOOR of the margin.
 *
 * ⚠ AN UNKNOWN SHARE DEFAULTS TO THE WORST TIER (80%), NOT THE BEST. A higher
 * creator share means less margin means a tighter clamp, so assuming the top of
 * the ladder is the conservative direction in both cases.
 */
export function maxSafeCoinBonus(received = 0, share = WORST_ONWARD_SHARE) {
  const spendable = trainMarginUsd(received, share) * (1 - TRAIN_MARGIN_FLOOR);
  return Math.floor(spendable / (OWED_USD_PER_COIN * WORST_ONWARD_SHARE));
}

/** What the coin branch pays: the percentage, the cap, and the clamp, lowest wins. */
export function coinBonusFor(received = 0, share = WORST_ONWARD_SHARE) {
  return Math.max(0, Math.min(
    Math.floor(Math.max(0, received) * TRAIN_BONUS_PCT),
    TRAIN_COIN_CAP,
    maxSafeCoinBonus(received, share),
  ));
}

/** What the VP branch pays. Reads the level only; the coin total is not an input. */
export function vpBonusFor(level = 1) {
  return Math.max(1, Math.round(level)) * TRAIN_VP_PER_LEVEL;
}

// ── 4. THE RANDOMISER ────────────────────────────────────────────────────────
//
// ⚠⚠ THE SEED IS FIXED WHEN THE TRAIN STARTS, BEFORE ANYONE HAS TIPPED INTO IT.
// Three things follow, and all three are the point:
//   1. Nobody can influence which branch comes up by spending more or less. The
//      result is not a function of what anyone pays.
//   2. Settling is idempotent for free. A retry, a double-fire or a reconnect
//      recomputes the same outcome instead of producing a different one.
//   3. It is auditable after the fact: given the stored train, the outcome can
//      be recomputed and checked, so it can be shown not to have been rigged.
//
// ⚠⚠ IN PRODUCTION THE SEED MUST COME FROM A SERVER SECRET AND MUST NEVER REACH
// THE CLIENT: `HMAC_SHA256(SERVER_SECRET, streamId + ':' + trainId)`. The mapping
// below is deliberately public and deterministic, so a client-visible seed would
// let a creator read the outcome the moment a train starts and decide whether to
// bother promoting it. The preview generates a throwaway local seed instead.
//
// ⚠ THE AVALANCHE STEP IS NOT DECORATION. FNV-1a alone leaves adjacent inputs
// with adjacent hashes, and consecutive train ids are exactly adjacent inputs,
// so without the murmur3 finaliser the branch would visibly alternate rather
// than be unpredictable. `npm run check` measures the split over 20,000 seeds
// and fails if it drifts from TRAIN_VP_WEIGHT.
export function trainRoll(seed = '') {
  const s = String(seed);
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

/** 'vp', 'boost' or 'coins'. Exactly one. */
export function trainOutcome(seed = '', vpWeight = TRAIN_VP_WEIGHT, boostWeight = TRAIN_BOOST_WEIGHT) {
  const r = trainRoll(seed);
  if (r < vpWeight) return 'vp';
  if (r < vpWeight + boostWeight) return 'boost';
  return 'coins';
}

// ── 5. THE ONE SETTLEMENT ────────────────────────────────────────────────────
/**
 * What a completed train pays, as exactly one reward.
 *
 * ⚠⚠ EXACTLY ONE OF COINS, BOOST COINS OR VP, NEVER TWO. Founder, 2026-09-07
 * (one or the other) and 2026-09-27 (boost coins added). The unused branches
 * are returned as 0 so a caller cannot read a stale figure off them, and
 * `npm run check` asserts exactly one is positive.
 *
 * @param {number} received coins that actually landed in the train
 * @param {number} level    level the train reached
 * @param {string} seed     server-secret-derived, fixed at train start
 * @param {number} share    the creator's revenue share; unknown defaults to 80%
 */
export function settleTrain({ received = 0, level = 1, seed = '', share = WORST_ONWARD_SHARE } = {}) {
  const got = Math.max(0, Math.floor(received));
  if (got <= 0) return null;

  const lvl = Math.max(1, Math.round(level));
  // Boost coins pay the SAME amount the coin branch would, so the number never
  // depends on which branch came up. A result too small to be worth having
  // pays VP instead.
  const coins = coinBonusFor(got, share);
  const drawn = trainOutcome(seed);
  const kind = (drawn !== 'vp' && coins >= TRAIN_MIN_COIN_BONUS) ? drawn : 'vp';

  const marginUsd = trainMarginUsd(got, share);
  return {
    kind,
    coins: kind === 'coins' ? coins : 0,
    boostCoins: kind === 'boost' ? coins : 0,
    vp: kind === 'vp' ? vpBonusFor(lvl) : 0,
    level: lvl,
    received: got,
    marginUsd,
    // What this specific payout can cost at absolute worst. VP never touches the
    // money path, so its worst case is zero.
    costUsd: kind === 'coins' ? coins * OWED_USD_PER_COIN * WORST_ONWARD_SHARE : 0,
  };
}
