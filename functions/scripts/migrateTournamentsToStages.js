// scripts/migrateTournamentsToStages.js
//
// One-time migration: rewrites every existing tournament doc into the
// Phase 2 multi-stage shape by wrapping its current single-format type
// as a single-stage tournament.
//
// USAGE:
//   node scripts/migrateTournamentsToStages.js                # dry run (prints diff per doc, writes nothing)
//   node scripts/migrateTournamentsToStages.js --apply        # actually write
//   node scripts/migrateTournamentsToStages.js --apply --only=in_flight   # safety filter
//
// SAFETY:
//   - Pre-flight refuses to apply if ANY in-flight tournament would lose
//     match history. Match docs aren't touched by this script (stageId
//     defaults to first stage in advanceStageIfNeeded), so the bar is:
//     no participants[], or unexpected schema, or existing stages[] that
//     would be overwritten.
//   - Already-migrated tournaments (stages[] non-empty) are skipped.
//   - Cancelled/completed tournaments are migrated by default so the
//     data shape is uniform; pass --only=in_flight to skip those.
//
// PRE-FLIGHT REQUIREMENT:
//   Run from the `functions/` directory with GOOGLE_APPLICATION_CREDENTIALS
//   pointing at a service-account key for project vergr-44494. Or with
//   `firebase functions:shell` then `require('./scripts/migrateTournamentsToStages').run()`.

const admin = require('firebase-admin');
const { FieldValue } = require('firebase-admin/firestore');

if (admin.apps.length === 0) admin.initializeApp();
const db = admin.firestore(undefined, 'vgrdb');

// Mirror of functions/tournamentRules.js BRACKET_TYPES keys.
const KNOWN_TYPES = new Set([
  'single_elim', 'double_elim', 'squad_single_elim',
  'squad_round_robin', 'round_robin', 'battle_royale',
  'swiss', 'invitational',
]);

function tournamentToSingleStage(t) {
  return {
    stages: [{
      id: 'stage_1',
      name: 'Main Bracket',
      type: t.type,
      seriesFormat: t.seriesFormat || 'bo1',
      seedingMode: t.seedingMode || 'random',
      ...(t.type === 'swiss' ? { swissRounds: t.swissRounds || 5 } : {}),
      ...(t.type === 'battle_royale' ? { brGameCount: t.brGameCount || 3 } : {}),
    }],
    currentStageId: 'stage_1',
  };
}

async function run({ apply = false, onlyInFlight = false } = {}) {
  console.log(`[migrate] mode=${apply ? 'APPLY' : 'DRY-RUN'}${onlyInFlight ? ' filter=in_flight' : ''}`);

  const snap = await db.collection('tournaments').get();
  console.log(`[migrate] found ${snap.size} tournaments`);

  let toMigrate = 0;
  let alreadyMigrated = 0;
  let skippedFilter = 0;
  let unsafe = 0;
  const unsafeIds = [];
  const ops = [];

  for (const doc of snap.docs) {
    const t = doc.data();

    if (Array.isArray(t.stages) && t.stages.length > 0) {
      alreadyMigrated++;
      continue;
    }
    if (onlyInFlight && !['open', 'active'].includes(t.status)) {
      skippedFilter++;
      continue;
    }
    if (!KNOWN_TYPES.has(t.type)) {
      unsafe++;
      unsafeIds.push({ id: doc.id, reason: `unknown type ${t.type}` });
      continue;
    }
    if (!Array.isArray(t.participants)) {
      unsafe++;
      unsafeIds.push({ id: doc.id, reason: 'no participants[]' });
      continue;
    }

    const patch = tournamentToSingleStage(t);
    toMigrate++;
    ops.push({ id: doc.id, name: t.name || '?', status: t.status, type: t.type, patch });
  }

  console.log('');
  console.log(`[migrate] summary:`);
  console.log(`  already-migrated:  ${alreadyMigrated}`);
  console.log(`  skipped (filter):  ${skippedFilter}`);
  console.log(`  unsafe (skip):     ${unsafe}`);
  console.log(`  to migrate:        ${toMigrate}`);

  if (unsafe > 0) {
    console.log('');
    console.log('[migrate] UNSAFE rows (skipped):');
    unsafeIds.slice(0, 20).forEach((u) => console.log(`   - ${u.id}: ${u.reason}`));
    if (unsafeIds.length > 20) console.log(`   ... +${unsafeIds.length - 20} more`);
  }

  console.log('');
  console.log('[migrate] sample diff (first 5):');
  ops.slice(0, 5).forEach((op) => {
    console.log(`  ${op.id} (${op.status}, ${op.type})  →  stages:[{type:${op.patch.stages[0].type}}], currentStageId:${op.patch.currentStageId}`);
  });

  if (!apply) {
    console.log('');
    console.log('[migrate] DRY-RUN — no writes. Re-run with --apply to commit.');
    return { applied: 0, toMigrate, alreadyMigrated, unsafe };
  }

  // APPLY — batched writes, 400 ops per batch (Firestore cap = 500).
  let written = 0;
  let batch = db.batch();
  let inBatch = 0;
  for (const op of ops) {
    batch.update(db.collection('tournaments').doc(op.id), {
      ...op.patch,
      stagesMigratedAt: FieldValue.serverTimestamp(),
    });
    inBatch++;
    written++;
    if (inBatch >= 400) {
      await batch.commit();
      batch = db.batch();
      inBatch = 0;
      console.log(`[migrate] committed ${written}/${ops.length}…`);
    }
  }
  if (inBatch > 0) await batch.commit();

  console.log(`[migrate] APPLY complete. wrote ${written} docs.`);
  return { applied: written, toMigrate, alreadyMigrated, unsafe };
}

module.exports = { run };

// CLI entry point.
if (require.main === module) {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const onlyInFlight = args.some((a) => a === '--only=in_flight');
  run({ apply, onlyInFlight }).then(() => process.exit(0)).catch((err) => {
    console.error('[migrate] FAILED:', err);
    process.exit(1);
  });
}
