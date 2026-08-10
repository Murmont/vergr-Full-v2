// VERGR tournament match same-lobby verification.
//
// Each tournament match gets a unique `lobbyCode` (VERGR-XXXXXXX) generated
// when the match doc is created. Both players must DISPLAY that code in-game
// per their game's `verifyMethod`:
//
//   chat         — type the code in lobby/in-game chat
//   name         — temporarily set in-game name to include the code
//   lobby_name   — host names the custom lobby with the code (single check)
//   match_screen — both opponent gamertags visible in match-setup screen
//
// Verification sources (in trust order):
//   1. ocr      — Hetzner Tesseract + Google Vision consensus from the
//                 participant's live VERGR stream sees the code on screen.
//   2. mod      — A Vanguard mod watching the stream confirms manually.
//   3. self     — Player attests they've displayed the code (lowest trust,
//                 still requires the other side or a mod to also confirm).
//
// Match cannot advance to "play" state until BOTH sides are status='verified'.
// Real-time notifications fire to the OTHER side the instant a player flips.

const functions = require('firebase-functions/v2');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');

const REGION = 'europe-west1';
const db = getFirestore('vgrdb');

// ─── getMatchVerification ────────────────────────────────────────────────
exports.getMatchVerification = functions.https.onCall({ region: REGION }, async (req) => {
  if (!req.auth) throw new functions.https.HttpsError('unauthenticated', 'Sign in required.');
  const { tournamentId, matchId } = req.data || {};
  if (!tournamentId || !matchId) {
    throw new functions.https.HttpsError('invalid-argument', 'tournamentId + matchId required.');
  }
  const mRef = db.collection('tournaments').doc(tournamentId).collection('matches').doc(matchId);
  const mSnap = await mRef.get();
  if (!mSnap.exists) throw new functions.https.HttpsError('not-found', 'Match not found.');
  const m = mSnap.data();
  return {
    lobbyCode: m.lobbyCode || null,
    verifyMethod: m.verifyMethod || null,
    detection: m.detection || null,
    verifyState: m.verifyState || {},
    player1: m.player1, player2: m.player2,
    status: m.status,
  };
});

// ─── selfAttestMatchVerification ─────────────────────────────────────────
// Player taps "I've displayed the code" — lowest-trust source. Still useful
// because it signals to the mod queue + the opponent that this side is ready.
exports.selfAttestMatchVerification = functions.https.onCall({ region: REGION }, async (req) => {
  if (!req.auth) throw new functions.https.HttpsError('unauthenticated', 'Sign in required.');
  const uid = req.auth.uid;
  const { tournamentId, matchId } = req.data || {};
  if (!tournamentId || !matchId) {
    throw new functions.https.HttpsError('invalid-argument', 'tournamentId + matchId required.');
  }
  const mRef = db.collection('tournaments').doc(tournamentId).collection('matches').doc(matchId);
  const mSnap = await mRef.get();
  if (!mSnap.exists) throw new functions.https.HttpsError('not-found', 'Match not found.');
  const m = mSnap.data();
  if (m.player1 !== uid && m.player2 !== uid) {
    throw new functions.https.HttpsError('permission-denied', 'Not your match.');
  }
  await mRef.update({
    [`verifyState.${uid}.status`]: 'self_attested',
    [`verifyState.${uid}.source`]: 'self',
    [`verifyState.${uid}.at`]: FieldValue.serverTimestamp(),
  });
  await notifyOtherSide(tournamentId, matchId, uid, m, 'attested');
  // Self-attest counts as "engaged" — if the other side is also engaged
  // (verified or self_attested), the match goes live. Without this, two
  // honest players with no OCR stream and no assigned mod could never
  // reach the play/report phase (the pre-fix deadlock).
  await pingBothIfReady(tournamentId, matchId);
  return { ok: true };
});

// ─── modVerifyMatchPlayer ────────────────────────────────────────────────
// Vanguard mod confirms a side from watching the stream. Higher trust than
// self-attestation. Mod permission check delegated to vanguardRanks helper.
exports.modVerifyMatchPlayer = functions.https.onCall({ region: REGION }, async (req) => {
  if (!req.auth) throw new functions.https.HttpsError('unauthenticated', 'Sign in required.');
  const modUid = req.auth.uid;
  const { tournamentId, matchId, sideUid, verdict } = req.data || {};
  if (!tournamentId || !matchId || !sideUid || !verdict) {
    throw new functions.https.HttpsError('invalid-argument', 'tournamentId + matchId + sideUid + verdict required.');
  }
  if (!['verified', 'rejected'].includes(verdict)) {
    throw new functions.https.HttpsError('invalid-argument', 'verdict must be verified | rejected.');
  }
  // Vanguard authority check.
  const modSnap = await db.collection('users').doc(modUid).get();
  const modData = modSnap.exists ? modSnap.data() : {};
  const rank = modData.vanguard?.rank || (modData.role === 'admin' ? 'overseer' : null);
  if (!rank) {
    throw new functions.https.HttpsError('permission-denied', 'Vanguard authority required.');
  }
  // P0 #11 — must be assigned to this tournament (Commander+ can override).
  const RANK_OVERRIDE = new Set(['commander', 'overseer']);
  if (modData.role !== 'admin' && !RANK_OVERRIDE.has(rank)) {
    const assignSnap = await db.collection('tournament_assignments')
      .where('tournamentId', '==', tournamentId)
      .where('vanguardUid', '==', modUid)
      .where('status', '==', 'active')
      .limit(1).get();
    if (assignSnap.empty) {
      throw new functions.https.HttpsError('permission-denied',
        'You are not assigned to this tournament. Commander rank or assignment required.');
    }
  }
  const mRef = db.collection('tournaments').doc(tournamentId).collection('matches').doc(matchId);
  const mSnap = await mRef.get();
  if (!mSnap.exists) throw new functions.https.HttpsError('not-found', 'Match not found.');
  const m = mSnap.data();
  if (m.player1 !== sideUid && m.player2 !== sideUid) {
    throw new functions.https.HttpsError('invalid-argument', 'sideUid is not a participant.');
  }
  await mRef.update({
    [`verifyState.${sideUid}.status`]: verdict,
    [`verifyState.${sideUid}.source`]: 'mod',
    [`verifyState.${sideUid}.at`]: FieldValue.serverTimestamp(),
    [`verifyState.${sideUid}.modUid`]: modUid,
  });
  // Audit log.
  await db.collection('vanguard_actions').add({
    actorUid: modUid,
    actorRank: rank,
    action: verdict === 'verified' ? 'match_player_verified' : 'match_player_rejected',
    targetUid: sideUid,
    tournamentId, matchId,
    createdAt: FieldValue.serverTimestamp(),
  });
  await notifyOtherSide(tournamentId, matchId, sideUid, m, verdict);
  // If both sides now verified, ping both players that the match is live.
  if (verdict === 'verified') await pingBothIfReady(tournamentId, matchId);
  return { ok: true };
});

// ─── ocrVerifyMatchPlayer ────────────────────────────────────────────────
// Called by the OCR worker (vergr-ocr on Hetzner). Service-account auth — no
// req.auth. Caller MUST supply the shared secret in req.data.token.
exports.ocrVerifyMatchPlayer = functions.https.onCall({ region: REGION }, async (req) => {
  const expected = process.env.OCR_VERIFY_TOKEN;
  const { token, tournamentId, matchId, sideUid, lobbyCode } = req.data || {};
  if (!expected || token !== expected) {
    throw new functions.https.HttpsError('permission-denied', 'OCR service token required.');
  }
  if (!tournamentId || !matchId || !sideUid || !lobbyCode) {
    throw new functions.https.HttpsError('invalid-argument', 'tournamentId + matchId + sideUid + lobbyCode required.');
  }
  const mRef = db.collection('tournaments').doc(tournamentId).collection('matches').doc(matchId);
  const mSnap = await mRef.get();
  if (!mSnap.exists) throw new functions.https.HttpsError('not-found', 'Match not found.');
  const m = mSnap.data();
  if (m.lobbyCode !== lobbyCode) {
    throw new functions.https.HttpsError('failed-precondition', 'Lobby code does not match.');
  }
  if (m.player1 !== sideUid && m.player2 !== sideUid) {
    throw new functions.https.HttpsError('invalid-argument', 'sideUid is not a participant.');
  }
  await mRef.update({
    [`verifyState.${sideUid}.status`]: 'verified',
    [`verifyState.${sideUid}.source`]: 'ocr',
    [`verifyState.${sideUid}.at`]: FieldValue.serverTimestamp(),
  });
  await notifyOtherSide(tournamentId, matchId, sideUid, m, 'verified');
  await pingBothIfReady(tournamentId, matchId);
  return { ok: true };
});

// ─── vanguardHeartbeat ───────────────────────────────────────────────────
// Mod app pings every 20s while assigned. Writes lastSeenAt on the
// tournament_assignments doc so the HUD MOD light goes green within
// the freshness window (60s). Bounded write rate via min-interval guard.
exports.vanguardHeartbeat = functions.https.onCall({ region: REGION }, async (req) => {
  if (!req.auth) throw new functions.https.HttpsError('unauthenticated', 'Sign in required.');
  const uid = req.auth.uid;
  const { tournamentId } = req.data || {};
  if (!tournamentId) throw new functions.https.HttpsError('invalid-argument', 'tournamentId required.');
  const u = await db.collection('users').doc(uid).get();
  const ud = u.exists ? u.data() : {};
  const rank = ud.vanguard?.rank || (ud.role === 'admin' ? 'overseer' : null);
  if (!rank) throw new functions.https.HttpsError('permission-denied', 'Vanguard only.');
  // Find the active assignment doc for this mod + tournament; admins are
  // implicitly assigned everywhere — create an ephemeral doc keyed by uid.
  const q = await db.collection('tournament_assignments')
    .where('tournamentId', '==', tournamentId)
    .where('vanguardUid', '==', uid).limit(1).get();
  let ref;
  if (!q.empty) {
    ref = q.docs[0].ref;
  } else if (ud.role === 'admin') {
    ref = db.collection('tournament_assignments').doc(`admin_${tournamentId}_${uid}`);
    await ref.set({
      tournamentId, vanguardUid: uid, status: 'active', rank: 'admin',
      createdAt: FieldValue.serverTimestamp(),
    }, { merge: true });
  } else {
    throw new functions.https.HttpsError('permission-denied', 'No active assignment for this tournament.');
  }
  await ref.update({ lastSeenAt: FieldValue.serverTimestamp() });
  return { ok: true };
});

async function notifyOtherSide(tournamentId, matchId, sideUid, m, verdict) {
  const otherUid = sideUid === m.player1 ? m.player2 : m.player1;
  if (!otherUid) return;
  const titleByVerdict = {
    verified:     'Opponent verified — ready to play',
    self_attested:'Opponent attested they displayed the code',
    attested:     'Opponent attested they displayed the code',
    rejected:     'Opponent verification rejected — mod will follow up',
  };
  await db.collection('notifications').add({
    recipientId: otherUid,
    type: 'tournament_match_verified',
    title: titleByVerdict[verdict] || 'Opponent verification updated',
    body: `Match ${m.matchNumber || ''} — tap to view.`,
    data: { tournamentId, matchId, verdict },
    actionUrl: `/tournaments/${tournamentId}/match/${matchId}`,
    read: false,
    createdAt: FieldValue.serverTimestamp(),
  });
}

async function pingBothIfReady(tournamentId, matchId) {
  const mRef = db.collection('tournaments').doc(tournamentId).collection('matches').doc(matchId);
  const m = (await mRef.get()).data();
  if (!m) return;
  // "Engaged" = verified (OCR/mod, high trust) OR self_attested (low trust,
  // but the result-report path enforces its own gates). Requiring strictly
  // 'verified' here deadlocked the default case: no OCR stream + no assigned
  // mod meant bothVerifiedAt never flipped and the play/report UI never showed.
  const engaged = (uid) => {
    const st = (m.verifyState || {})[uid]?.status;
    return st === 'verified' || st === 'self_attested';
  };
  if (!engaged(m.player1) || !engaged(m.player2)) return;
  if (m.bothVerifiedAt) return; // idempotent
  // Flip the match live. `in_progress` is what the live-score OCR loop, the
  // live cheat sampler, spectator "match started" pushes, and the mod claim
  // surfaces all query for — leaving matches on 'pending' kept all of that
  // automation dormant.
  const update = { bothVerifiedAt: FieldValue.serverTimestamp() };
  if (!m.status || m.status === 'pending') {
    update.status = 'in_progress';
    update.startedAt = FieldValue.serverTimestamp();
  }
  await mRef.update(update);
  const batch = db.batch();
  for (const uid of [m.player1, m.player2]) {
    const ref = db.collection('notifications').doc();
    batch.set(ref, {
      recipientId: uid,
      type: 'tournament_match_ready',
      title: 'Both sides verified — play your match',
      body: `Match ${m.matchNumber || ''} is live.`,
      data: { tournamentId, matchId },
      actionUrl: `/tournaments/${tournamentId}/match/${matchId}`,
      read: false,
      createdAt: FieldValue.serverTimestamp(),
    });
  }
  await batch.commit();
}

// ─── proposeMatchReschedule / respondMatchReschedule (NT2) ────────────────
// Either player proposes a new start time; the other accepts/declines. On
// accept we stamp `rescheduledUntil` (ms) which detectMatchTimeouts honours,
// so an agreed delay never causes an auto-forfeit.
exports.proposeMatchReschedule = functions.https.onCall({ region: REGION }, async (req) => {
  if (!req.auth) throw new functions.https.HttpsError('unauthenticated', 'Sign in required.');
  const uid = req.auth.uid;
  const { tournamentId, matchId, proposedStartMs } = req.data || {};
  if (!tournamentId || !matchId || !proposedStartMs) {
    throw new functions.https.HttpsError('invalid-argument', 'tournamentId + matchId + proposedStartMs required.');
  }
  const start = Number(proposedStartMs);
  const now = Date.now();
  if (!Number.isFinite(start) || start <= now) {
    throw new functions.https.HttpsError('invalid-argument', 'proposedStartMs must be a future time.');
  }
  if (start > now + 6 * 60 * 60 * 1000) {
    throw new functions.https.HttpsError('invalid-argument', 'Reschedule cannot be more than 6 hours out.');
  }
  const mRef = db.collection('tournaments').doc(tournamentId).collection('matches').doc(matchId);
  const mSnap = await mRef.get();
  if (!mSnap.exists) throw new functions.https.HttpsError('not-found', 'Match not found.');
  const m = mSnap.data();
  if (m.player1 !== uid && m.player2 !== uid) {
    throw new functions.https.HttpsError('permission-denied', 'Not your match.');
  }
  if (['completed', 'cancelled', 'forfeited'].includes(m.status)) {
    throw new functions.https.HttpsError('failed-precondition', 'Match already finished.');
  }
  await mRef.update({
    rescheduleProposal: {
      byUid: uid, proposedStartMs: start, status: 'pending', at: FieldValue.serverTimestamp(),
    },
  });
  const otherUid = uid === m.player1 ? m.player2 : m.player1;
  if (otherUid) {
    await db.collection('notifications').add({
      recipientId: otherUid, type: 'tournament_match_reschedule',
      title: 'Opponent proposed a new match time',
      body: 'Your opponent wants to reschedule. Open the match to accept or decline.',
      data: { tournamentId, matchId, proposedStartMs: String(start) },
      actionUrl: `/tournaments/${tournamentId}/match/${matchId}`,
      read: false, createdAt: FieldValue.serverTimestamp(),
    });
  }
  return { ok: true };
});

exports.respondMatchReschedule = functions.https.onCall({ region: REGION }, async (req) => {
  if (!req.auth) throw new functions.https.HttpsError('unauthenticated', 'Sign in required.');
  const uid = req.auth.uid;
  const { tournamentId, matchId, accept } = req.data || {};
  if (!tournamentId || !matchId || typeof accept !== 'boolean') {
    throw new functions.https.HttpsError('invalid-argument', 'tournamentId + matchId + accept (boolean) required.');
  }
  const mRef = db.collection('tournaments').doc(tournamentId).collection('matches').doc(matchId);
  const mSnap = await mRef.get();
  if (!mSnap.exists) throw new functions.https.HttpsError('not-found', 'Match not found.');
  const m = mSnap.data();
  if (m.player1 !== uid && m.player2 !== uid) {
    throw new functions.https.HttpsError('permission-denied', 'Not your match.');
  }
  const prop = m.rescheduleProposal;
  if (!prop || prop.status !== 'pending') {
    throw new functions.https.HttpsError('failed-precondition', 'No pending reschedule request.');
  }
  if (prop.byUid === uid) {
    throw new functions.https.HttpsError('failed-precondition', 'The other player must respond, not the proposer.');
  }
  const update = {
    'rescheduleProposal.status': accept ? 'accepted' : 'declined',
    'rescheduleProposal.respondedAt': FieldValue.serverTimestamp(),
  };
  if (accept) update.rescheduledUntil = prop.proposedStartMs;
  await mRef.update(update);
  if (prop.byUid) {
    await db.collection('notifications').add({
      recipientId: prop.byUid, type: 'tournament_match_reschedule',
      title: accept ? 'Reschedule accepted' : 'Reschedule declined',
      body: accept
        ? 'Your opponent agreed to the new match time.'
        : 'Your opponent declined the new time. Play at the scheduled time.',
      data: { tournamentId, matchId },
      actionUrl: `/tournaments/${tournamentId}/match/${matchId}`,
      read: false, createdAt: FieldValue.serverTimestamp(),
    });
  }
  return { ok: true, accepted: accept };
});

// ─── uploadDisputeEvidence (NT6) ──────────────────────────────────────────
// A participant in a disputed match submits a result screenshot (already
// uploaded to R2 client-side). Stored per-side; the other side is nudged to
// upload theirs so a mod can resolve.
exports.uploadDisputeEvidence = functions.https.onCall({ region: REGION }, async (req) => {
  if (!req.auth) throw new functions.https.HttpsError('unauthenticated', 'Sign in required.');
  const uid = req.auth.uid;
  const { tournamentId, matchId, evidenceUrl, note = '' } = req.data || {};
  if (!tournamentId || !matchId || !evidenceUrl) {
    throw new functions.https.HttpsError('invalid-argument', 'tournamentId + matchId + evidenceUrl required.');
  }
  if (!/^https:\/\//.test(evidenceUrl)) {
    throw new functions.https.HttpsError('invalid-argument', 'evidenceUrl must be an https URL.');
  }
  const mRef = db.collection('tournaments').doc(tournamentId).collection('matches').doc(matchId);
  const mSnap = await mRef.get();
  if (!mSnap.exists) throw new functions.https.HttpsError('not-found', 'Match not found.');
  const m = mSnap.data();
  if (m.player1 !== uid && m.player2 !== uid) {
    throw new functions.https.HttpsError('permission-denied', 'Not your match.');
  }
  await mRef.update({
    [`disputeEvidence.${uid}`]: {
      url: evidenceUrl, note: String(note).slice(0, 500), at: FieldValue.serverTimestamp(),
    },
  });
  const otherUid = uid === m.player1 ? m.player2 : m.player1;
  if (otherUid) {
    await db.collection('notifications').add({
      recipientId: otherUid, type: 'tournament_dispute_evidence',
      title: 'Opponent submitted dispute evidence',
      body: 'Upload your own result screenshot so a mod can resolve the dispute.',
      data: { tournamentId, matchId },
      actionUrl: `/tournaments/${tournamentId}/match/${matchId}`,
      read: false, createdAt: FieldValue.serverTimestamp(),
    });
  }
  return { ok: true };
});

// ─── setMatchFollow (DS7) ────────────────────────────────────────────────
// A spectator follows/unfollows a specific match. When the match flips to
// in_progress, tournamentMatchFollowerPush notifies everyone in
// `match.spectatorFollowers`. Stored as an array (spectator counts per match
// are small). Idempotent via arrayUnion/arrayRemove.
exports.setMatchFollow = functions.https.onCall({ region: REGION }, async (req) => {
  if (!req.auth) throw new functions.https.HttpsError('unauthenticated', 'Sign in required.');
  const { tournamentId, matchId, follow } = req.data || {};
  if (!tournamentId || !matchId) {
    throw new functions.https.HttpsError('invalid-argument', 'tournamentId + matchId required.');
  }
  const uid = req.auth.uid;
  const mRef = db.collection('tournaments').doc(tournamentId).collection('matches').doc(matchId);
  const mSnap = await mRef.get();
  if (!mSnap.exists) throw new functions.https.HttpsError('not-found', 'Match not found.');
  await mRef.update({
    spectatorFollowers: follow
      ? FieldValue.arrayUnion(uid)
      : FieldValue.arrayRemove(uid),
  });
  return { ok: true, following: !!follow };
});

// ─── thankMatchMod (IM4) ─────────────────────────────────────────────────
// A player thanks the moderator who decided their match. Writes a
// notification to the mod. Caller must be a participant in the match.
exports.thankMatchMod = functions.https.onCall({ region: REGION }, async (req) => {
  if (!req.auth) throw new functions.https.HttpsError('unauthenticated', 'Sign in required.');
  const { tournamentId, matchId } = req.data || {};
  if (!tournamentId || !matchId) {
    throw new functions.https.HttpsError('invalid-argument', 'tournamentId + matchId required.');
  }
  const uid = req.auth.uid;
  const mRef = db.collection('tournaments').doc(tournamentId).collection('matches').doc(matchId);
  const mSnap = await mRef.get();
  if (!mSnap.exists) throw new functions.https.HttpsError('not-found', 'Match not found.');
  const m = mSnap.data();
  if (m.player1 !== uid && m.player2 !== uid) {
    throw new functions.https.HttpsError('permission-denied', 'Only a player in this match can thank the mod.');
  }
  const modUid = m.claimedModeratorId || m.winnerCalledBy || m.calledBy || null;
  if (!modUid) throw new functions.https.HttpsError('failed-precondition', 'No moderator on record for this match.');
  // One thank-you per player per match.
  const flagKey = `modThanks.${uid}`;
  if (m[flagKey]) return { ok: true, alreadyThanked: true };

  let name = 'A player';
  try {
    const u = await db.collection('users').doc(uid).get();
    name = u.data()?.username || u.data()?.displayName || name;
  } catch { /* ignore */ }

  const batch = db.batch();
  batch.set(db.collection('notifications').doc(), {
    recipientId: modUid, type: 'tournament_mod_thanks',
    title: 'A player thanked you',
    body: `${name} thanked you for calling their match. Nice work.`,
    data: { tournamentId, matchId },
    actionUrl: `/tournaments/${tournamentId}/match/${matchId}`,
    read: false, createdAt: FieldValue.serverTimestamp(),
  });
  batch.update(mRef, { [flagKey]: FieldValue.serverTimestamp() });
  await batch.commit();
  return { ok: true };
});
