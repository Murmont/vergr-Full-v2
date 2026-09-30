// NativeTournamentScreen — dedicated phone-first Tournaments hub for the native
// APK. Reuses the exact Firestore queries + spotlight logic as the web
// TournamentScreen, but is a single-column, safe-area-aware redesign: sticky
// glass header inset below the status bar, horizontal filter scroller, compact
// phone-tuned rows, bottom padding that clears the native bottom nav + home
// indicator. Routed IS_NATIVE_BUILD only. Brand violet/pink/gold (no cyan).

import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useUser } from '../../../context/UserContext';
import { getTournaments, getFeaturedTournament } from '../../../firebase/firestore';
import { gameById } from '../../../utils/tournamentGames';
import Icon from '../../../components/Icon';
import HeroBanner from '../../../components/brand/HeroBanner';
import CoinDisplay from '../../../components/CoinDisplay';
import BrawlQuickplay from '../../../components/tournament/BrawlQuickplay';
import { TournamentOnboarding } from '../TournamentScreen';

const safeTop = { paddingTop: 'calc(env(safe-area-inset-top, 0px) + 8px)' };
const SHOWABLE = ['open', 'registration', 'live', 'active'];
const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'open', label: 'Open' },
  { key: 'active', label: 'Live' },
  { key: 'completed', label: 'Past' },
];

const formatDate = (ts) => {
  if (!ts) return '';
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
};

export default function NativeTournamentScreen() {
  const [filter, setFilter] = useState('all');
  const [tournaments, setTournaments] = useState([]);
  const [featured, setFeatured] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showOnboard, setShowOnboard] = useState(false);
  const [showBrawl, setShowBrawl] = useState(false);
  const { wallet } = useUser();
  const navigate = useNavigate();

  // OP3 first-run explainer, once per device.
  useEffect(() => {
    try { if (!localStorage.getItem('vergr.tourney.onboarded')) setShowOnboard(true); } catch { /* ignore */ }
  }, []);
  const dismissOnboard = () => {
    try { localStorage.setItem('vergr.tourney.onboarded', '1'); } catch { /* ignore */ }
    setShowOnboard(false);
  };

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      try {
        const status = filter === 'all' ? null : filter;
        const data = await getTournaments(status, 20);
        if (!cancelled) setTournaments(data);
      } catch (err) { console.error(err); }
      if (!cancelled) setLoading(false);
    };
    load();
    return () => { cancelled = true; };
  }, [filter]);

  useEffect(() => {
    let cancelled = false;
    getFeaturedTournament().then((t) => { if (!cancelled) setFeatured(t); }).catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const fallbackSpotlight = tournaments
    .filter(t => SHOWABLE.includes(t.status))
    .sort((a, b) => (b.prizePool || 0) - (a.prizePool || 0))[0] || null;
  const spotlight = (featured && SHOWABLE.includes(featured.status)) ? featured : fallbackSpotlight;

  return (
    <div className="min-h-screen" style={{ paddingBottom: 'calc(88px + var(--vg-safe-b, 0px))' }}>
      {showOnboard && <TournamentOnboarding onClose={dismissOnboard} />}
      {showBrawl && <BrawlQuickplay onClose={() => setShowBrawl(false)} />}

      {/* Sticky native header, inset below the status bar */}
      <div className="sticky top-0 z-20 bg-bg-dark/95 backdrop-blur-md border-b border-surface-3" style={safeTop}>
        <div className="px-4 pb-2 flex items-center justify-between gap-2">
          <h1 className="font-syne text-xl font-black text-text-primary">Tournaments</h1>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowBrawl(true)}
              className="h-9 px-3 rounded-full bg-brand-violet/15 border border-brand-violet-light/40 flex items-center gap-1.5 text-brand-violet-light text-xs font-bold"
              aria-label="Brawl quickplay"
            >
              <Icon name="bolt" size={16} /> Brawl
            </button>
            <button
              onClick={() => navigate('/tournaments/me/stats')}
              className="w-9 h-9 rounded-full bg-surface-2 flex items-center justify-center"
              aria-label="My tournament stats"
            >
              <Icon name="leaderboard" size={18} className="text-brand-violet-light" />
            </button>
            <CoinDisplay amount={wallet?.balance || 0} size="sm" />
          </div>
        </div>
        <div className="flex gap-2 px-4 pb-2 overflow-x-auto no-scrollbar">
          {FILTERS.map(f => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className="px-4 py-2 rounded-full text-xs font-semibold whitespace-nowrap shrink-0"
              style={filter === f.key
                ? { background: 'linear-gradient(90deg,#7B1FFF,#C87FFF)', color: '#fff' }
                : { background: '#1A1A2A', border: '1px solid #2A2A3E', color: '#9CA3AF' }}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      <div className="px-4 pt-3 space-y-4">
        {spotlight && (
          <HeroBanner
            variant="trophy"
            eyebrow="Spotlight"
            title={spotlight.name}
            cta={{ label: 'View Details', onClick: () => navigate(`/match/${spotlight.id}`) }}
            height="sm"
          />
        )}

        {loading ? (
          <div className="space-y-2.5">
            {[0, 1, 2, 3].map(i => (
              <div key={i} className="h-[68px] rounded-2xl bg-white/[0.03] border border-white/[0.05] animate-pulse" />
            ))}
          </div>
        ) : tournaments.length === 0 ? (
          <div className="text-center py-16">
            <Icon name="emoji_events" size={48} className="text-text-muted/30 mx-auto mb-3" />
            <p className="text-text-muted text-sm">No tournaments match this filter</p>
          </div>
        ) : (
          <div className="space-y-2.5">
            {tournaments.map(t => (
              <NativeTournamentRow key={t.id} t={t} onClick={() => navigate(`/match/${t.id}`)} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function NativeTournamentRow({ t, onClick }) {
  const prize = (t.prizePool || 0).toLocaleString();
  const entry = t.entryFee ? `${t.entryFee}` : 'Free';
  const live = t.status === 'live' || t.status === 'active';
  const art = t.bannerUrl || gameById(t.game)?.coverArt || null;
  return (
    <button
      onClick={onClick}
      className="w-full flex items-center gap-3 p-2.5 rounded-2xl bg-white/[0.03] border border-white/[0.06] active:bg-white/[0.06] transition-colors text-left"
    >
      <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-brand-violet/30 to-brand-pink/20 flex items-center justify-center shrink-0 overflow-hidden">
        {art
          ? <img src={art} alt={t.game || ''} loading="lazy" className="w-full h-full object-cover" />
          : <Icon name="emoji_events" size={24} className="text-brand-violet-light" />}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="font-semibold text-sm text-text-primary truncate">{t.name}</span>
          {live && <span className="px-1.5 py-0.5 rounded-full bg-brand-ember text-white text-[9px] font-bold shrink-0">LIVE</span>}
        </div>
        <div className="text-[11px] text-text-muted truncate">{t.game}{t.startDate && ` · ${formatDate(t.startDate)}`}</div>
        <div className="flex items-center gap-3 mt-1">
          <span className="flex items-center gap-1">
            <img src="/brand/vc-coin.webp" alt="" className="w-3.5 h-3.5 object-contain" />
            <span className="font-dmmono text-xs font-bold text-brand-gold tabular-nums">{prize}</span>
          </span>
          <span className="text-[10px] text-text-muted">Entry <span className="font-dmmono font-bold text-text-secondary">{entry}</span></span>
        </div>
      </div>
      {/* "View", not "Register": entry is desktop-only, so a Register label
          here would promise something the detail screen cannot deliver. */}
      {t.status === 'open'
        ? <span className="px-3 py-1.5 rounded-lg bg-gradient-to-r from-brand-violet to-brand-pink text-white text-[11px] font-bold shrink-0">View</span>
        : <Icon name="chevron_right" size={20} className="text-text-muted shrink-0" />}
    </button>
  );
}
