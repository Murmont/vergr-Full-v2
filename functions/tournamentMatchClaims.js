// Per-match Vanguard claiming + auto-OCR suggestion cron + Commander
// override resolution.
//
// Model (founder-clarified): a single tournament can be co-moderated by
// multiple Vanguard mods, each claiming individual matches. The only
// hard constraint is that a mod cannot claim two matches with overlapping
// scheduled times. The legacy `tournament_assignments` doc per tournament
// still exists (created by onTournamentCreated) and remains the unit the
// OCR pipeline + treasury weighting reads from — per-match claims live
// alongside it in `tournament_match_claims/{claimId}`.
//
// Auto-OCR: every 60s the cron scans matches whose tournament has an
// active assignment AND that are currently `live`, calls
// `_internal_analyzeAssignment` (Tesseract + Vision consensus), and
// stamps `aiSuggestion` on the match doc. The mod still has to confirm
// via vanguardCallTournamentWinner — the cron NEVER records a result.
//
// Commander resolution: when a match has `commanderReviewRequired:true`
// (mod disagreed with high-confidence AI), a Commander/Overseer/founder
// uses `commanderResolveMatchReview` to either confirm the mod's pick or
// override it with their own.

const functions = require('firebase-functions/v2');
// Cron-consolidation shim (see index.js cronMinute): exports raw handler, same cadence.
const defer = (_opts, fn) => fn;
const admin = require('firebase-admin');
const { FieldValue } = require('firebase-admin/firestore');

const DB = 'vgrdb';
const REGION = 'europe-west1';
const HttpsError = functions.https.HttpsError;

const tsMs = (t) => {
  if (!t) return 0;
  if (t.toMillis) return t.toMillis();
  if (t.seconds) return t.seconds * 1000;
  if (typeof t === 'number') return t;
  if (t instanceof Date) return t.getTime();
  return 0;
};

// ───────────────────────────────────────────────────────────
// vanguardClaimMatch — claim a single match in a tournament.
// ───────────────────────────────────────────────────────────
exports.vanguardClaimMatch = functions.https.onCall(
  { region: REGION },
  async (req) => {
    if (!req.auth) throw new HttpsError('unauthenticated', 'Sign in required.');
    const uid = req.auth.uid;
    const { tournamentId, matchId } = req.data || {};
    if (!tournamentId || !matchId) {
      throw new HttpsError('invalid-argument', 'tournamentId + matchId required.');
    }

    const db = admin.firestore(undefined, DB);

    const userSnap = await db.collection('users').doc(uid).get();
    if (!userSnap.exists) throw new HttpsError('not-found', 'User not found.');
    const u = userSnap.data();
    const v = u.vanguard || {};
    if (u.role !== 'admin') {
      if (!v.rank || v.status !== 'active' || v.rank === 'recruit') {
        throw new HttpsError('permission-denied', 'Active Vanguard (non-Recruit) only.');
      }
    }

    const matchRef = db.collection('tournaments').doc(tournamentId)
      .collection('matches').doc(matchId);
    const claimId = `${tournamentId}_${matchId}`;
    const claimRef = db.collection('tournament_match_claims').doc(claimId);

    return db.runTransaction(async (tx) => {
      const matchSnap = await tx.get(matchRef);
      if (!matchSnap.exists) throw new HttpsError('not-found', 'Match not found.');
      const match = matchSnap.data();
      if (match.status === 'completed' || match.status === 'cancelled') {
        throw new HttpsError('failed-precondition', `Match already ${match.status}.`);
      }

      const existing = await tx.get(claimRef);
      if (existing.exists && existing.data().status === 'claimed') {
        throw new HttpsError('failed-precondition', 'Another mod already claimed this match.');
      }

      const startMs = tsMs(match.scheduledStart || match.startedAt) || Date.now();
      const endMs = startMs + (Number(match.estimatedDurationMin || 60) * 60_000);

      // Schedule-overlap check against this mod's other active claims.
      const mineSnap = await tx.get(
        db.collection('tournament_match_claims')
          .where('moderatorId', '==', uid)
          .where('status', '==', 'claimed')
      );
      for (const d of mineSnap.docs) {
        const o = d.data();
        const oStart = tsMs(o.scheduledStart);
        const oEnd = tsMs(o.scheduledEnd);
        if (oStart < endMs && oEnd > startMs) {
          throw new HttpsError(
            'failed-precondition',
            `Overlaps with your existing match claim (${o.tournamentId}/${o.matchId}).`,
          );
        }
      }

      tx.set(claimRef, {
        tournamentId,
        matchId,
        moderatorId: uid,
        status: 'claimed',
        scheduledStart: new Date(startMs),
        scheduledEnd: new Date(endMs),
        claimedAt: FieldValue.serverTimestamp(),
      });
      tx.set(matchRef, {
        claimedModeratorId: uid,
        claimedAt: FieldValue.serverTimestamp(),
      }, { merge: true });

      return { ok: true, claimId };
    });
  },
);

// ───────────────────────────────────────────────────────────
// vanguardReleaseMatchClaim — release a held match.
// ───────────────────────────────────────────────────────────
exports.vanguardReleaseMatchClaim = functions.https.onCall(
  { region: REGION },
  async (req) => {
    if (!req.auth) throw new HttpsError('unauthenticated', 'Sign in required.');
    const uid = req.auth.uid;
    const { tournamentId, matchId } = req.data || {};
    if (!tournamentId || !matchId) {
      throw new HttpsError('invalid-argument', 'tournamentId + matchId required.');
    }
    const db = admin.firestore(undefined, DB);
    const claimRef = db.collection('tournament_match_claims').doc(`${tournamentId}_${matchId}`);
    const matchRef = db.collection('tournaments').doc(tournamentId)
      .collection('matches').doc(matchId);
    return db.runTransaction(async (tx) => {
      const cSnap = await tx.get(claimRef);
      if (!cSnap.exists) throw new HttpsError('not-found', 'Claim not found.');
      const c = cSnap.data();
      const userSnap = await tx.get(db.collection('users').doc(uid));
      const isAdmin = userSnap.data()?.role === 'admin';
      if (c.moderatorId !== uid && !isAdmin) {
        throw new HttpsError('permission-denied', 'Not your claim.');
      }
      tx.update(claimRef, {
        status: 'released',
        releasedAt: FieldValue.serverTimestamp(),
      });
      tx.set(matchRef, {
        claimedModeratorId: null,
      }, { merge: true });
      return { ok: true };
    });
  },
);

// ───────────────────────────────────────────────────────────
// autoSuggestMatchWinners — scheduled cron, every 60s. For each tournament
// with an active assignment AND a live match, run the OCR consensus and
// stamp `aiSuggestion` on the match. Never records a result — the assigned
// mod still confirms via vanguardCallTournamentWinner.
// ───────────────────────────────────────────────────────────
exports.autoSuggestMatchWinners = defer(
  { schedule: 'every 1 minutes', region: REGION, timeZone: 'UTC', timeoutSeconds: 540 },
  async () => {
    const db = admin.firestore(undefined, DB);
    // Find assignments currently in check-in/in-progress window.
    const aSnap = await db.collection('tournament_assignments')
      .where('status', 'in', ['checked_in', 'in_progress', 'assigned'])
      .limit(50)
      .get();
    if (aSnap.empty) return;

    const { _internal_analyzeAssignment } = require('./tournamentAi');
    const now = Date.now();

    for (const doc of aSnap.docs) {
      const a = doc.data();
      const startMs = tsMs(a.scheduledStart);
      const endMs = tsMs(a.scheduledEnd);
      // Run only while the tournament's window is open (10min lead + 1h slack).
      if (now < startMs - 10 * 60_000) continue;
      if (now > endMs + 60 * 60_000) continue;

      try {
        await _internal_analyzeAssignment(db, doc.id, 'cron');
      } catch (err) {
        console.error('autoSuggestMatchWinners error', doc.id, err?.message || err);
      }
    }
  },
);

// ───────────────────────────────────────────────────────────
// detectTournamentStreamDrops — scheduled cron, every 30s. Required by
// founder mandate: tournament matches are streamed end-to-end. If a
// participant's stream goes dark mid-match, 30s grace then a strike;
// 2 strikes = forfeit. Reads `streams` doc + match for each in-progress
// tournament match. Idempotent within the 30s tick (strike + grace
// timestamps stamped on the match doc).
// ───────────────────────────────────────────────────────────
exports.detectTournamentStreamDrops = defer(
  { schedule: 'every 1 minutes', region: REGION, timeZone: 'UTC', timeoutSeconds: 240 },
  async () => {
    const db = admin.firestore(undefined, DB);
    const GRACE_MS = 30_000;
    const STRIKES_TO_FORFEIT = 2;

    // Find tournaments in-progress.
    const tSnap = await db.collection('tournaments')
      .where('status', '==', 'in_progress')
      .limit(50)
      .get();
    if (tSnap.empty) return;

    const tournaments = require('./tournaments');

    for (const tDoc of tSnap.docs) {
      const tournamentId = tDoc.id;
      const matchesSnap = await db.collection('tournaments').doc(tournamentId)
        .collection('matches')
        .where('status', '==', 'in_progress')
        .limit(40)
        .get();
      if (matchesSnap.empty) continue;

      for (const mDoc of matchesSnap.docs) {
        const match = mDoc.data();
        const participants = [];
        if (match.player1) participants.push(match.player1);
        if (match.player2) participants.push(match.player2);
        if (match.squad1Id) participants.push({ squad: match.squad1Id });
        if (match.squad2Id) participants.push({ squad: match.squad2Id });
        if (participants.length < 2) continue;

        const dropFlags = match.streamDropFlags || {};
        const dropStrikes = match.dropStrikes || {};
        const now = Date.now();
        let forfeitedBy = null;

        for (const partRef of participants) {
          const uid = typeof partRef === 'string' ? partRef : null;
          if (!uid) continue; // squad dropouts handled separately

          // Find this participant's tournament stream.
          const streamsQ = await db.collection('streams')
            .where('tournamentId', '==', tournamentId)
            .where('userId', '==', uid)
            .limit(1)
            .get();
          let isDown = true;
          if (!streamsQ.empty) {
            const s = streamsQ.docs[0].data();
            if (s.status === 'live') {
              const lastFrameMs = tsMs(s.lastFrameAt) || tsMs(s.updatedAt) || 0;
              if (lastFrameMs > now - GRACE_MS) isDown = false;
            }
          }

          const flag = dropFlags[uid];
          if (isDown) {
            if (!flag) {
              dropFlags[uid] = { firstSeenMs: now };
            } else if (now - flag.firstSeenMs >= GRACE_MS && !flag.strikeApplied) {
              // Grace exceeded — record a strike.
              dropStrikes[uid] = (dropStrikes[uid] || 0) + 1;
              dropFlags[uid] = { firstSeenMs: now, strikeApplied: true };
              if (dropStrikes[uid] >= STRIKES_TO_FORFEIT) {
                forfeitedBy = uid;
                break;
              }
            }
          } else if (flag) {
            // Stream came back — clear current grace window (strike sticks).
            delete dropFlags[uid];
          }
        }

        await mDoc.ref.set({
          streamDropFlags: dropFlags,
          dropStrikes,
          dropCheckedAt: FieldValue.serverTimestamp(),
        }, { merge: true });

        if (forfeitedBy) {
          const winnerId = match.player1 === forfeitedBy ? match.player2 : match.player1;
          if (winnerId) {
            try {
              await tournaments._internal_recordMatchResult({
                reporterUid: null,
                tournamentId,
                matchId: mDoc.id,
                winnerId,
                source: 'forfeit_stream_drop',
                evidenceUrl: null,
              });
              await mDoc.ref.set({
                forfeitReason: `Stream drop forfeit — ${forfeitedBy} exceeded ${STRIKES_TO_FORFEIT} strikes`,
                forfeitedBy,
                forfeitedAt: FieldValue.serverTimestamp(),
              }, { merge: true });
            } catch (err) {
              console.error('Forfeit record failed', tournamentId, mDoc.id, err?.message || err);
            }
          }
        }
      }
    }
  },
);

// ───────────────────────────────────────────────────────────
// commanderResolveMatchReview — Commander/Overseer/founder resolves a
// match flagged by the override gate. Either confirms the mod's pick or
// overrides with their own. Records the result via the existing internal
// helper and clears the review flag.
// ───────────────────────────────────────────────────────────
exports.commanderResolveMatchReview = functions.https.onCall(
  { region: REGION },
  async (req) => {
    if (!req.auth) throw new HttpsError('unauthenticated', 'Sign in required.');
    const uid = req.auth.uid;
    const { tournamentId, matchId, winnerId, reason = '' } = req.data || {};
    if (!tournamentId || !matchId || !winnerId) {
      throw new HttpsError('invalid-argument', 'tournamentId + matchId + winnerId required.');
    }
    const db = admin.firestore(undefined, DB);
    const userSnap = await db.collection('users').doc(uid).get();
    const u = userSnap.data() || {};
    const isAdmin = u.role === 'admin';
    const isCommanderPlus = ['commander', 'overseer'].includes(u.vanguard?.rank) && u.vanguard?.status === 'active';
    if (!isAdmin && !isCommanderPlus) {
      throw new HttpsError('permission-denied', 'Commander+ only.');
    }
    const matchRef = db.collection('tournaments').doc(tournamentId)
      .collection('matches').doc(matchId);
    const matchSnap = await matchRef.get();
    if (!matchSnap.exists) throw new HttpsError('not-found', 'Match not found.');
    const match = matchSnap.data();
    if (!match.commanderReviewRequired) {
      throw new HttpsError('failed-precondition', 'Match not flagged for review.');
    }

    const tournaments = require('./tournaments');
    await tournaments._internal_recordMatchResult({
      reporterUid: uid,
      tournamentId,
      matchId,
      winnerId,
      source: isAdmin ? 'admin' : 'commander',
      evidenceUrl: null,
    });

    await matchRef.set({
      commanderReviewRequired: false,
      commanderResolvedBy: uid,
      commanderResolvedAt: FieldValue.serverTimestamp(),
      commanderResolutionReason: String(reason).slice(0, 400),
    }, { merge: true });

    await db.collection('vanguard_actions').add({
      moderatorId: uid,
      action: 'tournament_match_review_resolved',
      targetType: 'tournament_match',
      targetId: `${tournamentId}/${matchId}`,
      tournamentId,
      matchId,
      winnerId,
      modProposedWinnerId: match.modProposedWinnerId || null,
      aiSuggestedWinnerId: match.aiSuggestion?.suggestedWinnerId || null,
      rank: isAdmin ? 'founder' : (u.vanguard?.rank || 'commander'),
      reason: String(reason).slice(0, 400),
      takenAt: FieldValue.serverTimestamp(),
    });

    return { ok: true };
  },
);
