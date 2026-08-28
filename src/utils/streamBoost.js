// Stream Boost — the tier table, the stacking maths, and the countdown.
//
// ⚠⚠ READ THIS BEFORE ASSUMING BOOST ALREADY WORKED. Until 2026-08-27 it did
// NOT. `streams/{id}.boosted` was read in exactly one place per surface — to
// draw a "Boosted" badge. Every live list (ExploreScreen, NativeExploreScreen,
// LiveUsersContext, HomeFeedRail) queried Firestore directly with
// `orderBy('viewerCount')`. The 1.5x BOOST_REACH_MULTIPLIER lived inside
// `getLiveDiscoveryFeed`, a deployed callable that NOTHING in src/ ever called.
//
// So a user paid 50 coins for a badge, while the help centre told them it
// "pushes your stream in discovery". Same shape as the three inert kill
// switches in CLAUDE.md: a control that is trusted and does nothing.
//
// ── THE MODEL (founder decisions, 2026-08-27) ──────────────────────────
//
//   * THREE PAID TIERS. Coins buy reach.
//   * AN EARNED VP TOKEN SPENDS AS A BOOST, on ANY stream — including someone
//     else's. "if a user earns a boost via vp rank they can use it for another
//     creator/live stream so that they wont have to pay the coins."
//   * BOOSTS STACK, TO A HARD CEILING. Fans can rally behind a creator; one
//     whale cannot buy the front page.
//   * EVERY BOOST IS TIME-LIMITED AND THE TIMER IS VISIBLE, TikTok-style. A
//     boost that silently never ends is indistinguishable from a badge, which
//     is exactly the bug being fixed.
//
// ⚠ THE MULTIPLIER IS NOT THE WHOLE REWARD. Reach here is a RANKING weight
// applied in rankStreams() below. A boosted stream is also matched against the
// viewer's interests, which costs nothing: feedRank.js already keeps author,
// hashtag and topic affinity device-locally.

/**
 * ⚠ COINS ARE THE FOUNDER'S NUMBERS, NOT MINE. 50 is BOOST_FEE_COINS, the rate
 * already charged for the free-tier stream boost, so the entry tier is the
 * price that already existed rather than a new one to explain.
 *
 * ⚠ THE DURATIONS ARE MY CHOICE and are the one number here nobody specified.
 * They are short on purpose: a ticking clock is what makes a boost feel like an
 * event worth reacting to, and it caps how long any single purchase can hold a
 * position. Change them here and the UI, the server and the copy all follow.
 */
export const BOOST_TIERS = [
  { id: 'boost', name: 'Boost',       coins: 50,  reach: 1.5, minutes: 15,
    desc: 'Pushes the stream up discovery for 15 minutes.' },
  { id: 'super', name: 'Super Boost', coins: 150, reach: 2.5, minutes: 30,
    desc: 'Higher placement, and it reaches people who like this kind of stream.' },
  { id: 'mega',  name: 'Mega Boost',  coins: 500, reach: 4.0, minutes: 60,
    desc: 'Top of discovery plus a slot in the live rail on the home feed.' },
];

/** The tier an EARNED VP token redeems as. The entry tier, on any stream. */
export const TOKEN_TIER_ID = 'boost';

/**
 * ⚠ THE CEILING IS THE POINT, not a safety valve. Without it, reach is simply
 * for sale and the loudest wallet owns the front page — the outcome the
 * follower gate and the tipper bias were both built to avoid. Founder chose
 * "yes with hard ceiling".
 */
export const BOOST_REACH_CEILING = 3.0;

/** Only the top tier buys a slot in the home-feed live rail. */
export const FEED_RAIL_TIER = 'mega';

export const boostTier = (id) => BOOST_TIERS.find((t) => t.id === id) || null;

/**
 * The boosts on a stream that have not expired yet.
 *
 * ⚠ EXPIRY IS COMPUTED AT READ TIME, NEVER BY A CRON. A scheduled sweep to
 * clear expired boosts would bill for doing nothing on most runs, and would
 * leave a window where an expired boost still ranks. A timestamp comparison
 * costs nothing and cannot drift.
 */
export const activeBoosts = (stream, now = Date.now()) => {
  const list = Array.isArray(stream?.boosts) ? stream.boosts : [];
  return list.filter((b) => Number(b?.expiresAt) > now);
};

/**
 * Total reach multiplier for a stream right now, ceiling applied.
 *
 * Stacking is ADDITIVE ON THE EXCESS, not multiplicative: two 1.5x boosts give
 * 2.0x, not 2.25x. Multiplying compounds far too fast — four entry boosts would
 * be 5x and blow straight through the ceiling, making the ceiling the only
 * thing anyone ever hits and the tiers meaningless.
 */
export const boostReach = (stream, now = Date.now()) => {
  const active = activeBoosts(stream, now);
  if (!active.length) return 1;
  const excess = active.reduce((sum, b) => sum + Math.max(0, (Number(b.reach) || 1) - 1), 0);
  return Math.min(BOOST_REACH_CEILING, 1 + excess);
};

/** Milliseconds until the LAST active boost lapses, or 0 when none is active. */
export const boostRemainingMs = (stream, now = Date.now()) => {
  const active = activeBoosts(stream, now);
  if (!active.length) return 0;
  return Math.max(0, Math.max(...active.map((b) => Number(b.expiresAt))) - now);
};

/** Does this stream get a slot in the home-feed live rail right now? */
export const hasFeedRail = (stream, now = Date.now()) =>
  activeBoosts(stream, now).some((b) => b.tier === FEED_RAIL_TIER);

/** "12:04" — for the visible countdown. Founder asked for TikTok's timer. */
export const formatRemaining = (ms) => {
  const s = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(s / 60);
  if (m >= 60) return `${Math.floor(m / 60)}h ${m % 60}m`;
  return `${m}:${String(s % 60).padStart(2, '0')}`;
};

/**
 * Rank live streams for a viewer.
 *
 * ⚠ THIS IS THE PIECE THAT WAS MISSING. The multiplier existed; nothing applied
 * it to a list anyone saw.
 *
 * ⚠ INTEREST MATCHING IS FREE. `topicAffinity` is whatever the caller already
 * holds from feedRank.js — device-local counters, no Firestore read. A boost
 * therefore reaches people who like this KIND of stream rather than simply
 * reaching more people, which is what the founder asked for.
 *
 * @param streams        live stream docs
 * @param topicAffinity  { [topic]: weight } from feedRank, or null
 * @param topicsOf       (stream) => string[]  — caller supplies the inference
 */
export const rankStreams = (streams = [], { topicAffinity = null, topicsOf = null, now = Date.now() } = {}) => {
  const weights = topicAffinity || {};
  const maxW = Math.max(1, ...Object.values(weights).map(Number).filter(Number.isFinite));

  return streams
    .map((s) => {
      // Base: recency and audience, the two signals the old function used.
      const ageMs = now - (s.createdAt?.toMillis?.() ? s.createdAt.toMillis() : (s.startedAt || now));
      const recency = Math.max(0, 100 - ageMs / 60000);
      let score = recency + (s.viewerCount || 0) * 2;

      // Interest match, applied BEFORE the boost so a boost amplifies a good
      // match rather than papering over a bad one.
      if (topicsOf) {
        const topics = topicsOf(s) || [];
        const affinity = topics.reduce((sum, t) => sum + (Number(weights[t]) || 0), 0);
        if (affinity > 0) score *= 1 + Math.min(1, affinity / maxW);
      }

      const reach = boostReach(s, now);
      score *= reach;
      return { ...s, _score: score, _reach: reach, _boostMs: boostRemainingMs(s, now) };
    })
    .sort((a, b) => b._score - a._score);
};
