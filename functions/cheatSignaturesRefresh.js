// AC7 — cheat-signatures refresh cadence.
//
// The signature DB is seeded once (adminSeedCheatSignatures, ~40 entries) and
// then goes stale. This monthly cron is the CADENCE: it computes the age of the
// newest signature, publishes a health doc the admin screen reads for a
// staleness banner, and pushes the founder/admins a reminder to review +
// re-seed when the DB is >90 days old (or empty).
//
// NOTE: a fully-automated import from a public BYOVD/cheat-tool feed (e.g.
// loldrivers.io) is deliberately NOT wired here — an external feed format
// change would silently flood `pending` docs and is a supply-chain surface.
// The reliable, zero-cost, zero-dependency core is this staleness nudge; an
// opt-in auto-import can be added later behind an explicit config flag.

const { onSchedule } = require('firebase-functions/v2/scheduler');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');

const REGION = 'europe-west1';
const db = getFirestore('vgrdb');

const STALE_AFTER_MS = 90 * 24 * 60 * 60 * 1000; // 90 days

function tsMs(t) {
  if (!t) return 0;
  if (typeof t.toMillis === 'function') return t.toMillis();
  if (typeof t._seconds === 'number') return t._seconds * 1000;
  return 0;
}

exports.cheatSignaturesHealthCron = onSchedule(
  { region: REGION, schedule: '0 6 1 * *', timeZone: 'UTC' },
  async () => {
    const snap = await db.collection('cheat_signatures').get();
    const count = snap.size;
    const activeCount = snap.docs.filter((d) => d.data().active !== false).length;
    let newestMs = 0;
    snap.forEach((d) => {
      const m = Math.max(tsMs(d.data().updatedAt), tsMs(d.data().createdAt));
      if (m > newestMs) newestMs = m;
    });

    const now = Date.now();
    const ageDays = newestMs ? Math.floor((now - newestMs) / (24 * 60 * 60 * 1000)) : null;
    const stale = count === 0 || (newestMs > 0 && now - newestMs > STALE_AFTER_MS);

    await db.collection('app_config').doc('cheat_signatures_health').set({
      count, activeCount,
      newestUpdatedAtMs: newestMs || null,
      ageDays, stale,
      checkedAt: FieldValue.serverTimestamp(),
    }, { merge: true });

    if (!stale) return;

    // Push every admin a reminder. De-dupe within the current month via a
    // marker doc so a re-run in the same month doesn't double-notify.
    const monthKey = new Date().toISOString().slice(0, 7); // YYYY-MM
    const markerRef = db.collection('cheat_signatures_alerts').doc(monthKey);
    if ((await markerRef.get()).exists) return;

    const admins = await db.collection('users').where('role', '==', 'admin').limit(50).get();
    if (admins.empty) { await markerRef.set({ notified: false, at: FieldValue.serverTimestamp() }); return; }

    const batch = db.batch();
    const body = count === 0
      ? 'The cheat-signature database is empty. Seed it from /admin/cheat-signatures.'
      : `Cheat signatures last updated ${ageDays} days ago. Review + refresh from /admin/cheat-signatures.`;
    admins.forEach((a) => {
      batch.set(db.collection('notifications').doc(), {
        recipientId: a.id,
        type: 'cheat_signatures_stale',
        title: 'Cheat signatures need a refresh',
        body,
        data: { count, ageDays: ageDays ?? -1 },
        actionUrl: '/admin/cheat-signatures',
        read: false, createdAt: FieldValue.serverTimestamp(),
      });
    });
    batch.set(markerRef, { notified: true, count, ageDays: ageDays ?? -1, at: FieldValue.serverTimestamp() });
    await batch.commit();
  },
);
