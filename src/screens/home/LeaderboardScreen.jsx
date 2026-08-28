import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { collection, query, orderBy, limit, getDocs } from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { db } from '../../firebase/config';
import { getUser } from '../../firebase/firestore';
import { getVPLevel } from '../../utils/vpSystem';
import { useAuth } from '../../context/AuthContext';
import TopBar from '../../components/TopBar';
import { ListSkeleton } from '../../components/skeletons/GlassSkeletons';
import UserAvatar from '../../components/UserAvatar';
import Icon from '../../components/Icon';
import RightSidebarPanel from '../../components/RightSidebarPanel';
import useResponsive from '../../hooks/useResponsive';
import { useLayout } from '../../context/LayoutContext';
import UserName from '../../components/UserName';
import RankBadge from '../../components/RankBadge';

// Five of the seven categories here could NEVER show anything (audit A20): they
// ordered `users` by a field nothing writes to a user doc, and Firestore omits
// documents that lack the ordered field, so the query came back empty every
// time. Top VP is the default tab, so an empty board was what every user saw.
//
//   vp, vpLevel  → fixed. VP really lives on `wallets`, which is owner-only, so
//                  a server callable reads it (see getVpLeaderboard). Level is
//                  derived from VP with the existing getVPLevel helper, and is
//                  monotonic in VP, so ONE query serves both tabs.
//   streamHours  → REMOVED. Nothing in the codebase has ever recorded stream
//                  hours. Tracking them is a feature, not a leaderboard fix.
//   totalXP      → REMOVED. Seeded to 0 at onboarding and never incremented.
//   totalEarned  → REMOVED. It exists on `wallets`, so it COULD be surfaced the
//                  same way vp is — but publishing a per-creator ranking of
//                  earnings is a product and privacy decision (it reveals what
//                  Vergr owes each creator), not a bug fix. Left out rather
//                  than decided unilaterally.
//
// `source: 'vp'` reads the callable; everything else keeps the users query.
const CATEGORIES = [
  { key: 'vp', label: 'Top VP', source: 'vp', icon: 'star', suffix: 'VP' },
  { key: 'vpLevel', label: 'Highest Level', source: 'vp', icon: 'trending_up', suffix: 'LVL', asLevel: true },
  // Ranked on lifetime GROSS coins earned, read server-side from `wallets`
  // (owner-only, so the client cannot query it). Shown in coins, which is the
  // unit the platform earns in.
  { key: 'earnings', label: 'Top Earners', source: 'earners', icon: 'paid', suffix: 'c' },
  { key: 'followers', label: 'Most Followed', field: 'followerCount', icon: 'group' },
  { key: 'posts', label: 'Top Posters', field: 'postCount', icon: 'edit_note' },
];

const PERIODS = ['All Time', 'This Month', 'This Week'];
const PODIUM_COLORS = { 0: '#F5C542', 1: '#C0C0C0', 2: '#CD7F32' };

export default function LeaderboardScreen() {
  const [category, setCategory] = useState(CATEGORIES[0]);
  const [period, setPeriod] = useState('All Time');
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
        if (category.source === 'vp' || category.source === 'earners') {
          // Both figures live on `wallets`, which is owner-only, so the server
          // reads them and returns uid + the one ranking number. Profiles are
          // resolved here into the same shape the users query produces, so
          // everything downstream is unchanged.
          const fn = category.source === 'vp' ? 'getVpLeaderboard' : 'getEarnersLeaderboard';
          const res = await httpsCallable(getFunctions(undefined, 'europe-west1'), fn)({});
          const rows = res?.data?.rows || [];
          const profiles = await Promise.all(rows.map((r) => getUser(r.uid).catch(() => null)));
          setEntries(rows.map((r, i) => ({
            ...(profiles[i] || {}),
            id: r.uid,
            rank: i + 1,
            vp: r.vp,
            earned: r.earned,
            isYou: r.uid === currentUser?.uid,
          })));
        } else {
          // Nested field paths work with Firestore orderBy when passed as a
          // dotted string. Filter zero-value rows client-side since orderBy
          // can't combine with a !=0 inequality on the same field cheaply.
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
  }, [category, currentUser]);

  const valOf = (u) => {
    // Highest Level shows the LEVEL derived from the same VP figure. Level is
    // monotonic in VP, so the ordering is identical and one query serves both.
    if (category.asLevel) return getVPLevel(u?.vp || 0)?.level || 1;
    if (category.source === 'vp') return u?.vp || 0;
    if (category.source === 'earners') return u?.earned || 0;
    return category.field
      ? category.field.split('.').reduce((o, k) => (o == null ? null : o[k]), u)
      : 0;
  };

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
              category.key === cat.key ? 'bg-brand-violet text-white' : 'bg-surface-2 text-text-secondary hover:text-white'
            }`}>
            <Icon name={cat.icon} size={14} /> {cat.label}
          </button>
        ))}
      </div>

      <div className="px-4">
        {loading ? (
          <ListSkeleton rows={8} />
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
                      <p className={`font-bold truncate max-w-[80px] ${isFirst ? 'text-sm' : 'text-xs'} ${user.isYou ? 'text-brand-violet-light' : 'text-text-primary'}`}>
                        <UserName user={user} masked />
                        <RankBadge level={user?.vpLevel} role={user?.role} size={11} style={{ verticalAlign: '-2px' }} />
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
                    user.isYou ? 'bg-brand-violet/10 border border-brand-violet/30' : 'bg-surface-1 border border-white/[0.06] hover:border-white/[0.12]'
                  }`}>
                  <span className="w-8 text-center text-text-muted text-xs font-dmmono font-bold">{user.rank}</span>
                  <UserAvatar src={user.avatar} size={36} />
                  <div className="flex-1 text-left min-w-0">
                    <p className={`text-sm font-semibold truncate ${user.isYou ? 'text-brand-violet-light' : 'text-text-primary'}`}><UserName user={user} masked /></p>
                    <RankBadge level={user?.vpLevel} role={user?.role} size={12} style={{ verticalAlign: '-2px' }} />
                    <p className="text-text-muted text-xs font-dmmono"><UserName user={user} masked handle /></p>
                  </div>
                  <span className="text-sm font-dmmono font-bold text-brand-gold">
                    {formatVal(valOf(user))}
                    {category.suffix && <span className="text-[10px] text-text-muted ml-1">{category.suffix}</span>}
                  </span>
                  {user.isYou && <span className="px-2 py-0.5 rounded-full bg-brand-violet/15 text-brand-violet-light text-[9px] font-bold">YOU</span>}
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
