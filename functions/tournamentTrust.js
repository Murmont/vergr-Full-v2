// VERGR tournament trust + reputation system.
//
// Responsibilities:
//   1. trustScore        — per-user reputation (verified matches / disputes).
//   2. fingerprint       — hardware fingerprint binding (browser + GPU hash).
//                          First match enrolls; later mismatch = auto-flag.
//   3. rivalry           — auto-track players faced ≥ 3 times.
//   4. aiMatchSummary    — Gemini multimodal post-match summary for mod queue.
//   5. sportsmanship     — winner can route 1% of prize to opponent.
//
// Triggers + callables registered here; aggregator crons live alongside.

const functions = require('firebase-functions/v2');
const { onDocumentWritten } = require('firebase-functions/v2/firestore');
const { defineSecret } = require('firebase-functions/params');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');

const REGION = 'europe-west1';
const db = getFirestore('vgrdb');

const GEMINI_POST_VIDEO_KEY = defineSecret('GEMINI_POST_VIDEO_KEY');

// ─── Trust score ─────────────────────────────────────────────────────────
// users/{uid}.tournamentTrust = {
//   verifiedMatches, disputes, autoFlags, score (0-1000), enrolledAt
// }
// Hidden from public UI until verifiedMatches >= 5 (avoids unfair early
// labels). Score formula: 500 base + 10 * verifiedMatches - 50 * disputes
// - 25 * autoFlags, clamped 0-1000.
function computeTrustScore({ verifiedMatches = 0, disputes = 0, autoFlags = 0 }) {
  return Math.max(0, Math.min(1000,
    500 + 10 * verifiedMatches - 50 * disputes - 25 * autoFlags
  ));
}

exports.getTournamentTrust = functions.https.onCall({ region: REGION }, async (req) => {
  if (!req.auth) throw new functions.https.HttpsError('unauthenticated', 'Sign in required.');
  const { uid } = req.data || {};
  if (!uid) throw new functions.https.HttpsError('invalid-argument', 'uid required.');
  const snap = await db.collection('users').doc(uid).get();
  const t = snap.exists ? (snap.data().tournamentTrust || {}) : {};
  const visible = (t.verifiedMatches || 0) >= 5;
  return {
    visible,
    score: visible ? computeTrustScore(t) : null,
    verifiedMatches: t.verifiedMatches || 0,
    disputes: t.disputes || 0,
    autoFlags: t.autoFlags || 0,
  };
});

// ─── Hardware fingerprint ────────────────────────────────────────────────
// First tournament enrolls (uid, fingerprint). Subsequent tournament entries
// check the stored fingerprint — mismatch is logged + the mod queue is
// pinged. Does NOT auto-block (laptop + desktop is a valid use case); mod
// reviews if the player's score is borderline.
//
// fingerprint string is a hex-encoded sha256 of:
//   navigator.userAgent + screen.colorDepth + screen.width*height +
//   timezone + GPU vendor + GPU renderer + canvas-2d hash
// AC5 — second-device-in-one-match detection. The match screen enrolls the
// device fingerprint on mount; we bind the FIRST device seen per (match, uid).
// A reload/crash-recovery on the same machine reports the same fingerprint (no
// flag). A DIFFERENT fingerprint for the same account while the match is live
// means the player is operating from a second device mid-match (e.g. running
// Vergr on a phone while playing on a separate, unscanned PC) — a mod hint, not
// an auto-action. Best-effort; never throws into the enroll flow.
async function bindMatchDevice(uid, tournamentId, matchId, fingerprint) {
  const mRef = db.collection('tournaments').doc(tournamentId).collection('matches').doc(matchId);
  const mSnap = await mRef.get();
  if (!mSnap.exists) return;
  const m = mSnap.data();
  if (m.player1 !== uid && m.player2 !== uid) return; // not a participant
  const bound = m.deviceBinding?.[uid];
  if (!bound) {
    await mRef.set({ deviceBinding: { [uid]: fingerprint } }, { merge: true });
    return;
  }
  if (bound === fingerprint) return; // same device — fine
  if (['completed', 'cancelled', 'forfeited'].includes(m.status)) return;
  if (m.deviceBindingFlag?.[uid] === fingerprint) return; // already flagged this device
  await mRef.set({ deviceBindingFlag: { [uid]: fingerprint } }, { merge: true });
  await db.collection('tournament_review_queue').add({
    tournamentId, matchId, hostUid: uid,
    source: 'two_device', overall: 'suspicious',
    flags: [{ type: 'second_device', note: 'Same account reported from a second device during the match.' }],
    status: 'pending', createdAt: FieldValue.serverTimestamp(),
  });
  await db.collection('notifications').add({
    recipientId: uid, type: 'tournament_flagged_for_review',
    title: 'Second device detected',
    body: 'Play and run Vergr on the same machine for tournament matches.',
    data: { tournamentId, matchId },
    actionUrl: `/tournaments/${tournamentId}/match/${matchId}`,
    read: false, createdAt: FieldValue.serverTimestamp(),
  });
}

exports.enrollOrCheckFingerprint = functions.https.onCall({ region: REGION }, async (req) => {
  if (!req.auth) throw new functions.https.HttpsError('unauthenticated', 'Sign in required.');
  const uid = req.auth.uid;
  const { fingerprint, tournamentId, matchId } = req.data || {};
  if (!fingerprint || typeof fingerprint !== 'string' || fingerprint.length < 32) {
    throw new functions.https.HttpsError('invalid-argument', 'Valid fingerprint required.');
  }
  // AC5 per-match device binding (best-effort, never blocks the enroll).
  if (tournamentId && matchId) {
    try { await bindMatchDevice(uid, tournamentId, matchId, fingerprint); }
    catch (e) { console.warn('bindMatchDevice', e?.message || e); }
  }
  const ref = db.collection('users').doc(uid);
  const snap = await ref.get();
  const prints = (snap.exists ? snap.data().tournamentFingerprints : null) || [];

  if (prints.includes(fingerprint)) {
    return { status: 'matched', knownDevices: prints.length };
  }

  // First device → silent enroll.
  if (prints.length === 0) {
    await ref.set({
      tournamentFingerprints: [fingerprint],
      tournamentFingerprintEnrolledAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    return { status: 'enrolled', knownDevices: 1 };
  }

  // Subsequent unknown device → log + add (up to 3 devices, then flag for mod).
  await db.collection('tournament_fingerprint_alerts').add({
    uid,
    tournamentId: tournamentId || null,
    newFingerprint: fingerprint,
    knownFingerprints: prints,
    knownDevices: prints.length,
    createdAt: FieldValue.serverTimestamp(),
    resolved: false,
  });
  if (prints.length < 3) {
    await ref.update({
      tournamentFingerprints: FieldValue.arrayUnion(fingerprint),
    });
    return { status: 'new_device_added', knownDevices: prints.length + 1 };
  }
  // 4th+ device — keep but flag.
  await ref.update({
    tournamentFingerprints: FieldValue.arrayUnion(fingerprint),
    'tournamentTrust.autoFlags': FieldValue.increment(1),
  });
  return { status: 'flagged_excess_devices', knownDevices: prints.length + 1 };
});

// ─── Rival auto-detection trigger ────────────────────────────────────────
// Fires on tournaments/{tId}/matches/{mId} update when status flips to
// completed. Increments rivalry counters for the two participants.
//
// rivalries/{minUid_maxUid} = {
//   uidA, uidB, matches, lastMetAt, wins: { [uid]: count }
// }
exports.recordRivalryOnMatchComplete = onDocumentWritten(
  { region: REGION, document: 'tournaments/{tId}/matches/{mId}' },
  async (event) => {
    const before = event.data?.before?.data();
    const after  = event.data?.after?.data();
    if (!after) return;
    if (after.status !== 'completed') return;
    if (before && before.status === 'completed') return; // already processed
    const { player1, player2, winner } = after;
    if (!player1 || !player2 || player1 === player2) return;
    const [a, b] = [player1, player2].sort();
    const ref = db.collection('rivalries').doc(`${a}_${b}`);
    await ref.set({
      uidA: a,
      uidB: b,
      matches: FieldValue.increment(1),
      lastMetAt: FieldValue.serverTimestamp(),
      [`wins.${winner}`]: FieldValue.increment(1),
    }, { merge: true });
    // Touch the trust counters too.
    if (winner) {
      const loser = winner === player1 ? player2 : player1;
      await Promise.all([
        db.collection('users').doc(winner).set({
          tournamentTrust: { verifiedMatches: FieldValue.increment(1) },
        }, { merge: true }),
        db.collection('users').doc(loser).set({
          tournamentTrust: { verifiedMatches: FieldValue.increment(1) },
        }, { merge: true }),
      ]);
      // Recompute scores.
      for (const uid of [winner, loser]) {
        const u = await db.collection('users').doc(uid).get();
        const t = u.data()?.tournamentTrust || {};
        await db.collection('users').doc(uid).update({
          'tournamentTrust.score': computeTrustScore(t),
        });
      }
    }
  },
);

exports.getRivalry = functions.https.onCall({ region: REGION }, async (req) => {
  if (!req.auth) throw new functions.https.HttpsError('unauthenticated', 'Sign in required.');
  const { uidA, uidB } = req.data || {};
  if (!uidA || !uidB) throw new functions.https.HttpsError('invalid-argument', 'uidA + uidB required.');
  const [a, b] = [uidA, uidB].sort();
  const snap = await db.collection('rivalries').doc(`${a}_${b}`).get();
  if (!snap.exists) return { matches: 0, wins: {} };
  return snap.data();
});

// ─── AI match summarizer ─────────────────────────────────────────────────
// Gemini multimodal pass over the saved VOD. Produces a one-line verdict
// the Vanguard mod can confirm with one keystroke. Called automatically
// by the post-match archive cron; result stored on the match doc.
exports.aiSummarizeMatch = functions.https.onCall(
  { region: REGION, secrets: [GEMINI_POST_VIDEO_KEY] },
  async (req) => {
    if (!req.auth) throw new functions.https.HttpsError('unauthenticated', 'Sign in required.');
    const { tournamentId, matchId } = req.data || {};
    if (!tournamentId || !matchId) {
      throw new functions.https.HttpsError('invalid-argument', 'tournamentId + matchId required.');
    }
    // Auth gate: only Vanguard mods or the participants themselves.
    const modUid = req.auth.uid;
    const u = await db.collection('users').doc(modUid).get();
    const ud = u.exists ? u.data() : {};
    const isMod = !!ud.vanguard?.rank || ud.role === 'admin';
    const mRef = db.collection('tournaments').doc(tournamentId).collection('matches').doc(matchId);
    const m = (await mRef.get()).data();
    if (!m) throw new functions.https.HttpsError('not-found', 'Match not found.');
    const isPlayer = m.player1 === modUid || m.player2 === modUid;
    if (!isMod && !isPlayer) {
      throw new functions.https.HttpsError('permission-denied', 'Mod or participant only.');
    }
    // Reuse cached summary if recent.
    if (m.aiSummary && (Date.now() - (m.aiSummary.computedAtMs || 0)) < 6 * 60 * 60_000) {
      return m.aiSummary;
    }
    const summary = await runGeminiVodSummary({
      vodUrl: m.archiveVodUrl || null,
      lobbyCode: m.lobbyCode,
      players: [m.player1, m.player2],
      apiKey: GEMINI_POST_VIDEO_KEY.value(),
    });
    await mRef.update({
      aiSummary: { ...summary, computedAtMs: Date.now() },
    });
    return summary;
  },
);

async function runGeminiVodSummary({ vodUrl, lobbyCode, players, apiKey }) {
  // Until the VOD-archive transcode pipeline exists, return a deterministic
  // placeholder. The cron in Phase B will replace this with a real call.
  if (!vodUrl) {
    return {
      verdict: 'no_vod',
      text: 'No archived VOD available; verify from stream or both-player reports.',
      flags: [],
      confidence: 0,
    };
  }
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            parts: [
              { text: `You are reviewing a tournament match VOD. Output STRICT JSON with keys verdict ("p1_won"|"p2_won"|"unclear"|"irregular"), text (one sentence ≤120 chars), flags (array of strings: "possible_wallhack","aim_snap","name_mismatch","lobby_code_missing","disconnect"), confidence (0-1). Lobby code expected: ${lobbyCode}. Players: ${players.join(' vs ')}.` },
              { fileData: { fileUri: vodUrl, mimeType: 'video/mp4' } },
            ],
          }],
        }),
      },
    );
    const j = await res.json();
    const text = j?.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
    const cleaned = text.replace(/^```json\s*|\s*```$/g, '').trim();
    return JSON.parse(cleaned);
  } catch (err) {
    console.warn('gemini summary failed', err);
    return { verdict: 'error', text: 'AI summary unavailable.', flags: [], confidence: 0 };
  }
}

// ─── Sportsmanship — winner routes 1% of prize to opponent ───────────────
exports.routeSportsmanshipBonus = functions.https.onCall({ region: REGION }, async (req) => {
  if (!req.auth) throw new functions.https.HttpsError('unauthenticated', 'Sign in required.');
  const uid = req.auth.uid;
  const { tournamentId, matchId, recipientUid } = req.data || {};
  if (!tournamentId || !matchId || !recipientUid) {
    throw new functions.https.HttpsError('invalid-argument', 'tournamentId + matchId + recipientUid required.');
  }
  const mRef = db.collection('tournaments').doc(tournamentId).collection('matches').doc(matchId);
  const m = (await mRef.get()).data();
  if (!m) throw new functions.https.HttpsError('not-found', 'Match not found.');
  if (m.winner !== uid) {
    throw new functions.https.HttpsError('permission-denied', 'Only the winner can send a sportsmanship bonus.');
  }
  if (m.sportsmanshipSentAt) {
    throw new functions.https.HttpsError('already-exists', 'Bonus already sent for this match.');
  }
  const tSnap = await db.collection('tournaments').doc(tournamentId).get();
  const t = tSnap.data();
  const prizePerWinner = Math.floor((t.entryFee || 0) * (t.participants?.length || 0) * 0.01);
  if (prizePerWinner <= 0) return { ok: true, amount: 0 };
  await db.runTransaction(async (tx) => {
    const wRef = db.collection('wallets').doc(uid);
    const rRef = db.collection('wallets').doc(recipientUid);
    const [wSnap, rSnap] = await Promise.all([tx.get(wRef), tx.get(rRef)]);
    if ((wSnap.data()?.balance || 0) < prizePerWinner) {
      throw new functions.https.HttpsError('failed-precondition', 'Insufficient balance.');
    }
    tx.update(wRef, { balance: FieldValue.increment(-prizePerWinner) });
    tx.update(rRef, { balance: FieldValue.increment(prizePerWinner) });
    tx.update(mRef, {
      sportsmanshipSentAt: FieldValue.serverTimestamp(),
      sportsmanshipAmount: prizePerWinner,
      sportsmanshipRecipient: recipientUid,
    });
    tx.set(db.collection('notifications').doc(), {
      recipientId: recipientUid,
      type: 'sportsmanship_bonus',
      title: 'You received a sportsmanship bonus',
      body: `${prizePerWinner} coins from your opponent.`,
      data: { tournamentId, matchId, fromUid: uid },
      read: false,
      createdAt: FieldValue.serverTimestamp(),
    });
  });
  return { ok: true, amount: prizePerWinner };
});

// Dispute counter increment — called by recordMatchResult on dispute path.
exports._incrementDisputeCounter = async function (uids) {
  for (const uid of uids) {
    await db.collection('users').doc(uid).set({
      tournamentTrust: { disputes: FieldValue.increment(1) },
    }, { merge: true });
    const u = await db.collection('users').doc(uid).get();
    await db.collection('users').doc(uid).update({
      'tournamentTrust.score': computeTrustScore(u.data()?.tournamentTrust || {}),
    });
  }
};
