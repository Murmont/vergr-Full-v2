// src/screens/creator/CreatorAudienceScreen.jsx
// Creator Studio — Audience. Follower growth, fan segments, demographics, top supporters.
import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useUser } from '../../context/UserContext';
import { PanelListSkeleton } from '../../components/creator/StudioSkeletons';
import { getFollowers, getTransactions } from '../../firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../../firebase/config';
import CreatorLayout from '../../components/creator/CreatorLayout';
import { Card, KpiCard, SectionHeader, PeriodPicker } from '../../components/creator/Widgets';
import { TrendLineChart, DonutChart, HorizontalBarChart, PALETTE, compactNum } from '../../components/creator/charts';
import Icon from '../../components/Icon';
import UserAvatar from '../../components/UserAvatar';

function tsMs(t) {
  if (!t) return 0;
  if (t.toDate) return t.toDate().getTime();
  if (t.seconds) return t.seconds * 1000;
  return new Date(t).getTime() || 0;
}

export default function CreatorAudienceScreen() {
  const navigate = useNavigate();
  const { currentUser } = useAuth();
  const { profile } = useUser();
  const [period, setPeriod] = useState('30d');
  const [followers, setFollowers] = useState([]);
  const [transactions, setTransactions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [audience, setAudience] = useState(null);
  const [audienceLoading, setAudienceLoading] = useState(true);

  useEffect(() => {
    if (!currentUser) return;
    let alive = true;
    (async () => {
      setLoading(true);
      try {
        const [fo, tx] = await Promise.all([
          getFollowers(currentUser.uid).catch(() => []),
          getTransactions(currentUser.uid, 500).catch(() => []),
        ]);
        if (alive) {
          setFollowers(fo || []);
          setTransactions(tx || []);
        }
      } catch (e) { console.error(e); }
      if (alive) setLoading(false);
    })();
    return () => { alive = false; };
  }, [currentUser]);

  // Aggregate audience demographics (consent-gated, 1h server cache)
  useEffect(() => {
    if (!currentUser) return;
    let alive = true;
    (async () => {
      setAudienceLoading(true);
      try {
        const call = httpsCallable(functions, 'aggregateCreatorAudience');
        const res = await call({ creatorId: currentUser.uid });
        if (alive) setAudience(res?.data || null);
      } catch (e) {
        console.warn('aggregateCreatorAudience failed:', e?.message);
        if (alive) setAudience(null);
      }
      if (alive) setAudienceLoading(false);
    })();
    return () => { alive = false; };
  }, [currentUser]);

  const days = period === '7d' ? 7 : period === '30d' ? 30 : period === '90d' ? 90 : period === '6m' ? 180 : 365;
  const now = Date.now();

  // Follower growth trend — derive from follow timestamps when available, else smooth ramp
  const growth = useMemo(() => {
    const step = days <= 7 ? 1 : days <= 30 ? 2 : days <= 90 ? 7 : 14;
    const chunks = Math.ceil(days / step);
    const tsList = followers.map(f => tsMs(f.createdAt || f.followedAt)).filter(Boolean).sort((a, b) => a - b);
    const total = profile?.followersCount ?? followers.length;
    const out = [];
    for (let i = 0; i < chunks; i++) {
      const end = now - (days - (i + 1) * step) * 86400000;
      const start = now - (days - i * step) * 86400000;
      const gained = tsList.filter(t => t >= start && t < end).length;
      const runningTo = total - tsList.filter(t => t >= end).length;
      const lbl = days <= 7
        ? new Date(start).toLocaleDateString(undefined, { weekday: 'short' })
        : new Date(start).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
      out.push({ label: lbl, Followers: Math.max(0, runningTo), Gained: gained });
    }
    return out;
  }, [followers, days, now, profile]);

  // Supporters (paying fans) from transactions
  const payingFans = useMemo(() => {
    const map = {};
    transactions.filter(t => (t.amount || 0) > 0).forEach(t => {
      const key = t.fromUserId || t.fromUsername;
      if (!key) return;
      if (!map[key]) map[key] = {
        key, name: t.fromUsername || t.fromUserDisplayName || 'fan',
        avatar: t.fromAvatar, total: 0, count: 0, last: 0,
      };
      map[key].total += t.amount || 0;
      map[key].count += 1;
      map[key].last = Math.max(map[key].last, tsMs(t.createdAt));
    });
    return Object.values(map).sort((a, b) => b.total - a.total);
  }, [transactions]);

  const totalFollowers = profile?.followersCount ?? followers.length;
  const payingCount    = payingFans.length;
  const gainedInPeriod = growth.reduce((s, g) => s + g.Gained, 0);
  const avgTipPerFan   = payingCount ? Math.round(payingFans.reduce((s, f) => s + f.total, 0) / payingCount) : 0;

  // Demographics — from aggregateCreatorAudience (consent-gated aggregates).
  // Returns null until enough consented followers exist.
  const { gender, ageBuckets, topCountries, topGames, topTags, activeHours, consentedFollowers, consentWithheld, affinityContributors } = useMemo(() => {
    if (!audience) {
      return { gender: [], ageBuckets: [], topCountries: [], topGames: [], topTags: [], activeHours: [], consentedFollowers: 0, consentWithheld: 0, affinityContributors: 0 };
    }
    const g = audience.genderCounts || {};
    const gTotal = (g.male || 0) + (g.female || 0) + (g.nyb || 0) + (g.unknown || 0);
    const pct = (n) => gTotal ? Math.round((n / gTotal) * 100) : 0;
    const genderArr = [
      { name: 'Male',    value: pct(g.male || 0),    color: PALETTE.blue },
      { name: 'Female',  value: pct(g.female || 0),  color: PALETTE.pink },
      { name: 'Private', value: pct(g.nyb || 0),     color: PALETTE.violet },
      { name: 'Unknown', value: pct(g.unknown || 0), color: PALETTE.cyan },
    ].filter(x => x.value > 0);

    const ab = audience.ageBuckets || {};
    const aTotal = Object.values(ab).reduce((s, n) => s + (n || 0), 0);
    const apct = (n) => aTotal ? Math.round((n / aTotal) * 100) : 0;
    const ageArr = [
      { name: '13–17', value: apct(ab['13-17'] || 0) },
      { name: '18–24', value: apct(ab['18-24'] || 0) },
      { name: '25–34', value: apct(ab['25-34'] || 0) },
      { name: '35–44', value: apct(ab['35-44'] || 0) },
      { name: '45+',   value: apct(ab['45+']   || 0) },
    ];

    return {
      gender: genderArr,
      ageBuckets: ageArr,
      topCountries: audience.topCountries || [],
      topGames: audience.topGames || [],
      topTags: audience.topTags || [],
      activeHours: audience.activeHours || [],
      affinityContributors: audience.affinityContributors || 0,
      consentedFollowers: audience.consentedFollowers || 0,
      consentWithheld:    audience.consentWithheld    || 0,
    };
  }, [audience]);

  const hasAudienceData = consentedFollowers > 0;

  return (
    <CreatorLayout page="audience" title="Audience" subtitle="Understand your followers and superfans" requiredTier="lite" lockDescription="Deep demographics, top supporters and growth trends. Upgrade to Lite for audience insights.">
      <div className="flex items-center justify-end mb-5">
        <PeriodPicker value={period} onChange={setPeriod} />
      </div>

      {loading ? (
        <PanelListSkeleton count={4} />
      ) : (
        <>
          {/* KPIs */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4 mb-6">
            <KpiCard label="Followers" value={totalFollowers} icon="groups" iconColor="text-brand-violet-light"
              spark={growth.map(g => g.Followers)} sparkColor={PALETTE.cyan}
              delta={gainedInPeriod} deltaLabel={`new in ${period}`} />
            <KpiCard label="Paying fans" value={payingCount} icon="workspace_premium" iconColor="text-brand-violet"
              delta={totalFollowers ? Math.round((payingCount / totalFollowers) * 100) : 0}
              deltaLabel="% of followers" />
            <KpiCard label="Avg / paying fan" value={avgTipPerFan} unit="c" icon="payments" iconColor="text-amber-400" />
            <KpiCard label="New followers" value={gainedInPeriod} icon="person_add" iconColor="text-emerald-400"
              spark={growth.map(g => g.Gained)} sparkColor={PALETTE.emerald} />
          </div>

          {/* Follower growth + Gender */}
          <div className="grid grid-cols-1 xl:grid-cols-3 gap-5 mb-6">
            <Card className="p-4 md:p-5 xl:col-span-2">
              <SectionHeader title="Follower growth" subtitle={`Last ${days} days`} />
              <TrendLineChart
                data={growth}
                series={[
                  { key: 'Followers', label: 'Total', color: PALETTE.cyan },
                  { key: 'Gained',    label: 'New',   color: PALETTE.emerald },
                ]}
                height={280}
              />
            </Card>

            <Card className="p-4 md:p-5">
              <SectionHeader title="Gender split" subtitle={hasAudienceData ? `${consentedFollowers} consented` : 'Not enough data'} />
              {audienceLoading ? (
                <div className="h-[220px] flex items-center justify-center">
                  <div className="w-6 h-6 rounded-full border-2 border-white/10 border-t-brand-violet animate-spin" />
                </div>
              ) : hasAudienceData && gender.length ? (
                <>
                  <DonutChart data={gender} height={220} centerValue={`${consentedFollowers}`} centerLabel="Consented" />
                  <div className="mt-3 space-y-1">
                    {gender.map(g => (
                      <div key={g.name} className="flex items-center gap-2 text-xs">
                        <span className="w-2 h-2 rounded-sm" style={{ backgroundColor: g.color }} />
                        <span className="flex-1 text-text-secondary">{g.name}</span>
                        <span className="font-dmmono font-bold text-white tabular-nums">{g.value}%</span>
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <div className="h-[220px] flex flex-col items-center justify-center text-center px-3">
                  <Icon name="insights" size={28} className="text-text-muted mb-2" />
                  <p className="text-xs text-text-muted">Demographics appear once followers opt in to share aggregate data.</p>
                </div>
              )}
            </Card>
          </div>

          {/* Age + Countries */}
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-5 mb-6">
            <Card className="p-4 md:p-5">
              <SectionHeader title="Age distribution" subtitle="Percent of consented audience" />
              {hasAudienceData ? (
                <HorizontalBarChart data={ageBuckets} dataKey="value" color={PALETTE.violet} height={240} />
              ) : (
                <div className="h-[240px] flex flex-col items-center justify-center text-center px-3">
                  <Icon name="cake" size={28} className="text-text-muted mb-2" />
                  <p className="text-xs text-text-muted">No opted-in followers yet.</p>
                </div>
              )}
            </Card>
            <Card className="p-4 md:p-5">
              <SectionHeader title="Top countries" />
              {hasAudienceData && topCountries.length ? (
                <HorizontalBarChart data={topCountries} dataKey="value" color={PALETTE.cyan} height={240} />
              ) : (
                <div className="h-[240px] flex flex-col items-center justify-center text-center px-3">
                  <Icon name="public" size={28} className="text-text-muted mb-2" />
                  <p className="text-xs text-text-muted">Country data needs follower consent.</p>
                </div>
              )}
            </Card>
          </div>
          {consentWithheld > 0 && (
            <p className="text-[11px] text-text-muted mb-4 font-dmmono tabular-nums">
              {consentWithheld} follower{consentWithheld === 1 ? '' : 's'} opted out of audience sharing — excluded from the charts above.
            </p>
          )}

          {/* Top games + Top tags (affinity-based) */}
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-5 mb-6">
            <Card className="p-4 md:p-5">
              <SectionHeader title="Top games" subtitle="What your audience engages with most" />
              {topGames.length ? (
                <HorizontalBarChart data={topGames.slice(0, 8)} dataKey="value" color={PALETTE.emerald} height={240} />
              ) : (
                <div className="h-[240px] flex flex-col items-center justify-center text-center px-3">
                  <Icon name="sports_esports" size={28} className="text-text-muted mb-2" />
                  <p className="text-xs text-text-muted">Game affinity builds up as followers engage with the app.</p>
                </div>
              )}
            </Card>
            <Card className="p-4 md:p-5">
              <SectionHeader title="Top tags & topics" subtitle="Most-engaged tags across your audience" />
              {topTags.length ? (
                <div className="flex flex-wrap gap-2 py-2">
                  {topTags.slice(0, 15).map(t => (
                    <span key={t.name} className="px-3 py-1.5 rounded-full bg-white/[0.04] border border-white/[0.06] text-xs">
                      <span className="text-text-primary font-semibold">#{t.name}</span>
                      <span className="ml-2 text-text-muted font-dmmono tabular-nums">{t.value}</span>
                    </span>
                  ))}
                </div>
              ) : (
                <div className="h-[240px] flex flex-col items-center justify-center text-center px-3">
                  <Icon name="tag" size={28} className="text-text-muted mb-2" />
                  <p className="text-xs text-text-muted">Tag affinity appears once followers engage with your content.</p>
                </div>
              )}
            </Card>
          </div>

          {/* Active hours heatmap */}
          <Card className="p-4 md:p-5 mb-6">
            <SectionHeader title="When your audience is active" subtitle="UTC hours · bigger = more engagement" />
            {activeHours.some(v => v > 0) ? (
              <div className="grid grid-cols-12 md:grid-cols-24 gap-1 py-3">
                {activeHours.map((v, h) => {
                  const max = Math.max(...activeHours) || 1;
                  const intensity = v / max;
                  return (
                    <div key={h} className="flex flex-col items-center gap-1">
                      <div
                        className="w-full rounded-sm"
                        style={{
                          height: 42,
                          backgroundColor: `rgba(180,79,255, ${0.08 + intensity * 0.75})`,
                        }}
                        title={`${h}:00 — ${v}`}
                      />
                      <span className="text-[9px] text-text-muted font-dmmono tabular-nums">{h}</span>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="py-8 text-center text-xs text-text-muted">No engagement data yet for your audience.</div>
            )}
            {affinityContributors > 0 && (
              <p className="text-[11px] text-text-muted mt-2 font-dmmono tabular-nums">
                Based on {affinityContributors} consented follower{affinityContributors === 1 ? '' : 's'}.
              </p>
            )}
          </Card>

          {/* Top supporters */}
          <Card className="p-4 md:p-5">
            <SectionHeader title="Your top supporters"
              subtitle="Fans who tip, sub, or buy memberships"
              right={<button onClick={() => navigate('/creator/earnings')} className="text-xs font-bold text-brand-violet-light hover:underline">View all</button>}
            />
            {payingFans.length === 0 ? (
              <div className="py-10 text-center text-text-muted text-sm">No paying fans yet — share your profile to get your first tip.</div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {payingFans.slice(0, 9).map((f, i) => (
                  <div key={f.key} className="flex items-center gap-3 p-3 rounded-xl bg-white/[0.02] border border-white/[0.04] hover:border-white/[0.1] transition-colors">
                    <div className="relative">
                      <UserAvatar src={f.avatar} size={40} />
                      {i < 3 && (
                        <span className={`absolute -top-1 -right-1 w-5 h-5 rounded-full border-2 border-bg-dark flex items-center justify-center text-[9px] font-extrabold ${
                          i === 0 ? 'bg-amber-400 text-bg-dark' : i === 1 ? 'bg-slate-300 text-bg-dark' : 'bg-orange-400 text-bg-dark'
                        }`}>{i + 1}</span>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-bold text-white truncate">{f.name}</p>
                      <p className="text-[11px] text-text-muted font-dmmono tabular-nums">{f.count} gift{f.count === 1 ? '' : 's'}</p>
                    </div>
                    <p className="font-dmmono font-bold text-amber-400 tabular-nums text-sm">{compactNum(f.total)}c</p>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </>
      )}
    </CreatorLayout>
  );
}
