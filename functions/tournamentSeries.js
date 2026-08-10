// functions/tournamentSeries.js
//
// Phase 1 — series + seeding + byes.
//
// Adds Bo1/Bo3/Bo5 support without breaking the existing single-game match
// flow:
//   - Every match doc gets `seriesFormat`, `seriesScore`, `games[]`,
//     `seriesWinner` written at `startTournamentSecure`.
//   - Default `seriesFormat='bo1'` keeps the legacy `reportMatchResultSecure`
//     callable working untouched: a single-game report flips the match to
//     completed and bracket advances exactly as before.
//   - Bo3/Bo5 routes through `reportGameResultSecure`. A game report writes
//     into the games[] subarray + increments seriesScore. When either side
//     hits ceil(N/2) game-wins, the helper triggers the same
//     `_internal_recordMatchResult` call recordMatchResultInternal would —
//     so bracket advancement, payouts, settle-bets, ranking, TP, double-elim
//     feeders, swiss pairing all run identically.
//
// validateSeriesFormat:
//   - BR games (fortnite/pubg/warzone/apex) reject Bo3/Bo5 (the lobby
//     score system is FFA placement, not 1v1 game-wins).
//   - Tournament types `battle_royale` + `swiss` + `round_robin` reject
//     anything other than Bo1 for now (Swiss/RR multi-game series will
//     come with Phase 2 multi-stage).
//
// Seeding:
//   - tournaments.startTournamentSecure honours `t.seedingMode`:
//       'random' (default) — random shuffle, then standard bracket seeding
//       'manual'           — host-provided participants array IS the seed
//       'rating'           — sort by users.tournamentPoints desc
//     Output always feeds the existing buildSingleElimRound1 /
//     buildDoubleElimBracket / buildRoundRobinSchedule unchanged — they
//     already use standard 1v16/8v9 spacing.
//
// Byes:
//   - Already handled by buildSingleElimRound1 (pads to next pow2 with
//     nulls → `autoWin`). No new code needed beyond making sure
//     advanceBracketAfterMatch + propagation honour series-aware match docs
//     (it does — winner field is unchanged).

const functions = require('firebase-functions/v2');
const admin = require('firebase-admin');
const { FieldValue } = require('firebase-admin/firestore');

const REGION = 'europe-west1';
const DB = 'vgrdb';
const HttpsError = functions.https.HttpsError;

// ─── Series-format constants ───────────────────────────────────────────
const SERIES_FORMATS = ['bo1', 'bo3', 'bo5'];
const SERIES_THRESHOLD = { bo1: 1, bo3: 2, bo5: 3 };
const SERIES_MAX_GAMES = { bo1: 1, bo3: 3, bo5: 5 };

function seriesThreshold(fmt) {
  return SERIES_THRESHOLD[fmt] || 1;
}
function seriesMaxGames(fmt) {
  return SERIES_MAX_GAMES[fmt] || 1;
}

// Per-tournament-type allowlist. BR + FFA games can never run Bo3/Bo5 at
// this layer (each "match" in a BR tournament IS a single game already).
function validateSeriesFormat(seriesFormat, gameId, tournamentType) {
  if (!SERIES_FORMATS.includes(seriesFormat)) {
    return { ok: false, error: `Unknown seriesFormat: ${seriesFormat}` };
  }
  if (seriesFormat === 'bo1') return { ok: true };

  if (['battle_royale'].includes(tournamentType)) {
    return { ok: false, error: 'Battle Royale tournaments are Bo1 by definition.' };
  }
  // Phase 3 — RR / Swiss now accept Bo3/Bo5. Each match in the schedule
  // is the series; standings still use win/draw/loss against the match
  // (a series win = a match win for ranking purposes).
  // Game-level BR / FFA reject. Use the games registry's category.
  try {
    const { gameById } = require('./games');
    const g = gameById(gameId);
    if (g?.category === 'BR') {
      return { ok: false, error: `${g.label} is a BR title; Bo3/Bo5 doesn't apply.` };
    }
  } catch { /* games registry may be loaded elsewhere; non-fatal */ }
  return { ok: true };
}

// Mutate a match doc into series-aware shape. Called by startTournamentSecure
// at match creation. Idempotent.
function applyInitialSeriesFields(matchData, seriesFormat = 'bo1') {
  return {
    ...matchData,
    seriesFormat,
    seriesScore: { a: 0, b: 0 },
    games: [],
    seriesWinner: null,
  };
}

// ─── reportGameResultSecure ───────────────────────────────────────────
// Records ONE game in a multi-game series. Bo1 callers can keep using
// reportMatchResultSecure (cheaper round-trip; one report = match done).
//
// Agreement model mirrors the existing match-level flow:
//   - Trusted sources (host/admin/gameapi/gsi/vanguard) credit the game
//     immediately on a single report.
//   - Player ('manual') reports require BOTH players to agree on the
//     game's winner before it counts. Disagreement marks the GAME as
//     disputed (not the whole series) — series continues; the disputed
//     game blocks completion until resolved.
//
// When a game-credit pushes either side to ceil(N/2) wins, the helper
// invokes `_internal_recordMatchResult` (via tournaments.js) so the
// existing match-completion path runs identically (bracket advance,
// payouts, bets, ranking).
exports.reportGameResultSecure = functions.https.onCall(
  { region: REGION },
  async (req) => {
    if (!req.auth) throw new HttpsError('unauthenticated', 'Sign in required.');
    const uid = req.auth.uid;
    const { tournamentId, matchId, gameNumber, winnerId, evidenceUrl = null } = req.data || {};
    if (!tournamentId || !matchId || !winnerId) {
      throw new HttpsError('invalid-argument', 'tournamentId + matchId + winnerId required.');
    }
    const gNum = Math.max(1, Math.floor(Number(gameNumber || 0)));
    if (!gNum) throw new HttpsError('invalid-argument', 'gameNumber must be ≥ 1.');

    const db = admin.firestore(undefined, DB);
    const tRef = db.collection('tournaments').doc(tournamentId);
    const matchRef = tRef.collection('matches').doc(matchId);
    const gameRef = matchRef.collection('game_reports').doc(`g${gNum}_${uid}`);

    // Phase 1: trust source comes from caller role check. Player path
    // requires opponent agreement; trusted = direct.
    const userSnap = await db.collection('users').doc(uid).get();
    const u = userSnap.data() || {};
    const isAdmin = u.role === 'admin';
    const isMod = u.vanguard?.status === 'active' && u.vanguard?.rank && u.vanguard.rank !== 'recruit';

    const outcome = await db.runTransaction(async (tx) => {
      const [tSnap, mSnap] = await Promise.all([tx.get(tRef), tx.get(matchRef)]);
      if (!tSnap.exists) throw new HttpsError('not-found', 'Tournament not found.');
      if (!mSnap.exists) throw new HttpsError('not-found', 'Match not found.');
      const t = tSnap.data();
      const m = mSnap.data();

      if (m.status === 'completed') {
        throw new HttpsError('failed-precondition', 'Match already completed.');
      }
      if (m.status === 'cancelled') {
        throw new HttpsError('failed-precondition', 'Match cancelled.');
      }
      if (winnerId !== m.player1 && winnerId !== m.player2) {
        throw new HttpsError('invalid-argument', 'Winner must be one of the match players.');
      }
      const seriesFormat = m.seriesFormat || 'bo1';
      const maxGames = seriesMaxGames(seriesFormat);
      if (gNum > maxGames) {
        throw new HttpsError('invalid-argument', `Series is ${seriesFormat.toUpperCase()} (max ${maxGames} games).`);
      }

      const games = Array.isArray(m.games) ? m.games.slice() : [];
      const existingGame = games.find((g) => g.gameNumber === gNum);
      if (existingGame?.winnerId) {
        throw new HttpsError('failed-precondition', `Game ${gNum} already finalized.`);
      }
      // Games must be reported in order (no skipping ahead).
      const expectedNext = games.length + 1;
      if (gNum !== expectedNext) {
        throw new HttpsError('failed-precondition', `Next game to report is #${expectedNext}.`);
      }

      const isHost = uid === t.adminId;
      const isPlayer = uid === m.player1 || uid === m.player2;
      const trusted = isAdmin || isMod || isHost;
      if (!isPlayer && !trusted) {
        throw new HttpsError('permission-denied', 'Only players, host, or trusted sources can report.');
      }

      // Idempotent: same caller re-reports same winner for same game = no-op.
      const myReportSnap = await tx.get(gameRef);
      if (myReportSnap.exists && myReportSnap.data().winnerId === winnerId) {
        return { ok: true, alreadyReported: true, status: m.status };
      }
      tx.set(gameRef, {
        gameNumber: gNum,
        winnerId,
        reporterUid: uid,
        source: trusted ? (isAdmin ? 'admin' : isMod ? 'vanguard' : 'host') : 'manual',
        evidenceUrl: evidenceUrl || null,
        createdAt: FieldValue.serverTimestamp(),
      });

      // Trusted = credit game immediately.
      if (trusted) {
        return commitGame(tx, matchRef, m, gNum, winnerId, trusted ? (isAdmin ? 'admin' : isMod ? 'vanguard' : 'host') : 'manual');
      }

      // Player report — need opponent's report to match.
      const otherUid = uid === m.player1 ? m.player2 : m.player1;
      const otherReportRef = matchRef.collection('game_reports').doc(`g${gNum}_${otherUid}`);
      const otherSnap = await tx.get(otherReportRef);
      if (!otherSnap.exists) {
        tx.update(matchRef, {
          [`gameReportState.g${gNum}`]: {
            status: 'awaiting_confirmation',
            firstReporter: uid,
            firstReportedWinner: winnerId,
            firstReportedAt: FieldValue.serverTimestamp(),
          },
        });
        return { ok: true, awaiting: true };
      }
      if (otherSnap.data().winnerId === winnerId) {
        return commitGame(tx, matchRef, m, gNum, winnerId, 'manual');
      }
      // Disagreement — mark THIS GAME disputed (not the whole series).
      tx.update(matchRef, {
        [`gameReportState.g${gNum}`]: {
          status: 'disputed',
          reports: [
            { uid, winnerId },
            { uid: otherUid, winnerId: otherSnap.data().winnerId },
          ],
          disputedAt: FieldValue.serverTimestamp(),
        },
      });
      return { ok: true, gameDisputed: true };
    });

    // If the series completed inside the tx, run the same post-completion
    // pipeline reportMatchResultSecure runs (bracket advance, payouts, etc).
    if (outcome.seriesCompleted) {
      const tournaments = require('./tournaments');
      try {
        await tournaments._internal_recordMatchResult({
          reporterUid: uid,
          tournamentId,
          matchId,
          winnerId: outcome.seriesWinner,
          source: outcome.source || 'manual',
          evidenceUrl: evidenceUrl || null,
        });
      } catch (err) {
        // _internal_recordMatchResult is idempotent on completed matches;
        // if it throws "already completed" the tx already wrote our state,
        // so log and continue.
        console.warn('post-series _internal_recordMatchResult', err?.message || err);
      }
    }
    return outcome;
  },
);

// Helper: inside a transaction, commit a game's result, bump seriesScore,
// and (if threshold hit) flag seriesCompleted for the post-tx pipeline.
function commitGame(tx, matchRef, match, gNum, winnerId, source) {
  const games = Array.isArray(match.games) ? match.games.slice() : [];
  games.push({
    gameNumber: gNum,
    winnerId,
    source,
    completedAt: new Date(),
  });
  const seriesScore = { ...(match.seriesScore || { a: 0, b: 0 }) };
  if (winnerId === match.player1) seriesScore.a = (seriesScore.a || 0) + 1;
  else if (winnerId === match.player2) seriesScore.b = (seriesScore.b || 0) + 1;

  const fmt = match.seriesFormat || 'bo1';
  const need = seriesThreshold(fmt);
  const sideA = seriesScore.a >= need;
  const sideB = seriesScore.b >= need;
  const seriesDone = sideA || sideB;
  const seriesWinner = sideA ? match.player1 : sideB ? match.player2 : null;

  const updates = {
    games,
    seriesScore,
    [`gameReportState.g${gNum}`]: {
      status: 'completed', winnerId, completedAt: FieldValue.serverTimestamp(),
    },
  };
  if (seriesDone) updates.seriesWinner = seriesWinner;
  tx.update(matchRef, updates);

  return seriesDone
    ? { ok: true, seriesCompleted: true, seriesWinner, source, seriesScore }
    : { ok: true, gameCommitted: true, seriesScore };
}

// ─── Public exports ────────────────────────────────────────────────────
exports.SERIES_FORMATS = SERIES_FORMATS;
exports.SERIES_THRESHOLD = SERIES_THRESHOLD;
exports.SERIES_MAX_GAMES = SERIES_MAX_GAMES;
exports.seriesThreshold = seriesThreshold;
exports.seriesMaxGames = seriesMaxGames;
exports.validateSeriesFormat = validateSeriesFormat;
exports.applyInitialSeriesFields = applyInitialSeriesFields;
