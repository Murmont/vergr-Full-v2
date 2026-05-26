// One-off: write a test notification to the founder/admin so we can confirm
// the in-app drawer + the onNotificationCreated FCM push both fire.
//
// Run from functions/ with GOOGLE_APPLICATION_CREDENTIALS pointing at a
// service-account JSON:
//   GOOGLE_APPLICATION_CREDENTIALS=/path/key.json node scripts/testNotification.js [uid]
//
// If no uid is passed, it targets the first users doc with role=='admin'.

const admin = require('firebase-admin');
if (admin.apps.length === 0) admin.initializeApp();
const db = admin.firestore(undefined, 'vgrdb');

(async () => {
  let uid = process.argv[2];
  if (!uid) {
    const snap = await db.collection('users').where('role', '==', 'admin').limit(1).get();
    if (snap.empty) { console.error('No admin user found and no uid passed.'); process.exit(1); }
    uid = snap.docs[0].id;
    console.log('Targeting admin uid:', uid, '(', snap.docs[0].data().displayName || '?', ')');
  }
  const ref = await db.collection('notifications').add({
    recipientId: uid,
    type: 'admin_test_notification',
    title: 'VERGR push test',
    body: `Test notification at ${new Date().toISOString()} — if you see this as a system push, the pipeline works.`,
    data: { test: true },
    actionUrl: '/notifications',
    read: false,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  console.log('Wrote notification doc:', ref.id);
  console.log('Check: (1) in-app notifications drawer, (2) system/FCM push on a device with a registered token.');
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
