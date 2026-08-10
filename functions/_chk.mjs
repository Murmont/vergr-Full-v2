import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import fs from 'fs';
const key = JSON.parse(fs.readFileSync('C:/Users/damie/Downloads/vergr-44494-firebase-adminsdk-fbsvc-a8600cfe54.json','utf8'));
initializeApp({ credential: cert(key) });
const db = getFirestore('vgrdb');
const snap = await db.collection('users').where('username','==','Verion').limit(3).get();
if (snap.empty) {
  const s2 = await db.collection('users').where('username','==','verion').limit(3).get();
  s2.forEach(d=>console.log('lower', d.id, d.data().username));
}
for (const d of snap.docs) {
  console.log('uid', d.id, d.data().username, 'sub:', JSON.stringify(d.data().subscription), 'role:', d.data().role);
  const w = await db.collection('wallets').doc(d.id).get();
  console.log('  wallet doc exists:', w.exists, w.exists ? JSON.stringify({onboardingCompleted:w.data().onboardingCompleted, totpEnrolled:w.data().totpEnrolled, balance:w.data().balance}) : '');
  const c = await db.collection('wallets').doc(d.id).collection('security').doc('credentials').get();
  console.log('  credentials exists:', c.exists, c.exists ? 'pinHash:'+!!c.data().pinHash : '');
}
process.exit(0);
