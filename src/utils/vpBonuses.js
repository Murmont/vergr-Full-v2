// VP bonus packs — timed multipliers on what you earn.
//
// ⚠ THEY ARE BOUGHT WITH COINS ONLY, NEVER WITH VP. Founder, 2026-08-28. And it
// is not only a preference: a VP-priced VP multiplier is an infinite loop. Price
// it above what it returns and nobody buys it; below, and VP inflates without
// limit. There is no price that works, so there is no VP price.
//
// ⚠ THEY ARE ALSO LADDER REWARDS. Specific levels grant a specific pack, which is
// what broke up the run of seven identical boost tokens at L93-99. See
// BONUS_LADDER_LEVELS in rankUnlocks.js.
//
// ⚠ THIS FILE IS THE SOURCE OF TRUTH AND IS MIRRORED IN functions/vpBonuses.js,
// which is what actually debits coins and stamps the bonus. scripts/vp-mirror-check.mjs
// fails the build if a single id, price, duration or multiplier drifts.
//
// Full design, pricing derivation and the rejected alternatives:
// docs/VP_BONUS_PACKS_PLAN.md

/**
 * ⚠ EVERY NUMBER HERE IS THE ECONOMY AND IS THE FOUNDER'S TO SET.
 *
 * `coins` is anchored to constants already in the product (BOOST_COSTS,
 * BOOST_TIERS) rather than invented, and every pack is deliberately priced ABOVE
 * the coin value of the VP it can return, so buying one can never be an
 * arbitrage. Re-check that if boost-token density ever changes — the whole
 * calculation hangs on it (plan §11.4).
 *
 * scope: 'all', or an allowlist of VP action keys. A focused pack is cheaper
 * because it only pays on what it names.
 */
export const VP_BONUS_PACKS = [
  {
    id: 'happy_hour',
    name: 'Happy Hour',
    mult: 3,
    hours: 1,
    coins: 25,
    scope: 'all',
    art: 'happy-hour',
    desc: 'Triple VP for one hour. Everything you do counts three times.',
  },
  {
    id: 'flash',
    name: 'Flash Surge',
    mult: 3,
    hours: 6,
    coins: 75,
    scope: 'all',
    art: 'flash-surge',
    desc: 'Triple VP for six hours. Built for one long session.',
  },
  {
    id: 'half_day',
    name: 'Half-Day Surge',
    mult: 2.5,
    hours: 12,
    coins: 120,
    scope: 'all',
    art: 'half-day-surge',
    desc: 'Two and a half times VP for half a day.',
  },
  {
    id: 'day',
    name: 'Day Surge',
    mult: 2,
    hours: 24,
    coins: 200,
    scope: 'all',
    art: 'day-surge',
    desc: 'Double VP for a full day, whenever you play it.',
  },
  {
    id: 'weekend',
    name: 'Weekend Surge',
    mult: 1.75,
    hours: 48,
    coins: 350,
    scope: 'all',
    art: 'weekend-surge',
    desc: 'Extra VP across two days. Enough to cover a whole weekend.',
  },
  {
    id: 'long',
    name: 'Long Surge',
    mult: 1.5,
    hours: 168,
    coins: 900,
    scope: 'all',
    art: 'long-surge',
    desc: 'Extra VP for a full week. The one you set and forget.',
  },
  // Focused packs. Cheaper, because they only pay on what they name.
  {
    id: 'creator',
    name: 'Creator Surge',
    mult: 3,
    hours: 24,
    coins: 150,
    scope: ['create_post', 'go_live', 'stream_hour'],
    art: 'creator-surge',
    desc: 'Triple VP for a day on posting, going live and hours streamed.',
  },
  {
    id: 'community',
    name: 'Community Surge',
    mult: 3,
    hours: 24,
    coins: 150,
    scope: ['get_like', 'get_comment', 'comment_post', 'like_post'],
    art: 'community-surge',
    desc: 'Triple VP for a day on likes and comments, given and received.',
  },
  {
    id: 'watcher',
    name: 'Watcher Surge',
    mult: 3,
    hours: 24,
    coins: 100,
    scope: ['watch_stream_hour'],
    art: 'watcher-surge',
    desc: 'Triple VP for a day on time spent watching live streams.',
  },
];

export const bonusPackById = (id) => VP_BONUS_PACKS.find((p) => p.id === id) || null;

/**
 * ⚠ THE CEILING, AND WHY STACKING IS ADDITIVE ON THE EXCESS.
 *
 * Two 2x packs give 3x, never 4x. This is deliberately the SAME rule
 * `boostReach()` uses in streamBoost.js, so the product has one stacking model
 * instead of two that behave differently and both feel arbitrary.
 *
 * It matters more here than it does for a stream, because this multiplier is
 * itself multiplied by the plan tier (Pro 2x) and the rank bonus. A 3.0 ceiling
 * with Pro already reaches 6x base.
 */
export const VP_BONUS_CEILING = 3;

const ms = (b) => {
  const t = b?.expiresAt;
  if (t == null) return 0;
  if (typeof t === 'number') return t;
  if (typeof t?.toMillis === 'function') return t.toMillis();      // Firestore Timestamp
  if (typeof t?.seconds === 'number') return t.seconds * 1000;     // raw {seconds}
  const n = Date.parse(t);
  return Number.isFinite(n) ? n : 0;
};

/** Bonuses on the user doc that have not expired. Read-time, never a cron. */
export const activeBonuses = (user, now = Date.now()) => {
  const list = Array.isArray(user?.vpBonuses) ? user.vpBonuses : [];
  return list.filter((b) => b && ms(b) > now);
};

/** True if this pack pays on this VP action. */
export const bonusCoversAction = (bonus, actionKey) => {
  const s = bonus?.scope;
  if (!s || s === 'all') return true;
  return Array.isArray(s) ? s.includes(actionKey) : s === actionKey;
};

/**
 * The multiplier for ONE action, given everything currently active.
 *
 * ⚠ Scoped packs only count for the actions they name, so someone holding a
 * Watcher Surge does not silently get 3x on posting. Returns 1 when nothing
 * applies, which is the identity — callers multiply it in unconditionally.
 */
export const activeBonusMult = (user, actionKey, now = Date.now()) => {
  const applies = activeBonuses(user, now).filter((b) => bonusCoversAction(b, actionKey));
  if (!applies.length) return 1;
  const excess = applies.reduce((sum, b) => sum + Math.max(0, (Number(b.mult) || 1) - 1), 0);
  return Math.min(VP_BONUS_CEILING, 1 + excess);
};

/** Milliseconds left on the longest-running active bonus, 0 when none. */
export const bonusRemainingMs = (user, now = Date.now()) =>
  activeBonuses(user, now).reduce((max, b) => Math.max(max, ms(b) - now), 0);

/** "6h 12m" / "48m" / "31s" — the same shape the stream boost countdown uses. */
export const formatRemaining = (msLeft) => {
  if (msLeft <= 0) return '';
  const s = Math.floor(msLeft / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m`;
  return `${s}s`;
};

export const ART_V = 2;

/**
 * Art path, with a version stamp.
 *
 * ⚠ THE VERSION IS NOT DECORATION. `/brand/**` carries 7-day browser and 30-day
 * CDN cache headers, and Firebase's SPA rewrite answers a MISSING asset with
 * index.html at HTTP 200 rather than a 404. So anyone who opened the shop before
 * the art existed cached an HTML response at the image URL, and their <img>
 * quietly fails onError for the life of that cache. Measured on the live site
 * 2026-08-28: naturalWidth 0 and visibility hidden on every card, while the same
 * URL with a cache-buster loaded fine.
 *
 * The same trap fires when art is REPLACED: drop a new render at the same path
 * and nobody sees it for up to 30 days. **Bump ART_V whenever the art changes.**
 */
export const bonusArt = (pack, x2 = false) =>
  `/brand/bonuses/${pack.art}${x2 ? '@2x' : ''}.webp?v=${ART_V}`;

/** "1 hour" / "12 hours" / "7 days" for display. */
export const formatDuration = (hours) => {
  if (hours >= 24 && hours % 24 === 0) {
    const d = hours / 24;
    return d === 1 ? '1 day' : `${d} days`;
  }
  return hours === 1 ? '1 hour' : `${hours} hours`;
};
