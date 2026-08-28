// Milestone badges — earned by DOING, not by buying.
//
// ── THE CONTRACT ────────────────────────────────────────────────────
//
// A badge is a PURE FUNCTION of counters that are already on the user and
// wallet documents the app has loaded. No Firestore read, no cron, no trigger,
// no stamped "earned" record anywhere. Opening a profile costs exactly what it
// cost before badges existed.
//
// That is only safe because every counter below is SERVER-WRITTEN and
// SERVER-ONLY (see firestore.rules: `clipCount` on users, the streak counters
// on wallets, and the money aggregates that were locked down on 2026-08-16).
// The evaluation is client-side; the DATA is not. So the badge a visitor sees
// on someone's profile is computed from that person's real server-written
// counters, and the worst a user can do by tampering locally is lie to
// themselves on their own screen.
//
// ⚠ RULE: never add a badge whose counter has no server writer. A badge that
// can never be earned is worse than no badge — it is a visible promise the app
// does not keep, which is the exact failure the /prestige earn table had.
// `node scripts/vp-mirror-check.mjs` asserts every threshold has a source.
//
// ── WHAT IS DELIBERATELY ABSENT ─────────────────────────────────────
//
// Nothing keyed to subscription tier: buying Pro is not an achievement.
// Nothing keyed to `totalSpent`: the coin economy already rewards spending, and
// a badge for it cheapens the ones that took work. Generosity IS here, because
// `totalTipped` measures giving your coins to someone else, which is a choice
// rather than a purchase (founder's own "gifted 10,000" example).

/**
 * Where each counter lives. `user` = users/{uid}, `wallet` = wallets/{uid}.
 * Recorded per badge so a reader can check the writer without grepping.
 */
const FROM_USER = 'user';
const FROM_WALLET = 'wallet';

/**
 * @typedef {Object} Milestone
 * @property {string} id        stable id, never renamed (it is what a profile stores nothing of, but analytics keys on)
 * @property {string} family    grouping for the badge case
 * @property {string} name      shown on the badge
 * @property {string} desc      what you did to get it
 * @property {string} icon      Material Symbols name (outlined set only)
 * @property {string} color     accent for the badge face
 * @property {string} source    which doc the counter lives on
 * @property {string} field     dotted path to the counter
 * @property {number} need      threshold, inclusive
 */

const m = (id, family, name, desc, icon, color, source, field, need, writer) =>
  ({ id, family, name, desc, icon, color, source, field, need, writer });

// ── 1. ON AIR ── users.streamMinutes, written by functions/streaming.js
const ON_AIR = [
  m('air_first', 'On air', 'First Light', 'Finished your first stream.', 'sensors', '#9AA3B2', FROM_USER, 'streamMinutes', 1, 'streaming.js'),
  m('air_10h', 'On air', 'Ten Hours', 'Streamed for 10 hours.', 'sensors', '#4DFFD4', FROM_USER, 'streamMinutes', 600, 'streaming.js'),
  m('air_100h', 'On air', 'Century', 'Streamed for 100 hours.', 'sensors', '#F5C542', FROM_USER, 'streamMinutes', 6000, 'streaming.js'),
  m('air_1000h', 'On air', 'Thousand Hours', 'Streamed for 1,000 hours.', 'sensors', '#FFFFFF', FROM_USER, 'streamMinutes', 60000, 'streaming.js'),
];

// ── 2. CREATOR ── users.postCount (index.js) and users.clipCount (onPostCreatedAwardVp)
const CREATOR = [
  m('post_first', 'Creator', 'Opening Post', 'Published your first post.', 'edit_note', '#9AA3B2', FROM_USER, 'postCount', 1, 'index.js'),
  m('post_100', 'Creator', 'Hundred', 'Published 100 posts.', 'edit_note', '#4DFFD4', FROM_USER, 'postCount', 100, 'index.js'),
  m('clip_50', 'Creator', 'Clipped', 'Created 50 clips.', 'movie', '#F5C542', FROM_USER, 'clipCount', 50, 'index.js'),
  m('post_500', 'Creator', 'Archivist', 'Published 500 posts.', 'edit_note', '#FFFFFF', FROM_USER, 'postCount', 500, 'index.js'),
];

// ── 3. GENEROUS ── wallets.totalTipped, written by sendTip (index.js)
const GENEROUS = [
  m('tip_first', 'Generous', 'First Tip', 'Sent your first tip.', 'volunteer_activism', '#9AA3B2', FROM_WALLET, 'totalTipped', 1, 'index.js'),
  m('tip_1k', 'Generous', 'Patron', 'Sent 1,000 coins to other people.', 'volunteer_activism', '#4DFFD4', FROM_WALLET, 'totalTipped', 1000, 'index.js'),
  m('tip_10k', 'Generous', 'Benefactor', 'Sent 10,000 coins to other people.', 'volunteer_activism', '#F5C542', FROM_WALLET, 'totalTipped', 10000, 'index.js'),
  m('tip_100k', 'Generous', 'Kingmaker', 'Sent 100,000 coins to other people.', 'volunteer_activism', '#FFFFFF', FROM_WALLET, 'totalTipped', 100000, 'index.js'),
];

// ── 4. EARNER ── wallets.totalEarnedCoinsGross, the shared earnedCoinCredit path
const EARNER = [
  m('earn_first', 'Earner', 'First Earn', 'Earned revenue share for the first time.', 'trending_up', '#9AA3B2', FROM_WALLET, 'totalEarnedCoinsGross', 1, 'coinLedger.js'),
  m('earn_10k', 'Earner', 'Working Creator', 'Earned 10,000 coins gross.', 'trending_up', '#4DFFD4', FROM_WALLET, 'totalEarnedCoinsGross', 10000, 'coinLedger.js'),
  m('earn_100k', 'Earner', 'Full Time', 'Earned 100,000 coins gross.', 'trending_up', '#F5C542', FROM_WALLET, 'totalEarnedCoinsGross', 100000, 'coinLedger.js'),
  m('earn_1m', 'Earner', 'Top Line', 'Earned 1,000,000 coins gross.', 'trending_up', '#FFFFFF', FROM_WALLET, 'totalEarnedCoinsGross', 1000000, 'coinLedger.js'),
];

// ── 5. LOYAL ── wallets.distinctDaysActive / bestConsecutiveDays
//
// ⚠ These read the UNCAPPED counters, never `dailyStreak`. `dailyStreak` is the
// 5-day bonus loop: it resets to 0 every time the +50 fires, so a record read
// from it can never exceed 5 and "Regular" would be unreachable.
const LOYAL = [
  m('loyal_7', 'Loyal', 'Week One', 'Checked in on 7 separate days.', 'calendar_month', '#9AA3B2', FROM_WALLET, 'distinctDaysActive', 7, 'index.js'),
  m('loyal_streak30', 'Loyal', 'Regular', 'Checked in 30 days in a row.', 'local_fire_department', '#4DFFD4', FROM_WALLET, 'bestConsecutiveDays', 30, 'index.js'),
  m('loyal_180', 'Loyal', 'Fixture', 'Checked in on 180 separate days.', 'calendar_month', '#F5C542', FROM_WALLET, 'distinctDaysActive', 180, 'index.js'),
];

// ── 6. COMMUNITY ── users.followerCount, users.referrals.allTime
const COMMUNITY = [
  m('fol_100', 'Community', 'Heard', '100 people follow you.', 'group', '#9AA3B2', FROM_USER, 'followerCount', 100, 'index.js'),
  m('fol_1k', 'Community', 'Known', '1,000 people follow you.', 'group', '#4DFFD4', FROM_USER, 'followerCount', 1000, 'index.js'),
  m('ref_10', 'Community', 'Recruiter', 'Brought 10 verified people to Vergr.', 'person_add', '#F5C542', FROM_USER, 'referrals.allTime', 10, 'index.js'),
  m('fol_10k', 'Community', 'Broadcaster', '10,000 people follow you.', 'group', '#FFFFFF', FROM_USER, 'followerCount', 10000, 'index.js'),
];

export const MILESTONES = [...ON_AIR, ...CREATOR, ...GENEROUS, ...EARNER, ...LOYAL, ...COMMUNITY];

export const MILESTONE_FAMILIES = ['On air', 'Creator', 'Generous', 'Earner', 'Loyal', 'Community'];

// ── ONE-OFFS ────────────────────────────────────────────────────────
//
// Not threshold badges: each is a fact about the account that either is or is
// not true, and two of them can never be earned again once their window shuts.
// Scarcity is the whole point, so they are evaluated separately rather than
// being given a fake numeric threshold.
export const ONE_OFFS = [
  {
    id: 'one_day1', family: 'Rare', name: 'Day One', icon: 'flag', color: '#FFB347',
    desc: 'Joined before Vergr opened to the public.',
    // ⚠ Set this to the real public-launch instant when it is known, and never
    // move it afterwards. A badge whose window can be reopened is not rare.
    test: (u) => {
      const ms = tsMs(u?.createdAt);
      return !!ms && ms < PUBLIC_LAUNCH_MS;
    },
  },
  {
    id: 'one_founder_era', family: 'Rare', name: 'Founder Era', icon: 'auto_awesome', color: '#C87FFF',
    desc: 'Active during Vergr\'s first year.',
    test: (u) => {
      const ms = tsMs(u?.createdAt);
      return !!ms && ms < PUBLIC_LAUNCH_MS + 365 * 24 * 3600 * 1000;
    },
  },
  {
    id: 'one_immortal', family: 'Rare', name: 'Immortal', icon: 'workspace_premium', color: '#FFFFFF',
    desc: 'Reached level 100.',
    test: (u) => (Number(u?.vpLevel) || 0) >= 100,
  },
  {
    id: 'one_vanguard', family: 'Rare', name: 'Vanguard', icon: 'shield', color: '#7B6FFF',
    desc: 'Served as a Vergr moderator.',
    // Any rank ever held counts, including retired: the service happened.
    test: (u) => !!u?.vanguard?.rank,
  },
];

/**
 * Public launch, as epoch ms. Placeholder until the date is set.
 * ⚠ Both rare badges above key on this. Moving it retroactively grants or
 * revokes a badge on live accounts, so change it once and never again.
 */
export const PUBLIC_LAUNCH_MS = Date.UTC(2026, 8, 1);   // 2026-09-01, provisional

/** Firestore Timestamp | Date | number -> ms. Mirrors tsMs() used elsewhere. */
function tsMs(t) {
  if (!t) return 0;
  if (typeof t === 'number') return t;
  if (typeof t.toMillis === 'function') return t.toMillis();
  if (typeof t.toDate === 'function') return t.toDate().getTime();
  if (t.seconds) return t.seconds * 1000;
  const d = new Date(t);
  return Number.isNaN(d.getTime()) ? 0 : d.getTime();
}

/** Read a dotted path off an object without throwing on a missing branch. */
const at = (obj, path) =>
  path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);

/**
 * Everything about a user's badges, in one pass over a static table.
 *
 * @param {object} user    the users/{uid} document
 * @param {object} wallet  the wallets/{uid} document (may be null when viewing
 *                         somebody else — wallet-sourced badges are then simply
 *                         not evaluated rather than being shown as unearned,
 *                         because "not visible" and "not earned" are different
 *                         and only one of them is true)
 * @returns {{earned: object[], locked: object[], next: object|null, count: number}}
 */
export function milestonesFor(user, wallet) {
  const earned = [];
  const locked = [];

  for (const b of MILESTONES) {
    const src = b.source === FROM_WALLET ? wallet : user;
    // A wallet we were not given is UNKNOWN, not zero. Skip rather than lie.
    if (b.source === FROM_WALLET && !wallet) continue;
    const have = Number(at(src, b.field)) || 0;
    const row = { ...b, have, pct: Math.min(100, (have / b.need) * 100) };
    (have >= b.need ? earned : locked).push(row);
  }

  for (const o of ONE_OFFS) {
    let ok = false;
    try { ok = !!o.test(user); } catch { ok = false; }
    if (ok) earned.push({ ...o, have: 1, need: 1, pct: 100, oneOff: true });
  }

  // The closest unearned badge, so the profile can show a chase rather than
  // only a trophy shelf. Sorted by how close, not by threshold size.
  locked.sort((a, b) => b.pct - a.pct);

  return { earned, locked, next: locked[0] || null, count: earned.length };
}

/** Total badges obtainable, for "12 / 27" style counters. */
export const MILESTONE_TOTAL = MILESTONES.length + ONE_OFFS.length;
