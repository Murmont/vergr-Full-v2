// /vanguard/stats — My Stats. Design ref: Vanguard My Stats.png
// Real data only: every number is computed from the member's own
// vanguard_actions log. No dummy fallback.

import { useEffect, useMemo, useState } from 'react';
import VanguardLayout, { VG_COLORS as C, VanguardPageHeader, VgCard } from '../../components/vanguard/VanguardLayout';
import Icon from '../../components/Icon';
import { useUser } from '../../context/UserContext';
import { getMyVanguardActions } from '../../firebase/firestore';

const fmt = (n) => Number(n || 0).toLocaleString();
const tsMs = (t) => (t?.toDate ? t.toDate().getTime() : t?.seconds ? t.seconds * 1000 : (t instanceof Date ? t.getTime() : Number(t) || 0));
const TYPE_COLORS = ['#7B1FFF', '#B44FFF', '#F5C842', '#F04060', '#22D17E', '#3D7FFF', '#C87FFF', '#F0A500'];

function BarChart({ data }) {
  const max = Math.max(...data.map(d => d.count), 1);
  const w = 800, h = 180, barW = (w - 20) / data.length;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} style={{ width: '100%', height: 180 }} preserveAspectRatio="none">
      {data.map((d, i) => {
        const bh = (d.count / max) * (h - 20);
        const x = 10 + i * barW;
        const y = h - bh - 4;
        return (
          <rect key={i} x={x + 1} y={y} width={Math.max(1, barW - 2)} height={bh} fill={C.violetLt} opacity={0.85} rx={1} />
        );
      })}
    </svg>
  );
}

function DonutChart({ data, total }) {
  const cx = 80, cy = 80, r = 56, rIn = 36;
  let acc = 0;
  const sum = data.reduce((s, d) => s + d.count, 0) || 1;
  const arcs = data.map((d) => {
    const a0 = (acc / sum) * 2 * Math.PI;
    acc += d.count;
    const a1 = (acc / sum) * 2 * Math.PI;
    const lf = a1 - a0 > Math.PI ? 1 : 0;
    const xa = cx + r * Math.sin(a0), ya = cy - r * Math.cos(a0);
    const xb = cx + r * Math.sin(a1), yb = cy - r * Math.cos(a1);
    const xa2 = cx + rIn * Math.sin(a1), ya2 = cy - rIn * Math.cos(a1);
    const xb2 = cx + rIn * Math.sin(a0), yb2 = cy - rIn * Math.cos(a0);
    return (
      <path key={d.type} d={`M ${xa} ${ya} A ${r} ${r} 0 ${lf} 1 ${xb} ${yb} L ${xa2} ${ya2} A ${rIn} ${rIn} 0 ${lf} 0 ${xb2} ${yb2} Z`} fill={d.color || C.violetLt} />
    );
  });
  return (
    <svg viewBox="0 0 160 160" style={{ width: 160, height: 160 }}>
      {data.length === 0 && <circle cx={cx} cy={cy} r={(r + rIn) / 2} fill="none" stroke={C.border} strokeWidth={r - rIn} />}
      {arcs}
      <text x="80" y="76" textAnchor="middle" fill={C.text} fontFamily="DM Mono" fontSize="20" fontWeight="800">{fmt(total)}</text>
      <text x="80" y="92" textAnchor="middle" fill={C.textMuted} fontFamily="DM Mono" fontSize="9">TOTAL</text>
    </svg>
  );
}

export default function VanguardStatsScreen() {
  const { profile } = useUser();
  const [actions, setActions] = useState(null);

  useEffect(() => {
    let alive = true;
    if (profile?.uid) {
      getMyVanguardActions(profile.uid, 500).then((r) => { if (alive) setActions(r || []); }).catch(() => { if (alive) setActions([]); });
    } else setActions([]);
    return () => { alive = false; };
  }, [profile?.uid]);

  const stats = useMemo(() => {
    const list = actions || [];
    const now = Date.now();
    const within = (ms) => list.filter((a) => now - tsMs(a.takenAt) <= ms).length;
    const mk = (() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; })();
    const month = profile?.vanguard?.monthlyActions?.[mk] ?? within(30 * 86400_000);
    const all = profile?.vanguard?.totalActions || list.length;

    // 60-day bar buckets (oldest → newest).
    const daily = Array.from({ length: 60 }, (_, i) => {
      const day = new Date(now - (59 - i) * 86400_000);
      day.setHours(0, 0, 0, 0);
      return { date: day, count: 0 };
    });
    const dayIndex = (ms) => Math.floor((ms - (daily[0].date.getTime())) / 86400_000);
    const daySet = new Set();
    list.forEach((a) => {
      const ms = tsMs(a.takenAt); if (!ms) return;
      const di = dayIndex(ms);
      if (di >= 0 && di < 60) daily[di].count += 1;
      const d = new Date(ms); d.setHours(0, 0, 0, 0); daySet.add(d.getTime());
    });

    // Streak: consecutive days (including today) with at least one action.
    let streak = 0;
    const today = new Date(); today.setHours(0, 0, 0, 0);
    for (let i = 0; ; i++) {
      const d = today.getTime() - i * 86400_000;
      if (daySet.has(d)) streak += 1; else break;
    }

    // By type + by target.
    const typeMap = {};
    const targetMap = {};
    list.forEach((a) => {
      const t = String(a.action || 'action');
      typeMap[t] = (typeMap[t] || 0) + 1;
      const tg = String(a.targetType || 'other');
      targetMap[tg] = (targetMap[tg] || 0) + 1;
    });
    const toRows = (map) => Object.entries(map).sort((a, b) => b[1] - a[1]).slice(0, 8)
      .map(([type, count], i) => ({ type, label: type.replace(/_/g, ' '), count, color: TYPE_COLORS[i % TYPE_COLORS.length] }));

    return {
      all, week: within(7 * 86400_000), month,
      avgPerDay: (within(30 * 86400_000) / 30),
      streak, daily,
      byType: toRows(typeMap),
      byTarget: toRows(targetMap),
      loadedTotal: list.length,
    };
  }, [actions, profile?.vanguard]);

  const mkLabel = new Date().toLocaleDateString(undefined, { month: 'long', year: 'numeric' });

  return (
    <VanguardLayout page="stats">
      <VanguardPageHeader title="My Stats" subtitle="Your moderation impact at a glance." />

      {actions !== null && stats.loadedTotal === 0 && (
        <VgCard style={{ marginBottom: 14, textAlign: 'center', padding: 28 }}>
          <Icon name="insights" size={28} style={{ color: C.textMuted, opacity: 0.6 }} />
          <div style={{ fontFamily: 'DM Sans', fontWeight: 700, fontSize: 14, color: C.text, marginTop: 8 }}>No moderation actions logged yet</div>
          <div style={{ fontFamily: 'DM Sans', fontSize: 12.5, color: C.textDim, marginTop: 4 }}>Your charts populate as you claim slots and resolve cases.</div>
        </VgCard>
      )}

      {/* 5 KPI tiles */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 12, marginBottom: 14 }}>
        {[
          { label: 'Total actions', value: fmt(stats.all), sub: 'all-time' },
          { label: 'This week',     value: fmt(stats.week), sub: 'last 7 days' },
          { label: 'This month',    value: fmt(stats.month), sub: mkLabel },
          { label: 'Avg per day',   value: stats.avgPerDay.toFixed(2), sub: 'last 30 days' },
          { label: 'Streak',        value: `${stats.streak} days`, sub: 'consecutive active days' },
        ].map((k) => (
          <VgCard key={k.label}>
            <div style={{ fontFamily: 'DM Mono', fontSize: 10, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '.14em' }}>{k.label}</div>
            <div style={{ fontFamily: 'DM Mono', fontSize: 26, fontWeight: 800, color: C.text, marginTop: 6, lineHeight: 1 }}>{k.value}</div>
            <div style={{ fontFamily: 'DM Sans', fontSize: 11, color: C.textDim, marginTop: 4 }}>{k.sub}</div>
          </VgCard>
        ))}
      </div>

      {/* Actions per day chart */}
      <VgCard style={{ marginBottom: 14 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <div style={{ fontFamily: 'DM Mono', fontSize: 10, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '.14em' }}>Actions per day</div>
          <span style={{ fontFamily: 'DM Mono', fontSize: 10, color: C.textDim }}>Last 60 days</span>
        </div>
        <BarChart data={stats.daily} />
        <div style={{ display: 'flex', justifyContent: 'space-between', fontFamily: 'DM Mono', fontSize: 9.5, color: C.textMuted, marginTop: 4 }}>
          <span>{stats.daily[0].date.toLocaleDateString()}</span>
          <span>{stats.daily[stats.daily.length - 1].date.toLocaleDateString()}</span>
        </div>
      </VgCard>

      {/* 2 donuts side by side */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: 14 }}>
        <VgCard>
          <div style={{ fontFamily: 'DM Mono', fontSize: 10, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '.14em', marginBottom: 12 }}>Actions by type</div>
          <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
            <DonutChart data={stats.byType} total={stats.loadedTotal} />
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
              {stats.byType.length === 0 ? <span style={{ fontFamily: 'DM Sans', fontSize: 12, color: C.textMuted }}>No data yet.</span> : stats.byType.map((d) => (
                <div key={d.type} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ width: 10, height: 10, borderRadius: 2, background: d.color, flexShrink: 0 }} />
                  <span style={{ fontFamily: 'DM Sans', fontSize: 11.5, color: C.textDim, flex: 1, textTransform: 'capitalize' }}>{d.label}</span>
                  <span style={{ fontFamily: 'DM Mono', fontSize: 11.5, color: C.text, fontWeight: 700 }}>{d.count}</span>
                </div>
              ))}
            </div>
          </div>
        </VgCard>

        <VgCard>
          <div style={{ fontFamily: 'DM Mono', fontSize: 10, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '.14em', marginBottom: 12 }}>Actions by target</div>
          <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
            <DonutChart data={stats.byTarget} total={stats.loadedTotal} />
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
              {stats.byTarget.length === 0 ? <span style={{ fontFamily: 'DM Sans', fontSize: 12, color: C.textMuted }}>No data yet.</span> : stats.byTarget.map((d) => (
                <div key={d.type} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ width: 10, height: 10, borderRadius: 2, background: d.color, flexShrink: 0 }} />
                  <span style={{ fontFamily: 'DM Sans', fontSize: 11.5, color: C.textDim, flex: 1, textTransform: 'capitalize' }}>{d.label}</span>
                  <span style={{ fontFamily: 'DM Mono', fontSize: 11.5, color: C.text, fontWeight: 700 }}>{d.count}</span>
                </div>
              ))}
            </div>
          </div>
        </VgCard>
      </div>
    </VanguardLayout>
  );
}
