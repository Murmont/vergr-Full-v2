// Boosts — the one catalogue, and the inventory you hold them in.
//
// ⚠ A BOOST IS A TOKEN YOU OWN, NOT A PURCHASE THAT FIRES. Founder, 2026-08-28:
// *"users can keep boosts, you should see them like tokens. I could have 10
// boosts all different or multiple of the same one... and I should be able to
// apply a boost to my own or anyone else's content."*
//
// That is three rules, and the first build broke all three:
//   1. Buying puts it in your WALLET. Applying is a separate, later action.
//   2. You may apply one to ANYONE's content. There is no ownership check.
//   3. The wallet shows what you hold and how many.
//
// ⚠ THIS FILE REPLACES TWO TABLES THAT HAD DRIFTED APART: `BOOST_COSTS` in
// vpSystem.js (post/profile/lfg/squad) and `BOOST_TIERS` in streamBoost.js (the
// three stream tiers). They now behave identically — own it, apply it, it runs
// for a duration — so they are one table. Two tables for one concept is how
// "Stream Boost" ended up meaning two different products at two different prices.
//
// Mirrored in functions/boosts.js, guarded by vp-mirror-check.

/**
 * ⚠ EVERY PRICE AND DURATION HERE IS THE ECONOMY AND IS THE FOUNDER'S.
 *
 * `target` is what the boost can be applied to, and it is what the apply sheet
 * filters on: a Post Boost must never be offerable on a squad.
 *
 * `reach` is a feed/discovery multiplier where one applies. `profile` and
 * `squad` have none because they do not multiply a score: they make the subject
 * ELIGIBLE to be suggested, and which of the eligible ones a given viewer sees is
 * decided by fair rotation plus relevance (utils/boostDelivery.js). Deliberately
 * not faked as a number, because there is no honest multiplier to quote.
 */
export const BOOSTS = [
  {
    id: 'post',
    name: 'Post Boost',
    target: 'post',
    minutes: 24 * 60,
    coins: 50,
    reach: 3,
    art: 'post-boost',
    short: 'Reaches 3x further',
    desc: 'Apply it to any post, yours or someone else’s. For 24 hours it reaches about 3x further in For You — it competes 3x harder for a place in each person’s feed, rather than being forced on anyone.',
  },
  {
    id: 'lfg',
    name: 'Teammate Search Boost',
    target: 'post',
    postType: 'lfg',
    minutes: 12 * 60,
    coins: 25,
    reach: 3,
    art: 'teammate-boost',
    short: 'Fill a squad faster',
    desc: 'For a looking-for-teammates post. Reaches about 3x further for 12 hours — shorter and cheaper, because a teammate hunt is over quickly.',
  },
  {
    id: 'profile',
    name: 'Profile Boost',
    target: 'user',
    minutes: 48 * 60,
    coins: 100,
    art: 'profile-boost',
    short: 'Get suggested to new people',
    desc: 'Apply it to anyone. For 48 hours they are put in front of people likely to follow them — in the feed, on Explore, in onboarding and in the suggestion rails.',
  },
  {
    id: 'squad',
    name: 'Squad Boost',
    target: 'squad',
    minutes: 48 * 60,
    coins: 75,
    art: 'squad-boost',
    short: 'Get found by new members',
    desc: 'Apply it to any squad. For 48 hours it is put in front of people looking for a squad to join, instead of waiting behind the biggest ones.',
  },
  // ── Stream tiers. Same mechanic, three strengths. ──
  {
    id: 'stream_boost',
    name: 'Stream Boost',
    target: 'stream',
    minutes: 15,
    coins: 50,
    reach: 1.5,
    art: 'stream-boost',
    short: 'Reaches 1.5x further',
    desc: 'Apply it to any live stream. For 15 minutes it goes in front of people who watch that kind of thing, not just higher up a list.',
  },
  {
    id: 'stream_super',
    name: 'Super Boost',
    target: 'stream',
    minutes: 30,
    coins: 150,
    reach: 2.5,
    art: 'stream-super',
    short: 'Reaches 2.5x further',
    desc: 'Apply it to any live stream. For 30 minutes it reaches 2.5x further through discovery and the live rails.',
  },
  {
    id: 'stream_mega',
    name: 'Mega Boost',
    target: 'stream',
    minutes: 60,
    coins: 500,
    reach: 4,
    art: 'stream-mega',
    short: 'Reaches 4x further',
    desc: 'Apply it to any live stream. For an hour it reaches 4x further, and it is the only boost that can put a stream on the home feed rail.',
  },
];

// ⚠ THE COPY MUST NOT PROMISE A SLOT. Delivery is eligibility for a window with
// relevance targeting, spread across several surfaces and fairly rotated between
// everyone who has paid (docs/BOOST_DELIVERY_PLAN.md §2). "Shown FIRST" or
// "guaranteed placement" would be a promise we cannot keep the moment two people
// buy the same boost, so the wording is deliberately about REACH and about who
// sees it, never about position.
export const boostById = (id) => BOOSTS.find((b) => b.id === id) || null;

/** Boosts that can be applied to a given target kind. */
export const boostsForTarget = (target) => BOOSTS.filter((b) => b.target === target);

/**
 * ⚠ The stacking ceiling. Additive on the EXCESS, never multiplicative: two 2.5x
 * boosts give 3x, not 6.25x. Same rule the VP bonus packs use, so the product
 * has one stacking model rather than two that behave differently.
 */
export const BOOST_REACH_CEILING = 3;

/**
 * What the user holds.
 *
 * ⚠ READS THE LEGACY FIELD TOO. Stream Boost tokens earned from the VP ladder
 * were counted in a flat `wallets.boostTokens` number before boosts became a
 * typed inventory. They are folded into `stream_boost` here rather than migrated,
 * so nobody loses what they earned and no backfill job is needed.
 */
export const boostInventory = (wallet) => {
  const map = { ...(wallet?.boosts || {}) };
  const legacy = Number(wallet?.boostTokens) || 0;
  if (legacy > 0) map.stream_boost = (Number(map.stream_boost) || 0) + legacy;
  for (const k of Object.keys(map)) {
    const n = Number(map[k]) || 0;
    if (n > 0) map[k] = n; else delete map[k];
  }
  return map;
};

export const boostCount = (wallet, id) => Number(boostInventory(wallet)[id]) || 0;

/** Total boosts held, for the wallet badge. */
export const totalBoosts = (wallet) =>
  Object.values(boostInventory(wallet)).reduce((a, b) => a + (Number(b) || 0), 0);

/** "24 hours" / "15 minutes" / "12 hours". */
export const formatBoostDuration = (minutes) => {
  if (minutes >= 1440 && minutes % 1440 === 0) {
    const d = minutes / 1440;
    return d === 1 ? '24 hours' : `${d} days`;
  }
  if (minutes >= 60 && minutes % 60 === 0) {
    const h = minutes / 60;
    return h === 1 ? '1 hour' : `${h} hours`;
  }
  return `${minutes} minutes`;
};

/** Art path. Founder supplies the render; the card falls back until it exists. */
export const boostArt = (b, x2 = false) =>
  `/brand/boosts/${b.art}${x2 ? '@2x' : ''}.webp`;
