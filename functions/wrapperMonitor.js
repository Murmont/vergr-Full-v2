// functions/wrapperMonitor.js
// Pings each Tier B wrapper every 30 minutes and writes results to
// `wrapper_status/{wrapperId}`. When a wrapper transitions from healthy
// to unhealthy (or vice versa), we also append an entry to `wrapper_alerts`
// and create a notification for every admin user. The Super Admin
// dashboard subscribes to `wrapper_alerts` to surface live state.
//
// Failure threshold: a wrapper is flagged 'down' after 2 consecutive failed
// checks (~1 hour) so transient network blips don't spam admins.

const functions = require('firebase-functions/v2');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const admin = require('firebase-admin');

if (admin.apps.length === 0) admin.initializeApp();
const db = getFirestore('vgrdb');

const { listWrappers, getWrapper, collectSecrets } = require('./wrappers');
const WRAPPER_SECRETS = collectSecrets();

const FAILURE_THRESHOLD = 2; // consecutive failures before flagging 'down'

async function runHealthCheck(wrapper) {
  const start = Date.now();
  try {
    const res = await wrapper.healthCheck();
    return { ok: true, durationMs: Date.now() - start, info: res || null };
  } catch (err) {
    return { ok: false, durationMs: Date.now() - start, error: err?.message || String(err) };
  }
}

async function recordResult(wrapperId, result) {
  const ref = db.collection('wrapper_status').doc(wrapperId);
  const snap = await ref.get();
  const prev = snap.exists ? snap.data() : { consecutiveFailures: 0, status: 'unknown' };

  const consecutiveFailures = result.ok ? 0 : (prev.consecutiveFailures || 0) + 1;
  const newStatus = result.ok
    ? 'healthy'
    : (consecutiveFailures >= FAILURE_THRESHOLD ? 'down' : 'degraded');

  const payload = {
    wrapperId,
    status: newStatus,
    consecutiveFailures,
    lastCheckedAt: FieldValue.serverTimestamp(),
    lastDurationMs: result.durationMs,
    lastError: result.ok ? null : result.error,
  };
  await ref.set(payload, { merge: true });

  // Status transition? Emit an alert.
  if (prev.status !== newStatus && (newStatus === 'down' || (prev.status === 'down' && newStatus === 'healthy'))) {
    await emitAlert(wrapperId, prev.status, newStatus, result);
  }
  return payload;
}

async function emitAlert(wrapperId, fromStatus, toStatus, result) {
  const alertRef = db.collection('wrapper_alerts').doc();
  await alertRef.set({
    wrapperId,
    fromStatus,
    toStatus,
    error: result.ok ? null : result.error,
    createdAt: FieldValue.serverTimestamp(),
    acknowledged: false,
  });

  // Notify all admins so they can investigate. We don't FCM-blast users
  // here — wrapper outages are an internal concern.
  try {
    const adminsSnap = await db.collection('users').where('role', '==', 'admin').limit(50).get();
    const batch = db.batch();
    for (const u of adminsSnap.docs) {
      const nRef = db.collection('notifications').doc();
      batch.set(nRef, {
        recipientId: u.id,
        type: 'admin',
        title: toStatus === 'down' ? `Wrapper down: ${wrapperId}` : `Wrapper recovered: ${wrapperId}`,
        body: toStatus === 'down'
          ? `Auto-result detection for ${wrapperId} is failing health checks. Manual reporting is the fallback.`
          : `${wrapperId} is back online.`,
        read: false,
        data: { wrapperId, alertId: alertRef.id },
        createdAt: FieldValue.serverTimestamp(),
      });
    }
    await batch.commit();
  } catch (err) {
    console.error('Wrapper alert notify failed', err?.message || err);
  }
}

// ─── Scheduled health check (every 30 min) ────────────────────────────
// Cloud Scheduler on Spark plan: scheduled functions are free under the
// quota cap. 30 min ≈ 48/day = well within free tier.
exports.wrapperHealthCheck = functions.scheduler.onSchedule(
  { schedule: 'every 30 minutes', region: 'europe-west1', timeZone: 'UTC', secrets: WRAPPER_SECRETS },
  async () => {
    const wrappers = listWrappers();
    for (const w of wrappers) {
      const result = await runHealthCheck(w);
      await recordResult(w.id, result);
      console.log(`wrapper:${w.id} ${result.ok ? 'OK' : 'FAIL'} (${result.durationMs}ms)`);
    }
  }
);

// ─── Admin: trigger an immediate check ────────────────────────────────
// Useful for the Super Admin dashboard "refresh now" button.
exports.runWrapperHealthCheckNow = functions.https.onCall({ secrets: WRAPPER_SECRETS }, async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new functions.https.HttpsError('unauthenticated', 'Must be logged in');
  const userSnap = await db.collection('users').doc(uid).get();
  if (!userSnap.exists || userSnap.data()?.role !== 'admin') {
    throw new functions.https.HttpsError('permission-denied', 'Admin only');
  }
  const { wrapperId } = request.data || {};
  const targets = wrapperId ? [getWrapper(wrapperId)].filter(Boolean) : listWrappers();
  const results = [];
  for (const w of targets) {
    const result = await runHealthCheck(w);
    const payload = await recordResult(w.id, result);
    results.push({ wrapperId: w.id, ...payload });
  }
  return { results };
});
