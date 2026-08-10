/**
 * One-shot refund of every unsettled spectator "pick".
 *
 * ## Why this exists
 *
 * Predictions were removed on 2026-08-09 for Stripe underwriting: the callables
 * are deleted and `settleMatchBets` / `refundMatchBets` went with them. That
 * closed the front door, but it also removed the only code that could ever pay
 * out or return a stake, so every pick already in flight became coins a user
 * had spent with no path back. `adminTournaments.js` still called the refund
 * helper on cancellation; that call now resolves to `undefined` and is
 * swallowed by its own try/catch, so it looks fine in the logs and does nothing.
 *
 * This sweeps the collection group and returns every outstanding stake to the
 * wallet it came from.
 *
 * ## It refunds rather than settles, deliberately
 *
 * Settling would mean deciding winners, which means re-implementing the thing
 * that was removed. Refunding is the only outcome that is defensible without
 * it: nobody is out of pocket, nobody profits from a product that no longer
 * exists, and it costs the platform nothing beyond the stakes it was holding.
 *
 * ## Safe to run twice
 *
 * Every pick is refunded inside a transaction that first re-reads the doc and
 * bails if it already carries `settledAt`. A second run over the same data is a
 * no-op, so this can be re-run after a partial failure without paying anyone
 * twice.
 */
const functions = require('firebase-functions/v2');
const { HttpsError } = require('firebase-functions/v2/https');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');

const REGION = 'europe-west1';
const db = getFirestore('vgrdb');

/** Firestore caps a batch at 500 writes; each pick costs three. */
const PAGE = 120;

async function requireAdmin(uid) {
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in required.');
  const snap = await db.collection('users').doc(uid).get();
  if (!snap.exists || snap.data().role !== 'admin') {
    throw new HttpsError('permission-denied', 'Admin only.');
  }
}

/**
 * @param {boolean} dryRun  count what WOULD be refunded and change nothing.
 *                          Defaults true: a money-moving sweep should not be
 *                          one mistyped call away from running.
 */
exports.refundOutstandingPicks = functions.https.onCall(
  { region: REGION, cors: true, timeoutSeconds: 540, memory: '512MiB' },
  async (request) => {
    await requireAdmin(request.auth?.uid);
    const dryRun = request.data?.dryRun !== false;
    const limit = Math.min(5000, Math.max(1, Math.floor(Number(request.data?.limit) || 5000)));

    // collectionGroup so it finds picks under every match of every tournament
    // without walking the tournament tree.
    const snap = await db.collectionGroup('picks').limit(limit).get();

    let scanned = 0;
    let alreadySettled = 0;
    let refunded = 0;
    let coins = 0;
    const failures = [];

    const pending = [];
    snap.forEach((d) => {
      scanned += 1;
      const p = d.data() || {};
      if (p.settledAt) { alreadySettled += 1; return; }
      const amount = Math.floor(Number(p.amount ?? p.stake) || 0);
      const uid = p.uid || d.id; // picks are keyed by uid, but trust the field first
      if (!uid || amount <= 0) return;
      pending.push({ ref: d.ref, uid, amount });
    });

    if (dryRun) {
      return {
        dryRun: true,
        scanned,
        alreadySettled,
        wouldRefund: pending.length,
        wouldReturnCoins: pending.reduce((t, x) => t + x.amount, 0),
      };
    }

    for (let i = 0; i < pending.length; i += PAGE) {
      const chunk = pending.slice(i, i + PAGE);
      await Promise.all(chunk.map(async (item) => {
        try {
          await db.runTransaction(async (tx) => {
            // Re-read inside the transaction: this is what makes a second run
            // safe, and what stops a concurrent run paying the same stake back
            // twice.
            const fresh = await tx.get(item.ref);
            if (!fresh.exists || fresh.data().settledAt) return;

            tx.set(db.collection('wallets').doc(item.uid), {
              balance: FieldValue.increment(item.amount),
              updatedAt: FieldValue.serverTimestamp(),
            }, { merge: true });

            tx.update(item.ref, {
              settledAt: FieldValue.serverTimestamp(),
              payout: item.amount,
              outcome: 'refunded',
              refundReason: 'predictions_retired',
            });

            tx.set(db.collection('transactions').doc(), {
              userId: item.uid,
              type: 'refund',
              amount: item.amount,
              description: 'Refund: predictions have been retired',
              createdAt: FieldValue.serverTimestamp(),
            });

            tx.set(db.collection('notifications').doc(), {
              userId: item.uid,
              recipientId: item.uid,
              type: 'pick_refunded',
              title: `${item.amount.toLocaleString()} coins refunded`,
              body: 'Predictions have been retired. Your coins are back in your wallet.',
              read: false,
              createdAt: FieldValue.serverTimestamp(),
            });
          });
          refunded += 1;
          coins += item.amount;
        } catch (err) {
          failures.push({ path: item.ref.path, message: err.message });
        }
      }));
    }

    return {
      dryRun: false,
      scanned,
      alreadySettled,
      refunded,
      coinsReturned: coins,
      failures: failures.slice(0, 20),
      failureCount: failures.length,
      // The query is capped, so a full sweep may need more than one run.
      more: snap.size === limit,
    };
  },
);
