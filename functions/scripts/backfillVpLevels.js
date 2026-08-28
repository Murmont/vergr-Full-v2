// One-off backfill (2026-08-23): populate `users/{uid}.vpLevel` from
// `wallets/{uid}.vp`.
//
// ## Why
//
// NOTHING ever wrote `users/{uid}.vpLevel` (audit A110). The new `syncVpLevel`
// trigger (functions/vpLevel.js) keeps it current from now on, but it only fires
// when a wallet's `vp` CHANGES, so every existing account stays without the field
// until its next VP grant. Until then a user's rank is invisible to everyone else
// in the app (their wallet is not readable by other clients, so `vpLevel` on the
// user doc is the only way to render someone else's rank), and their avatar
// frames stay locked.
//
// This walks every wallet once and writes the derived level. Safe to re-run:
// it skips docs already carrying the correct value.
//
// Run from functions/:
//   GOOGLE_APPLICATION_CREDENTIALS=/path/key.json node scripts/backfillVpLevels.js
//   GOOGLE_APPLICATION_CREDENTIALS=/path/key.json node scripts/backfillVpLevels.js --apply
//
// Without --apply it is a DRY RUN and prints what it would change.

const admin = require('firebase-admin');
const { getFirestore } = require('firebase-admin/firestore');
if (admin.apps.length === 0) admin.initializeApp();
// getFirestore('vgrdb') is the correct named-DB accessor; admin.firestore()
// silently returns the empty default database.
const db = getFirestore('vgrdb');

const APPLY = process.argv.includes('--apply');

/** MIRROR of levelCost() in src/utils/vpSystem.js and functions/vpLevel.js. */
const levelCost = (level) => (level <= 1 ? 0 : 2000 + 1000 * Math.floor((level - 1) / 10));

function levelForVp(totalVp) {
  const vp = Math.max(0, Number(totalVp) || 0);
  let cumulative = 0;
  for (let level = 2; level <= 100; level++) {
    cumulative += levelCost(level);
    if (vp < cumulative) return level - 1;
  }
  return 100;
}

(async () => {
  console.log(APPLY ? 'APPLYING' : 'DRY RUN (pass --apply to write)');

  const wallets = await db.collection('wallets').get();
  console.log(`wallets: ${wallets.size}`);

  let changed = 0, skipped = 0, missingUser = 0;
  let batch = db.batch();
  let pending = 0;

  for (const w of wallets.docs) {
    const uid = w.id;
    const level = levelForVp(w.data()?.vp);
    const userRef = db.collection('users').doc(uid);
    const userSnap = await userRef.get();
    if (!userSnap.exists) { missingUser += 1; continue; }

    if (Number(userSnap.data()?.vpLevel) === level) { skipped += 1; continue; }

    console.log(`  ${uid}: vp=${w.data()?.vp || 0} -> vpLevel ${userSnap.data()?.vpLevel ?? '(none)'} => ${level}`);
    changed += 1;
    if (APPLY) {
      batch.set(userRef, { vpLevel: level }, { merge: true });
      pending += 1;
      if (pending >= 400) { await batch.commit(); batch = db.batch(); pending = 0; }
    }
  }

  if (APPLY && pending > 0) await batch.commit();
  console.log(`\nchanged=${changed} skipped=${skipped} walletsWithoutUserDoc=${missingUser}`);
  console.log(APPLY ? 'done' : 'dry run only, nothing written');
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
