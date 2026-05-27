// VERGR anti-cheat scan ingest.
//
// The Tauri desktop app calls `submitAntiCheatScan` with the list of running
// processes (name + exe path hash). This module matches them against the
// `cheat_signatures/` collection (admin-maintained) and stamps:
//
//   - tournament_assignments/{id}.antiCheat = {
//       lastScanAt, processCount,
//       redFlags, orangeFlags, yellowFlags  (string[])
//     }
//   - alert docs in `anti_cheat_alerts/` for red/orange (mod queue)
//
// Player consents at tournament entry (see CLAUDE.md). No scan happens
// outside a tournament context. Transparency: the player can fetch their
// own latest scan via `getMyAntiCheatScan`.

const functions = require('firebase-functions/v2');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');

const REGION = 'europe-west1';
const db = getFirestore('vgrdb');

// cheat_signatures/{id} = {
//   id, kind: 'exe_hash'|'exe_name'|'cmd_substring',
//   value: string, severity: 'yellow'|'orange'|'red',
//   label, addedByUid, createdAt, active: bool, falsePositiveRate
// }
async function loadActiveSignatures() {
  const snap = await db.collection('cheat_signatures').where('active', '==', true).get();
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

// AC8 — known game-launcher executables. If a launcher was seen running for a
// player earlier in the match but a later in_progress scan has none, the
// launcher (and therefore the game) closed mid-match — suspicious. Mod hint.
const LAUNCHER_EXES = new Set([
  'steam.exe', 'steamservice.exe',
  'eadesktop.exe', 'eabackgroundservice.exe', 'origin.exe',
  'battle.net.exe', 'agent.exe',
  'epicgameslauncher.exe',
  'riotclientservices.exe',
  'upc.exe', 'ubisoftconnect.exe',
]);
function launcherRunning(processes) {
  for (const p of processes) {
    if (LAUNCHER_EXES.has((p.name || '').toLowerCase())) return true;
  }
  return false;
}

function matchProcess(proc, sigs) {
  const out = [];
  const name = (proc.name || '').toLowerCase();
  const cmd = (proc.cmd_join || '').toLowerCase();
  const hash = (proc.exe_hash || '').toLowerCase();
  for (const s of sigs) {
    const v = (s.value || '').toLowerCase();
    if (!v) continue;
    let hit = false;
    if (s.kind === 'exe_hash') hit = hash && hash === v;
    else if (s.kind === 'exe_name') hit = name === v || name.startsWith(v + '.');
    else if (s.kind === 'cmd_substring') hit = cmd.includes(v);
    if (hit) out.push({ sigId: s.id, label: s.label, severity: s.severity, kind: s.kind, value: s.value });
  }
  return out;
}

exports.submitAntiCheatScan = functions.https.onCall({ region: REGION }, async (req) => {
  if (!req.auth) throw new functions.https.HttpsError('unauthenticated', 'Sign in required.');
  const uid = req.auth.uid;
  const { tournamentId, matchId, processes, scannedAtMs } = req.data || {};
  if (!tournamentId || !matchId || !Array.isArray(processes)) {
    throw new functions.https.HttpsError('invalid-argument', 'tournamentId + matchId + processes[] required.');
  }
  // Player must be a participant to scan-submit.
  const tSnap = await db.collection('tournaments').doc(tournamentId).get();
  if (!tSnap.exists) throw new functions.https.HttpsError('not-found', 'Tournament not found.');
  if (!(tSnap.data().participants || []).includes(uid)) {
    throw new functions.https.HttpsError('permission-denied', 'Not a participant.');
  }

  const sigs = await loadActiveSignatures();
  const matched = [];
  for (const p of processes.slice(0, 1000)) {
    const hits = matchProcess(p, sigs);
    if (hits.length) matched.push({ proc: p, hits });
  }

  const flags = { yellow: [], orange: [], red: [] };
  for (const m of matched) {
    for (const h of m.hits) {
      const sev = h.severity || 'yellow';
      flags[sev]?.push({ proc: m.proc.name, sig: h.label, pid: m.proc.pid });
    }
  }

  const scanDoc = {
    uid, tournamentId, matchId,
    scannedAtMs: scannedAtMs || Date.now(),
    processCount: processes.length,
    matchedSignatures: matched.length,
    yellowFlags: flags.yellow,
    orangeFlags: flags.orange,
    redFlags: flags.red,
    createdAt: FieldValue.serverTimestamp(),
  };
  const ref = await db.collection('anti_cheat_scans').add(scanDoc);

  // Stamp summary on the match for the mod wall.
  const mRef = db.collection('tournaments').doc(tournamentId)
    .collection('matches').doc(matchId);

  // AC8 — launcher-presence tracking. Read prior state, detect a disappearance.
  const mSnap = await mRef.get();
  const prior = mSnap.exists ? (mSnap.data().antiCheat?.[uid] || {}) : {};
  const matchStatus = mSnap.exists ? mSnap.data().status : null;
  const hasLauncher = launcherRunning(processes);
  const launcherGone = !hasLauncher && prior.launcherSeen === true
    && !prior.launcherGone && matchStatus === 'in_progress';

  await mRef.set({
    antiCheat: {
      [uid]: {
        lastScanAt: FieldValue.serverTimestamp(),
        scanId: ref.id,
        processCount: processes.length,
        red: flags.red.length, orange: flags.orange.length, yellow: flags.yellow.length,
        launcherSeen: prior.launcherSeen === true || hasLauncher,
        launcherGone: prior.launcherGone === true || launcherGone,
      },
    },
  }, { merge: true });

  // AC8 alert — game launcher closed mid-match.
  if (launcherGone) {
    await db.collection('anti_cheat_alerts').add({
      uid, tournamentId, matchId, scanId: ref.id,
      severity: 'orange', kind: 'launcher_gone',
      note: 'Game launcher was running earlier but is now absent mid-match.',
      status: 'pending', createdAt: FieldValue.serverTimestamp(),
    });
    await db.collection('notifications').add({
      recipientId: uid, type: 'tournament_flagged_for_review',
      title: 'Game launcher closed',
      body: 'Keep your game and its launcher running during the match.',
      data: { tournamentId, matchId },
      actionUrl: `/tournaments/${tournamentId}/match/${matchId}`,
      read: false, createdAt: FieldValue.serverTimestamp(),
    });
  }

  // Alert the mod queue on orange/red.
  if (flags.red.length > 0 || flags.orange.length > 0) {
    await db.collection('anti_cheat_alerts').add({
      uid, tournamentId, matchId, scanId: ref.id,
      severity: flags.red.length > 0 ? 'red' : 'orange',
      red: flags.red, orange: flags.orange,
      status: 'pending', createdAt: FieldValue.serverTimestamp(),
    });
  }

  // Return the transparency payload to the player (so they can see exactly
  // what triggered, if anything).
  return {
    ok: true, scanId: ref.id,
    flags: { yellow: flags.yellow, orange: flags.orange, red: flags.red },
    processCount: processes.length, matchedSignatures: matched.length,
  };
});

// Transparency endpoint — player fetches their own latest scan.
exports.getMyLatestAntiCheatScan = functions.https.onCall({ region: REGION }, async (req) => {
  if (!req.auth) throw new functions.https.HttpsError('unauthenticated', 'Sign in required.');
  const uid = req.auth.uid;
  const { tournamentId, matchId } = req.data || {};
  let q = db.collection('anti_cheat_scans').where('uid', '==', uid);
  if (tournamentId) q = q.where('tournamentId', '==', tournamentId);
  if (matchId) q = q.where('matchId', '==', matchId);
  q = q.orderBy('createdAt', 'desc').limit(1);
  const snap = await q.get();
  if (snap.empty) return null;
  return { id: snap.docs[0].id, ...snap.docs[0].data() };
});

// ─── Admin: cheat signatures CRUD ───────────────────────────────────────
async function requireAdmin(uid) {
  const u = await db.collection('users').doc(uid).get();
  if (u.data()?.role !== 'admin') {
    throw new functions.https.HttpsError('permission-denied', 'Admin only.');
  }
}

exports.upsertCheatSignature = functions.https.onCall({ region: REGION }, async (req) => {
  if (!req.auth) throw new functions.https.HttpsError('unauthenticated', 'Sign in required.');
  await requireAdmin(req.auth.uid);
  const { id, kind, value, severity, label, active = true } = req.data || {};
  if (!['exe_hash', 'exe_name', 'cmd_substring'].includes(kind)) {
    throw new functions.https.HttpsError('invalid-argument', 'invalid kind');
  }
  if (!['yellow', 'orange', 'red'].includes(severity)) {
    throw new functions.https.HttpsError('invalid-argument', 'invalid severity');
  }
  const ref = id ? db.collection('cheat_signatures').doc(id) : db.collection('cheat_signatures').doc();
  await ref.set({
    kind, value: String(value || '').toLowerCase(),
    severity, label: String(label || '').slice(0, 80),
    active, addedByUid: req.auth.uid,
    updatedAt: FieldValue.serverTimestamp(),
    createdAt: id ? undefined : FieldValue.serverTimestamp(),
  }, { merge: true });
  return { ok: true, id: ref.id };
});

exports.deleteCheatSignature = functions.https.onCall({ region: REGION }, async (req) => {
  if (!req.auth) throw new functions.https.HttpsError('unauthenticated', 'Sign in required.');
  await requireAdmin(req.auth.uid);
  const { id } = req.data || {};
  if (!id) throw new functions.https.HttpsError('invalid-argument', 'id required');
  await db.collection('cheat_signatures').doc(id).delete();
  return { ok: true };
});
