// GR5 — Brawl quickplay. A solo player picks a game + stake and is matched
// into an instant 1v1 (no 16-player bracket to commit to). On a pair, we
// synthesize a 2-player single-elim tournament + its one match, escrow both
// stakes, and route both players in. The existing match flow (verify → report
// → advanceBracketAfterMatch → finalizeInternal) handles the rest, so the
// winner-takes-all payout, TP, ranking, etc. all run identically.
//
//   brawl_queue/{id} = { uid, game, stake, status: 'waiting'|'matched',
//                        matchedTournamentId, matchedMatchId, createdAt }
//
// The waiting player subscribes to their queue doc; when matchedTournamentId
// appears they navigate to /tournaments/{tId}/match/{mId}.

const functions = require('firebase-functions/v2');
const { HttpsError } = require('firebase-functions/v2/https');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');

const REGION = 'europe-west1';
const db = getFirestore('vgrdb');

const MAX_STAKE = 10000; // mirror the entry-fee cap

function lobbyCode() {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 7; i++) s += A[Math.floor(Math.random() * A.length)];
  return `VERGR-${s}`;
}


// ── RETIRED 2026-08-16 ────────────────────────────────────────────────
// Tournaments do not exist as a product. Unrouting the screens did not stop
// these callables being invoked directly, and the money-moving ones could still
// escrow a user's coins. They now throw.
//
// Bodies are RETAINED, not deleted, exactly as requestWithdrawal was: the
// bracket, escrow and payout logic is still what the settle paths run on.
//
// Settle/refund paths stay LIVE on purpose so nothing already escrowed is
// stranded (leaveTournamentSecure, leaveBrawlQueue, finalizeTournamentSecure,
// reportMatchResultSecure, reportGameResultSecure, resolveTournamentDispute).
const TOURNAMENTS_RETIRED = () => new HttpsError(
  'failed-precondition',
  'Tournaments have been retired and are no longer available on Vergr.',
);

exports.joinBrawlQueue = functions.https.onCall({ secrets: ['VERGR_GEO_TOKEN'] }, async (request) => {
  throw TOURNAMENTS_RETIRED();
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in required.');
  const { game, stake = 0 } = request.data || {};
  const amt = Math.floor(stake || 0);
  if (!game || typeof game !== 'string') throw new HttpsError('invalid-argument', 'game required.');
  if (amt < 0 || amt > MAX_STAKE) throw new HttpsError('invalid-argument', `Stake must be 0–${MAX_STAKE}.`);

  // Paid brawls follow the same compliance gates as paid tournament entry.
  if (amt > 0) {
    const { assertRegionAllowed } = require('./geo');
    const { assertKycVerified } = require('./didit');
    await assertRegionAllowed(request);
    await assertKycVerified(uid);
  }

  // Don't double-queue.
  const mine = await db.collection('brawl_queue')
    .where('uid', '==', uid).where('status', '==', 'waiting').limit(1).get();
  if (!mine.empty) {
    return { matched: false, queueId: mine.docs[0].id, alreadyQueued: true };
  }

  // Look for a waiting opponent on the same game + stake.
  const candidates = await db.collection('brawl_queue')
    .where('status', '==', 'waiting')
    .where('game', '==', game)
    .where('stake', '==', amt)
    .limit(8).get();
  const opponentDoc = candidates.docs.find((d) => d.data().uid && d.data().uid !== uid);

  if (!opponentDoc) {
    // No one waiting → enqueue.
    const ref = await db.collection('brawl_queue').add({
      uid, game, stake: amt, status: 'waiting', createdAt: FieldValue.serverTimestamp(),
    });
    return { matched: false, queueId: ref.id };
  }

  // Pair inside a transaction: re-validate the opponent is still waiting and
  // both wallets can cover the stake, escrow, then synthesize the tournament.
  const oppUid = opponentDoc.data().uid;
  const result = await db.runTransaction(async (tx) => {
    const qRef = db.collection('brawl_queue').doc(opponentDoc.id);
    const qSnap = await tx.get(qRef);
    if (!qSnap.exists || qSnap.data().status !== 'waiting') {
      return { stale: true };
    }
    let aBal = 0; let bBal = 0;
    if (amt > 0) {
      const [aw, bw] = await Promise.all([
        tx.get(db.collection('wallets').doc(oppUid)),
        tx.get(db.collection('wallets').doc(uid)),
      ]);
      aBal = aw.exists ? (aw.data().balance || 0) : 0;
      bBal = bw.exists ? (bw.data().balance || 0) : 0;
      if (aBal < amt || bBal < amt) {
        return { insufficient: true };
      }
    }

    const tRef = db.collection('tournaments').doc();
    const mRef = tRef.collection('matches').doc('r1m1');
    const prizePool = amt * 2;

    // Tournament doc — mirrors a started 2-player single-elim.
    tx.set(tRef, {
      name: `Brawl · ${game}`,
      game,
      mode: 'solo',
      type: 'single_elim',
      brawl: true,
      visibility: 'public',
      status: 'active',
      participants: [oppUid, uid],
      maxParticipants: 2,
      entryFee: amt,
      prizePool,
      bracket: { totalRounds: 1, currentRound: 1 },
      bracketData: { format: 'single_elim', size: 2, totalRounds: 1 },
      payoutStatus: 'pending',
      createdAt: FieldValue.serverTimestamp(),
      startedAt: FieldValue.serverTimestamp(),
    });

    // The single match.
    tx.set(mRef, {
      round: 1, matchNumber: 1,
      player1: oppUid, player2: uid,
      winner: null, loser: null,
      status: 'pending', bye: false,
      lobbyCode: lobbyCode(),
      verifyMethod: 'chat', detection: 'manual',
      verifyState: {
        [oppUid]: { status: 'pending', source: null, at: null, modUid: null },
        [uid]: { status: 'pending', source: null, at: null, modUid: null },
      },
      seriesFormat: 'bo1', seriesScore: { a: 0, b: 0 }, games: [], seriesWinner: null,
      createdAt: FieldValue.serverTimestamp(),
    });

    // Escrow both stakes.
    if (amt > 0) {
      for (const u of [oppUid, uid]) {
        tx.update(db.collection('wallets').doc(u), {
          balance: FieldValue.increment(-amt),
          updatedAt: FieldValue.serverTimestamp(),
        });
        tx.set(db.collection('transactions').doc(), {
          userId: u, type: 'brawl_entry', amount: -amt,
          description: `Brawl entry: ${game}`, tournamentId: tRef.id,
          createdAt: FieldValue.serverTimestamp(),
        });
      }
    }

    // Flip the opponent's queue doc so their client navigates in.
    tx.update(qRef, {
      status: 'matched', matchedTournamentId: tRef.id, matchedMatchId: mRef.id,
      matchedAt: FieldValue.serverTimestamp(),
    });

    return { tournamentId: tRef.id, matchId: mRef.id };
  });

  if (result.stale || result.insufficient) {
    // Opponent vanished or can't pay — fall back to enqueueing the caller.
    const ref = await db.collection('brawl_queue').add({
      uid, game, stake: amt, status: 'waiting', createdAt: FieldValue.serverTimestamp(),
    });
    return { matched: false, queueId: ref.id, retry: true };
  }

  // Notify the matched opponent (their client also gets the queue-doc snapshot).
  await db.collection('notifications').add({
    recipientId: oppUid, type: 'tournament_match_ready',
    title: 'Brawl matched — your opponent is ready',
    body: `${game}: tap to verify and play.`,
    data: { tournamentId: result.tournamentId, matchId: result.matchId },
    actionUrl: `/tournaments/${result.tournamentId}/match/${result.matchId}`,
    read: false, createdAt: FieldValue.serverTimestamp(),
  });

  return { matched: true, tournamentId: result.tournamentId, matchId: result.matchId };
});

exports.leaveBrawlQueue = functions.https.onCall(async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in required.');
  const { queueId } = request.data || {};
  if (!queueId) throw new HttpsError('invalid-argument', 'queueId required.');
  const ref = db.collection('brawl_queue').doc(queueId);
  const snap = await ref.get();
  if (snap.exists && snap.data().uid === uid && snap.data().status === 'waiting') {
    await ref.delete();
  }
  return { ok: true };
});
