// Tournament per-match timeout enforcement.
//
// Tournament System doc: "48h per round, auto-forfeit if no result reported."
//
// Every 30 minutes the scheduled job scans pending tournament matches that
// have been open longer than the per-match limit. Two cases:
//
//   1. Both sides verified (match has been live for >48h with no result):
//      → mark the match disputed (mod must resolve manually). We don't pick
//        a winner; we don't trust an automatic forfeit when both players
//        actively engaged.
//
//   2. One side never verified, the other did:
//      → auto-forfeit. The verified side wins; bracket advances. Audit row
//        recorded so the loser sees why.
//
//   3. Neither side verified:
//      → double no-show. Match cancelled; no winner advances (the round
//        slot above gets a bye on the next advance pass). Both players are
//        marked no-show on the tournament.
//
// Time budget: 48h is the doc default; tournament hosts can override via
// `tournaments/{id}.matchTimeoutMs`.

const functions = require('firebase-functions/v2');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');

const REGION = 'europe-west1';
const db = getFirestore('vgrdb');

const DEFAULT_TIMEOUT_MS = 48 * 60 * 60 * 1000;

exports.detectMatchTimeouts = onSchedule(
  { region: REGION, schedule: 'every 30 minutes', timeZone: 'UTC' },
  async () => {
    const tSnap = await db.collection('tournaments').where('status', '==', 'active').limit(200).get();
    const now = Date.now();
    const tournaments = require('./tournaments');

    for (const td of tSnap.docs) {
      const t = td.data();
      const timeoutMs = t.matchTimeoutMs || DEFAULT_TIMEOUT_MS;

      const matchesSnap = await td.ref.collection('matches')
        .where('status', '==', 'pending').get();
      for (const md of matchesSnap.docs) {
        const m = md.data();
        const openedAtMs = m.bothVerifiedAt?.toMillis?.() || m.createdAt?.toMillis?.() || 0;
        if (!openedAtMs) continue;
        if (now - openedAtMs < timeoutMs) continue;

        const vs = m.verifyState || {};
        const p1Verified = vs[m.player1]?.status === 'verified';
        const p2Verified = vs[m.player2]?.status === 'verified';

        if (p1Verified && p2Verified) {
          // Both showed up, no result reported — mod must rule.
          await md.ref.update({
            status: 'disputed',
            disputedAt: FieldValue.serverTimestamp(),
            disputeReason: 'timeout_both_verified',
          });
          await td.ref.collection('disputes').doc(md.id).set({
            matchId: md.id, tournamentId: td.id,
            reports: [], status: 'open', reason: 'timeout_no_result',
            createdAt: FieldValue.serverTimestamp(),
          });
          await notifyPlayers(td.id, m, 'tournament_match_disputed',
            `${t.name || 'Tournament'} — match disputed`,
            'Neither side reported a result within the time limit. A mod will resolve it.');
          continue;
        }

        if (p1Verified !== p2Verified && (p1Verified || p2Verified)) {
          // Exactly one side verified — they win by forfeit.
          const winnerId = p1Verified ? m.player1 : m.player2;
          try {
            await tournaments._internal_recordMatchResult({
              tournamentId: td.id, matchId: md.id,
              winnerId, reporterUid: 'system_timeout',
              source: 'admin', evidenceUrl: null,
            });
            await md.ref.update({
              completedBy: 'system_timeout_forfeit',
              forfeitReason: 'opponent_no_show',
            });
            const loserId = winnerId === m.player1 ? m.player2 : m.player1;
            const hours = Math.round(timeoutMs / 3_600_000);
            await notifyOne(td.id, md.id, winnerId, 'tournament_match_forfeit',
              `${t.name || 'Tournament'} — you advance`,
              'Your opponent did not check in within the time limit. You win this match by forfeit and advance.');
            await notifyOne(td.id, md.id, loserId, 'tournament_match_disqualified',
              `${t.name || 'Tournament'} — you were disqualified`,
              `You didn't check in / verify the lobby code within the ${hours}h time limit, so you forfeited this match. Your opponent advances.`);
          } catch (err) {
            console.warn('forfeit dispatch failed', td.id, md.id, err);
          }
          continue;
        }

        // Neither side verified — double no-show.
        await md.ref.update({
          status: 'cancelled',
          cancelledAt: FieldValue.serverTimestamp(),
          cancelReason: 'double_no_show',
        });
        await td.ref.update({
          [`participantState.${m.player1}.noShowAt`]: FieldValue.serverTimestamp(),
          [`participantState.${m.player2}.noShowAt`]: FieldValue.serverTimestamp(),
        });
        for (const uid of [m.player1, m.player2]) {
          await notifyOne(td.id, md.id, uid, 'tournament_match_double_no_show',
            `${t.name || 'Tournament'} — you were disqualified`,
            'Neither player checked in within the time limit, so this match was cancelled and the bracket slot will skip on the next advance.');
        }
      }
    }
  },
);

// Single-recipient notification with a correct match deep-link (matchId is the
// doc id, which isn't present on the match data — pass it explicitly).
async function notifyOne(tournamentId, matchId, uid, type, title, body) {
  if (!uid) return;
  await db.collection('notifications').add({
    recipientId: uid, type, title, body,
    data: { tournamentId, matchId: matchId || null },
    actionUrl: `/tournaments/${tournamentId}/match/${matchId || ''}`,
    read: false, createdAt: FieldValue.serverTimestamp(),
  });
}

async function notifyPlayers(tournamentId, m, type, title, body) {
  const batch = db.batch();
  for (const uid of [m.player1, m.player2]) {
    if (!uid) continue;
    batch.set(db.collection('notifications').doc(), {
      recipientId: uid, type, title, body,
      data: { tournamentId, matchId: m.id || null },
      actionUrl: `/tournaments/${tournamentId}/match/${m.id || ''}`,
      read: false, createdAt: FieldValue.serverTimestamp(),
    });
  }
  await batch.commit();
}
