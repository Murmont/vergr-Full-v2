// VERGR tournament extras: hype aggregator, voice DM scheduling, warmup
// lobby, squad-funded prize pools, sponsor slots, replay-on-demand,
// tip-underdog, bracket chat.

const functions = require('firebase-functions/v2');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');

const REGION = 'europe-west1';
const db = getFirestore('vgrdb');

// ─── Tip the underdog ────────────────────────────────────────────────────
// Spectator boosts the trailing player's effective prize. The added coins
// route to the actual prize pool on settlement (winner gets them too if
// the trailing player wins).
exports.tipUnderdog = functions.https.onCall({ region: REGION }, async (req) => {
  if (!req.auth) throw new functions.https.HttpsError('unauthenticated', 'Sign in required.');
  const uid = req.auth.uid;
  const { tournamentId, matchId, underdogUid, amount } = req.data || {};
  const amt = Math.floor(Number(amount) || 0);
  if (amt < 5 || amt > 10000) {
    throw new functions.https.HttpsError('invalid-argument', 'Tip must be 5-10000 coins.');
  }
  const mRef = db.collection('tournaments').doc(tournamentId).collection('matches').doc(matchId);
  await db.runTransaction(async (tx) => {
    const [m, w] = await Promise.all([tx.get(mRef), tx.get(db.collection('wallets').doc(uid))]);
    if (!m.exists) throw new functions.https.HttpsError('not-found', 'Match not found.');
    if ((w.data()?.balance || 0) < amt) throw new functions.https.HttpsError('failed-precondition', 'Insufficient balance.');
    tx.update(db.collection('wallets').doc(uid), { balance: FieldValue.increment(-amt) });
    tx.update(mRef, {
      [`underdogTips.${underdogUid}`]: FieldValue.increment(amt),
      prizeBonusCoins: FieldValue.increment(amt),
    });
  });
  return { ok: true };
});

// ─── Hype aggregator — server-side rolling 5s reaction counter ───────────
// Reactions are written to streams/{id}/reactions/{auto} with createdAt.
// Every 30s, this scheduled job folds the last 5s into streams/{id}.hype.
// Keeps reads cheap and the HypeMeter snappy.
exports.aggregateStreamHype = onSchedule(
  { region: REGION, schedule: 'every 30 seconds', timeZone: 'UTC' },
  async () => {
    const since = new Date(Date.now() - 5_000);
    const snap = await db.collection('streams').where('status', '==', 'live').limit(50).get();
    for (const sd of snap.docs) {
      try {
        const rxQ = sd.ref.collection('reactions').where('createdAt', '>=', since).limit(500);
        const rx = await rxQ.get();
        const count = rx.size;
        const peak = Math.max(count, sd.data().hype?.peak || 0);
        await sd.ref.update({ hype: { count, peak, updatedAt: FieldValue.serverTimestamp() } });
      } catch { /* skip — index missing on first run */ }
    }
  },
);

// ─── Squad-funded tournaments ────────────────────────────────────────────
// Squad members can contribute coins toward a shared prize. Contribs are
// held; refunded if the tournament is cancelled.
exports.contributeToSquadTournament = functions.https.onCall({ region: REGION }, async (req) => {
  if (!req.auth) throw new functions.https.HttpsError('unauthenticated', 'Sign in required.');
  const uid = req.auth.uid;
  const { tournamentId, amount } = req.data || {};
  const amt = Math.floor(Number(amount) || 0);
  if (amt < 50 || amt > 50000) {
    throw new functions.https.HttpsError('invalid-argument', 'Contribution must be 50-50000 coins.');
  }
  const tRef = db.collection('tournaments').doc(tournamentId);
  await db.runTransaction(async (tx) => {
    const [t, w] = await Promise.all([tx.get(tRef), tx.get(db.collection('wallets').doc(uid))]);
    if (!t.exists) throw new functions.https.HttpsError('not-found', 'Tournament not found.');
    if ((w.data()?.balance || 0) < amt) {
      throw new functions.https.HttpsError('failed-precondition', 'Insufficient balance.');
    }
    tx.update(db.collection('wallets').doc(uid), { balance: FieldValue.increment(-amt) });
    tx.update(tRef, {
      squadFundedPool: FieldValue.increment(amt),
      [`squadContributors.${uid}`]: FieldValue.increment(amt),
    });
  });
  return { ok: true };
});

// ─── Sponsor slots (post-launch admin only) ──────────────────────────────
exports.attachTournamentSponsor = functions.https.onCall({ region: REGION }, async (req) => {
  if (!req.auth) throw new functions.https.HttpsError('unauthenticated', 'Sign in required.');
  const u = (await db.collection('users').doc(req.auth.uid).get()).data();
  if (u?.role !== 'admin') throw new functions.https.HttpsError('permission-denied', 'Admin only.');
  const { tournamentId, sponsor } = req.data || {};
  await db.collection('tournaments').doc(tournamentId).update({
    sponsor: {
      name: sponsor.name || null, logoUrl: sponsor.logoUrl || null,
      url: sponsor.url || null, contributionCoins: Math.floor(sponsor.contributionCoins || 0),
      attachedAt: FieldValue.serverTimestamp(),
    },
  });
  return { ok: true };
});

// GR7 — squad sponsors a PUBLIC tournament from its treasury. Gives treasuries
// an outlet beyond holding coins: the amount is debited from the squad treasury
// and added to the tournament prize pool, and the squad is billed as a sponsor.
exports.sponsorTournamentFromTreasury = functions.https.onCall({ region: REGION }, async (req) => {
  if (!req.auth) throw new functions.https.HttpsError('unauthenticated', 'Sign in required.');
  const uid = req.auth.uid;
  const { tournamentId, squadId, amount, showBranding = true } = req.data || {};
  const amt = Math.floor(amount || 0);
  if (!tournamentId || !squadId || amt <= 0) {
    throw new functions.https.HttpsError('invalid-argument', 'tournamentId, squadId, positive amount required.');
  }
  const tRef = db.collection('tournaments').doc(tournamentId);
  const sRef = db.collection('squads').doc(squadId);
  return db.runTransaction(async (tx) => {
    const [tSnap, sSnap] = await Promise.all([tx.get(tRef), tx.get(sRef)]);
    if (!tSnap.exists) throw new functions.https.HttpsError('not-found', 'Tournament not found.');
    if (!sSnap.exists) throw new functions.https.HttpsError('not-found', 'Squad not found.');
    const t = tSnap.data();
    const s = sSnap.data();
    if (s.ownerId !== uid) throw new functions.https.HttpsError('permission-denied', 'Only the squad owner can sponsor.');
    if (t.visibility === 'private') throw new functions.https.HttpsError('failed-precondition', 'Only public tournaments can be sponsored.');
    if (!['open', 'registration', 'active', 'live'].includes(t.status)) {
      throw new functions.https.HttpsError('failed-precondition', 'Tournament is not open to sponsorship.');
    }
    if ((s.treasury || 0) < amt) throw new functions.https.HttpsError('failed-precondition', 'Insufficient squad treasury.');
    if ((t.prizePool || 0) + amt > 500000) {
      throw new functions.https.HttpsError('failed-precondition', 'Would exceed the 500,000 coin prize-pool cap.');
    }
    tx.update(sRef, { treasury: FieldValue.increment(-amt), updatedAt: FieldValue.serverTimestamp() });
    const update = {
      prizePool: FieldValue.increment(amt),
      sponsorBonusCoins: FieldValue.increment(amt),
      sponsors: FieldValue.arrayUnion({
        squadId, name: s.name || null, tag: s.tag || null, banner: s.banner || null, amount: amt, at: Date.now(),
      }),
    };
    if (showBranding) {
      update.sponsor = {
        name: s.name || 'A squad', logoUrl: s.banner || null, url: null,
        contributionCoins: amt, squadId, attachedAt: FieldValue.serverTimestamp(),
      };
    }
    tx.update(tRef, update);
    tx.set(db.collection('transactions').doc(), {
      squadId, type: 'squad_sponsor_tournament', amount: -amt,
      description: `Sponsored tournament: ${t.name || tournamentId}`,
      tournamentId, createdAt: FieldValue.serverTimestamp(),
    });
    return { ok: true, newPrizePool: (t.prizePool || 0) + amt };
  });
});

// ─── Voice DM scheduling between opponents ───────────────────────────────
// Lightweight — opens (or finds) a DM thread tagged tournamentMatchId so
// the existing DM voice flow handles the actual call. Returns thread id.
exports.openMatchSchedulingDm = functions.https.onCall({ region: REGION }, async (req) => {
  if (!req.auth) throw new functions.https.HttpsError('unauthenticated', 'Sign in required.');
  const uid = req.auth.uid;
  const { tournamentId, matchId, otherUid } = req.data || {};
  if (!otherUid || uid === otherUid) throw new functions.https.HttpsError('invalid-argument', 'otherUid required.');
  const threadId = [uid, otherUid].sort().join('_');
  const tRef = db.collection('dm_threads').doc(threadId);
  await tRef.set({
    participants: [uid, otherUid].sort(),
    tournamentTags: FieldValue.arrayUnion(`${tournamentId}/${matchId}`),
    lastActivity: FieldValue.serverTimestamp(),
  }, { merge: true });
  return { threadId };
});

// ─── Replay on demand ────────────────────────────────────────────────────
// Player or spectator requests a mod review of a specific timestamp.
exports.requestReplayReview = functions.https.onCall({ region: REGION }, async (req) => {
  if (!req.auth) throw new functions.https.HttpsError('unauthenticated', 'Sign in required.');
  const uid = req.auth.uid;
  const { tournamentId, matchId, timestampSec, reason } = req.data || {};
  await db.collection('replay_review_requests').add({
    tournamentId, matchId, requesterUid: uid,
    timestampSec: Math.floor(timestampSec || 0),
    reason: String(reason || '').slice(0, 200),
    status: 'pending', createdAt: FieldValue.serverTimestamp(),
  });
  // Notify any assigned Vanguard mod for the tournament.
  const assignSnap = await db.collection('tournament_assignments')
    .where('tournamentId', '==', tournamentId).where('status', '==', 'active').limit(5).get();
  const batch = db.batch();
  for (const a of assignSnap.docs) {
    const ad = a.data();
    if (!ad.vanguardUid) continue;
    batch.set(db.collection('notifications').doc(), {
      recipientId: ad.vanguardUid, type: 'replay_review_requested',
      title: 'Replay review requested',
      body: `Round at ${Math.floor((timestampSec || 0) / 60)}m — ${reason || 'no reason'}`,
      data: { tournamentId, matchId, timestampSec }, read: false,
      createdAt: FieldValue.serverTimestamp(),
    });
  }
  await batch.commit();
  return { ok: true };
});
