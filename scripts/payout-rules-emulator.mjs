// Firestore RULES test for creator payouts: kyc_upgrades (Level 2/3 requests)
// and users/{uid}/private/kyc (Didit-verified name + country).
//
// NOT in npm run check: it needs the Firestore emulator running.
//   start: java -jar "%USERPROFILE%/.cache/firebase/emulators/cloud-firestore-emulator-v1.19.8.jar" --host=127.0.0.1 --port=8089
//   then:  node scripts/payout-rules-emulator.mjs [port]
//   stop the emulator BY PID afterwards; never kill every java.exe.
//
// ⚠ Emulator v1.19.8 does NOT enforce rules on a NAMED database (every request
// against vgrdb succeeds, a stranger's read included). Rules are probed on
// (default), and the stranger-read checks are the control that proves the
// rules are actually being applied.
import { readFileSync } from 'node:fs';

const port = process.argv[2] || '8089';
const P = 'vergr-rules-test';
const base = `http://127.0.0.1:${port}`;
const root = `projects/${P}/databases/(default)/documents`;

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const now = Math.floor(Date.now() / 1000);
const tok = (uid) => `${b64({ alg: 'none', typ: 'JWT' })}.${b64({
  sub: uid, user_id: uid, iss: `https://securetoken.google.com/${P}`, aud: P,
  auth_time: now, iat: now, exp: now + 3600, firebase: { sign_in_provider: 'password', identities: {} },
})}.`;

const val = (v) => {
  if (typeof v === 'string') return { stringValue: v };
  if (typeof v === 'number') return { integerValue: String(v) };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(val) } };
  return { mapValue: { fields: Object.fromEntries(Object.entries(v).map(([k, x]) => [k, val(x)])) } };
};
const fields = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, val(v)]));

/** One write, with submittedAt as the server's request time, as the app sends it. */
async function write(token, path, data, { stamp = true } = {}) {
  const w = { update: { name: `${root}/${path}`, fields: fields(data) } };
  if (stamp) w.updateTransforms = [{ fieldPath: 'submittedAt', setToServerValue: 'REQUEST_TIME' }];
  const r = await fetch(`${base}/v1/projects/${P}/databases/(default)/documents:commit`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ writes: [w] }),
  });
  return r.status;
}
const read = async (token, path) => (await fetch(`${base}/v1/${root}/${path}`, { headers: { Authorization: `Bearer ${token}` } })).status;

const put = await fetch(`${base}/emulator/v1/projects/${P}:securityRules`, {
  method: 'PUT', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ rules: { files: [{ name: 'firestore.rules', content: readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8') }] } }),
});
if (put.status !== 200) { console.error('rules load failed', put.status, await put.text()); process.exit(2); }
await fetch(`${base}/emulator/v1/projects/${P}/databases/(default)/documents`, { method: 'DELETE' });

let total = 0; const fails = [];
const check = (c, l) => { total++; if (!c) fails.push(l); };
const ok = (s) => s === 200;
const denied = (s) => s === 403;

const file = (uid) => ({ path: `upgrade-docs/${uid}/1-0.pdf`, contentType: 'application/pdf' });
const req = (uid, over = {}) => ({ uid, targetLevel: 2, docType: 'utility_bill', status: 'pending', files: [file(uid)], ...over });

// kyc_upgrades
check(ok(await write(tok('alice'), 'kyc_upgrades/alice', req('alice'))), 'CONTROL: owner files a pending Level 2 request');
check(denied(await write(tok('alice'), 'kyc_upgrades/alice', req('alice', { docType: 'bank_statement' }))), 'owner cannot swap a request under review');
check(ok(await read(tok('alice'), 'kyc_upgrades/alice')), 'owner can read their request');
check(denied(await read(tok('mallory'), 'kyc_upgrades/alice')), 'CONTROL: a stranger cannot read it (rules are enforced)');
check(denied(await write(tok('mallory'), 'kyc_upgrades/alice', req('alice'))), 'a stranger cannot file for someone else');

await write('owner', 'kyc_upgrades/alice', req('alice', { status: 'rejected' }), { stamp: false });
check(ok(await write(tok('alice'), 'kyc_upgrades/alice', req('alice', { docType: 'bank_statement' }))), 'after a rejection the owner can resubmit');

check(denied(await write(tok('bob'), 'kyc_upgrades/bob', req('bob', { status: 'approved' }))), 'owner cannot file an approved request');
check(denied(await write(tok('bob'), 'kyc_upgrades/bob', req('bob', { reviewedBy: 'bob' }))), 'owner cannot write a decision field');
check(denied(await write(tok('bob'), 'kyc_upgrades/bob', req('bob', { targetLevel: 1 }))), 'Level 1 cannot be requested by upload');
check(denied(await write(tok('bob'), 'kyc_upgrades/bob', req('bob', { files: [file('bob'), file('bob'), file('bob'), file('bob')] }))), 'more than 3 files refused');
check(denied(await write(tok('bob'), 'kyc_upgrades/bob', req('bob'), { stamp: false })), 'submittedAt must be the server time');

// private/kyc
await write('owner', 'users/carol/private/kyc', { legalName: 'Carol Real', country: 'ZA' }, { stamp: false });
check(denied(await write(tok('carol'), 'users/carol/private/kyc', { legalName: 'Whoever My Bank Says', country: 'ZA' }, { stamp: false })), 'owner cannot overwrite their verified name');
check(ok(await read(tok('carol'), 'users/carol/private/kyc')), 'owner can still read their verified record');
check(ok(await write(tok('carol'), 'users/carol/private/contact', { phone: '1' }, { stamp: false })), 'CONTROL: owner can still write other private docs');
check(denied(await read(tok('mallory'), 'users/carol/private/kyc')), 'CONTROL: a stranger cannot read it');

if (fails.length) { fails.forEach((f) => console.error('FAIL', f)); console.error(`payout rules: ${fails.length} of ${total} failed`); process.exit(1); }
console.log(`payout rules: ${total} assertions green`);
