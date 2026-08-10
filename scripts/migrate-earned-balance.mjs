// One-time backfill of wallet.earnedBalance for wallets that predate the
// purchased/earned coin split (functions/coinLedger.js).
//
// WHY A BACKFILL IS NEEDED
// earnedBalance is written going forward by the earned credit sites, but every
// wallet created before the split has no such field, which reads as 0 and would
// mean nobody can convert anything until they next receive value.
//
// WHAT THE LIVE DATA SAID (inspected 2026-07-29, before writing this)
//   29 wallets, 3 with any balance, 94 coins in circulation TOTAL.
//   Exactly ONE 'purchase' credit has ever happened: 100 coins, the founder's
//   own test of the payment rail. No user has ever bought coins.
//
// Because of that, the default mode is GRANDFATHER: existing balances are
// marked fully convertible. There is no real purchased money in circulation to
// protect, the total exposure is under one euro, and zeroing test users'
// balances would be a pointless regression. Every coin credited from now on is
// classified exactly by coinLedger.js, which is what actually matters for Play.
//
// --derive is kept for the case where this ever needs to run against a live
// economy: it rebuilds each wallet's earned total from the `transactions`
// ledger instead, as
//     earnedBalance = min(sum(earned credits) - sum(coins already converted), balance)
// Unknown transaction types are reported and treated as NOT earned, which is
// the safe direction to be wrong in.
//
// AUTH: uses the firebase CLI's stored refresh token (the documented pattern for
// local scripts in this repo) so it needs no service-account key on disk.
//
// USAGE (dry run is the default and writes nothing):
//   node scripts/migrate-earned-balance.mjs
//   node scripts/migrate-earned-balance.mjs --apply
//   node scripts/migrate-earned-balance.mjs --derive [--apply]

import { readFileSync } from 'node:fs';

const APPLY = process.argv.includes('--apply');
const DERIVE = process.argv.includes('--derive');

const PROJECT = 'vergr-44494';
const DATABASE = 'vgrdb';
const BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/${DATABASE}/documents`;

// Received value: came from another user or from the platform as income.
// Verified against the live type histogram, not guessed.
const EARNED_TYPES = new Set([
  'tip_received', 'quest_reward', 'daily_reward', 'admin_grant', 'admin_reward',
  'tournament_prize', 'tournament_payout', 'event_ticket_sale', 'season_pass_sale',
  'membership_revenue', 'referral_revenue', 'admob_reward',
  'vanguard_stipend', 'treasury_distribution', 'vergrme_sale', 'prediction_payout',
]);

// Bought coins, and refunds of coins that may themselves have been bought.
const NOT_EARNED_TYPES = new Set([
  'purchase', 'coin_purchase', 'payram_purchase', 'circle_deposit',
  'play_billing_purchase',
  'refund', 'entry_fee_refund', 'boost_refund', 'pick_refunded',
]);

// ── auth ───────────────────────────────────────────────────────────────────
const CLI_CONFIG = 'C:/Users/damie/.config/configstore/firebase-tools.json';
const CLIENT_ID = '563584335869-fgrhgmd47bqnekij5i8b5pr03ho849e6.apps.googleusercontent.com';
const CLIENT_SECRET = 'j9iVZfS8kkCEFUPaAeJV0sAi';

async function accessToken() {
  const cfg = JSON.parse(readFileSync(CLI_CONFIG, 'utf8'));
  const refresh = cfg?.tokens?.refresh_token;
  if (!refresh) throw new Error('No firebase CLI refresh token. Run: firebase login');
  const r = await fetch('https://www.googleapis.com/oauth2/v4/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: CLIENT_ID, client_secret: CLIENT_SECRET,
      refresh_token: refresh, grant_type: 'refresh_token',
    }),
  });
  const j = await r.json();
  if (!j.access_token) throw new Error('Token exchange failed: ' + JSON.stringify(j).slice(0, 200));
  return j.access_token;
}

const AT = await accessToken();
const auth = { Authorization: `Bearer ${AT}`, 'Content-Type': 'application/json' };

async function runQuery(structuredQuery) {
  const r = await fetch(`${BASE}:runQuery`, {
    method: 'POST', headers: auth, body: JSON.stringify({ structuredQuery }),
  });
  const j = await r.json();
  if (!Array.isArray(j)) throw new Error('query failed: ' + JSON.stringify(j).slice(0, 300));
  return j.filter((row) => row.document).map((row) => row.document);
}

// Field-level patch so we only ever touch earnedBalance and never clobber a
// concurrent balance write.
async function setEarnedBalance(docName, value) {
  const r = await fetch(
    `https://firestore.googleapis.com/v1/${docName}?updateMask.fieldPaths=earnedBalance`,
    { method: 'PATCH', headers: auth, body: JSON.stringify({ fields: { earnedBalance: { integerValue: String(value) } } }) }
  );
  if (!r.ok) throw new Error(`patch failed for ${docName}: ${r.status} ${(await r.text()).slice(0, 200)}`);
}

const num = (f) => (f && 'integerValue' in f ? Number(f.integerValue)
  : f && 'doubleValue' in f ? Number(f.doubleValue) : undefined);
const str = (f) => (f && 'stringValue' in f ? f.stringValue : undefined);

// ── run ────────────────────────────────────────────────────────────────────
const wallets = await runQuery({ from: [{ collectionId: 'wallets' }], limit: 5000 });
console.log(`wallets: ${wallets.length}`);
console.log(`mode: ${DERIVE ? 'DERIVE from transactions' : 'GRANDFATHER existing balances'}`);
console.log(`write: ${APPLY ? 'APPLY' : 'DRY RUN (no writes)'}\n`);

let txByUser = new Map();
const unknownTypes = new Map();
if (DERIVE) {
  const txs = await runQuery({ from: [{ collectionId: 'transactions' }], limit: 10000 });
  for (const t of txs) {
    const uid = str(t.fields?.userId);
    if (!uid) continue;
    (txByUser.get(uid) || txByUser.set(uid, []).get(uid)).push(t);
  }
}

const preview = [];
let planned = 0, skipped = 0;

for (const w of wallets) {
  const uid = w.name.split('/').pop();
  if (typeof num(w.fields?.earnedBalance) === 'number') { skipped++; continue; }

  const balance = Math.max(0, Math.floor(num(w.fields?.balance) || 0));
  let earnedBalance;

  if (!DERIVE) {
    earnedBalance = balance;
  } else {
    let earned = 0, converted = 0;
    for (const t of txByUser.get(uid) || []) {
      const type = str(t.fields?.type) || '';
      const amt = Math.floor(num(t.fields?.amount) || 0);
      if (type === 'coin_to_gem_conversion' && str(t.fields?.currency) === 'coins') { converted += Math.abs(amt); continue; }
      if (amt <= 0) continue;
      if (EARNED_TYPES.has(type)) { earned += amt; continue; }
      if (NOT_EARNED_TYPES.has(type)) continue;
      unknownTypes.set(type, (unknownTypes.get(type) || 0) + 1);
    }
    earnedBalance = Math.max(0, Math.min(earned - converted, balance));
  }

  planned++;
  if (balance > 0 && preview.length < 20) preview.push({ uid: uid.slice(0, 10), balance, earnedBalance });
  if (APPLY) await setEarnedBalance(w.name, earnedBalance);
}

if (preview.length) console.table(preview);
console.log(`\nplanned: ${planned}   already had the field: ${skipped}`);
if (unknownTypes.size) {
  console.log('\nUNKNOWN transaction types (treated as NOT earned — review before --apply):');
  for (const [t, n] of [...unknownTypes].sort((a, b) => b[1] - a[1])) console.log(`  ${t.padEnd(28)} ${n}`);
}
if (!APPLY) console.log('\nDry run only. Re-run with --apply to write.');
