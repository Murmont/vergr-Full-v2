// Tournament AI moderation orchestrator.
//
// Phase 1 (this file): receives signals from three sources and computes
// consensus, then stamps the result onto the tournament_assignments doc
// for the Moderation Room UI.
//
//   Signal 1 — OBS overlay (built now). Streamer presses a hotkey OR clicks
//     a button on the VERGR overlay tab → POSTs to submitTournamentOverlay
//     with the overlayToken + claimed winnerId.
//
//   Signal 2 — Tesseract OCR (Phase 1B, deferred). Hetzner box extracts a
//     frame from the live HLS stream + runs Tesseract → POSTs to a secured
//     internal endpoint with the OCR text. Backend matches text against
//     per-game cues and stamps the signal.
//
//   Signal 3 — Google Vision OCR (Phase 1B, deferred). Cloud Function pulls
//     the same frame, sends to Vision API with the per-game prompt, parses
//     the JSON response, stamps the signal.
//
// Consensus is computed every time a signal lands. Confidence = how many
// signals agreed on the same winner:
//   3-of-3: high
//   2-of-3: medium
//   1-of-3 or disagreement: low
//   0-of-3: none

const functions = require('firebase-functions/v2');
const admin = require('firebase-admin');
const { FieldValue } = require('firebase-admin/firestore');
const { defineSecret } = require('firebase-functions/params');
const { promptForGame } = require('./aiPrompts');

const DB = 'vgrdb';
const REGION = 'europe-west1';

// Phase 1B secrets — Google Vision API key + Hetzner OCR shared secret.
const GOOGLE_VISION_API_KEY = defineSecret('GOOGLE_VISION_API_KEY');
const VERGR_OCR_SHARED_SECRET = defineSecret('VERGR_OCR_SHARED_SECRET');

const HETZNER_OCR_URL = 'https://sfu.vergr.app/ocr-internal/ocr';
const VISION_URL = (key) => `https://vision.googleapis.com/v1/images:annotate?key=${encodeURIComponent(key)}`;

// ───────────────────────────────────────────────────────────
// Consensus computation
// ───────────────────────────────────────────────────────────
// 2-signal consensus: Tesseract + Vision OCR. The OBS overlay signal was
// REMOVED 2026-05-17 — it was player-controllable and money is on the line.
// The overlay is now display-only (HUD for viewers); winners are called by
// Vanguard mods in the Moderation Room, AI-assisted by these two OCR signals
// that read what's actually on screen.
function computeConsensus(signals) {
  const tallies = {};
  let totalSignals = 0;
  for (const key of ['tesseract', 'vision']) {
    const s = signals?.[key];
    if (!s || !s.winnerId) continue;
    totalSignals++;
    tallies[s.winnerId] = (tallies[s.winnerId] || 0) + 1;
  }

  if (totalSignals === 0) {
    return { confidence: 'none', suggestedWinnerId: null, agreementCount: 0, totalSignals: 0 };
  }

  let topWinner = null;
  let topCount = 0;
  for (const [winnerId, count] of Object.entries(tallies)) {
    if (count > topCount) { topCount = count; topWinner = winnerId; }
  }

  let confidence;
  if (topCount === 2) confidence = 'high';      // both OCR sources agree
  else if (topCount === 1 && totalSignals === 2) confidence = 'low';  // disagreement
  else confidence = 'medium';                    // only one source returned a signal

  return { confidence, suggestedWinnerId: topWinner, agreementCount: topCount, totalSignals };
}

// Find the active assignment + match for a tournament. The overlay POST
// doesn't know match IDs directly — it knows the tournament. We pick the
// in-progress (or pending) match that's the most recently active.
async function findActiveMatch(db, tournamentId) {
  const matchesSnap = await db.collection('tournaments').doc(tournamentId).collection('matches')
    .where('status', 'in', ['pending', 'in_progress', 'awaiting_confirmation', 'disputed'])
    .limit(50)
    .get();
  if (matchesSnap.empty) return null;
  // Prefer disputed > awaiting_confirmation > in_progress > pending
  const priority = { disputed: 0, awaiting_confirmation: 1, in_progress: 2, pending: 3 };
  const sorted = matchesSnap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => {
    const pa = priority[a.status] ?? 99;
    const pb = priority[b.status] ?? 99;
    if (pa !== pb) return pa - pb;
    return (a.matchNumber || 0) - (b.matchNumber || 0);
  });
  return sorted[0];
}

async function findAssignmentForTournament(db, tournamentId) {
  const snap = await db.collection('tournament_assignments')
    .where('tournamentId', '==', tournamentId)
    .where('status', 'in', ['checked_in', 'in_progress'])
    .limit(1)
    .get();
  if (snap.empty) return null;
  return { id: snap.docs[0].id, ...snap.docs[0].data() };
}

// ───────────────────────────────────────────────────────────
// submitTournamentOverlay — HTTP endpoint hit by the OBS browser-source
// overlay when the streamer signals a winner. Auth is via the overlayToken
// minted at tournament creation time (NOT Firebase Auth — OBS browser
// sources can't carry an ID token).
//
// POST body: { tournamentId, overlayToken, winner: 'player1' | 'player2' | 'draw', matchId? }
// ───────────────────────────────────────────────────────────
// RETIRED 2026-05-17: this endpoint used to accept a winner declaration from
// the OBS overlay (player-controlled). That was a trust hole with money on
// the line. Endpoint now returns 410 Gone permanently. Winners are decided
// by Vanguard mods in the Moderation Room — AI assists via OCR, not via
// player button-press. We keep the function shell to return a clean error
// for any cached overlay client still hitting the old URL.
exports.submitTournamentOverlay = functions.https.onRequest(
  { region: REGION, cors: true },
  async (req, res) => {
    res.status(410).json({
      ok: false,
      error: 'This endpoint has been retired. Tournament winners are now decided exclusively by Vanguard moderators in the Moderation Room. The OBS overlay is display-only.',
      retiredAt: '2026-05-17',
    });
  }
);

// ───────────────────────────────────────────────────────────
// getOverlayConfig — small lookup endpoint used by the overlay page itself
// to validate its token + fetch the tournament + active match info.
// ───────────────────────────────────────────────────────────
exports.getOverlayConfig = functions.https.onRequest(
  { region: REGION, cors: true },
  async (req, res) => {
    try {
      const tournamentId = req.query.tournamentId || req.body?.tournamentId;
      const overlayToken = req.query.overlayToken || req.body?.overlayToken;
      if (!tournamentId || !overlayToken) {
        res.status(400).json({ ok: false, error: 'tournamentId + overlayToken required' });
        return;
      }
      const db = admin.firestore(undefined, DB);
      const tSnap = await db.collection('tournaments').doc(tournamentId).get();
      if (!tSnap.exists) {
        res.status(404).json({ ok: false, error: 'Tournament not found' });
        return;
      }
      const t = tSnap.data();
      if (t.overlayToken !== overlayToken) {
        res.status(403).json({ ok: false, error: 'Invalid overlay token' });
        return;
      }

      const match = await findActiveMatch(db, tournamentId);

      res.status(200).json({
        ok: true,
        tournament: {
          id: tournamentId,
          name: t.name,
          game: t.game,
          status: t.status,
          prizePool: t.prizePool,
          participantCount: (t.participants || []).length,
          scheduledStart: t.scheduledStart || null,
        },
        match: match ? {
          id: match.id,
          matchNumber: match.matchNumber,
          status: match.status,
          player1Id: match.player1Id,
          player2Id: match.player2Id,
          player1DisplayName: match.player1DisplayName,
          player2DisplayName: match.player2DisplayName,
        } : null,
      });
    } catch (err) {
      console.error('getOverlayConfig error', err);
      res.status(500).json({ ok: false, error: err?.message || 'internal' });
    }
  }
);

// Internal helper exported for Phase 1B (Tesseract + Vision integration).
exports._internal_computeConsensus = computeConsensus;
exports._internal_findActiveMatch = findActiveMatch;
exports._internal_findAssignmentForTournament = findAssignmentForTournament;

// ───────────────────────────────────────────────────────────
// Phase 1B — Tesseract (Hetzner) + Google Vision OCR
// ───────────────────────────────────────────────────────────

// Call the Hetzner OCR service. Returns raw OCR text + optionally the frame bytes.
async function callHetznerOcr(streamKey, game, opts = {}) {
  const token = VERGR_OCR_SHARED_SECRET.value();
  if (!token) return { ok: false, error: 'OCR shared secret not configured' };
  try {
    const r = await fetch(HETZNER_OCR_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Vergr-Token': token },
      body: JSON.stringify({
        streamKey, game,
        frameAt: 'now',
        returnFrameBase64: !!opts.returnFrameBase64,
      }),
    });
    const data = await r.json();
    if (!r.ok || !data.ok) return { ok: false, error: data.error || `HTTP ${r.status}` };
    return {
      ok: true,
      text: data.text || '',
      durationMs: data.durationMs,
      frameBase64: data.frameBase64 || null,
      frameMime: data.frameMime || null,
    };
  } catch (e) {
    return { ok: false, error: e?.message || 'network' };
  }
}

// Call Google Cloud Vision API with a base64 image, return OCR text via
// DOCUMENT_TEXT_DETECTION (handles structured scoreboards better than
// the basic TEXT_DETECTION).
async function callGoogleVision(frameBase64) {
  const apiKey = GOOGLE_VISION_API_KEY.value();
  if (!apiKey) return { ok: false, error: 'GOOGLE_VISION_API_KEY not configured' };
  if (!frameBase64) return { ok: false, error: 'No frame bytes to scan' };

  try {
    const body = {
      requests: [{
        image: { content: frameBase64 },
        features: [{ type: 'DOCUMENT_TEXT_DETECTION', maxResults: 1 }],
      }],
    };
    const r = await fetch(VISION_URL(apiKey), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!r.ok) {
      const errText = await r.text();
      return { ok: false, error: `Vision HTTP ${r.status}: ${errText.slice(0, 300)}` };
    }
    const json = await r.json();
    const ann = json?.responses?.[0]?.fullTextAnnotation;
    const text = ann?.text || '';
    return { ok: true, text: text.trim() };
  } catch (e) {
    return { ok: false, error: e?.message || 'vision network' };
  }
}

// Extract winner from raw OCR text using per-game keyword cues.
// `slot1Label` / `slot2Label` should be the human-readable names visible
// in the broadcast — squad name for squad tournaments, team name for team
// tournaments, player display name for 1v1.
function parseOcrForWinner(text, game, slot1Label, slot2Label) {
  if (!text) return null;
  const t = text.toLowerCase();
  const p1 = (slot1Label || '').toLowerCase();
  const p2 = (slot2Label || '').toLowerCase();

  // Player-name direct match — highest confidence signal.
  const nameMatch = (() => {
    if (p1 && p2) {
      // Look for "<name> wins" patterns.
      if (new RegExp(`${escapeRegex(p1)}\\s*(wins|victory|won)`, 'i').test(text)) return 'player1';
      if (new RegExp(`${escapeRegex(p2)}\\s*(wins|victory|won)`, 'i').test(text)) return 'player2';
    }
    return null;
  })();
  if (nameMatch) return { winnerSlot: nameMatch, source: 'name_match', confidence: 0.9 };

  // Generic banner cues — VICTORY/DEFEAT screens.
  if (/\bvictory\b/i.test(t) && !/defeat/i.test(t)) return { winnerSlot: 'player1', source: 'victory_banner', confidence: 0.7 };
  if (/\bdefeat\b/i.test(t) && !/victory/i.test(t)) return { winnerSlot: 'player2', source: 'defeat_banner', confidence: 0.7 };

  // CS2 / VALORANT specific — final score "13-X" or higher in MR12.
  const scoreMatch = t.match(/\b(\d{1,2})\s*[-:]\s*(\d{1,2})\b/);
  if (scoreMatch) {
    const a = Number(scoreMatch[1]);
    const b = Number(scoreMatch[2]);
    if (a >= 13 && a > b) return { winnerSlot: 'player1', source: 'score', confidence: 0.6 };
    if (b >= 13 && b > a) return { winnerSlot: 'player2', source: 'score', confidence: 0.6 };
  }

  // Dota 2
  if (/radiant\s*victory/i.test(t)) return { winnerSlot: 'player1', source: 'radiant_victory', confidence: 0.8 };
  if (/dire\s*victory/i.test(t)) return { winnerSlot: 'player2', source: 'dire_victory', confidence: 0.8 };

  // K.O. / GAME! — fighter / smash
  if (/\b(k\.?o\.?|game!)\b/i.test(t)) return { winnerSlot: null, source: 'match_end_detected', confidence: 0.3 };

  return null;
}

function escapeRegex(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

// ───────────────────────────────────────────────────────────
// analyzeTournamentMatch — callable. Fires the Hetzner OCR + Vision pass
// for an active tournament-match, stamps the consensus onto the assignment.
// ───────────────────────────────────────────────────────────
// Internal analyzer — runs the full OCR + Vision consensus pipeline for an
// assignment, stamps `aiVerdict` on the assignment doc AND mirrors the
// suggestion onto the active match's `aiSuggestion` field (so the mod-call
// gate can detect high-confidence disagreements). Called by both the
// authenticated callable below and the auto-suggest cron in
// tournamentMatchClaims.js. Pass `lastAnalyzedBy: 'cron'` for cron calls.
async function analyzeAssignmentInternal(db, assignmentId, lastAnalyzedBy = 'cron') {
  const aSnap = await db.collection('tournament_assignments').doc(assignmentId).get();
  if (!aSnap.exists) return { ok: false, error: 'Assignment not found.' };
  const a = aSnap.data();

  // Find the active match.
  const match = await findActiveMatch(db, a.tournamentId);
  if (!match) return { ok: false, error: 'No active match in this tournament.' };

  const streamsSnap = await db.collection('streams')
    .where('tournamentId', '==', a.tournamentId)
    .where('status', '==', 'live')
    .limit(1)
    .get();
  let streamKey = null;
  if (!streamsSnap.empty) streamKey = streamsSnap.docs[0].data().streamKey;
  if (!streamKey) {
    const tSnap = await db.collection('tournaments').doc(a.tournamentId).get();
    streamKey = tSnap.data()?.broadcastStreamKey || tSnap.data()?.streamKey || null;
  }
  if (!streamKey) return { ok: false, error: 'No live stream found.' };

  const tesseractRes = await callHetznerOcr(streamKey, a.game, { returnFrameBase64: true });
  const visionRes = tesseractRes.ok && tesseractRes.frameBase64
    ? await callGoogleVision(tesseractRes.frameBase64)
    : { ok: false, error: 'No frame bytes from Hetzner' };

  const slot1Label = match.squad1Name || match.team1Name || match.player1DisplayName || match.player1Name || '';
  const slot2Label = match.squad2Name || match.team2Name || match.player2DisplayName || match.player2Name || '';
  const slot1Id    = match.squad1Id   || match.team1Id   || match.player1Id;
  const slot2Id    = match.squad2Id   || match.team2Id   || match.player2Id;

  let tesseractSignal = null;
  if (tesseractRes.ok && tesseractRes.text) {
    const parsed = parseOcrForWinner(tesseractRes.text, a.game, slot1Label, slot2Label);
    if (parsed?.winnerSlot) {
      tesseractSignal = {
        winner: parsed.winnerSlot,
        winnerId: parsed.winnerSlot === 'player1' ? slot1Id : slot2Id,
        rawText: tesseractRes.text.slice(0, 500),
        source: `tesseract:${parsed.source}`,
        confidence: parsed.confidence,
        signaledAt: new Date(),
      };
    }
  }

  let visionSignal = null;
  if (visionRes.ok && visionRes.text) {
    const parsed = parseOcrForWinner(visionRes.text, a.game, slot1Label, slot2Label);
    if (parsed?.winnerSlot) {
      visionSignal = {
        winner: parsed.winnerSlot,
        winnerId: parsed.winnerSlot === 'player1' ? slot1Id : slot2Id,
        rawText: visionRes.text.slice(0, 500),
        source: `vision:${parsed.source}`,
        confidence: parsed.confidence,
        signaledAt: new Date(),
      };
    }
  }

  const existing = a.aiVerdict || {};
  const signals = { ...(existing.signals || {}) };
  if (tesseractSignal) signals.tesseract = tesseractSignal;
  if (visionSignal) signals.vision = visionSignal;
  const consensus = computeConsensus(signals);

  await db.collection('tournament_assignments').doc(assignmentId).update({
    aiVerdict: {
      ...existing,
      signals,
      confidence: consensus.confidence,
      suggestedWinnerId: consensus.suggestedWinnerId,
      agreementCount: consensus.agreementCount,
      totalSignals: consensus.totalSignals,
      analyzedAt: FieldValue.serverTimestamp(),
      activeMatchId: match.id,
      lastAnalyzedBy,
      diagnostics: {
        tesseract: tesseractRes.ok
          ? { ok: true, durationMs: tesseractRes.durationMs, textPreview: (tesseractRes.text || '').slice(0, 200) }
          : { ok: false, error: tesseractRes.error },
        vision: visionRes.ok
          ? { ok: true, textPreview: (visionRes.text || '').slice(0, 200) }
          : { ok: false, error: visionRes.error },
      },
    },
  });

  // Mirror onto the match doc — this is what vanguardCallTournamentWinner
  // reads to detect high-confidence disagreements (Commander review gate).
  if (consensus.suggestedWinnerId) {
    await db.collection('tournaments').doc(a.tournamentId)
      .collection('matches').doc(match.id).set({
        aiSuggestion: {
          suggestedWinnerId: consensus.suggestedWinnerId,
          confidence: consensus.confidence,
          agreementCount: consensus.agreementCount,
          totalSignals: consensus.totalSignals,
          analyzedAt: FieldValue.serverTimestamp(),
        },
      }, { merge: true });
  }

  return { ok: true, consensus, tesseract: tesseractRes, vision: visionRes };
}

exports._internal_analyzeAssignment = analyzeAssignmentInternal;

exports.analyzeTournamentMatch = functions.https.onCall(
  { region: REGION, secrets: [GOOGLE_VISION_API_KEY, VERGR_OCR_SHARED_SECRET] },
  async (req) => {
    if (!req.auth) throw new functions.https.HttpsError('unauthenticated', 'Sign in required.');
    const uid = req.auth.uid;
    const { assignmentId } = req.data || {};
    if (!assignmentId) throw new functions.https.HttpsError('invalid-argument', 'assignmentId required.');

    const db = admin.firestore(undefined, DB);
    const aSnap = await db.collection('tournament_assignments').doc(assignmentId).get();
    if (!aSnap.exists) throw new functions.https.HttpsError('not-found', 'Assignment not found.');
    const a = aSnap.data();

    const userSnap = await db.collection('users').doc(uid).get();
    const u = userSnap.data() || {};
    const isAdmin = u.role === 'admin';
    const isMine = a.moderatorId === uid;
    const isSenior = ['senior', 'commander', 'overseer'].includes(u.vanguard?.rank);
    if (!isAdmin && !isMine && !isSenior) {
      throw new functions.https.HttpsError('permission-denied', 'Not authorized to analyze this match.');
    }

    const result = await analyzeAssignmentInternal(db, assignmentId, uid);
    if (!result.ok) return result;
    return result;
  }
);

// LEGACY callable body retained below for diff visibility — superseded by
// analyzeAssignmentInternal above. Kept as `_legacy` so existing imports
// don't break; safe to delete in a follow-up.
const _legacy_analyzeTournamentMatch = functions.https.onCall(
  { region: REGION, secrets: [GOOGLE_VISION_API_KEY, VERGR_OCR_SHARED_SECRET] },
  async (req) => {
    if (!req.auth) throw new functions.https.HttpsError('unauthenticated', 'Sign in required.');
    const uid = req.auth.uid;
    const { assignmentId } = req.data || {};
    if (!assignmentId) throw new functions.https.HttpsError('invalid-argument', 'assignmentId required.');

    const db = admin.firestore(undefined, DB);
    const aSnap = await db.collection('tournament_assignments').doc(assignmentId).get();
    if (!aSnap.exists) throw new functions.https.HttpsError('not-found', 'Assignment not found.');
    const a = aSnap.data();

    const userSnap = await db.collection('users').doc(uid).get();
    const u = userSnap.data() || {};
    const isAdmin = u.role === 'admin';
    const isMine = a.moderatorId === uid;
    const isSenior = ['senior', 'commander', 'overseer'].includes(u.vanguard?.rank);
    if (!isAdmin && !isMine && !isSenior) {
      throw new functions.https.HttpsError('permission-denied', 'Not authorized to analyze this match.');
    }

    // Find the active match.
    const match = await findActiveMatch(db, a.tournamentId);
    if (!match) {
      return { ok: false, error: 'No active match in this tournament.' };
    }

    // Find the stream key. Look up the host's active stream tied to this tournament.
    const streamsSnap = await db.collection('streams')
      .where('tournamentId', '==', a.tournamentId)
      .where('status', '==', 'live')
      .limit(1)
      .get();
    let streamKey = null;
    if (!streamsSnap.empty) streamKey = streamsSnap.docs[0].data().streamKey;
    // Fallback: use the tournament's broadcaster stream key if stored on the doc.
    if (!streamKey) {
      const tSnap = await db.collection('tournaments').doc(a.tournamentId).get();
      streamKey = tSnap.data()?.broadcastStreamKey || tSnap.data()?.streamKey || null;
    }
    if (!streamKey) {
      return { ok: false, error: 'No live stream found for this tournament. AI analysis requires an active broadcast.' };
    }

    // Step 1: call Hetzner — single round trip that gives us OCR text AND
    // frame bytes (so we don't need a separate frame-fetch round trip for Vision).
    const tesseractRes = await callHetznerOcr(streamKey, a.game, { returnFrameBase64: true });

    // Step 2: fan Tesseract + Vision parsing in parallel (Tesseract text
    // already in hand; Vision needs the frame bytes from the same response).
    const visionRes = tesseractRes.ok && tesseractRes.frameBase64
      ? await callGoogleVision(tesseractRes.frameBase64)
      : { ok: false, error: 'No frame bytes from Hetzner' };

    // Format-aware slot labels + ids. Squad/team tournaments display the
    // squad/team name on stream; 1v1 displays the player name. We feed
    // whichever is on screen into the OCR parser AND use the matching id
    // as the winner identifier for `vanguardCallTournamentWinner`.
    const slot1Label = match.squad1Name || match.team1Name || match.player1DisplayName || match.player1Name || '';
    const slot2Label = match.squad2Name || match.team2Name || match.player2DisplayName || match.player2Name || '';
    const slot1Id    = match.squad1Id   || match.team1Id   || match.player1Id;
    const slot2Id    = match.squad2Id   || match.team2Id   || match.player2Id;

    // Parse Tesseract output for a winner slot.
    let tesseractSignal = null;
    if (tesseractRes.ok && tesseractRes.text) {
      const parsed = parseOcrForWinner(tesseractRes.text, a.game, slot1Label, slot2Label);
      if (parsed?.winnerSlot) {
        tesseractSignal = {
          winner: parsed.winnerSlot,
          winnerId: parsed.winnerSlot === 'player1' ? slot1Id : slot2Id,
          rawText: tesseractRes.text.slice(0, 500),
          source: `tesseract:${parsed.source}`,
          confidence: parsed.confidence,
          signaledAt: new Date(),
        };
      }
    }

    // Parse Vision output through the same winner-extractor — Vision tends to
    // be better on stylized fonts (game UIs) so it often catches what
    // Tesseract misses.
    let visionSignal = null;
    if (visionRes.ok && visionRes.text) {
      const parsed = parseOcrForWinner(visionRes.text, a.game, slot1Label, slot2Label);
      if (parsed?.winnerSlot) {
        visionSignal = {
          winner: parsed.winnerSlot,
          winnerId: parsed.winnerSlot === 'player1' ? slot1Id : slot2Id,
          rawText: visionRes.text.slice(0, 500),
          source: `vision:${parsed.source}`,
          confidence: parsed.confidence,
          signaledAt: new Date(),
        };
      }
    }

    // Merge signals into existing aiVerdict + recompute consensus.
    const existing = a.aiVerdict || {};
    const signals = { ...(existing.signals || {}) };
    if (tesseractSignal) signals.tesseract = tesseractSignal;
    if (visionSignal) signals.vision = visionSignal;
    const consensus = computeConsensus(signals);

    await db.collection('tournament_assignments').doc(assignmentId).update({
      aiVerdict: {
        ...existing,
        signals,
        confidence: consensus.confidence,
        suggestedWinnerId: consensus.suggestedWinnerId,
        agreementCount: consensus.agreementCount,
        totalSignals: consensus.totalSignals,
        analyzedAt: FieldValue.serverTimestamp(),
        activeMatchId: match.id,
        lastAnalyzedBy: uid,
        diagnostics: {
          tesseract: tesseractRes.ok
            ? { ok: true, durationMs: tesseractRes.durationMs, textPreview: (tesseractRes.text || '').slice(0, 200) }
            : { ok: false, error: tesseractRes.error },
          vision: visionRes.ok
            ? { ok: true, textPreview: (visionRes.text || '').slice(0, 200) }
            : { ok: false, error: visionRes.error },
        },
      },
    });

    return { ok: true, consensus, tesseract: tesseractRes, vision: visionRes };
  }
);
