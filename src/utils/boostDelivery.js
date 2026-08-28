// How a paid boost actually reaches people — fairly, and at scale.
//
// ⚠ THE MODEL THIS REPLACES DELIVERED NOTHING TO ALMOST EVERYONE. Every surface
// ran `orderBy('boostExpiresAt').limit(2)`, which is DETERMINISTIC: the two
// boosts expiring soonest went to every viewer, on every render, everywhere. With
// 1,000 boosts live, 998 people had paid and received zero impressions. Founder,
// 2026-08-28: *"all boosts need to be scalable, so that there aren't bottlenecks
// and everyone gets fair value for what they have paid."*
//
// Full design: docs/BOOST_DELIVERY_PLAN.md

import { getTopicWeights, getHashtagWeights, getNegatives } from './feedPrefs';

/**
 * ⚠ FAIRNESS LIVES IN THE DATA LAYOUT, NOT IN A COUNTER.
 *
 * Every boost gets a random bucket when it is applied, and a reader queries ONE
 * random bucket. With 1,000 live boosts a bucket holds ~10 and every boost has an
 * equal chance of being in the bucket that gets asked for. No impression
 * counters, no writes, no cron, no scheduled rebalancing.
 */
export const BOOST_BUCKETS = 100;

export const pickBucket = () => Math.floor(Math.random() * BOOST_BUCKETS);

/**
 * ⚠ THE LOW-VOLUME FALLBACK IS NOT OPTIONAL.
 *
 * With three live boosts a random bucket is empty ~97% of the time, so sharding
 * alone would show nobody anything until the platform was busy. The reader asks
 * for a bucket and falls back to the unsharded query when it comes back empty:
 * at launch that is always the fallback (correct — with three boosts, show all
 * three), and at scale the bucket almost always hits. Self-tuning, with no
 * threshold anyone has to remember to change.
 */
export const needsFallback = (bucketResults) => !bucketResults || bucketResults.length === 0;

/** Topics we can infer about a candidate WITHOUT another read. */
const topicsOfUser = (u) => {
  const out = [];
  for (const t of (Array.isArray(u?.interests) ? u.interests : [])) out.push(String(t).toLowerCase());
  for (const t of (Array.isArray(u?.games) ? u.games : [])) out.push(String(t).toLowerCase());
  if (u?.primaryGame) out.push(String(u.primaryGame).toLowerCase());
  return out;
};

/**
 * Rank boosted candidates by how likely THIS viewer is to follow them.
 *
 * ⚠ COSTS ZERO READS. Affinity is device-local (`feedPrefs`), exactly as
 * `rankStreams()` already does for stream boosts. The buyer gets a follow rather
 * than an impression, which is the thing they are actually paying for.
 *
 * ⚠ It also shards the pool a SECOND time, by interest: a Valorant creator and a
 * music creator stop competing for the same slot because they are shown to
 * different people. That relief is as valuable as the bucket itself.
 */
export const rankBoostedForViewer = (candidates, { viewerUid } = {}) => {
  let topicW = {}, tagW = {}, negatives = { authors: new Set(), topics: new Set() };
  try {
    topicW = getTopicWeights() || {};
    tagW = getHashtagWeights() || {};
    const n = getNegatives();
    negatives = { authors: new Set(n?.authors || []), topics: new Set(n?.topics || []) };
  } catch { /* a fresh device has no affinity yet; everything scores 0 and that is fine */ }

  return (candidates || [])
    // ⚠ Never suggest someone to themselves. Verion was shown Verion in their own
    // "who to follow" rail on 2026-08-28 — wrong with or without a boost.
    .filter((u) => u && u.id !== viewerUid)
    // An explicit "not interested" outranks a payment. Someone who muted you
    // does not become interested because you spent coins.
    .filter((u) => !negatives.authors.has(u.id))
    .map((u) => {
      const topics = topicsOfUser(u);
      let score = 0;
      for (const t of topics) {
        if (negatives.topics.has(t)) score -= 4;
        score += Math.min(3, (topicW[t] || 0) * 0.9);
        score += Math.min(2, (tagW[t] || 0) * 0.6);
      }
      // Tiny tiebreak so a total affinity miss is not ordered arbitrarily, and
      // so the same person is not always first for the same viewer.
      return { u, score: score + Math.random() * 0.01 };
    })
    .sort((a, b) => b.score - a.score)
    .map((x) => x.u);
};

/**
 * ⚠ RELEVANCE IS THE ONLY TIEBREAK. Founder, 2026-08-28.
 *
 * Ordering eligible boosts by how much was SPENT would make this an ad auction,
 * which is a different business from the one being run. Do not add a spend term
 * to `rankBoostedForViewer`.
 */
export const BOOST_TIEBREAK = 'relevance';

/**
 * How many of a surface's slots a paid boost may occupy.
 *
 * ⚠ ONE OF FOUR IN A RAIL, and the cap is the point: a suggestion rail that is
 * mostly paid stops being a recommendation and nobody trusts it again. Extra
 * demand is met with MORE INVENTORY (the feed block), never by taking a bigger
 * share of the same four slots.
 */
export const boostSlotsFor = (totalSlots) => {
  if (totalSlots <= 2) return 1;
  return Math.max(1, Math.floor(totalSlots / 4));
};
