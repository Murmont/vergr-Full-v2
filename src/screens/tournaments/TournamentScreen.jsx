import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useUser } from '../../context/UserContext';
import { getTournaments, getFeaturedTournament } from '../../firebase/firestore';
import { useLayout } from '../../context/LayoutContext';
import useResponsive from '../../hooks/useResponsive';
import Icon from '../../components/Icon';
import AppHeader from '../../components/brand/AppHeader';
import HeroBanner from '../../components/brand/HeroBanner';
import { SectionCard } from '../../components/brand/SectionCard';
import TopBar from '../../components/TopBar';
import CoinDisplay from '../../components/CoinDisplay';
import TournamentRightRail from '../../components/tournament/TournamentRightRail';

export default function TournamentScreen() {
  const [filter, setFilter] = useState('all');
  const [tournaments, setTournaments] = useState([]);
  const [featured, setFeatured] = useState(null);
  const [loading, setLoading] = useState(true);
  // The "Spotlight" hero. Highest-prize open or live tournament, computed
  // from the same `tournaments` array so we don't pay for an extra query.
  const { wallet } = useUser();
  const navigate = useNavigate();
  const { isDesktop } = useResponsive();
  const { setRightPanel, setContentAlign } = useLayout();

  useEffect(() => {
    setRightPanel(null);
    setContentAlign('left');
    return () => { setRightPanel(null); setContentAlign('center'); };
  }, [setRightPanel, setContentAlign]);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        const status = filter === 'all' ? null : filter;
        const data = await getTournaments(status, 20);
        setTournaments(data);
      } catch (err) { console.error(err); }
      setLoading(false);
    };
    load();
  }, [filter]);

  // Curated "tournament of the day" pick (cron-scored). Fetched once.
  useEffect(() => {
    let cancelled = false;
    getFeaturedTournament().then((t) => { if (!cancelled) setFeatured(t); }).catch(() => {});
    return () => { cancelled = true; };
  }, []);

  // Spotlight: prefer the cron-curated pick when it's still showable; else
  // fall back to the highest-prize open/live tournament from the loaded list.
  const SHOWABLE = ['open', 'registration', 'live', 'active'];
  const fallbackSpotlight = tournaments
    .filter(t => SHOWABLE.includes(t.status))
    .sort((a, b) => (b.prizePool || 0) - (a.prizePool || 0))[0] || null;
  const spotlight = (featured && SHOWABLE.includes(featured.status)) ? featured : fallbackSpotlight;

  const formatDate = (ts) => {
    if (!ts) return '';
    const d = ts.toDate ? ts.toDate() : new Date(ts);
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  };

  // Mobile: keep the simple stacked layout
  if (!isDesktop) {
    return (
      <div className="screen-container min-h-screen pb-8">
        <TopBar title="Tournaments" showBack actions={<CoinDisplay amount={wallet?.balance || 0} size="sm" />} />
        <div className="px-4 pt-3">
          {spotlight && (
            <HeroBanner
              variant="trophy"
              eyebrow="Spotlight"
              title={spotlight.name}
              cta={{ label: 'View Details', onClick: () => navigate(`/match/${spotlight.id}`) }}
              height="sm"
            />
          )}
        </div>
        <div className="flex gap-2 px-4 py-3 overflow-x-auto no-scrollbar">
          {[{ key: 'all', label: 'All' }, { key: 'open', label: 'Open' }, { key: 'active', label: 'Live' }, { key: 'completed', label: 'Past' }].map(f => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className={`px-4 py-2 rounded-full text-xs font-semibold whitespace-nowrap ${filter === f.key ? 'bg-brand-violet text-white' : 'bg-surface-2 text-text-muted'}`}
            >
              {f.label}
            </button>
          ))}
        </div>
        <div className="px-4 space-y-3">
          {tournaments.map(t => <TournamentRow key={t.id} t={t} onClick={() => navigate(`/match/${t.id}`)} formatDate={formatDate} />)}
          {!loading && tournaments.length === 0 && (
            <div className="text-center py-16">
              <Icon name="emoji_events" size={48} className="text-text-muted/30 mx-auto mb-3" />
              <p className="text-text-muted text-sm">No tournaments yet</p>
            </div>
          )}
        </div>
      </div>
    );
  }

  // Desktop: 3-column with contextual right rail
  return (
    <div className="flex min-h-screen">
      <div className="flex-1 min-w-0 flex flex-col">
        <AppHeader
          title="Tournaments"
          subtitle="Compete. Win. Earn."
        />

        <div className="flex-1 px-6 py-5 space-y-5">
          {/* Hero — spotlight the highest-prize live/open tournament */}
          {spotlight && (
            <HeroBanner
              variant="trophy"
              eyebrow="Spotlight"
              title={spotlight.name}
              subtitle={`${spotlight.game} · ${(spotlight.prizePool || 0).toLocaleString()} coin prize pool`}
              cta={{ label: 'View Details', onClick: () => navigate(`/match/${spotlight.id}`) }}
              height="md"
            />
          )}

          {/* Filter tabs */}
          <div className="flex gap-2">
            {[
              { key: 'all', label: 'All Tournaments' },
              { key: 'open', label: 'Open' },
              { key: 'active', label: 'Live' },
              { key: 'completed', label: 'Past Tournaments' },
            ].map(f => (
              <button
                key={f.key}
                onClick={() => setFilter(f.key)}
                className={`px-4 py-2 rounded-full text-xs font-semibold transition-colors ${
                  filter === f.key
                    ? 'bg-gradient-to-r from-brand-violet to-brand-pink text-white shadow-lg shadow-brand-violet/30'
                    : 'bg-white/[0.04] text-text-muted hover:text-text-primary border border-white/[0.06]'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>

          {/* Upcoming tournaments list */}
          <SectionCard title="Upcoming Tournaments" action="View All" onAction={() => navigate('/tournaments/all')}>
            {loading ? (
              <div className="flex justify-center py-8">
                <div className="w-5 h-5 border-2 border-surface-3 border-t-brand-cyan rounded-full animate-spin" />
              </div>
            ) : tournaments.length === 0 ? (
              <div className="text-center py-8">
                <Icon name="emoji_events" size={40} className="text-text-muted/30 mx-auto mb-2" />
                <p className="text-text-muted text-sm">No tournaments match this filter</p>
              </div>
            ) : (
              <div className="space-y-2">
                {tournaments.map(t => (
                  <TournamentRow key={t.id} t={t} onClick={() => navigate(`/match/${t.id}`)} formatDate={formatDate} />
                ))}
              </div>
            )}
          </SectionCard>
        </div>
      </div>

      <TournamentRightRail />
    </div>
  );
}

function TournamentRow({ t, onClick, formatDate }) {
  const prize = (t.prizePool || 0).toLocaleString();
  const entry = t.entryFee ? `${t.entryFee}` : 'Free';
  return (
    <button
      onClick={onClick}
      className="w-full flex items-center gap-3 p-3 rounded-xl bg-white/[0.02] border border-white/[0.05] hover:border-white/[0.12] hover:bg-white/[0.04] transition-all text-left"
    >
      <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-brand-violet/30 to-brand-pink/20 flex items-center justify-center shrink-0">
        <Icon name="emoji_events" size={22} className="text-brand-cyan" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <div className="font-semibold text-sm text-text-primary truncate">{t.name}</div>
          {(t.status === 'live' || t.status === 'active') && (
            <span className="px-1.5 py-0.5 rounded-full bg-brand-ember text-white text-[9px] font-bold">LIVE</span>
          )}
        </div>
        <div className="text-[11px] text-text-muted">{t.game}{t.startDate && ` · ${formatDate(t.startDate)}`}</div>
      </div>
      <div className="flex items-center gap-4 shrink-0">
        <div className="text-right">
          <div className="text-[9px] font-dmmono uppercase tracking-[0.12em] text-text-muted">Prize</div>
          <div className="flex items-center gap-1 justify-end">
            <img src="/brand/vc-coin.png" alt="VC" className="w-4 h-4 object-contain" />
            <span className="font-dmmono text-sm font-bold text-brand-gold tabular-nums">{prize}</span>
          </div>
        </div>
        <div className="text-right">
          <div className="text-[9px] font-dmmono uppercase tracking-[0.12em] text-text-muted">Entry</div>
          <div className="font-dmmono text-sm font-bold text-brand-cyan tabular-nums">{entry}</div>
        </div>
        {t.status === 'open' && (
          <div className="px-4 py-2 rounded-lg bg-gradient-to-r from-brand-violet to-brand-pink text-white text-xs font-bold">
            Register
          </div>
        )}
      </div>
    </button>
  );
}
