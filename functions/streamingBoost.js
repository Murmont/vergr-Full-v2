// Pay-per-minute stream quality boost.
//
// Pricing (LOCKED 2026-05-17 — see CLAUDE.md "PLANNED — Pay-per-minute stream
// quality boost"):
//   720p target → 1 coin/min
//   1080p target → 2 coins/min
//
// Mechanics:
//   1. Streamer hits "Boost quality" button on BroadcasterScreen → calls
//      `requestStreamQualityBoost({ streamId, targetTier })`.
//   2. First minute charged immediately. Stream doc gets:
//        qualityBoost: { active, targetTier, startedAt, debitedThrough: 1,
//                        totalCharged, baseline metrics }
//   3. The Hetzner `vergr-rtmp-auth` watchdog reads `qualityBoost.targetTier`
//      and uses ITS hard cap instead of hostPlan. Streamer's OBS can now
//      encode at the higher rate without being dropped.
//   4. Scheduled cron `chargeStreamBoosts` runs every minute. Debits 1 more
//      minute from the host's wallet. If insufficient: tries tip-pool (TODO
//      in tip flow integration), else flips `active: false`.
//   5. When the streamer ends the stream OR cancels: status flips, final
//      summary stamped, watchdog reverts to base plan cap on next tick.
//
// NO REFUNDS — boosts deliver real algorithmic amplification + visible
// outcomes (viewer-join delta, feed impressions, tip uplift). The value is
// in the actual delivered reach, not in money-back guarantees.

const functions = require('firebase-functions/v2');
// Cron-consolidation shim (see index.js cronMinute): exports raw handler, same cadence.
const defer = (_opts, fn) => fn;
const admin = require('firebase-admin');
const { FieldValue } = require('firebase-admin/firestore');

const DB = 'vgrdb';
const REGION = 'europe-west1';
const HttpsError = functions.https.HttpsError;

// Cost per minute for each target boost tier.
const BOOST_COST_PER_MIN = {
  lite: 1,   // bring stream up to 720p
  pro:  2,   // bring stream up to 1080p
};

// Plan tier order — used to validate that target > current.
const PLAN_ORDER = { free: 0, lite: 1, pro: 2 };

// ───────────────────────────────────────────────────────────
// requestStreamQualityBoost — host activates boost.
// ───────────────────────────────────────────────────────────
exports.requestStreamQualityBoost = functions.https.onCall(
  { region: REGION },
  async (req) => {
    if (!req.auth) throw new HttpsError('unauthenticated', 'Sign in required.');
    const uid = req.auth.uid;
    const { streamId, targetTier } = req.data || {};
    if (!streamId) throw new HttpsError('invalid-argument', 'streamId required.');
    if (!BOOST_COST_PER_MIN[targetTier]) {
      throw new HttpsError('invalid-argument', `targetTier must be one of: ${Object.keys(BOOST_COST_PER_MIN).join(', ')}`);
    }

    const db = admin.firestore(undefined, DB);
    const streamRef = db.collection('streams').doc(streamId);
    const walletRef = db.collection('wallets').doc(uid);

    return db.runTransaction(async (tx) => {
      const streamSnap = await tx.get(streamRef);
      if (!streamSnap.exists) throw new HttpsError('not-found', 'Stream not found.');
      const s = streamSnap.data();
      if (s.hostId !== uid) throw new HttpsError('permission-denied', 'Only the host can boost their stream.');
      if (s.status !== 'live' && s.status !== 'created') {
        throw new HttpsError('failed-precondition', `Stream is ${s.status}, cannot boost.`);
      }

      const hostPlan = s.hostPlan || 'free';
      const currentEffectiveTier = s.qualityBoost?.active ? s.qualityBoost.targetTier : hostPlan;
      if ((PLAN_ORDER[targetTier] || 0) <= (PLAN_ORDER[currentEffectiveTier] || 0)) {
        throw new HttpsError('failed-precondition', `Stream is already at ${currentEffectiveTier} quality — boost target must be higher.`);
      }

      const costPerMin = BOOST_COST_PER_MIN[targetTier];
      const walletSnap = await tx.get(walletRef);
      const balance = Number(walletSnap.exists ? walletSnap.data().balance || 0 : 0);
      if (balance < costPerMin) {
        throw new HttpsError('failed-precondition', `Need at least ${costPerMin} coin${costPerMin > 1 ? 's' : ''} to start a ${targetTier} boost. You have ${balance}.`);
      }

      // Charge first minute.
      tx.update(walletRef, { balance: FieldValue.increment(-costPerMin), updatedAt: FieldValue.serverTimestamp() });
      tx.set(db.collection('transactions').doc(), {
        userId: uid,
        type: 'stream_quality_boost_minute',
        amount: -costPerMin,
        currency: 'coins',
        description: `Stream quality boost → ${targetTier} (minute 1)`,
        streamId,
        targetTier,
        createdAt: FieldValue.serverTimestamp(),
      });

      // Activate boost on stream doc.
      tx.update(streamRef, {
        qualityBoost: {
          active: true,
          targetTier,
          startedAt: FieldValue.serverTimestamp(),
          debitedThrough: 1,
          totalCharged: costPerMin,
          baselineViewers: Number(s.viewerCount || 0),
          baselineFeedImpressions: Number(s.feedImpressions || 0),
          lastChargedAt: FieldValue.serverTimestamp(),
          uid,
        },
      });

      return {
        ok: true,
        targetTier,
        costPerMin,
        firstMinuteCharged: costPerMin,
        balanceAfter: balance - costPerMin,
      };
    });
  }
);

// ───────────────────────────────────────────────────────────
// cancelStreamQualityBoost — host manually deactivates.
// ───────────────────────────────────────────────────────────
exports.cancelStreamQualityBoost = functions.https.onCall(
  { region: REGION },
  async (req) => {
    if (!req.auth) throw new HttpsError('unauthenticated', 'Sign in required.');
    const uid = req.auth.uid;
    const { streamId } = req.data || {};
    if (!streamId) throw new HttpsError('invalid-argument', 'streamId required.');

    const db = admin.firestore(undefined, DB);
    const streamRef = db.collection('streams').doc(streamId);
    const snap = await streamRef.get();
    if (!snap.exists) throw new HttpsError('not-found', 'Stream not found.');
    const s = snap.data();
    if (s.hostId !== uid) throw new HttpsError('permission-denied', 'Only the host can cancel their boost.');
    if (!s.qualityBoost?.active) return { ok: true, alreadyInactive: true };

    await streamRef.update({
      'qualityBoost.active': false,
      'qualityBoost.deactivatedAt': FieldValue.serverTimestamp(),
      'qualityBoost.deactivatedReason': 'host_cancel',
    });
    return { ok: true };
  }
);

// ───────────────────────────────────────────────────────────
// chargeStreamBoosts — scheduled every 1 minute. Debits the next minute
// from every active boost. Auto-reverts when wallet hits zero.
// ───────────────────────────────────────────────────────────
exports.chargeStreamBoosts = defer(
  { schedule: 'every 1 minutes', timeZone: 'UTC', region: REGION },
  async () => {
    const db = admin.firestore(undefined, DB);
    const snap = await db.collection('streams')
      .where('qualityBoost.active', '==', true)
      .limit(200)
      .get();
    if (snap.empty) return;

    for (const doc of snap.docs) {
      const s = doc.data();
      const boost = s.qualityBoost;
      if (!boost?.active) continue;
      const uid = boost.uid || s.hostId;
      const costPerMin = BOOST_COST_PER_MIN[boost.targetTier];
      if (!costPerMin) {
        // Bad data — deactivate.
        await doc.ref.update({ 'qualityBoost.active': false, 'qualityBoost.deactivatedReason': 'invalid_target' });
        continue;
      }
      // Skip if stream ended.
      if (s.status === 'ended' || s.status === 'failed') {
        await doc.ref.update({ 'qualityBoost.active': false, 'qualityBoost.deactivatedReason': 'stream_ended', 'qualityBoost.deactivatedAt': FieldValue.serverTimestamp() });
        continue;
      }

      // Attempt to debit.
      const walletRef = db.collection('wallets').doc(uid);
      try {
        await db.runTransaction(async (tx) => {
          const w = await tx.get(walletRef);
          const balance = Number(w.exists ? w.data().balance || 0 : 0);
          if (balance < costPerMin) {
            // Not enough — flip off + notify.
            tx.update(doc.ref, {
              'qualityBoost.active': false,
              'qualityBoost.deactivatedAt': FieldValue.serverTimestamp(),
              'qualityBoost.deactivatedReason': 'insufficient_funds',
            });
            tx.set(db.collection('notifications').doc(), {
              recipientId: uid,
              type: 'stream_boost_ended',
              title: 'Quality boost ended — wallet empty',
              body: `Your stream reverted to base quality. Top up coins or tip pool to reactivate.`,
              link: `/stream/${doc.id}`,
              createdAt: FieldValue.serverTimestamp(),
              read: false,
            });
            return;
          }
          // Debit + bump counters.
          tx.update(walletRef, { balance: FieldValue.increment(-costPerMin), updatedAt: FieldValue.serverTimestamp() });
          tx.set(db.collection('transactions').doc(), {
            userId: uid,
            type: 'stream_quality_boost_minute',
            amount: -costPerMin,
            currency: 'coins',
            description: `Stream quality boost → ${boost.targetTier} (minute ${Number(boost.debitedThrough || 1) + 1})`,
            streamId: doc.id,
            targetTier: boost.targetTier,
            createdAt: FieldValue.serverTimestamp(),
          });
          tx.update(doc.ref, {
            'qualityBoost.debitedThrough': FieldValue.increment(1),
            'qualityBoost.totalCharged': FieldValue.increment(costPerMin),
            'qualityBoost.lastChargedAt': FieldValue.serverTimestamp(),
          });
        });
      } catch (e) {
        console.error(`chargeStreamBoosts: stream ${doc.id} failed:`, e.message);
      }
    }
  }
);
