import { useState, useEffect, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { collection, onSnapshot } from 'firebase/firestore';
import { motion } from 'framer-motion';
import { db } from '../../firebase/config';
import TopBar from '../../components/TopBar';
import { ListSkeleton } from '../../components/skeletons/GlassSkeletons';
import Icon from '../../components/Icon';
import { useLayout } from '../../context/LayoutContext';
import useResponsive from '../../hooks/useResponsive';
import { getTournament, getUser, getSquad } from '../../firebase/firestore';
import { RoundRobinStandings, SwissStandings } from '../../components/tournaments/StandingsTable';
import BRScoreboard from '../../components/tournaments/BRScoreboard';
import {
  computeBRStandings,
  computeRoundRobinStandings,
  computeSwissStandings,
} from '../../utils/tournamentTypes';
import { buildRoundsFromMatches, buildBrResults } from '../../utils/tournamentBracketShape';

export default function TournamentStandingsScreen() {
  const { tournamentId } = useParams();
  const { isDesktop } = useResponsive();
  const { setRightPanel, setContentAlign } = useLayout();
  const [tournament, setTournament] = useState(null);
  const [matches, setMatches] = useState([]);
  const [participants, setParticipants] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setRightPanel(null);
    if (isDesktop) setContentAlign('left');
    return () => { setRightPanel(null); setContentAlign('center'); };
  }, [setRightPanel, setContentAlign, isDesktop]);

  // Tournament + participants — one-shot. Match data is live (below).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const t = await getTournament(tournamentId);
        if (cancelled) return;
        setTournament(t);
        const ids = t?.participants || [];
        const loadOne = t?.mode === 'squad' ? getSquad : getUser;
        const people = await Promise.all(ids.map(id => loadOne(id).catch(() => null)));
        if (cancelled) return;
        setParticipants(
          people.map((p, i) => ({
            id: ids[i],
            displayName: p?.name || p?.displayName || p?.username || ids[i],
            username: p?.username || p?.tag || ids[i],
            name: p?.name || p?.displayName || p?.username || ids[i],
            avatar: p?.avatar || p?.bannerUrl || null,
          }))
        );
      } catch (err) {
        console.error('Standings load', err);
      }
    })();
    return () => { cancelled = true; };
  }, [tournamentId]);

  // Live match subscription — drives both the "Live Now" pulse section
  // and the win/loss standings so they re-rank as games finish.
  useEffect(() => {
    if (!tournamentId) return;
    const ref = collection(db, 'tournaments', tournamentId, 'matches');
    const unsub = onSnapshot(ref, (snap) => {
      setMatches(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
      setLoading(false);
    }, () => setLoading(false));
    return unsub;
  }, [tournamentId]);

  const teamLookup = useMemo(
    () => Object.fromEntries(participants.map(p => [p.id, p])),
    [participants],
  );

  if (loading) {
    return (
      <div className={isDesktop ? 'min-h-screen pb-8' : 'screen-container min-h-screen pb-8'}>
        <TopBar title="Standings" showBack />
        <ListSkeleton rows={6} />
      </div>
    );
  }

  if (!tournament) {
    return (
      <div className={isDesktop ? 'min-h-screen pb-8' : 'screen-container min-h-screen pb-8'}>
        <TopBar title="Standings" showBack />
        <div className="text-center py-16 px-4">
          <Icon name="error_outline" size={48} className="text-text-muted/30 mx-auto mb-3" />
          <p className="text-text-muted text-sm">Tournament not found</p>
        </div>
      </div>
    );
  }

  const type = tournament.type;
  const finalized = tournament.status === 'completed' && Array.isArray(tournament.ranking);

  return (
    <div className={isDesktop ? 'min-h-screen pb-8' : 'screen-container min-h-screen pb-8'}>
      <TopBar title="Standings" showBack />
      <div className="px-4 py-4 space-y-4">
        <div className="p-4 rounded-2xl bg-surface-1 border border-white/[0.06]">
          <p className="text-text-muted text-[10px] uppercase tracking-widest font-bold mb-1">
            {tournament.name}
          </p>
          <div className="flex items-center gap-2 text-xs text-text-secondary">
            <span>{type?.replace(/_/g, ' ') || 'Tournament'}</span>
            <span>·</span>
            <span>{finalized ? 'Final ranking' : 'Live standings'}</span>
          </div>
        </div>

        {/* Currently-winning live pulse — only when the tournament is active.
            Hidden once finalised since nothing's live anymore. */}
        {!finalized && (
          <LiveNowSection
            tournamentId={tournamentId}
            matches={matches}
            teamLookup={teamLookup}
          />
        )}

        {finalized ? (
          <FinalRankingList ranking={tournament.ranking} teamLookup={teamLookup} />
        ) : (
          <LiveStandings type={type} tournament={tournament} matches={matches} participants={participants} teamLookup={teamLookup} />
        )}
      </div>
    </div>
  );
}

// ─── LiveNowSection ────────────────────────────────────────────────────────
// Renders every match currently in progress. Each match shows both sides
// with the leader highlighted by a pulsing cyan ring. Leader is derived
// from `seriesScore` (Bo3/Bo5) or `partialScore` if present. Bo1 matches
// with no mid-game data render without a leader (just "Match in progress").
function LiveNowSection({ tournamentId, matches, teamLookup }) {
  const navigate = useNavigate();
  const liveMatches = useMemo(() => {
    const LIVE = new Set(['pending', 'in_progress', 'awaiting_confirmation']);
    return (matches || []).filter((m) =>
      LIVE.has(m.status) && m.player1 && m.player2 && m.player1 !== '__bye' && m.player2 !== '__bye'
    );
  }, [matches]);

  if (liveMatches.length === 0) return null;

  return (
    <div className="rounded-2xl border border-white/[0.06] bg-surface-1 overflow-hidden">
      <div className="px-4 py-3 border-b border-white/[0.06] flex items-center gap-2">
        <motion.span
          animate={{ opacity: [0.4, 1, 0.4] }}
          transition={{ duration: 1.4, repeat: Infinity }}
          className="w-2 h-2 rounded-full bg-brand-ember"
        />
        <span className="text-[10px] uppercase tracking-widest font-bold text-brand-ember">
          Live Now · {liveMatches.length}
        </span>
      </div>
      <div className="divide-y divide-white/[0.04]">
        {liveMatches.map((m) => (
          <LiveMatchRow
            key={m.id}
            match={m}
            teamLookup={teamLookup}
            onOpen={() => navigate(`/tournaments/${tournamentId}/match/${m.id}`)}
          />
        ))}
      </div>
    </div>
  );
}

function LiveMatchRow({ match, teamLookup, onOpen }) {
  const a = teamLookup[match.player1] || { name: match.player1 };
  const b = teamLookup[match.player2] || { name: match.player2 };
  const series = match.seriesScore || {};
  const aScore = series.a ?? null;
  const bScore = series.b ?? null;
  const hasScore = aScore !== null && bScore !== null;
  const leader = hasScore
    ? (aScore > bScore ? 'a' : bScore > aScore ? 'b' : null)
    : null;
  const isAwaiting = match.status === 'awaiting_confirmation';

  return (
    <button
      onClick={onOpen}
      className="w-full px-4 py-3 flex items-center gap-3 hover:bg-white/[0.02] transition-colors text-left"
    >
      <Side
        label={a.name || a.displayName}
        score={aScore}
        leading={leader === 'a'}
        align="right"
      />
      <div className="flex flex-col items-center gap-0.5 w-16 shrink-0">
        <span className="text-[9px] font-bold uppercase tracking-widest text-text-muted">
          {match.seriesFormat && match.seriesFormat !== 'bo1' ? match.seriesFormat : 'vs'}
        </span>
        <span className={`text-[9px] font-bold uppercase tracking-widest ${
          isAwaiting ? 'text-brand-gold' : 'text-brand-ember'
        }`}>
          {isAwaiting ? 'Pending Confirm' : 'In progress'}
        </span>
      </div>
      <Side
        label={b.name || b.displayName}
        score={bScore}
        leading={leader === 'b'}
        align="left"
      />
    </button>
  );
}

function Side({ label, score, leading, align }) {
  return (
    <div className={`flex-1 min-w-0 flex items-center gap-2 ${align === 'right' ? 'justify-end' : ''}`}>
      {align === 'right' && score !== null && (
        <span className={`font-dmmono font-bold text-sm ${leading ? 'text-brand-violet-light' : 'text-text-muted'}`}>{score}</span>
      )}
      <div className="relative shrink-0">
        {leading && (
          <motion.span
            animate={{ scale: [1, 1.35, 1], opacity: [0.55, 0, 0.55] }}
            transition={{ duration: 1.4, repeat: Infinity, ease: 'easeOut' }}
            className="absolute inset-0 rounded-full border-2 border-brand-violet pointer-events-none"
          />
        )}
        <span className={`block w-2.5 h-2.5 rounded-full ${
          leading ? 'bg-brand-violet shadow-[0_0_10px_var(--tw-shadow-color)] shadow-brand-violet/80' : 'bg-white/15'
        }`} />
      </div>
      <span className={`text-sm font-semibold truncate ${leading ? 'text-text-primary' : 'text-text-secondary'}`}>
        {label}
      </span>
      {align === 'left' && score !== null && (
        <span className={`font-dmmono font-bold text-sm ${leading ? 'text-brand-violet-light' : 'text-text-muted'}`}>{score}</span>
      )}
    </div>
  );
}

function FinalRankingList({ ranking, teamLookup }) {
  return (
    <div className="rounded-2xl border border-white/[0.06] bg-surface-1 overflow-hidden">
      {ranking.map((id, i) => {
        const p = teamLookup[id] || { name: id };
        const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : null;
        return (
          <div key={id + i} className={`flex items-center gap-3 px-3 py-2.5 border-b border-white/[0.04] last:border-0 ${i < 3 ? 'bg-brand-gold/[0.04]' : ''}`}>
            <span className="w-8 text-center font-dmmono font-bold text-sm">{medal || `#${i + 1}`}</span>
            <span className="flex-1 text-sm font-semibold truncate">{p.name || p.displayName}</span>
            {i === 0 && <span className="text-[10px] font-bold uppercase tracking-widest text-brand-gold">Winner</span>}
          </div>
        );
      })}
    </div>
  );
}

function LiveStandings({ type, tournament, matches, participants, teamLookup }) {
  if (!matches.length) {
    return (
      <div className="p-8 rounded-2xl bg-surface-1 border border-dashed border-white/[0.06] text-center">
        <Icon name="leaderboard" size={32} className="text-text-muted mx-auto mb-2" />
        <p className="text-text-muted text-sm">Standings appear once matches begin</p>
      </div>
    );
  }

  if (type === 'squad_round_robin' || type === 'round_robin') {
    const shaped = buildRoundsFromMatches(matches, participants, type);
    return <RoundRobinStandings standings={computeRoundRobinStandings((shaped || []).flat())} teamLookup={teamLookup} />;
  }
  if (type === 'swiss') {
    const shaped = buildRoundsFromMatches(matches, participants, type);
    return (
      <SwissStandings
        standings={computeSwissStandings(
          (tournament.participants || []).map(uid => ({
            playerId: uid,
            name: teamLookup[uid]?.displayName || uid,
          })),
          (shaped || []).flat().map(m => ({
            played: m.played, winner: m.winner,
            home: { playerId: m.home?.playerId }, away: { playerId: m.away?.playerId },
          })),
        )}
      />
    );
  }
  if (type === 'battle_royale') {
    return (
      <BRScoreboard
        standings={computeBRStandings(buildBrResults(tournament, matches))}
        gameCount={tournament.brGameCount || 3}
        playerLookup={teamLookup}
      />
    );
  }
  // SE / DE / squad SE / invitational — tally wins from completed matches.
  return <WinLossStandings matches={matches} teamLookup={teamLookup} />;
}

function WinLossStandings({ matches, teamLookup }) {
  const rows = useMemo(() => {
    const byId = new Map();
    const ensure = (id) => {
      if (!byId.has(id)) byId.set(id, { id, w: 0, l: 0 });
      return byId.get(id);
    };
    for (const m of matches) {
      const a = m.player1Id || m.homeId || m.aId;
      const b = m.player2Id || m.awayId || m.bId;
      if (a) ensure(a);
      if (b) ensure(b);
      if (m.status !== 'completed' || !m.winnerId) continue;
      const winner = m.winnerId;
      const loser = winner === a ? b : winner === b ? a : null;
      ensure(winner).w += 1;
      if (loser) ensure(loser).l += 1;
    }
    return Array.from(byId.values()).sort((x, y) => (y.w - x.w) || (x.l - y.l));
  }, [matches]);

  if (!rows.length) {
    return (
      <div className="p-8 rounded-2xl bg-surface-1 border border-dashed border-white/[0.06] text-center">
        <Icon name="leaderboard" size={32} className="text-text-muted mx-auto mb-2" />
        <p className="text-text-muted text-sm">No completed matches yet</p>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-white/[0.06] bg-surface-1 overflow-hidden">
      <div className="grid grid-cols-[32px_1fr_40px_40px] gap-2 px-3 py-2 border-b border-white/[0.06] bg-surface-2/50">
        <span className="text-text-muted text-[9px] uppercase tracking-widest font-bold">#</span>
        <span className="text-text-muted text-[9px] uppercase tracking-widest font-bold">Player</span>
        <span className="text-text-muted text-[9px] uppercase tracking-widest font-bold text-center">W</span>
        <span className="text-text-muted text-[9px] uppercase tracking-widest font-bold text-center">L</span>
      </div>
      {rows.map((r, i) => {
        const p = teamLookup[r.id] || { name: r.id };
        const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : null;
        return (
          <div key={r.id} className="grid grid-cols-[32px_1fr_40px_40px] gap-2 px-3 py-2.5 border-b border-white/[0.04] last:border-0 items-center">
            <span className="text-text-muted text-xs font-bold">{medal || i + 1}</span>
            <span className="text-text-primary text-sm font-bold truncate">{p.name || p.displayName}</span>
            <span className="text-brand-violet-light font-dmmono text-xs font-bold text-center">{r.w}</span>
            <span className="text-text-secondary font-dmmono text-xs text-center">{r.l}</span>
          </div>
        );
      })}
    </div>
  );
}
