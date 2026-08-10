// src/screens/creator/CreatorEarningsScreen.jsx
// Creator Studio — Earnings page. Deep revenue breakdown + payouts.
import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useUser } from '../../context/UserContext';
import { StackSkeleton } from '../../components/skeletons/GlassSkeletons';
import { getTransactions } from '../../firebase/firestore';
import CreatorLayout from '../../components/creator/CreatorLayout';
import { Card, KpiCard, SectionHeader, PeriodPicker, StatRow } from '../../components/creator/Widgets';
import { StackedAreaChart, DonutChart, HorizontalBarChart, PALETTE, compactNum } from '../../components/creator/charts';
import Icon from '../../components/Icon';
import { CoinIcon } from '../../components/CoinIcon';
import UserAvatar from '../../components/UserAvatar';

function tsMs(t) {
  if (!t) return 0;
  if (t.toDate) return t.toDate().getTime();
  if (t.seconds) return t.seconds * 1000;
  return new Date(t).getTime() || 0;
}

const SOURCE_DEFS = [
  { key: 'Tips',        match: ['tip', 'gift'],         color: PALETTE.cyan },
  { key: 'Memberships', match: ['member', 'sub'],       color: PALETTE.violet },
  { key: 'Paid access', match: ['stream_unlock', 'paid_stream', 'ticket', 'season_pass'], color: PALETTE.gold },
  { key: 'Boosts',      match: ['boost'],               color: PALETTE.emerald },
  { key: 'Other',       match: [],                      color: PALETTE.blue },
];

function classify(tx) {
  const t = (tx.type || '').toLowerCase();
  for (const s of SOURCE_DEFS) {
    if (s.match.some(m => t.includes(m))) return s.key;
  }
  return 'Other';
}

export default function CreatorEarningsScreen() {
  const navigate = useNavigate();
  const { currentUser } = useAuth();
  const { wallet } = useUser();
  const [period, setPeriod] = useState('30d');
  const [transactions, setTransactions] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!currentUser) return;
    let alive = true;
    (async () => {
      setLoading(true);
      try {
        const tx = await getTransactions(currentUser.uid, 500);
        if (alive) setTransactions(tx || []);
      } catch (e) { console.error(e); }
      if (alive) setLoading(false);
    })();
    return () => { alive = false; };
  }, [currentUser]);

  const days = period === '7d' ? 7 : period === '30d' ? 30 : period === '90d' ? 90 : period === '6m' ? 180 : 365;
  const now = Date.now();

  const inPeriod = useMemo(
    () => transactions.filter(tx => (tx.amount || 0) > 0 && (now - tsMs(tx.createdAt)) <= days * 86400000),
    [transactions, days, now]
  );

  const total = inPeriod.reduce((s, tx) => s + (tx.amount || 0), 0);
  const txCount = inPeriod.length;
  const avg = txCount ? total / txCount : 0;
  const topTx = [...inPeriod].sort((a, b) => (b.amount || 0) - (a.amount || 0))[0];

  // stacked area over time by source
  const stackedData = useMemo(() => {
    const step = days <= 7 ? 1 : days <= 30 ? 2 : days <= 90 ? 7 : 14;
    const chunks = Math.ceil(days / step);
    const data = Array.from({ length: chunks }, (_, i) => {
      const start = now - (days - i * step) * 86400000;
      const end = now - (days - (i + 1) * step) * 86400000;
      const lbl = days <= 7
        ? new Date(start).toLocaleDateString(undefined, { weekday: 'short' })
        : new Date(start).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
      const row = { label: lbl };
      SOURCE_DEFS.forEach(s => { row[s.key] = 0; });
      inPeriod.forEach(tx => {
        const t = tsMs(tx.createdAt);
        if (t >= start && t < end) row[classify(tx)] += tx.amount || 0;
      });
      return row;
    });
    return data;
  }, [inPeriod, days, now]);

  // donut + top fans
  const bySource = useMemo(() => {
    const buckets = Object.fromEntries(SOURCE_DEFS.map(s => [s.key, 0]));
    inPeriod.forEach(tx => { buckets[classify(tx)] += tx.amount || 0; });
    return SOURCE_DEFS
      .map(s => ({ name: s.key, value: buckets[s.key], color: s.color }))
      .filter(s => s.value > 0);
  }, [inPeriod]);

  const topFans = useMemo(() => {
    const map = {};
    inPeriod.forEach(tx => {
      const from = tx.fromUsername || tx.fromUserDisplayName || tx.fromUserId;
      if (!from) return;
      if (!map[from]) map[from] = { name: from, avatar: tx.fromAvatar, value: 0, count: 0 };
      map[from].value += tx.amount || 0;
      map[from].count += 1;
    });
    return Object.values(map).sort((a, b) => b.value - a.value).slice(0, 5);
  }, [inPeriod]);

  return (
    <CreatorLayout page="earnings" title="Earnings" subtitle="Track your coin revenue and cash out" requiredTier="lite" lockDescription="See revenue breakdowns, supporter lists and payouts. Upgrade to Lite to unlock earnings analytics.">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
        <div className="min-w-0">
          <p className="text-text-muted text-xs uppercase tracking-widest font-bold">Total earned</p>
          <p className="font-dmmono font-bold text-white text-4xl tabular-nums mt-1">
            <span className="inline-block mr-1 mb-1 align-middle"><CoinIcon size={28} /></span>
            {compactNum(total)}
            <span className="text-text-muted text-base font-bold ml-2">coins</span>
          </p>
          <p className="text-[11px] text-text-muted mt-1">≈ ${(total * 0.01).toFixed(2)} USD · last {days}d</p>
        </div>
        <PeriodPicker value={period} onChange={setPeriod} />
      </div>

      {loading ? (
        <StackSkeleton rows={5} height={88} />
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4 mb-6">
            <KpiCard label="Total earned" value={total} unit="c" icon="paid" iconColor="text-amber-400" spark={stackedData.map(d => SOURCE_DEFS.reduce((s, src) => s + (d[src.key] || 0), 0))} sparkColor={PALETTE.gold} />
            <KpiCard label="Transactions" value={txCount} icon="receipt_long" iconColor="text-brand-violet-light" />
            <KpiCard label="Avg per tx" value={Math.round(avg)} unit="c" icon="equalizer" iconColor="text-brand-violet" />
            <KpiCard label="Largest tip" value={topTx?.amount || 0} unit="c" icon="emoji_events" iconColor="text-brand-pink" />
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-3 gap-5 mb-6">
            <Card className="p-4 md:p-5 xl:col-span-2">
              <SectionHeader title="Revenue over time" subtitle="Stacked by source" />
              <StackedAreaChart
                data={stackedData}
                series={SOURCE_DEFS.filter(s => bySource.some(b => b.name === s.key)).map(s => ({ key: s.key, label: s.key, color: s.color }))}
                height={300}
              />
            </Card>

            <Card className="p-4 md:p-5">
              <SectionHeader title="Revenue sources" subtitle={`${bySource.length} active`} />
              {bySource.length ? (
                <>
                  <DonutChart data={bySource} height={220} centerValue={compactNum(total)} centerLabel="Coins" />
                  <div className="mt-3 space-y-1">
                    {bySource.map(s => (
                      <div key={s.name} className="flex items-center gap-2 text-xs">
                        <span className="w-2 h-2 rounded-sm" style={{ backgroundColor: s.color }} />
                        <span className="flex-1 text-text-secondary">{s.name}</span>
                        <span className="font-dmmono font-bold text-white">{compactNum(s.value)}</span>
                        <span className="text-text-muted w-10 text-right">{total ? Math.round((s.value / total) * 100) : 0}%</span>
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <div className="h-[260px] flex flex-col items-center justify-center text-center">
                  <Icon name="insights" size={28} className="text-text-muted mb-2" />
                  <p className="text-text-muted text-xs">No earnings in this period yet</p>
                </div>
              )}
            </Card>
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-3 gap-5 mb-6">
            <Card className="p-4 md:p-5 xl:col-span-2">
              <SectionHeader title="Top supporters" subtitle="Who's keeping you going" />
              {topFans.length ? (
                <div className="space-y-2">
                  {topFans.map((f, i) => (
                    <div key={f.name} className="flex items-center gap-3 p-3 rounded-xl bg-white/[0.02] border border-white/[0.04]">
                      <span className="font-syne font-extrabold text-xs text-text-muted w-5 text-center">#{i + 1}</span>
                      <UserAvatar src={f.avatar} size={36} />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-bold text-white truncate">{f.name}</p>
                        <p className="text-[11px] text-text-muted">{f.count} contribution{f.count === 1 ? '' : 's'}</p>
                      </div>
                      <div className="text-right">
                        <p className="font-dmmono font-bold text-amber-400">{compactNum(f.value)}c</p>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="py-10 text-center text-text-muted text-sm">No supporters yet — share your profile to get your first tip.</div>
              )}
            </Card>

            <Card className="p-4 md:p-5">
              <SectionHeader title="Payouts" />
              <StatRow label="Available balance" value={`${compactNum(wallet?.balance || 0)}c`} accent="text-amber-400" />
              <StatRow label="Lifetime earned" value={compactNum(wallet?.totalEarned || 0)} accent="text-white" />
              <StatRow label="Pending payout" value={compactNum(wallet?.pendingPayout || 0)} accent="text-text-muted" />
              <StatRow label="Total paid out" value={compactNum(wallet?.totalPaidOut || 0)} accent="text-text-muted" />
              <div className="mt-3 space-y-2">
                <button onClick={() => navigate('/request-payout')}
                  className="w-full h-11 rounded-xl bg-gradient-to-r from-amber-500 to-amber-400 text-bg-dark font-extrabold text-sm hover:brightness-110 transition-all">
                  Request Payout
                </button>
                <button onClick={() => navigate('/wallet')}
                  className="w-full h-10 rounded-xl bg-white/[0.04] hover:bg-white/[0.08] text-white font-bold text-xs transition-all">
                  View wallet & history
                </button>
              </div>
            </Card>
          </div>

          <Card className="p-4 md:p-5">
            <SectionHeader title="Recent transactions" right={<button onClick={() => navigate('/wallet')} className="text-xs font-bold text-brand-violet-light hover:underline">View all</button>} />
            {inPeriod.length === 0 ? (
              <div className="py-8 text-center text-text-muted text-sm">No transactions yet in this period.</div>
            ) : (
              <div className="divide-y divide-white/[0.04]">
                {inPeriod.slice(0, 10).map(tx => (
                  <button key={tx.id} onClick={() => navigate(`/transaction/${tx.id}`)}
                    className="w-full flex items-center gap-3 py-3 hover:bg-white/[0.02] transition-colors px-2 rounded-lg">
                    <div className="w-9 h-9 rounded-xl bg-amber-500/10 flex items-center justify-center">
                      <CoinIcon size={16} />
                    </div>
                    <div className="flex-1 min-w-0 text-left">
                      <p className="text-sm font-bold text-white truncate">{classify(tx)} · from {tx.fromUsername || 'fan'}</p>
                      <p className="text-[11px] text-text-muted">{new Date(tsMs(tx.createdAt)).toLocaleString()}</p>
                    </div>
                    <span className="font-dmmono font-bold text-amber-400 text-sm">+{compactNum(tx.amount || 0)}c</span>
                  </button>
                ))}
              </div>
            )}
          </Card>
        </>
      )}
    </CreatorLayout>
  );
}
