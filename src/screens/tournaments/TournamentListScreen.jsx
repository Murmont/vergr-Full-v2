// Unified Tournaments list screen.
//
// One screen serves: All Tournaments, My Tournaments, Following, Past
// Tournaments, and per-type filter pages. The `variant` prop or :slug route
// param controls which dataset + which filter chips render.

import { useState, useEffect, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import Icon from '../../components/Icon';
import AppHeader from '../../components/brand/AppHeader';
import { useUser } from '../../context/UserContext';
import { useLayout } from '../../context/LayoutContext';
import useResponsive from '../../hooks/useResponsive';
import TopBar from '../../components/TopBar';
import CoinDisplay from '../../components/CoinDisplay';
import {
  getTournaments,
  getUserTournaments,
  getFollowingTournaments,
  getUserSquads,
} from '../../firebase/firestore';
import {
  TournamentCard,
  TournamentRow,
  TournamentCompact,
  Dropdown,
  ViewToggle,
} from '../../components/tournament/TournamentBits';
import { mapTournaments } from '../../components/tournament/tournamentMappers';
import TournamentRightRail from '../../components/tournament/TournamentRightRail';

// Per-type slug → Firestore `type` field value.
// `ffa` is included as a separate nav entry but maps to battle_royale because
// in our data model battle_royale already covers free-for-all.
const TYPE_SLUG_MAP = {
  '1v1-single':   { type: 'single_elim',       label: '1v1 Single Elim',   blurb: 'Classic 1v1 knockouts. One loss and you\'re out.' },
  '1v1-double':   { type: 'double_elim',       label: '1v1 Double Elim',   blurb: 'Winners and Losers brackets. Two losses to be eliminated.' },
  'squad-single': { type: 'squad_single_elim', label: 'Squad vs Squad',    blurb: 'Squads compete as a unit. Single elimination.' },
  'squad-round':  { type: 'squad_round_robin', label: 'Squad Round Robin', blurb: 'Every squad plays every other. Standings decide the winner.' },
  'ffa':          { type: 'battle_royale',     label: 'Free For All',      blurb: 'All players in one lobby. Placement scoring.' },
  'battle':       { type: 'battle_royale',     label: 'Battle Royale',     blurb: 'Multi-game placement scoring across one lobby.' },
  'swiss':        { type: 'swiss',             label: 'Swiss System',      blurb: 'Players with similar records paired each round. Nobody is eliminated.' },
  'invite':       { type: 'invitational',      label: 'Invitational',      blurb: 'Custom rules, hand-picked competitors, pro-tier prizes.' },
};

const STATUS_TABS_DEFAULT = [
  { key: 'all',      label: 'All' },
  { key: 'open',     label: 'Open' },
  { key: 'live',     label: 'Live' },
  { key: 'filling',  label: 'Filling Fast' },
  { key: 'free',     label: 'Free Entry' },
];

export default function TournamentListScreen({ variant = 'all' }) {
  const { slug } = useParams();
  const navigate = useNavigate();
  const { profile, wallet } = useUser();
  const { isDesktop } = useResponsive();
  const { setRightPanel, setContentAlign } = useLayout();

  const typeConfig = variant === 'type' ? TYPE_SLUG_MAP[slug] : null;
  const isTypeVariant = variant === 'type';

  const [tournaments, setTournaments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState(variant === 'past' ? 'completed' : 'all');
  const [game, setGame] = useState('All Games');
  const [region, setRegion] = useState('All Regions');
  const [view, setView] = useState('grid');
  // Quick filters: a set of independently-toggleable refinements layered on
  // top of status/game/region. Empty set = no quick filtering.
  const [quick, setQuick] = useState(() => new Set());
  const toggleQuick = (k) => setQuick(prev => {
    const n = new Set(prev);
    n.has(k) ? n.delete(k) : n.add(k);
    return n;
  });
  // DS2 — the viewer's squad ids, so "My squads' events" can filter by
  // tournament.hostSquadId. Empty until loaded; the chip hides if none.
  const [mySquadIds, setMySquadIds] = useState(() => new Set());
  useEffect(() => {
    if (!profile?.uid) return;
    let cancelled = false;
    getUserSquads(profile.uid)
      .then((sqs) => { if (!cancelled) setMySquadIds(new Set((sqs || []).map(s => s.id))); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [profile?.uid]);

  // DS5 — entry-fee comfort ceiling derived from the viewer's Tournament
  // Points. TP 0 → 100c, scales up, capped at the 10,000c entry-fee max.
  const levelComfortMax = useMemo(() => {
    const tp = profile?.tournamentPoints || 0;
    return Math.min(10000, Math.max(100, Math.round(50 + tp / 5)));
  }, [profile?.tournamentPoints]);

  // Upcoming-weekend window (Sat 00:00 → Sun 23:59 local). If today is the
  // weekend, it's the current one; otherwise the next one.
  const [wkStart, wkEnd] = useMemo(() => {
    const now = new Date();
    const day = now.getDay(); // 0 Sun .. 6 Sat
    const start = new Date(now);
    if (day === 0) start.setDate(now.getDate() - 1); // Sunday: weekend started yesterday
    else start.setDate(now.getDate() + ((6 - day + 7) % 7)); // next/this Saturday
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setDate(start.getDate() + 1); // Sunday
    end.setHours(23, 59, 59, 999);
    return [start.getTime(), end.getTime()];
  }, []);

  useEffect(() => {
    setRightPanel(null);
    setContentAlign('left');
    return () => { setRightPanel(null); setContentAlign('center'); };
  }, [setRightPanel, setContentAlign]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        let docs = [];
        if (variant === 'mine') {
          docs = await getUserTournaments(profile?.uid, 50);
        } else if (variant === 'following') {
          docs = await getFollowingTournaments(profile?.uid, 30);
        } else if (variant === 'past') {
          docs = await getTournaments('completed', 50);
        } else {
          docs = await getTournaments(null, 50);
        }
        if (!cancelled) setTournaments(mapTournaments(docs));
      } catch (err) {
        console.error('TournamentList load', err);
        if (!cancelled) setTournaments([]);
      }
      if (!cancelled) setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [variant, profile?.uid, slug]);

  const filtered = useMemo(() => {
    return tournaments.filter(t => {
      if (isTypeVariant && typeConfig && t.type !== typeConfig.type) return false;
      if (variant === 'past') {
        // Past screen: only show ended/completed
        if (!(t.status === 'completed' || t.status === 'ended')) return false;
      } else {
        if (status === 'open' && t.status !== 'open') return false;
        if (status === 'live' && t.status !== 'live' && t.status !== 'active') return false;
        if (status === 'filling' && !(t.cap > 0 && t.regd / t.cap >= 0.8)) return false;
        if (status === 'free' && t.entry !== 0) return false;
      }
      if (game !== 'All Games' && t.game !== game) return false;
      if (region !== 'All Regions' && t.region !== region) return false;
      // Quick filters (each independently toggleable)
      if (quick.has('lowEntry') && !(t.entry <= 50)) return false;
      if (quick.has('small') && !(t.cap > 0 && t.cap <= 100)) return false;
      if (quick.has('br') && t.type !== 'battle_royale') return false;
      if (quick.has('weekend') && !(t.startMs && t.startMs >= wkStart && t.startMs <= wkEnd)) return false;
      if (quick.has('mySquads') && !(t.hostSquadId && mySquadIds.has(t.hostSquadId))) return false;
      // DS5 — skill-matched: keep tournaments whose entry stake sits within
      // the viewer's comfort band (scales with their Tournament Points), so
      // newcomers aren't shown whale-stakes events and vets still see all.
      if (quick.has('myLevel') && !(t.entry <= levelComfortMax)) return false;
      return true;
    });
  }, [tournaments, status, game, region, isTypeVariant, typeConfig, variant, quick, wkStart, wkEnd, mySquadIds, levelComfortMax]);

  const QUICK_FILTERS = [
    { key: 'myLevel',  label: 'For my level', icon: 'adjust' },
    { key: 'lowEntry', label: 'Entry ≤ 50c', icon: 'savings' },
    { key: 'small',    label: '≤ 100 players', icon: 'groups' },
    { key: 'weekend',  label: 'This weekend', icon: 'event' },
    { key: 'br',       label: 'Battle Royale', icon: 'whatshot' },
    ...(mySquadIds.size > 0 ? [{ key: 'mySquads', label: "My squads' events", icon: 'shield' }] : []),
  ];

  const games = useMemo(() => {
    const set = new Set(['All Games']);
    tournaments.forEach(t => t.game && set.add(t.game));
    return Array.from(set);
  }, [tournaments]);

  const header = useMemo(() => {
    if (isTypeVariant && typeConfig) return { title: typeConfig.label, subtitle: typeConfig.blurb };
    if (variant === 'mine')      return { title: 'My Tournaments', subtitle: 'Tournaments you\'re hosting or competing in.' };
    if (variant === 'following') return { title: 'Following',      subtitle: 'Events hosted by people you follow.' };
    if (variant === 'past')      return { title: 'Past Tournaments', subtitle: 'Your bracket history and earnings.' };
    return { title: 'All Tournaments', subtitle: 'Browse every open event across all games and formats.' };
  }, [variant, isTypeVariant, typeConfig]);

  const onCardClick = (t) => navigate(`/match/${t.id}`);

  // Mobile stacked layout
  if (!isDesktop) {
    return (
      <div className="screen-container min-h-screen pb-8">
        <TopBar title={header.title} showBack actions={<CoinDisplay amount={wallet?.balance || 0} size="sm" />} />
        <div className="px-4 pt-3 space-y-3">
          {variant !== 'past' && (
            <div className="flex gap-2 overflow-x-auto no-scrollbar">
              {STATUS_TABS_DEFAULT.map(t => (
                <button key={t.key} onClick={() => setStatus(t.key)}
                  className={`px-3.5 py-2 rounded-full text-xs font-semibold whitespace-nowrap ${
                    status === t.key ? 'bg-gradient-to-r from-brand-violet to-brand-pink text-white' : 'bg-white/[0.04] text-text-secondary'
                  }`}
                >{t.label}</button>
              ))}
            </div>
          )}
          {variant !== 'past' && (
            <div className="flex gap-2 overflow-x-auto no-scrollbar">
              {QUICK_FILTERS.map(q => {
                const on = quick.has(q.key);
                return (
                  <button key={q.key} onClick={() => toggleQuick(q.key)}
                    className={`px-3 py-1.5 rounded-full text-[11px] font-semibold whitespace-nowrap inline-flex items-center gap-1.5 border ${
                      on ? 'bg-brand-cyan/15 text-brand-cyan border-brand-cyan/40' : 'bg-white/[0.03] text-text-muted border-white/[0.06]'
                    }`}
                  >
                    <Icon name={q.icon} size={13} />{q.label}
                  </button>
                );
              })}
            </div>
          )}
          {loading ? (
            <div className="py-10 text-center"><div className="w-5 h-5 mx-auto border-2 border-surface-3 border-t-brand-cyan rounded-full animate-spin" /></div>
          ) : filtered.length === 0 ? (
            <EmptyState variant={variant} />
          ) : (
            <div className="space-y-2">
              {filtered.map(t => <TournamentRow key={t.id} t={t} onClick={() => onCardClick(t)} />)}
            </div>
          )}
        </div>
      </div>
    );
  }

  // Desktop 3-column
  return (
    <div className="flex min-h-screen">
      <div className="flex-1 min-w-0 flex flex-col">
        <AppHeader title={header.title} subtitle={header.subtitle} />

        <div className="flex-1 px-6 py-5 space-y-5">
          {/* Status pills */}
          {variant !== 'past' && (
            <div className="flex gap-2 flex-wrap">
              {STATUS_TABS_DEFAULT.map(tab => {
                const active = status === tab.key;
                return (
                  <button key={tab.key} onClick={() => setStatus(tab.key)}
                    className={`px-3.5 py-2 rounded-full text-xs font-semibold transition-colors inline-flex items-center gap-2 ${
                      active
                        ? 'bg-gradient-to-r from-brand-violet to-brand-pink text-white shadow-lg shadow-brand-violet/30'
                        : 'bg-white/[0.04] text-text-secondary hover:text-text-primary border border-white/[0.06]'
                    }`}
                  >{tab.label}</button>
                );
              })}
            </div>
          )}

          {/* Filter toolbar */}
          <div className="flex items-center gap-2 flex-wrap">
            <Dropdown label="Game" icon="sports_esports" options={games} value={game} onChange={setGame} />
            <Dropdown label="Region" icon="public" options={['All Regions','NA','EU','APAC','Global']} value={region} onChange={setRegion} />
            <div className="flex-1" />
            <ViewToggle view={view} setView={setView} />
          </div>

          {/* Quick filters */}
          {variant !== 'past' && (
            <div className="flex gap-2 flex-wrap">
              {QUICK_FILTERS.map(q => {
                const on = quick.has(q.key);
                return (
                  <button key={q.key} onClick={() => toggleQuick(q.key)}
                    className={`px-3 py-1.5 rounded-full text-[11px] font-semibold transition-colors inline-flex items-center gap-1.5 border ${
                      on
                        ? 'bg-brand-cyan/15 text-brand-cyan border-brand-cyan/40'
                        : 'bg-white/[0.03] text-text-muted border-white/[0.06] hover:text-text-primary'
                    }`}
                  >
                    <Icon name={q.icon} size={13} />{q.label}
                  </button>
                );
              })}
            </div>
          )}

          {/* Results summary */}
          <div className="flex items-center justify-between">
            <div className="text-[12px] text-text-muted">
              Showing <span className="text-text-primary font-bold font-dmmono tabular-nums">{filtered.length}</span> of <span className="font-dmmono tabular-nums">{tournaments.length}</span>
              {isTypeVariant && typeConfig ? ` ${typeConfig.label.toLowerCase()} events` : ' tournaments'}
            </div>
          </div>

          {/* Body */}
          {loading ? (
            <div className="py-16 flex justify-center">
              <div className="w-6 h-6 border-2 border-surface-3 border-t-brand-cyan rounded-full animate-spin" />
            </div>
          ) : filtered.length === 0 ? (
            <EmptyState variant={variant} />
          ) : view === 'grid' ? (
            <div className="grid grid-cols-1 md:grid-cols-2 2xl:grid-cols-3 gap-4">
              {filtered.map(t => <TournamentCard key={t.id} t={t} onClick={() => onCardClick(t)} />)}
            </div>
          ) : view === 'list' ? (
            <div className="space-y-2">
              {filtered.map(t => <TournamentRow key={t.id} t={t} onClick={() => onCardClick(t)} />)}
            </div>
          ) : (
            <div className="rounded-2xl bg-[#12132099] border border-white/[0.06] p-2">
              <div className="grid grid-cols-[28px_1fr_120px_130px_100px_110px_120px] gap-3 px-3 py-2 border-b border-white/[0.05] text-[9.5px] font-dmmono uppercase tracking-[0.14em] text-text-muted">
                <span /><span>Tournament</span><span>Format</span><span>Prize</span><span>Players</span><span>Starts</span><span />
              </div>
              <div className="space-y-0.5 mt-1">
                {filtered.map(t => <TournamentCompact key={t.id} t={t} onClick={() => onCardClick(t)} />)}
              </div>
            </div>
          )}
        </div>
      </div>

      <TournamentRightRail />
    </div>
  );
}

function EmptyState({ variant }) {
  const navigate = useNavigate();
  const messages = {
    all:       { icon: 'emoji_events',   line: 'No tournaments match these filters yet.', cta: { label: 'Create Tournament', path: '/create-tournament' } },
    mine:      { icon: 'sports',          line: 'You haven\'t joined or hosted a tournament yet.', cta: { label: 'Browse tournaments', path: '/tournaments/all' } },
    following: { icon: 'group',           line: 'People you follow haven\'t hosted any tournaments yet.', cta: { label: 'Find players', path: '/explore' } },
    past:      { icon: 'history',         line: 'No past tournaments yet.', cta: { label: 'Find your first tournament', path: '/tournaments/all' } },
    type:      { icon: 'filter_alt_off',  line: 'Nothing in this format right now.', cta: { label: 'Host one', path: '/create-tournament' } },
  };
  const m = messages[variant] || messages.all;
  return (
    <div className="rounded-2xl bg-white/[0.02] border border-dashed border-white/[0.08] p-12 text-center">
      <Icon name={m.icon} size={42} className="text-text-muted/40 mx-auto mb-3" />
      <p className="text-text-muted text-sm">{m.line}</p>
      {m.cta && (
        <button onClick={() => navigate(m.cta.path)} className="mt-4 px-4 py-2 rounded-lg bg-gradient-to-r from-brand-violet to-brand-pink text-white text-xs font-bold">
          {m.cta.label}
        </button>
      )}
    </div>
  );
}
