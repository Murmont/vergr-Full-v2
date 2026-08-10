// functions/tournamentRules.js
// Server-side mirror of src/utils/tournamentTypes.js — only the bits we need
// from Cloud Functions. CommonJS because the rest of functions/ is CJS.
//
// THESE NUMBERS ARE RIOT-DISCLOSED. They mirror the values in
// src/utils/tournamentTypes.js exactly. If one side changes, the other must
// change too — and Riot must be re-notified before either is raised.

const MAX_ENTRY_FEE_COINS = 10_000;
const MAX_PRIZE_POOL_COINS = 500_000;
const MOD_CUT_PCT = 5;
// Entry-fee threshold above which the two-camera proof feed is mandatory
// for the winner to claim a result. Mirrors `WEBCAM_PRIZE_THRESHOLD` in
// `src/screens/tournaments/TournamentMatchScreen.jsx` — keep in sync.
const WEBCAM_PRIZE_THRESHOLD = 5_000;

const BRACKET_TYPES = {
  single_elim:       { id: 'single_elim',       mode: 'solo',   allowedPlayers: [4, 8, 16, 32, 64, 128], minPlan: 'free' },
  double_elim:       { id: 'double_elim',       mode: 'solo',   allowedPlayers: [4, 8, 16, 32, 64],      minPlan: 'lite' },
  squad_single_elim: { id: 'squad_single_elim', mode: 'squad',  allowedPlayers: [4, 8, 16, 32],          minPlan: 'free' },
  squad_round_robin: { id: 'squad_round_robin', mode: 'squad',  allowedPlayers: [4, 6, 8],               minPlan: 'lite' },
  battle_royale:     { id: 'battle_royale',     mode: 'ffa',    allowedPlayers: [8, 16, 24, 32, 50, 100],minPlan: 'free' },
  swiss:             { id: 'swiss',             mode: 'solo',   allowedPlayers: [8, 16, 32, 64],         minPlan: 'lite' },
  invitational:      { id: 'invitational',      mode: 'custom', allowedPlayers: [2, 4, 6, 8, 12, 16, 24, 32], minPlan: 'pro' },
};

// Winner-takes-all (minus 5% mod cut) for every bracket type. Solo = winner's
// wallet; squad = winning squad's treasury via squadTreasuryPct:100 + the
// finalizeInternal `isSquadMode` routing. Multi-place reward only happens in
// Tournament Points (leaderboard), not coins.
const PRIZE_DISTRIBUTION = {
  single_elim:       { splits: [{ place: 1, pct: 100 }], modCut: 5, squadTreasuryPct: 0 },
  double_elim:       { splits: [{ place: 1, pct: 100 }], modCut: 5, squadTreasuryPct: 0 },
  squad_single_elim: { splits: [{ place: 1, pct: 100 }], modCut: 5, squadTreasuryPct: 100 },
  squad_round_robin: { splits: [{ place: 1, pct: 100 }], modCut: 5, squadTreasuryPct: 100 },
  battle_royale:     { splits: [{ place: 1, pct: 100 }], modCut: 5, squadTreasuryPct: 0 },
  swiss:             { splits: [{ place: 1, pct: 100 }], modCut: 5, squadTreasuryPct: 0 },
  invitational:      { splits: [{ place: 1, pct: 100 }], modCut: 5, squadTreasuryPct: 0 },
};

const PLAN_RANK = { free: 0, lite: 1, pro: 2 };

function isBracketTypeAllowed(bracketType, plan) {
  const cfg = BRACKET_TYPES[bracketType];
  if (!cfg) return false;
  return (PLAN_RANK[plan] ?? 0) >= (PLAN_RANK[cfg.minPlan] ?? 0);
}

function validateTournamentLimits({ entryFee = 0, maxParticipants = 0 }) {
  const fee = Math.max(0, Math.floor(entryFee));
  const cap = Math.max(0, Math.floor(maxParticipants));
  if (fee > MAX_ENTRY_FEE_COINS) {
    return { ok: false, field: 'entryFee', error: `Entry fee can't exceed ${MAX_ENTRY_FEE_COINS} coins per player.` };
  }
  if (fee * cap > MAX_PRIZE_POOL_COINS) {
    return { ok: false, field: 'pool', error: `Prize pool would exceed ${MAX_PRIZE_POOL_COINS} coins.` };
  }
  return { ok: true };
}

function computePrizeBreakdown(pool, bracketType, opts = {}) {
  const cfg = PRIZE_DISTRIBUTION[bracketType];
  if (!cfg) throw new Error(`Unknown bracket type: ${bracketType}`);
  const gross = Math.max(0, Math.floor(pool || 0));
  // Ticketed events already took the 10% platform cut at ticket-sale time,
  // so finalize passes modCutPct:0 to pay the declared purse out 100%.
  // Legacy prize-pool events fall back to the bracket's standard 5% cut.
  const modCutPct = (typeof opts.modCutPct === 'number') ? opts.modCutPct : cfg.modCut;
  const modCut = Math.floor(gross * (modCutPct / 100));
  const netPool = gross - modCut;
  const splits = cfg.custom ? (opts.customSplits || []) : cfg.splits;
  const treasuryPct = opts.squadTreasury ? cfg.squadTreasuryPct : 0;
  const payouts = splits.map(s => {
    const grossPayout = Math.floor(netPool * (s.pct / 100));
    const treasury = Math.floor(grossPayout * (treasuryPct / 100));
    const player = grossPayout - treasury;
    return { place: s.place, pct: s.pct, gross: grossPayout, treasury, player };
  });
  return { gross, modCut, netPool, payouts };
}

// Standard seeded bracket order so top seeds can't meet early.
function buildSeedOrder(size) {
  let order = [1, 2];
  while (order.length < size) {
    const next = [];
    const len = order.length * 2;
    for (const s of order) { next.push(s); next.push(len + 1 - s); }
    order = next;
  }
  return order;
}
const nextPow2 = n => { let p = 1; while (p < n) p *= 2; return p; };

// Generate the round-1 single-elim seeding for a player list.
// Returns Array<{ matchNumber, player1Id, player2Id|null, autoWin }>
function buildSingleElimRound1(playerIds) {
  const size = nextPow2(playerIds.length);
  const slots = new Array(size).fill(null);
  const seedOrder = buildSeedOrder(size);
  playerIds.forEach((pid, i) => { slots[seedOrder.indexOf(i + 1)] = pid; });
  const matches = [];
  for (let i = 0; i < size; i += 2) {
    const p1 = slots[i];
    const p2 = slots[i + 1];
    matches.push({
      matchNumber: i / 2 + 1,
      player1Id: p1,
      player2Id: p2,
      autoWin: p1 && !p2 ? p1 : (!p1 && p2 ? p2 : null),
    });
  }
  return matches;
}

// Generates the complete double-elim bracket as a flat array of match
// descriptors. Every match has:
//   id           — 'wb_r{n}_m{n}' | 'lb_r{n}_m{n}' | 'gf_m1'
//   bracketSide  — 'wb' | 'lb' | 'gf'
//   round        — bracket-local round number (1-indexed)
//   matchNumber  — index within that round (1-indexed)
//   player1, player2 — uid or null; filled in by advanceDoubleElim when
//                      the feeder match completes (or directly for WB R1).
//   isGrandFinal — true on the GF match
//   feedFrom     — { player1: { matchId, role }, player2: {...} }
//                  role is 'winner' or 'loser'. Unused for WB R1.
//
// LB seeding follows the standard "drop pattern" with crossed pairing in
// even LB rounds so WB-loser-vs-LB-winner can't be an immediate rematch.
function buildDoubleElimBracket(playerIds) {
  const size = nextPow2(playerIds.length);
  if (size < 4) return null;
  const wbRounds = Math.log2(size);             // e.g. 8 players → 3
  const matches = [];

  // ── WB Round 1 ────────────────────────────────────────────────────
  const wbR1 = buildSingleElimRound1(playerIds);
  for (const m of wbR1) {
    matches.push({
      id: `wb_r1_m${m.matchNumber}`,
      bracketSide: 'wb', round: 1, matchNumber: m.matchNumber,
      player1: m.player1Id, player2: m.player2Id,
      autoWin: m.autoWin || null,
      feedFrom: null,
    });
  }

  // ── WB Rounds 2..wbRounds ────────────────────────────────────────
  for (let r = 2; r <= wbRounds; r++) {
    const matchCount = size / Math.pow(2, r);
    for (let i = 1; i <= matchCount; i++) {
      matches.push({
        id: `wb_r${r}_m${i}`,
        bracketSide: 'wb', round: r, matchNumber: i,
        player1: null, player2: null,
        feedFrom: {
          player1: { matchId: `wb_r${r - 1}_m${i * 2 - 1}`, role: 'winner' },
          player2: { matchId: `wb_r${r - 1}_m${i * 2}`,     role: 'winner' },
        },
      });
    }
  }

  // ── LB Rounds ────────────────────────────────────────────────────
  // Pattern: LB has 2*(wbRounds - 1) rounds.
  //   ODD LB round  (1, 3, 5, …) — pair LB R-1 winners among themselves
  //                                (R1 = pair WB R1 losers directly)
  //   EVEN LB round (2, 4, …)    — LB R-1 winners face fresh WB-round losers
  //                                with crossed pairing to avoid rematch
  const lbRounds = 2 * (wbRounds - 1);

  // LB R1 — pair WB R1 losers. Count = size/4 matches (e.g. 8p → 2 matches).
  const lbR1Count = size / 4;
  for (let i = 1; i <= lbR1Count; i++) {
    matches.push({
      id: `lb_r1_m${i}`,
      bracketSide: 'lb', round: 1, matchNumber: i,
      player1: null, player2: null,
      feedFrom: {
        player1: { matchId: `wb_r1_m${i * 2 - 1}`, role: 'loser' },
        player2: { matchId: `wb_r1_m${i * 2}`,     role: 'loser' },
      },
    });
  }

  for (let r = 2; r <= lbRounds; r++) {
    // Count derivation:
    //   even LB round (drop): same count as the previous LB round
    //   odd  LB round (pair): half of the previous LB round
    const prevLbCount = matches.filter((m) => m.bracketSide === 'lb' && m.round === r - 1).length;
    const count = (r % 2 === 0) ? prevLbCount : Math.max(1, Math.floor(prevLbCount / 2));

    // Which WB round drops into THIS LB round (for even LB rounds).
    //   LB R2 takes WB R2 losers
    //   LB R4 takes WB R3 losers
    //   LB R(2k) takes WB R(k+1) losers
    const wbDropRound = (r % 2 === 0) ? (r / 2) + 1 : null;

    for (let i = 1; i <= count; i++) {
      let feedFrom;
      if (r % 2 === 0) {
        // EVEN: LB winner vs WB-drop loser. Cross-pair: LB winner index i
        // faces WB drop loser (count - i + 1) so the player they just beat
        // in WB doesn't come straight back.
        feedFrom = {
          player1: { matchId: `lb_r${r - 1}_m${i}`, role: 'winner' },
          player2: { matchId: `wb_r${wbDropRound}_m${count - i + 1}`, role: 'loser' },
        };
      } else {
        // ODD: pair LB R-1 winners among themselves.
        feedFrom = {
          player1: { matchId: `lb_r${r - 1}_m${i * 2 - 1}`, role: 'winner' },
          player2: { matchId: `lb_r${r - 1}_m${i * 2}`,     role: 'winner' },
        };
      }
      matches.push({
        id: `lb_r${r}_m${i}`,
        bracketSide: 'lb', round: r, matchNumber: i,
        player1: null, player2: null,
        feedFrom,
      });
    }
  }

  // ── Grand Final ──────────────────────────────────────────────────
  // WB champion (winner of last WB round) vs LB champion (winner of last LB round).
  // The GF reset (if WB champ loses) is created at runtime by
  // advanceDoubleElimIfNeeded in tournaments.js — it uses the format's "2
  // losses to be out" rule so we don't need to pre-create it.
  matches.push({
    id: 'gf_m1',
    bracketSide: 'gf', round: wbRounds + 1, matchNumber: 1,
    player1: null, player2: null,
    isGrandFinal: true,
    feedFrom: {
      player1: { matchId: `wb_r${wbRounds}_m1`, role: 'winner' },
      player2: { matchId: `lb_r${lbRounds}_m1`, role: 'winner' },
    },
  });

  return { matches, wbRounds, lbRounds, size };
}

module.exports = {
  MAX_ENTRY_FEE_COINS,
  MAX_PRIZE_POOL_COINS,
  MOD_CUT_PCT,
  WEBCAM_PRIZE_THRESHOLD,
  BRACKET_TYPES,
  PRIZE_DISTRIBUTION,
  isBracketTypeAllowed,
  validateTournamentLimits,
  computePrizeBreakdown,
  buildSingleElimRound1,
  buildDoubleElimBracket,
  buildRoundRobinSchedule,
  buildBattleRoyaleGames,
  buildSwissRound1,
  buildNextSwissRound,
};

// ─── Round Robin schedule generator ────────────────────────────────────
// Standard "circle method": fix participant 0, rotate the rest. For N
// participants this yields (N-1) rounds each containing floor(N/2) matches.
// If N is odd, one participant gets a bye per round (rotated through).
//
// Returns Array<{ id, round, matchNumber, player1, player2 }> covering
// EVERY pairing exactly once. Match id format: `rr_r{n}_m{n}`.
function buildRoundRobinSchedule(playerIds) {
  const ids = playerIds.slice();
  const odd = ids.length % 2 === 1;
  if (odd) ids.push(null); // ghost bye seat
  const n = ids.length;
  const rounds = n - 1;
  const half = n / 2;
  const out = [];
  // Circle method: position 0 is fixed, others rotate clockwise.
  let arr = ids.slice();
  for (let r = 1; r <= rounds; r++) {
    let matchNumber = 1;
    for (let i = 0; i < half; i++) {
      const a = arr[i];
      const b = arr[n - 1 - i];
      if (!a || !b) continue; // skip the bye seat
      out.push({
        id: `rr_r${r}_m${matchNumber}`,
        round: r, matchNumber,
        player1: a, player2: b,
      });
      matchNumber++;
    }
    // Rotate: keep arr[0] fixed, move arr[1] to end, others shift left.
    arr = [arr[0], ...arr.slice(2), arr[1]];
  }
  return out;
}

// ─── Battle Royale game-slot generator ─────────────────────────────────
// BR is FFA: all participants share a single lobby per game; host/mod
// records placements (brResults[]) after each game. Server pre-creates
// `gameCount` empty game-slots so the UI can show progress.
//
// Each match doc represents ONE game of the BR tournament. Match id:
// `br_g{n}` (g for "game"). No player1/player2 because it's not 1v1 —
// the `participants` array carries everyone in the lobby.
function buildBattleRoyaleGames(playerIds, gameCount) {
  const n = Math.max(1, Math.floor(gameCount || 3));
  const out = [];
  for (let i = 1; i <= n; i++) {
    out.push({
      id: `br_g${i}`,
      round: i,         // each game is its own "round" for UI ordering
      matchNumber: 1,
      gameNumber: i,
      participants: playerIds.slice(),
      player1: null, player2: null,
      brResults: [],
    });
  }
  return out;
}

// ─── Swiss System pairing ──────────────────────────────────────────────
// Round 1: random pairings (with one bye if odd N).
// Subsequent rounds: pair by record (wins desc) using fold pairing within
// each score group; no rematches. Tiebreaker: Buchholz.
//
// Rounds: ceil(log2(N)) per the doc.

function buildSwissRound1(playerIds) {
  const shuffled = playerIds.slice();
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return pairWithBye(shuffled, /* round */ 1);
}

// Generate the pairings for the next Swiss round given the standings so
// far. Algorithm: bucket players by wins desc, within each bucket pair
// top half vs bottom half (fold), with rematch-avoidance via local swaps.
// Players who already received a bye are deprioritized for future byes.
function buildNextSwissRound(playerIds, completedMatches, currentRound, priorByes = []) {
  const wins = new Map();
  const opps = new Map();
  for (const p of playerIds) { wins.set(p, 0); opps.set(p, new Set()); }
  for (const m of completedMatches) {
    if (m.bye && m.player1) {
      wins.set(m.player1, (wins.get(m.player1) || 0) + 1); // bye = free win per Swiss rule
      continue;
    }
    if (m.player1 && m.player2) {
      opps.get(m.player1)?.add(m.player2);
      opps.get(m.player2)?.add(m.player1);
    }
    if (m.winner) wins.set(m.winner, (wins.get(m.winner) || 0) + 1);
  }
  // Sort: wins desc, then random-stable within ties so the bracket doesn't
  // calcify around input order.
  const sorted = playerIds.slice().sort((a, b) =>
    (wins.get(b) || 0) - (wins.get(a) || 0) || Math.random() - 0.5);

  const used = new Set();
  const pairs = [];
  // Greedy: pair each unpaired player with the next-best unpaired who
  // hasn't faced them. Fall back to "any unpaired" if no eligible opp.
  for (const p of sorted) {
    if (used.has(p)) continue;
    let opp = null;
    for (const q of sorted) {
      if (q === p || used.has(q)) continue;
      if (opps.get(p)?.has(q)) continue;
      opp = q; break;
    }
    if (!opp) {
      // No eligible non-rematch — pair with any unused (forced rematch).
      for (const q of sorted) { if (q !== p && !used.has(q)) { opp = q; break; } }
    }
    if (opp) {
      used.add(p); used.add(opp);
      pairs.push([p, opp]);
    }
  }
  // Bye if odd. Prefer someone who hasn't had one yet, and pick the
  // lowest-record eligible player for the bye (least disruptive).
  const unpaired = sorted.find((p) => !used.has(p));
  let byeUid = null;
  if (unpaired) byeUid = unpaired;

  return pairs.map(([a, b], i) => ({
    id: `sw_r${currentRound}_m${i + 1}`,
    round: currentRound, matchNumber: i + 1,
    player1: a, player2: b,
    bye: false,
  })).concat(byeUid ? [{
    id: `sw_r${currentRound}_bye`,
    round: currentRound, matchNumber: pairs.length + 1,
    player1: byeUid, player2: null,
    bye: true,
  }] : []);
}

function pairWithBye(ids, round) {
  const out = [];
  let i = 0;
  let mn = 1;
  while (i + 1 < ids.length) {
    out.push({
      id: `sw_r${round}_m${mn}`,
      round, matchNumber: mn,
      player1: ids[i], player2: ids[i + 1],
      bye: false,
    });
    mn++; i += 2;
  }
  if (i < ids.length) {
    out.push({
      id: `sw_r${round}_bye`,
      round, matchNumber: mn,
      player1: ids[i], player2: null,
      bye: true,
    });
  }
  return out;
}
