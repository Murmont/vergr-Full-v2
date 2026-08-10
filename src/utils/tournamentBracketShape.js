// Transforms raw `matches` subcollection docs (player1/player2/winner/round/
// matchNumber) into the shape the BracketVisualization components expect:
//   rounds: [ [ { matchId, home: { playerId, name }, away: {...}, winner, played, homeScore, awayScore, bye } ] ]
//
// Pure function — no Firestore reads. Caller provides a participantLookup
// keyed by uid (or squadId for squad tournaments) → { name, avatar, ... }.
//
// Handles every bracket type the design doc describes:
//   single_elim / squad_single_elim / invitational → rounds = round 1 → final
//   double_elim → { winners[], losers[], grandFinal[] } using `bracketSide`
//   squad_round_robin / round_robin → weekly rounds by matchNumber grouping
//   swiss → by round
//   battle_royale → no rounds; BRScoreboard reads `brResults[]` directly

export function buildRoundsFromMatches(matches, participants, type) {
  const lookup = makeLookup(participants);
  // Phase 3 — squad-mode bracket nodes carry the team's tag/banner so the
  // viz can render proper team identity (logo + tag) instead of bare IDs.
  const seat = (uid) => {
    if (!uid) return null;
    const p = lookup[uid];
    return {
      playerId: uid, id: uid,
      name: p?.name || p?.displayName || p?.username || shortId(uid),
      kind: p?.kind || 'user',
      tag: p?.tag || null,
      avatar: p?.avatar || p?.photoURL || null,
      banner: p?.banner || p?.bannerUrl || null,
    };
  };

  const shaped = (matches || []).map((m) => {
    // Phase 1 — series-aware scores. seriesScore.a / .b are game-wins for
    // player1 / player2 respectively. For Bo1 matches that haven't been
    // updated to the series schema yet, fall back to {winner:1, loser:0}.
    const seriesScore = m.seriesScore || null;
    const seriesFormat = m.seriesFormat || 'bo1';
    let homeScore = m.homeScore ?? null;
    let awayScore = m.awayScore ?? null;
    if (seriesScore) {
      homeScore = seriesScore.a || 0;
      awayScore = seriesScore.b || 0;
    } else if (m.status === 'completed' && m.winner) {
      // Legacy Bo1 fallback so bracket nodes always show a 1-0 if completed.
      homeScore = m.winner === m.player1 ? 1 : 0;
      awayScore = m.winner === m.player2 ? 1 : 0;
    }
    return {
      matchId: m.id,
      round: m.round || 1,
      matchNumber: m.matchNumber || 1,
      home: seat(m.player1),
      away: seat(m.player2),
      winner: m.winner || m.seriesWinner || null,
      played: m.status === 'completed',
      bye: !!m.bye,
      homeScore, awayScore,
      seriesFormat,
      seriesScore,
      status: m.status,
      // Phase 3 — live OCR score map ({uid: n}, written by the AC1 loop)
      // so in-progress bracket nodes can show the score as it happens.
      liveScore: m.liveScore || null,
      completedAtMs: m.completedAt?.toMillis?.() || null,
      bracketSide: m.bracketSide || null,
      isGrandFinal: !!m.isGrandFinal,
    };
  });

  if (type === 'double_elim') {
    const wb = groupByRound(shaped.filter((m) => m.bracketSide !== 'lb' && !m.isGrandFinal));
    const lb = groupByRound(shaped.filter((m) => m.bracketSide === 'lb'));
    const gf = shaped.filter((m) => m.isGrandFinal);
    return { winners: wb, losers: lb, grandFinal: gf };
  }

  // For single-elim/squad/swiss/invitational/round-robin → array-of-rounds.
  const grouped = groupByRound(shaped);
  return grouped;
}

// Returns brResults shape for the BRScoreboard. Aggregates per-player points
// per game from each match doc's `brResults` array (or falls back to flat
// `tournament.brResults` if the client wrote it there).
export function buildBrResults(tournament, matches) {
  if (Array.isArray(tournament?.brResults) && tournament.brResults.length > 0) {
    return tournament.brResults;
  }
  const out = [];
  for (const m of (matches || [])) {
    if (!Array.isArray(m.brResults)) continue;
    for (const r of m.brResults) {
      out.push({ ...r, gameId: r.gameId || m.id });
    }
  }
  return out;
}

function groupByRound(matches) {
  const byRound = new Map();
  for (const m of matches) {
    if (!byRound.has(m.round)) byRound.set(m.round, []);
    byRound.get(m.round).push(m);
  }
  return [...byRound.keys()].sort((a, b) => a - b).map((r) =>
    byRound.get(r).sort((a, b) => (a.matchNumber || 0) - (b.matchNumber || 0)));
}

function makeLookup(participants) {
  if (!participants) return {};
  if (Array.isArray(participants)) {
    return Object.fromEntries(participants.filter(Boolean).map((p) => [p.id || p.uid || p.playerId, p]));
  }
  return participants;
}

function shortId(uid) {
  return uid?.slice(0, 6) || '?';
}
