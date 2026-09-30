// Keeps `users/{uid}.vpLevel` in step with `wallets/{uid}.vp`.
//
// ## Why this exists (audit A110)
//
// NOTHING in the repo ever wrote `users/{uid}.vpLevel`. It was only ever read,
// always with a `|| 1` fallback. Two live consequences:
//
//   1. `EditProfileScreen` gates avatar frames on `profile?.vpLevel || 1`, so the
//      Elite (L41), Veteran (L61) and Legend (L71) frames could NEVER be selected
//      by anyone at any amount of VP. That was the only functional reward in the
//      entire VP system and it was unreachable by construction.
//   2. Squad member lists, the squad leaderboard, Browse Players and the
//      tournament invite picker all rendered "Lvl 1" for every user, while the
//      profile screens computed the level correctly from the wallet. The app
//      disagreed with itself about the same account.
//
// Why a trigger and not a write at each grant site: VP is credited from a dozen
// places (daily login, likes, tips, quests, engagement, purchases, Vanguard,
// referrals). Denormalising at each one guarantees the next new grant path
// forgets. One trigger on the wallet catches every writer, now and later.
//
// Cost: it returns immediately unless `vp` actually changed AND the change
// crosses a level boundary, so a balance-only wallet write does no work and no
// write.

const functions = require('firebase-functions/v2');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');

const db = getFirestore('vgrdb');

/** Per-level VP cost. MIRROR of levelCost() in src/utils/vpSystem.js. */
const levelCost = (level) => (level <= 1 ? 0 : 2000 + 1000 * Math.floor((level - 1) / 10));

/** Total VP -> level 1..100. Mirror of getVPLevel(). */
/** Rank band name for a level. MIRROR of RANK_TIERS in src/utils/vpSystem.js. */
/** MIRROR of BOOST_TOKEN_LEVELS in src/utils/rankUnlocks.js. */
const BOOST_TOKEN_LEVELS = [
  5, 14, 22, 26, 34, 36, 41, 43, 50, 53,
  58, 65, 74, 76, 78, 80, 82, 86, 89, 93,
  95, 97, 99,
];

/**
 * How many tokens a level grants. MIRROR of boostTokensForLevel() in
 * src/utils/rankUnlocks.js, including the divisor.
 *
 * ⚠ Not always 1. A level in Ascendant costs 11,000 VP and a level in Rookie
 * costs 2,000, so a flat one-per-level made the same reward cost 5.5x more at
 * the top of the ladder. Derived from levelCost() so it tracks a cost change.
 */
const BOOST_TOKEN_VP_PER_TOKEN = 4000;
// ⚠ MIRROR of BONUS_LADDER_LEVELS in src/utils/rankUnlocks.js. Levels that hand
// out a VP bonus pack instead of a boost token. vp-mirror-check.mjs fails the
// build if this map and the client's disagree.
const { grantBonusPack } = require('./vpBonuses');

const BONUS_LADDER_LEVELS = {
  10: 'happy_hour', 19: 'happy_hour', 29: 'flash', 39: 'flash',
  42: 'half_day', 48: 'creator', 55: 'community', 59: 'day',
  69: 'watcher', 77: 'weekend', 87: 'day',
  94: 'weekend', 96: 'long', 98: 'day',
};

const boostTokensForLevel = (level) =>
  (BOOST_TOKEN_LEVELS.includes(level)
    ? Math.max(1, Math.round(levelCost(level) / BOOST_TOKEN_VP_PER_TOKEN))
    : 0);

const RANK_BANDS = [
  [1, 'Rookie'], [11, 'Contender'], [21, 'Rival'], [31, 'Challenger'],
  [41, 'Elite'], [51, 'Champion'], [61, 'Veteran'], [71, 'Legend'],
  [81, 'Mythic'], [91, 'Ascendant'], [100, 'Immortal'],
];
function rankNameFor(level) {
  let name = 'Rookie';
  for (const [min, n] of RANK_BANDS) if (level >= min) name = n;
  return name;
}

// ⚠ MIRROR of prestigeForVP() in src/utils/vpSystem.js (vp-mirror-check).
// Past L100 every further full ladder of VP adds one prestige, capped. Status
// only: nothing resets, nothing is paid.
const TOTAL_VP_TO_MAX = (() => { let t = 0; for (let l = 2; l <= 100; l++) t += levelCost(l); return t; })();
const PRESTIGE_MAX = 10;
function prestigeForVp(totalVp) {
  const vp = Math.max(0, Number(totalVp) || 0);
  return Math.max(0, Math.min(PRESTIGE_MAX, Math.floor(vp / TOTAL_VP_TO_MAX) - 1));
}

function levelForVp(totalVp) {
  const vp = Math.max(0, Number(totalVp) || 0);
  let cumulative = 0;
  for (let level = 2; level <= 100; level++) {
    cumulative += levelCost(level);
    if (vp < cumulative) return level - 1;
  }
  return 100;
}

exports.syncVpLevel = functions.firestore.onDocumentWritten(
  { document: 'wallets/{uid}', database: 'vgrdb' },
  async (event) => {
    const before = event.data?.before?.data();
    const after = event.data?.after?.data();
    if (!after) return;                       // wallet deleted
    const beforeVp = Number(before?.vp) || 0;
    const afterVp = Number(after.vp) || 0;
    if (beforeVp === afterVp) return;         // balance-only write, do nothing

    const nextLevel = levelForVp(afterVp);
    const nextPrestige = prestigeForVp(afterVp);
    const prestigeMoved = nextPrestige !== prestigeForVp(beforeVp);
    // Same band and same prestige: nothing to write. At L100 the band never
    // moves again, so prestige is the only thing that can bring this past here.
    if (levelForVp(beforeVp) === nextLevel && before && !prestigeMoved) return;

    const uid = event.params.uid;
    try {
      // Stream Boost tokens, granted by crossing a ladder level. MIRROR of
      // BOOST_TOKEN_LEVELS in src/utils/rankUnlocks.js.
      //
      // Counts every qualifying level CROSSED, not just the level landed on, so
      // a single large VP grant that jumps several bands still pays each token
      // it passed. Nobody should lose a reward for earning too fast.
      const priorLevel = before ? levelForVp(beforeVp) : 0;
      const tokensEarned = BOOST_TOKEN_LEVELS
        .filter((l) => l > priorLevel && l <= nextLevel)
        .reduce((sum, l) => sum + boostTokensForLevel(l), 0);
      if (tokensEarned > 0) {
        await db.collection('wallets').doc(uid).set({
          boostTokens: FieldValue.increment(tokensEarned),
        }, { merge: true });
      }

      // VP bonus packs on the levels crossed. Same "every level CROSSED" rule as
      // the tokens above: a big VP grant that jumps bands must not swallow a
      // reward.
      //
      // ⚠ BEST EFFORT ON PURPOSE. A level-up must never fail because a bonus
      // could not be stamped, so each grant is caught individually and the level
      // still lands. The alternative is an account stuck below its real level.
      for (const lvl of Object.keys(BONUS_LADDER_LEVELS).map(Number).sort((a, b) => a - b)) {
        if (lvl <= priorLevel || lvl > nextLevel) continue;
        try {
          await grantBonusPack(uid, BONUS_LADDER_LEVELS[lvl], lvl);
        } catch (e) {
          console.error('vpLevel: bonus pack grant failed', uid, lvl, e && e.message);
        }
      }

      await db.collection('users').doc(uid).set(
        prestigeMoved ? { vpLevel: nextLevel, prestige: nextPrestige } : { vpLevel: nextLevel },
        { merge: true },
      );

      if (before && prestigeMoved && nextPrestige > prestigeForVp(beforeVp)) {
        await db.collection('notifications').add({
          recipientId: uid,
          type: 'vp_level_up',
          title: `Prestige ${nextPrestige}`,
          body: `You reached prestige ${nextPrestige}. A new star sits beside your rank.`,
          actionUrl: '/prestige',
          rank: rankNameFor(nextLevel),
          level: nextLevel,
          read: false,
          createdAt: new Date(),
        });
      }

      // Tell them. A level that changes silently is not a reward, and this is
      // the cheapest possible place to say so: the trigger has already run and
      // already established that the band moved, so it is one extra write on an
      // event that happens at most 99 times per account, ever. No cron, no scan.
      //
      // Only on the way UP, and never on wallet creation (`before` absent),
      // which would greet every new signup with "you reached level 1".
      if (before && nextLevel > levelForVp(beforeVp)) {
        const rank = rankNameFor(nextLevel);
        await db.collection('notifications').add({
          recipientId: uid,
          type: 'vp_level_up',
          title: `Level ${nextLevel}`,
          body: `You reached level ${nextLevel}. See what it unlocked.`,
          actionUrl: '/prestige',
          rank,
          level: nextLevel,
          read: false,
          createdAt: new Date(),
        });
      }
    } catch (e) {
      console.error('syncVpLevel failed', uid, e?.message || e);
    }
  },
);

module.exports._internal = { levelForVp, prestigeForVp };
