// functions/wrappers/apex.js
// Tier B integration for Apex Legends via the apexlegendsapi.com public
// API (mozambiquehe.re). Community-run, free API key (register at
// https://apexlegendsapi.com/). Auth via the `auth` query parameter or
// Authorization header.
//
// Same shape as overwatch2.js: snapshot career win count before a match,
// poll afterwards, the player whose win count went up is the winner. Apex
// is a 60-player BR — for tournaments we only register a "win" if the
// player's career_wins counter increases (i.e. they got the champion
// banner). Placement-only top-X scoring is a separate feature (battle
// royale tournament format already supports manual placement entry).
//
// Caveats: profile must be public; stats updates can lag a few minutes;
// player handles are platform-specific (PC = Origin/Steam username, PS5
// = PSN ID, etc.).

const axios = require('axios');
const { defineSecret } = require('firebase-functions/params');

const APEX_API_KEY = defineSecret('APEX_API_KEY');
const BASE = 'https://api.mozambiquehe.re';
// A known stable account used for the periodic health probe. Pick something
// owned by the API maintainer (or any consistently public profile).
const HEALTH_PROBE_PLAYER = 'iiTzTimmy';
const HEALTH_PROBE_PLATFORM = 'PC';

function authHeaders() {
  const key = process.env.APEX_API_KEY;
  if (!key) throw new Error('APEX_API_KEY secret not set — register at https://apexlegendsapi.com/');
  return { Authorization: key };
}

async function healthCheck() {
  const res = await axios.get(`${BASE}/bridge`, {
    params: { version: 5, platform: HEALTH_PROBE_PLATFORM, player: HEALTH_PROBE_PLAYER },
    headers: authHeaders(),
    timeout: 8000,
    validateStatus: () => true,
  });
  if (res.status !== 200) throw new Error(`apexlegendsapi returned ${res.status}`);
  if (!res.data || res.data.Error) throw new Error(`apexlegendsapi error: ${res.data?.Error || 'unknown'}`);
  if (!res.data.global) throw new Error('apexlegendsapi schema changed — global field missing');
  return { ok: true };
}

async function fetchPlayerStats(handle, platform = 'PC') {
  if (!handle) throw new Error('player handle required');
  const res = await axios.get(`${BASE}/bridge`, {
    params: { version: 5, platform, player: handle },
    headers: authHeaders(),
    timeout: 10000,
    validateStatus: () => true,
  });
  if (res.status === 404) throw new Error(`Apex player ${handle} not found`);
  if (res.status !== 200) throw new Error(`apexlegendsapi returned ${res.status}`);
  if (res.data?.Error) throw new Error(`apexlegendsapi: ${res.data.Error}`);

  // The schema exposes `total.career_wins.value` and `total.career_kills.value`.
  // Both have varied historically; pull defensively.
  const totals = res.data?.total || {};
  const careerWins = Number(totals.career_wins?.value ?? totals.career_wins ?? 0);
  const careerKills = Number(totals.career_kills?.value ?? totals.career_kills ?? 0);
  const matchesPlayed = Number(totals.games_played?.value ?? 0);
  return {
    fetchedAt: Date.now(),
    careerWins,
    careerKills,
    matchesPlayed,
    rankedTier: res.data?.global?.rank?.rankName || null,
    raw: undefined, // intentionally drop the raw payload — large
  };
}

function statsDelta(before, after) {
  if (!before || !after) return null;
  const winsΔ = (after.careerWins || 0) - (before.careerWins || 0);
  const playedΔ = (after.matchesPlayed || 0) - (before.matchesPlayed || 0);
  if (winsΔ < 0 || playedΔ < 0) return null;
  if (playedΔ === 0) return { played: false };
  return { played: true, won: winsΔ > 0, gamesPlayed: playedΔ, gamesWon: winsΔ };
}

module.exports = {
  id: 'apex',
  displayName: 'Apex Legends',
  tier: 'B',
  secrets: [APEX_API_KEY], // declared so onSchedule/onRequest bind them
  healthCheck,
  fetchPlayerStats,
  statsDelta,
};
