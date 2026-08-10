// functions/wrappers/index.js
// Tier B integration registry — unofficial / community wrappers around games
// that don't expose a first-party developer API for tournament result data.
//
// Each wrapper exports:
//   - id           : short slug ('overwatch2', 'apex', 'rocketleague', ...)
//   - displayName  : human-readable
//   - tier         : 'B' (unofficial) — or 'A' once a first-party API ships
//   - healthCheck()             : ping the upstream; throw on failure
//   - fetchPlayerStats(handle)  : current snapshot for a player
//   - statsDelta(before, after) : returns { winnerSide, gamesPlayed } or null
//
// The wrapper-health monitor (functions/wrapperMonitor.js) iterates this
// registry every 30 minutes and writes an alert to `wrapper_alerts` if a
// wrapper's healthCheck throws. The admin dashboard surfaces those alerts.
//
// Per-tournament-match polling (snapshot pre-match → poll deltas after) is
// not wired yet — that's the next layer up. For now wrappers expose just
// the building blocks.

const overwatch2 = require('./overwatch2');
const apex       = require('./apex');

const REGISTRY = {
  [overwatch2.id]: overwatch2,
  [apex.id]:       apex,
};

// Aggregate of all secrets declared by any registered wrapper. The health
// monitor binds these so each wrapper's `process.env.<KEY>` is populated.
function collectSecrets() {
  const out = [];
  for (const w of Object.values(REGISTRY)) {
    if (Array.isArray(w.secrets)) out.push(...w.secrets);
  }
  return out;
}

function listWrappers() {
  return Object.values(REGISTRY);
}

function getWrapper(id) {
  return REGISTRY[id] || null;
}

// Map between the user-facing tournament `game` strings (set in the
// CreateTournamentScreen GAMES list) and the wrapper id that handles
// auto-result detection for that game. Lowercased lookup.
const GAME_TO_WRAPPER = {
  'overwatch 2': 'overwatch2',
  'overwatch2':  'overwatch2',
  'ow2':         'overwatch2',
  'apex legends': 'apex',
  'apex':         'apex',
};

function getWrapperForGame(gameName) {
  if (!gameName) return null;
  const id = GAME_TO_WRAPPER[String(gameName).trim().toLowerCase()];
  return id ? REGISTRY[id] : null;
}

// Which `linkedAccounts.<platform>` field holds the handle for a given
// wrapper. The polling scanner reads this to look up each player's handle
// before fetching stats. Returns { platformKey, fieldOnAccount } where
// `fieldOnAccount` is either null (account is stored as a plain string
// like 'Name#1234') or the property name within the account object.
const WRAPPER_HANDLE_LOCATION = {
  overwatch2: { platformKey: 'battlenet', fieldOnAccount: null }, // BattleTag string
  apex:       { platformKey: 'origin',    fieldOnAccount: null }, // Origin/Steam handle
};

function getHandleLocation(wrapperId) {
  return WRAPPER_HANDLE_LOCATION[wrapperId] || null;
}

module.exports = {
  REGISTRY,
  listWrappers,
  getWrapper,
  getWrapperForGame,
  getHandleLocation,
  collectSecrets,
};
