// Paid boosts on a post, a profile or a squad — the reader side.
//
// ⚠ UNTIL 2026-08-28 EVERY ONE OF THESE BOUGHT NOTHING. `purchaseBoost` debited
// coins and wrote a `boosts` ledger doc, and `collection('boosts')` appeared
// EXACTLY ONCE in the whole repo — that write. Nothing read it, and the target
// post/profile/squad was never touched, so the feed, the suggested-users rail and
// the squad list all ranked exactly as they had before. Same defect as the old
// Stream Boost that bought a badge, and the same as the three inert kill
// switches. If you are about to add a boost, add its READER in the same commit.
//
// The mechanic is deliberately the one `streamBoost.js` already uses: the SERVER
// stamps `boostExpiresAt` (a millisecond number) on the TARGET document, and
// expiry is evaluated at read time. No cron, no scheduled sweep, and
// `boostExpiresAt > now` is a single-field inequality so it needs no composite
// index.

/** Millis from whatever shape the field arrived in (number, Timestamp, ISO). */
const ms = (v) => {
  if (v == null) return 0;
  if (typeof v === 'number') return v;
  if (typeof v?.toMillis === 'function') return v.toMillis();
  if (typeof v?.seconds === 'number') return v.seconds * 1000;
  const n = Date.parse(v);
  return Number.isFinite(n) ? n : 0;
};

export const boostExpiryMs = (doc) => ms(doc?.boostExpiresAt);

/** True while a paid boost is still running on this document. */
export const isBoosted = (doc, now = Date.now()) => boostExpiryMs(doc) > now;

export const boostRemainingMs = (doc, now = Date.now()) =>
  Math.max(0, boostExpiryMs(doc) - now);

/**
 * ⚠ 3x, because that is what the product has always PROMISED.
 * `BOOST_COSTS.post.desc` has said "3x visibility in For You for 24h" the entire
 * time it did nothing. The number is not a new invention; making it true is the
 * whole point of this file. Change it only with the copy.
 */
export const POST_BOOST_REACH = 3;

/**
 * Put boosted items first, then everything else, with no duplicates.
 *
 * ⚠ A BOOSTED ITEM MUST COME FROM ITS OWN QUERY. This is the lesson the stream
 * boost rebuild left: ordering the top N by the primary sort (followers, member
 * count) can never surface a boosted item that is not already near the top,
 * which is exactly why the old boost was worthless. The caller runs a second
 * `where('boostExpiresAt','>',now)` query and hands both lists here.
 *
 * Order within the boosted group is by expiry ASC, so the boost closest to
 * running out gets the exposure it paid for before it lapses.
 */
export const mergeBoostedFirst = (boosted, organic, cap = 0, now = Date.now()) => {
  const live = (boosted || [])
    .filter((d) => d && isBoosted(d, now))
    .sort((a, b) => boostExpiryMs(a) - boostExpiryMs(b));
  const seen = new Set(live.map((d) => d.id));
  const rest = (organic || []).filter((d) => d && !seen.has(d.id));
  const out = [...live, ...rest];
  return cap > 0 ? out.slice(0, cap) : out;
};

/** "11h 20m" / "45m" / "30s". Matches the stream-boost countdown. */
export const formatBoostRemaining = (msLeft) => {
  if (msLeft <= 0) return '';
  const s = Math.floor(msLeft / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m`;
  return `${s}s`;
};
