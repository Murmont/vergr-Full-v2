import { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useUser } from '../../context/UserContext';
import { getUserPosts, getTransactions, getFollowers } from '../../firebase/firestore';
import TopBar from '../../components/TopBar';
import CoinDisplay from '../../components/CoinDisplay';
import { StackSkeleton } from '../../components/skeletons/GlassSkeletons';
import Icon from '../../components/Icon';
import { useLayout } from '../../context/LayoutContext';
import useResponsive from '../../hooks/useResponsive';

export default function MonthlyAnalyticsScreen({ embedded = false }) {
  const { isDesktop } = useResponsive();
  const { setRightPanel, setContentAlign } = useLayout();

  useEffect(() => {
    if (embedded) return;
    setRightPanel(null);
    if (isDesktop) setContentAlign('left');
    return () => { setRightPanel(null); setContentAlign('center'); };
  }, [setRightPanel, setContentAlign, isDesktop, embedded]);
  const [period, setPeriod] = useState('30d');
  const [stats, setStats] = useState(null);
  const [topPosts, setTopPosts] = useState([]);
  const [loading, setLoading] = useState(true);

  const { currentUser } = useAuth();
  const { profile, wallet } = useUser();

  useEffect(() => {
    if (!currentUser) return;
    const load = async () => {
      setLoading(true);
      try {
        const [posts, txs, followers] = await Promise.all([
          getUserPosts(currentUser.uid, 50),
          getTransactions(currentUser.uid, 100),
          getFollowers(currentUser.uid, 100),
        ]);

        const periodMs = period === '7d' ? 7 * 86400000 : period === '30d' ? 30 * 86400000 : 90 * 86400000;
        const cutoff = Date.now() - periodMs;

        // Filter to period
        const periodPosts = posts.filter(p => {
          const t = p.createdAt?.toDate ? p.createdAt.toDate().getTime() : 0;
          return t > cutoff;
        });

        const periodEarnings = txs
          .filter(tx => {
            if (tx.amount <= 0) return false;
            const t = tx.createdAt?.toDate ? tx.createdAt.toDate().getTime() : 0;
            return t > cutoff;
          })
          .reduce((sum, tx) => sum + tx.amount, 0);

        const totalViews = periodPosts.reduce((s, p) => s + (p.viewCount || 0), 0);
        const totalLikes = periodPosts.reduce((s, p) => s + (p.likeCount || 0), 0);
        const totalComments = periodPosts.reduce((s, p) => s + (p.commentCount || 0), 0);
        const engagement = totalViews > 0 ? ((totalLikes + totalComments) / totalViews * 100).toFixed(1) : '0.0';

        setStats({
          revenue: periodEarnings,
          followers: followers.length,
          engagement,
          postsCreated: periodPosts.length,
          totalViews,
          totalLikes,
          totalComments,
        });

        setTopPosts(
          [...periodPosts].sort((a, b) => (b.likeCount || 0) - (a.likeCount || 0)).slice(0, 5)
        );
      } catch (err) { console.error(err); }
      setLoading(false);
    };
    load();
  }, [currentUser, period]);

  const formatNum = (n) => {
    if (!n) return '0';
    if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
    return n.toString();
  };

  const shell = (
    <>
      {/* Period selector */}
      <div className="flex gap-2 mb-4">
        {['7d', '30d', '90d'].map(p => (
          <button key={p} onClick={() => setPeriod(p)}
            className={`px-4 py-2 rounded-full text-xs font-semibold transition-all ${
              period === p ? 'bg-brand-violet text-white' : 'bg-surface-2 text-text-muted'
            }`}>
            {p === '7d' ? 'Last 7 days' : p === '30d' ? 'Last 30 days' : 'Last 90 days'}
          </button>
        ))}
      </div>

      {loading ? (
        <StackSkeleton rows={5} height={88} />
      ) : stats ? (
        <div>
          {/* Summary cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
            {[
              { label: 'Revenue', value: stats.revenue, icon: 'paid', color: 'text-brand-gold', bg: 'bg-brand-gold/10', prefix: '' },
              { label: 'Followers', value: formatNum(stats.followers), icon: 'group', color: 'text-brand-violet-light', bg: 'bg-brand-violet/10' },
              { label: 'Engagement', value: `${stats.engagement}%`, icon: 'trending_up', color: 'text-brand-pink', bg: 'bg-brand-pink/10' },
              { label: 'Posts Created', value: stats.postsCreated, icon: 'edit', color: 'text-brand-violet', bg: 'bg-brand-violet/10' },
            ].map(stat => (
              <div key={stat.label} className="p-4 rounded-2xl bg-surface-1 border border-white/[0.06]">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-[10px] text-text-muted uppercase tracking-wider">{stat.label}</p>
                  <div className={`w-7 h-7 rounded-lg ${stat.bg} flex items-center justify-center`}>
                    <Icon name={stat.icon} filled size={16} className={stat.color} />
                  </div>
                </div>
                <p className={`font-dmmono text-lg font-bold ${stat.color}`}>
                  {stat.prefix || ''}{typeof stat.value === 'number' ? formatNum(stat.value) : stat.value}
                </p>
              </div>
            ))}
          </div>

          {/* Engagement breakdown */}
          <h3 className="font-syne font-bold text-base mb-3">Engagement Breakdown</h3>
          <div className="p-4 rounded-2xl bg-surface-1 border border-white/[0.06] mb-6 space-y-3">
            {[
              { label: 'Views', value: stats.totalViews, icon: 'visibility', color: 'text-brand-violet' },
              { label: 'Likes', value: stats.totalLikes, icon: 'favorite', color: 'text-brand-ember' },
              { label: 'Comments', value: stats.totalComments, icon: 'chat_bubble', color: 'text-brand-violet-light' },
            ].map(item => (
              <div key={item.label} className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Icon name={item.icon} size={16} className={item.color} />
                  <span className="text-sm text-text-secondary">{item.label}</span>
                </div>
                <span className="font-dmmono font-bold text-sm">{formatNum(item.value)}</span>
              </div>
            ))}
          </div>

          {/* Top posts */}
          {topPosts.length > 0 && (
            <>
              <h3 className="font-syne font-bold text-base mb-3">Top Performing</h3>
              <div className="space-y-2">
                {topPosts.map((post, i) => (
                  <div key={post.id} className="flex items-center gap-3 p-3 rounded-xl bg-surface-1 border border-white/[0.06]">
                    <span className="font-dmmono text-text-muted text-sm w-6 text-center">#{i + 1}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm truncate">{post.content}</p>
                      <div className="flex gap-3 mt-1">
                        <span className="text-[10px] text-text-muted">❤️ {post.likeCount || 0}</span>
                        <span className="text-[10px] text-text-muted">💬 {post.commentCount || 0}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      ) : (
        <div className="text-center py-16">
          <p className="text-text-muted text-sm">No analytics data yet</p>
        </div>
      )}
    </>
  );

  if (embedded) return shell;

  return (
    <div className={isDesktop ? "min-h-screen pb-8" : "screen-container min-h-screen pb-8"}>
      <TopBar title="Analytics" showBack />
      <div className="px-4 py-3">{shell}</div>
    </div>
  );
}
