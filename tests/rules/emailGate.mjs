// Required email verification: an unverified account may browse, like, follow
// and edit its profile, but may not post, comment, create a poll, story or
// status, or send a DM or squad message. Reads the REAL rules file.
// Run (from tests/rules): npx firebase emulators:exec --only firestore
//   --project vergr-rules-test "node emailGate.mjs"
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import { doc, setDoc, updateDoc } from 'firebase/firestore';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RULES = path.resolve(HERE, '../../firestore.rules');
const V = 'verifiedUser', U = 'unverifiedUser';

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
  await setDoc(doc(d, 'users', V), { username: 'v' });
  await setDoc(doc(d, 'users', U), { username: 'u' });
  await setDoc(doc(d, 'posts', 'p1'), { authorId: V, content: 'hello', status: 'published' });
  await setDoc(doc(d, 'conversations', 'c1'), { participants: [V, U] });
  await setDoc(doc(d, 'squads', 's1'), { name: 'sq' });
  await setDoc(doc(d, 'squads', 's1', 'members', V), { role: 'member' });
  await setDoc(doc(d, 'squads', 's1', 'members', U), { role: 'member' });
});

const as = (uid, verified) => env.authenticatedContext(uid, {
  email_verified: verified, firebase: { sign_in_provider: 'password' },
}).firestore();
const v = as(V, true);
const u = as(U, false);

const post = (uid, id) => ({ authorId: uid, content: 'hi', status: 'published', id });
const cases = [
  ['post', (db, uid, n) => setDoc(doc(db, 'posts', `post_${uid}_${n}`), post(uid, n))],
  ['comment', (db, uid, n) => setDoc(doc(db, 'posts', 'p1', 'comments', `c_${uid}_${n}`), { authorId: uid, content: 'nice' })],
  ['poll', (db, uid, n) => setDoc(doc(db, 'polls', `poll_${uid}_${n}`), { createdBy: uid, question: 'q?', status: 'active' })],
  ['story', (db, uid, n) => setDoc(doc(db, 'stories', `st_${uid}_${n}`), { authorId: uid })],
  ['status', (db, uid, n) => setDoc(doc(db, 'statuses', `ss_${uid}_${n}`), { authorId: uid })],
  ['DM message', (db, uid, n) => setDoc(doc(db, 'conversations', 'c1', 'messages', `m_${uid}_${n}`), { senderId: uid, text: 'yo' })],
  ['squad message', (db, uid, n) => setDoc(doc(db, 'squads', 's1', 'messages', `sm_${uid}_${n}`), { senderId: uid, text: 'yo' })],
];

let n = 0;
for (const [label, write] of cases) {
  await check(`control: verified account can create a ${label}`, () => assertSucceeds(write(v, V, ++n)));
  await check(`unverified account cannot create a ${label}`, () => assertFails(write(u, U, ++n)));
}

// An unverified account is still a member of the app: these must keep working.
await check('unverified account can like a post', () => assertSucceeds(setDoc(doc(u, 'posts', 'p1', 'likes', U), { at: 1 })));
await check('unverified account can edit its own profile', () => assertSucceeds(updateDoc(doc(u, 'users', U), { bio: 'hi' })));
// And a token that says nothing at all about the email is treated as unverified.
const bare = env.authenticatedContext('bareUser', { firebase: { sign_in_provider: 'password' } }).firestore();
await check('token with no email_verified claim cannot post', () => assertFails(setDoc(doc(bare, 'posts', 'bare1'), post('bareUser', 'b'))));

console.log(`\n${pass} passed, ${fail} failed`);
await env.cleanup();
process.exit(fail ? 1 : 0);
