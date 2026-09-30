// payment_attempts: a buyer may create a record of their OWN failed attempt,
// with fixed fields, and nothing else. Reads the REAL rules file.
// Run (from tests/rules): npx firebase emulators:exec --only firestore
//   --project vergr-rules-test "node paymentAttempts.mjs"
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import { doc, setDoc, getDoc, updateDoc, serverTimestamp } from 'firebase/firestore';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RULES = path.resolve(HERE, '../../firestore.rules');
const A = 'buyerA', B = 'buyerB';

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
  await setDoc(doc(ctx.firestore(), 'payment_attempts', 'google_play_server1'), { uid: A, status: 'failed', needsAttention: true });
});

const as = (uid, provider = 'password') => env.authenticatedContext(uid, { firebase: { sign_in_provider: provider } }).firestore();
const good = (uid, id, over = {}) => ({
  attemptId: id, source: 'client', route: 'google_play', uid, productId: 'coins_starter',
  status: 'cancelled', stage: 'sheet', needsAttention: false,
  lastError: { code: 'cancelled', message: 'Purchase cancelled.', provider: 'google', providerCode: 'USER_CANCELED' },
  events: [{ at: 1, source: 'client', type: 'sheet_cancelled', status: 'cancelled' }],
  appVersion: '1.0.219', platform: 'play', createdAt: serverTimestamp(), lastEventAt: serverTimestamp(), ...over,
});
const id = (uid) => `client_${uid}_${Date.now()}`;

// Control: the allowed write works.
await check('control: buyer records own cancelled attempt', () => { const i = id(A); return assertSucceeds(setDoc(doc(as(A), 'payment_attempts', i), good(A, i))); });
await check('control: failed and pending also allowed', async () => {
  const i1 = id(A) + '1'; const i2 = id(A) + '2';
  await assertSucceeds(setDoc(doc(as(A), 'payment_attempts', i1.slice(0, -1) + '7'), good(A, i1.slice(0, -1) + '7', { status: 'failed' })));
  await assertSucceeds(setDoc(doc(as(A), 'payment_attempts', i2.slice(0, -1) + '8'), good(A, i2.slice(0, -1) + '8', { status: 'pending' })));
});

// Everything else refused.
await check('guest (anonymous) cannot write', () => { const i = id(A); return assertFails(setDoc(doc(as(A, 'anonymous'), 'payment_attempts', i), good(A, i))); });
await check('cannot write for another user', () => { const i = id(B); return assertFails(setDoc(doc(as(A), 'payment_attempts', i), good(B, i))); });
await check('cannot use a non-client id', () => assertFails(setDoc(doc(as(A), 'payment_attempts', 'google_play_x'), good(A, 'google_play_x'))));
await check('cannot flag needsAttention', () => { const i = id(A); return assertFails(setDoc(doc(as(A), 'payment_attempts', i), good(A, i, { needsAttention: true }))); });
await check('cannot claim credited', () => { const i = id(A); return assertFails(setDoc(doc(as(A), 'payment_attempts', i), good(A, i, { status: 'credited' }))); });
await check('cannot claim server source', () => { const i = id(A); return assertFails(setDoc(doc(as(A), 'payment_attempts', i), good(A, i, { source: 'server' }))); });
await check('cannot add extra fields (e.g. coins)', () => { const i = id(A); return assertFails(setDoc(doc(as(A), 'payment_attempts', i), good(A, i, { coins: 99999 }))); });
await check('cannot backdate', () => { const i = id(A); return assertFails(setDoc(doc(as(A), 'payment_attempts', i), good(A, i, { createdAt: new Date(0) }))); });
await check('cannot read any record', () => assertFails(getDoc(doc(as(A), 'payment_attempts', 'google_play_server1'))));
await check('cannot change a server record', () => assertFails(updateDoc(doc(as(A), 'payment_attempts', 'google_play_server1'), { needsAttention: false })));
await check('cannot overwrite own record', async () => {
  const i = id(A).slice(0, -1) + '9';
  await setDoc(doc(as(A), 'payment_attempts', i), good(A, i));
  await assertFails(setDoc(doc(as(A), 'payment_attempts', i), good(A, i, { status: 'failed' })));
});

// The ban fields on users are server-only.
await env.withSecurityRulesDisabled(async (ctx) => setDoc(doc(ctx.firestore(), 'users', A), { username: 'a', purchaseBanUntil: 9999999999999 }));
await check('buyer cannot lift own purchase ban', () => assertFails(updateDoc(doc(as(A), 'users', A), { purchaseBanUntil: 0 })));
await check('control: buyer can still edit own bio', () => assertSucceeds(updateDoc(doc(as(A), 'users', A), { bio: 'hi' })));

console.log(`\n${pass} passed, ${fail} failed`);
await env.cleanup();
process.exit(fail ? 1 : 0);
