// Shared right-rail for every Tournaments screen. Lives outside any one
// screen so it can be reused identically on Overview, All, Mine, Following,
// Past, Type, and Applications.
//
// Cards rendered: My Stats, Live Tournaments, Upcoming, How It Works.

import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Icon from '../Icon';
import AppRightRail from '../brand/AppRightRail';
import { SectionCard, StatTile } from '../brand/SectionCard';
import { useUser } from '../../context/UserContext';
import { getTournaments, getUserTournaments } from '../../firebase/firestore';
import { mapTournaments } from './tournamentMappers';

const HOW_IT_WORKS = [
  { icon: 'search', title: 'Find',    body: 'Browse tournaments by game, format or prize.' },
  { icon: 'groups', title: 'Compete', body: 'Join solo or with your squad. Submit results.' },
  { icon: 'emoji_events', title: 'Win', body: 'Climb the bracket and take home the pot.' },
  { icon: 'paid',   title: 'Earn',    body: 'Prize money splits automatically to your wallet.' },
];

export default function TournamentRightRail() {
  const navigate = useNavigate();
  const { profile } = useUser();
  const [live, setLive] = useState([]);
  const [upcoming, setUpcoming] = useState([]);
  // `active` is a live count (changes as tournaments open/close), so it's
  // computed here rather than stored. `won` + `earnedCoins` are cumulative
  // and maintained server-side by the aggregateTournamentStats trigger.
  const [activeCount, setActiveCount] = useState(0);

  useEffect(() => {
    (async () => {
      try {
        const [liveDocs, openDocs] = await Promise.all([
          getTournaments('live', 5),
          getTournaments('open', 5),
        ]);
        setLive(mapTournaments(liveDocs));
        setUpcoming(mapTournaments(openDocs));
      } catch (err) {
        console.error('TournamentRightRail load', err);
      }
    })();
  }, []);

  useEffect(() => {
    if (!profile?.uid) return;
    let cancelled = false;
    (async () => {
      try {
        const mine = await getUserTournaments(profile.uid, 50);
        if (cancelled) return;
        const open = mine.filter(t => t.status === 'open' || t.status === 'live' || t.status === 'active');
        setActiveCount(open.length);
      } catch (err) {
        console.warn('TournamentRightRail active count failed', err.message);
      }
    })();
    return () => { cancelled = true; };
  }, [profile?.uid]);

  const stats = profile?.tournamentStats || {};
  const won = stats.won || 0;
  const earned = stats.earnedCoins || 0;

  return (
    <AppRightRail width={320}>
      <SectionCard title="My Stats" action="View All" onAction={() => navigate('/tournaments/me/stats')} padding="p-4">
        <div className="grid grid-cols-3 gap-2">
          <StatTile icon="emoji_events" iconColor="text-brand-violet-light" label="Active" value={activeCount} />
          <StatTile icon="military_tech" iconColor="text-brand-gold" label="Won" value={won} />
          <StatTile icon="paid" iconColor="text-brand-violet" label="Earned" value={earned.toLocaleString()} />
        </div>
      </SectionCard>

      <SectionCard title="Live Tournaments" action="All" onAction={() => navigate('/tournaments/all')} padding="p-3">
        {live.length === 0 ? (
          <div className="px-2 py-4 text-center">
            <p className="text-text-muted text-[11px]">No live events right now</p>
          </div>
        ) : (
          <div className="space-y-2">
            {live.map(l => (
              <button key={l.id} onClick={() => navigate(`/match/${l.id}`)} className="w-full flex items-center gap-3 p-2 rounded-xl hover:bg-white/[0.03] transition-colors text-left">
                <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-brand-ember/30 to-brand-ember/10 flex items-center justify-center shrink-0">
                  <span className="text-[9px] font-dmmono font-bold text-brand-ember">LIVE</span>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-[13px] font-semibold text-text-primary truncate">{l.name}</div>
                  <div className="text-[11px] text-text-muted truncate">{l.game} · {l.regd} entrants</div>
                </div>
              </button>
            ))}
          </div>
        )}
      </SectionCard>

      <SectionCard title="Upcoming" padding="p-3">
        {upcoming.length === 0 ? (
          <div className="px-2 py-4 text-center">
            <p className="text-text-muted text-[11px]">No upcoming tournaments</p>
          </div>
        ) : (
          <div className="space-y-2">
            {upcoming.slice(0, 4).map(u => (
              <button key={u.id} onClick={() => navigate(`/match/${u.id}`)} className="w-full flex items-center gap-3 p-2 rounded-xl hover:bg-white/[0.03] transition-colors text-left">
                <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-brand-violet/30 to-brand-violet/10 flex items-center justify-center shrink-0">
                  <Icon name="schedule" size={16} className="text-brand-violet" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-[13px] font-semibold text-text-primary truncate">{u.name}</div>
                  <div className="text-[11px] text-text-muted truncate">{u.game} · {u.countdown || 'TBD'}</div>
                </div>
              </button>
            ))}
          </div>
        )}
      </SectionCard>

      <SectionCard title="How It Works" padding="p-4">
        <div className="grid grid-cols-2 gap-2">
          {HOW_IT_WORKS.map((s, i) => (
            <div key={i} className="rounded-lg bg-white/[0.03] border border-white/[0.05] p-2.5">
              <Icon name={s.icon} size={16} className="text-brand-violet-light mb-1" />
              <div className="text-[11px] font-bold text-text-primary">{s.title}</div>
              <div className="text-[10px] text-text-muted leading-snug mt-0.5">{s.body}</div>
            </div>
          ))}
        </div>
      </SectionCard>
    </AppRightRail>
  );
}
