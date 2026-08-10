// src/utils/tournamentTypes.js
// Tournament bracket types, prize distribution, scoring, and bracket generators.
// All 7 tournament types from the VERGR spec:
//   1. Solo Single Elimination
//   2. Solo Double Elimination
//   3. Squad Single Elimination
//   4. Squad Round Robin (League)
//   5. Battle Royale (FFA)
//   6. Swiss System
//   7. Invitational / Custom

// ---------------------------------------------------------------------------
// PLATFORM TOURNAMENT LIMITS (Riot tournament-policy compliance)
// ---------------------------------------------------------------------------
// These caps mirror the answers given to Riot Games' Production API tournament
// questionnaire. They MUST stay aligned with what was submitted to Riot —
// changing either limit upward requires a follow-up notification to Riot.
//
//   - MAX_ENTRY_FEE_COINS: per-player entry fee ceiling (~€99 retail).
//   - MAX_PRIZE_POOL_COINS: per-tournament gross pool ceiling
//     (~€5,000 / ~$5,400 USD — well under Riot's Community Competition
//     Guidelines threshold for unlicensed organizers).

export const MAX_ENTRY_FEE_COINS = 10_000;
export const MAX_PRIZE_POOL_COINS = 500_000;
export const MOD_CUT_PCT = 5; // platform/moderation fee taken from gross pool

/**
 * Validate that a tournament's entry fee × max participants doesn't exceed
 * the platform-enforced caps disclosed to Riot.
 * @param {{ entryFee:number, maxParticipants:number }} cfg
 * @returns {{ ok:true } | { ok:false, error:string, field:'entryFee'|'pool' }}
 */
export function validateTournamentLimits({ entryFee = 0, maxParticipants = 0 }) {
  const fee = Math.max(0, Math.floor(entryFee));
  const cap = Math.max(0, Math.floor(maxParticipants));
  if (fee > MAX_ENTRY_FEE_COINS) {
    return {
      ok: false,
      field: 'entryFee',
      error: `Entry fee can't exceed ${MAX_ENTRY_FEE_COINS.toLocaleString()} coins per player.`,
    };
  }
  const grossPool = fee * cap;
  if (grossPool > MAX_PRIZE_POOL_COINS) {
    return {
      ok: false,
      field: 'pool',
      error: `Prize pool would be ${grossPool.toLocaleString()} coins — platform cap is ${MAX_PRIZE_POOL_COINS.toLocaleString()} coins. Lower the entry fee or player count.`,
    };
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// BRACKET TYPE CONFIGURATION
// ---------------------------------------------------------------------------

export const BRACKET_TYPES = {
  single_elim: {
    id: 'single_elim',
    label: 'Solo Single Elimination',
    shortLabel: 'Single Elim',
    icon: 'emoji_events',
    description: 'Classic 1v1 knockout. Lose once, you\'re out.',
    mode: 'solo',
    allowedPlayers: [4, 8, 16, 32, 64, 128],
    allowByes: true,
    minPlan: 'free',
    streamRequired: false,
  },
  double_elim: {
    id: 'double_elim',
    label: 'Solo Double Elimination',
    shortLabel: 'Double Elim',
    icon: 'workspace_premium',
    description: 'Winners + Losers brackets. You need to lose twice to be eliminated.',
    mode: 'solo',
    allowedPlayers: [4, 8, 16, 32, 64],
    allowByes: true,
    minPlan: 'lite',
    streamRequired: false,
  },
  squad_single_elim: {
    id: 'squad_single_elim',
    label: 'Squad Single Elimination',
    shortLabel: 'Squad Elim',
    icon: 'groups',
    description: 'Squads compete as a unit (e.g., 5v5, 3v3). Lose once, out.',
    mode: 'squad',
    allowedPlayers: [4, 8, 16, 32],
    allowByes: true,
    minPlan: 'free',
    streamRequired: false,
  },
  squad_round_robin: {
    id: 'squad_round_robin',
    label: 'Squad Round Robin',
    shortLabel: 'League',
    icon: 'leaderboard',
    description: 'Every squad plays every other squad. Standings decide the winner.',
    mode: 'squad',
    allowedPlayers: [4, 6, 8],
    allowByes: false,
    minPlan: 'lite',
    streamRequired: false,
  },
  battle_royale: {
    id: 'battle_royale',
    label: 'Battle Royale / FFA',
    shortLabel: 'Battle Royale',
    icon: 'local_fire_department',
    description: 'All players in one lobby. Placement scoring across multiple games.',
    mode: 'ffa',
    allowedPlayers: [8, 16, 24, 32, 50, 100],
    allowByes: false,
    minPlan: 'free',
    streamRequired: false,
    defaultGameCount: 3,
  },
  swiss: {
    id: 'swiss',
    label: 'Swiss System',
    shortLabel: 'Swiss',
    icon: 'hub',
    description: 'Players with similar records paired each round. Nobody is eliminated.',
    mode: 'solo',
    allowedPlayers: [8, 16, 32, 64],
    allowByes: true,
    minPlan: 'lite',
    streamRequired: false,
  },
  invitational: {
    id: 'invitational',
    label: 'Invitational / Custom',
    shortLabel: 'Invitational',
    icon: 'star',
    description: 'Creator controls everything. Seeding, pairings, prizes — all manual.',
    mode: 'custom',
    allowedPlayers: [2, 4, 6, 8, 12, 16, 24, 32],
    allowByes: true,
    minPlan: 'pro',
    streamRequired: true,
    customPrizes: true,
  },
};

export const BRACKET_TYPE_LIST = Object.values(BRACKET_TYPES);

// ---------------------------------------------------------------------------
// PRIZE DISTRIBUTION
// ---------------------------------------------------------------------------
// Percentages are of the gross pool. Mod cut is taken first, then winners are
// paid from the remainder. Squad treasury is skimmed from each winner's share.

// Winner-takes-all (minus 5% mod cut) for every bracket type. Solo = winner's
// wallet; squad = winning squad's treasury (handled in finalizeInternal via
// `isSquadMode`). The multi-place idea lives only in Tournament Points (TP)
// awarded to every participant in `finalizeInternal` for the global
// leaderboard; coins are single-winner.
export const PRIZE_DISTRIBUTION = {
  single_elim:       { splits: [{ place: 1, pct: 100, label: 'Winner' }], modCut: 5, squadTreasuryPct: 0 },
  double_elim:       { splits: [{ place: 1, pct: 100, label: 'Winner' }], modCut: 5, squadTreasuryPct: 0 },
  squad_single_elim: { splits: [{ place: 1, pct: 100, label: 'Winner' }], modCut: 5, squadTreasuryPct: 100 },
  squad_round_robin: { splits: [{ place: 1, pct: 100, label: 'Winner' }], modCut: 5, squadTreasuryPct: 100 },
  battle_royale:     { splits: [{ place: 1, pct: 100, label: 'Winner' }], modCut: 5, squadTreasuryPct: 0 },
  swiss:             { splits: [{ place: 1, pct: 100, label: 'Winner' }], modCut: 5, squadTreasuryPct: 0 },
  invitational:      { splits: [{ place: 1, pct: 100, label: 'Winner' }], modCut: 5, squadTreasuryPct: 0 },
};

/**
 * Compute prize breakdown given a gross pool (coins) for a bracket type.
 * @param {number} pool Gross entry-fee pool in coins.
 * @param {string} bracketType Key in PRIZE_DISTRIBUTION.
 * @param {object} opts { squadTreasury?: boolean, customSplits?: Array<{place, pct}> }
 * @returns {{
 *   gross: number, modCut: number, netPool: number,
 *   payouts: Array<{ place, label, pct, gross, treasury, player }>
 * }}
 */
export function computePrizeBreakdown(pool, bracketType, opts = {}) {
  const cfg = PRIZE_DISTRIBUTION[bracketType];
  if (!cfg) throw new Error(`Unknown bracket type: ${bracketType}`);
  const gross = Math.max(0, Math.floor(pool || 0));
  const modCut = Math.floor(gross * (cfg.modCut / 100));
  const netPool = gross - modCut;
  const splits = cfg.custom ? (opts.customSplits || []) : cfg.splits;
  const treasuryPct = opts.squadTreasury ? cfg.squadTreasuryPct : 0;

  const payouts = splits.map(s => {
    const grossPayout = Math.floor(netPool * (s.pct / 100));
    const treasury = Math.floor(grossPayout * (treasuryPct / 100));
    const player = grossPayout - treasury;
    return { place: s.place, label: s.label, pct: s.pct, gross: grossPayout, treasury, player };
  });
  return { gross, modCut, netPool, payouts };
}

// ---------------------------------------------------------------------------
// BATTLE ROYALE SCORING
// ---------------------------------------------------------------------------

export const BR_PLACEMENT_POINTS = [15, 12, 10, 8, 6, 5, 4, 3, 2, 1];

/** Points awarded for a given placement (1-indexed). 11th+ = 0 points. */
export function pointsForPlacement(place) {
  if (!place || place < 1) return 0;
  if (place > BR_PLACEMENT_POINTS.length) return 0;
  return BR_PLACEMENT_POINTS[place - 1];
}

/**
 * Aggregate BR standings from per-game placement results.
 * @param {Array<{ playerId, gameId, place }>} results
 * @returns sorted standings array: [{ playerId, total, games: [{gameId, place, pts}] }]
 */
export function computeBRStandings(results = []) {
  const byPlayer = new Map();
  for (const r of results) {
    const entry = byPlayer.get(r.playerId) || { playerId: r.playerId, total: 0, games: [] };
    const pts = pointsForPlacement(r.place);
    entry.games.push({ gameId: r.gameId, place: r.place, pts });
    entry.total += pts;
    byPlayer.set(r.playerId, entry);
  }
  return [...byPlayer.values()].sort((a, b) => b.total - a.total);
}

// ---------------------------------------------------------------------------
// ROUND ROBIN STANDINGS
// ---------------------------------------------------------------------------
// Points: Win = 3, Draw = 1, Loss = 0.
// Tiebreakers: head-to-head → point differential → coin flip.

export const RR_POINTS = { win: 3, draw: 1, loss: 0 };

/**
 * @param {Array<{ home, away, homeScore, awayScore, played }>} matches
 * @returns standings [{ teamId, w, d, l, pts, gf, ga, diff }]
 */
export function computeRoundRobinStandings(matches = []) {
  const byTeam = new Map();
  const ensure = id => {
    if (!byTeam.has(id)) byTeam.set(id, { teamId: id, w: 0, d: 0, l: 0, pts: 0, gf: 0, ga: 0, diff: 0 });
    return byTeam.get(id);
  };
  const h2h = new Map(); // `${a}|${b}` => pts a got vs b

  for (const m of matches) {
    if (!m.played) { ensure(m.home); ensure(m.away); continue; }
    const home = ensure(m.home);
    const away = ensure(m.away);
    home.gf += m.homeScore; home.ga += m.awayScore;
    away.gf += m.awayScore; away.ga += m.homeScore;
    if (m.homeScore > m.awayScore) {
      home.w += 1; home.pts += RR_POINTS.win;
      away.l += 1; away.pts += RR_POINTS.loss;
      h2h.set(`${m.home}|${m.away}`, (h2h.get(`${m.home}|${m.away}`) || 0) + RR_POINTS.win);
    } else if (m.homeScore < m.awayScore) {
      away.w += 1; away.pts += RR_POINTS.win;
      home.l += 1; home.pts += RR_POINTS.loss;
      h2h.set(`${m.away}|${m.home}`, (h2h.get(`${m.away}|${m.home}`) || 0) + RR_POINTS.win);
    } else {
      home.d += 1; home.pts += RR_POINTS.draw;
      away.d += 1; away.pts += RR_POINTS.draw;
      h2h.set(`${m.home}|${m.away}`, (h2h.get(`${m.home}|${m.away}`) || 0) + RR_POINTS.draw);
      h2h.set(`${m.away}|${m.home}`, (h2h.get(`${m.away}|${m.home}`) || 0) + RR_POINTS.draw);
    }
  }

  for (const t of byTeam.values()) t.diff = t.gf - t.ga;

  return [...byTeam.values()].sort((a, b) => {
    if (b.pts !== a.pts) return b.pts - a.pts;
    // head-to-head
    const ab = h2h.get(`${a.teamId}|${b.teamId}`) || 0;
    const ba = h2h.get(`${b.teamId}|${a.teamId}`) || 0;
    if (ab !== ba) return ba - ab;
    if (b.diff !== a.diff) return b.diff - a.diff;
    return 0;
  });
}

// ---------------------------------------------------------------------------
// BRACKET GENERATORS
// ---------------------------------------------------------------------------

const isPow2 = n => (n & (n - 1)) === 0;
const nextPow2 = n => { let p = 1; while (p < n) p *= 2; return p; };

/**
 * Generate a single-elimination bracket with standard seed placement.
 * Odd/non-power-of-2 player counts get top-seed byes.
 * @param {Array<{ id, name, seed? }>} players
 * @returns {{ rounds: Array<Array<Match>>, bracket: 'single' }}
 */
export function generateSingleElim(players = []) {
  const seeded = [...players].sort((a, b) => (a.seed || 999) - (b.seed || 999));
  const size = nextPow2(seeded.length);
  const slots = new Array(size).fill(null);
  // Standard bracket seeding order for size=8: [1,8,4,5,2,7,3,6]
  const seedOrder = buildSeedOrder(size);
  seeded.forEach((p, i) => { slots[seedOrder.indexOf(i + 1)] = p; });

  const rounds = [];
  let current = [];
  for (let i = 0; i < size; i += 2) {
    current.push({
      matchId: `r1_m${i / 2}`,
      round: 1,
      home: slots[i],
      away: slots[i + 1],
      bye: !slots[i] || !slots[i + 1],
      winner: null,
      played: false,
    });
  }
  rounds.push(current);

  let r = 2;
  while (current.length > 1) {
    const next = [];
    for (let i = 0; i < current.length; i += 2) {
      next.push({
        matchId: `r${r}_m${i / 2}`,
        round: r,
        home: null,
        away: null,
        bye: false,
        winner: null,
        played: false,
      });
    }
    rounds.push(next);
    current = next;
    r += 1;
  }
  return { rounds, bracket: 'single', size };
}

/** Double-elimination: winners bracket + losers bracket + grand final. */
export function generateDoubleElim(players = []) {
  const single = generateSingleElim(players);
  const winners = single.rounds;
  const losersRoundCount = Math.max(0, (winners.length - 1) * 2 - 1);
  const losers = [];
  let losersMatchesPerRound = Math.max(1, Math.floor(winners[0].length / 2));
  for (let r = 1; r <= losersRoundCount; r += 1) {
    const round = [];
    for (let i = 0; i < losersMatchesPerRound; i += 1) {
      round.push({
        matchId: `lr${r}_m${i}`,
        round: r,
        home: null, away: null, winner: null, played: false,
      });
    }
    losers.push(round);
    // alternating rounds halve the match count
    if (r % 2 === 0) losersMatchesPerRound = Math.max(1, Math.floor(losersMatchesPerRound / 2));
  }
  const grandFinal = [{
    matchId: 'gf',
    round: 1,
    home: null, away: null,
    winner: null, played: false,
    rule: 'Losers champ must win 2 sets; Winners champ needs 1.',
  }];
  return { bracket: 'double', winners, losers, grandFinal, size: single.size };
}

/** Round-robin schedule using circle method. @param squads array. */
export function generateRoundRobin(squads = []) {
  const teams = [...squads];
  if (teams.length % 2 === 1) teams.push({ id: '__bye', name: 'BYE' });
  const n = teams.length;
  const rounds = [];
  const arr = teams.slice();
  for (let r = 0; r < n - 1; r += 1) {
    const round = [];
    for (let i = 0; i < n / 2; i += 1) {
      const home = arr[i];
      const away = arr[n - 1 - i];
      if (home.id !== '__bye' && away.id !== '__bye') {
        round.push({
          matchId: `rr_r${r + 1}_m${i}`,
          round: r + 1,
          home, away,
          homeScore: 0, awayScore: 0,
          played: false,
        });
      }
    }
    rounds.push(round);
    // rotate (keep arr[0] fixed)
    const fixed = arr[0];
    const rest = arr.slice(1);
    rest.unshift(rest.pop());
    arr.splice(0, arr.length, fixed, ...rest);
  }
  return { bracket: 'round_robin', rounds };
}

/**
 * Generate next Swiss round from current standings.
 * Pairs by record, avoiding rematches. Top half vs bottom half within bracket.
 * @param {Array<{ playerId, wins, losses, pastOpponents: string[] }>} standings
 * @param {number} round Round number starting at 1.
 */
export function generateSwissRound(standings = [], round = 1) {
  if (round === 1) {
    // random pairing
    const shuffled = [...standings].sort(() => Math.random() - 0.5);
    return buildPairings(shuffled, round);
  }
  // group by record
  const groups = new Map();
  for (const p of standings) {
    const key = `${p.wins}-${p.losses}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(p);
  }
  // sort groups by wins desc
  const groupKeys = [...groups.keys()].sort((a, b) => {
    const [aw] = a.split('-').map(Number);
    const [bw] = b.split('-').map(Number);
    return bw - aw;
  });
  const matches = [];
  let floater = null;
  for (const key of groupKeys) {
    let bucket = groups.get(key);
    if (floater) { bucket = [floater, ...bucket]; floater = null; }
    if (bucket.length % 2 === 1) {
      floater = bucket.pop();
    }
    // pair within bucket avoiding rematches (greedy)
    const paired = pairGreedyNoRematch(bucket);
    paired.forEach((pair, i) => {
      matches.push({
        matchId: `sw_r${round}_m${matches.length}`,
        round,
        home: pair[0],
        away: pair[1],
        winner: null,
        played: false,
      });
    });
  }
  if (floater) {
    // auto-win bye
    matches.push({
      matchId: `sw_r${round}_bye`,
      round,
      home: floater,
      away: null,
      bye: true,
      winner: floater.playerId,
      played: true,
    });
  }
  return matches;
}

/** Buchholz = sum of each opponent's total wins. */
export function computeBuchholz(playerId, allResults = []) {
  const wins = new Map();
  const opponents = new Map();
  for (const r of allResults) {
    if (!r.played || !r.winner) continue;
    wins.set(r.winner, (wins.get(r.winner) || 0) + 1);
    const losers = [r.home?.playerId, r.away?.playerId].filter(id => id && id !== r.winner);
    for (const loser of losers) {
      if (!wins.has(loser)) wins.set(loser, wins.get(loser) || 0);
    }
    const a = r.home?.playerId, b = r.away?.playerId;
    if (a && b) {
      if (!opponents.has(a)) opponents.set(a, new Set());
      if (!opponents.has(b)) opponents.set(b, new Set());
      opponents.get(a).add(b);
      opponents.get(b).add(a);
    }
  }
  const opps = opponents.get(playerId);
  if (!opps) return 0;
  let total = 0;
  for (const opp of opps) total += wins.get(opp) || 0;
  return total;
}

/** Swiss final standings sorted by wins, then Buchholz. */
export function computeSwissStandings(players = [], results = []) {
  const out = players.map(p => {
    const wins = results.filter(r => r.played && r.winner === p.playerId).length;
    const losses = results.filter(r => r.played && (r.home?.playerId === p.playerId || r.away?.playerId === p.playerId) && r.winner && r.winner !== p.playerId).length;
    return {
      playerId: p.playerId,
      name: p.name,
      wins,
      losses,
      buchholz: computeBuchholz(p.playerId, results),
    };
  });
  return out.sort((a, b) => (b.wins - a.wins) || (b.buchholz - a.buchholz));
}

/** Recommended Swiss round count: ceil(log2(players)). */
export function recommendedSwissRounds(playerCount) {
  if (playerCount <= 1) return 0;
  return Math.ceil(Math.log2(playerCount));
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

function buildSeedOrder(size) {
  // Returns seed order for bracket slot placement so top seeds can't meet early.
  let order = [1, 2];
  while (order.length < size) {
    const next = [];
    const len = order.length * 2;
    for (const s of order) {
      next.push(s);
      next.push(len + 1 - s);
    }
    order = next;
  }
  return order;
}

function buildPairings(players, round) {
  const matches = [];
  for (let i = 0; i < players.length; i += 2) {
    matches.push({
      matchId: `sw_r${round}_m${i / 2}`,
      round,
      home: players[i],
      away: players[i + 1] || null,
      bye: !players[i + 1],
      winner: players[i + 1] ? null : players[i]?.playerId,
      played: !players[i + 1],
    });
  }
  return matches;
}

function pairGreedyNoRematch(bucket) {
  const remaining = [...bucket];
  const pairs = [];
  while (remaining.length >= 2) {
    const a = remaining.shift();
    const opp = a.pastOpponents || [];
    let idx = remaining.findIndex(b => !opp.includes(b.playerId));
    if (idx === -1) idx = 0; // forced rematch
    const b = remaining.splice(idx, 1)[0];
    pairs.push([a, b]);
  }
  return pairs;
}

// ---------------------------------------------------------------------------
// UI HELPERS
// ---------------------------------------------------------------------------

export function getBracketType(id) {
  return BRACKET_TYPES[id] || null;
}

export function bracketTypesForPlan(plan = 'free') {
  const order = { free: 0, lite: 1, pro: 2 };
  const userLevel = order[plan] ?? 0;
  return BRACKET_TYPE_LIST.filter(t => userLevel >= (order[t.minPlan] ?? 0));
}

export function isBracketTypeAllowed(bracketType, plan = 'free') {
  const cfg = getBracketType(bracketType);
  if (!cfg) return false;
  const order = { free: 0, lite: 1, pro: 2 };
  return (order[plan] ?? 0) >= (order[cfg.minPlan] ?? 0);
}
