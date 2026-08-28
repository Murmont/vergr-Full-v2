// announceStreamJoin — server-owned live-stream entry announcements.
//
// ## Why this exists
//
// Join docs used to be written by the joining viewer's OWN client, and
// firestore.rules validated only that `uid` matched the caller. Every other
// field was whatever the client said, so any signed-in account could:
//   1. write `kind:'subscriber', tier:'pro'` into ANY stream and get the gold
//      subscriber entrance without ever subscribing,
//   2. spam unlimited join docs into a stream they do not own (announcement
//      spam AND a Firestore write-cost attack on someone else's stream),
//   3. supply an arbitrary displayName and avatar.
//
// Once the entrance is keyed to VP rank, that becomes "anyone can be Immortal in
// anyone's room". So the client now sends only WHICH stream, and everything that
// decides how grand the entrance is (follower state, subscription tier, VP rank)
// is resolved here. `joins` create is denied to clients in firestore.rules.
//
// Full design: docs/ENTRY_ANNOUNCEMENTS_SPEC.md. Palette: docs/ENTRY_BANNER_ART_SPEC.md.

const functions = require('firebase-functions/v2');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');

const db = getFirestore('vgrdb');
const REGION = 'europe-west1';
const HttpsError = functions.https.HttpsError;

// ── Rank bands. MIRROR of RANK_TIERS in src/utils/vpSystem.js and of
// RANK_BANNERS in src/utils/rankBanners.js. Change all three together. ──
const RANK_BANDS = [
  ['rookie', 1, 10], ['contender', 11, 20], ['rival', 21, 30], ['challenger', 31, 40],
  ['elite', 41, 50], ['champion', 51, 60], ['veteran', 61, 70], ['legend', 71, 80],
  ['mythic', 81, 90], ['ascendant', 91, 99], ['immortal', 100, 100],
];

/** Per-level VP cost, mirroring levelCost() in src/utils/vpSystem.js. */
const levelCost = (level) => (level <= 1 ? 0 : 2000 + 1000 * Math.floor((level - 1) / 10));

/** Total VP -> level 1..100. Mirrors getVPLevel(). */
function levelForVp(totalVp) {
  const vp = Math.max(0, Number(totalVp) || 0);
  let cumulative = 0;
  for (let level = 2; level <= 100; level++) {
    cumulative += levelCost(level);
    if (vp < cumulative) return level - 1;
  }
  return 100;
}

const rankIdForLevel = (level) => {
  const band = RANK_BANDS.find(([, min, max]) => level >= min && level <= max);
  return band ? band[0] : 'rookie';
};

/** A stranger (non-follower, non-subscriber) needs this level to earn a card. */
const STRANGER_CARD_LEVEL = 31;
/** Priority classes survive the rate limiter (subscribers and Legend+). */
const PRIORITY_LEVEL = 71;
/** One announcement per user per stream per this long. Kills re-entry farming. */
const DEDUPE_MS = 6 * 60 * 60 * 1000;
/** Global per-stream limiter. */
const MIN_GAP_MS = 2000;
const BURST_PER_MIN = 20;
/** Join docs are ephemeral; stamped so a Firestore TTL policy can sweep them. */
const JOIN_TTL_MS = 60 * 60 * 1000;

const normalisePlan = (u) => {
  const t = String(u?.subscription?.tier || u?.tier || u?.plan || 'free').toLowerCase();
  return t === 'lite' || t === 'pro' ? t : 'free';
};

exports.announceStreamJoin = functions.https.onCall(
  { region: REGION },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) throw new HttpsError('unauthenticated', 'Sign in first.');
    const streamId = String(request.data?.streamId || '');
    if (!streamId) throw new HttpsError('invalid-argument', 'streamId required.');

    const streamRef = db.collection('streams').doc(streamId);
    const streamSnap = await streamRef.get();
    if (!streamSnap.exists) return { announced: false, reason: 'no_stream' };
    const stream = streamSnap.data();
    const hostUid = stream.hostUid;
    // The host does not announce themselves into their own room.
    if (!hostUid || hostUid === uid) return { announced: false, reason: 'host' };
    if (stream.status !== 'live') return { announced: false, reason: 'not_live' };

    const cfg = stream.joinAnnounce || {};
    if (cfg.enabled === false) return { announced: false, reason: 'disabled' };

    // All the state that decides the entrance, read in one round trip.
    const [userSnap, walletSnap, followSnap, blockSnap, lockSnap] = await db.getAll(
      db.collection('users').doc(uid),
      db.collection('wallets').doc(uid),
      db.collection('follows').doc(`${uid}_${hostUid}`),
      db.collection('users').doc(hostUid).collection('blocked').doc(uid),
      streamRef.collection('joinLocks').doc(uid),
    );

    // Blocked by the host: never announce. Enforced here, not on the client.
    if (blockSnap.exists) return { announced: false, reason: 'blocked' };

    const user = userSnap.exists ? userSnap.data() : {};
    if (user.banned === true || user.deleted === true) return { announced: false, reason: 'banned' };

    const level = levelForVp(walletSnap.exists ? walletSnap.data().vp : 0);
    const rankId = rankIdForLevel(level);
    const plan = normalisePlan(user);
    const isFollower = followSnap.exists;
    const isSubscriber = plan !== 'free';

    // Who earns a card at all. A stranger has to have ranked up for it.
    const minRank = Number(cfg.minRank) || 0;
    const strangerFloor = Math.max(STRANGER_CARD_LEVEL, minRank);
    let earns = false;
    // Subscribers bypass the host's minimum rank unless the host turned that off.
    if (isSubscriber) earns = cfg.subscribersAlways === false ? level >= minRank : true;
    else if (isFollower) earns = level >= minRank;
    else earns = level >= strangerFloor;
    if (!earns) return { announced: false, reason: 'below_threshold', level, rankId };

    // Per-user dedupe. Re-entering the same stream does not re-announce.
    const lockTs = lockSnap.exists ? (lockSnap.data().ts?.toMillis?.() || 0) : 0;
    if (Date.now() - lockTs < DEDUPE_MS) return { announced: false, reason: 'deduped' };

    // Per-stream rate limit. Priority classes (subscribers, Legend+) survive a
    // saturated limiter; everything is still bounded by the burst ceiling.
    const priority = isSubscriber || level >= PRIORITY_LEVEL;
    const rateRef = streamRef.collection('meta').doc('joinRate');
    let allowed = true;
    try {
      allowed = await db.runTransaction(async (tx) => {
        const snap = await tx.get(rateRef);
        const now = Date.now();
        const d = snap.exists ? snap.data() : {};
        const windowStart = d.windowStart || 0;
        const inWindow = now - windowStart < 60_000;
        const count = inWindow ? (d.count || 0) : 0;
        const lastAt = d.lastAt || 0;
        if (count >= BURST_PER_MIN) return false;
        if (now - lastAt < MIN_GAP_MS && !priority) return false;
        tx.set(rateRef, {
          windowStart: inWindow ? windowStart : now,
          count: count + 1,
          lastAt: now,
        }, { merge: true });
        return true;
      });
    } catch {
      // Contention means a burst is in progress, which is exactly when a
      // non-priority announcement should be dropped rather than queued.
      allowed = priority;
    }
    if (!allowed) return { announced: false, reason: 'rate_limited' };

    const kind = isSubscriber ? 'subscriber' : (isFollower ? 'follower' : 'stranger');
    const now = Date.now();
    const batch = db.batch();
    batch.set(streamRef.collection('joinLocks').doc(uid), {
      ts: FieldValue.serverTimestamp(),
      expiresAt: new Date(now + DEDUPE_MS),
    });
    batch.set(streamRef.collection('joins').doc(), {
      uid,
      displayName: user.displayName || user.username || null,
      avatar: user.avatar || user.photoURL || null,
      kind,
      tier: isSubscriber ? plan : null,
      level,
      rankId,
      ts: FieldValue.serverTimestamp(),
      clientTs: now,
      expiresAt: new Date(now + JOIN_TTL_MS),
    });
    await batch.commit();

    return { announced: true, kind, level, rankId };
  },
);

module.exports._internal = { levelForVp, rankIdForLevel, STRANGER_CARD_LEVEL };
