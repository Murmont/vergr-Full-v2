// functions/wrappers/overwatch2.js
// Tier B integration for Overwatch 2 via OverFast API
// (https://overfast-api.tekrop.fr — community-maintained scraper of
// Blizzard's official career profile pages).
//
// OverFast is auth-free — no API key, just rate-limited HTTP. It exposes
// per-mode aggregate stats (wins/losses/winrate per role and overall).
// VERGR uses it for delta-based winner detection during tournament matches:
//   1. Snapshot stats at match start.
//   2. Poll for stats after the expected match duration.
//   3. The player whose `games_won` increased is the winner.
//
// Caveats:
//   - Player profile must be public on Battle.net.
//   - Stats updates can lag 5–15 minutes after a match ends.
//   - If a player plays an unrelated quickplay match in the polling window,
//     the delta is ambiguous → fall back to manual reporting.
//
// Battle.net handles use BattleTag format `Name#1234`. OverFast wants a
// dash: `Name-1234`. We normalize at the boundary.

const axios = require('axios');

const BASE = 'https://overfast-api.tekrop.fr';
const HEALTH_PROBE = `${BASE}/players/Bobble-1953`; // a known stable account

function normalizeBattleTag(tag) {
  if (!tag) throw new Error('battletag required');
  const cleaned = String(tag).trim();
  if (cleaned.includes('#')) return cleaned.replace('#', '-');
  if (cleaned.includes('-')) return cleaned;
  throw new Error(`Invalid BattleTag: ${tag} (expected Name#1234 or Name-1234)`);
}

async function healthCheck() {
  // Cheap GET. Throws if the API is down or the schema changed enough that
  // we can't even pull a known profile.
  const res = await axios.get(HEALTH_PROBE, { timeout: 8000, validateStatus: () => true });
  if (res.status !== 200) throw new Error(`OverFast health-check returned ${res.status}`);
  if (!res.data || typeof res.data !== 'object') throw new Error('OverFast returned non-JSON');
  if (!res.data.summary && !res.data.username) {
    throw new Error('OverFast schema changed — summary/username missing');
  }
  return { ok: true, latencyHint: res.headers['x-response-time'] || null };
}

async function fetchPlayerStats(battletag) {
  const tag = normalizeBattleTag(battletag);
  const res = await axios.get(`${BASE}/players/${encodeURIComponent(tag)}/stats/summary`, {
    timeout: 10000,
    validateStatus: () => true,
  });
  if (res.status === 404) throw new Error(`Player ${battletag} not found (profile may be private)`);
  if (res.status !== 200) throw new Error(`OverFast returned ${res.status}`);
  // Shape varies; we only care about overall games played + games won.
  const overall = res.data?.general || {};
  const gamesPlayed = Number(overall.games_played || 0);
  const gamesWon = Number(overall.games_won || 0);
  return {
    fetchedAt: Date.now(),
    gamesPlayed,
    gamesWon,
    winrate: overall.winrate || null,
    raw: res.data, // keep around for debugging; trim before persisting at scale
  };
}

// Compare two snapshots (same player) and return whether they won a game
// in between. Returns:
//   { played: true, won: true|false }   when we can tell
//   { played: false }                   when no game was played in between
//   null                                when the snapshots are inconsistent
function statsDelta(before, after) {
  if (!before || !after) return null;
  const playedΔ = (after.gamesPlayed || 0) - (before.gamesPlayed || 0);
  const wonΔ    = (after.gamesWon    || 0) - (before.gamesWon    || 0);
  if (playedΔ < 0 || wonΔ < 0) return null;
  if (playedΔ === 0) return { played: false };
  return { played: true, won: wonΔ > 0, gamesPlayed: playedΔ, gamesWon: wonΔ };
}

module.exports = {
  id: 'overwatch2',
  displayName: 'Overwatch 2',
  tier: 'B',
  healthCheck,
  fetchPlayerStats,
  statsDelta,
};
