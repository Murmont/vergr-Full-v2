// VERGR tournament extras: betting, hype aggregator, voice DM scheduling,
// warmup lobby, double-or-nothing rematches, squad-funded prize pools,
// sponsor slots, replay-on-demand, tip-underdog, bracket chat.

const functions = require('firebase-functions/v2');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');

const REGION = 'europe-west1';
const db = getFirestore('vgrdb');

// ─── Match Picks (skill-based prediction layer) ──────────────────────────
//
// This is a PREDICTION game, not a betting product. Branding rules:
//   - UI: "pick" / "back" / "reward" — never "bet"/"wager"/"winnings"
//   - Daily cap of 3 picks per spectator per day (skill, not grind)
//   - Streak + accuracy tracked → "Top Predictor" leaderboard
//   - Mechanically: pari-mutuel pool share, withdrawable rewards
//
// Spectators can't pick on their own matches. Picks lock at match start.
// Picks are stored in tournaments/{tId}/matches/{mId}/picks/{uid}.
exports.placeMatchBet = functions.https.onCall({ region: REGION }, async (req) => {
  if (!req.auth) throw new functions.https.HttpsError('unauthenticated', 'Sign in required.');
  const uid = req.auth.uid;
  const { tournamentId, matchId, sideUid, amount } = req.data || {};
  if (!tournamentId || !matchId || !sideUid || !amount) {
    throw new functions.https.HttpsError('invalid-argument', 'all fields required');
  }
  const amt = Math.floor(Number(amount));
  if (amt < 10 || amt > 5000) {
    throw new functions.https.HttpsError('invalid-argument', 'Pick must be 10-5000 coins.');
  }
  // Daily pick cap (skill-game framing). UTC day key.
  const dayKey = new Date().toISOString().slice(0, 10);
  const dayRef = db.collection('users').doc(uid).collection('pick_days').doc(dayKey);

  const mRef = db.collection('tournaments').doc(tournamentId).collection('matches').doc(matchId);
  const pRef = mRef.collection('picks').doc(uid);
  await db.runTransaction(async (tx) => {
    const [m, p, w, day] = await Promise.all([
      tx.get(mRef), tx.get(pRef),
      tx.get(db.collection('wallets').doc(uid)),
      tx.get(dayRef),
    ]);
    if (!m.exists) throw new functions.https.HttpsError('not-found', 'Match not found.');
    if (p.exists) throw new functions.https.HttpsError('already-exists', 'Already picked this match.');
    const md = m.data();
    if (md.status === 'completed') throw new functions.https.HttpsError('failed-precondition', 'Match ended.');
    if (md.bothVerifiedAt) throw new functions.https.HttpsError('failed-precondition', 'Picks locked — match started.');
    if (sideUid !== md.player1 && sideUid !== md.player2) {
      throw new functions.https.HttpsError('invalid-argument', 'sideUid not a participant.');
    }
    if (uid === md.player1 || uid === md.player2) {
      throw new functions.https.HttpsError('permission-denied', 'Players cannot pick on their own match.');
    }
    const picksToday = day.exists ? (day.data().count || 0) : 0;
    if (picksToday >= 3) {
      throw new functions.https.HttpsError('resource-exhausted',
        'Daily pick limit reached (3/day). Predictions are a skill game — come back tomorrow.');
    }
    if ((w.data()?.balance || 0) < amt) {
      throw new functions.https.HttpsError('failed-precondition', 'Insufficient balance.');
    }
    tx.update(db.collection('wallets').doc(uid), { balance: FieldValue.increment(-amt) });
    tx.set(pRef, {
      uid, sideUid, amount: amt,
      placedAt: FieldValue.serverTimestamp(),
      // Mirror for legacy bet readers (compat).
      stake: amt,
    });
    tx.update(mRef, {
      [`bettingPools.${sideUid}`]: FieldValue.increment(amt),
      bettingTotalCoins: FieldValue.increment(amt),
      picksCount: FieldValue.increment(1),
    });
    tx.set(dayRef, { count: FieldValue.increment(1), lastAt: FieldValue.serverTimestamp() }, { merge: true });
  });
  return { ok: true, amount: amt };
});

// settleMatchBets — pure pari-mutuel, no clamps, no rake.
//
// Each winning bet's payout = (theirStake / sumOfWinningStakes) × totalPool
//
// totalPool = sum of every bet (both sides). Losing stakes forfeit and
// fund the winners. Winners are paid into wallet.balance (withdrawable).
// Founder mandate: ToS shifts gambling-regulation liability to the user;
// region-gating + KYC tiers handle jurisdiction-by-jurisdiction blocks.
//
// Idempotent on match.bettingSettled. Safe to call from any completion path.
exports.settleMatchBets = async function (tournamentId, matchId, winnerUid) {
  const mRef = db.collection('tournaments').doc(tournamentId).collection('matches').doc(matchId);
  const m = (await mRef.get()).data();
  if (!m || m.bettingSettled || !m.bettingPools) return;

  const pools = m.bettingPools || {};
  const winningStakes = pools[winnerUid] || 0;
  const totalPool = Object.values(pools).reduce((s, v) => s + (v || 0), 0);
  // No winners on the winning side → nothing to distribute. Losing bets stay
  // forfeit (sit on the match for audit). Refund path is used only when the
  // match is cancelled/disputed (see refundMatchBets).
  if (winningStakes === 0 || totalPool === 0) {
    await mRef.update({ bettingSettled: true, bettingSettledReason: 'no_winning_stakes' });
    return;
  }

  const picksSnap = await mRef.collection('picks').get();
  const batch = db.batch();
  for (const b of picksSnap.docs) {
    const bd = b.data();
    const correct = bd.sideUid === winnerUid;
    if (!correct) {
      batch.update(b.ref, { settledAt: FieldValue.serverTimestamp(), payout: 0, outcome: 'missed' });
      // Streak reset + total picks counter (skill stat tracking).
      batch.update(db.collection('users').doc(bd.uid), {
        'predictor.currentStreak': 0,
        'predictor.totalPicks': FieldValue.increment(1),
        'predictor.lastPickAt': FieldValue.serverTimestamp(),
      });
      continue;
    }
    // Correct prediction — pari-mutuel share of total pool, withdrawable.
    const payout = Math.floor((bd.amount / winningStakes) * totalPool);
    batch.update(db.collection('wallets').doc(bd.uid), {
      balance: FieldValue.increment(payout),
    });
    batch.update(b.ref, { settledAt: FieldValue.serverTimestamp(), payout, outcome: 'correct' });
    // Predictor stats: streak + accuracy counters.
    batch.update(db.collection('users').doc(bd.uid), {
      'predictor.currentStreak': FieldValue.increment(1),
      'predictor.totalPicks': FieldValue.increment(1),
      'predictor.totalCorrect': FieldValue.increment(1),
      'predictor.totalRewardCoins': FieldValue.increment(payout),
      'predictor.lastPickAt': FieldValue.serverTimestamp(),
    });
    batch.set(db.collection('notifications').doc(), {
      recipientId: bd.uid, type: 'pick_correct',
      title: `🎯 Pick correct · +${payout} coins`,
      body: `Your ${bd.amount}c pick paid out ${payout}c.`,
      data: { tournamentId, matchId, payout, stake: bd.amount },
      read: false, createdAt: FieldValue.serverTimestamp(),
    });
  }
  batch.update(mRef, {
    bettingSettled: true,
    bettingTotalPool: totalPool,
    bettingWinningStakes: winningStakes,
    bettingEffectiveMultiplier: +(totalPool / winningStakes).toFixed(2),
  });
  await batch.commit();
};

// refundMatchBets — full refund path for cancelled / disputed-unresolvable
// matches. Returns every stake to the original wallet's main balance.
exports.refundMatchBets = async function (tournamentId, matchId, reason) {
  const mRef = db.collection('tournaments').doc(tournamentId).collection('matches').doc(matchId);
  const m = (await mRef.get()).data();
  if (!m || m.bettingSettled) return;
  const picksSnap = await mRef.collection('picks').get();
  if (picksSnap.empty) {
    await mRef.update({ bettingSettled: true, bettingSettledReason: reason || 'no_picks' });
    return;
  }
  const batch = db.batch();
  for (const b of picksSnap.docs) {
    const bd = b.data();
    batch.update(db.collection('wallets').doc(bd.uid), {
      balance: FieldValue.increment(bd.amount),
    });
    batch.update(b.ref, { settledAt: FieldValue.serverTimestamp(), payout: bd.amount, outcome: 'refunded' });
    batch.set(db.collection('notifications').doc(), {
      recipientId: bd.uid, type: 'pick_refunded',
      title: `Pick refunded · ${bd.amount}c`,
      body: `Match ${reason || 'cancelled'} — your coins returned.`,
      data: { tournamentId, matchId }, read: false,
      createdAt: FieldValue.serverTimestamp(),
    });
  }
  batch.update(mRef, { bettingSettled: true, bettingSettledReason: reason || 'cancelled' });
  await batch.commit();
};

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

// ─── Double-or-nothing rematch ───────────────────────────────────────────
// Loser pays 2× entry to challenge; winner can accept or decline within 60s.
exports.requestDoubleOrNothing = functions.https.onCall({ region: REGION }, async (req) => {
  if (!req.auth) throw new functions.https.HttpsError('unauthenticated', 'Sign in required.');
  const uid = req.auth.uid;
  const { tournamentId, matchId } = req.data || {};
  const mRef = db.collection('tournaments').doc(tournamentId).collection('matches').doc(matchId);
  const m = (await mRef.get()).data();
  if (!m || m.status !== 'completed' || !m.winner) {
    throw new functions.https.HttpsError('failed-precondition', 'Match not completed.');
  }
  const loserUid = m.winner === m.player1 ? m.player2 : m.player1;
  if (uid !== loserUid) throw new functions.https.HttpsError('permission-denied', 'Only loser may challenge.');
  const t = (await db.collection('tournaments').doc(tournamentId).get()).data();
  const cost = (t.entryFee || 0) * 2;
  const w = (await db.collection('wallets').doc(uid).get()).data();
  if ((w?.balance || 0) < cost) throw new functions.https.HttpsError('failed-precondition', 'Insufficient balance.');
  await mRef.update({
    doubleOrNothing: {
      challengerUid: uid, cost, requestedAt: FieldValue.serverTimestamp(), status: 'pending',
    },
  });
  await db.collection('notifications').add({
    recipientId: m.winner, type: 'double_or_nothing',
    title: 'Double or nothing?', body: `${cost} coins. 60s to accept.`,
    data: { tournamentId, matchId }, actionUrl: `/tournaments/${tournamentId}/match/${matchId}`,
    read: false, createdAt: FieldValue.serverTimestamp(),
  });
  return { ok: true, cost };
});

exports.respondDoubleOrNothing = functions.https.onCall({ region: REGION }, async (req) => {
  if (!req.auth) throw new functions.https.HttpsError('unauthenticated', 'Sign in required.');
  const uid = req.auth.uid;
  const { tournamentId, matchId, accept } = req.data || {};
  const mRef = db.collection('tournaments').doc(tournamentId).collection('matches').doc(matchId);
  await db.runTransaction(async (tx) => {
    const m = (await tx.get(mRef)).data();
    if (!m?.doubleOrNothing || m.doubleOrNothing.status !== 'pending') {
      throw new functions.https.HttpsError('failed-precondition', 'No pending challenge.');
    }
    if (m.winner !== uid) throw new functions.https.HttpsError('permission-denied', 'Not your decision.');
    const cost = m.doubleOrNothing.cost;
    const challenger = m.doubleOrNothing.challengerUid;
    if (!accept) {
      tx.update(mRef, { 'doubleOrNothing.status': 'declined' });
      return;
    }
    // Both stake cost coins; winner of rematch gets 2×cost. New match doc.
    const [wA, wB] = await Promise.all([
      tx.get(db.collection('wallets').doc(uid)),
      tx.get(db.collection('wallets').doc(challenger)),
    ]);
    if ((wA.data()?.balance || 0) < cost || (wB.data()?.balance || 0) < cost) {
      throw new functions.https.HttpsError('failed-precondition', 'Insufficient balance on one side.');
    }
    tx.update(db.collection('wallets').doc(uid), { balance: FieldValue.increment(-cost) });
    tx.update(db.collection('wallets').doc(challenger), { balance: FieldValue.increment(-cost) });
    tx.update(mRef, { 'doubleOrNothing.status': 'accepted', 'doubleOrNothing.acceptedAt': FieldValue.serverTimestamp() });
    const rematchRef = db.collection('tournaments').doc(tournamentId).collection('matches').doc();
    tx.set(rematchRef, {
      round: m.round, matchNumber: m.matchNumber, parentMatchId: matchId,
      player1: m.player1, player2: m.player2,
      lobbyCode: 'VERGR-' + Math.random().toString(36).slice(2, 9).toUpperCase(),
      verifyMethod: m.verifyMethod, detection: m.detection,
      isDoubleOrNothing: true, prizeOverride: cost * 2,
      verifyState: { [m.player1]: { status: 'pending' }, [m.player2]: { status: 'pending' } },
      status: 'pending', createdAt: FieldValue.serverTimestamp(),
    });
  });
  return { ok: true };
});

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
