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
const defer = (_opts, fn) => fn; // cron-consolidation shim (see index.js cron5Min)
const { getFirestore, FieldValue } = require('firebase-admin/firestore');

const REGION = 'europe-west1';
const db = getFirestore('vgrdb');

// Two separate windows (tournaments are scheduled, synchronous events —
// scheduledStart is required at create — so 48h-class limits made brackets
// unrunnable in practice):
//   - NO-SHOW window: from match creation, a side that never engages
//     (verify / self-attest) forfeits. 15 min default.
//   - RESULT window: from the match going live (bothVerifiedAt), no result
//     reported → disputed for a mod. 90 min default (covers a long Bo3).
// Hosts override via tournaments/{id}.noShowTimeoutMs / matchTimeoutMs.
// Legacy docs with an old huge matchTimeoutMs still honour it.
const DEFAULT_NO_SHOW_MS = 15 * 60 * 1000;
const DEFAULT_RESULT_MS = 90 * 60 * 1000;

exports.detectMatchTimeouts = defer(
  { region: REGION, schedule: 'every 30 minutes', timeZone: 'UTC' },
  async () => {
    const tSnap = await db.collection('tournaments').where('status', '==', 'active').limit(200).get();
    const now = Date.now();
    const tournaments = require('./tournaments');

    for (const td of tSnap.docs) {
      const t = td.data();
      const resultTimeoutMs = t.matchTimeoutMs || DEFAULT_RESULT_MS;
      const noShowTimeoutMs = t.noShowTimeoutMs || Math.min(DEFAULT_NO_SHOW_MS, resultTimeoutMs);

      // 'in_progress' = both sides engaged + match live (set by
      // pingBothIfReady). Those matches time out too — the old pending-only
      // query stopped seeing a match the moment it went live.
      const matchesSnap = await td.ref.collection('matches')
        .where('status', 'in', ['pending', 'in_progress']).get();
      for (const md of matchesSnap.docs) {
        const m = md.data();
        // NT2 — both players agreed to delay this match; don't auto-forfeit
        // until the agreed time passes.
        if (m.rescheduledUntil && m.rescheduledUntil > now) continue;

        // "Engaged" (verified OR self_attested) counts as showed-up. A player
        // who attested and played must never be branded a no-show just
        // because no OCR stream / mod upgraded them to 'verified'.
        const vs = m.verifyState || {};
        const engagedStatus = (uid) => {
          const st = vs[uid]?.status;
          return st === 'verified' || st === 'self_attested';
        };
        const p1Verified = engagedStatus(m.player1);
        const p2Verified = engagedStatus(m.player2);

        // Pick the window: both engaged → RESULT window from go-live;
        // otherwise → NO-SHOW window from match creation.
        const createdAtMs = m.createdAt?.toMillis?.() || 0;
        const liveAtMs = m.bothVerifiedAt?.toMillis?.() || 0;
        if (p1Verified && p2Verified) {
          const base = liveAtMs || createdAtMs;
          if (!base || now - base < resultTimeoutMs) continue;
        } else {
          if (!createdAtMs || now - createdAtMs < noShowTimeoutMs) continue;
        }

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
            const mins = Math.max(1, Math.round(noShowTimeoutMs / 60_000));
            await notifyOne(td.id, md.id, winnerId, 'tournament_match_forfeit',
              `${t.name || 'Tournament'} — you advance`,
              'Your opponent did not check in within the time limit. You win this match by forfeit and advance.');
            await notifyOne(td.id, md.id, loserId, 'tournament_match_disqualified',
              `${t.name || 'Tournament'} — you were disqualified`,
              `You didn't verify the lobby code within the ${mins}-minute window, so you forfeited this match. Your opponent advances.`);
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

// ─── autoConfirmMatchResults — cron every 1 min ──────────────────────────
// One player reported a result (status awaiting_confirmation) and the
// opponent was pinged with a confirm deadline. Past the deadline with no
// counter-report, the claimed result stands and the bracket advances. This
// is what keeps results near-instant: silence is acceptance, disputes are
// the only thing that waits on a human.
const DEFAULT_CONFIRM_WINDOW_MS = 3 * 60 * 1000;

exports.autoConfirmMatchResults = defer(
  { region: REGION, schedule: 'every 1 minutes', timeZone: 'UTC' },
  async () => {
    const tSnap = await db.collection('tournaments').where('status', '==', 'active').limit(200).get();
    const now = Date.now();
    const tournaments = require('./tournaments');

    for (const td of tSnap.docs) {
      const t = td.data();
      const matchesSnap = await td.ref.collection('matches')
        .where('status', '==', 'awaiting_confirmation').get();
      for (const md of matchesSnap.docs) {
        const m = md.data();
        if (!m.firstReportedWinner || !m.firstReporter) continue;
        const deadline = Number(m.confirmDeadlineMs)
          || ((m.firstReportedAt?.toMillis?.() || 0) + (Number(t.confirmWindowMs) || DEFAULT_CONFIRM_WINDOW_MS));
        if (!deadline || now < deadline) continue;

        try {
          await tournaments._internal_recordMatchResult({
            tournamentId: td.id, matchId: md.id,
            winnerId: m.firstReportedWinner,
            reporterUid: 'system_autoconfirm',
            source: 'admin',
          });
          await md.ref.update({ completedBy: 'auto_confirm' });
          const winnerId = m.firstReportedWinner;
          const loserId = winnerId === m.player1 ? m.player2 : m.player1;
          await notifyOne(td.id, md.id, winnerId, 'tournament_result_confirmed',
            `${t.name || 'Tournament'} — result confirmed`,
            'Your reported win is confirmed. The bracket has advanced.');
          if (loserId) {
            await notifyOne(td.id, md.id, loserId, 'tournament_result_confirmed',
              `${t.name || 'Tournament'} — result recorded`,
              'The reported result stood unchallenged and was recorded. If it was wrong, contact a moderator from the match screen.');
          }
        } catch (err) {
          console.warn('autoConfirm failed', td.id, md.id, err?.message || err);
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
