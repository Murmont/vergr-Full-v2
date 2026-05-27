import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { collection, query, orderBy, limit, getDocs } from 'firebase/firestore';
import { db } from '../../firebase/config';
import { getGameWeeklyLeaderboard } from '../../firebase/firestore';
import { TOURNAMENT_GAMES } from '../../utils/tournamentGames';
import { useAuth } from '../../context/AuthContext';
import TopBar from '../../components/TopBar';
import UserAvatar from '../../components/UserAvatar';
import Icon from '../../components/Icon';
import RightSidebarPanel from '../../components/RightSidebarPanel';
import useResponsive from '../../hooks/useResponsive';
import { useLayout } from '../../context/LayoutContext';

const CATEGORIES = [
  { key: 'vp', label: 'Top VP', field: 'vp', icon: 'star', suffix: 'VP' },
  { key: 'vpLevel', label: 'Highest Level', field: 'vpLevel', icon: 'trending_up', suffix: 'LVL' },
  // Tournament Points (TP) — separate from VP, awarded to every participant
  // on tournament completion, scaled by placement + tournament size + entry fee.
  { key: 'tournamentPoints', label: 'Top Players', field: 'tournamentPoints', icon: 'leaderboard', suffix: 'TP' },
  // Read from the actual aggregateTournamentStats rollup fields.
  { key: 'tournamentWins', label: 'Tournament Wins', field: 'tournamentStats.won', icon: 'emoji_events' },
  // Tournament esports additions (see CLAUDE.md: trust score visible >=5 verified matches)
  { key: 'tournamentTrust', label: 'Most Trusted', field: 'tournamentTrust.score', icon: 'verified', suffix: 'TRUST' },
  { key: 'tournamentPrize', label: 'Top Prize', field: 'tournamentStats.earnedCoins', icon: 'paid', suffix: 'c' },
  { key: 'tournamentMatches', label: 'Most Matches', field: 'tournamentTrust.verifiedMatches', icon: 'sports_esports' },
  { key: 'topPredictor', label: 'Top Predictor', field: 'predictor.totalCorrect', icon: 'psychology' },
  { key: 'predictorStreak', label: 'Hottest Streak', field: 'predictor.currentStreak', icon: 'local_fire_department' },
  { key: 'earnings', label: 'Top Earners', field: 'totalEarned', icon: 'paid' },
  { key: 'xp', label: 'Top XP', field: 'totalXP', icon: 'military_tech' },
  { key: 'posts', label: 'Top Posters', field: 'postCount', icon: 'edit_note' },
  { key: 'followers', label: 'Most Followed', field: 'followerCount', icon: 'group' },
  { key: 'streamers', label: 'Top Streamers', field: 'streamHours', icon: 'live_tv', suffix: 'hrs' },
  // GR2 — per-game weekly board. Computed from recent tournaments, not a user field.
  { key: 'gameWeekly', label: 'By Game (week)', field: null, icon: 'sports_esports', suffix: 'W', perGame: true },
];

// A short popular-games shortlist for the GR2 game picker.
const GAME_PICKS = ['Counter-Strike 2', 'VALORANT', 'League of Legends', 'EA Sports FC 25 (FIFA)', 'NBA 2K', 'Apex Legends', 'Rocket League', 'Fortnite']
  .filter((g) => TOURNAMENT_GAMES.some((tg) => tg.label === g));

const PERIODS = ['All Time', 'This Month', 'This Week'];
const PODIUM_COLORS = { 0: '#F5C542', 1: '#C0C0C0', 2: '#CD7F32' };

export default function LeaderboardScreen() {
  const [category, setCategory] = useState(CATEGORIES[0]);
  const [period, setPeriod] = useState('All Time');
  const [selectedGame, setSelectedGame] = useState(GAME_PICKS[0] || 'Counter-Strike 2');
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const { currentUser } = useAuth();
  const navigate = useNavigate();
  const { isMobile, isDesktop } = useResponsive();
  const { setRightPanel, setContentAlign } = useLayout();

  useEffect(() => {
    setRightPanel(isDesktop ? <RightSidebarPanel /> : null);
    setContentAlign('left');
    return () => { setRightPanel(null); setContentAlign('center'); };
  }, [setRightPanel, setContentAlign, isDesktop]);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        if (category.perGame) {
          // GR2 — per-game weekly board, computed from recent tournaments.
          const rows = await getGameWeeklyLeaderboard(selectedGame);
          setEntries(rows.map((u, i) => ({ ...u, rank: i + 1, isYou: u.id === currentUser?.uid })));
        } else {
          // Nested field paths (e.g. 'tournamentTrust.score') work with Firestore
          // orderBy when passed as a dotted string. Filter zero-value rows client-side
          // since orderBy can't combine with a !=0 inequality on the same field cheaply.
          const q = query(collection(db, 'users'), orderBy(category.field, 'desc'), limit(50));
          const snap = await getDocs(q);
          const getVal = (u, path) => path.split('.').reduce((o, k) => (o == null ? null : o[k]), u);
          const users = snap.docs
            .map((d, i) => ({ id: d.id, rank: i + 1, ...d.data(), isYou: d.id === currentUser?.uid }))
            .filter(u => (getVal(u, category.field) || 0) > 0);
          setEntries(users);
        }
      } catch (err) {
        console.error('Leaderboard error:', err);
        setEntries([]);
      }
      setLoading(false);
    };
    load();
  }, [category, selectedGame, currentUser]);

  // GR2 — value accessor: per-game board shows wins, others read the field.
  const valOf = (u) => category.perGame
    ? (u.wins || 0)
    : (category.field ? category.field.split('.').reduce((o, k) => (o == null ? null : o[k]), u) : 0);

  const top3 = entries.slice(0, 3);
  const rest = entries.slice(3);
  const formatVal = (n) => {
    if (!n) return '0';
    if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
    if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
    return n.toLocaleString();
  };

  return (
    <div className="pb-8">
      {isMobile && <TopBar title="Leaderboard" showBack />}
      {!isMobile && (
        <div className="px-4 pt-5 pb-2">
          <h1 className="font-syne text-2xl font-extrabold text-white">Leaderboard</h1>
        </div>
      )}

      {/* Category tabs */}
      <div className="flex gap-2 px-4 py-3 overflow-x-auto no-scrollbar">
        {CATEGORIES.map(cat => (
          <button key={cat.key} onClick={() => setCategory(cat)}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-full text-xs font-bold whitespace-nowrap transition-all ${
              category.key === cat.key ? 'bg-brand-cyan text-bg-dark' : 'bg-surface-2 text-text-secondary hover:text-white'
            }`}>
            <Icon name={cat.icon} size={14} /> {cat.label}
          </button>
        ))}
      </div>

      {/* GR2 — game picker, only for the per-game weekly board */}
      {category.perGame && (
        <div className="flex gap-2 px-4 pb-3 overflow-x-auto no-scrollbar">
          {GAME_PICKS.map((g) => (
            <button key={g} onClick={() => setSelectedGame(g)}
              className={`px-3 py-1.5 rounded-full text-[11px] font-bold whitespace-nowrap transition-all ${
                selectedGame === g ? 'bg-brand-violet text-white' : 'bg-surface-2 text-text-secondary hover:text-white'
              }`}>
              {g}
            </button>
          ))}
        </div>
      )}

      <div className="px-4">
        {category.perGame && (
          <p className="text-text-muted text-[11px] mb-3">Top players in {selectedGame} this week (by tournament wins + activity).</p>
        )}
        {loading ? (
          <div className="flex justify-center py-16"><div className="w-8 h-8 border-3 border-brand-cyan border-t-transparent rounded-full animate-spin" /></div>
        ) : entries.length === 0 ? (
          <div className="text-center py-16">
            <Icon name="leaderboard" size={48} className="text-text-muted/20 mx-auto mb-3" />
            <p className="text-text-muted text-sm">No data yet. Be the first on the board!</p>
          </div>
        ) : (
          <>
            {/* Podium — top 3 */}
            {top3.length >= 3 && (
              <div className="flex items-end justify-center gap-3 py-6 mb-4">
                {[1, 0, 2].map(idx => {
                  const user = top3[idx];
                  if (!user) return null;
                  const isFirst = idx === 0;
                  return (
                    <button key={user.id} onClick={() => navigate(`/user/${user.id}`)}
                      className="flex flex-col items-center group">
                      <div className={`relative ${isFirst ? 'mb-2' : 'mb-1'}`}>
                        {isFirst && <Icon name="emoji_events" size={24} className="text-brand-gold absolute -top-6 left-1/2 -translate-x-1/2" />}
                        <div className="rounded-full p-[2px]" style={{ background: PODIUM_COLORS[idx] }}>
                          <UserAvatar src={user.avatar} size={isFirst ? 64 : 48} />
                        </div>
                        <div className="absolute -bottom-1 -right-1 w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-black text-bg-dark"
                          style={{ background: PODIUM_COLORS[idx] }}>
                          {idx + 1}
                        </div>
                      </div>
                      <p className={`font-bold truncate max-w-[80px] ${isFirst ? 'text-sm' : 'text-xs'} ${user.isYou ? 'text-brand-cyan' : 'text-text-primary'}`}>
                        {user.displayName || user.username}
                      </p>
                      <p className="text-text-muted text-[10px] font-dmmono">{formatVal(valOf(user))}</p>
                    </button>
                  );
                })}
              </div>
            )}

            {/* Rest of leaderboard */}
            <div className="space-y-1.5">
              {rest.map(user => (
                <button key={user.id} onClick={() => navigate(`/user/${user.id}`)}
                  className={`w-full flex items-center gap-3 p-3 rounded-xl transition-all ${
                    user.isYou ? 'bg-brand-cyan/10 border border-brand-cyan/30' : 'bg-surface-1 border border-white/[0.06] hover:border-white/[0.12]'
                  }`}>
                  <span className="w-8 text-center text-text-muted text-xs font-dmmono font-bold">{user.rank}</span>
                  <UserAvatar src={user.avatar} size={36} />
                  <div className="flex-1 text-left min-w-0">
                    <p className={`text-sm font-semibold truncate ${user.isYou ? 'text-brand-cyan' : 'text-text-primary'}`}>{user.displayName || user.username}</p>
                    <p className="text-text-muted text-xs font-dmmono">@{user.username}</p>
                  </div>
                  <span className="text-sm font-dmmono font-bold text-brand-gold">
                    {formatVal(valOf(user))}
                    {category.suffix && <span className="text-[10px] text-text-muted ml-1">{category.suffix}</span>}
                  </span>
                  {user.isYou && <span className="px-2 py-0.5 rounded-full bg-brand-cyan/15 text-brand-cyan text-[9px] font-bold">YOU</span>}
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
