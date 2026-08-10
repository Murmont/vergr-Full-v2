// VERGR tournament lobby-screenshot verification.
//
// Anti-impersonation safeguard for tournaments that don't have a
// trusted-API result detector (most non-Tier-A games). Before a match
// starts, both players upload a screenshot of their game's lobby/loadout
// screen showing the OTHER player's in-game name. Gemini Vision OCR
// confirms each side's expected handle appears in the other's image. If
// both sides verify, the match is stamped `verification: 'verified'`. If
// either side fails or doesn't submit within the window, the match goes
// to `verification: 'pending'` and a Vanguard mod sees the raw OCR text
// in the Moderation Room.
//
// Privacy: screenshots are deleted from R2 within 30 days. ToS clause
// required before public launch.

const functions = require('firebase-functions/v2');
const { defineSecret } = require('firebase-functions/params');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const defer = (_opts, fn) => fn; // cron-consolidation shim (see index.js cron5Min)
const { getFirestore, FieldValue } = require('firebase-admin/firestore');

const REGION = 'europe-west1';
const db = getFirestore('vgrdb');

const GOOGLE_VISION_API_KEY = defineSecret('GOOGLE_VISION_API_KEY');

const VISION_URL = (k) => `https://vision.googleapis.com/v1/images:annotate?key=${encodeURIComponent(k)}`;

// ─────────────────────────────────────────────────────────────────────────────
// submitLobbyScreenshot — participant uploads a lobby screenshot (R2 URL).
// We OCR it server-side via Google Vision, store the raw text + reduce
// the verdict against the OTHER player's expected handle.
// ─────────────────────────────────────────────────────────────────────────────
exports.submitLobbyScreenshot = functions.https.onCall(
  { region: REGION, secrets: [GOOGLE_VISION_API_KEY] },
  async (req) => {
    if (!req.auth) throw new functions.https.HttpsError('unauthenticated', 'Sign in required.');
    const uid = req.auth.uid;
    const { tournamentId, matchId, imageUrl } = req.data || {};
    if (!tournamentId || !matchId || !imageUrl) {
      throw new functions.https.HttpsError('invalid-argument', 'tournamentId, matchId, imageUrl required.');
    }

    // Validate participant.
    const matchRef = db.collection('tournaments').doc(tournamentId).collection('matches').doc(matchId);
    const matchSnap = await matchRef.get();
    if (!matchSnap.exists) throw new functions.https.HttpsError('not-found', 'Match not found.');
    const match = matchSnap.data();
    const isPlayer1 = match.player1 === uid;
    const isPlayer2 = match.player2 === uid;
    if (!isPlayer1 && !isPlayer2) {
      throw new functions.https.HttpsError('permission-denied', 'Not in this match.');
    }
    if (match.verification === 'verified') {
      return { ok: true, alreadyVerified: true };
    }

    // Look up the OPPONENT's expected handle. Game-aware lookup.
    const tSnap = await db.collection('tournaments').doc(tournamentId).get();
    const game = (tSnap.exists ? tSnap.data().game : null) || 'other';
    const opponentUid = isPlayer1 ? match.player2 : match.player1;
    const expectedHandle = await resolveExpectedHandle(opponentUid, game);

    // Fetch image bytes + run Vision OCR.
    let visionText = '';
    let visionError = null;
    try {
      const r = await fetch(imageUrl);
      if (!r.ok) throw new Error(`fetch ${r.status}`);
      const buf = Buffer.from(await r.arrayBuffer());
      const base64 = buf.toString('base64');
      const vis = await fetch(VISION_URL(GOOGLE_VISION_API_KEY.value()), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requests: [{
            image: { content: base64 },
            features: [{ type: 'DOCUMENT_TEXT_DETECTION', maxResults: 1 }],
          }],
        }),
      });
      const j = await vis.json();
      visionText = (j?.responses?.[0]?.fullTextAnnotation?.text || '').slice(0, 4000);
    } catch (err) {
      visionError = err?.message || 'vision-error';
    }

    // Match? Loose case-insensitive substring search; in-game handles often
    // include weird casing / spaces.
    let opponentHandleSeen = false;
    if (expectedHandle && visionText) {
      const needle = expectedHandle.toLowerCase().trim();
      const haystack = visionText.toLowerCase();
      opponentHandleSeen = needle.length >= 3 && haystack.includes(needle);
    }

    // Save per-side verification result.
    const sideKey = isPlayer1 ? 'player1' : 'player2';
    await matchRef.set({
      lobbyVerification: {
        [sideKey]: {
          submittedBy: uid,
          imageUrl,
          submittedAt: FieldValue.serverTimestamp(),
          ocrText: visionText,
          ocrError: visionError,
          opponentExpectedHandle: expectedHandle,
          opponentHandleSeen,
        },
      },
    }, { merge: true });

    // Re-read the match to compute combined verdict.
    const fresh = (await matchRef.get()).data();
    const lv = fresh.lobbyVerification || {};
    const bothSubmitted = !!(lv.player1 && lv.player2);
    let verification = match.verification || 'pending';
    if (bothSubmitted) {
      const bothSeen = lv.player1.opponentHandleSeen && lv.player2.opponentHandleSeen;
      const eitherClearlyFailed = (lv.player1.opponentExpectedHandle && !lv.player1.opponentHandleSeen) ||
                                  (lv.player2.opponentExpectedHandle && !lv.player2.opponentHandleSeen);
      verification = bothSeen ? 'verified'
                              : (eitherClearlyFailed ? 'failed' : 'pending');
    }
    await matchRef.update({ verification, verificationUpdatedAt: FieldValue.serverTimestamp() });

    return {
      ok: true,
      mySideVerified: opponentHandleSeen,
      bothSubmitted,
      verification,
    };
  },
);

// Resolve the expected in-game handle for `uid` given the tournament's game.
// Falls back to the user's Vergr displayName when no platform handle is set
// (Vergr handle = the name a Vanguard mod will see + can match against).
async function resolveExpectedHandle(uid, game) {
  if (!uid) return null;
  const snap = await db.collection('users').doc(uid).get();
  if (!snap.exists) return null;
  const u = snap.data();
  const linked = u.linkedAccounts || {};

  // Game-aware account lookup. Falls through to a generic "best handle".
  const g = String(game).toLowerCase();
  const PRIORITY = (() => {
    if (g.includes('cs') || g.includes('dota')) return ['steam'];
    if (g.includes('valorant') || g.includes('league')) return ['riot'];
    if (g.includes('overwatch')) return ['battlenet'];
    if (g.includes('apex')) return ['origin', 'steam'];
    if (g.includes('fortnite') || g.includes('rocket')) return ['epic'];
    return ['steam', 'battlenet', 'riot', 'epic', 'origin'];
  })();

  for (const plat of PRIORITY) {
    const acc = linked[plat];
    if (!acc) continue;
    const h = typeof acc === 'string'
      ? acc
      : (acc.username || acc.handle || acc.battleTag || acc.riotId || acc.steamId64);
    if (h) return String(h);
  }
  // Fallback: Vergr handle. A reasonable proxy for identity in mod review.
  return u.displayName || u.username || null;
}

// ─────────────────────────────────────────────────────────────────────────────
// detectLobbyVerificationTimeouts — cron every 5 min. For matches in
// in_progress with status pending and started > 10 min ago, escalate
// unverified matches to a Vanguard mod for manual review.
// ─────────────────────────────────────────────────────────────────────────────
exports.detectLobbyVerificationTimeouts = defer(
  { region: REGION, schedule: 'every 5 minutes', timeZone: 'UTC' },
  async () => {
    const now = Date.now();
    // Active tournament matches that started > 10 min ago and aren't verified yet.
    const tournamentsSnap = await db.collection('tournaments')
      .where('status', 'in', ['active', 'in_progress'])
      .limit(100).get();
    for (const td of tournamentsSnap.docs) {
      const matchesSnap = await td.ref.collection('matches')
        .where('status', 'in', ['pending', 'in_progress'])
        .limit(50).get();
      for (const md of matchesSnap.docs) {
        const m = md.data();
        if (!m.startedAt) continue;
        const startedMs = m.startedAt?.toMillis?.() || 0;
        if (now - startedMs < 10 * 60_000) continue;
        if (m.verification === 'verified' || m.verification === 'escalated') continue;
        await md.ref.update({
          verification: 'escalated',
          verificationEscalatedAt: FieldValue.serverTimestamp(),
        });
      }
    }
  },
);
