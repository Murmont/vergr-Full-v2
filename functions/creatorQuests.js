// Creator quests — server-authoritative VP claims.
//
// ## Why this file exists
//
// Claiming used to be a CLIENT Firestore transaction (`claimQuestReward` in
// src/firebase/firestore.js). It took the VP amount as an argument from the
// caller, verified nothing about whether the quest had been done, and wrote
// `users/{uid}.vp` directly. Two separate problems:
//
//   1. The amount came from the client. Anyone could claim any number.
//   2. `firestore.rules` denies client writes to `quest_claims`, so the
//      transaction always threw and EVERY claim failed with a red toast. The
//      feature was simultaneously insecure by design and broken in practice.
//
// So the rewards table lives here, the claim is idempotent per (uid, quest,
// UTC day), and each quest carries a VERIFIER that has to agree the thing was
// actually done before any VP is granted.
//
// ## Verification
//
// A quest that pays out without checking is a daily VP faucet with extra steps.
// Each verifier is a single cheap indexed query against data the app already
// writes. Where a quest cannot be verified from stored data it is NOT shipped
// as claimable, rather than shipped on trust.

const functions = require('firebase-functions/v2');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');

const db = getFirestore('vgrdb');
const REGION = 'europe-west1';
const HttpsError = functions.https.HttpsError;

/** Free 1x / Lite 1.5x / Pro 2x. Mirrors PLAN_VP_MULTIPLIER in src/utils/vpSystem.js. */
const PLAN_VP_MULTIPLIER = { free: 1, lite: 1.5, pro: 2 };

const startOfUtcDay = (now = Date.now()) => {
  const d = new Date(now);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
};
const startOfUtcWeek = (now = Date.now()) => startOfUtcDay(now) - 6 * 86_400_000;

/** Did this user author >= n posts matching `pred` since `sinceMs`? */
async function authoredSince(uid, sinceMs, n, pred = () => true) {
  const snap = await db.collection('posts')
    .where('authorId', '==', uid)
    .where('createdAt', '>=', new Date(sinceMs))
    .limit(50)
    .get();
  return snap.docs.filter((d) => pred(d.data())).length >= n;
}

/**
 * The quest table. `vp` is the BASE award; the plan multiplier is applied on
 * top, server-side, exactly as every other VP grant does.
 *
 * Keep in sync with CREATOR_QUESTS in src/screens/creator/CreatorQuestsScreen.jsx.
 * The client copy is for DISPLAY ONLY and is never trusted for an amount.
 */
const QUESTS = {
  creator_post: {
    vp: 30,
    verify: (uid) => authoredSince(uid, startOfUtcDay(), 1),
    unmet: 'Post something today to claim this.',
  },
  creator_short: {
    vp: 50,
    verify: (uid) => authoredSince(uid, startOfUtcWeek(), 1, (p) => p.type === 'short'),
    unmet: 'Publish a Short this week to claim this.',
  },
  creator_tierlist: {
    vp: 40,
    verify: (uid) => authoredSince(uid, startOfUtcWeek(), 1, (p) => p.type === 'tierlist'),
    unmet: 'Publish a tier list to claim this.',
  },
  creator_stream: {
    vp: 100,
    // 30 minutes live, from the stream's own start/end stamps.
    verify: async (uid) => {
      const snap = await db.collection('streams')
        .where('hostUid', '==', uid)
        .where('startedAt', '>=', new Date(startOfUtcDay()))
        .limit(20)
        .get();
      return snap.docs.some((d) => {
        const s = d.data();
        const a = s.startedAt?.toMillis?.() ?? 0;
        const b = s.endedAt?.toMillis?.() ?? Date.now();
        return a > 0 && (b - a) >= 30 * 60_000;
      });
    },
    unmet: 'Stream for at least 30 minutes today to claim this.',
  },
  creator_host_event: {
    vp: 150,
    // Ticketed events are stored in `tournaments` (the ticketed pivot reused
    // that collection) and the host is `adminId`, which is what eventTickets.js
    // pays the host share to. There is no `events` collection.
    verify: async (uid) => {
      const snap = await db.collection('tournaments')
        .where('adminId', '==', uid)
        .where('createdAt', '>=', new Date(startOfUtcWeek()))
        .limit(5)
        .get();
      return !snap.empty;
    },
    unmet: 'Host a ticketed event to claim this.',
  },
};

/**
 * Claim one quest. Idempotent per (uid, questId, UTC day).
 *
 * The client sends only WHICH quest. Never how much.
 */
exports.claimCreatorQuest = functions.https.onCall(
  { region: REGION },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) throw new HttpsError('unauthenticated', 'Sign in first.');

    const questId = String(request.data?.questId || '');
    const quest = QUESTS[questId];
    if (!quest) throw new HttpsError('invalid-argument', 'Unknown quest.');

    const done = await quest.verify(uid);
    if (!done) throw new HttpsError('failed-precondition', quest.unmet);

    const day = new Date().toISOString().slice(0, 10);
    const claimRef = db.collection('quest_claims').doc(`${uid}_${questId}_${day}`);

    const userSnap = await db.collection('users').doc(uid).get();
    const tier = String(userSnap.data()?.subscription?.tier || 'free').toLowerCase();
    const vp = Math.round(quest.vp * (PLAN_VP_MULTIPLIER[tier] || 1));

    const granted = await db.runTransaction(async (tx) => {
      const existing = await tx.get(claimRef);
      if (existing.exists) return 0;

      // VP lives on the WALLET. `users/{uid}.vp` was a second store the old
      // client claim wrote to, and the two disagreed; awardVP, the ad quest and
      // every server grant all use wallets.vp, so that is the one kept.
      tx.set(db.collection('wallets').doc(uid), {
        vp: FieldValue.increment(vp),
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });

      tx.set(claimRef, {
        userId: uid, questId, vp, reward: 'vp', day,
        claimedAt: FieldValue.serverTimestamp(),
      });
      return vp;
    });

    if (granted === 0) throw new HttpsError('already-exists', 'Already claimed today.');
    return { ok: true, vp: granted };
  },
);

/** The claimable set + today's claim state, so the screen never guesses. */
exports.getCreatorQuests = functions.https.onCall(
  { region: REGION },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) throw new HttpsError('unauthenticated', 'Sign in first.');

    const day = new Date().toISOString().slice(0, 10);
    const ids = Object.keys(QUESTS);
    const snaps = await db.getAll(
      ...ids.map((q) => db.collection('quest_claims').doc(`${uid}_${q}_${day}`)),
    );
    const claimed = new Set(ids.filter((_, i) => snaps[i].exists));

    // Verify in parallel so the screen can show what is actually claimable
    // rather than offering a button that will be refused.
    const met = await Promise.all(ids.map((q) => QUESTS[q].verify(uid).catch(() => false)));

    return {
      day,
      quests: ids.map((q, i) => ({
        id: q, vp: QUESTS[q].vp, claimed: claimed.has(q), met: met[i], unmet: QUESTS[q].unmet,
      })),
    };
  },
);

module.exports.QUESTS = QUESTS;
