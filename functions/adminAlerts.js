// Real-time admin alert pipeline.
//
// Spec: CLAUDE.md → "🚨 Security hardening" → Tier 1, item 3:
//   "Real-time push + email alert on every privileged action. Operator
//    gets instant push + email when role:'admin' fires any sensitive
//    callable. 'Overseer rank granted to @x at 03:42 UTC from IP 1.2.3.4.'
//    Founder becomes the IDS."
//
// Wiring: Firestore trigger on admin_actions/{id} create → fans out a
// push notification + writes a high-priority notifications/{id} doc to
// EVERY admin user (including the actor — they want to know if their own
// session fires something while they're afk, classic compromise tell).
//
// Email is intentionally deferred — no email provider is wired into the
// platform yet (see CLAUDE.md "Email Send Helper" audit: NONE FOUND).
// Once a provider is added, drop in a call to it here.

const functions = require('firebase-functions/v2');
const admin = require('firebase-admin');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');

const db = getFirestore('vgrdb');
const REGION = 'europe-west1';

// Actions where alerting is wasteful spam (high-frequency, low risk).
// Failed TOTP verify is alerted IF the count crosses a threshold — handled
// by a separate cron, not the per-row trigger.
const SUPPRESS_PER_ROW_ALERT = new Set([
  'totp_verify_failed',
  'totp_enroll',         // user themselves did this; their UI confirms
  'totp_disable',        // same
]);

// Human-readable copy for the alert. Keep punchy — push notifications
// truncate at ~100 chars on most devices.
function alertCopyFor(actionRow) {
  const { action, actor, target, ip } = actionRow;
  const ipTail = ip ? ` from ${ip}` : '';
  const tgt = target?.id ? ` on ${target.type || 'target'}:${String(target.id).slice(0, 12)}` : '';
  // Pretty-cased action name
  const pretty = String(action || 'unknown').replace(/_/g, ' ');
  const body = `Admin action: ${pretty}${tgt}${ipTail}`;
  return { title: `🛡️ ${pretty}`, body };
}

async function sendPushToAdminUser(userId, title, body, data) {
  try {
    const fcmDoc = await db.collection('users').doc(userId).collection('private').doc('fcm').get();
    if (!fcmDoc.exists) return;
    const tokens = fcmDoc.data()?.tokens || [];
    if (tokens.length === 0) return;
    // Admin alerts ignore the user's normal push-notifications opt-out —
    // these are security-critical. Founder can revoke FCM tokens entirely
    // if they need a quiet phone.
    const payload = { ...data, title, body };
    const response = await admin.messaging().sendEachForMulticast({
      tokens,
      data: Object.fromEntries(Object.entries(payload).map(([k, v]) => [k, String(v ?? '')])),
    });
    const invalid = [];
    response.responses.forEach((r, i) => {
      if (!r.success && (
        r.error?.code === 'messaging/invalid-registration-token' ||
        r.error?.code === 'messaging/registration-token-not-registered'
      )) invalid.push(tokens[i]);
    });
    if (invalid.length > 0) {
      await db.collection('users').doc(userId).collection('private').doc('fcm').update({
        tokens: admin.firestore.FieldValue.arrayRemove(...invalid),
      });
    }
  } catch (_) { /* swallow — alerting must never fail the trigger */ }
}

exports.onAdminActionCreated = functions.firestore.onDocumentCreated(
  { region: REGION, document: 'admin_actions/{actionId}', database: 'vgrdb' },
  async (event) => {
    const snap = event.data;
    if (!snap) return;
    const row = { id: snap.id, ...snap.data() };

    if (SUPPRESS_PER_ROW_ALERT.has(row.action)) return;

    // Find every admin user.
    const adminsSnap = await db.collection('users').where('role', '==', 'admin').get();
    const adminIds = adminsSnap.docs.map(d => d.id);
    if (adminIds.length === 0) return;

    const { title, body } = alertCopyFor(row);
    const data = {
      type: 'admin_action_alert',
      actionRowId: row.id,
      action: row.action,
      actorId: row.actor || '',
      ip: row.ip || '',
    };

    // Write a notification doc to each admin's inbox + fire push in parallel.
    await Promise.allSettled(adminIds.map(async (uid) => {
      const notif = db.collection('notifications').doc();
      await notif.set({
        recipientId: uid,
        type: 'admin_action_alert',
        title,
        body,
        data: {
          actionRowId: row.id,
          action: row.action,
          actorId: row.actor || null,
          target: row.target || null,
          ip: row.ip || null,
          userAgent: row.userAgent || null,
          stepUpEnforced: !!row.stepUpEnforced,
          stepUpFresh: !!row.stepUpFresh,
        },
        priority: 'critical',
        read: false,
        createdAt: FieldValue.serverTimestamp(),
      });
      await sendPushToAdminUser(uid, title, body, data);
    }));
  }
);

// ────────────────────────────────────────────────────────────────────
// Brute-force monitor — runs every 15 min. If a single admin actor has
// >= 5 totp_verify_failed entries in the last 30 min, fires a
// SECURITY ALERT push to every admin (so the founder sees it even if
// their own account is being targeted from a different device).
// ────────────────────────────────────────────────────────────────────

const defer = (_opts, fn) => fn; // cron-consolidation shim (see index.js cron15Min)
exports.adminTotpBruteForceMonitor = defer(
  { region: REGION, schedule: 'every 15 minutes' },
  async () => {
    const since = new Date(Date.now() - 30 * 60 * 1000);
    const recent = await db.collection('admin_actions')
      .where('action', '==', 'totp_verify_failed')
      .where('createdAt', '>=', since)
      .get();
    if (recent.empty) return null;

    const byActor = new Map();
    recent.forEach(d => {
      const a = d.data().actor || 'unknown';
      byActor.set(a, (byActor.get(a) || 0) + 1);
    });

    const adminsSnap = await db.collection('users').where('role', '==', 'admin').get();
    const adminIds = adminsSnap.docs.map(d => d.id);

    for (const [actor, count] of byActor) {
      if (count < 5) continue;
      // Avoid duplicate alerts: only alert if no alert row in last 30 min
      // for this actor.
      const alreadyAlerted = await db.collection('admin_actions')
        .where('action', '==', 'totp_brute_force_alert')
        .where('target.id', '==', actor)
        .where('createdAt', '>=', since)
        .limit(1).get();
      if (!alreadyAlerted.empty) continue;

      await db.collection('admin_actions').doc().set({
        actor: 'system',
        action: 'totp_brute_force_alert',
        target: { type: 'admin_uid', id: actor },
        meta: { failedAttempts: count, windowMinutes: 30 },
        createdAt: FieldValue.serverTimestamp(),
      });

      const title = '🚨 TOTP brute-force detected';
      const body  = `${count} failed verify attempts on admin ${actor.slice(0, 8)} in 30 min`;
      const data = { type: 'admin_security_alert', targetActorId: actor, count: String(count) };
      await Promise.allSettled(adminIds.map(uid => sendPushToAdminUser(uid, title, body, data)));
    }
    return null;
  }
);
