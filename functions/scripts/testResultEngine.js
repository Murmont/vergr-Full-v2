// End-to-end test of the Phase 2 automated result engine against PRODUCTION
// infrastructure (vergr-ocr /frame endpoint + processAutoResults trigger +
// recordMatchResultInternal), using a synthetic free tournament + two test
// auth users. No real users or money touched; everything is cleaned up.
//
// Flow proven:
//   1. lobby-code frame (player A) → verifyState.A = verified (source ocr)
//   2. lobby-code frame (player B) → verified + bothVerifiedAt + in_progress
//   3. VICTORY frame (A) → autoResult.A=won → trigger → awaiting_confirmation
//      + confirmDeadlineMs + confirm notification to B
//   4. DEFEAT frame (B) → autoResult.B=lost → agreement → match COMPLETED,
//      winner A, tournament finalized.
//
// Run from functions/:
//   GOOGLE_APPLICATION_CREDENTIALS=key.json node scripts/testResultEngine.js

const fs = require('fs');
const path = require('path');
const admin = require('firebase-admin');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
if (admin.apps.length === 0) admin.initializeApp({ projectId: 'vergr-44494' });
const db = getFirestore('vgrdb');

const WEB_API_KEY = 'AIzaSyCuwlEMPFzhmXx_FqdWiYWlshuRT_EIkoI';
const FRAME_ENDPOINT = 'https://sfu.vergr.app/frame';
const FRAMES_DIR = process.env.FRAMES_DIR || 'C:/Users/damie/AppData/Local/Temp/engine-test';
const LOBBY_CODE = 'VERGR-TEST123';

const ts = Date.now();
const T_ID = `test_engine_${ts}`;
const M_ID = 'r1_m1'; // MUST match matchDocId() = `r${round}_m${matchNumber}`; advanceBracketAfterMatch's regex needs the underscore.
const UA = `test_engine_a_${ts}`;
const UB = `test_engine_b_${ts}`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function idTokenFor(uid) {
  const custom = await admin.auth().createCustomToken(uid);
  const res = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${WEB_API_KEY}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: custom, returnSecureToken: true }),
  });
  const out = await res.json();
  if (!out.idToken) throw new Error(`token exchange failed: ${JSON.stringify(out)}`);
  return out.idToken;
}

async function postFrame(idToken, file) {
  const frameBase64 = fs.readFileSync(path.join(FRAMES_DIR, file)).toString('base64');
  const res = await fetch(FRAME_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
    body: JSON.stringify({ tournamentId: T_ID, matchId: M_ID, frameBase64 }),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

async function matchDoc() {
  return (await db.collection('tournaments').doc(T_ID).collection('matches').doc(M_ID).get()).data();
}

function check(label, ok, detail = '') {
  console.log(`${ok ? '✅' : '❌'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) process.exitCode = 1;
}

(async () => {
  // ── Setup ──────────────────────────────────────────────────────────
  console.log(`Setting up ${T_ID} (players ${UA} vs ${UB})`);
  const tRef = db.collection('tournaments').doc(T_ID);
  await tRef.set({
    adminId: 'test_engine_host', name: 'ENGINE TEST (auto-delete)', game: 'cs2',
    type: 'single_elim', mode: 'solo', status: 'active', entryFee: 0, prizePool: 0,
    participants: [UA, UB], visibility: 'private',
    scheduledStart: new Date(), createdAt: FieldValue.serverTimestamp(),
    bracketData: { format: 'single_elim', size: 2, totalRounds: 1 },
    bracket: { totalRounds: 1, currentRound: 1 },
  });
  await tRef.collection('matches').doc(M_ID).set({
    round: 1, matchNumber: 1, player1: UA, player2: UB,
    winner: null, loser: null, status: 'pending', bye: false,
    lobbyCode: LOBBY_CODE, verifyMethod: 'chat', detection: 'gsi',
    verifyState: {
      [UA]: { status: 'pending', source: null, at: null, modUid: null },
      [UB]: { status: 'pending', source: null, at: null, modUid: null },
    },
    seriesFormat: 'bo1', seriesScore: { a: 0, b: 0 }, games: [], seriesWinner: null,
    createdAt: FieldValue.serverTimestamp(),
  });
  const [tokA, tokB] = [await idTokenFor(UA), await idTokenFor(UB)];

  // ── 1+2: lobby-code verification frames ────────────────────────────
  const r1 = await postFrame(tokA, 'codeA.jpg');
  check('A code frame verified', r1.status === 200 && r1.body.verified === true, JSON.stringify(r1.body));
  const r2 = await postFrame(tokB, 'codeB.jpg');
  check('B code frame verified', r2.status === 200 && r2.body.verified === true, JSON.stringify(r2.body));
  let m = await matchDoc();
  check('bothVerifiedAt set', !!m.bothVerifiedAt);
  check("status flipped to in_progress", m.status === 'in_progress', `status=${m.status}`);

  // ── 3: A's VICTORY end screen ──────────────────────────────────────
  const r3 = await postFrame(tokA, 'victory.jpg');
  check("A victory frame → outcome 'won'", r3.status === 200 && r3.body.outcome === 'won', JSON.stringify(r3.body));
  await sleep(8000); // let processAutoResults run
  m = await matchDoc();
  check('match awaiting_confirmation', m.status === 'awaiting_confirmation', `status=${m.status}`);
  check('claimed winner = A', m.firstReportedWinner === UA);
  check('confirm deadline stamped', Number(m.confirmDeadlineMs) > Date.now() - 60000, String(m.confirmDeadlineMs));
  const notif = await db.collection('notifications')
    .where('recipientId', '==', UB).where('type', '==', 'tournament_result_confirm').get();
  check('B got confirm notification', !notif.empty);

  // ── 4: B's DEFEAT end screen → agreement → completed ──────────────
  const r4 = await postFrame(tokB, 'defeat.jpg');
  check("B defeat frame → outcome 'lost'", r4.status === 200 && r4.body.outcome === 'lost', JSON.stringify(r4.body));
  await sleep(8000);
  m = await matchDoc();
  check('match COMPLETED', m.status === 'completed', `status=${m.status}`);
  check('winner = A', m.winner === UA);
  const t = (await tRef.get()).data();
  check('tournament finalized', t.status === 'completed', `t.status=${t.status} payout=${t.payoutStatus}`);

  // ── Cleanup ────────────────────────────────────────────────────────
  console.log('Cleaning up test data…');
  const subs = ['matches', 'disputes'];
  for (const sub of subs) {
    const snap = await tRef.collection(sub).get();
    for (const d of snap.docs) {
      const reports = await d.ref.collection('reports').get().catch(() => ({ docs: [] }));
      for (const r of reports.docs) await r.ref.delete();
      await d.ref.delete();
    }
  }
  await tRef.delete();
  for (const uid of [UA, UB, 'test_engine_host']) {
    const n = await db.collection('notifications').where('recipientId', '==', uid).get();
    for (const d of n.docs) await d.ref.delete();
    const tx = await db.collection('transactions').where('userId', '==', uid).get();
    for (const d of tx.docs) await d.ref.delete();
    await db.collection('wallets').doc(uid).delete().catch(() => {});
    await db.collection('users').doc(uid).delete().catch(() => {});
    await admin.auth().deleteUser(uid).catch(() => {});
  }
  console.log(process.exitCode ? 'TEST FAILED (see ❌ above)' : 'ALL CHECKS PASSED — result engine verified end-to-end.');
  process.exit(process.exitCode || 0);
})().catch((e) => { console.error('test crashed:', e); process.exit(1); });
