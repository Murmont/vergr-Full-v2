// streamHype.js — viewer-reactions-per-5s aggregator.
//
// Single callable: `recordStreamReaction({ streamId, kind? })`.
// Transactionally increments `streams/{streamId}.hype.count` within a
// rolling 5-second window. Window resets atomically when the last
// reaction was >5s ago. Peak tracks the highest count ever seen on this
// stream (drives the meter's relative intensity colour).
//
// Why no scheduled cron: Firebase scheduled functions are capped at
// 1-minute granularity, useless for a 5-second window. The reset is
// done inside the callable itself — on each call we check the elapsed
// time since `windowEndedAtMs` and either roll the window or extend it.
//
// Cost control: client-side debounce in ViewerStreamScreen caps at
// 1 callable / user / second. The "fire" animation on the viewer is
// purely local, so spamming the tap button doesn't 1-to-1 spam writes.
//
// Schema written to streams/{streamId}.hype:
//   { count, peak, windowStartedAtMs, windowEndedAtMs }

const functions = require('firebase-functions/v2');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');

const REGION = 'europe-west1';
const WINDOW_MS = 5_000;
const db = getFirestore('vgrdb');

exports.recordStreamReaction = functions.https.onCall(
  { region: REGION },
  async (req) => {
    if (!req.auth) {
      throw new functions.https.HttpsError('unauthenticated', 'Sign in required.');
    }
    const { streamId } = req.data || {};
    if (!streamId || typeof streamId !== 'string') {
      throw new functions.https.HttpsError('invalid-argument', 'streamId required.');
    }

    const ref = db.collection('streams').doc(streamId);
    let resultCount = 0;
    let resultPeak = 0;

    await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) {
        // Don't throw — silently no-op so a stale viewer doesn't error-spam.
        return;
      }
      const data = snap.data() || {};
      if (data.status === 'ended') return; // stream over — drop the reaction
      const h = data.hype || {};
      const now = Date.now();
      const windowEnded = h.windowEndedAtMs || 0;
      const stale = (now - windowEnded) > WINDOW_MS;
      const count = stale ? 1 : (h.count || 0) + 1;
      const peak = Math.max(h.peak || 0, count);
      tx.update(ref, {
        hype: {
          count, peak,
          windowStartedAtMs: stale ? now : (h.windowStartedAtMs || now),
          windowEndedAtMs: now,
          // Last reactor uid is useful for the broadcaster to see WHO is
          // hyped (privacy: only their public uid, not displayName).
          lastUid: req.auth.uid,
        },
      });
      resultCount = count;
      resultPeak = peak;
    });

    return { ok: true, count: resultCount, peak: resultPeak };
  }
);
