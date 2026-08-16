// src/screens/creator/CreatorDashboardScreen.jsx
// Creator Studio — Home page. Wrapped in <CreatorLayout>.
// Uses existing Firestore helpers (getUserPosts, getTransactions) — no schema changes.
import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { IS_NATIVE_BUILD } from '../../utils/platform';
import { useAuth } from '../../context/AuthContext';
import { StackSkeleton } from '../../components/skeletons/GlassSkeletons';
import { useUser } from '../../context/UserContext';
import { getUserPosts, getTransactions, getFollowers } from '../../firebase/firestore';
import CreatorLayout from '../../components/creator/CreatorLayout';
import { Card, KpiCard, SectionHeader, InsightCard, StatRow, PeriodPicker } from '../../components/creator/Widgets';
import { TrendLineChart, DonutChart, ActivityHeatmap, PALETTE, compactNum } from '../../components/creator/charts';
import Icon from '../../components/Icon';
import UserAvatar from '../../components/UserAvatar';
import { getVPLevel, getVPProgress, getNextVPLevel, RANK_TIERS } from '../../utils/vpSystem';

// ── helpers ─────────────────────────────────────────────────────────────
function tsMs(t) {
  if (!t) return 0;
  if (t.toDate) return t.toDate().getTime();
  if (t.seconds) return t.seconds * 1000;
  if (typeof t === 'number') return t;
  const d = new Date(t); return isNaN(d.getTime()) ? 0 : d.getTime();
}

function bucketDaily(items, getTime, getValue, days) {
  const now = Date.now();
  const dayMs = 86400000;
  const buckets = new Array(days).fill(0);
  for (const it of items) {
    const t = getTime(it);
    if (!t) continue;
    const ageDays = Math.floor((now - t) / dayMs);
    if (ageDays < 0 || ageDays >= days) continue;
    buckets[days - 1 - ageDays] += getValue(it);
  }
  return buckets;
}

function periodDays(period) {
  return period === '7d' ? 7 : period === '30d' ? 30 : period === '90d' ? 90 : period === '6m' ? 180 : 365;
}

export default function CreatorDashboardScreen() {
  const navigate = useNavigate();
  const { currentUser } = useAuth();
  const { profile, wallet } = useUser();
  const [period, setPeriod] = useState('30d');
  const [posts, setPosts] = useState([]);
  const [transactions, setTransactions] = useState([]);
  const [follows, setFollows] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!currentUser) return;
    let alive = true;
    (async () => {
      setLoading(true);
      try {
        const [p, tx, fl] = await Promise.all([
          getUserPosts(currentUser.uid, 50),
          getTransactions(currentUser.uid, 200),
          getFollowers(currentUser.uid).catch(() => []),
        ]);
        if (!alive) return;
        setPosts(p || []);
        setTransactions(tx || []);
        setFollows(fl || []);
      } catch (e) { console.error(e); }
      if (alive) setLoading(false);
    })();
    return () => { alive = false; };
  }, [currentUser]);

  // ── derived metrics ─────────────────────────────────────────────────
  const days = periodDays(period);
  const totals = useMemo(() => {
    const views = posts.reduce((s, p) => s + (p.viewCount || 0), 0);
    const likes = posts.reduce((s, p) => s + (p.likeCount || 0), 0);
    const comments = posts.reduce((s, p) => s + (p.commentCount || 0), 0);
    const engagement = views > 0 ? ((likes + comments) / views) * 100 : 0;
    return { views, likes, comments, engagement };
  }, [posts]);

  const earnedBuckets = useMemo(
    () => bucketDaily(
      transactions.filter(tx => (tx.amount || 0) > 0),
      tx => tsMs(tx.createdAt),
      tx => tx.amount || 0,
      days
    ),
    [transactions, days]
  );
  const viewsBuckets = useMemo(
    () => bucketDaily(posts, p => tsMs(p.createdAt), p => p.viewCount || 0, days),
    [posts, days]
  );
  const likesBuckets = useMemo(
    () => bucketDaily(posts, p => tsMs(p.createdAt), p => p.likeCount || 0, days),
    [posts, days]
  );
  const postsBuckets = useMemo(
    () => bucketDaily(posts, p => tsMs(p.createdAt), () => 1, days),
    [posts, days]
  );

  // Follower growth — real, from follow doc createdAt timestamps. Daily NET new
  // followers in-window, then turned into a cumulative line so the spark reflects
  // the actual follower count over time (flat at 0 for a brand-new/guest account
  // instead of a fabricated rise).
  const newFollowerBuckets = useMemo(
    () => bucketDaily(follows, f => tsMs(f.createdAt), () => 1, days),
    [follows, days]
  );
  const totalFollowers = profile?.followerCount ?? follows.length;
  const followersSpark = useMemo(() => {
    // back-fill a cumulative line ending at the true current follower count
    const newInWindow = newFollowerBuckets.reduce((a, b) => a + b, 0);
    let running = Math.max(0, totalFollowers - newInWindow);
    return newFollowerBuckets.map(n => (running += n));
  }, [newFollowerBuckets, totalFollowers]);
  const newFollowersThisPeriod = newFollowerBuckets.reduce((a, b) => a + b, 0);

  const earnedThisPeriod = earnedBuckets.reduce((a, b) => a + b, 0);
  const viewsThisPeriod  = viewsBuckets.reduce((a, b) => a + b, 0);
  const likesThisPeriod  = likesBuckets.reduce((a, b) => a + b, 0);
  const postsThisPeriod  = postsBuckets.reduce((a, b) => a + b, 0);

  // deltas = second half vs first half of window
  const delta = (buckets) => {
    const mid = Math.floor(buckets.length / 2);
    const first = buckets.slice(0, mid).reduce((a, b) => a + b, 0);
    const second = buckets.slice(mid).reduce((a, b) => a + b, 0);
    if (first === 0) return second > 0 ? 100 : 0;
    return Math.round(((second - first) / first) * 100);
  };

  // trend chart data
  const trendData = useMemo(() => {
    const labels = [];
    const out = [];
    const step = days <= 7 ? 1 : days <= 30 ? 2 : days <= 90 ? 7 : 14;
    for (let i = 0; i < days; i += step) {
      const end = Math.min(i + step, days);
      const lbl = days <= 7
        ? new Date(Date.now() - (days - 1 - i) * 86400000).toLocaleDateString(undefined, { weekday: 'short' })
        : new Date(Date.now() - (days - 1 - i) * 86400000).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
      let coins = 0, views = 0, likes = 0;
      for (let j = i; j < end; j++) { coins += earnedBuckets[j]; views += viewsBuckets[j]; likes += likesBuckets[j]; }
      labels.push(lbl);
      out.push({ label: lbl, Coins: coins, Views: views, Likes: likes });
    }
    return out;
  }, [earnedBuckets, viewsBuckets, likesBuckets, days]);

  // revenue sources (client-side classification from transaction types)
  // VERGR model: Tips, Memberships, Paid streams, Boosts received — no "gifts"
  const revenueSources = useMemo(() => {
    const buckets = { Tips: 0, Memberships: 0, 'Paid streams': 0, Boosts: 0, Other: 0 };
    for (const tx of transactions) {
      if (!(tx.amount > 0)) continue;
      const t = (tx.type || '').toLowerCase();
      if (t.includes('tip') || t.includes('gift')) buckets.Tips += tx.amount;
      else if (t.includes('member') || t.includes('sub')) buckets.Memberships += tx.amount;
      else if (t.includes('stream_unlock') || t.includes('paid_stream')) buckets['Paid streams'] += tx.amount;
      else if (t.includes('boost')) buckets.Boosts += tx.amount;
      else buckets.Other += tx.amount;
    }
    const colors = [PALETTE.cyan, PALETTE.violet, PALETTE.gold, PALETTE.emerald, PALETTE.blue];
    const entries = Object.entries(buckets).filter(([, v]) => v > 0);
    return entries.map(([name, value], i) => ({ name, value, color: colors[i % colors.length] }));
  }, [transactions]);

  // Engagement heatmap — 7 days × 24 hours.
  // Built ONLY from the creator's real post createdAt timestamps weighted by reach.
  // Returns null when there isn't enough real activity, so we show an honest empty
  // state instead of a fabricated pattern.
  const heatmap = useMemo(() => {
    const grid = Array.from({ length: 7 }, () => Array(24).fill(0));
    let hasData = false;
    for (const p of posts) {
      const t = tsMs(p.createdAt);
      if (!t) continue;
      const d = new Date(t);
      // Mon=0..Sun=6 (our heatmap order)
      const dow = (d.getDay() + 6) % 7;
      const hr = d.getHours();
      const weight = 1 + Math.log10(1 + (p.viewCount || 0) + (p.likeCount || 0));
      grid[dow][hr] += weight;
      hasData = true;
    }
    let max = 0;
    for (const row of grid) for (const v of row) if (v > max) max = v;
    if (!hasData || max === 0) return null;
    return grid.map(row => row.map(v => v / max));
  }, [posts]);

  const peakSlot = useMemo(() => {
    if (!heatmap) return null;
    const dayNames = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];
    let best = { d: 0, h: 0, v: -1 };
    for (let d = 0; d < 7; d++) for (let h = 0; h < 24; h++) {
      if (heatmap[d][h] > best.v) best = { d, h, v: heatmap[d][h] };
    }
    const fmt = (h) => `${((h + 11) % 12) + 1}${h < 12 ? 'am' : 'pm'}`;
    return { day: dayNames[best.d], range: `${fmt(best.h)}–${fmt((best.h + 1) % 24)}` };
  }, [heatmap]);

  const topPosts = useMemo(
    () => [...posts].sort((a, b) => (b.likeCount || 0) + (b.viewCount || 0) / 10 - ((a.likeCount || 0) + (a.viewCount || 0) / 10)).slice(0, 5),
    [posts]
  );

  // Routing helper: '#composer' opens the new CreateComposer popup (mounted in
  // CreatorLayout); anything else is a normal route.
  const go = (path) => {
    if (path === '#composer') { window.dispatchEvent(new CustomEvent('vergr:open-composer')); return; }
    navigate(path);
  };

  // quick actions — the surfaces a working creator reaches for most (benchmarked
  // against TikTok / Instagram / Patreon / YouTube Studio), all real routes.
  const quickActions = [
    { label: 'Go Live',      icon: 'podcasts',               path: '/go-live',            hue: 'from-rose-500/20 to-orange-500/10',     iconColor: 'text-rose-400' },
    { label: 'New Post',     icon: 'add_circle',             path: '#composer',           hue: 'from-brand-violet/20 to-brand-violet/5',    iconColor: 'text-brand-violet-light' },
    { label: 'Schedule',     icon: 'calendar_month',         path: '/creator/schedule',   hue: 'from-brand-violet/20 to-brand-violet/5', iconColor: 'text-brand-violet' },
    { label: 'Membership',   icon: 'workspace_premium',      path: '/creator/membership', hue: 'from-amber-500/20 to-yellow-500/5',     iconColor: 'text-amber-400' },
    { label: 'Promote',      icon: 'campaign',               path: '/creator/ads',        hue: 'from-fuchsia-500/20 to-pink-500/5',     iconColor: 'text-fuchsia-400' },
    { label: 'Quests',       icon: 'military_tech',          path: '/creator/quests',     hue: 'from-brand-pink/20 to-brand-pink/5',    iconColor: 'text-brand-pink' },
    { label: 'Earnings',     icon: 'paid',                   path: '/creator/earnings',   hue: 'from-emerald-500/20 to-emerald-500/5',  iconColor: 'text-emerald-400' },
    { label: 'Earnings',     icon: 'paid',                   path: '/creator/earnings',     hue: 'from-teal-500/20 to-cyan-500/5',        iconColor: 'text-teal-400' },
  ];

  // AI-style insight — picks a real, data-driven observation
  const insight = useMemo(() => {
    if (!posts.length) return { title: 'Get started', body: 'Create your first post to start earning coins and attracting followers. Consistency in the first 14 days is the biggest predictor of growth.', cta: 'Create Post', path: '#composer' };
    const engDelta = delta(likesBuckets);
    if (engDelta > 20) return { title: 'You\'re on fire', body: `Engagement is up ${engDelta}% vs the first half of this period. Keep your current posting rhythm — your audience is warming up.`, cta: 'View Analytics', path: '/creator/analytics' };
    if (postsThisPeriod < days / 7) return { title: 'Post more often', body: `Creators who post at least once a week grow 3× faster. You've posted ${postsThisPeriod} time${postsThisPeriod===1?'':'s'} in the last ${days} days.`, cta: 'Create Post', path: '#composer' };
    if (earnedThisPeriod === 0 && (wallet?.totalEarned || 0) === 0) return { title: 'Unlock tips', body: 'Add a membership tier so your biggest fans can support you monthly. Verified creators earn 4× more on average.', cta: 'Manage Tiers', path: '/creator/membership' };
    return { title: 'Keep the momentum', body: `Your ${totals.engagement.toFixed(1)}% engagement rate is solid. Try going live this week — live viewers tip 6× more than post viewers.`, cta: 'Go Live', path: '/go-live' };
  }, [posts, likesBuckets, postsThisPeriod, days, earnedThisPeriod, wallet, totals]);

  // ── creator rank progression (real VP) ───────────────────────────────
  // VP canonical store is wallet.vp (awardVP + tournament/ad/service VP all write
  // there); fall back to profile.vp only if the wallet hasn't loaded yet.
  const rank = useMemo(() => {
    const vp = wallet?.vp ?? profile?.vp ?? 0;
    const lvl = getVPLevel(vp);
    const next = getNextVPLevel(vp);
    const pct = getVPProgress(vp);
    const tier = RANK_TIERS.find(t => lvl.level >= t.min && lvl.level <= t.max) || RANK_TIERS[0];
    const toNext = next ? Math.max(0, next.vpRequired - vp) : 0;
    // Rank badge art exists for the 10 named tiers; Immortal has none → no badge.
    const badge = tier.name === 'Immortal' ? null : `/brand/firstboot/rank-${tier.name.toLowerCase()}.webp`;
    return { vp, level: lvl.level, name: tier.name, color: tier.ringColor, pct, toNext, maxed: !next, badge };
  }, [wallet, profile]);

  // ── render ──────────────────────────────────────────────────────────
  return (
    <CreatorLayout page="home" subtitle="Everything you need to grow — in one studio">
      {/* Creator rank progression banner */}
      <div className="relative overflow-hidden rounded-2xl border border-white/[0.07] bg-gradient-to-br from-[#12131d] to-[#0a0d14] p-4 md:p-5 mb-5">
        <div className="absolute -top-12 -right-8 w-40 h-40 rounded-full blur-3xl pointer-events-none opacity-25"
          style={{ background: rank.color }} />
        <div className="relative flex items-center gap-4">
          <div className="flex items-center gap-2 shrink-0">
            <div className="relative">
              <UserAvatar src={profile?.avatar} size={52} />
              <span className="absolute -bottom-1 -right-1 px-1.5 py-0.5 rounded-md font-dmmono font-bold text-[10px] text-bg-dark shadow-sm"
                style={{ backgroundColor: rank.color }}>L{rank.level}</span>
            </div>
            {rank.badge && (
              <img src={rank.badge} alt={rank.name}
                className="w-12 h-12 md:w-14 md:h-14 object-contain drop-shadow-[0_2px_8px_rgba(0,0,0,0.4)]"
                onError={(e) => { e.currentTarget.style.display = 'none'; }} />
            )}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-syne font-extrabold text-white text-base md:text-lg leading-none">{rank.name}</span>
              <span className="font-dmmono font-bold text-xs tabular-nums" style={{ color: rank.color }}>{compactNum(rank.vp)} VP</span>
            </div>
            <div className="mt-2 h-2 rounded-full bg-white/[0.06] overflow-hidden max-w-md">
              <div className="h-full rounded-full transition-[width] duration-700"
                style={{ width: `${rank.pct}%`, background: `linear-gradient(90deg, ${rank.color}, #ffffff66)` }} />
            </div>
            <p className="text-[11px] text-text-muted mt-1.5">
              {rank.maxed
                ? 'Max rank reached — Immortal.'
                : <>{compactNum(rank.toNext)} VP to level {rank.level + 1}. Earn VP by completing <button onClick={() => navigate('/creator/quests')} className="text-brand-violet font-semibold hover:underline">quests</button>.</>}
            </p>
          </div>
          <button onClick={() => navigate('/creator/quests')}
            className="hidden sm:flex items-center gap-1.5 px-3.5 h-9 rounded-xl bg-white/[0.05] hover:bg-white/[0.1] text-white font-bold text-xs transition-all shrink-0">
            <Icon name="military_tech" size={15} className="text-brand-violet" /> Quests
          </button>
        </div>
      </div>

      {/* Period picker strip */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
        <div className="min-w-0">
          <h2 className="font-syne font-extrabold text-white text-lg">Your performance</h2>
          <p className="text-text-muted text-xs">Metrics update in real-time as fans interact with you.</p>
        </div>
        <PeriodPicker value={period} onChange={setPeriod} />
      </div>

      {loading ? (
        <StackSkeleton rows={5} height={88} />
      ) : (
        <>
          {/* ── KPI row ── */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4 mb-6">
            <KpiCard
              label="Coins earned"
              value={earnedThisPeriod}
              icon="paid"
              iconColor="text-amber-400"
              spark={earnedBuckets}
              sparkColor={PALETTE.gold}
              delta={delta(earnedBuckets)}
              deltaLabel="vs prev"
              tooltip="Tips + memberships + gifts + prizes"
            />
            <KpiCard
              label="Followers"
              value={totalFollowers}
              icon="group"
              iconColor="text-brand-violet-light"
              spark={followersSpark}
              sparkColor={PALETTE.cyan}
              delta={newFollowersThisPeriod}
              deltaLabel="new this period"
            />
            <KpiCard
              label="Views"
              value={viewsThisPeriod}
              icon="visibility"
              iconColor="text-brand-violet"
              spark={viewsBuckets}
              sparkColor={PALETTE.violet}
              delta={delta(viewsBuckets)}
              deltaLabel="vs prev"
            />
            <KpiCard
              label="Engagement"
              value={`${totals.engagement.toFixed(1)}%`}
              icon="trending_up"
              iconColor="text-brand-pink"
              spark={likesBuckets}
              sparkColor={PALETTE.pink}
              delta={delta(likesBuckets)}
              deltaLabel="likes+comments"
              tooltip="(likes + comments) ÷ views"
            />
          </div>

          {/* ── Quick actions ── */}
          <Card className="p-4 md:p-5 mb-6">
            <div className="flex items-center justify-between mb-3">
              <div>
                <h3 className="font-syne font-extrabold text-white text-sm md:text-base">Quick actions</h3>
                <p className="text-[11px] text-text-muted">Everything a creator needs, one tap away.</p>
              </div>
            </div>
            <div className={`grid gap-2 md:gap-3 ${IS_NATIVE_BUILD ? 'grid-cols-4' : 'grid-cols-4 md:grid-cols-8'}`}>
              {quickActions.map(a => (
                <button key={a.label} onClick={() => go(a.path)}
                  className={`group relative overflow-hidden rounded-xl p-3 md:p-4 bg-gradient-to-br ${a.hue} border border-white/[0.06] hover:border-white/[0.14] transition-all hover:-translate-y-0.5`}>
                  <Icon name={a.icon} size={22} filled className={`${a.iconColor} mb-2 transition-transform group-hover:scale-110`} />
                  <div className="text-[11px] md:text-sm font-bold text-white text-left leading-tight">{a.label}</div>
                </button>
              ))}
            </div>
          </Card>

          {/* ── Main trend chart ── */}
          <div className="grid grid-cols-1 xl:grid-cols-3 gap-5 mb-6">
            <Card className="p-4 md:p-5 xl:col-span-2">
              <SectionHeader
                title="Growth over time"
                subtitle="Coins, views, and likes trend"
                right={
                  <div className="hidden md:flex items-center gap-3 text-[11px]">
                    <span className="flex items-center gap-1.5 text-text-secondary"><span className="w-2 h-2 rounded-full bg-amber-400" /> Coins</span>
                    <span className="flex items-center gap-1.5 text-text-secondary"><span className="w-2 h-2 rounded-full bg-brand-violet" /> Views</span>
                    <span className="flex items-center gap-1.5 text-text-secondary"><span className="w-2 h-2 rounded-full bg-brand-pink" /> Likes</span>
                  </div>
                }
              />
              <TrendLineChart
                data={trendData}
                series={[
                  { key: 'Coins', label: 'Coins', color: PALETTE.gold },
                  { key: 'Views', label: 'Views', color: PALETTE.violet },
                  { key: 'Likes', label: 'Likes', color: PALETTE.pink },
                ]}
                height={280}
              />
            </Card>

            {/* Revenue source donut */}
            <Card className="p-4 md:p-5">
              <SectionHeader
                title="Where your coins came from"
                subtitle={`${compactNum(earnedThisPeriod)} earned this period`}
              />
              {revenueSources.length === 0 ? (
                <div className="h-[260px] flex flex-col items-center justify-center text-center">
                  <Icon name="savings" size={28} className="text-text-muted mb-2" />
                  <p className="text-text-muted text-xs">Start earning to see a breakdown of tips, memberships, and gifts.</p>
                </div>
              ) : (
                <>
                  <DonutChart
                    data={revenueSources}
                    height={200}
                    centerValue={compactNum(earnedThisPeriod)}
                    centerLabel="Coins"
                  />
                  <div className="mt-3 space-y-1">
                    {revenueSources.map(s => (
                      <div key={s.name} className="flex items-center gap-2 text-xs">
                        <span className="w-2 h-2 rounded-sm" style={{ backgroundColor: s.color }} />
                        <span className="flex-1 text-text-secondary">{s.name}</span>
                        <span className="font-dmmono font-bold text-white">{compactNum(s.value)}</span>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </Card>
          </div>

          {/* ── AI insight ── */}
          <div className="mb-6">
            <InsightCard
              title="AI coach"
              body={insight.body}
              cta={insight.cta}
              onCta={() => go(insight.path)}
              icon="auto_awesome"
              tone="violet"
            />
          </div>

          {/* ── Engagement heatmap ── */}
          <Card className="p-4 md:p-5 mb-6">
            <SectionHeader
              title="Engagement heatmap"
              subtitle="When your audience is most active"
              right={
                peakSlot && (
                  <div className="hidden md:flex items-center gap-2 px-2.5 py-1 rounded-full bg-brand-violet/10 border border-brand-violet/20">
                    <Icon name="bolt" size={13} className="text-brand-violet" />
                    <span className="text-[11px] font-dmmono uppercase tracking-[0.12em] text-brand-violet">Peak</span>
                    <span className="text-[11px] text-text-primary font-semibold">{peakSlot.day}, {peakSlot.range}</span>
                  </div>
                )
              }
            />
            {heatmap ? (
              <>
                <ActivityHeatmap values={heatmap} />
                <p className="mt-3 text-[11px] text-text-muted">
                  Your posts land most on <span className="text-text-primary font-semibold">{peakSlot.day}</span> around <span className="text-text-primary font-semibold">{peakSlot.range}</span>. Posting consistently around your audience's active hours boosts reach.
                </p>
              </>
            ) : (
              <div className="h-[180px] flex flex-col items-center justify-center text-center">
                <Icon name="schedule" size={28} className="text-text-muted mb-2" />
                <p className="text-text-muted text-xs max-w-xs">Not enough activity yet. Once you post and your audience engages, we'll show you the best times to post here.</p>
              </div>
            )}
          </Card>

          {/* ── Top posts + wallet ── */}
          <div className="grid grid-cols-1 xl:grid-cols-3 gap-5 mb-6">
            <Card className="p-4 md:p-5 xl:col-span-2">
              <SectionHeader
                title="Top performing posts"
                subtitle="Ranked by engagement"
                right={<button onClick={() => navigate('/creator/content')} className="text-xs font-bold text-brand-violet-light hover:underline">View all</button>}
              />
              {topPosts.length === 0 ? (
                <div className="py-10 text-center">
                  <Icon name="photo_library" size={28} className="text-text-muted mb-2" />
                  <p className="text-text-muted text-sm mb-3">No posts yet — create your first to see stats here.</p>
                  <button onClick={() => go('#composer')}
                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-brand-violet text-white font-bold text-sm">
                    <Icon name="add" size={16} /> New post
                  </button>
                </div>
              ) : (
                <div className="space-y-2">
                  {topPosts.map((p, i) => (
                    <button key={p.id} onClick={() => navigate(`/post/${p.id}`)}
                      className="w-full flex items-center gap-3 p-3 rounded-xl bg-white/[0.02] hover:bg-white/[0.04] border border-white/[0.04] hover:border-white/[0.1] text-left transition-all">
                      <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-brand-violet/20 to-brand-violet/10 flex items-center justify-center shrink-0">
                        <span className="font-syne font-extrabold text-xs text-white">{i + 1}</span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-text-primary truncate">{p.content || p.title || 'Untitled'}</p>
                        <div className="flex items-center gap-3 mt-1 text-[11px] text-text-muted">
                          <span className="flex items-center gap-1"><Icon name="visibility" size={12} /> {compactNum(p.viewCount || 0)}</span>
                          <span className="flex items-center gap-1"><Icon name="favorite" size={12} /> {compactNum(p.likeCount || 0)}</span>
                          <span className="flex items-center gap-1"><Icon name="chat_bubble" size={12} /> {compactNum(p.commentCount || 0)}</span>
                        </div>
                      </div>
                      <Icon name="chevron_right" size={16} className="text-text-muted" />
                    </button>
                  ))}
                </div>
              )}
            </Card>

            {/* Wallet widget */}
            <Card className="p-4 md:p-5">
              <SectionHeader title="Your coins" subtitle="Spend on Vergr" />
              <div className="rounded-xl bg-gradient-to-br from-amber-500/15 via-amber-500/5 to-transparent border border-amber-500/20 p-4 mb-3">
                <p className="text-[10px] uppercase tracking-widest text-amber-400 font-bold mb-1">Balance</p>
                <p className="font-syne font-extrabold text-3xl text-white tabular-nums">{compactNum(wallet?.balance || 0)}</p>
                <p className="text-[11px] text-text-muted mt-1">≈ ${((wallet?.balance || 0) * 0.01).toFixed(2)} USD value</p>
              </div>
              <StatRow label="Coins spent" value={compactNum(wallet?.totalSpent || 0)} accent="text-amber-400" />
              <StatRow label="This period" value={compactNum(earnedThisPeriod)} accent="text-white" />
              <div className="flex gap-2 mt-3">
                <button onClick={() => navigate('/wallet/buy')} className="flex-1 h-10 rounded-xl bg-amber-500 text-bg-dark font-bold text-xs hover:brightness-110 transition-all">
                  Buy coins
                </button>
                <button onClick={() => navigate('/wallet')} className="h-10 px-3 rounded-xl bg-white/[0.05] hover:bg-white/[0.1] text-text-primary font-bold text-xs transition-all">
                  Wallet
                </button>
              </div>
            </Card>
          </div>

          {/* ── Creator quests teaser ── */}
          <Card className="p-4 md:p-5 mb-2">
            <div className="flex items-start gap-4">
              <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-brand-violet to-brand-pink flex items-center justify-center shrink-0">
                <Icon name="military_tech" size={24} filled className="text-white" />
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="font-syne font-extrabold text-white text-base">Creator quests</h3>
                <p className="text-xs text-text-muted mt-0.5">Complete challenges to earn <span className="text-brand-violet font-bold">VP</span> and level up your creator rank.</p>
              </div>
              <button onClick={() => navigate('/creator/quests')}
                className="px-4 h-10 rounded-xl bg-white/[0.05] hover:bg-white/[0.1] text-white font-bold text-xs flex items-center gap-1.5 transition-all">
                View quests <Icon name="arrow_forward" size={14} />
              </button>
            </div>
          </Card>
        </>
      )}
    </CreatorLayout>
  );
}
