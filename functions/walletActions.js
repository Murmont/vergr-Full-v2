// Wallet-moving actions that used to run as CLIENT Firestore transactions.
//
// ## Why this file exists
//
// `firestore.rules` allowed the owner to write their own `wallets/{uid}`
// document freely except for a named denylist. That denylist covered the Circle
// ledger and KYC state, and (since 2026-08-16) the revenue-share payable, but it
// never covered `balance` or `vp`, because three legacy helpers in
// `src/firebase/firestore.js` wrote them straight from the browser:
//
//   awardVP()            +VP on buying a profile Boost
//   recordAdWatch()      +VP for a watched Monetag Direct Link ad, with streaks
//   contributeToSquad()  moves COINS from a member wallet into a squad treasury
//
// Any of the three could be called from the console with any number. Ported here
// so the two fields can finally be locked in the rules: the client now says WHAT
// happened, never how much, and every amount comes from a constant on this side.
//
// Coins are the sharper of the two. Self-minted coins are spendable on real
// things (unlocks, memberships, tips), and a tip funded by minted coins accrues
// a real revenue-share liability against Vergr, so a client-writable `balance`
// was a way to manufacture the payable indirectly even after the payable itself
// was locked.

const functions = require('firebase-functions/v2');
const { planOf } = require('./plan');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');

const db = getFirestore('vgrdb');
const REGION = 'europe-west1';
const HttpsError = functions.https.HttpsError;

/** Free 1x / Lite 1.5x / Pro 2x. Mirrors PLAN_VP_MULTIPLIER in src/utils/vpSystem.js. */
const PLAN_VP_MULTIPLIER = { free: 1, lite: 1.5, pro: 2 };

/** Mirrors ADS_CONFIG in src/config/ads.js. Keep the two equal. */
const ADS = { watchToEarnVp: 100, dailyAdBonusThreshold: 10, dailyAdBonusVp: 250 };

/**
 * VP for one-off actions the client can only NAME, not price.
 *
 * Deliberately tiny. Anything worth more than a token amount should be its own
 * callable with its own verification, not an entry here.
 */
const ACTION_VP = {
  // Buying a profile Boost. The coin debit happens in the Boost purchase itself;
  // this is the VP that used to come from the client calling awardVP(uid, 10).
  profile_boost: 10,
};

const { activeBonusMult } = require('./vpBonuses');
const { planSpend, debitFields } = require('./boostCoins');

/** MIRROR of rankVpBonus() in src/utils/rankUnlocks.js. +0.5%/level, cap 1.5x. */
const rankVpBonus = (level) =>
  Math.min(1.5, 1 + (Math.max(1, Number(level) || 1) - 1) * 0.005);

/**
 * Combined VP multiplier: subscription plan x rank.
 *
 * The rank half is FREE. This function already fetched the user doc to read
 * the plan, so `vpLevel` comes out of the snapshot that was going to be read
 * anyway. Adding a second read here would have made every VP grant in the app
 * cost an extra document read, forever, for a 0.5% bonus.
 */
async function planMultiplier(uid, action = 'all') {
  const snap = await db.collection('users').doc(uid).get();
  const d = snap.data() || {};
  const tier = planOf(d);
  // VP bonus packs come off the SAME snapshot, so they cost no extra read.
  // `action` is passed because a scoped pack must not pay on an action it
  // does not name — a Watcher Surge is not a posting bonus.
  return (PLAN_VP_MULTIPLIER[tier] || 1) * rankVpBonus(d.vpLevel)
    * activeBonusMult(d, action);
}

const utcDayKey = (ms = Date.now()) => new Date(ms).toISOString().slice(0, 10);
const daysBetween = (a, b) =>
  Math.round((new Date(`${b}T00:00:00Z`) - new Date(`${a}T00:00:00Z`)) / 86_400_000);

/** Grant VP for a named action. Amount is server-owned. */
exports.awardActionVp = functions.https.onCall(
  { region: REGION },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) throw new HttpsError('unauthenticated', 'Sign in first.');

    const action = String(request.data?.action || '');
    const base = ACTION_VP[action];
    if (!base) throw new HttpsError('invalid-argument', 'Unknown action.');

    const vp = Math.round(base * (await planMultiplier(uid, action)));
    await db.collection('wallets').doc(uid).set({
      vp: FieldValue.increment(vp),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });

    return { ok: true, vp };
  },
);

/**
 * Record one completed Watch-to-Earn ad. Awards base VP, advances the day/week/
 * month streaks and pays the milestone bonuses.
 *
 * This is a straight port of the old client `recordAdWatch`, with one addition:
 * the whole thing now runs in a TRANSACTION over the quest-state document, so
 * two ads finishing at once cannot both read the same `todayCount` and each
 * award the daily bonus.
 *
 * HONEST LIMIT, unchanged by the move: the client still asserts that an ad was
 * watched. Monetag Direct Link has no server-side completion callback, so there
 * is nothing to verify against. What the server now controls is the AMOUNT, the
 * per-day count and the streak arithmetic, which is what a client could
 * previously rewrite at will. Rewarded video with an SSV callback
 * (functions/admobReward.js) is the verified path and is unaffected.
 */
exports.recordAdWatch = functions.https.onCall(
  { region: REGION },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) throw new HttpsError('unauthenticated', 'Sign in first.');

    const mult = await planMultiplier(uid, 'watch_ad');
    const stateRef = db.collection('users').doc(uid).collection('private').doc('adQuest');
    const walletRef = db.collection('wallets').doc(uid);
    const today = utcDayKey();

    return db.runTransaction(async (tx) => {
      const snap = await tx.get(stateRef);
      const s = snap.exists ? snap.data() : {};

      let todayDate = s.todayDate ?? null;
      let todayCount = Number(s.todayCount || 0);
      let todayBonusClaimed = !!s.todayBonusClaimed;
      let weekStreak = Number(s.weekStreak || 0);
      let monthStreak = Number(s.monthStreak || 0);
      let lastWatchDate = s.lastWatchDate ?? null;

      if (todayDate !== today) {
        if (lastWatchDate) {
          const gap = daysBetween(lastWatchDate, today);
          if (gap === 1) { weekStreak += 1; monthStreak += 1; }
          else if (gap > 1) { weekStreak = 1; monthStreak = 1; }
        } else {
          weekStreak = 1; monthStreak = 1;
        }
        todayDate = today;
        todayCount = 0;
        todayBonusClaimed = false;
      }

      todayCount += 1;
      lastWatchDate = today;

      let creditedVp = ADS.watchToEarnVp;

      if (!todayBonusClaimed && todayCount >= ADS.dailyAdBonusThreshold) {
        creditedVp += ADS.dailyAdBonusVp;
        todayBonusClaimed = true;
      }

      let weekBonusHit = false;
      if (weekStreak > 0 && weekStreak % 7 === 0 && todayCount === 1) {
        creditedVp += 1000;
        weekBonusHit = true;
      }

      let monthBonusHit = false;
      if (monthStreak > 0 && monthStreak % 30 === 0 && todayCount === 1) {
        creditedVp += 5000;
        monthBonusHit = true;
      }

      creditedVp = Math.round(creditedVp * mult);

      tx.set(stateRef, {
        todayDate, todayCount, todayBonusClaimed,
        weekStreak, monthStreak, lastWatchDate,
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });

      tx.set(walletRef, {
        vp: FieldValue.increment(creditedVp),
        totalEarned: FieldValue.increment(creditedVp),
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });

      return {
        creditedVp, todayCount, weekStreak, monthStreak,
        dailyBonusJustHit: todayBonusClaimed && todayCount === ADS.dailyAdBonusThreshold,
        weekBonusHit, monthBonusHit,
      };
    });
  },
);

/**
 * Move coins from a member's wallet into their squad treasury.
 *
 * Membership is re-checked here. The client version trusted whatever squadId it
 * was handed, so a non-member could pay into any squad, and more to the point
 * the debit and the credit were both client writes.
 */
/**
 * Buy a Boost.
 *
 * ## Why this exists (audit A31)
 *
 * BoostScreen paid for boosts by writing the wallet from the BROWSER:
 *
 *     await updateDoc(walletRef, { balance: current - boost.coins, totalSpent: ... })
 *
 * Both fields went on the server-only denylist in the 2026-08-16 pass, so that
 * write was refused, the catch fired, and the user got a generic "Boost failed".
 * There was no path through that screen that could succeed — one of the four
 * revenue categories in CLAUDE.md, and every purchase failed.
 *
 * Three further faults in the old handler, all fixed by moving here:
 *   • It was a read-then-write (getDoc, then updateDoc with a computed absolute
 *     value), so two tabs would race and lose a debit. This uses increment()
 *     inside a transaction.
 *   • The wallet debit, the boosts doc and the ledger row were three sequential
 *     unbatched writes: a failure after the first left a charge with no boost.
 *     All three are now in one transaction.
 *   • The price came from the client. It comes from BOOST_COSTS here.
 *
 * Keep BOOST_COSTS in sync with src/utils/vpSystem.js. The client copy is for
 * DISPLAY ONLY and is never trusted for an amount.
 */
const BOOST_COSTS = {
  post:    { coins: 50,  duration: 24 },
  profile: { coins: 100, duration: 48 },
  lfg:     { coins: 25,  duration: 12 },
  squad:   { coins: 75,  duration: 48 },
  // 'stream' removed 2026-08-28 — the dead duplicate of BOOST_TIERS.boost.
  // The explicit refusal below covers stale clients.
};

exports.purchaseBoost = functions.https.onCall(
  { region: REGION },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) throw new HttpsError('unauthenticated', 'Sign in first.');

    const type = String(request.data?.type || '');
    const targetId = request.data?.targetId ? String(request.data.targetId) : null;
    const boost = BOOST_COSTS[type];
    if (!boost) throw new HttpsError('invalid-argument', 'Unknown boost type.');

    // ⚠ WHERE THE BOOST ACTUALLY LANDS. Until 2026-08-28 this callable wrote a
    // `boosts` ledger doc and NOTHING ELSE, and nothing anywhere read that
    // collection, so every boost sold was a coin debit with no effect. The
    // reader side is src/utils/promoBoost.js; the target doc carries
    // `boostExpiresAt` and expiry is evaluated at read time (no cron, and a
    // single-field inequality needs no composite index).
    const TARGETS = {
      post:    { col: 'posts',  owner: 'authorId' },
      lfg:     { col: 'posts',  owner: 'authorId' },   // an LFG post IS a post
      squad:   { col: 'squads', owner: 'ownerId' },
      profile: { col: 'users',  owner: null },          // the target IS the buyer
    };
    // ⚠ `stream` is deliberately absent from TARGETS. BOOST_COSTS.stream (60c/4h,
    // "pinned to the Live tab") collides by name with BOOST_TIERS.boost (50c/15min
    // of discovery reach), which is the one the rebuilt Stream Boost honours.
    // Taking coins for the dead duplicate is worse than refusing it.
    if (type === 'stream') {
      throw new HttpsError('failed-precondition',
        'Stream boosts are bought from the stream itself, in the gift menu.');
    }
    const spec = TARGETS[type];
    if (!spec) throw new HttpsError('invalid-argument', 'That boost has no target.');

    // profile boosts always target the buyer; everything else needs an id.
    const targetDocId = spec.owner ? targetId : uid;
    if (!targetDocId) {
      throw new HttpsError('invalid-argument',
        `Choose what to boost before buying a ${type} boost.`);
    }

    const walletRef = db.collection('wallets').doc(uid);
    const targetRef = db.collection(spec.col).doc(targetDocId);
    const boostRef = db.collection('boosts').doc();
    const boostUntil = new Date(Date.now() + boost.duration * 3600000);

    await db.runTransaction(async (tx) => {
      // All reads before any write (Firestore requirement).
      const [wSnap, tSnap] = await Promise.all([tx.get(walletRef), tx.get(targetRef)]);
      if (!tSnap.exists) throw new HttpsError('not-found', 'That is no longer there.');

      // ⚠ OWNERSHIP. `targetId` came straight off the request and was never
      // checked, which was harmless only because nothing read the result. Now
      // that a boost does something, an unchecked id would let anyone spend
      // their own coins to promote somebody else's post or squad.
      if (spec.owner) {
        const ownerUid = tSnap.data()[spec.owner];
        if (ownerUid !== uid) {
          throw new HttpsError('permission-denied', 'You can only boost your own.');
        }
      }
      const plan = planSpend(wSnap.exists ? wSnap.data() : {}, boost.coins);
      // Say WHY, with the numbers. The old screen's generic "Boost failed" gave
      // the user nothing to act on.
      if (!plan.ok) {
        throw new HttpsError('failed-precondition',
          `Not enough coins. This boost costs ${boost.coins} and you have ${plan.total}.`);
      }

      tx.update(walletRef, {
        ...debitFields(plan),
        updatedAt: FieldValue.serverTimestamp(),
      });
      // ⚠ EXTEND, never shorten. Buying a second boost while one is running
      // must add time, not reset a longer one to a shorter window.
      const existing = Number(tSnap.data().boostExpiresAt) || 0;
      const from = Math.max(existing, Date.now());
      const expiresAt = from + boost.duration * 3600000;
      // ⚠ A BUCKET, OR THIS BOOST IS NEVER DELIVERED. Readers shard by
      // `where('boostBucket','==',n)`, and a document MISSING that field matches
      // no bucket at all. Until 2026-08-28 only applyBoost stamped one, so every
      // profile boost bought from the shop tab (the only boost sold there) was
      // invisible to the sharded read and survived purely on the empty-bucket
      // fallback, which stops firing the moment the platform is busy enough for
      // buckets to be non-empty. A paid boost that goes dark exactly when there
      // is finally an audience is the defect this whole feature exists to undo.
      // MIRROR of BOOST_BUCKETS in src/utils/boostDelivery.js.
      tx.set(targetRef, {
        boostExpiresAt: expiresAt,
        boostedAt: Date.now(),
        boostBucket: Math.floor(Math.random() * 100),
      }, { merge: true });

      // ⚠ ONE LEDGER SHAPE. applyBoost writes { boostId, target, startedAt } and
      // the buyer's receipt (getMyActiveBoosts -> MyBoosts.jsx) reads exactly
      // those three. This callable used to write only `type`, so a Profile Boost
      // bought from the shop tab showed up in RUNNING NOW with a blank name, 0
      // impressions and 0 people: the receipt fell back to posts/{uid} while the
      // real counters were on the users doc, and followersGained is gated on
      // target === 'user' so it never ran either. The founder's requirement for
      // this feature was that the buyer can SEE what they paid for.
      //
      // `type` is kept because the BOOST_COSTS ids and the catalogue ids are the
      // same strings, and existing rows are read by it.
      tx.set(boostRef, {
        userId: uid, type, boostId: type, target: spec.col === 'users' ? 'user'
          : spec.col === 'squads' ? 'squad' : 'post',
        targetId: targetDocId,
        coins: boost.coins, duration: boost.duration,
        startedAt: Date.now(),
        boostUntil, expiresAt, status: 'active',
        createdAt: FieldValue.serverTimestamp(),
      });
      tx.set(db.collection('transactions').doc(), {
        userId: uid, type: 'boost', amount: -boost.coins, currency: 'coins',
        description: `${type} boost (${boost.duration}h)`,
        createdAt: FieldValue.serverTimestamp(),
      });
    });

    // VP is awarded from ACTION_VP, the same server-side table awardActionVp
    // uses. The old screen's toast hardcoded "+10 VP" while calling a shim that
    // ignored its arguments, so the number shown was not the number granted.
    const base = ACTION_VP.profile_boost || 0;
    const vp = Math.round(base * (await planMultiplier(uid, 'profile_boost')));
    if (vp > 0) {
      await db.collection('wallets').doc(uid).set({
        vp: FieldValue.increment(vp),
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
    }

    return { ok: true, coins: boost.coins, vp, boostId: boostRef.id };
  },
);

exports.contributeToSquad = functions.https.onCall(
  { region: REGION },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) throw new HttpsError('unauthenticated', 'Sign in first.');

    const squadId = String(request.data?.squadId || '');
    const amount = Math.floor(Number(request.data?.amount) || 0);
    if (!squadId) throw new HttpsError('invalid-argument', 'squadId required.');
    if (amount <= 0) throw new HttpsError('invalid-argument', 'Amount must be positive.');
    if (amount > 1_000_000) throw new HttpsError('invalid-argument', 'Amount too large.');

    const walletRef = db.collection('wallets').doc(uid);
    const squadWalletRef = db.collection('squads').doc(squadId).collection('wallet').doc('main');
    const memberRef = db.collection('squads').doc(squadId).collection('members').doc(uid);

    await db.runTransaction(async (tx) => {
      const [wSnap, mSnap] = await Promise.all([tx.get(walletRef), tx.get(memberRef)]);
      if (!mSnap.exists) throw new HttpsError('permission-denied', 'You are not in this squad.');
      const balance = Math.floor(wSnap.exists ? (wSnap.data().balance || 0) : 0);
      if (balance < amount) throw new HttpsError('failed-precondition', 'Insufficient balance.');

      tx.update(walletRef, {
        balance: FieldValue.increment(-amount),
        totalSpent: FieldValue.increment(amount),
        updatedAt: FieldValue.serverTimestamp(),
      });
      tx.set(squadWalletRef, {
        balance: FieldValue.increment(amount),
        totalContributed: FieldValue.increment(amount),
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
      tx.update(memberRef, {
        totalContributed: FieldValue.increment(amount),
        updatedAt: FieldValue.serverTimestamp(),
      });
      tx.set(db.collection('transactions').doc(), {
        userId: uid, type: 'squad_contribution', amount: -amount,
        currency: 'coins', desc: 'Squad contribution', squadId,
        createdAt: FieldValue.serverTimestamp(),
      });
      tx.set(db.collection('squads').doc(squadId).collection('transactions').doc(), {
        userId: uid, type: 'contribution', amount,
        createdAt: FieldValue.serverTimestamp(),
      });
    });

    return { ok: true, amount };
  },
);
