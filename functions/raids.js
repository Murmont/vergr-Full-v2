// VERGR raids — a host sends their live audience to another creator.
//
// Founder decisions, 2026-09-02 (docs/LIVE_STREAM_READINESS.md, section B):
//   • the raider EARNS VP — "it would encourage streamers to be less competitive
//     and be good natured and they will receive a reward for it"
//   • NO minimum viewer count — a small creator raiding 3 people is the case the
//     feature exists for
//   • a raid may NOT land on an audio-only or a gated stream — "it would be
//     pointless"
//
// ⚠⚠ THE FAN-OUT IS THE STREAM DOC, NOT THE RELAY. Every viewer already holds an
// onSnapshot on `streams/{id}` (MobileLiveViewer.jsx:358), so writing the raid
// onto the SOURCE stream reaches every viewer with ZERO new infrastructure, zero
// new sockets and zero per-viewer cost. A relay broadcast would have been a new
// message type, a new client handler and a second delivery path to keep correct.
//
// ⚠ THE TARGET DECIDES WHO MAY RAID THEM. This is the control that kills hate
// raids and it is enforced HERE, on the server, not offered as a client filter.
// Twitch shipped its raid countermeasures AFTER the damage; they are cheap now
// and expensive to retrofit once the behaviour is established.

const functions = require('firebase-functions/v2');
const { HttpsError } = require('firebase-functions/v2/https');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');

const REGION = 'europe-west1';

// ⚠⚠ THE NAMED DATABASE, NOT THE DEFAULT. Vergr’s data lives in ‘vgrdb’; the first
// version of this file used admin.firestore(), which reads the DEFAULT database —
// so every get() came back not-exists and the callable answered “Stream not found”
// for a stream that plainly existed. It fails SILENTLY and plausibly: not-found is
// a believable answer, so nothing looks broken until you check a doc you know is
// there. CLAUDE.md warns about this exact thing and I did it anyway.
const db = () => getFirestore('vgrdb');

const { creditEngagementVp } = require('./engagementVp');

// ⚠ THE REWARD LIVES IN ENGAGEMENT_VP (functions/engagementVp.js), which is the
// ONE table that prices every action — these are a mirror for reference only and
// nothing reads them. 150 per raid, 300/day, raised from 40/80 on 2026-09-02 after
// the founder asked whether 40 was too low. It was: a level costs 2,000-12,000 VP,
// so 40 was 2% of one early level and LESS than an hour of streaming, for the one
// act that costs you your entire audience. Full reasoning sits with the table.
const RAID_VP = 150;
const RAID_VP_DAILY_CAP = 300;

/** Who may raid this creator. Stored at `users/{uid}.raidPolicy`. */
const RAID_POLICIES = ['anyone', 'following', 'off'];
const DEFAULT_RAID_POLICY = 'following';

/**
 * A stream a raid may not land on.
 *
 * ⚠ SAME TEST `vodArchive.isRestricted` USES, deliberately re-derived here rather
 * than imported, because vodArchive is a different deployment unit and importing
 * it would drag its triggers into this function's bundle. If that test changes,
 * change both — they answer the same question about the same doc.
 *
 * ⚠ AUDIO-ONLY IS EXCLUDED BY FOUNDER DECISION, not by a technical limit. A raid
 * is an audience transfer and the arrival has to be worth arriving at.
 */
function badRaidTarget(s = {}) {
  if (!s) return 'missing';
  if (s.status !== 'live') return 'not_live';
  if (s.audioOnly === true) return 'audio_only';
  if (s.unlisted || s.audience === 'ticketed' || s.access?.mode === 'paid') return 'gated';
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// setRaidPolicy — the TARGET's control over who may raid them.
// ─────────────────────────────────────────────────────────────────────────────
exports.setRaidPolicy = functions.https.onCall({ region: REGION }, async (req) => {
  if (!req.auth) throw new HttpsError('unauthenticated', 'Sign in required.');
  const policy = String(req.data?.policy || '');
  if (!RAID_POLICIES.includes(policy)) {
    throw new HttpsError('invalid-argument', 'Unknown raid policy.');
  }
  await db().collection('users').doc(req.auth.uid).set({ raidPolicy: policy }, { merge: true });
  return { ok: true, policy };
});

// ─────────────────────────────────────────────────────────────────────────────
// raidStream — send this stream's audience to another live stream.
// ─────────────────────────────────────────────────────────────────────────────
exports.raidStream = functions.https.onCall({ region: REGION }, async (req) => {
  if (!req.auth) throw new HttpsError('unauthenticated', 'Sign in required.');
  const uid = req.auth.uid;
  const fromStreamId = String(req.data?.fromStreamId || '');
  const toStreamId = String(req.data?.toStreamId || '');
  if (!fromStreamId || !toStreamId) {
    throw new HttpsError('invalid-argument', 'fromStreamId and toStreamId required.');
  }
  if (fromStreamId === toStreamId) {
    throw new HttpsError('invalid-argument', 'A stream cannot raid itself.');
  }

  const fromRef = db().collection('streams').doc(fromStreamId);
  const toRef = db().collection('streams').doc(toStreamId);
  const [fromSnap, toSnap] = await Promise.all([fromRef.get(), toRef.get()]);

  if (!fromSnap.exists) throw new HttpsError('not-found', 'Stream not found.');
  const from = fromSnap.data();
  if (from.hostUid !== uid) throw new HttpsError('permission-denied', 'Only the host can raid.');

  // ⚠ ONE RAID PER STREAM. Without this a host can re-fire it and move the same
  // audience repeatedly, which is both a farming route and a way to harass a
  // target with wave after wave.
  if (from.raid?.toStreamId) throw new HttpsError('failed-precondition', 'This stream has already raided.');

  if (!toSnap.exists) throw new HttpsError('not-found', 'That stream is not available.');
  const to = toSnap.data();
  const bad = badRaidTarget(to);
  if (bad === 'audio_only') throw new HttpsError('failed-precondition', 'You cannot raid an audio-only stream.');
  if (bad === 'gated') throw new HttpsError('failed-precondition', 'You cannot raid a subscriber-only or ticketed stream.');
  if (bad) throw new HttpsError('failed-precondition', 'That stream is not live.');

  const targetUid = to.hostUid;
  if (!targetUid) throw new HttpsError('failed-precondition', 'That stream has no host.');
  if (targetUid === uid) throw new HttpsError('invalid-argument', 'You cannot raid yourself.');

  // ── the target's own controls ──
  const targetSnap = await db().collection('users').doc(targetUid).get();
  const target = targetSnap.exists ? targetSnap.data() : {};
  const policy = RAID_POLICIES.includes(target.raidPolicy) ? target.raidPolicy : DEFAULT_RAID_POLICY;

  if (policy === 'off') throw new HttpsError('permission-denied', 'That creator is not accepting raids.');

  // ⚠ A BLOCK BEATS EVERY POLICY, including 'anyone'. Someone who blocked you
  // must never be able to receive your audience, and this check is free — the
  // doc read is a single get on a path that already exists.
  const blocked = await db().collection('users').doc(targetUid)
    .collection('blocked').doc(uid).get();
  if (blocked.exists) throw new HttpsError('permission-denied', 'That creator is not accepting raids.');

  if (policy === 'following') {
    // "Only people I follow" — the TARGET must follow the RAIDER. That direction
    // is the point: it means the target chose this person, not the reverse.
    const follows = await db().collection('users').doc(uid)
      .collection('followers').doc(targetUid).get();
    if (!follows.exists) {
      throw new HttpsError('permission-denied', 'That creator only accepts raids from people they follow.');
    }
  }

  const viewers = Math.max(0, Number(from.viewerCount) || 0);
  const now = Date.now();

  // ⚠ THE RAID LIVES ON THE SOURCE STREAM because that is the doc the departing
  // viewers are already watching. Writing it on the TARGET would reach the wrong
  // audience — the people already there, who are not going anywhere.
  await fromRef.set({
    raid: {
      toStreamId,
      toHostUid: targetUid,
      toHostName: to.hostName || '',
      byUid: uid,
      viewers,
      startedAt: now,
    },
  }, { merge: true });

  // ⚠ EVERY RAID IS LOGGED. A hate raid that cannot be traced to a person cannot
  // be acted on, and the record is also what makes a raid-for-raid ring visible.
  await db().collection('raids').add({
    fromStreamId, toStreamId, byUid: uid, targetUid,
    viewers, policy,
    createdAt: FieldValue.serverTimestamp(),
  });

  // ⚠ VP IS AWARDED FOR THE RAID ITSELF, NOT PER VIEWER MOVED. Paying per viewer
  // would reward the biggest channels for a thing the feature exists to give
  // SMALL ones, and it would make an inflated viewer count worth money.
  let vp = 0;
  try {
    vp = await creditEngagementVp(db(), uid, 'raid_sent', 1);
  } catch (e) {
    // ⚠ A FAILED VP CREDIT MUST NOT UNDO THE RAID. The audience has already been
    // told they are moving; failing the call here would strand them.
    console.error('raidStream: vp credit failed', e);
  }

  return { ok: true, toStreamId, viewers, vp };
});

exports._internal = { badRaidTarget, RAID_POLICIES, DEFAULT_RAID_POLICY, RAID_VP, RAID_VP_DAILY_CAP };
