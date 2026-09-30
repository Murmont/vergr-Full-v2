// AdminModerationAuditScreen — /admin/reports/audit
//
// Audit + reporting view on top of the live Moderation Queue. Five tabs:
//   Overview · Reports · Moderator Actions · Appeals · Settings
//
// Uses the 'moderation' screen scope (same as the live queue).

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useUI } from '../../context/UIContext';
import UserAvatar from '../../components/UserAvatar';
import AdminShell, { ADMIN_COLORS as C } from './AdminShell';
import {
  call, fmtNumber, fmtDate, fmtRelative,
  useGuardedCall, KpiCard, Tabs, downloadCsv,
} from './_adminGuarded';

const iso = (ms) => (ms ? new Date(ms).toISOString() : '');
const csvButtonStyle = {
  marginLeft: 'auto', padding: '8px 14px', borderRadius: 8, border: 0,
  background: '#2a2a3e', color: C.text, fontSize: 12, fontWeight: 600, cursor: 'pointer',
};
const REPORT_CSV_COLUMNS = [
  { label: 'Resolved at', get: (r) => iso(r.resolvedAt) },
  { label: 'Reported at', get: (r) => iso(r.createdAt) },
  { label: 'Target type', get: (r) => r.targetType },
  { label: 'Target id', get: (r) => r.targetId },
  { label: 'Reason', get: (r) => r.reason },
  { label: 'Priority', get: (r) => r.priority },
  { label: 'Status', get: (r) => r.status },
  { label: 'Moderator uid', get: (r) => r.resolvedBy },
  { label: 'Moderator', get: (r) => r.moderator?.displayName || r.moderator?.username || '' },
  { label: 'Resolution note', get: (r) => r.resolutionReason },
  { label: 'Appealed', get: (r) => (r.hasAppeal ? 'yes' : 'no') },
];

const TABS = [
  { id: 'overview',  label: 'Overview' },
  { id: 'reports',   label: 'Reports' },
  { id: 'actions',   label: 'Moderator Actions' },
  { id: 'appeals',   label: 'Appeals' },
  { id: 'settings',  label: 'Settings' },
];

export default function AdminModerationAuditScreen() {
  const [tab, setTab] = useState('overview');
  const { guarded, overlay } = useGuardedCall();
  const navigate = useNavigate();

  return (
    <AdminShell
      screen="moderation"
      title="Moderation Reports"
      subtitle="Audit past moderation activity, per-moderator stats, and appeals."
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <Tabs tabs={TABS} active={tab} onChange={setTab} />
        <button onClick={() => navigate('/admin/reports')} style={{
          padding: '8px 14px', borderRadius: 8, background: 'transparent',
          border: `1px solid ${C.border}`, color: C.textDim,
          fontSize: 12, fontWeight: 600, cursor: 'pointer',
        }}>← Back to queue</button>
      </div>

      {tab === 'overview' && <OverviewTab navigate={navigate} />}
      {tab === 'reports'  && <ReportsTab />}
      {tab === 'actions'  && <ActionsTab />}
      {tab === 'appeals'  && <AppealsTab guarded={guarded} />}
      {tab === 'settings' && <SettingsTab guarded={guarded} />}
      {overlay}
    </AdminShell>
  );
}

// ───────────────────────────────────────────────────────────
// OVERVIEW
// ───────────────────────────────────────────────────────────

function OverviewTab({ navigate }) {
  const { showToast } = useUI();
  const [stats, setStats] = useState(null);
  const [topMods, setTopMods] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [s, m] = await Promise.all([
        call('adminGetModerationStats'),
        call('adminGetModeratorStats', { sinceMs: Date.now() - 30 * 24 * 3600 * 1000 }),
      ]);
      setStats(s); setTopMods((m.rows || []).slice(0, 5));
    } catch (e) { showToast(e?.message || 'Failed to load', 'error'); }
    setLoading(false);
  }, [showToast]);
  useEffect(() => { load(); }, [load]);

  const total = topMods.reduce((s, r) => s + r.total, 0);
  const approved = topMods.reduce((s, r) => s + r.approved, 0);
  const rejected = topMods.reduce((s, r) => s + r.rejected, 0);
  const escalated = topMods.reduce((s, r) => s + r.escalated, 0);

  // Naive platform-wide score: weighted avg of top-5
  const avgScore = topMods.length > 0
    ? Math.round(topMods.reduce((s, r) => s + r.score * r.total, 0) / Math.max(1, total))
    : null;

  return (
    <>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginBottom: 16 }}>
        <KpiCard icon="flag" color="#7c3aed" label="Pending now"
          value={loading ? '—' : fmtNumber(stats?.pending)} />
        <KpiCard icon="schedule" color="#f0a500" label="Overdue (>48h)"
          value={loading ? '—' : fmtNumber(stats?.overdue)} />
        <KpiCard icon="check_circle" color="#22c55e" label="Resolved today"
          value={loading ? '—' : fmtNumber(stats?.resolvedToday)} />
        <KpiCard icon="gavel" color="#f04060" label="Total reports"
          value={loading ? '—' : fmtNumber(stats?.total)} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <Card title="Last 30 days — decision breakdown">
          <DecisionDonut approved={approved} rejected={rejected} escalated={escalated} />
        </Card>
        <Card title={avgScore != null ? `Platform moderation score · ${avgScore}/100` : 'Platform moderation score'}>
          <ScoreReadout
            score={avgScore}
            label="Weighted avg of top-5 moderators (last 30d)"
            stats={[
              { label: 'Total decisions', value: total },
              { label: 'Approve rate', value: total ? `${Math.round((approved / total) * 100)}%` : '—' },
              { label: 'Reject rate',  value: total ? `${Math.round((rejected / total) * 100)}%` : '—' },
              { label: 'Escalation rate', value: total ? `${Math.round((escalated / total) * 100)}%` : '—' },
            ]}
          />
        </Card>
      </div>

      <div style={{ height: 16 }} />

      <Card title="Top moderators (last 30 days)">
        {topMods.length === 0 && <Empty label="No moderator activity in the last 30 days." />}
        {topMods.map(m => (
          <div key={m.uid} style={{
            display: 'grid', gridTemplateColumns: '2fr 80px 80px 80px 80px 80px',
            padding: '10px 0', borderBottom: `1px dashed ${C.border}`,
            fontSize: 12, color: C.text, alignItems: 'center',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
              <UserAvatar src={m.moderator?.avatar} size={26} />
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {m.moderator?.displayName || m.moderator?.username || m.uid.slice(0, 10)}
                </div>
                <div style={{ fontSize: 10, color: C.textMuted }}>
                  {m.moderator?.role === 'admin' ? 'Admin' : (m.moderator?.vanguardRank || 'Vanguard')}
                </div>
              </div>
            </div>
            <div className="font-dmmono tabular-nums">{fmtNumber(m.total)}</div>
            <div className="font-dmmono tabular-nums" style={{ color: '#22c55e' }}>{fmtNumber(m.approved)}</div>
            <div className="font-dmmono tabular-nums" style={{ color: '#5a5a85' }}>{fmtNumber(m.rejected)}</div>
            <div className="font-dmmono tabular-nums" style={{ color: '#f0a500' }}>{fmtNumber(m.escalated)}</div>
            <ScoreBadge score={m.score} />
          </div>
        ))}
      </Card>
    </>
  );
}

// ───────────────────────────────────────────────────────────
// REPORTS (resolved)
// ───────────────────────────────────────────────────────────

function ReportsTab() {
  const { showToast } = useUI();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [cursor, setCursor] = useState(null);
  const [hasMore, setHasMore] = useState(false);
  const [filters, setFilters] = useState({ status: '', targetType: '' });

  const load = useCallback(async ({ reset = true } = {}) => {
    setLoading(true);
    try {
      const r = await call('adminListResolvedReports', {
        filters: {
          status: filters.status || undefined,
          targetType: filters.targetType || undefined,
        },
        cursor: reset ? null : cursor,
        pageSize: 50,
      });
      setRows(reset ? r.rows : [...rows, ...r.rows]);
      setCursor(r.nextCursor);
      setHasMore(!!r.nextCursor);
    } catch (e) { showToast(e?.message || 'Failed to load', 'error'); }
    setLoading(false);
  }, [filters, cursor, rows, showToast]);

  useEffect(() => { load({ reset: true }); /* eslint-disable-next-line */ }, [filters]);

  return (
    <>
      <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
        <select value={filters.status} onChange={e => setFilters(f => ({ ...f, status: e.target.value }))} style={selectStyle()}>
          <option value="">All resolved</option>
          <option value="actioned">Approved (target hidden)</option>
          <option value="rejected">Rejected</option>
          <option value="escalated">Escalated</option>
          <option value="resolved">Resolved</option>
        </select>
        <select value={filters.targetType} onChange={e => setFilters(f => ({ ...f, targetType: e.target.value }))} style={selectStyle()}>
          <option value="">All target types</option>
          <option value="post">Posts / Clips</option>
          <option value="user">Users</option>
          <option value="comment">Comments</option>
          <option value="stream">Streams</option>
          <option value="message">Messages</option>
        </select>
        <button type="button" disabled={!rows.length} style={csvButtonStyle}
          onClick={() => downloadCsv(`resolved-reports-${new Date().toISOString().slice(0, 10)}.csv`, REPORT_CSV_COLUMNS, rows)}>
          Export CSV ({rows.length})
        </button>
      </div>

      <Card>
        <div style={{ display: 'grid', gridTemplateColumns: '120px 100px 1fr 1fr 200px 100px', padding: '10px 0', borderBottom: `1px solid ${C.border}`, fontSize: 10, fontWeight: 700, color: C.textMuted, textTransform: 'uppercase' }}>
          <div>When</div><div>Type</div><div>Target / Reason</div><div>Moderator</div><div>Resolution</div><div style={{ textAlign: 'right' }}>Status</div>
        </div>
        {loading && rows.length === 0 && <Empty label="Loading…" />}
        {!loading && rows.length === 0 && <Empty label="No resolved reports match these filters." />}
        {rows.map(r => (
          <div key={r.id} style={{
            display: 'grid', gridTemplateColumns: '120px 100px 1fr 1fr 200px 100px',
            padding: '10px 0', borderBottom: `1px dashed ${C.border}`,
            fontSize: 12, color: C.text, alignItems: 'center',
          }}>
            <div style={{ fontSize: 11, color: C.textDim }}>{fmtRelative(r.resolvedAt)}</div>
            <TypePill type={r.targetType} />
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.reason || '—'}</div>
              <div style={{ fontSize: 10, color: C.textMuted, fontFamily: 'ui-monospace, monospace' }}>{(r.targetId || '').slice(0, 16)}</div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
              <UserAvatar src={r.moderator?.avatar} size={20} />
              <span style={{ fontSize: 11, color: C.textDim, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {r.moderator?.displayName || r.moderator?.username || (r.resolvedBy || '').slice(0, 10)}
              </span>
            </div>
            <div style={{ fontSize: 11, color: C.textDim, fontStyle: 'italic', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {r.resolutionReason ? `"${r.resolutionReason}"` : '—'}
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 6 }}>
              {r.hasAppeal && (
                <span title="Has appeal" style={{ fontSize: 9, fontWeight: 700, padding: '2px 5px', borderRadius: 3, background: '#f0a50020', color: '#f0a500' }}>APPEAL</span>
              )}
              <ReportStatusPill status={r.status} />
            </div>
          </div>
        ))}
        {hasMore && (
          <div style={{ padding: 12, textAlign: 'center' }}>
            <button onClick={() => load({ reset: false })} disabled={loading} style={{
              padding: '8px 18px', borderRadius: 8, background: C.accent, color: '#fff',
              border: 0, fontSize: 12, fontWeight: 600, cursor: 'pointer',
            }}>{loading ? 'Loading…' : 'Load more'}</button>
          </div>
        )}
      </Card>
    </>
  );
}

// ───────────────────────────────────────────────────────────
// MODERATOR ACTIONS (per-moderator drill-down)
// ───────────────────────────────────────────────────────────

function ActionsTab() {
  const { showToast } = useUI();
  const [mods, setMods] = useState([]);
  const [selectedUid, setSelectedUid] = useState(null);
  const [windowDays, setWindowDays] = useState(30);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await call('adminGetModeratorStats', {
        sinceMs: Date.now() - windowDays * 24 * 3600 * 1000,
      });
      setMods(r.rows || []);
    } catch (e) { showToast(e?.message || 'Failed to load', 'error'); }
    setLoading(false);
  }, [windowDays, showToast]);
  useEffect(() => { load(); }, [load]);

  const selected = mods.find(m => m.uid === selectedUid) || null;

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <div style={{ fontSize: 12, color: C.textDim }}>
          Click a moderator to see their decisions breakdown.
        </div>
        <select value={windowDays} onChange={e => setWindowDays(Number(e.target.value))} style={selectStyle()}>
          <option value="7">Last 7 days</option>
          <option value="30">Last 30 days</option>
          <option value="90">Last 90 days</option>
          <option value="365">Last year</option>
        </select>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <Card title={`Moderators (${mods.length})`}>
          {loading && mods.length === 0 && <Empty label="Loading…" />}
          {!loading && mods.length === 0 && <Empty label="No moderator activity in this window." />}
          {mods.map(m => (
            <button key={m.uid} onClick={() => setSelectedUid(m.uid)} style={{
              width: '100%', textAlign: 'left',
              padding: '10px 12px',
              background: selectedUid === m.uid ? '#7c3aed20' : 'transparent',
              border: 0, borderBottom: `1px dashed ${C.border}`,
              color: C.text, cursor: 'pointer',
              display: 'grid', gridTemplateColumns: '2fr 60px 60px 60px',
              alignItems: 'center', gap: 8,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                <UserAvatar src={m.moderator?.avatar} size={24} />
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {m.moderator?.displayName || m.moderator?.username || m.uid.slice(0, 10)}
                  </div>
                  <div style={{ fontSize: 10, color: C.textMuted }}>
                    {m.moderator?.role === 'admin' ? 'Admin' : (m.moderator?.vanguardRank || 'Vanguard')}
                  </div>
                </div>
              </div>
              <div className="font-dmmono tabular-nums" style={{ fontSize: 11, textAlign: 'right' }}>{fmtNumber(m.total)}</div>
              <div className="font-dmmono tabular-nums" style={{ fontSize: 11, textAlign: 'right', color: '#22c55e' }}>{fmtNumber(m.approved)}</div>
              <ScoreBadge score={m.score} small />
            </button>
          ))}
        </Card>

        <Card title={selected ? `${selected.moderator?.displayName || selected.uid.slice(0, 10)} — drill-down` : 'Pick a moderator'}>
          {!selected && <Empty label="Select a moderator on the left." />}
          {selected && (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12, marginBottom: 14 }}>
                <KpiCard icon="task_alt" color="#22c55e" label="Approved" value={fmtNumber(selected.approved)} />
                <KpiCard icon="cancel" color="#5a5a85" label="Rejected" value={fmtNumber(selected.rejected)} />
                <KpiCard icon="north_east" color="#f0a500" label="Escalated" value={fmtNumber(selected.escalated)} />
                <KpiCard icon="emoji_events" color="#7c3aed" label="Score" value={`${selected.score}/100`} />
              </div>
              <div style={{ fontSize: 12, fontWeight: 600, color: C.text, marginBottom: 8 }}>By target type</div>
              {Object.entries(selected.targetTypeBreakdown || {}).map(([t, count]) => (
                <div key={t} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: `1px dashed ${C.border}`, fontSize: 12 }}>
                  <TypePill type={t} />
                  <span className="font-dmmono tabular-nums">{fmtNumber(count)}</span>
                </div>
              ))}
              <div style={{ marginTop: 10, fontSize: 11, color: C.textDim }}>
                Last action: {fmtRelative(selected.lastActionAt)}
              </div>
              <ModeratorTimeline
                uid={selected.uid}
                name={selected.moderator?.displayName || selected.moderator?.username || selected.uid.slice(0, 10)}
                sinceMs={Date.now() - windowDays * 24 * 3600 * 1000}
              />
            </>
          )}
        </Card>
      </div>
    </>
  );
}

// Every decision one moderator made in the window, newest first, from the same
// resolved-reports query the Reports tab uses (filtered by resolvedBy). Loaded
// only when a moderator is picked; paged 50 at a time.
function ModeratorTimeline({ uid, name, sinceMs }) {
  const { showToast } = useUI();
  const [rows, setRows] = useState([]);
  const [cursor, setCursor] = useState(null);
  const [loading, setLoading] = useState(true);
  // Rounded so the parent's Date.now() on every render does not refetch.
  const since = Math.floor(sinceMs / 3_600_000) * 3_600_000;

  const load = useCallback(async (from) => {
    setLoading(true);
    try {
      const r = await call('adminListResolvedReports', {
        filters: { moderatorUid: uid, sinceMs: since },
        cursor: from || null,
        pageSize: 50,
      });
      setRows((prev) => (from ? [...prev, ...(r.rows || [])] : (r.rows || [])));
      setCursor(r.nextCursor || null);
    } catch (e) { showToast(e?.message || 'Failed to load timeline', 'error'); }
    setLoading(false);
  }, [uid, since, showToast]);

  useEffect(() => { setRows([]); setCursor(null); load(null); }, [load]);

  return (
    <div style={{ marginTop: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: C.text }}>Timeline</div>
        <button type="button" disabled={!rows.length} style={{ ...csvButtonStyle, padding: '5px 10px', fontSize: 11 }}
          onClick={() => downloadCsv(`moderator-${name.replace(/[^\w-]+/g, '_')}-${new Date().toISOString().slice(0, 10)}.csv`, REPORT_CSV_COLUMNS, rows)}>
          Export CSV
        </button>
      </div>
      {loading && rows.length === 0 && <Empty label="Loading…" />}
      {!loading && rows.length === 0 && <Empty label="No decisions in this window." />}
      {rows.map((r) => (
        <div key={r.id} style={{ display: 'grid', gridTemplateColumns: '90px 80px 1fr 80px', gap: 8, alignItems: 'center', padding: '7px 0', fontSize: 12 }}>
          <span style={{ fontSize: 11, color: C.textDim }}>{fmtRelative(r.resolvedAt)}</span>
          <TypePill type={r.targetType} />
          <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: C.text }}
            title={r.resolutionReason || ''}>
            {r.reason || '—'}{r.resolutionReason ? ` · "${r.resolutionReason}"` : ''}
          </span>
          <ReportStatusPill status={r.status} />
        </div>
      ))}
      {cursor && (
        <button type="button" onClick={() => load(cursor)} disabled={loading} style={{ ...csvButtonStyle, marginLeft: 0, marginTop: 8 }}>
          {loading ? 'Loading…' : 'Load more'}
        </button>
      )}
    </div>
  );
}

// ───────────────────────────────────────────────────────────
// APPEALS
// ───────────────────────────────────────────────────────────

function AppealsTab({ guarded }) {
  const { showToast } = useUI();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('pending');
  const [drawer, setDrawer] = useState(null); // appeal detail
  const [resolvePrompt, setResolvePrompt] = useState(null); // { appealId, decision }

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await call('adminListAppeals', {
        filters: { status: statusFilter || undefined }, pageSize: 100,
      });
      setRows(r.rows || []);
    } catch (e) { showToast(e?.message || 'Failed to load appeals', 'error'); }
    setLoading(false);
  }, [statusFilter, showToast]);
  useEffect(() => { load(); }, [load]);

  const openDetail = async (appealId) => {
    try {
      const r = await call('adminGetAppealDetail', { appealId });
      setDrawer(r);
    } catch (e) { showToast(e?.message || 'Failed', 'error'); }
  };

  const resolve = async (reason) => {
    if (!resolvePrompt) return;
    try {
      await guarded(() => call('adminResolveAppeal', {
        appealId: resolvePrompt.appealId,
        decision: resolvePrompt.decision,
        reason,
      }));
      showToast(`Appeal ${resolvePrompt.decision}`, 'success');
      setResolvePrompt(null); setDrawer(null); load();
    } catch { /* toast */ }
  };

  const pendingCount = rows.filter(r => r.status === 'pending').length;

  return (
    <>
      <div style={{ display: 'flex', gap: 8, marginBottom: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} style={selectStyle()}>
          <option value="">All statuses</option>
          <option value="pending">Pending</option>
          <option value="upheld">Upheld (original decision stands)</option>
          <option value="overturned">Overturned (decision reversed)</option>
          <option value="dismissed">Dismissed</option>
        </select>
        <div style={{ fontSize: 11, color: C.textDim }}>
          {fmtNumber(rows.length)} loaded · {fmtNumber(pendingCount)} pending
        </div>
        <button type="button" disabled={!rows.length} style={csvButtonStyle}
          onClick={() => downloadCsv(`appeals-${new Date().toISOString().slice(0, 10)}.csv`, [
            { label: 'Filed at', get: (a) => iso(a.createdAt) },
            { label: 'Target type', get: (a) => a.targetType },
            { label: 'Target id', get: (a) => a.targetId },
            { label: 'User uid', get: (a) => a.userId },
            { label: 'Appeal', get: (a) => a.appealText },
            { label: 'Status', get: (a) => a.status },
            { label: 'Resolved at', get: (a) => iso(a.resolvedAt) },
            { label: 'Resolution note', get: (a) => a.resolutionReason },
          ], rows)}>
          Export CSV
        </button>
      </div>

      <Card>
        <div style={{ display: 'grid', gridTemplateColumns: '160px 100px 1fr 220px 100px', padding: '10px 0', borderBottom: `1px solid ${C.border}`, fontSize: 10, fontWeight: 700, color: C.textMuted, textTransform: 'uppercase' }}>
          <div>Filed</div><div>Target</div><div>User · appeal</div><div>Status</div><div style={{ textAlign: 'right' }}>Action</div>
        </div>
        {loading && rows.length === 0 && <Empty label="Loading…" />}
        {!loading && rows.length === 0 && <Empty label="No appeals match the filter." />}
        {rows.map(a => (
          <div key={a.id} style={{ display: 'grid', gridTemplateColumns: '160px 100px 1fr 220px 100px', padding: '10px 0', borderBottom: `1px dashed ${C.border}`, fontSize: 12, color: C.text, alignItems: 'center' }}>
            <div style={{ fontSize: 11, color: C.textDim }}>{fmtRelative(a.createdAt)}</div>
            <TypePill type={a.targetType} />
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
              <UserAvatar src={a.user?.avatar} size={22} />
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {a.user?.displayName || a.user?.username || (a.userId || '').slice(0, 10)}
                </div>
                <div style={{ fontSize: 11, color: C.textDim, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {(a.appealText || '').slice(0, 80)}
                </div>
              </div>
            </div>
            <div>
              <AppealStatusPill status={a.status} />
              {a.resolutionReason && (
                <div style={{ fontSize: 10, color: C.textMuted, fontStyle: 'italic', marginTop: 2 }}>
                  "{a.resolutionReason.slice(0, 60)}"
                </div>
              )}
            </div>
            <div style={{ textAlign: 'right' }}>
              <button onClick={() => openDetail(a.id)} style={btn(C.accent)}>Open</button>
            </div>
          </div>
        ))}
      </Card>

      {drawer && (
        <AppealDrawer
          data={drawer}
          onClose={() => setDrawer(null)}
          onResolve={(decision) => setResolvePrompt({ appealId: drawer.appeal.id, decision })}
        />
      )}
      {resolvePrompt && (
        <ResolveAppealPrompt
          decision={resolvePrompt.decision}
          onCancel={() => setResolvePrompt(null)}
          onConfirm={resolve}
        />
      )}
    </>
  );
}

function AppealDrawer({ data, onClose, onResolve }) {
  const { appeal, report, user } = data;
  const pending = appeal.status === 'pending';
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)', zIndex: 250, display: 'flex', justifyContent: 'flex-end' }}>
      <div style={{ width: 520, maxWidth: '95vw', height: '100%', background: C.card, borderLeft: `1px solid ${C.border}`, overflow: 'auto', padding: 22 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <h3 style={{ margin: 0, fontSize: 15, color: C.text, fontWeight: 700 }}>Appeal detail</h3>
          <button onClick={onClose} style={{ background: 'transparent', border: 0, color: C.textDim, cursor: 'pointer', fontSize: 18 }}>×</button>
        </div>

        <AppealStatusPill status={appeal.status} />
        <p style={{ margin: '12px 0 6px', fontSize: 11, fontWeight: 700, color: C.textMuted, textTransform: 'uppercase' }}>User's appeal text</p>
        <div style={{ padding: 12, background: '#0a0a14', borderRadius: 8, fontSize: 13, color: C.text, whiteSpace: 'pre-wrap' }}>
          {appeal.appealText}
        </div>

        <p style={{ margin: '14px 0 6px', fontSize: 11, fontWeight: 700, color: C.textMuted, textTransform: 'uppercase' }}>Appealing user</p>
        {user ? (
          <div style={{ padding: 12, background: '#0a0a14', borderRadius: 8, display: 'flex', gap: 10, alignItems: 'center' }}>
            <UserAvatar src={user.avatar} size={36} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 600, color: C.text }}>{user.displayName || user.username}</div>
              <div style={{ fontSize: 11, color: C.textDim }}>
                {user.banned ? '🔴 BANNED' : ''}{user.banReason ? ` · ${user.banReason}` : ''}
                {user.mutedUntil ? ` · muted until ${fmtDate(user.mutedUntil)}` : ''}
              </div>
            </div>
          </div>
        ) : <div style={{ fontSize: 12, color: C.textDim }}>User not loaded.</div>}

        {report && (
          <>
            <p style={{ margin: '14px 0 6px', fontSize: 11, fontWeight: 700, color: C.textMuted, textTransform: 'uppercase' }}>Original report</p>
            <div style={{ padding: 12, background: '#0a0a14', borderRadius: 8, fontSize: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                <TypePill type={report.targetType} />
                <ReportStatusPill status={report.status} />
              </div>
              <div style={{ color: C.text, marginBottom: 4 }}>Reason: {report.reason || '—'}</div>
              <div style={{ color: C.textDim, fontSize: 11 }}>Resolved {fmtRelative(report.resolvedAt)} · "{report.resolutionReason || '—'}"</div>
            </div>
          </>
        )}

        {pending && (
          <>
            <p style={{ margin: '18px 0 6px', fontSize: 11, fontWeight: 700, color: C.textMuted, textTransform: 'uppercase' }}>Resolution</p>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => onResolve('overturned')} style={{ flex: 1, padding: '10px', borderRadius: 8, background: '#22c55e', color: '#fff', border: 0, fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
                Overturn (reverse)
              </button>
              <button onClick={() => onResolve('upheld')} style={{ flex: 1, padding: '10px', borderRadius: 8, background: '#5a5a85', color: '#fff', border: 0, fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
                Uphold
              </button>
              <button onClick={() => onResolve('dismissed')} style={{ flex: 1, padding: '10px', borderRadius: 8, background: 'transparent', border: `1px solid ${C.border}`, color: C.textDim, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
                Dismiss
              </button>
            </div>
            <p style={{ margin: '8px 0 0', fontSize: 10, color: C.textMuted }}>
              <strong>Overturn</strong> reverses the original action where possible (un-hide post, etc).
              <strong>Uphold</strong> keeps the original decision.
              <strong>Dismiss</strong> closes without review (insufficient detail).
            </p>
          </>
        )}
        {!pending && appeal.resolutionReason && (
          <>
            <p style={{ margin: '14px 0 6px', fontSize: 11, fontWeight: 700, color: C.textMuted, textTransform: 'uppercase' }}>Resolved</p>
            <div style={{ padding: 12, background: '#0a0a14', borderRadius: 8, fontSize: 12, color: C.text, fontStyle: 'italic' }}>
              "{appeal.resolutionReason}"
              <div style={{ fontSize: 10, color: C.textDim, marginTop: 4, fontStyle: 'normal' }}>
                by {(appeal.resolvedBy || '').slice(0, 10)} · {fmtRelative(appeal.resolvedAt)}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function ResolveAppealPrompt({ decision, onCancel, onConfirm }) {
  const [reason, setReason] = useState('');
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)', zIndex: 300, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 22, width: 460, maxWidth: '92vw' }}>
        <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: C.text, textTransform: 'capitalize' }}>{decision} appeal</h3>
        <p style={{ margin: '6px 0 14px', fontSize: 12, color: C.textDim }}>
          Reason will be saved to the audit log and sent to the user in the resolution notification.
        </p>
        <textarea rows={4} value={reason} onChange={e => setReason(e.target.value)}
          placeholder="Required (min 4 chars)"
          style={{ width: '100%', padding: '10px 12px', background: '#0a0a14', border: `1px solid ${C.border}`, borderRadius: 8, color: C.text, fontSize: 13, resize: 'vertical', fontFamily: 'inherit' }} />
        <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
          <button onClick={onCancel} style={{ flex: 1, padding: '10px', borderRadius: 8, background: 'transparent', border: `1px solid ${C.border}`, color: C.textDim, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>Cancel</button>
          <button onClick={() => onConfirm(reason)} disabled={!reason.trim() || reason.trim().length < 4}
            style={{ flex: 1, padding: '10px', borderRadius: 8, border: 0,
              background: decision === 'overturned' ? '#22c55e' : decision === 'upheld' ? '#5a5a85' : '#f0a500',
              color: '#fff', fontSize: 12, fontWeight: 700, cursor: 'pointer', opacity: !reason.trim() ? 0.5 : 1 }}>
            Confirm
          </button>
        </div>
      </div>
    </div>
  );
}

// ───────────────────────────────────────────────────────────
// SETTINGS
// ───────────────────────────────────────────────────────────

function SettingsTab({ guarded }) {
  const { showToast } = useUI();
  const [settings, setSettings] = useState(null);
  const [draft, setDraft] = useState({});
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await call('adminGetModerationPolicySettings');
      setSettings(r.settings); setDraft({});
    } catch (e) { showToast(e?.message || 'Failed to load', 'error'); }
  }, [showToast]);
  useEffect(() => { load(); }, [load]);

  const get = (k) => draft[k] !== undefined ? draft[k] : settings?.[k];
  const set = (k, v) => setDraft(d => ({ ...d, [k]: v }));
  const dirty = Object.keys(draft).length > 0;

  const save = async () => {
    setSaving(true);
    try {
      await guarded(() => call('adminSetModerationPolicySettings', { settings: draft }));
      showToast('Policy saved', 'success');
      load();
    } catch { /* toast */ }
    setSaving(false);
  };

  if (!settings) return <Empty label="Loading…" />;

  return (
    <Card title="Moderation policy">
      <p style={{ margin: '0 0 16px', fontSize: 12, color: C.textDim }}>
        Stored on <code>app_config/general.moderation</code>. Each one is read: the threshold by report filing, the durations as the defaults in Users, the window by appeals, the handbook on /vanguard/handbook.
      </p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
        <NumberField label="Auto-hide threshold (# reports, 1–100)" value={get('autoHideReportThreshold')}
          min={1} max={100} onChange={v => set('autoHideReportThreshold', v)} />
        <NumberField label="Default mute duration (hours, 1–720)" value={get('defaultMuteHours')}
          min={1} max={720} onChange={v => set('defaultMuteHours', v)} />
        <NumberField label="Default temp-ban (days, 1–365)" value={get('defaultTempBanDays')}
          min={1} max={365} onChange={v => set('defaultTempBanDays', v)} />
        <NumberField label="Appeal window (days, 1–90)" value={get('appealWindowDays')}
          min={1} max={90} onChange={v => set('appealWindowDays', v)} />
      </div>

      <div style={{ marginTop: 16 }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: C.textDim, marginBottom: 6 }}>
          Current guidance for moderators (markdown, up to 8000 characters, shown first in /vanguard/handbook)
        </div>
        <textarea rows={10} value={get('handbookMarkdown') || ''} onChange={e => set('handbookMarkdown', e.target.value)}
          style={{ width: '100%', padding: '10px 12px', background: '#0a0a14', border: `1px solid ${C.border}`, borderRadius: 8, color: C.text, fontSize: 12, resize: 'vertical', fontFamily: 'ui-monospace, monospace' }} />
        <div style={{ fontSize: 10, color: C.textMuted, marginTop: 4 }}>
          {(get('handbookMarkdown') || '').length} / 8000 chars
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, marginTop: 18 }}>
        <button onClick={() => setDraft({})} disabled={!dirty}
          style={{ padding: '10px 16px', borderRadius: 8, background: 'transparent', border: `1px solid ${C.border}`, color: C.textDim, fontSize: 12, fontWeight: 600, cursor: 'pointer', opacity: dirty ? 1 : 0.5 }}>Reset</button>
        <button onClick={save} disabled={!dirty || saving}
          style={{ padding: '10px 18px', borderRadius: 8, background: C.accent, color: '#fff', border: 0, fontSize: 12, fontWeight: 700, cursor: 'pointer', opacity: !dirty ? 0.5 : 1 }}>
          {saving ? 'Saving…' : 'Save changes'}
        </button>
        {dirty && <span style={{ alignSelf: 'center', fontSize: 11, color: '#f0a500', fontWeight: 600 }}>{Object.keys(draft).length} unsaved change{Object.keys(draft).length === 1 ? '' : 's'}</span>}
      </div>
    </Card>
  );
}

function NumberField({ label, value, min, max, onChange }) {
  return (
    <div>
      <div style={{ fontSize: 11, fontWeight: 600, color: C.textDim, marginBottom: 6 }}>{label}</div>
      <input type="number" value={value ?? ''} min={min} max={max}
        onChange={e => {
          const n = parseInt(e.target.value);
          if (Number.isFinite(n)) onChange(Math.max(min, Math.min(max, n)));
        }}
        style={{ width: '100%', padding: '10px 12px', background: '#0a0a14', border: `1px solid ${C.border}`, borderRadius: 8, color: C.text, fontSize: 12 }} />
    </div>
  );
}

// ───────────────────────────────────────────────────────────
// Shared bits
// ───────────────────────────────────────────────────────────

function Card({ title, children }) {
  return (
    <div style={{
      background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 16,
    }}>
      {title && (
        <h3 style={{ margin: 0, marginBottom: 12, fontSize: 13, fontWeight: 700, color: C.text }}>
          {title}
        </h3>
      )}
      {children}
    </div>
  );
}

function Empty({ label }) {
  return (
    <div style={{ padding: 24, textAlign: 'center', color: C.textDim, fontSize: 12 }}>{label}</div>
  );
}

function selectStyle() {
  return {
    padding: '8px 12px', borderRadius: 8, border: `1px solid ${C.border}`,
    background: '#0a0a14', color: C.text, fontSize: 12,
  };
}

function btn(color) {
  return {
    padding: '6px 12px', borderRadius: 6, border: `1px solid ${color}50`,
    background: `${color}20`, color, fontSize: 11, fontWeight: 600, cursor: 'pointer',
  };
}

const TYPE_LABELS = {
  post: 'POST', user: 'USER', comment: 'CMT', stream: 'STREAM', message: 'MSG', squad: 'SQUAD',
};
const TYPE_COLORS = {
  post: '#7c3aed', user: '#3b82f6', comment: '#f5c542', stream: '#f04060', message: '#22c55e', squad: '#b44fff',
};
function TypePill({ type }) {
  const fg = TYPE_COLORS[type] || C.textDim;
  return (
    <span style={{
      fontSize: 9, fontWeight: 700, padding: '3px 6px', borderRadius: 4,
      background: `${fg}20`, color: fg, textTransform: 'uppercase',
      display: 'inline-block', width: 'max-content',
    }}>{TYPE_LABELS[type] || (type || '—').toUpperCase()}</span>
  );
}

function ReportStatusPill({ status }) {
  const map = {
    actioned:  { bg: '#22c55e20', fg: '#22c55e', label: 'APPROVED' },
    rejected:  { bg: '#5a5a8520', fg: C.textDim, label: 'REJECTED' },
    escalated: { bg: '#f0a50020', fg: '#f0a500', label: 'ESCALATED' },
    resolved:  { bg: '#3b82f620', fg: '#3b82f6', label: 'RESOLVED' },
    pending:   { bg: '#f0406020', fg: '#f04060', label: 'PENDING' },
  };
  const m = map[status] || { bg: '#5a5a8520', fg: C.textDim, label: (status || '—').toUpperCase() };
  return (
    <span style={{ fontSize: 9, fontWeight: 700, padding: '3px 6px', borderRadius: 4, background: m.bg, color: m.fg }}>
      {m.label}
    </span>
  );
}

function AppealStatusPill({ status }) {
  const map = {
    pending:    { bg: '#f0406020', fg: '#f04060', label: 'PENDING REVIEW' },
    upheld:     { bg: '#5a5a8520', fg: C.textDim, label: 'UPHELD' },
    overturned: { bg: '#22c55e20', fg: '#22c55e', label: 'OVERTURNED' },
    dismissed:  { bg: '#7c3aed20', fg: '#b44fff', label: 'DISMISSED' },
  };
  const m = map[status] || map.pending;
  return (
    <span style={{ fontSize: 10, fontWeight: 700, padding: '3px 8px', borderRadius: 999, background: m.bg, color: m.fg }}>
      {m.label}
    </span>
  );
}

function ScoreBadge({ score, small }) {
  if (score == null) return <span style={{ color: C.textMuted, fontSize: 10 }}>—</span>;
  const color = score >= 85 ? '#22c55e' : score >= 65 ? '#f0a500' : '#f04060';
  return (
    <span style={{
      fontSize: small ? 9 : 10, fontWeight: 700, padding: small ? '2px 6px' : '3px 8px',
      borderRadius: 4, background: `${color}20`, color, textAlign: 'center',
      display: 'inline-block', width: 'max-content',
    }}>{score}</span>
  );
}

function ScoreReadout({ score, label, stats }) {
  return (
    <div style={{ display: 'flex', gap: 18, alignItems: 'center' }}>
      <div style={{ width: 120, textAlign: 'center' }}>
        <div className="font-dmmono tabular-nums" style={{
          fontSize: 38, fontWeight: 800,
          color: score == null ? C.textMuted : score >= 85 ? '#22c55e' : score >= 65 ? '#f0a500' : '#f04060',
        }}>{score ?? '—'}</div>
        <div style={{ fontSize: 11, color: C.textDim }}>{label}</div>
      </div>
      <div style={{ flex: 1, display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8 }}>
        {stats.map(s => (
          <div key={s.label} style={{ fontSize: 11, color: C.textDim }}>
            <div style={{ fontSize: 10, color: C.textMuted }}>{s.label}</div>
            <div style={{ fontSize: 16, color: C.text, fontWeight: 600 }} className="font-dmmono tabular-nums">{s.value}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function DecisionDonut({ approved, rejected, escalated }) {
  const total = approved + rejected + escalated;
  if (total === 0) return <Empty label="No resolutions in this window." />;
  const R = 60, CIRC = 2 * Math.PI * R;
  const aLen = (approved / total) * CIRC;
  const rLen = (rejected / total) * CIRC;
  const eLen = (escalated / total) * CIRC;
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-around', padding: '8px 0' }}>
      <svg width="140" height="140" viewBox="0 0 140 140">
        <circle cx="70" cy="70" r={R} fill="none" stroke="#1e1e30" strokeWidth="16" />
        <circle cx="70" cy="70" r={R} fill="none" stroke="#22c55e" strokeWidth="16"
          strokeDasharray={`${aLen} ${CIRC - aLen}`} strokeDashoffset={CIRC / 4} transform="rotate(-90 70 70)" />
        <circle cx="70" cy="70" r={R} fill="none" stroke="#5a5a85" strokeWidth="16"
          strokeDasharray={`${rLen} ${CIRC - rLen}`} strokeDashoffset={CIRC / 4 - aLen} transform="rotate(-90 70 70)" />
        <circle cx="70" cy="70" r={R} fill="none" stroke="#f0a500" strokeWidth="16"
          strokeDasharray={`${eLen} ${CIRC - eLen}`} strokeDashoffset={CIRC / 4 - aLen - rLen} transform="rotate(-90 70 70)" />
        <text x="70" y="68" textAnchor="middle" fontSize="20" fontWeight="700" fill={C.text} className="font-dmmono tabular-nums">{fmtNumber(total)}</text>
        <text x="70" y="86" textAnchor="middle" fontSize="10" fill={C.textDim}>Total</text>
      </svg>
      <div style={{ fontSize: 12 }}>
        <LegendRow color="#22c55e" label="Approved" count={approved} total={total} />
        <LegendRow color="#5a5a85" label="Rejected" count={rejected} total={total} />
        <LegendRow color="#f0a500" label="Escalated" count={escalated} total={total} />
      </div>
    </div>
  );
}

function LegendRow({ color, label, count, total }) {
  const pct = total > 0 ? (count / total) * 100 : 0;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0' }}>
      <span style={{ width: 10, height: 10, borderRadius: 2, background: color }} />
      <span style={{ width: 70, color: C.text }}>{label}</span>
      <span style={{ width: 50, color: C.text, fontWeight: 600 }} className="font-dmmono tabular-nums">{fmtNumber(count)}</span>
      <span style={{ color: C.textDim, fontSize: 11 }}>{pct.toFixed(1)}%</span>
    </div>
  );
}
