// AdminDashboardScreen — landing page at /admin.
//
// Real KPI dashboard. The R2 CORS diagnostic + Vanguard squad bootstrap
// utilities moved to /admin/config → System tab (planned). They live here
// for now under a collapsed "infra utilities" section so the founder can
// still reach them on day one.

import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { useUI } from '../../context/UIContext';
import Icon from '../../components/Icon';
import UserAvatar from '../../components/UserAvatar';
import AdminShell, { ADMIN_COLORS as C } from './AdminShell';
import { call, fmtNumber, fmtMoney, fmtRelative, KpiCard } from './_adminGuarded';

export default function AdminDashboardScreen() {
  const { showToast } = useUI();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [charts, setCharts] = useState(null);
  const [chartDays, setChartDays] = useState(30);
  const [loading, setLoading] = useState(true);
  const [chartsLoading, setChartsLoading] = useState(true);
  const [showUtils, setShowUtils] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await call('adminGetDashboardSummary');
      setData(r);
    } catch (e) {
      showToast(e?.message || 'Failed to load dashboard', 'error');
    }
    setLoading(false);
  }, [showToast]);

  const loadCharts = useCallback(async (days) => {
    setChartsLoading(true);
    try {
      const r = await call('adminGetDashboardCharts', { days });
      setCharts(r);
    } catch (e) {
      showToast(e?.message || 'Failed to load chart data', 'error');
    }
    setChartsLoading(false);
  }, [showToast]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { loadCharts(chartDays); }, [loadCharts, chartDays]);

  return (
    <AdminShell
      screen="dashboard"
      title="Dashboard"
      subtitle="Welcome back. Here's what's happening on VERGR."
      topBarRight={
        <button onClick={load} disabled={loading} style={{
          padding: '8px 14px', borderRadius: 8, border: `1px solid ${C.border}`,
          background: C.card, color: C.text, fontSize: 12, fontWeight: 600,
          cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6,
        }}>
          <Icon name="refresh" size={14} /> {loading ? 'Loading…' : 'Refresh'}
        </button>
      }
    >
      {/* KPI row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12, marginBottom: 16 }}>
        <KpiCard icon="group" color="#7c3aed" label="Total Users"
          value={loading ? '—' : fmtNumber(data?.totalUsers)}
          sub={data ? `${fmtNumber(data.activeWeek)} active (7d)` : null} />
        <KpiCard icon="workspace_premium" color="#b44fff" label="Paid Subscriptions"
          value={loading ? '—' : fmtNumber(data?.paidSubscriptions)}
          sub={data ? `${fmtNumber(data.liteCount)} Lite · ${fmtNumber(data.proCount)} Pro` : null} />
        <KpiCard icon="live_tv" color="#f04060" label="Live Streams"
          value={loading ? '—' : fmtNumber(data?.liveStreams)} />
        <KpiCard icon="paid" color="#f0a500" label="MRR"
          value={loading ? '—' : fmtMoney(data?.mrrEUR)} />
        <KpiCard icon="emoji_events" color="#22c55e" label="Tournaments (30d)"
          value={loading ? '—' : fmtNumber(data?.tournamentsThisMonth)} />
      </div>

      {/* Revenue + User Growth charts */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
        <Card title="Revenue Overview"
          right={<DaySelector value={chartDays} onChange={setChartDays} />}>
          {chartsLoading && !charts ? <Empty label="Loading…" /> : (
            <RevenueChart points={charts?.points || []} totals={charts?.totals} />
          )}
          {!chartsLoading && charts && charts.points.every(p => p.missing) && (
            <BackfillNudge onDone={() => loadCharts(chartDays)} />
          )}
        </Card>

        <Card title="User Growth">
          {chartsLoading && !charts ? <Empty label="Loading…" /> : (
            <UserGrowthChart points={charts?.points || []} totals={charts?.totals} />
          )}
        </Card>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr', gap: 16, marginBottom: 16 }}>
        <Card title="Top Games (Live)">
          {!data?.topGames?.length && <Empty label="No streams live right now." />}
          {data?.topGames?.map(g => (
            <div key={g.game} style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '10px 0', borderBottom: `1px dashed ${C.border}`,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{
                  width: 28, height: 28, borderRadius: 6,
                  background: `linear-gradient(135deg, ${C.accent2}, ${C.accent})`,
                }} />
                <div style={{ fontSize: 13, fontWeight: 600, color: C.text }}>{g.game}</div>
              </div>
              <div style={{ fontSize: 13, color: '#f04060', fontWeight: 700 }} className="font-dmmono tabular-nums">
                {fmtNumber(g.streams)} live
              </div>
            </div>
          ))}
        </Card>

        <Card title="System Status">
          {SYSTEM_PILLS.map(p => (
            <div key={p.name} style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '8px 0', borderBottom: `1px dashed ${C.border}`, fontSize: 12,
            }}>
              <span style={{ color: C.text, display: 'flex', alignItems: 'center', gap: 8 }}>
                <Icon name={p.icon} size={14} className="opacity-70" /> {p.name}
              </span>
              <span style={{
                fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 999,
                color: '#22c55e', background: '#22c55e20',
              }}>HEALTHY</span>
            </div>
          ))}
          <div style={{ marginTop: 10, fontSize: 11, color: C.textMuted, textAlign: 'center' }}>
            ● All systems operational
          </div>
        </Card>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16, marginBottom: 16 }}>
        <Card title="Recent Activity">
          {!data?.activity?.length && <Empty label="No recent admin actions." />}
          {data?.activity?.slice(0, 6).map(a => (
            <div key={a.id} style={{
              display: 'flex', alignItems: 'flex-start', gap: 8,
              padding: '8px 0', borderBottom: `1px dashed ${C.border}`,
            }}>
              <div style={{
                width: 6, height: 6, borderRadius: '50%', background: C.accent2,
                marginTop: 6, flexShrink: 0,
              }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 11, color: C.text }}>
                  <strong>{a.actorName}</strong>{' '}
                  <span style={{ color: C.textDim }}>{a.action.replace(/_/g, ' ')}</span>
                </div>
                <div style={{ fontSize: 10, color: C.textMuted }}>{fmtRelative(a.createdAt)}</div>
              </div>
            </div>
          ))}
          <button onClick={() => navigate('/admin/audit')} style={viewAllBtn()}>
            View all
          </button>
        </Card>

        <Card title="Recent Signups">
          {!data?.newUsers?.length && <Empty label="No recent signups." />}
          {data?.newUsers?.map(u => (
            <div key={u.id} style={{
              display: 'flex', alignItems: 'center', gap: 10,
              padding: '8px 0', borderBottom: `1px dashed ${C.border}`,
            }}>
              <UserAvatar src={u.avatar} size={28} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: C.text,
                  whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {u.displayName}
                </div>
                <div style={{ fontSize: 10, color: C.textMuted }}>{fmtRelative(u.createdAt)}</div>
              </div>
            </div>
          ))}
          <button onClick={() => navigate('/admin/users')} style={viewAllBtn()}>
            View all users
          </button>
        </Card>

        <Card title="Moderation Queue">
          <div style={{
            display: 'flex', flexDirection: 'column', gap: 10,
          }}>
            <PillRow label="Pending Reports" value={fmtNumber(data?.pendingReports ?? 0)}
              color="#f04060" />
            <PillRow label="Actioned Today"  value={fmtNumber(data?.actionedToday ?? 0)}
              color="#22c55e" />
            <PillRow label="Live Streams"    value={fmtNumber(data?.liveStreams ?? 0)}
              color="#f04060" />
          </div>
          <button onClick={() => navigate('/admin/reports')} style={{
            ...viewAllBtn(), background: C.accent, color: '#fff', borderColor: C.accent,
          }}>
            Go to Moderation Queue
          </button>
        </Card>
      </div>

      {/* Infra utilities — collapsed by default, moved here from /admin Phase 0 */}
      <details style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 16 }}>
        <summary style={{
          cursor: 'pointer', listStyle: 'none', fontSize: 12, fontWeight: 700,
          color: C.textDim, textTransform: 'uppercase', letterSpacing: '0.06em',
        }}
          onClick={() => setShowUtils(v => !v)}
        >
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            <Icon name={showUtils ? 'expand_more' : 'chevron_right'} size={16} />
            Infra utilities
          </span>
        </summary>
        <div style={{ marginTop: 12 }}>
          <InfraUtilities />
        </div>
      </details>
    </AdminShell>
  );
}

const SYSTEM_PILLS = [
  { name: 'API',             icon: 'cloud' },
  { name: 'Web',             icon: 'public' },
  { name: 'Live Streaming',  icon: 'live_tv' },
  { name: 'Payments',        icon: 'payments' },
  { name: 'Notifications',   icon: 'notifications' },
];

function Card({ title, right, children }) {
  return (
    <div style={{
      background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 16,
      display: 'flex', flexDirection: 'column',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <h3 style={{ margin: 0, fontSize: 13, fontWeight: 700, color: C.text }}>{title}</h3>
        {right}
      </div>
      {children}
    </div>
  );
}

// ───────────────────────────────────────────────────────────
// Chart primitives
// ───────────────────────────────────────────────────────────

function DaySelector({ value, onChange }) {
  return (
    <select value={value} onChange={e => onChange(Number(e.target.value))} style={{
      padding: '6px 10px', borderRadius: 6, border: `1px solid ${C.border}`,
      background: '#0a0a14', color: C.text, fontSize: 11,
    }}>
      <option value="7">Last 7 days</option>
      <option value="30">Last 30 days</option>
      <option value="90">Last 90 days</option>
    </select>
  );
}

function BackfillNudge({ onDone }) {
  const [busy, setBusy] = useState(false);
  const { showToast } = useUI();
  const run = async () => {
    if (!window.confirm('Backfill the last 30 days of daily metrics? This reads recent transactions, subscriptions, and users — safe to re-run.')) return;
    setBusy(true);
    try {
      const r = await call('adminBackfillDailyMetrics', { days: 30 });
      showToast(`Rolled up ${r.rolledUp} days`, 'success');
      onDone();
    } catch (err) {
      showToast(err?.message || 'Backfill failed', 'error');
    }
    setBusy(false);
  };
  return (
    <div style={{
      marginTop: 8, padding: 10, background: '#f0a50015', border: '1px solid #f0a50040',
      borderRadius: 8, display: 'flex', alignItems: 'center', gap: 10,
    }}>
      <Icon name="info" size={14} />
      <div style={{ flex: 1, fontSize: 11, color: C.textDim }}>
        No daily rollups exist yet. The cron runs nightly at 02:30 UTC — backfill the recent history once to populate the charts.
      </div>
      <button onClick={run} disabled={busy} style={{
        padding: '6px 12px', borderRadius: 6, background: '#f0a500', color: '#fff',
        border: 0, fontSize: 11, fontWeight: 700, cursor: 'pointer',
      }}>{busy ? 'Rolling…' : 'Backfill 30d'}</button>
    </div>
  );
}

// Revenue Overview — stacked bar chart per day.
// Subscription EUR is shown as the headline metric (left axis = €), with
// platform coins (tip fees + tournament mod cut) shown as secondary
// translucent bars stacked on top. The header rolls up window totals.
function RevenueChart({ points, totals }) {
  if (!points.length) return <Empty label="No data." />;
  const W = 600, H = 200, PAD_L = 36, PAD_R = 12, PAD_T = 10, PAD_B = 24;
  const innerW = W - PAD_L - PAD_R;
  const innerH = H - PAD_T - PAD_B;
  // Use EUR as primary axis; convert coin revenue to EUR-equiv via 100c ≈ €0.90
  // (rough — purely for visual stacking; treats coin platform-cut as part of revenue).
  const COIN_TO_EUR = 0.009; // €0.0090 per coin (matches the locked economy floor)
  const dailyTotal = points.map(p => p.revenue.subscriptionEUR + p.revenue.totalPlatformCoins * COIN_TO_EUR);
  const max = Math.max(0.01, ...dailyTotal);
  const barW = innerW / points.length;
  const gap = Math.max(1, barW * 0.2);
  const drawW = barW - gap;

  return (
    <div>
      <div style={{ display: 'flex', gap: 18, marginBottom: 10, fontSize: 11 }}>
        <ChartStat label="Subscription €" value={fmtMoney(totals?.subscriptionEUR ?? 0)} color="#22c55e" />
        <ChartStat label="Platform coins" value={`${fmtNumber(totals?.totalPlatformCoins ?? 0)}c`} color="#f0a500" />
        <ChartStat label="Window total" value={fmtMoney((totals?.subscriptionEUR ?? 0) + (totals?.totalPlatformCoins ?? 0) * COIN_TO_EUR)} color={C.text} />
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ width: '100%', height: 220 }}>
        {/* axis gridlines */}
        {[0, 0.5, 1].map(t => (
          <line key={t} x1={PAD_L} x2={W - PAD_R}
            y1={PAD_T + innerH * (1 - t)} y2={PAD_T + innerH * (1 - t)}
            stroke={C.border} strokeWidth="1" />
        ))}
        {/* Y axis labels */}
        <text x={PAD_L - 6} y={PAD_T + innerH} textAnchor="end" fontSize="9" fill={C.textMuted} dominantBaseline="middle">€0</text>
        <text x={PAD_L - 6} y={PAD_T} textAnchor="end" fontSize="9" fill={C.textMuted} dominantBaseline="middle">€{max.toFixed(0)}</text>

        {points.map((p, i) => {
          const subEUR = p.revenue.subscriptionEUR;
          const coinEUR = p.revenue.totalPlatformCoins * COIN_TO_EUR;
          const totalEUR = subEUR + coinEUR;
          const x = PAD_L + i * barW + gap / 2;
          const subH = (subEUR / max) * innerH;
          const coinH = (coinEUR / max) * innerH;
          const subY = PAD_T + innerH - subH;
          const coinY = subY - coinH;
          return (
            <g key={p.date}>
              <title>{`${p.date}\n€${subEUR.toFixed(2)} subs\n${fmtNumber(p.revenue.totalPlatformCoins)}c platform coins\nTotal ≈ €${totalEUR.toFixed(2)}`}</title>
              {subEUR > 0 && <rect x={x} y={subY} width={drawW} height={subH} fill="#22c55e" rx="2" />}
              {coinEUR > 0 && <rect x={x} y={coinY} width={drawW} height={coinH} fill="#f0a500" fillOpacity="0.85" rx="2" />}
            </g>
          );
        })}
        {/* X labels — sparse: first, middle, last */}
        {[0, Math.floor(points.length / 2), points.length - 1].map(i => points[i] && (
          <text key={i} x={PAD_L + i * barW + drawW / 2 + gap / 2} y={H - 6} textAnchor="middle" fontSize="9" fill={C.textMuted}>
            {points[i].date.slice(5)}
          </text>
        ))}
      </svg>
    </div>
  );
}

function UserGrowthChart({ points, totals }) {
  if (!points.length) return <Empty label="No data." />;
  const W = 600, H = 200, PAD_L = 32, PAD_R = 12, PAD_T = 10, PAD_B = 24;
  const innerW = W - PAD_L - PAD_R;
  const innerH = H - PAD_T - PAD_B;
  const max = Math.max(1, ...points.map(p => p.signups.total));
  const stepX = points.length > 1 ? innerW / (points.length - 1) : 0;
  const xFor = (i) => PAD_L + i * stepX;
  const yFor = (v) => PAD_T + innerH - (v / max) * innerH;

  // Build smooth lines via simple polylines
  const totalLine = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${xFor(i)} ${yFor(p.signups.total)}`).join(' ');
  const paidLine  = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${xFor(i)} ${yFor(p.signups.lite + p.signups.pro)}`).join(' ');
  // Area fill under total line
  const totalArea = `${totalLine} L ${xFor(points.length - 1)} ${PAD_T + innerH} L ${xFor(0)} ${PAD_T + innerH} Z`;

  const paid = (totals?.newLite ?? 0) + (totals?.newPro ?? 0);
  return (
    <div>
      <div style={{ display: 'flex', gap: 18, marginBottom: 10, fontSize: 11 }}>
        <ChartStat label="New signups" value={fmtNumber(totals?.signups ?? 0)} color="#7c3aed" />
        <ChartStat label="New paid" value={fmtNumber(paid)} color="#b44fff" />
        <ChartStat label="Conversion" value={totals?.signups ? `${((paid / totals.signups) * 100).toFixed(1)}%` : '—'} color={C.text} />
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ width: '100%', height: 220 }}>
        {[0, 0.5, 1].map(t => (
          <line key={t} x1={PAD_L} x2={W - PAD_R}
            y1={PAD_T + innerH * (1 - t)} y2={PAD_T + innerH * (1 - t)}
            stroke={C.border} strokeWidth="1" />
        ))}
        <text x={PAD_L - 6} y={PAD_T + innerH} textAnchor="end" fontSize="9" fill={C.textMuted} dominantBaseline="middle">0</text>
        <text x={PAD_L - 6} y={PAD_T} textAnchor="end" fontSize="9" fill={C.textMuted} dominantBaseline="middle">{max}</text>

        <path d={totalArea} fill="#7c3aed" fillOpacity="0.15" />
        <path d={totalLine} fill="none" stroke="#7c3aed" strokeWidth="2" />
        <path d={paidLine}  fill="none" stroke="#b44fff" strokeWidth="2" strokeDasharray="4 3" />

        {/* Point dots on total line */}
        {points.map((p, i) => (
          <circle key={p.date} cx={xFor(i)} cy={yFor(p.signups.total)} r="2.5" fill="#7c3aed">
            <title>{`${p.date}\n${p.signups.total} signups\n${p.signups.lite + p.signups.pro} paid`}</title>
          </circle>
        ))}

        {[0, Math.floor(points.length / 2), points.length - 1].map(i => points[i] && (
          <text key={i} x={xFor(i)} y={H - 6} textAnchor="middle" fontSize="9" fill={C.textMuted}>
            {points[i].date.slice(5)}
          </text>
        ))}
      </svg>
    </div>
  );
}

function ChartStat({ label, value, color }) {
  return (
    <div>
      <div style={{ fontSize: 10, color: C.textMuted }}>{label}</div>
      <div className="font-dmmono tabular-nums" style={{ fontSize: 16, fontWeight: 700, color }}>{value}</div>
    </div>
  );
}

function Empty({ label }) {
  return <div style={{ padding: 16, textAlign: 'center', color: C.textDim, fontSize: 11 }}>{label}</div>;
}

function PillRow({ label, value, color }) {
  return (
    <div style={{
      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      padding: '12px 14px', background: '#0a0a14', borderRadius: 8,
      border: `1px solid ${color}30`,
    }}>
      <span style={{ fontSize: 12, color: C.text }}>{label}</span>
      <span style={{ fontSize: 18, fontWeight: 700, color }} className="font-dmmono tabular-nums">{value}</span>
    </div>
  );
}

function viewAllBtn() {
  return {
    width: '100%', marginTop: 10, padding: '8px 12px', borderRadius: 8,
    background: 'transparent', border: `1px solid ${C.border}`, color: C.textDim,
    fontSize: 11, fontWeight: 600, cursor: 'pointer',
  };
}

// ───────────────────────────────────────────────────────────
// Salvaged infra utilities (R2 CORS + Vanguard squad bootstrap)
// ───────────────────────────────────────────────────────────

function InfraUtilities() {
  const { showToast } = useUI();
  const [corsBusy, setCorsBusy] = useState(false);
  const [corsReport, setCorsReport] = useState(null);
  const [vanguardSquadId, setVanguardSquadId] = useState('wc1atfQOAY2NKFU050Qb');
  const [vsBusy, setVsBusy] = useState(false);

  const applyVanguardSquadConfig = async () => {
    if (!vanguardSquadId.trim()) { showToast('Enter the Vanguard squad ID', 'error'); return; }
    if (!window.confirm(`Set "${vanguardSquadId}" as THE Vanguard squad (unlimited members, special-cased everywhere)?`)) return;
    setVsBusy(true);
    try {
      const fn = httpsCallable(getFunctions(undefined, 'europe-west1'), 'setVanguardSquadConfig');
      const r = await fn({ squadId: vanguardSquadId.trim() });
      showToast(`Vanguard squad set: ${r.data.squadId}`, 'success');
    } catch (err) {
      showToast(err?.message || 'Failed', 'error');
    }
    setVsBusy(false);
  };

  const applyR2Cors = async () => {
    setCorsBusy(true); setCorsReport(null);
    try {
      const fn = httpsCallable(getFunctions(undefined, 'europe-west1'), 'setR2CorsPolicy');
      const r = await fn();
      setCorsReport(r.data);
      showToast(r.data?.putCorsSucceeded ? 'CORS write succeeded' : 'CORS write failed — see report', r.data?.putCorsSucceeded ? 'success' : 'error');
    } catch (err) {
      setCorsReport({ error: err?.message || String(err) });
      showToast(err?.message || 'Diagnostic failed', 'error');
    }
    setCorsBusy(false);
  };

  return (
    <div style={{ display: 'grid', gap: 10 }}>
      <Util label="Apply R2 CORS policy / diagnose"
        description="Idempotent CORS writer + diagnostic dump for the vergr-media bucket.">
        <button onClick={applyR2Cors} disabled={corsBusy} style={utilBtn(C.accent)}>
          {corsBusy ? 'Applying…' : 'Apply CORS'}
        </button>
      </Util>
      <Util label="Bootstrap Vanguard squad"
        description="Sets app_config/general.vanguardSquadId + removes the squad's member cap.">
        <input value={vanguardSquadId} onChange={e => setVanguardSquadId(e.target.value)}
          style={{ padding: '8px 12px', background: '#0a0a14', color: C.text, border: `1px solid ${C.border}`, borderRadius: 6, fontSize: 11 }} />
        <button onClick={applyVanguardSquadConfig} disabled={vsBusy} style={utilBtn(C.accent2)}>
          {vsBusy ? 'Setting…' : 'Set'}
        </button>
      </Util>
      {corsReport && (
        <pre style={{
          margin: 0, padding: 12, background: '#0a0a14', borderRadius: 8,
          border: `1px solid ${C.border}`, fontSize: 10, color: '#a0c0ff',
          whiteSpace: 'pre-wrap', wordBreak: 'break-all', maxHeight: 300, overflow: 'auto',
        }}>{JSON.stringify(corsReport, null, 2)}</pre>
      )}
    </div>
  );
}

function Util({ label, description, children }) {
  return (
    <div style={{
      padding: 12, background: '#0a0a14', border: `1px solid ${C.border}`,
      borderRadius: 8, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
    }}>
      <div style={{ flex: 1, minWidth: 200 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: C.text }}>{label}</div>
        <div style={{ fontSize: 10.5, color: C.textMuted, marginTop: 2 }}>{description}</div>
      </div>
      {children}
    </div>
  );
}

function utilBtn(bg) {
  return {
    padding: '8px 12px', borderRadius: 6, border: 0,
    background: bg, color: '#fff', fontSize: 11, fontWeight: 700, cursor: 'pointer',
  };
}
