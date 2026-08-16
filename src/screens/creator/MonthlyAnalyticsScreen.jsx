import { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useUser } from '../../context/UserContext';
import { getUserPosts, getTransactions, getFollowers } from '../../firebase/firestore';
import CreatorLayout from '../../components/creator/CreatorLayout';
import CoinDisplay from '../../components/CoinDisplay';
import { AnalyticsSkeleton } from '../../components/creator/StudioSkeletons';
import Icon from '../../components/Icon';
import { TrendLineChart, DonutChart, ActivityHeatmap, PALETTE } from '../../components/creator/charts';
import '../../styles/surface.css';
import { useLayout } from '../../context/LayoutContext';
import useResponsive from '../../hooks/useResponsive';

/**
 * Panel surface, matched to Creator Studio home and Earnings.
 *
 * `.vg-material` + `.vg-grain` rather than a hairline border on `surface-1`:
 * the founder ruling is that an outline on every box reads as cheap, and the
 * fix is to separate surfaces by value and light instead of by stroke.
 * See the material surface system notes in CLAUDE.md.
 */
function Section({ title, sub, children, className = '' }) {
  return (
    <div className={`vg-material vg-grain rounded-2xl overflow-hidden mb-3 ${className}`}>
      <div className="relative z-[1] p-5">
        {title && <h3 className="font-syne font-bold text-sm text-text-primary">{title}</h3>}
        {sub && <p className="text-[11px] text-text-muted mt-0.5 mb-3">{sub}</p>}
        {!sub && title && <div className="mb-3" />}
        {children}
      </div>
    </div>
  );
}

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

        // Daily trend across the selected period.
        const dayKey = (ms) => new Date(ms).toISOString().slice(0, 10);
        const byDay = {};
        const days = Math.round(periodMs / 86400000);
        for (let d = days - 1; d >= 0; d--) {
          const k = dayKey(Date.now() - d * 86400000);
          byDay[k] = { name: k.slice(5), views: 0, likes: 0, comments: 0 };
        }
        // Per-format breakdown. Does not exist anywhere else in the studio,
        // and it is the question an analytics tab is opened to answer.
        const byFormat = {};
        // 7x24 posting heatmap: which slots actually earn engagement.
        const heat = Array.from({ length: 7 }, () => Array(24).fill(0));
        for (const post of periodPosts) {
          const t = post.createdAt?.toDate ? post.createdAt.toDate().getTime() : 0;
          if (!t) continue;
          const k = dayKey(t);
          const v = post.viewCount || 0, li = post.likeCount || 0, c = post.commentCount || 0;
          if (byDay[k]) { byDay[k].views += v; byDay[k].likes += li; byDay[k].comments += c; }
          const fmt = post.type || 'text';
          byFormat[fmt] = byFormat[fmt] || { posts: 0, views: 0, engagement: 0 };
          byFormat[fmt].posts++; byFormat[fmt].views += v; byFormat[fmt].engagement += li + c;
          const d = new Date(t);
          heat[(d.getDay() + 6) % 7][d.getHours()] += li + c;
        }

        const totalViews = periodPosts.reduce((s, p) => s + (p.viewCount || 0), 0);
        const totalLikes = periodPosts.reduce((s, p) => s + (p.likeCount || 0), 0);
        const totalComments = periodPosts.reduce((s, p) => s + (p.commentCount || 0), 0);
        const engagement = totalViews > 0 ? ((totalLikes + totalComments) / totalViews * 100).toFixed(1) : '0.0';

        setStats({
          revenue: periodEarnings,
          followers: followers.length,
          engagement,
          postsCreated: periodPosts.length,
          trend: Object.values(byDay),
          formats: Object.entries(byFormat)
            .map(([name, f]) => ({ name, ...f }))
            .sort((a, b) => b.engagement - a.engagement),
          // ActivityHeatmap wants 0-1, and its rows start on Monday.
          heatMax: Math.max(1, ...heat.flat()),
          heat,
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
        <AnalyticsSkeleton />
      ) : stats ? (
        <div>
          {/* Summary cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
            {[
              { label: 'Views', value: formatNum(stats.totalViews), icon: 'visibility', color: 'text-brand-gold', bg: 'bg-brand-gold/10' },
              { label: 'Followers', value: formatNum(stats.followers), icon: 'group', color: 'text-brand-violet-light', bg: 'bg-brand-violet/10' },
              { label: 'Engagement', value: `${stats.engagement}%`, icon: 'trending_up', color: 'text-brand-pink', bg: 'bg-brand-pink/10' },
              { label: 'Posts Created', value: stats.postsCreated, icon: 'edit', color: 'text-brand-violet', bg: 'bg-brand-violet/10' },
            ].map(stat => (
              <div key={stat.label} className="vg-material vg-grain rounded-2xl overflow-hidden">
                <div className="relative z-[1] p-4">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-[10px] text-text-muted uppercase tracking-wider">{stat.label}</p>
                    <div className={`w-7 h-7 rounded-lg ${stat.bg} flex items-center justify-center`}>
                      <Icon name={stat.icon} filled size={16} className={stat.color} />
                    </div>
                  </div>
                  <p className={`font-dmmono text-2xl font-bold tabular-nums ${stat.color}`}>
                    {stat.prefix || ''}{typeof stat.value === 'number' ? formatNum(stat.value) : stat.value}
                  </p>
                </div>
              </div>
            ))}
          </div>

          {/* FIXED 2026-08-14: everything from here to the heatmap used to be
              nested INSIDE the .map() above, between a tile's label and its
              icon. Each of the four KPI tiles was therefore rendering the whole
              lower half of the page inside itself, four times over, inside a
              flex row. That is what made this screen look broken. */}

          {/* Trend. The single question "is this working" needs a line, not a tile. */}
          <Section title="Views, likes and comments over time">
            <TrendLineChart
              data={stats.trend || []}
              series={[
                { key: 'views', label: 'Views', color: PALETTE.violet },
                { key: 'likes', label: 'Likes', color: PALETTE.pink },
                { key: 'comments', label: 'Comments', color: PALETTE.gold },
              ]}
            />
          </Section>

          {/* Per-format. Which KIND of thing you make is worth making more of. */}
          <div className="grid gap-3 lg:grid-cols-2 mb-3">
            <Section title="What format works" sub="Engagement by content type">
              {(stats.formats || []).length ? (
                <DonutChart
                  data={(stats.formats || []).map((f, n) => ({
                    name: f.name, value: f.engagement,
                    color: [PALETTE.violet, PALETTE.pink, PALETTE.gold, PALETTE.blue, PALETTE.emerald][n % 5],
                  }))}
                />
              ) : <p className="text-xs text-text-muted py-8 text-center">No posts in this period.</p>}
            </Section>
            <Section title="Per format" sub="Per post, so volume does not flatter a format">
              {(stats.formats || []).length ? (stats.formats || []).map((f) => (
                <div key={f.name} className="flex items-center justify-between py-2 border-b border-white/[0.04] last:border-0">
                  <span className="text-sm capitalize text-text-secondary">{f.name}</span>
                  <span className="text-xs text-text-muted font-dmmono tabular-nums">
                    {f.posts} posts · {Math.round(f.views / Math.max(1, f.posts))} views/post · {Math.round(f.engagement / Math.max(1, f.posts))} eng/post
                  </span>
                </div>
              )) : <p className="text-xs text-text-muted py-8 text-center">No posts in this period.</p>}
            </Section>
          </div>

          <Section title="When your posts land" sub="Engagement by the day and hour you published">
            <ActivityHeatmap values={(stats.heat || []).map((row) => row.map((v) => v / (stats.heatMax || 1)))} />
          </Section>

          {/* Engagement breakdown */}
          <Section title="Engagement breakdown">
          <div className="space-y-3">
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
          </Section>

          {/* Top posts */}
          {topPosts.length > 0 && (
            <>
              <Section title="Top performing">
              <div className="space-y-2">
                {topPosts.map((post, i) => (
                  <div key={post.id} className="flex items-center gap-3 p-3 rounded-xl" style={{ background: 'rgba(255,255,255,0.02)' }}>
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
              </Section>
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

  // `embedded` means the caller supplies the chrome. Only the native wrapper
  // (NativeCreatorAnalyticsScreen) does that now; the web route renders this
  // component bare and gets the Creator Studio layout below.
  if (embedded) return shell;

  // Moved out of AppRouter 2026-08-14. The layout, page title, subtitle and tier
  // gate used to be written inline on the route, which meant this page's chrome
  // was defined in a file nobody would look in, and it was the only Creator
  // Studio screen that worked that way.
  return (
    <CreatorLayout
      page="analytics"
      title="Analytics"
      subtitle="What is working, and when"
      requiredTier="lite"
      lockDescription="Growth, engagement, per-format breakdowns and your best posting times. Upgrade to Lite to unlock."
    >
      {shell}
    </CreatorLayout>
  );
}
