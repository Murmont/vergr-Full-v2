// NextMatchHint — shows the player where they go next in the bracket:
//   "Winner advances to: Semifinal · Match 2"  (single-elim before completion)
//   "Loser drops to: Losers R3 · Match 1"      (double-elim WB match)
//   "If you win → Grand Final · vs LB champion" (double-elim WB final)
//   "Match complete — you advance to: ..."     (post-completion)
//
// Reads sibling matches in the same tournament subcollection and finds any
// whose `feedFrom.player1.matchId` or `feedFrom.player2.matchId` references
// the current match — those are the destinations for winner/loser.
//
// Falls back gracefully when feedFrom isn't populated (e.g. client-generated
// single-elim still uses round/matchNumber naming; we infer there too).

import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { collection, query, where, onSnapshot } from 'firebase/firestore';
import { db } from '../../firebase/config';
import Icon from '../Icon';

const C = {
  surface: '#14141F', border: 'rgba(255,255,255,0.10)',
  text: '#fff', dim: 'rgba(255,255,255,0.65)', mute: 'rgba(255,255,255,0.45)',
  cyan: '#B44FFF', amber: '#f59e0b',
};

export default function NextMatchHint({ tournamentId, matchId, match, currentUid }) {
  const navigate = useNavigate();
  const [siblings, setSiblings] = useState([]);

  useEffect(() => {
    if (!tournamentId) return;
    const unsub = onSnapshot(
      collection(db, 'tournaments', tournamentId, 'matches'),
      (snap) => setSiblings(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
    );
    return () => unsub();
  }, [tournamentId]);

  const destinations = useMemo(() => {
    if (!match || siblings.length === 0) return null;
    // 1) Explicit feedFrom (double-elim server-generated brackets, and any
    //    future format that pre-seats the bracket).
    const winnerDest = siblings.find((s) =>
      s.feedFrom?.player1?.matchId === matchId && s.feedFrom.player1.role === 'winner' ||
      s.feedFrom?.player2?.matchId === matchId && s.feedFrom.player2.role === 'winner',
    );
    const loserDest = siblings.find((s) =>
      s.feedFrom?.player1?.matchId === matchId && s.feedFrom.player1.role === 'loser' ||
      s.feedFrom?.player2?.matchId === matchId && s.feedFrom.player2.role === 'loser',
    );
    if (winnerDest || loserDest) return { winner: winnerDest, loser: loserDest };
    // 2) Fallback: single-elim style id matching (rN_mN). Winner of round R
    //    match M advances to round R+1 match ceil(M/2). No LB equivalent.
    const m = /^r(\d+)_m(\d+)$/.exec(matchId);
    if (m && (match.bracketSide !== 'lb')) {
      const nextRound = parseInt(m[1], 10) + 1;
      const nextMatchNum = Math.ceil(parseInt(m[2], 10) / 2);
      const target = siblings.find((s) => s.round === nextRound && s.matchNumber === nextMatchNum);
      if (target) return { winner: target, loser: null };
    }
    return null;
  }, [match, siblings, matchId]);

  if (!destinations || (!destinations.winner && !destinations.loser)) return null;

  const labelFor = (m) => {
    if (!m) return null;
    if (m.isGrandFinal) return 'Grand Final';
    if (m.bracketSide === 'lb') return `Losers · R${m.round} · M${m.matchNumber}`;
    if (m.bracketSide === 'wb') return `Winners · R${m.round} · M${m.matchNumber}`;
    return `Round ${m.round} · Match ${m.matchNumber}`;
  };

  const opponentOf = (m) => {
    if (!m) return null;
    if (m.player1 && m.player2) {
      const opp = m.player1 === currentUid ? m.player2 : m.player1 === currentUid ? m.player1 : null;
      return opp ? `vs ${opp.slice(0, 6)}…` : null;
    }
    return 'opponent TBD';
  };

  const completed = match.status === 'completed';
  const iWon = completed && match.winner === currentUid;
  const iLost = completed && match.winner && match.winner !== currentUid;

  return (
    <div style={{
      padding: 12, background: C.surface, border: `1px solid ${C.border}`,
      borderRadius: 12,
    }}>
      <div style={{ fontSize: 11, color: C.mute, textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: 8 }}>
        Bracket path
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {destinations.winner && (
          <DestinationRow
            icon="arrow_forward"
            color={iWon ? C.cyan : C.dim}
            primary={iWon ? 'You advanced to' : (completed ? 'Winner advanced to' : 'Winner advances to')}
            label={labelFor(destinations.winner)}
            sub={opponentOf(destinations.winner)}
            actionable={iWon}
            onClick={() => iWon && navigate(`/tournaments/${tournamentId}/match/${destinations.winner.id}`)}
          />
        )}
        {destinations.loser && (
          <DestinationRow
            icon="south_east"
            color={iLost ? C.amber : C.mute}
            primary={iLost ? 'You dropped to' : (completed ? 'Loser dropped to' : 'Loser drops to')}
            label={labelFor(destinations.loser)}
            sub={opponentOf(destinations.loser)}
            actionable={iLost}
            onClick={() => iLost && navigate(`/tournaments/${tournamentId}/match/${destinations.loser.id}`)}
          />
        )}
      </div>
    </div>
  );
}

function DestinationRow({ icon, color, primary, label, sub, actionable, onClick }) {
  return (
    <div onClick={actionable ? onClick : undefined} style={{
      display: 'flex', alignItems: 'center', gap: 10,
      padding: 8, borderRadius: 8,
      background: actionable ? 'rgba(180, 79, 255,0.06)' : 'transparent',
      cursor: actionable ? 'pointer' : 'default',
    }}>
      <Icon name={icon} size={16} className="" style={{ color }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 10, color: C.mute, textTransform: 'uppercase', letterSpacing: '0.08em' }}>{primary}</div>
        <div style={{ fontSize: 13, color: C.text, fontWeight: 700 }}>{label}</div>
      </div>
      {sub && <div style={{ fontSize: 11, color: C.dim, fontFamily: 'DM Mono, monospace' }}>{sub}</div>}
      {actionable && <Icon name="open_in_new" size={14} className="" style={{ color: C.cyan }} />}
    </div>
  );
}
