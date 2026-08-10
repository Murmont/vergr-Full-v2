// TournamentOverlay — when the broadcaster is competing in a tournament,
// the bracket / next-match info floats over the stream as a small card.
// Native to the platform — broadcaster does not need OBS overlays.

import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { collection, query, where, limit, onSnapshot } from 'firebase/firestore';
import { db } from '../../firebase/config';
import Icon from '../Icon';

const ms = (t) => t?.toMillis?.() ?? (t?.seconds ? t.seconds * 1000 : 0);

const C = {
  bg: 'rgba(18,18,30,0.92)',
  border: 'rgba(255,255,255,0.12)',
  text: '#fff',
  textDim: 'rgba(255,255,255,0.65)',
  gold: '#F0A500',
};

export default function TournamentOverlay({ hostUid, position = 'top-left', offset = null }) {
  const navigate = useNavigate();
  const [tournament, setTournament] = useState(null);
  const [match, setMatch] = useState(null);

  useEffect(() => {
    if (!hostUid) { setTournament(null); return; }
    // Find a running tournament the host is in. Tournament docs store entrants
    // in `participants` (UIDs in solo mode); query that single array field —
    // no composite index — then pick the freshest active one client-side.
    const q = query(
      collection(db, 'tournaments'),
      where('participants', 'array-contains', hostUid),
      limit(10),
    );
    const unsub = onSnapshot(q, (snap) => {
      const active = snap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .filter((t) => ['active', 'live', 'ongoing'].includes(t.status))
        .sort((a, b) => ms(b.startedAt) - ms(a.startedAt));
      setTournament(active[0] || null);
    }, () => setTournament(null));
    return unsub;
  }, [hostUid]);

  useEffect(() => {
    if (!tournament?.id || !hostUid) { setMatch(null); return; }
    // Their current match. Matches store sides as player1/player2 (not an array)
    // and move pending → in_progress → completed. Query the single in_progress
    // status (no composite index) and pick the host's match client-side.
    const q = query(
      collection(db, 'tournaments', tournament.id, 'matches'),
      where('status', '==', 'in_progress'),
      limit(20),
    );
    const unsub = onSnapshot(q, (snap) => {
      const mine = snap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .filter((m) => m.player1 === hostUid || m.player2 === hostUid)
        .sort((a, b) => (b.round || 0) - (a.round || 0));
      setMatch(mine[0] || null);
    }, () => setMatch(null));
    return unsub;
  }, [tournament?.id, hostUid]);

  if (!tournament) return null;

  const prize = tournament.prizePool ?? tournament.prizePoolCoins ?? 0;

  // `offset` lets a host screen drop the card below its own chrome (e.g. the
  // native viewer's top HUD) without adding bespoke position variants.
  const offsetStyle = offset || (
    position === 'top-left'  ? { top: 12, left: 12 } :
    position === 'top-right' ? { top: 12, right: 12 } :
    position === 'bottom-left' ? { bottom: 96, left: 12 } :
    { bottom: 96, right: 12 });

  return (
    <div
      onClick={() => navigate(
        // Drop the watcher straight onto the live match (Champion Pick / tip /
        // follow) when we know it; otherwise the tournament overview.
        match?.id
          ? `/tournaments/${tournament.id}/match/${match.id}`
          : `/match/${tournament.id}`,
      )}
      role="button"
      title="Open tournament"
      style={{
        position: 'absolute', ...offsetStyle,
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '6px 12px 6px 8px', borderRadius: 12,
        background: C.bg, border: `1px solid ${C.border}`,
        backdropFilter: 'blur(8px)',
        color: C.text, fontSize: 11, fontWeight: 700, zIndex: 4,
        maxWidth: 320, cursor: 'pointer',
      }}>
      <div style={{
        width: 26, height: 26, borderRadius: 8,
        background: `linear-gradient(135deg, ${C.gold}, #F5C842)`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <Icon name="emoji_events" size={14} className="" />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: 11, fontWeight: 800, whiteSpace: 'nowrap',
          overflow: 'hidden', textOverflow: 'ellipsis',
        }}>{tournament.name || tournament.title || 'Tournament'}</div>
        <div style={{ fontSize: 10, color: C.textDim, marginTop: 1 }}>
          {match
            ? `Round ${match.round}${match.opponentName ? ' vs ' + match.opponentName : ''}`
            : `Active · ${tournament.game || ''}`}
        </div>
      </div>
      {prize ? (
        <div style={{
          padding: '2px 8px', borderRadius: 99,
          background: 'rgba(240,165,0,0.18)', color: C.gold,
          fontSize: 10, fontWeight: 800,
        }}>{prize.toLocaleString()}c</div>
      ) : null}
    </div>
  );
}
