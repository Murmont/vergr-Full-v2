// AdminStatsScreen — /admin/stats
//
// "Live" platform telemetry. Polls callables on a 10-30s rotation; not
// real-time websockets. The screen always renders even when collections
// are empty — every backend call falls through with zeros.
//
// All tabs are wired: Overview / Users / Engagement / Transactions (ledger
// tail via adminListTransactions; full paginator on Economy) / System /
// Errors (client_errors intake) / Geography / Event Load / Costs.

import { useState, useEffect, useRef, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { useUI } from '../../context/UIContext';
import Icon from '../../components/Icon';
import AdminShell, { ADMIN_COLORS as C } from './AdminShell';
import { call, fmtNumber, fmtRelative, KpiCard, Tabs, useGuardedCall } from './_adminGuarded';
import { openInVergr } from '../../admin/openExternal';

const TABS = [
  { id: 'overview',     label: 'Overview' },
  { id: 'users',        label: 'Users' },
  { id: 'engagement',   label: 'Engagement' },
  { id: 'transactions', label: 'Transactions' },
  { id: 'system',       label: 'System' },
  { id: 'errors',       label: 'Errors' },
  { id: 'geography',    label: 'Geography' },
  { id: 'events',       label: 'Event Load' },
  { id: 'costs',        label: 'Costs' },
];

export default function AdminStatsScreen() {
  const [tab, setTab] = useState('overview');
  const [autoRefresh, setAutoRefresh] = useState(true);

  return (
    <AdminShell
      screen="stats"
      title="Live Stats"
      subtitle="Real-time view of application activity and system performance."
      topBarRight={
        <label style={{
          display: 'inline-flex', alignItems: 'center', gap: 6,
          fontSize: 11, color: C.textDim, cursor: 'pointer',
        }}>
          <input type="checkbox" checked={autoRefresh} onChange={e => setAutoRefresh(e.target.checked)} />
          Auto-refresh
        </label>
      }
    >
      <Tabs tabs={TABS} active={tab} onChange={setTab} />
      {tab === 'overview'    && <OverviewTab autoRefresh={autoRefresh} />}
      {tab === 'system'      && <SystemTab   autoRefresh={autoRefresh} />}
      {tab === 'geography'   && <GeographyTab autoRefresh={autoRefresh} />}
      {tab === 'events'      && <EventLoadTab autoRefresh={autoRefresh} />}
      {tab === 'costs'       && <CostsTab />}
      {tab === 'users'       && <UsersLiveTab   autoRefresh={autoRefresh} />}
      {tab === 'engagement'  && <EngagementTab  autoRefresh={autoRefresh} />}
      {tab === 'transactions' && <TransactionsTab />}
      {tab === 'errors'      && <ErrorsTab      autoRefresh={autoRefresh} />}
    </AdminShell>
  );
}

// usePolling — runs `loadFn` immediately then every `ms` while `active` is true.
function usePolling(loadFn, ms, active) {
  const fnRef = useRef(loadFn);
  fnRef.current = loadFn;
  useEffect(() => {
    fnRef.current();
    if (!active) return;
    const id = setInterval(() => fnRef.current(), ms);
    return () => clearInterval(id);
  }, [ms, active]);
}

// ───────────────────────────────────────────────────────────
// OVERVIEW
// ───────────────────────────────────────────────────────────

function OverviewTab({ autoRefresh }) {
  const { showToast } = useUI();
  const [data, setData] = useState(null);
  const [feed, setFeed] = useState([]);
  const [loadingFirst, setLoadingFirst] = useState(true);
  // The live-stream list costs reads, so it is fetched only while it is open.
  const [showLive, setShowLive] = useState(false);

  const load = useCallback(async () => {
    try {
      const [o, f] = await Promise.all([
        call('adminGetLiveStatsOverview', showLive ? { liveList: true } : {}),
        call('adminGetLiveActivityFeed', { limit: 15 }),
      ]);
      setData(o); setFeed(f.rows || []);
    } catch (e) {
      if (loadingFirst) showToast(e?.message || 'Failed to load stats', 'error');
    }
    setLoadingFirst(false);
  }, [showToast, loadingFirst, showLive]);

  usePolling(load, 10_000, autoRefresh);
  // Opening the list fetches it now rather than on the next 10s tick.
  useEffect(() => { if (showLive) load(); }, [showLive]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginBottom: 16 }}>
        <KpiCard icon="bolt" color="#7c3aed" label="Active Now"
          value={loadingFirst ? '—' : fmtNumber(data?.activeNow)} sub="last 5 min" />
        <KpiCard icon="group" color="#3b82f6" label="Total Users"
          value={loadingFirst ? '—' : fmtNumber(data?.totalUsers)} />
        <KpiCard icon="person_add" color="#22c55e" label="New (24h)"
          value={loadingFirst ? '—' : fmtNumber(data?.newToday)} />
        <KpiCard icon="live_tv" color="#f04060" label="Live Streams"
          value={loadingFirst ? '—' : fmtNumber(data?.liveStreams)} />
        <KpiCard icon="calendar_today" color="#f0a500" label="WAU"
          value={loadingFirst ? '—' : fmtNumber(data?.weeklyActive)} />
        <KpiCard icon="event" color="#b44fff" label="MAU"
          value={loadingFirst ? '—' : fmtNumber(data?.monthlyActive)} />
      </div>

      <LiveNowCard
        count={data?.liveStreams || 0}
        open={showLive}
        onToggle={() => setShowLive((v) => !v)}
        rows={data?.liveNow}
        onEnded={load}
      />

      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 16, marginBottom: 16 }}>
        <Card title="Active Users (24h)">
          {!data?.chart?.length ? (
            <Empty label="No 24-hour presence snapshots yet. (Snapshot cron is planned.)" />
          ) : (
            <ActiveChart points={data.chart} />
          )}
        </Card>

        <Card title="Active Devices">
          {!data ? <Empty label="Loading…" /> : (
            <>
              <DeviceRow label="Web"     count={data.deviceCounts.web}     total={data.activeNow} color="#7c3aed" />
              <DeviceRow label="iOS"     count={data.deviceCounts.ios}     total={data.activeNow} color="#3b82f6" />
              <DeviceRow label="Android" count={data.deviceCounts.android} total={data.activeNow} color="#22c55e" />
              <DeviceRow label="Other"   count={data.deviceCounts.other}   total={data.activeNow} color={C.textDim} />
            </>
          )}
        </Card>
      </div>

      <Card title="Real-time Activity Feed">
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8,
          marginBottom: 10, fontSize: 10, color: '#22c55e', fontWeight: 700,
        }}>
          <span style={{
            width: 6, height: 6, borderRadius: '50%', background: '#22c55e',
            animation: 'pulse 2s infinite',
          }} />
          LIVE
        </div>
        {feed.length === 0 && <Empty label="No recent events." />}
        {feed.map(e => (
          <div key={e.id} style={{
            display: 'flex', alignItems: 'flex-start', gap: 10,
            padding: '6px 0', borderBottom: `1px dashed ${C.border}`,
          }}>
            <div style={{ width: 4, height: 4, borderRadius: '50%', background: C.accent2, marginTop: 6 }} />
            <div style={{ flex: 1, fontSize: 11, color: C.text }}>
              <div>{e.message || e.type}</div>
              <div style={{ fontSize: 10, color: C.textMuted }}>
                {fmtRelative(e.createdAt)} · <span style={{ fontFamily: 'ui-monospace, monospace' }}>{e.source}</span>
              </div>
            </div>
          </div>
        ))}
      </Card>
    </>
  );
}

function DeviceRow({ label, count, total, color }) {
  const pct = total > 0 ? (count / total) * 100 : 0;
  return (
    <div style={{ padding: '10px 0', borderBottom: `1px dashed ${C.border}` }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: C.text, marginBottom: 4 }}>
        <span>{label}</span>
        <span className="font-dmmono tabular-nums">{fmtNumber(count)} <span style={{ color: C.textMuted }}>({pct.toFixed(1)}%)</span></span>
      </div>
      <div style={{ height: 6, background: '#0a0a14', borderRadius: 3, overflow: 'hidden' }}>
        <div style={{ width: `${Math.min(100, pct)}%`, height: '100%', background: color, transition: 'width .3s' }} />
      </div>
    </div>
  );
}

// ───────────────────────────────────────────────────────────
// SYSTEM
// ───────────────────────────────────────────────────────────

function SystemTab({ autoRefresh }) {
  const [data, setData] = useState(null);

  const load = useCallback(async () => {
    try { setData(await call('adminGetSystemMetrics')); } catch {}
  }, []);
  usePolling(load, 30_000, autoRefresh);

  if (!data) return <Empty label="Loading…" />;

  const h = data.hetzner || {};
  const s = data.sysinfo || {};
  const fb = data.firebase || {};

  // Derived values
  const memPct = s.mem?.usedPct;
  const diskPct = s.disk?.usedPct;
  const memUsedGb  = s.mem?.usedKb  != null ? s.mem.usedKb  / 1024 / 1024 : null;
  const memTotalGb = s.mem?.totalKb != null ? s.mem.totalKb / 1024 / 1024 : null;
  const diskUsedGb  = s.disk?.usedBytes  != null ? s.disk.usedBytes  / 1e9 : null;
  const diskTotalGb = s.disk?.totalBytes != null ? s.disk.totalBytes / 1e9 : null;
  const netInMbps  = h.networkInBps  != null ? (h.networkInBps  * 8) / 1e6 : null;
  const netOutMbps = h.networkOutBps != null ? (h.networkOutBps * 8) / 1e6 : null;
  const monthlyOutGb = h.outgoingTrafficBytes != null ? h.outgoingTrafficBytes / 1e9 : null;
  const monthlyAllowanceGb = h.includedTrafficBytes != null ? h.includedTrafficBytes / 1e9 : null;
  const trafficPct = (monthlyOutGb != null && monthlyAllowanceGb)
    ? (monthlyOutGb / monthlyAllowanceGb) * 100 : null;

  return (
    <>
      {/* COMPUTE — Hetzner-side */}
      <SectionHeader title="Compute · Hetzner vergr-stream-1"
        sub={h.serverType ? `${h.serverType.toUpperCase()} · ${h.cores}× vCPU · ${h.memoryGb} GB RAM · ${h.diskGb} GB SSD · ${h.datacenter || 'NBG1'}` : 'Cloud API status unknown'}
        status={h.status} />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginBottom: 14 }}>
        <PctTile icon="memory" color="#7c3aed" label="vCPU"
          value={h.cpuPct} unwired={h.status !== 'healthy'} />
        <PctTile icon="developer_board" color="#3b82f6" label="Memory"
          value={memPct} unwired={s.status !== 'healthy'}
          sub={memUsedGb != null ? `${memUsedGb.toFixed(1)} / ${memTotalGb.toFixed(1)} GB` : null} />
        <PctTile icon="storage" color="#22c55e" label="Disk"
          value={diskPct} unwired={s.status !== 'healthy'}
          sub={diskUsedGb != null ? `${diskUsedGb.toFixed(1)} / ${diskTotalGb.toFixed(1)} GB` : null} />
        <KpiCard icon="sync_alt" color="#f0a500" label="Load Avg (1m)"
          value={s.load?.one != null ? s.load.one.toFixed(2) : 'unwired'}
          sub={s.load ? `5m ${s.load.five.toFixed(2)} · 15m ${s.load.fifteen.toFixed(2)}` : null} />
        <KpiCard icon="schedule" color="#b44fff" label="Uptime"
          value={s.uptimeSec != null ? fmtUptime(s.uptimeSec) : 'unwired'} />
      </div>

      <SectionHeader title="Network · Hetzner" status={h.status} sub="Live bandwidth (5-min average) + monthly traffic allowance" />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12, marginBottom: 14 }}>
        <KpiCard icon="south" color="#3b82f6" label="Traffic In"
          value={netInMbps != null ? `${netInMbps.toFixed(1)} Mbps` : 'unwired'} />
        <KpiCard icon="north" color="#f04060" label="Traffic Out"
          value={netOutMbps != null ? `${netOutMbps.toFixed(1)} Mbps` : 'unwired'} />
        <KpiCard icon="data_usage" color="#f0a500" label="This Month (out)"
          value={monthlyOutGb != null ? `${monthlyOutGb.toFixed(1)} GB` : 'unwired'}
          sub={monthlyAllowanceGb ? `of ${(monthlyAllowanceGb / 1000).toFixed(0)} TB free${trafficPct != null ? ` · ${trafficPct.toFixed(1)}%` : ''}` : null} />
        <KpiCard icon="speed" color="#22c55e" label="Disk IOPS"
          value={(h.diskReadIops != null || h.diskWriteIops != null)
            ? `${fmtNumber(Math.round((h.diskReadIops || 0) + (h.diskWriteIops || 0)))}/s` : 'unwired'}
          sub={h.diskReadIops != null ? `read ${Math.round(h.diskReadIops)} · write ${Math.round(h.diskWriteIops || 0)}` : null} />
      </div>

      {/* SFU */}
      <SectionHeader title="Pion SFU · sfu.vergr.app" status={data.sfu.status}
        sub="Squad voice/video rooms + co-host ingest" />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12, marginBottom: 14 }}>
        <KpiCard icon="podcasts" color="#f04060" label="Active Rooms"
          value={data.sfu.rooms != null ? fmtNumber(data.sfu.rooms) : 'unwired'} />
        <KpiCard icon="groups" color="#b44fff" label="Connected Peers"
          value={data.sfu.peers != null ? fmtNumber(data.sfu.peers) : 'unwired'} />
      </div>

      {/* FIREBASE / FIRESTORE */}
      <SectionHeader title="Firebase · vgrdb Firestore" status={fb.status}
        sub="Document counts across the major collections" />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10, marginBottom: 14 }}>
        <SmallStat label="Users" value={fmtNumber(fb.users)} />
        <SmallStat label="Posts" value={fmtNumber(fb.posts)} />
        {/* The `tournaments` collection now holds ticketed EVENTS. Same docs,
            honest label. */}
        <SmallStat label="Events" value={fmtNumber(fb.tournaments)} />
        <SmallStat label="Streams" value={fmtNumber(fb.streams)} />
        <SmallStat label="Subscriptions" value={fmtNumber(fb.subscriptions)} />
        <SmallStat label="Transactions" value={fmtNumber(fb.transactions)} />
        <SmallStat label="Reports" value={fmtNumber(fb.reports)} />
        <SmallStat label="Notifications" value={fmtNumber(fb.notifications)} />
        <SmallStat label="Announcements" value={fmtNumber(fb.announcements)} />
        <SmallStat label="Audit Rows" value={fmtNumber(fb.adminActions)} />
      </div>

      {/* STORAGE / EXTERNAL */}
      <SectionHeader title="External services" status="info"
        sub="Cloudflare, wired separately" />
      <Card>
        <SystemRow name="Cloudflare R2 (vergr-media bucket)" status={data.r2.status}
          note="Cloudflare API key not set in Firebase Secrets. Storage GB + Class A/B ops will land when wired." />
        <SystemRow name="Cloudflare CDN egress" status={data.cdn.status}
          note="Same — needs CLOUDFLARE_API_TOKEN secret." />
      </Card>

      {(h.status === 'unwired' || s.status === 'unwired') && (
        <>
          <div style={{ height: 14 }} />
          <div style={{
            padding: 14, background: '#0a0a1480', border: `1px solid ${C.border}`,
            borderRadius: 12, fontSize: 12, color: C.textDim, lineHeight: 1.6,
          }}>
            <strong style={{ color: C.text }}>Some tiles say "unwired":</strong>
            {h.status === 'unwired' && (
              <div style={{ marginTop: 6 }}>
                · <strong>Hetzner CPU + network</strong> — set <code>HETZNER_API_TOKEN</code> Firebase secret.
              </div>
            )}
            {s.status === 'unwired' && (
              <div style={{ marginTop: 6 }}>
                · <strong>Memory + Disk + Load + Uptime</strong> — deploy the <code>vergr-sysinfo</code> agent
                to the Hetzner box (<code>infra/vergr-sysinfo/deploy.sh</code>) and set the matching
                <code> VERGR_SYSINFO_TOKEN</code> Firebase secret.
              </div>
            )}
            {s.status === 'down' && (
              <div style={{ marginTop: 6 }}>
                · <strong>sysinfo agent unreachable</strong> — check <code>systemctl status vergr-sysinfo</code> on the box
                and the nginx <code>/sysinfo</code> reverse-proxy rule.
              </div>
            )}
          </div>
        </>
      )}
    </>
  );
}

function SectionHeader({ title, sub, status }) {
  const map = {
    healthy:  { bg: '#22c55e20', fg: '#22c55e', label: 'HEALTHY' },
    degraded: { bg: '#f0a50020', fg: '#f0a500', label: 'DEGRADED' },
    down:     { bg: '#f0406020', fg: '#f04060', label: 'DOWN' },
    unwired:  { bg: '#5a5a8520', fg: C.textDim, label: 'UNWIRED' },
    info:     null,
  };
  const m = status && map[status];
  return (
    <div style={{
      display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between',
      gap: 12, marginBottom: 8, marginTop: 4,
    }}>
      <div>
        <h3 style={{ margin: 0, fontSize: 13, fontWeight: 700, color: C.text, letterSpacing: '0.02em' }}>
          {title}
        </h3>
        {sub && <div style={{ fontSize: 11, color: C.textMuted, marginTop: 2 }}>{sub}</div>}
      </div>
      {m && (
        <span style={{
          fontSize: 10, fontWeight: 700, padding: '3px 8px', borderRadius: 999,
          background: m.bg, color: m.fg,
        }}>{m.label}</span>
      )}
    </div>
  );
}

function PctTile({ icon, color, label, value, unwired, sub }) {
  if (unwired || value == null) {
    return <KpiCard icon={icon} color={color} label={label} value="unwired" />;
  }
  const v = Math.max(0, Math.min(100, value));
  const tint = v > 85 ? '#f04060' : v > 70 ? '#f0a500' : color;
  return (
    <div style={{
      padding: 14, background: C.card, border: `1px solid ${C.border}`, borderRadius: 12,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
        <div style={{
          width: 32, height: 32, borderRadius: 8,
          background: `${tint}20`, border: `1px solid ${tint}30`, color: tint,
          display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
        }}>
          <Icon name={icon} size={17} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 11, color: C.textDim }}>{label}</div>
          <div style={{ fontSize: 22, fontWeight: 800, color: tint, lineHeight: 1.1, marginTop: 2 }}
            className="font-dmmono tabular-nums">
            {v.toFixed(1)}%
          </div>
        </div>
      </div>
      <div style={{ height: 6, background: '#0a0a14', borderRadius: 3, overflow: 'hidden' }}>
        <div style={{ width: `${v}%`, height: '100%', background: tint, transition: 'width .3s' }} />
      </div>
      {sub && <div style={{ fontSize: 10, color: C.textMuted, marginTop: 6 }}>{sub}</div>}
    </div>
  );
}

function SmallStat({ label, value }) {
  return (
    <div style={{
      padding: '12px 14px', background: C.card, border: `1px solid ${C.border}`,
      borderRadius: 10,
    }}>
      <div style={{ fontSize: 10, color: C.textDim, marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
        {label}
      </div>
      <div style={{ fontSize: 18, fontWeight: 700, color: C.text }} className="font-dmmono tabular-nums">
        {value}
      </div>
    </div>
  );
}

function fmtUptime(seconds) {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function SystemRow({ name, status, note }) {
  const map = {
    healthy:   { fg: '#22c55e', bg: '#22c55e20', label: 'HEALTHY' },
    degraded:  { fg: '#f0a500', bg: '#f0a50020', label: 'DEGRADED' },
    down:      { fg: '#f04060', bg: '#f0406020', label: 'DOWN' },
    unwired:   { fg: C.textDim, bg: '#5a5a8520', label: 'UNWIRED' },
  };
  const m = map[status] || map.unwired;
  return (
    <div style={{
      display: 'grid', gridTemplateColumns: '1fr auto auto',
      gap: 12, padding: '12px 0', borderBottom: `1px dashed ${C.border}`,
      alignItems: 'center',
    }}>
      <div style={{ fontSize: 13, fontWeight: 600, color: C.text }}>{name}</div>
      <div style={{ fontSize: 11, color: C.textMuted, textAlign: 'right' }}>{note}</div>
      <span style={{
        fontSize: 10, fontWeight: 700, padding: '3px 8px', borderRadius: 999,
        background: m.bg, color: m.fg,
      }}>{m.label}</span>
    </div>
  );
}

// ───────────────────────────────────────────────────────────
// GEOGRAPHY
// ───────────────────────────────────────────────────────────

function GeographyTab({ autoRefresh }) {
  const [data, setData] = useState(null);

  const load = useCallback(async () => {
    try { setData(await call('adminGetGeographyStats')); } catch {}
  }, []);
  usePolling(load, 60_000, autoRefresh);

  if (!data) return <Empty label="Loading…" />;
  const top = data.countries[0];
  return (
    <>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginBottom: 16 }}>
        <KpiCard icon="public" color="#7c3aed" label="Countries Active"
          value={fmtNumber(data.countries.length)} />
        <KpiCard icon="people" color="#3b82f6" label="Sampled Users"
          value={fmtNumber(data.totalSampled)} sub="last 24h" />
        <KpiCard icon="star" color="#f0a500" label="Top Country"
          value={top?.country || '—'} sub={top ? `${fmtNumber(top.active)} active` : null} />
      </div>

      <Card title="Top Countries by Active Users">
        {data.countries.length === 0 && (
          <Empty label="No country data available. (Set users.lastSeenCountry on auth to populate.)" />
        )}
        {data.countries.map(c => (
          <div key={c.country} style={{
            display: 'grid', gridTemplateColumns: '2fr 1fr 100px',
            padding: '10px 0', borderBottom: `1px dashed ${C.border}`,
            alignItems: 'center', fontSize: 12, color: C.text, gap: 12,
          }}>
            <div style={{ fontWeight: 600 }}>{c.country}</div>
            <div className="font-dmmono tabular-nums" style={{ color: C.textDim }}>
              {fmtNumber(c.active)} active
            </div>
            <div>
              <div style={{ height: 6, background: '#0a0a14', borderRadius: 3, overflow: 'hidden' }}>
                <div style={{
                  width: `${Math.min(100, c.pct)}%`, height: '100%',
                  background: `linear-gradient(90deg, ${C.accent2}, ${C.accent})`,
                }} />
              </div>
              <div style={{ fontSize: 9, color: C.textMuted, marginTop: 2, textAlign: 'right' }}
                className="font-dmmono tabular-nums">{c.pct.toFixed(1)}%</div>
            </div>
          </div>
        ))}
      </Card>

      <div style={{ height: 14 }} />
      <div style={{
        padding: 14, background: '#0a0a1480', border: `1px solid ${C.border}`,
        borderRadius: 12, fontSize: 12, color: C.textDim, lineHeight: 1.6,
      }}>
        World-map view (Leaflet / react-simple-maps) lands in a follow-up build. The mockup
        shows it; deferred to keep bundle size down until country coverage justifies it.
      </div>
    </>
  );
}

// ───────────────────────────────────────────────────────────
// Small primitives
// ───────────────────────────────────────────────────────────

// ───────────────────────────────────────────────────────────
// EVENT LOAD — ticketed-event committed concurrent-viewer load
// ───────────────────────────────────────────────────────────
function EventLoadTab({ autoRefresh }) {
  const { showToast } = useUI();
  const [data, setData] = useState(null);
  const [loadingFirst, setLoadingFirst] = useState(true);

  const load = useCallback(async () => {
    try { setData(await call('adminGetEventLoad')); }
    catch (e) { if (loadingFirst) showToast(e?.message || 'Failed to load event load', 'error'); }
    setLoadingFirst(false);
  }, [showToast, loadingFirst]);

  usePolling(load, 15_000, autoRefresh);
  const ev = data;

  return (
    <>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginBottom: 16 }}>
        <KpiCard icon="confirmation_number" color="#B44FFF" label="Tickets Sold"
          value={loadingFirst ? '—' : fmtNumber(ev?.ticketsSold)} />
        <KpiCard icon="event_seat" color="#b44fff" label="Capacity Committed"
          value={loadingFirst ? '—' : fmtNumber(ev?.capacityCommitted)} sub={`${ev?.eventCount || 0} open events`} />
        <KpiCard icon="percent" color="#f0a500" label="Commitment"
          value={loadingFirst ? '—' : `${ev?.commitmentUtilization || 0}%`} sub="sold of committed" />
        <KpiCard icon="dns" color="#3b82f6" label="Server Headroom"
          value={loadingFirst ? '—' : (ev?.headroom == null ? '—' : fmtNumber(ev.headroom))}
          sub={ev?.serverCapacity ? `cap ${fmtNumber(ev.serverCapacity)}` : 'set streamServerCapacity'} />
      </div>

      <Card title="Largest upcoming / active ticketed events">
        {!ev?.largest?.length ? (
          <Empty label={loadingFirst ? 'Loading…' : 'No open ticketed events.'} />
        ) : (
          <div>
            <div style={{ display: 'grid', gridTemplateColumns: '2fr 0.8fr 1.2fr 1fr 0.6fr', gap: 8, padding: '6px 8px', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.08em', color: C.textMuted }}>
              <span>Event</span><span>Status</span><span>Start</span><span>Sold / Cap</span><span style={{ textAlign: 'right' }}>Util</span>
            </div>
            {ev.largest.map((e) => (
              <div key={e.id} style={{ display: 'grid', gridTemplateColumns: '2fr 0.8fr 1.2fr 1fr 0.6fr', gap: 8, padding: '8px', alignItems: 'center', borderTop: `1px solid ${C.border}`, fontSize: 12, color: C.text }}>
                <span style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.name}</span>
                <span style={{ color: e.status === 'active' ? '#f04060' : C.textDim, fontSize: 11, fontWeight: 700 }}>{e.status === 'active' ? 'LIVE' : 'Open'}</span>
                <span style={{ color: C.textDim, fontSize: 11 }}>{e.scheduledStart ? fmtRelative(e.scheduledStart) : '—'}</span>
                <span className="font-dmmono tabular-nums" style={{ color: C.textDim }}>{fmtNumber(e.sold)} / {fmtNumber(e.capacity)}</span>
                <span className="font-dmmono tabular-nums" style={{ textAlign: 'right', color: e.utilization >= 80 ? '#f0a500' : C.text }}>{e.utilization}%</span>
              </div>
            ))}
          </div>
        )}
      </Card>
    </>
  );
}

function Card({ title, children }) {
  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 16 }}>
      <h3 style={{ margin: 0, marginBottom: 12, fontSize: 13, fontWeight: 700, color: C.text }}>{title}</h3>
      {children}
    </div>
  );
}

function Empty({ label }) {
  return <div style={{ padding: 24, textAlign: 'center', color: C.textDim, fontSize: 12 }}>{label}</div>;
}

// Live now: every stream on air, with Watch (opens it on vergr.app) and End
// stream. Ending someone else's stream goes through endStreamSession with
// `takedown: true` (functions/streamTakedown.js): it asks for a reason the host
// is shown, needs a fresh authenticator code, and actually stops the broadcast
// on the ingest servers. The list is fetched only while this card is open.
function LiveNowCard({ count, open, onToggle, rows, onEnded }) {
  const { showToast } = useUI();
  const { guarded, overlay } = useGuardedCall();
  const [ending, setEnding] = useState(null); // stream being ended
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  const confirmEnd = async () => {
    if (!ending || reason.trim().length < 4 || busy) return;
    setBusy(true);
    try {
      const r = await guarded(() => call('endStreamSession', { streamId: ending.id, takedown: true, reason: reason.trim() }));
      showToast(r?.alreadyEnded ? 'That stream had already ended.' : 'Stream ended. The host has been told why.', 'success');
      setEnding(null);
      setReason('');
      onEnded?.();
    } catch { /* guarded already showed the error */ }
    setBusy(false);
  };

  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 16, marginBottom: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <h3 style={{ margin: 0, fontSize: 13, fontWeight: 700, color: C.text, flex: 1 }}>
          Live now {count > 0 ? `(${fmtNumber(count)})` : ''}
        </h3>
        <button type="button" onClick={onToggle} style={{
          padding: '6px 12px', borderRadius: 8, border: 0, background: '#2a2a3e', color: C.text,
          fontSize: 12, fontWeight: 600, cursor: 'pointer',
        }}>{open ? 'Hide' : 'Show streams'}</button>
      </div>
      {open && (
        <div style={{ marginTop: 12 }}>
          {!rows && <Empty label="Loading…" />}
          {rows && rows.length === 0 && <Empty label="Nothing is live right now." />}
          {rows && rows.map((s) => (
            <div key={s.id} style={{
              display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 90px 110px auto', gap: 12, alignItems: 'center',
              padding: '10px 12px', background: '#0a0a14', borderRadius: 8, marginBottom: 6,
            }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: C.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {s.title || 'Untitled stream'}
                </div>
                <div style={{ fontSize: 11, color: C.textMuted }}>
                  @{s.hostUsername || (s.hostUid || '').slice(0, 8)} · {s.ingestType === 'browser' ? 'browser' : 'OBS'}
                </div>
              </div>
              <div className="font-dmmono tabular-nums" style={{ fontSize: 12, color: C.textDim }}>{fmtNumber(s.viewerCount)} watching</div>
              <div style={{ fontSize: 11, color: C.textMuted }}>{s.startedAt ? `since ${fmtRelative(s.startedAt)}` : ''}</div>
              <div style={{ display: 'flex', gap: 6 }}>
                <button type="button" onClick={() => openInVergr(`/watch/${s.id}`)} style={{
                  padding: '6px 10px', borderRadius: 8, border: 0, background: '#2a2a3e', color: C.text, fontSize: 12, fontWeight: 600, cursor: 'pointer',
                }}>Watch</button>
                <button type="button" onClick={() => { setEnding(s); setReason(''); }} style={{
                  padding: '6px 10px', borderRadius: 8, border: 0, background: '#f04060', color: '#fff', fontSize: 12, fontWeight: 700, cursor: 'pointer',
                }}>End stream</button>
              </div>
            </div>
          ))}
        </div>
      )}
      {ending && (
        <div onClick={() => !busy && setEnding(null)} style={{ position: 'fixed', inset: 0, zIndex: 300, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ width: '100%', maxWidth: 440, background: C.card, borderRadius: 12, padding: 20 }}>
            <div style={{ fontSize: 15, fontWeight: 800, color: C.text, marginBottom: 6 }}>End "{ending.title || 'this stream'}"?</div>
            <div style={{ fontSize: 12, color: C.textDim, lineHeight: 1.55, marginBottom: 12 }}>
              The broadcast stops for everyone and the host is shown the reason below, with a way to appeal.
            </div>
            <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} maxLength={300}
              placeholder="Reason the host will see, e.g. Nudity on stream"
              style={{ width: '100%', boxSizing: 'border-box', background: '#0a0a14', border: 0, borderRadius: 8, padding: 10, color: C.text, fontSize: 13, resize: 'vertical' }} />
            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
              <button type="button" disabled={busy} onClick={() => setEnding(null)} style={{
                flex: 1, padding: 10, borderRadius: 8, border: 0, background: '#2a2a3e', color: C.text, fontWeight: 600, cursor: 'pointer',
              }}>Cancel</button>
              <button type="button" disabled={busy || reason.trim().length < 4} onClick={confirmEnd} style={{
                flex: 1, padding: 10, borderRadius: 8, border: 0,
                background: reason.trim().length < 4 ? '#3a2a30' : '#f04060', color: '#fff', fontWeight: 700,
                cursor: reason.trim().length < 4 ? 'not-allowed' : 'pointer',
              }}>{busy ? 'Ending…' : 'End stream'}</button>
            </div>
          </div>
        </div>
      )}
      {overlay}
    </div>
  );
}

function ActiveChart({ points }) {
  if (!points || points.length === 0) return <Empty label="No data." />;
  const W = 700, H = 200, P = 24;
  const maxV = Math.max(1, ...points.map(p => p.active));
  const stepX = points.length > 1 ? (W - 2 * P) / (points.length - 1) : 0;
  const y = (v) => H - P - ((v / maxV) * (H - 2 * P));
  const d = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${P + i * stepX} ${y(p.active)}`).join(' ');
  const fill = `${d} L ${P + (points.length - 1) * stepX} ${H - P} L ${P} ${H - P} Z`;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ width: '100%', height: 220 }}>
      <defs>
        <linearGradient id="grad-active" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"   stopColor="#7c3aed" stopOpacity="0.4" />
          <stop offset="100%" stopColor="#7c3aed" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={fill} fill="url(#grad-active)" />
      <path d={d}    fill="none" stroke="#7c3aed" strokeWidth="2.5" />
    </svg>
  );
}

// ─── COSTS — "what is Vergr costing right now" (11-doc 1.3) ──────────────────
// Reads the cached admin_stats/cost_snapshot via adminGetCostSnapshot (no cron;
// refetches external APIs only when the cache is >6h old or Refresh is hit).
function CostsTab() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const load = useCallback(async (force = false) => {
    setLoading(true);
    try { setData(await call('adminGetCostSnapshot', force ? { force: true } : {})); } catch {}
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  const hz = data?.hetzner || {};
  const cf = data?.cloudflare || {};
  const gcp = data?.gcp || {};
  const history = data?.history || [];

  const StatusPill = ({ status }) => {
    const map = {
      healthy: { c: '#22c55e', label: 'LIVE' },
      unwired: { c: C.textDim, label: 'NOT CONNECTED' },
      manual:  { c: '#F5C842', label: 'MANUAL' },
      // Counted from real resource inventory at list prices — accurate, but
      // still not a fetched bill. The pill must not imply it is one.
      estimate: { c: '#3D7FFF', label: 'ESTIMATE' },
      down:    { c: '#F04060', label: 'ERROR' },
    };
    const m = map[status] || map.down;
    return (
      <span style={{ padding: '2px 8px', borderRadius: 999, border: `1px solid ${m.c}55`, color: m.c, fontSize: 9.5, fontWeight: 800, letterSpacing: '.1em' }}>
        {m.label}
      </span>
    );
  };
  const Card = ({ title, status, children }) => (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <span style={{ fontSize: 13, fontWeight: 800, color: C.text }}>{title}</span>
        <StatusPill status={status} />
      </div>
      {children}
    </div>
  );
  const Row = ({ label, value }) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: `1px solid ${C.border}` }}>
      <span style={{ fontSize: 12, color: C.textDim }}>{label}</span>
      <span style={{ fontSize: 12, color: C.text, fontWeight: 700 }} className="tabular-nums">{value}</span>
    </div>
  );

  if (loading && !data) {
    return <div style={{ padding: 40, textAlign: 'center', color: C.textDim, fontSize: 13 }}>Loading cost snapshot…</div>;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        {/* Accrued-so-far, not the list rate — this is the figure the Hetzner
            console shows, so it can be trusted without logging in to check. */}
        <KpiCard
          label="Hetzner this month"
          value={hz.status === 'healthy' ? `€${(hz.accruedEur ?? 0).toFixed(2)}` : '—'}
          sub={hz.status === 'healthy' ? `→ €${(hz.projectedEur ?? 0).toFixed(2)} projected` : undefined}
          icon="dns"
        />
        {/* A total is only shown when BOTH halves (subscriptions + metered R2)
            resolved. Subscriptions alone would render a confident "$0.00"
            while R2 storage accrued — reassurance that isn't true. */}
        <KpiCard
          label="Cloudflare / month"
          value={cf.status === 'healthy' && !cf.incomplete ? `$${(cf.monthlyUsd ?? 0).toFixed(2)}` : '—'}
          icon="cloud"
        />
        <KpiCard
          label="GCP / month"
          value={gcp.status === 'estimate' ? `~$${(gcp.monthlyUsd ?? 0).toFixed(2)}` : '—'}
          sub={gcp.status === 'estimate' ? 'counted estimate' : undefined}
          icon="cloud_queue"
        />
        <div style={{ flex: 1 }} />
        <button onClick={() => load(true)} disabled={loading}
          style={{ padding: '8px 14px', background: 'transparent', border: `1px solid ${C.border}`, borderRadius: 8, color: C.textDim, cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>
          {loading ? 'Refreshing…' : 'Refresh now'}
        </button>
      </div>
      {data?.asOf && (
        <div style={{ fontSize: 10.5, color: C.textDim }}>
          Snapshot {fmtRelative(data.asOf)}{data.cached ? ' (cached — auto-refetches when >6h old)' : ''}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 14 }}>
        <Card title="Hetzner Cloud" status={hz.status}>
          {hz.status === 'healthy' ? (
            <>
              <div style={{ fontSize: 10.5, color: C.textDim, marginBottom: 8 }}>
                Billing month from {hz.monthStart} · {hz.pctOfMonthElapsed}% elapsed · billed hourly, capped at the monthly rate
              </div>
              {(hz.servers || []).map(s => (
                <Row key={s.name}
                  label={`${s.name} (${[s.type, s.location, s.status].filter(Boolean).join(' · ')})${s.priceRegionGuessed ? ' — region price assumed' : ''}`}
                  value={`€${s.accruedEur.toFixed(2)} / €${s.monthlyEur.toFixed(2)}`} />
              ))}
              {hz.primaryIps?.count > 0 && (
                <Row label={`Primary IPv4 × ${hz.primaryIps.count}${hz.primaryIps.unassigned > 0 ? ` (${hz.primaryIps.unassigned} unassigned — pure waste!)` : ''}`}
                  value={`€${hz.primaryIps.accruedEur.toFixed(2)} / €${hz.primaryIps.projectedEur.toFixed(2)}`} />
              )}
              {hz.volumes?.count > 0 && <Row label={`Volumes (${hz.volumes.count} · ${hz.volumes.gb} GB)`} value={`€${hz.volumes.monthlyEur.toFixed(2)}`} />}
              {hz.snapshots?.count > 0 && <Row label={`Snapshots (${hz.snapshots.count} · ${hz.snapshots.gb} GB)`} value={`€${hz.snapshots.monthlyEur.toFixed(2)}`} />}
              {(hz.servers || []).some(s => s.traffic?.overageEur > 0) && (hz.servers || []).map(s => (
                s.traffic?.overageEur > 0
                  ? <Row key={`t-${s.name}`} label={`${s.name} traffic overage (${s.traffic.outTb} TB of ${s.traffic.includedTb} TB)`} value={`€${s.traffic.overageEur.toFixed(2)}`} />
                  : null
              ))}

              <div style={{ display: 'flex', justifyContent: 'space-between', paddingTop: 8 }}>
                <span style={{ fontSize: 12.5, color: C.text, fontWeight: 800 }}>Accrued so far</span>
                <span style={{ fontSize: 12.5, color: '#7c3aed', fontWeight: 800 }} className="tabular-nums">€{(hz.accruedEur ?? 0).toFixed(2)}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', paddingTop: 4 }}>
                <span style={{ fontSize: 11.5, color: C.textDim }}>Projected at month end</span>
                <span style={{ fontSize: 11.5, color: C.textDim }} className="tabular-nums">€{(hz.projectedEur ?? 0).toFixed(2)}</span>
              </div>
              <p style={{ margin: '10px 0 0', fontSize: 10.5, color: C.textDim, lineHeight: 1.5 }}>
                Rows read <em>accrued / full-month</em>. Prices are gross (incl. {(hz.vatRate ?? 0).toFixed(0)}% VAT, the rate Hetzner
                reports for this account). Everything bills while it EXISTS — powering a server off does not stop the meter —
                and primary IPv4s bill separately from the server, attached or not.
              </p>
            </>
          ) : (
            <p style={{ margin: 0, fontSize: 12, color: C.textDim }}>{hz.error || 'HETZNER_API_TOKEN not set.'}</p>
          )}
        </Card>

        <Card title="Cloudflare" status={cf.status}>
          {cf.status === 'healthy' ? (
            <>
              {(cf.subscriptions || []).map((s, i) => (
                <Row key={i} label={`${s.product} (plan base)`} value={s.monthly != null ? `${s.currency === 'USD' ? '$' : ''}${Number(s.monthly).toFixed(2)}` : '—'} />
              ))}
              {(cf.subscriptions || []).length === 0 && <Row label="Subscriptions" value="none — free plan" />}

              {/* R2 storage is the ONLY Cloudflare line that can actually grow
                  a bill for us (egress is $0). It's metered, so it never shows
                  up in `subscriptions`. */}
              {cf.r2?.status === 'healthy' ? (
                <>
                  <Row label={`R2 storage — ${cf.r2.storedGb} GB of ${cf.r2.freeGb} GB free`}
                    value={cf.r2.billableGb > 0 ? `$${cf.r2.monthlyUsd.toFixed(2)}` : '$0.00'} />
                  <div style={{ margin: '8px 0 10px' }}>
                    <div style={{ height: 6, borderRadius: 999, background: C.border, overflow: 'hidden' }}>
                      <div style={{
                        width: `${Math.min(100, cf.r2.pctOfFree)}%`,
                        height: '100%',
                        background: cf.r2.pctOfFree >= 100 ? '#F04060' : cf.r2.pctOfFree >= 75 ? '#F5C842' : '#22c55e',
                      }} />
                    </div>
                    <div style={{ fontSize: 10.5, color: cf.r2.pctOfFree >= 75 ? '#F5C842' : C.textDim, marginTop: 5 }}>
                      {cf.r2.pctOfFree}% of the free tier used
                      {cf.r2.billableGb > 0 && ` · ${cf.r2.billableGb} GB billable`}
                      {cf.r2.asOf && ` · as of ${cf.r2.asOf}`}
                    </div>
                  </div>
                  {(cf.r2.buckets || []).map((b) => (
                    <Row key={b.name} label={`  ${b.name} (${fmtNumber(b.objects)} objects)`} value={`${b.gb} GB`} />
                  ))}
                  <div style={{ display: 'flex', justifyContent: 'space-between', paddingTop: 8 }}>
                    <span style={{ fontSize: 12.5, color: C.text, fontWeight: 800 }}>Total</span>
                    <span style={{ fontSize: 12.5, color: '#7c3aed', fontWeight: 800 }} className="tabular-nums">${(cf.monthlyUsd ?? 0).toFixed(2)}/mo</span>
                  </div>
                  <p style={{ margin: '10px 0 0', fontSize: 10.5, color: C.textDim }}>
                    Egress is $0 on R2 — stored GB past the free tier is the only thing that bills.
                  </p>
                </>
              ) : (
                <p style={{ margin: '10px 0 0', fontSize: 11, color: '#F5C842', lineHeight: 1.5 }}>
                  <strong>Total hidden — R2 usage unreadable.</strong> Subscriptions only report a plan's base
                  price, and R2 Paid's base is $0 while it bills on stored GB, so a total without R2 would
                  read $0.00 whether or not you're paying. {cf.r2?.status === 'unwired'
                    ? 'Add `Account Analytics: Read` to the vergr-cost-dashboard token (edit it — the token value is unchanged, no secret update needed).'
                    : `R2 read failed: ${cf.r2?.error || 'unknown'}`}
                </p>
              )}
            </>
          ) : (
            <p style={{ margin: 0, fontSize: 12, color: C.textDim }}>
              {cf.note || cf.error || 'Not connected.'}
            </p>
          )}
        </Card>

        <Card title="Google Cloud (Firebase)" status={gcp.status}>
          {gcp.status === 'estimate' ? (
            <>
              <Row label={`Secret Manager (${gcp.secrets?.count} secrets · ${gcp.secrets?.versions} active versions)`}
                value={`$${(gcp.secrets?.monthlyUsd ?? 0).toFixed(2)}`} />
              {gcp.scheduler?.error
                ? <Row label="Cloud Scheduler" value="denied" />
                : <Row label={`Cloud Scheduler (${gcp.scheduler?.count} jobs · ${gcp.scheduler?.billable} billable, 3 free)`}
                    value={`$${(gcp.scheduler?.monthlyUsd ?? 0).toFixed(2)}`} />}
              <div style={{ display: 'flex', justifyContent: 'space-between', paddingTop: 8 }}>
                <span style={{ fontSize: 12.5, color: C.text, fontWeight: 800 }}>Estimated</span>
                <span style={{ fontSize: 12.5, color: '#7c3aed', fontWeight: 800 }} className="tabular-nums">${(gcp.monthlyUsd ?? 0).toFixed(2)}/mo</span>
              </div>

              {/* Superseded secret versions are the classic silent GCP waste
                  here. ENABLED and DISABLED both bill (Google's own definition
                  of "active"); only DESTROYED is free, so disabling one to
                  "stop paying" does nothing. */}
              {gcp.secrets?.wastedVersions > 0 && (
                <div style={{ marginTop: 10, padding: 10, background: '#2a2008', borderRadius: 8 }}>
                  <div style={{ fontSize: 11, color: '#F5C842', fontWeight: 700, marginBottom: 4 }}>
                    {gcp.secrets.wastedVersions} older versions still billing, ${gcp.secrets.wastedUsd.toFixed(2)}/mo
                  </div>
                  <div style={{ fontSize: 10.5, color: C.textDim, lineHeight: 1.5 }}>
                    Enabled and disabled versions both bill; only destroyed ones are free.
                    Most: {(gcp.secrets.worst || []).map(s => `${s.name} (${s.versions})`).join(', ')}.
                    Destroy an old version only after checking no deployed function still pins it.
                  </div>
                </div>
              )}
              <p style={{ margin: '10px 0 0', fontSize: 10.5, color: C.textDim, lineHeight: 1.5 }}>{gcp.note}</p>
            </>
          ) : (
            <p style={{ margin: 0, fontSize: 12, color: C.textDim, lineHeight: 1.5 }}>{gcp.note || gcp.error || 'Unavailable.'}</p>
          )}
        </Card>
      </div>

      {/* The point of a cost trend is CHANGE — the day the rate moves because
          something got provisioned. Bars scaled against max make a flat rate
          render as N identical full-height bars, which looks broken and says
          nothing. So: state the flat case in words, and only draw bars when
          the values actually differ (scaled to the min..max window, since a
          zero-baseline would flatten a €47->€53 jump into invisibility). */}
      <HetznerTrend history={history} />
    </div>
  );
}

// Cost-trend strip. Deliberately refuses to draw a chart that can't say
// anything: <2 points = still collecting, all-equal = a sentence, not bars.
function HetznerTrend({ history }) {
  const pts = (history || []).filter((h) => typeof h.hetznerMonthlyEur === 'number');
  if (!pts.length) return null;

  const vals = pts.map((p) => p.hetznerMonthlyEur);
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const flat = max - min < 0.01;
  const latest = vals[vals.length - 1];
  const wrap = (children) => (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 16 }}>
      <div style={{ fontSize: 12, fontWeight: 800, color: C.text, marginBottom: 10 }}>Hetzner monthly-rate trend</div>
      {children}
    </div>
  );

  if (pts.length < 2) {
    return wrap(
      <p style={{ margin: 0, fontSize: 11.5, color: C.textDim }}>
        Collecting — one snapshot so far ({pts[0].day}, €{latest.toFixed(2)}). A trend needs a few days of history;
        one point is recorded each day the Costs tab is opened.
      </p>
    );
  }
  if (flat) {
    return wrap(
      <p style={{ margin: 0, fontSize: 11.5, color: C.textDim }}>
        <span style={{ color: '#22c55e', fontWeight: 700 }}>Flat at €{latest.toFixed(2)}/mo</span> across all{' '}
        {pts.length} recorded days ({pts[0].day} → {pts[pts.length - 1].day}). Bars appear here the day the rate
        moves — i.e. when something gets provisioned.
      </p>
    );
  }

  // Values differ: scale to the min..max window with headroom so a small
  // delta is still legible, and mark the changes.
  const lo = min - (max - min) * 0.25;
  const span = max - lo;
  return wrap(
    <>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 3, height: 60 }}>
        {pts.map((h, i) => {
          const up = i > 0 && h.hetznerMonthlyEur > pts[i - 1].hetznerMonthlyEur + 0.01;
          return (
            <div key={h.day} title={`${h.day}: €${h.hetznerMonthlyEur.toFixed(2)}`}
              style={{
                flex: 1, maxWidth: 44,
                height: `${Math.max(6, ((h.hetznerMonthlyEur - lo) / span) * 100)}%`,
                background: up ? '#F04060' : '#7c3aed', borderRadius: 2, opacity: 0.85,
              }} />
          );
        })}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6, fontSize: 10, color: C.textDim }}>
        <span>{pts[0].day} · €{vals[0].toFixed(2)}</span>
        <span style={{ color: latest > vals[0] ? '#F04060' : '#22c55e', fontWeight: 700 }}>
          {latest > vals[0] ? '▲' : '▼'} €{Math.abs(latest - vals[0]).toFixed(2)}/mo since then
        </span>
        <span>{pts[pts.length - 1].day} · €{latest.toFixed(2)}</span>
      </div>
    </>
  );
}

// ─── USERS — recently active + newest signups + tier counts ─────────────────
function UsersLiveTab({ autoRefresh }) {
  const [data, setData] = useState(null);
  const load = useCallback(async () => {
    try { setData(await call('adminGetUsersLive')); } catch {}
  }, []);
  usePolling(load, 30_000, autoRefresh);

  const UserRow = ({ u, timeField }) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 0', borderBottom: `1px dashed ${C.border}` }}>
      {u.avatar
        ? <img src={u.avatar} alt="" style={{ width: 28, height: 28, borderRadius: '50%', objectFit: 'cover' }} />
        : <span style={{ width: 28, height: 28, borderRadius: '50%', background: '#7c3aed33', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 800, color: '#b44fff' }}>{(u.displayName || '?')[0].toUpperCase()}</span>}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12, color: C.text, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {u.displayName}{u.username ? <span style={{ color: C.textDim, fontWeight: 400 }}> @{u.username}</span> : null}
        </div>
        <div style={{ fontSize: 10, color: C.textMuted }}>
          {[u.tier !== 'free' ? u.tier.toUpperCase() : null, u.accountType?.includes('bot') ? 'BOT' : null, u.country, u.device].filter(Boolean).join(' · ') || '—'}
        </div>
      </div>
      <span style={{ fontSize: 10, color: C.textDim }} className="tabular-nums">{fmtRelative(u[timeField])}</span>
    </div>
  );

  if (!data) return <div style={{ padding: 40, textAlign: 'center', color: C.textDim, fontSize: 13 }}>Loading users…</div>;
  return (
    <>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12, marginBottom: 16 }}>
        <KpiCard icon="workspace_premium" color="#f0a500" label="Lite subs" value={fmtNumber(data.tiers?.lite)} />
        <KpiCard icon="star" color="#b44fff" label="Pro subs" value={fmtNumber(data.tiers?.pro)} />
        <KpiCard icon="person_off" color="#6b7280" label="Guest accounts" value={fmtNumber(data.tiers?.guests)} />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 14 }}>
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 16 }}>
          <div style={{ fontSize: 12.5, fontWeight: 800, color: C.text, marginBottom: 8 }}>Recently active</div>
          {(data.active || []).map(u => <UserRow key={u.uid} u={u} timeField="lastSeen" />)}
          {(data.active || []).length === 0 && <div style={{ fontSize: 12, color: C.textDim }}>No activity yet.</div>}
        </div>
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 16 }}>
          <div style={{ fontSize: 12.5, fontWeight: 800, color: C.text, marginBottom: 8 }}>Newest signups</div>
          {(data.newest || []).map(u => <UserRow key={u.uid} u={u} timeField="createdAt" />)}
          {(data.newest || []).length === 0 && <div style={{ fontSize: 12, color: C.textDim }}>No signups yet.</div>}
        </div>
      </div>
    </>
  );
}

// ─── ENGAGEMENT — content-creation counters + daily trend ───────────────────
function EngagementTab({ autoRefresh }) {
  const [data, setData] = useState(null);
  const load = useCallback(async () => {
    try { setData(await call('adminGetEngagementStats')); } catch {}
  }, []);
  usePolling(load, 30_000, autoRefresh);

  if (!data) return <div style={{ padding: 40, textAlign: 'center', color: C.textDim, fontSize: 13 }}>Loading engagement…</div>;
  const daily = data.daily || [];
  const maxSignups = Math.max(...daily.map(d => d.signups), 1);
  return (
    <>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12, marginBottom: 16 }}>
        <KpiCard icon="post_add" color="#7c3aed" label="Posts (24h)" value={fmtNumber(data.posts24h)} sub={`${fmtNumber(data.posts7d)} this week`} />
        <KpiCard icon="live_tv" color="#f04060" label="Streams (24h)" value={fmtNumber(data.streams24h)} sub={`${fmtNumber(data.streams7d)} this week`} />
        <KpiCard icon="confirmation_number" color="#f0a500" label="Events (7d)" value={fmtNumber(data.tournaments7d)} />
        <KpiCard icon="paid" color="#22c55e" label="Tips (24h)" value={fmtNumber(data.tips24h)} />
        <KpiCard icon="flag" color="#f04060" label="Reports pending" value={fmtNumber(data.reportsPending)} />
      </div>
      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 16 }}>
        <div style={{ fontSize: 12.5, fontWeight: 800, color: C.text, marginBottom: 10 }}>Daily signups (last {daily.length} rolled-up days). Gold = a day with a new paid plan.</div>
        {daily.length === 0 ? (
          <div style={{ fontSize: 12, color: C.textDim }}>No daily_metrics rollups yet — the nightly cron populates this.</div>
        ) : (
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 4, height: 90 }}>
            {daily.map(d => (
              <div key={d.date} title={`${d.date}: ${d.signups} signups · ${d.newPaid} new paid`}
                style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', height: '100%' }}>
                <div style={{ height: `${Math.max(4, (d.signups / maxSignups) * 100)}%`, background: d.newPaid > 0 ? '#f0a500' : '#7c3aed', borderRadius: 3, opacity: 0.85 }} />
                <div style={{ fontSize: 8, color: C.textMuted, textAlign: 'center', marginTop: 3 }}>{d.date.slice(5)}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}

// ─── TRANSACTIONS — live ledger tail (full paginator lives on Economy) ──────
// Revenue-share rows carry amountMicroUsd and currency 'usd' with no `amount`
// (gems were deleted 2026-08-16), so reading `amount` alone printed them as
// "0 usd". Money is shown as money; everything else stays a count of coins.
const txSigned = (t) => (t.currency === 'usd' && Number.isFinite(t.amountMicroUsd) ? t.amountMicroUsd : (t.amount || 0));
function txLabel(t) {
  const v = txSigned(t);
  const sign = v > 0 ? '+' : v < 0 ? '-' : '';
  if (t.currency === 'usd' && Number.isFinite(t.amountMicroUsd)) {
    return sign + '$' + (Math.abs(v) / 1e6).toFixed(Math.abs(v) < 10_000 ? 4 : 2);
  }
  return (v > 0 ? '+' : '') + fmtNumber(v) + ' ' + (t.currency || 'coins');
}

function TransactionsTab() {
  const [rows, setRows] = useState(null);
  const [users, setUsers] = useState({});
  useEffect(() => {
    let alive = true;
    call('adminListTransactions', { pageSize: 40 })
      .then(r => { if (alive) { setRows(r.rows || []); setUsers(r.users || {}); } })
      .catch(() => { if (alive) setRows([]); });
    return () => { alive = false; };
  }, []);

  if (!rows) return <div style={{ padding: 40, textAlign: 'center', color: C.textDim, fontSize: 13 }}>Loading ledger…</div>;
  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
        <span style={{ fontSize: 12.5, fontWeight: 800, color: C.text }}>Latest {rows.length} transactions</span>
        {/* A Link, not an <a href>: Vergr Admin is a MemoryRouter, so a plain href
            reloads the whole console instead of moving to the Economy screen. */}
        <Link to="/admin/economy" style={{ fontSize: 11, color: '#b44fff', fontWeight: 700 }}>Full ledger + filters → Economy</Link>
      </div>
      {rows.length === 0 && <div style={{ fontSize: 12, color: C.textDim }}>No transactions yet.</div>}
      {rows.map(t => (
        <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 0', borderBottom: `1px dashed ${C.border}` }}>
          <span style={{ padding: '2px 8px', borderRadius: 6, background: '#7c3aed22', color: '#b44fff', fontSize: 10, fontWeight: 700 }}>{t.type || '—'}</span>
          <span style={{ flex: 1, fontSize: 11.5, color: C.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {users[t.userId]?.displayName || (t.userId === '__platform__' ? 'Platform' : (t.userId || '').slice(0, 8))}
            {t.description ? <span style={{ color: C.textDim }}> · {t.description}</span> : null}
          </span>
          <span style={{ fontSize: 11.5, fontWeight: 800, color: txSigned(t) < 0 ? '#f04060' : '#22c55e' }} className="tabular-nums">
            {txLabel(t)}
          </span>
          <span style={{ fontSize: 10, color: C.textMuted, width: 62, textAlign: 'right' }} className="tabular-nums">{fmtRelative(t.createdAt)}</span>
        </div>
      ))}
    </div>
  );
}

// ─── ERRORS — client_errors intake (clientTelemetry.js, capped 5/session) ───
function ErrorsTab({ autoRefresh }) {
  const [data, setData] = useState(null);
  const [open, setOpen] = useState(null); // row id with expanded stack
  const load = useCallback(async () => {
    try { setData(await call('adminGetErrorLog')); } catch {}
  }, []);
  usePolling(load, 30_000, autoRefresh);

  if (!data) return <div style={{ padding: 40, textAlign: 'center', color: C.textDim, fontSize: 13 }}>Loading error log…</div>;
  return (
    <>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12, marginBottom: 16 }}>
        <KpiCard icon="error" color="#f04060" label="Errors (24h)" value={fmtNumber(data.count24h)} />
        <KpiCard icon="bug_report" color="#f0a500" label="Shown" value={fmtNumber((data.rows || []).length)} sub="latest 50" />
      </div>
      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 16 }}>
        {(data.rows || []).length === 0 && (
          <div style={{ fontSize: 12, color: C.textDim }}>
            No client errors captured. The intake (clientTelemetry) writes here when a user hits an uncaught exception — quiet is good.
          </div>
        )}
        {(data.rows || []).map(e => (
          <div key={e.id} style={{ padding: '8px 0', borderBottom: `1px dashed ${C.border}` }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: e.stack ? 'pointer' : 'default' }}
              onClick={() => e.stack && setOpen(open === e.id ? null : e.id)}>
              <span style={{ padding: '2px 7px', borderRadius: 6, background: '#f0406022', color: '#f04060', fontSize: 9.5, fontWeight: 800 }}>{e.kind}</span>
              <span style={{ flex: 1, fontSize: 11.5, color: C.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{e.message}</span>
              <span style={{ fontSize: 10, color: C.textMuted }} className="tabular-nums">{fmtRelative(e.ts)}</span>
            </div>
            <div style={{ fontSize: 10, color: C.textMuted, marginTop: 2 }}>
              {[e.route, e.version ? `v${e.version}` : null, e.uid ? `uid ${e.uid.slice(0, 8)}` : 'signed out'].filter(Boolean).join(' · ')}
            </div>
            {open === e.id && e.stack && (
              <pre style={{ margin: '6px 0 0', padding: 8, background: C.card2, border: `1px solid ${C.border}`, borderRadius: 6, fontSize: 9.5, color: C.textDim, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>{e.stack}</pre>
            )}
          </div>
        ))}
      </div>
    </>
  );
}
