// Scheduled posts and polls are Lite/Pro only, enforced by firestore.rules.
// Reads the REAL rules file. Run: npx firebase emulators:exec --only firestore
//   --project vergr-rules-test "node scheduled.mjs"   (from tests/rules)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import { doc, setDoc, updateDoc } from 'firebase/firestore';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RULES = path.resolve(HERE, '../../firestore.rules');
const FREE = 'uid_free', LITE = 'uid_lite', PRO = 'uid_pro', LEGACY = 'uid_legacy';

let pass = 0, fail = 0;
async function check(name, fn) {
  try { await fn(); console.log('PASS', name); pass++; }
  catch (e) { console.log('FAIL', name, e.message); fail++; }
}

const env = await initializeTestEnvironment({
  projectId: 'vergr-rules-test',
  firestore: { rules: fs.readFileSync(RULES, 'utf8'), host: '127.0.0.1', port: 8080 },
});
await env.clearFirestore();
await env.withSecurityRulesDisabled(async (ctx) => {
  const d = ctx.firestore();
  await setDoc(doc(d, 'users', FREE), { username: 'free', subscription: 'free' });
  await setDoc(doc(d, 'users', LITE), { username: 'lite', subscription: 'lite' });
  await setDoc(doc(d, 'users', PRO), { username: 'pro', subscription: 'pro' });
  await setDoc(doc(d, 'users', LEGACY), { username: 'legacy', subscription: { tier: 'pro' } });
  await setDoc(doc(d, 'posts', 'free_live'), { authorId: FREE, content: 'hi', status: 'published' });
  await setDoc(doc(d, 'posts', 'lite_sched'), { authorId: LITE, content: 'hi', status: 'scheduled', scheduledFor: 2000 });
  await setDoc(doc(d, 'posts', 'free_lapsed'), { authorId: FREE, content: 'hi', status: 'scheduled', scheduledFor: 2000 });
});

const db = (uid) => env.authenticatedContext(uid, { email_verified: true }).firestore();
const sched = { content: 'later', status: 'scheduled', scheduledFor: 9999999999999 };

// Controls: ordinary posting is untouched for everyone.
await check('control: free user posts normally', () =>
  assertSucceeds(setDoc(doc(db(FREE), 'posts', 'p1'), { authorId: FREE, content: 'now', status: 'published' })));
await check('control: free user creates a poll normally', () =>
  assertSucceeds(setDoc(doc(db(FREE), 'polls', 'q1'), { createdBy: FREE, question: 'x', status: 'active' })));
await check('control: free user edits own live post', () =>
  assertSucceeds(updateDoc(doc(db(FREE), 'posts', 'free_live'), { content: 'edited' })));

// The hole, closed.
await check('free user cannot create a scheduled post', () =>
  assertFails(setDoc(doc(db(FREE), 'posts', 'p2'), { authorId: FREE, ...sched })));
await check('free user cannot create a scheduled poll', () =>
  assertFails(setDoc(doc(db(FREE), 'polls', 'q2'), { createdBy: FREE, question: 'x', ...sched })));
await check('free user cannot turn a live post into a scheduled one', () =>
  assertFails(updateDoc(doc(db(FREE), 'posts', 'free_live'), { status: 'scheduled', scheduledFor: 9999999999999 })));
await check('lapsed user cannot move an old scheduled time', () =>
  assertFails(updateDoc(doc(db(FREE), 'posts', 'free_lapsed'), { scheduledFor: 9999999999999 })));
await check('lapsed user can still edit the text of an old scheduled post', () =>
  assertSucceeds(updateDoc(doc(db(FREE), 'posts', 'free_lapsed'), { content: 'fixed typo' })));

// Paid plans keep the feature.
await check('lite user creates a scheduled post', () =>
  assertSucceeds(setDoc(doc(db(LITE), 'posts', 'p3'), { authorId: LITE, ...sched })));
await check('pro user creates a scheduled poll', () =>
  assertSucceeds(setDoc(doc(db(PRO), 'polls', 'q3'), { createdBy: PRO, question: 'x', ...sched })));
await check('lite user reschedules own post', () =>
  assertSucceeds(updateDoc(doc(db(LITE), 'posts', 'lite_sched'), { scheduledFor: 8888888888888 })));
await check('legacy nested plan shape counts as pro', () =>
  assertSucceeds(setDoc(doc(db(LEGACY), 'posts', 'p4'), { authorId: LEGACY, ...sched })));

await env.cleanup();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
