// functions/gsi.js
// Valve Game State Integration (GSI) backend for CS2 and Dota 2.
//
// How it works (Valve-official, no client app, VAC-safe):
//   1. The user links their Steam account in VERGR.
//      → linkSteamAccount: stores steamId64 + generates a per-user gsiToken.
//   2. The user fetches a per-user .cfg file via getSteamGsiConfig and drops
//      it into either:
//        CS2:    Steam\steamapps\common\Counter-Strike Global Offensive\game\csgo\cfg\
//        Dota 2: Steam\steamapps\common\dota 2 beta\game\dota\cfg\gamestate_integration\
//      (Tauri / File System Access API write this for them; manual download
//      + drop is the fallback. See LinkSteamScreen on the frontend — TODO.)
//   3. From then on, the game pushes HTTP POSTs to our public webhook with
//      the player's match state. The auth token in the body identifies the
//      VERGR user.
//   4. On match end events, we resolve the active tournament match for that
//      user and call the internal report helper with source='gsi'. Bracket
//      advances immediately because GSI is a trusted source.
//
// Security:
//   - GSI tokens are 32-byte random hex stored only on the user's doc.
//   - Tokens are revocable (re-link replaces the token).
//   - Webhooks are stateless — they don't accept Firebase auth, only the
//     token-in-body pattern Valve specifies.
//   - The webhook validates that the GSI user is actually a participant in
//     a currently-active match before reporting any result.

const functions = require('firebase-functions/v2');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const admin = require('firebase-admin');
const crypto = require('crypto');

if (admin.apps.length === 0) admin.initializeApp();
const db = getFirestore('vgrdb');

const HttpsError = functions.https.HttpsError;
const tournaments = require('./tournaments');

const SUPPORTED_GAMES = new Set(['cs2', 'dota2']);

function genToken() {
  return crypto.randomBytes(32).toString('hex');
}

// ─── 1. linkSteamAccount (callable) ───────────────────────────────────
// Stores the user's Steam64 ID and generates a fresh GSI token. Calling
// this again rotates the token (any old .cfg file on disk stops working
// until they re-fetch + re-install).
exports.linkSteamAccount = functions.https.onCall(async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Must be logged in');
  const { steamId64 } = request.data || {};
  if (typeof steamId64 !== 'string' || !/^7656119\d{10}$/.test(steamId64)) {
    throw new HttpsError('invalid-argument', 'Provide a valid Steam64 ID (starts with 7656119, 17 digits)');
  }

  const gsiToken = genToken();
  await db.collection('users').doc(uid).update({
    'linkedAccounts.steam': {
      steamId64,
      gsiToken,
      cs2Linked: false,
      dota2Linked: false,
      linkedAt: FieldValue.serverTimestamp(),
    },
    updatedAt: FieldValue.serverTimestamp(),
  });

  // Also write a reverse lookup so the GSI webhook can resolve token → uid
  // without scanning the users collection. Tokens are unique per user.
  await db.collection('gsi_tokens').doc(gsiToken).set({
    uid,
    steamId64,
    createdAt: FieldValue.serverTimestamp(),
  });

  return { gsiToken };
});

exports.unlinkSteamAccount = functions.https.onCall(async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Must be logged in');
  const userRef = db.collection('users').doc(uid);
  const snap = await userRef.get();
  const old = snap.exists ? snap.data().linkedAccounts?.steam : null;
  if (old?.gsiToken) {
    await db.collection('gsi_tokens').doc(old.gsiToken).delete().catch(() => {});
  }
  await userRef.update({
    'linkedAccounts.steam': null,
    updatedAt: FieldValue.serverTimestamp(),
  });
  return { ok: true };
});

// ─── 2. getSteamGsiConfig (callable) ──────────────────────────────────
// Returns the .cfg file content + the recommended filename + the install
// path the frontend should write it to. No tokens are issued here — the
// token must already exist (linkSteamAccount).
exports.getSteamGsiConfig = functions.https.onCall(async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Must be logged in');
  const { game } = request.data || {};
  if (!SUPPORTED_GAMES.has(game)) {
    throw new HttpsError('invalid-argument', 'game must be "cs2" or "dota2"');
  }

  const snap = await db.collection('users').doc(uid).get();
  const linked = snap.exists ? snap.data().linkedAccounts?.steam : null;
  if (!linked?.gsiToken) {
    throw new HttpsError('failed-precondition', 'Link your Steam account first');
  }

  const region = 'europe-west1';
  const project = 'vergr-44494';
  const baseUrl = `https://${region}-${project}.cloudfunctions.net`;

  if (game === 'cs2') {
    const uri = `${baseUrl}/cs2GsiHook`;
    const cfg = `"VERGR CS2"
{
    "uri" "${uri}"
    "timeout" "5.0"
    "buffer" "0.1"
    "throttle" "1.0"
    "heartbeat" "30.0"
    "auth"
    {
        "token" "${linked.gsiToken}"
    }
    "data"
    {
        "provider"               "1"
        "map"                    "1"
        "round"                  "1"
        "player_id"              "1"
        "player_state"           "0"
        "player_match_stats"     "1"
        "allplayers_id"          "1"
        "allplayers_match_stats" "1"
    }
}
`;
    return {
      filename: 'gamestate_integration_vergr.cfg',
      installPath: 'Steam\\\\steamapps\\\\common\\\\Counter-Strike Global Offensive\\\\game\\\\csgo\\\\cfg\\\\',
      installPathPosix: 'Steam/steamapps/common/Counter-Strike Global Offensive/game/csgo/cfg/',
      content: cfg,
    };
  }

  // Dota 2.
  const uri = `${baseUrl}/dota2GsiHook`;
  const cfg = `"VERGR Dota 2 Integration Configuration"
{
    "uri"        "${uri}"
    "timeout"    "5.0"
    "buffer"     "0.1"
    "throttle"   "1.0"
    "heartbeat"  "30.0"
    "auth"
    {
        "token" "${linked.gsiToken}"
    }
    "data"
    {
        "provider"  "1"
        "map"       "1"
        "player"    "1"
        "hero"      "0"
        "abilities" "0"
        "items"     "0"
    }
}
`;
  return {
    filename: 'gamestate_integration_vergr.cfg',
    installPath: 'Steam\\\\steamapps\\\\common\\\\dota 2 beta\\\\game\\\\dota\\\\cfg\\\\gamestate_integration\\\\',
    installPathPosix: 'Steam/steamapps/common/dota 2 beta/game/dota/cfg/gamestate_integration/',
    content: cfg,
  };
});

// ─── 3. Webhook helpers ───────────────────────────────────────────────

// Resolve a GSI auth token to a VERGR uid. Returns null if no match.
async function resolveTokenToUid(token) {
  if (!token) return null;
  const snap = await db.collection('gsi_tokens').doc(token).get();
  return snap.exists ? snap.data().uid : null;
}

// Find the active tournament match for a given uid. Returns the first
// 'pending' or 'awaiting_confirmation' match they're a participant in, or
// null if none. We don't currently disambiguate when a user is in multiple
// tournaments at once — they shouldn't be, given match start times overlap.
async function findActiveMatchForUid(uid) {
  // Active tournaments where this user is a participant.
  const tQ = await db.collection('tournaments')
    .where('participants', 'array-contains', uid)
    .where('status', '==', 'active')
    .limit(5)
    .get();

  for (const tDoc of tQ.docs) {
    const matchesQ = await tDoc.ref.collection('matches')
      .where('status', 'in', ['pending', 'in_progress', 'awaiting_confirmation'])
      .get();
    const match = matchesQ.docs.find(d => {
      const m = d.data();
      return m.player1 === uid || m.player2 === uid;
    });
    if (match) return { tournamentId: tDoc.id, matchId: match.id, match: match.data() };
  }
  return null;
}

// Determine winner uid for a CS2 'gameover' event. Both players in the
// VERGR match must be linked to Steam — otherwise we can't auto-resolve.
// `gsiBody` is the parsed POST body from CS2.
async function resolveCs2Winner({ gsiBody, match }) {
  const map = gsiBody.map || {};
  const ct = map.team_ct || {};
  const t = map.team_t || {};
  if (typeof ct.score !== 'number' || typeof t.score !== 'number') return null;
  if (ct.score === t.score) return null; // draw — leave for manual

  // Determine which Steam IDs are on which team via allplayers.
  const allplayers = gsiBody.allplayers || {};
  const teamSteamIds = { CT: [], T: [] };
  for (const [steamId, p] of Object.entries(allplayers)) {
    if (p?.team === 'CT') teamSteamIds.CT.push(steamId);
    else if (p?.team === 'T') teamSteamIds.T.push(steamId);
  }
  const winningTeam = ct.score > t.score ? 'CT' : 'T';
  const winningSteamIds = new Set(teamSteamIds[winningTeam]);

  // Look up VERGR uids for the two match players.
  const uids = [match.player1, match.player2].filter(Boolean);
  const userDocs = await Promise.all(uids.map(u => db.collection('users').doc(u).get()));
  for (const ud of userDocs) {
    if (!ud.exists) continue;
    const sid = ud.data().linkedAccounts?.steam?.steamId64;
    if (sid && winningSteamIds.has(sid)) return ud.id;
  }
  return null;
}

// Dota 2 winner from `map.win_team` ('radiant' / 'dire').
async function resolveDota2Winner({ gsiBody, match }) {
  const winTeam = gsiBody.map?.win_team;
  if (winTeam !== 'radiant' && winTeam !== 'dire') return null;
  // Dota 2 GSI doesn't include allplayers. We rely on the reporting player's
  // team_name. Both players must report (or one player reports + the other
  // confirms manually) — same flow as CS2 1v1 effectively.
  const player = gsiBody.player || {};
  const reporterSteamId = player.steamid;
  const reporterTeam = player.team_name; // 'radiant' / 'dire' / 'spectator'
  if (!reporterSteamId || !reporterTeam) return null;

  const uids = [match.player1, match.player2].filter(Boolean);
  const userDocs = await Promise.all(uids.map(u => db.collection('users').doc(u).get()));
  // Find which VERGR uid corresponds to the reporter.
  let reporterUid = null;
  for (const ud of userDocs) {
    if (!ud.exists) continue;
    const sid = ud.data().linkedAccounts?.steam?.steamId64;
    if (sid === reporterSteamId) { reporterUid = ud.id; break; }
  }
  if (!reporterUid) return null;

  // Reporter's team won?
  if (reporterTeam === winTeam) return reporterUid;
  // Reporter lost — winner is the other player.
  return reporterUid === match.player1 ? match.player2 : match.player1;
}

// Shared webhook body. Validates token, finds match, resolves winner,
// and posts the result via the trusted internal helper.
async function handleGsiHook({ req, res, game, resolveWinner }) {
  // Cloud Functions v2 onRequest gives us req.body parsed if JSON.
  const body = req.body || {};
  const token = body?.auth?.token;
  if (!token) { res.status(401).send('missing token'); return; }

  const uid = await resolveTokenToUid(token);
  if (!uid) { res.status(401).send('unknown token'); return; }

  // Update last-seen heartbeat — useful for the link UI.
  await db.collection('gsi_tokens').doc(token).set(
    { lastSeenAt: FieldValue.serverTimestamp(), lastGame: game },
    { merge: true }
  );

  // Only consider events that actually represent an end-of-match state.
  const isCs2GameOver = game === 'cs2' && (body.map?.phase === 'gameover');
  const isDota2GameOver = game === 'dota2' && (
    body.map?.game_state === 'DOTA_GAMERULES_STATE_POST_GAME' ||
    !!body.map?.win_team
  );
  if (!isCs2GameOver && !isDota2GameOver) {
    res.status(204).send('');
    return;
  }

  const active = await findActiveMatchForUid(uid);
  if (!active) {
    // No active VERGR match — just heartbeat, ignore the result.
    res.status(204).send('');
    return;
  }

  const winnerId = await resolveWinner({ gsiBody: body, match: active.match });
  if (!winnerId) {
    res.status(202).send('cannot resolve winner');
    return;
  }

  try {
    await tournaments._internal_recordMatchResult({
      tournamentId: active.tournamentId,
      matchId: active.matchId,
      winnerId,
      reporterUid: uid,
      source: 'gsi',
    });
    res.status(200).send('ok');
  } catch (err) {
    console.error('GSI hook record failed', err?.message || err);
    res.status(500).send('record failed');
  }
}

// ─── 4. cs2GsiHook (HTTP) ─────────────────────────────────────────────
exports.cs2GsiHook = functions.https.onRequest(async (req, res) => {
  if (req.method !== 'POST') { res.status(405).send('POST only'); return; }
  await handleGsiHook({ req, res, game: 'cs2', resolveWinner: resolveCs2Winner });
});

// ─── 5. dota2GsiHook (HTTP) ───────────────────────────────────────────
exports.dota2GsiHook = functions.https.onRequest(async (req, res) => {
  if (req.method !== 'POST') { res.status(405).send('POST only'); return; }
  await handleGsiHook({ req, res, game: 'dota2', resolveWinner: resolveDota2Winner });
});
