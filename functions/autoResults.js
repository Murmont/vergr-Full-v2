// Phase 2 automated result engine — server half.
//
// The vergr-ocr box OCRs game-capture frames uploaded from the match screen
// and, when a player's own end screen announces their outcome, writes
// match.autoResult.{uid} = { outcome: 'won'|'lost', text, at }. This trigger
// converts each unprocessed verdict into a result report through the SAME
// machinery as a manual report (recordMatchResultInternal, player path):
//
//   - first side's verdict  → awaiting_confirmation + opponent confirm push
//                             + 3-min auto-confirm window
//   - second side agreeing  → match completes instantly (dual screen-read)
//   - second side conflicting → disputed (mod resolves)
//
// Deliberately NOT a trusted-source fast-path: a single screen-read is
// spoofable (player could capture a fake victory image), so one side's read
// is a CLAIM bounded by the confirm window; only two independent agreeing
// reads complete instantly. GSI (server-pushed) remains the only instant
// single-signal source.
//
// Loop guard: autoResultProcessed.{uid} — this trigger writes the match doc,
// which re-fires it; processed sides are skipped.

const functions = require('firebase-functions/v2');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');

const REGION = 'europe-west1';
const db = getFirestore('vgrdb');

exports.processAutoResults = functions.firestore.onDocumentWritten(
  { region: REGION, document: 'tournaments/{tournamentId}/matches/{matchId}', database: 'vgrdb' },
  async (event) => {
    const after = event.data?.after?.data();
    if (!after || !after.autoResult) return;
    const { tournamentId, matchId } = event.params;
    const processed = after.autoResultProcessed || {};
    const mRef = db.collection('tournaments').doc(tournamentId)
      .collection('matches').doc(matchId);
    const tournaments = require('./tournaments');

    for (const [uid, verdict] of Object.entries(after.autoResult)) {
      if (!verdict || !verdict.outcome || processed[uid]) continue;
      if (uid !== after.player1 && uid !== after.player2) {
        await mRef.update({ [`autoResultProcessed.${uid}`]: FieldValue.serverTimestamp() });
        continue;
      }
      const other = uid === after.player1 ? after.player2 : after.player1;
      const winnerId = verdict.outcome === 'won' ? uid : other;
      try {
        if (!winnerId) throw new Error('winner unresolvable (missing opponent)');
        const res = await tournaments._internal_recordMatchResult({
          tournamentId, matchId,
          winnerId,
          reporterUid: uid,
          source: 'manual', // player-path trust: claim → confirm window → dual-agree completes
        });
        console.log(`autoResult: ${uid} ${verdict.outcome} in ${tournamentId}/${matchId} → ${res?.status}`);
        await mRef.update({ [`autoResultProcessed.${uid}`]: FieldValue.serverTimestamp() });
      } catch (err) {
        const msg = err?.message || String(err);
        // High-stakes proof gate: the proof feed may simply not be registered
        // yet — leave UNprocessed so the next match-doc write retries.
        if (/proof/i.test(msg)) {
          console.warn(`autoResult deferred (proof gate) ${tournamentId}/${matchId}/${uid}: ${msg}`);
          continue;
        }
        // Anything else (already completed, dispute, validation) is terminal
        // for this verdict — mark processed so we don't loop.
        console.warn(`autoResult failed ${tournamentId}/${matchId}/${uid}: ${msg}`);
        await mRef.update({ [`autoResultProcessed.${uid}`]: FieldValue.serverTimestamp() }).catch(() => {});
      }
    }
  },
);
