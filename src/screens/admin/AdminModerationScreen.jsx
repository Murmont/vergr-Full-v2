// AdminModerationScreen — /admin/reports
//
// Mockup: KPI strip + tabs by target type + table + filters + bulk actions.
// Acts on reports/{id} via adminResolveReport / adminBulkResolveReports.
// Detail drawer shows the report + siblings + a snapshot of the target.

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useUI } from '../../context/UIContext';
import Icon from '../../components/Icon';
import UserAvatar from '../../components/UserAvatar';
import AdminShell, { ADMIN_COLORS as C } from './AdminShell';
import {
  call, fmtNumber, fmtDate, fmtRelative,
  useGuardedCall, ReasonPrompt, KpiCard, Tabs,
} from './_adminGuarded';

const TABS = [
  { id: 'all',      label: 'All Items', countKey: 'pending' },
  { id: 'clips',    label: 'Clips',     countKey: 'post' },
  { id: 'users',    label: 'Users',     countKey: 'user' },
  { id: 'comments', label: 'Comments',  countKey: 'comment' },
  { id: 'streams',  label: 'Streams',   countKey: 'stream' },
];

const TYPE_ICONS = {
  post:    'movie',
  user:    'person',
  comment: 'chat',
  stream:  'live_tv',
  message: 'mail',
  squad:   'groups',
  review:  'star',
};
const TYPE_COLORS = {
  post:    '#7c3aed',
  user:    '#3b82f6',
  comment: '#f5c542',
  stream:  '#f04060',
  message: '#22c55e',
  squad:   '#b44fff',
  review:  '#c87fff',
};

const PRIORITY_COLORS = {
  critical: '#f04060',
  high:     '#f04060',
  normal:   '#f5c542',
  low:      '#22c55e',
};

// ───────────────────────────────────────────────────────────
// Main screen
// ───────────────────────────────────────────────────────────

export default function AdminModerationScreen() {
  const { showToast } = useUI();
  const { guarded, overlay } = useGuardedCall();
  const navigate = useNavigate();
  const [tab, setTab] = useState('all');
  const [status, setStatus] = useState('pending');
  const [priority, setPriority] = useState('');
  const [reason, setReason] = useState('');
  const [rows, setRows] = useState([]);
  const [reporters, setReporters] = useState({});
  const [cursor, setCursor] = useState(null);
  const [nextCursor, setNextCursor] = useState(null);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState(null);
  const [selected, setSelected] = useState(new Set());
  const [openReportId, setOpenReportId] = useState(null);
  const [bulkPrompt, setBulkPrompt] = useState(null);

  const loadStats = useCallback(async () => {
    try { setStats(await call('adminGetModerationStats')); } catch {}
  }, []);

  const load = useCallback(async (reset = false) => {
    setLoading(true);
    try {
      const r = await call('adminListReports', {
        tab,
        status,
        priority: priority || null,
        reason: reason || null,
        cursor: reset ? null : cursor,
        pageSize: 25,
      });
      setRows(prev => reset ? r.rows : [...prev, ...r.rows]);
      setReporters(prev => ({ ...prev, ...r.reporters }));
      setNextCursor(r.nextCursor);
    } catch (err) {
      showToast(err?.message || 'Failed to load reports', 'error');
    }
    setLoading(false);
  }, [tab, status, priority, reason, cursor, showToast]);

  useEffect(() => { loadStats(); }, [loadStats]);

  useEffect(() => {
    setCursor(null); setRows([]); setSelected(new Set());
    load(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, status, priority, reason]);

  const toggleSelect = (id) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  const toggleSelectAll = () => {
    setSelected(prev => prev.size === rows.length && rows.length > 0
      ? new Set()
      : new Set(rows.map(r => r.id)));
  };

  const onBulk = (decision) => {
    if (selected.size === 0) return showToast('Select reports first', 'error');
    const labels = {
      approve: { title: `Approve ${selected.size} report${selected.size === 1 ? '' : 's'}`, msg: 'Marks reports as actioned. Posts/streams attached to approved reports will be auto-hidden.', danger: true },
      reject:  { title: `Reject ${selected.size} report${selected.size === 1 ? '' : 's'}`,  msg: 'Marks reports as rejected with no further action against the target.', danger: false },
      escalate:{ title: `Escalate ${selected.size} report${selected.size === 1 ? '' : 's'}`, msg: 'Flags for senior review. Status moves to "escalated".', danger: false },
    };
    const cfg = labels[decision];
    setBulkPrompt({
      title: cfg.title,
      message: cfg.msg,
      danger: cfg.danger,
      onConfirm: async ({ reason: r }) => {
        setBulkPrompt(null);
        try {
          await guarded(() => call('adminBulkResolveReports', {
            reportIds: Array.from(selected),
            decision,
            reason: r,
          }));
          showToast(`Bulk ${decision}: ${selected.size} reports`, 'success');
          setSelected(new Set());
          loadStats(); load(true);
        } catch {}
      },
      onCancel: () => setBulkPrompt(null),
    });
  };

  const tabCount = (t) => {
    if (!stats) return null;
    if (t.id === 'all') return stats.pending;
    return stats.byType?.[t.countKey] ?? 0;
  };

  return (
    <AdminShell
      screen="moderation"
      title="Moderation Queue"
      subtitle="Review and take action on reported content + users."
    >
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 10 }}>
        <button onClick={() => navigate('/admin/reports/audit')} style={{
          padding: '8px 14px', borderRadius: 8, background: 'transparent',
          border: `1px solid ${C.border}`, color: C.text, fontSize: 12, fontWeight: 600,
          cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6,
        }}>
          <Icon name="history" size={14} />
          View audit + appeals
        </button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12, marginBottom: 16 }}>
        <KpiCard icon="inbox"    color="#7c3aed" label="Total in queue" value={stats ? fmtNumber(stats.total) : '—'} />
        <KpiCard icon="schedule" color="#f5c542" label="Unreviewed"     value={stats ? fmtNumber(stats.pending) : '—'} />
        <KpiCard icon="error"    color="#f04060" label="Overdue (>48h)" value={stats ? fmtNumber(stats.overdue) : '—'} />
        <KpiCard icon="task_alt" color="#22c55e" label="Resolved today"  value={stats ? fmtNumber(stats.resolvedToday) : '—'} />
      </div>

      {/* Enforcement record. These are the figures to quote when a payment
          processor or a store reviewer asks how moderation actually performs:
          the Acceptable Use Policy publishes 24h/72h response targets, and this
          is the measurement against them. "Within target" is computed per
          report against the target for its own priority, not against one
          blended number. */}
      {stats?.record && (
        <div style={{ border: `1px solid ${C.border}`, borderRadius: 12, padding: 14, marginBottom: 16, background: 'rgba(255,255,255,0.02)' }}>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, marginBottom: 10, flexWrap: 'wrap' }}>
            <div style={{ fontSize: 13, fontWeight: 700 }}>
              Enforcement record
              <span style={{ color: C.textDim, fontWeight: 500 }}> · last {stats.record.windowDays} days</span>
            </div>
            {stats.record.truncated && (
              <div style={{ fontSize: 11, color: '#f5c542' }}>
                Sampled from the most recent 1,000 reports
              </div>
            )}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12 }}>
            {[
              ['Reports received', fmtNumber(stats.record.received)],
              ['Actioned', fmtNumber(stats.record.actioned)],
              ['Still open', fmtNumber(stats.record.openAtWindowEnd)],
              ['Median time to action', stats.record.medianHoursToAction === null ? '—' : `${stats.record.medianHoursToAction}h`],
              ['Within published target', stats.record.withinTargetPct === null ? '—' : `${stats.record.withinTargetPct}%`],
            ].map(([label, value]) => (
              <div key={label}>
                <div style={{ fontSize: 11, color: C.textDim, marginBottom: 2 }}>{label}</div>
                <div style={{ fontSize: 18, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{value}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 280px', gap: 16 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 12, borderBottom: `1px solid ${C.border}`, overflowX: 'auto' }}>
            {TABS.map(t => {
              const cnt = tabCount(t);
              return (
                <button
                  key={t.id}
                  onClick={() => setTab(t.id)}
                  style={{
                    padding: '10px 14px', background: 'transparent', border: 0,
                    borderBottom: `2px solid ${tab === t.id ? C.accent : 'transparent'}`,
                    color: tab === t.id ? C.text : C.textDim,
                    fontSize: 13, fontWeight: tab === t.id ? 600 : 500,
                    cursor: 'pointer', marginBottom: -1, whiteSpace: 'nowrap',
                    display: 'inline-flex', alignItems: 'center', gap: 6,
                  }}
                >
                  {t.label}
                  {cnt != null && (
                    <span style={{
                      padding: '1px 7px', borderRadius: 999,
                      background: tab === t.id ? `${C.accent}40` : C.card2,
                      fontSize: 10, fontWeight: 700,
                    }}>{cnt}</span>
                  )}
                </button>
              );
            })}
          </div>

          {/* Bulk action bar */}
          {selected.size > 0 && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: 10, marginBottom: 10,
              background: `${C.accent}15`, border: `1px solid ${C.accent}50`, borderRadius: 8,
            }}>
              <span style={{ fontSize: 12, color: C.text, fontWeight: 600 }}>{selected.size} selected</span>
              <div style={{ flex: 1 }} />
              <button onClick={() => onBulk('approve')}  style={bulkBtn('#f04060', true)}>Approve all</button>
              <button onClick={() => onBulk('reject')}   style={bulkBtn('#22c55e')}>Reject all</button>
              <button onClick={() => onBulk('escalate')} style={bulkBtn('#f5c542')}>Escalate all</button>
              <button onClick={() => setSelected(new Set())} style={iconBtn}><Icon name="close" size={14} /></button>
            </div>
          )}

          <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, overflow: 'hidden' }}>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 760 }}>
                <thead>
                  <tr style={{ background: C.card2 }}>
                    <th style={{ ...th, width: 30 }}>
                      <input
                        type="checkbox"
                        checked={selected.size === rows.length && rows.length > 0}
                        onChange={toggleSelectAll}
                        style={{ cursor: 'pointer' }}
                      />
                    </th>
                    {['Item', 'Type', 'Reported By', 'Reason', 'Priority', 'Submitted', 'Actions'].map(h => (
                      <th key={h} style={th}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map(r => {
                    const reporter = reporters[r.reporterId] || {};
                    const isSelected = selected.has(r.id);
                    const isOverdue = r.status === 'pending' && r.createdAt && (Date.now() - r.createdAt) > 48 * 3600 * 1000;
                    return (
                      <tr
                        key={r.id}
                        onClick={() => setOpenReportId(r.id)}
                        style={{
                          cursor: 'pointer', borderTop: `1px solid ${C.border}`,
                          background: isSelected ? `${C.accent}10` : 'transparent',
                        }}
                        onMouseEnter={e => { if (!isSelected) e.currentTarget.style.background = C.card2; }}
                        onMouseLeave={e => { if (!isSelected) e.currentTarget.style.background = 'transparent'; }}
                      >
                        <td style={td} onClick={e => e.stopPropagation()}>
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => toggleSelect(r.id)}
                            style={{ cursor: 'pointer' }}
                          />
                        </td>
                        <td style={td}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <div style={{
                              width: 32, height: 32, borderRadius: 6,
                              background: `${TYPE_COLORS[r.targetType] || C.textDim}25`,
                              color: TYPE_COLORS[r.targetType] || C.textDim,
                              display: 'flex', alignItems: 'center', justifyContent: 'center',
                              flexShrink: 0,
                            }}>
                              <Icon name={TYPE_ICONS[r.targetType] || 'flag'} size={16} />
                            </div>
                            <div style={{ minWidth: 0 }}>
                              <div style={{ fontSize: 12, fontWeight: 600, color: C.text, fontFamily: 'monospace' }}>
                                {(r.targetId || '').slice(0, 10)}…
                              </div>
                              {r.details && <div style={{ fontSize: 10, color: C.textDim, maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.details}</div>}
                            </div>
                          </div>
                        </td>
                        <td style={td}>
                          <span style={{ padding: '3px 8px', borderRadius: 6, background: `${TYPE_COLORS[r.targetType] || C.textDim}25`, color: TYPE_COLORS[r.targetType] || C.textDim, fontSize: 10, fontWeight: 700, textTransform: 'capitalize' }}>
                            {r.targetType}
                          </span>
                        </td>
                        <td style={td}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <UserAvatar src={reporter.avatar} size={22} />
                            <span style={{ fontSize: 11, color: C.text }}>{reporter.displayName || (r.reporterId || '').slice(0, 6)}</span>
                          </div>
                        </td>
                        <td style={{ ...td, fontSize: 11, color: C.textDim, textTransform: 'capitalize' }}>{r.reason || '—'}</td>
                        <td style={td}>
                          <span style={{
                            padding: '3px 8px', borderRadius: 6,
                            background: `${PRIORITY_COLORS[r.priority] || C.textDim}25`,
                            color: PRIORITY_COLORS[r.priority] || C.textDim,
                            fontSize: 10, fontWeight: 700, textTransform: 'uppercase',
                          }}>{r.priority || 'normal'}</span>
                        </td>
                        <td style={{ ...td, fontSize: 11, color: isOverdue ? '#f04060' : C.textDim, fontWeight: isOverdue ? 700 : 400, whiteSpace: 'nowrap' }}>
                          {fmtRelative(r.createdAt)}
                          {isOverdue && <span style={{ marginLeft: 4 }}>·OVERDUE</span>}
                        </td>
                        <td style={{ ...td }} onClick={e => e.stopPropagation()}>
                          <button onClick={() => setOpenReportId(r.id)} style={iconBtn}>
                            <Icon name="visibility" size={14} />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                  {!loading && rows.length === 0 && (
                    <tr><td colSpan={8} style={{ padding: 40, textAlign: 'center', color: C.textDim, fontSize: 13 }}>
                      Queue is clear for this filter — nice.
                    </td></tr>
                  )}
                </tbody>
              </table>
            </div>
            <div style={{ padding: 12, borderTop: `1px solid ${C.border}`, display: 'flex', justifyContent: 'space-between' }}>
              <div style={{ fontSize: 11, color: C.textDim }}>
                {loading ? 'Loading…' : `${rows.length} loaded`}
              </div>
              {nextCursor && (
                <button onClick={() => { setCursor(nextCursor); load(false); }}
                  style={{ padding: '7px 14px', borderRadius: 6, background: 'transparent', border: `1px solid ${C.border}`, color: C.textDim, fontSize: 11, fontWeight: 600, cursor: 'pointer' }}>
                  Load more
                </button>
              )}
            </div>
          </div>
        </div>

        <aside style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 16, alignSelf: 'flex-start' }}>
          <h3 style={{ margin: 0, fontSize: 13, fontWeight: 700, color: C.text, marginBottom: 14 }}>Filters</h3>

          <FilterLabel>Status</FilterLabel>
          <select value={status} onChange={e => setStatus(e.target.value)} style={selectStyle}>
            <option value="pending">Pending</option>
            <option value="actioned">Actioned</option>
            <option value="rejected">Rejected</option>
            <option value="escalated">Escalated</option>
            <option value="all">All</option>
          </select>

          <FilterLabel>Priority</FilterLabel>
          <select value={priority} onChange={e => setPriority(e.target.value)} style={selectStyle}>
            <option value="">Any</option>
            <option value="critical">Critical</option>
            <option value="normal">Normal</option>
            <option value="low">Low</option>
          </select>

          <FilterLabel>Reason</FilterLabel>
          <select value={reason} onChange={e => setReason(e.target.value)} style={selectStyle}>
            <option value="">Any</option>
            <option value="harassment">Harassment</option>
            <option value="spam">Spam</option>
            <option value="hate_speech">Hate speech</option>
            <option value="inappropriate">Inappropriate</option>
            <option value="cheating">Cheating</option>
            <option value="underage">Underage</option>
            <option value="impersonation">Impersonation</option>
          </select>

          <button onClick={() => { setStatus('pending'); setPriority(''); setReason(''); }}
            style={{ width: '100%', padding: 8, marginTop: 4, borderRadius: 6, background: 'transparent', border: `1px solid ${C.border}`, color: C.accent, fontSize: 11, fontWeight: 600, cursor: 'pointer' }}>
            Reset filters
          </button>
        </aside>
      </div>

      {openReportId && (
        <ReportDrawer
          reportId={openReportId}
          guarded={guarded}
          onClose={() => setOpenReportId(null)}
          onChanged={() => { loadStats(); load(true); }}
        />
      )}
      {bulkPrompt && <ReasonPrompt {...bulkPrompt} />}
      {overlay}
    </AdminShell>
  );
}

// ───────────────────────────────────────────────────────────
// Report detail drawer
// ───────────────────────────────────────────────────────────

function ReportDrawer({ reportId, guarded, onClose, onChanged }) {
  const navigate = useNavigate();
  const { showToast } = useUI();
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [prompt, setPrompt] = useState(null);

  const reload = useCallback(async () => {
    setLoading(true);
    try { setDetail(await call('adminGetReportDetail', { reportId })); }
    catch (err) { showToast(err?.message || 'Failed to load report', 'error'); }
    setLoading(false);
  }, [reportId, showToast]);

  useEffect(() => { reload(); }, [reload]);

  const act = (decision) => {
    const labels = {
      approve:  { title: 'Approve report',  msg: detail?.target?.type === 'post' ? 'Marks actioned + hides the post.' : detail?.target?.type === 'stream' ? 'Marks actioned + ends the stream.' : 'Marks actioned. User-targeted reports don\'t auto-ban — open the Users screen for that.', danger: true },
      reject:   { title: 'Reject report',   msg: 'Marks rejected. No action against the target.', danger: false },
      escalate: { title: 'Escalate report', msg: 'Status moves to "escalated" for senior review.', danger: false },
    };
    const cfg = labels[decision];
    setPrompt({
      title: cfg.title,
      message: cfg.msg,
      danger: cfg.danger,
      onConfirm: async ({ reason }) => {
        setPrompt(null);
        try {
          await guarded(() => call('adminResolveReport', { reportId, decision, reason }));
          showToast(`Report ${decision}d`, 'success');
          onChanged?.();
          onClose?.();
        } catch {}
      },
      onCancel: () => setPrompt(null),
    });
  };

  const target = detail?.target;
  const report = detail?.report;
  const reporter = report && detail?.reporters?.[report.reporterId];
  const siblings = detail?.siblings || [];
  const reporters = detail?.reporters || {};
  const resolved = report && ['actioned', 'rejected', 'escalated', 'resolved'].includes(report.status);

  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 150 }} />
      <aside style={{
        position: 'fixed', top: 0, right: 0, bottom: 0, width: 560, maxWidth: '95vw',
        background: C.bg, borderLeft: `1px solid ${C.border}`,
        zIndex: 151, overflowY: 'auto', padding: 24,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: C.text }}>Report detail</h2>
          <button onClick={onClose} style={{ background: 'transparent', border: 0, color: C.textDim, cursor: 'pointer' }}>
            <Icon name="close" size={20} />
          </button>
        </div>

        {loading || !detail || !report ? (
          <div style={{ color: C.textDim, fontSize: 13 }}>Loading…</div>
        ) : (
          <>
            {/* Report meta */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 14 }}>
              <span style={{ padding: '3px 8px', borderRadius: 6, background: `${TYPE_COLORS[report.targetType] || C.textDim}25`, color: TYPE_COLORS[report.targetType] || C.textDim, fontSize: 11, fontWeight: 700, textTransform: 'capitalize' }}>
                <Icon name={TYPE_ICONS[report.targetType] || 'flag'} size={11} /> {report.targetType}
              </span>
              <span style={{ padding: '3px 8px', borderRadius: 6, background: `${PRIORITY_COLORS[report.priority] || C.textDim}25`, color: PRIORITY_COLORS[report.priority] || C.textDim, fontSize: 11, fontWeight: 700, textTransform: 'uppercase' }}>
                {report.priority || 'normal'}
              </span>
              <span style={{ padding: '3px 8px', borderRadius: 6, background: `${C.accent}25`, color: C.text, fontSize: 11, fontWeight: 700, textTransform: 'uppercase' }}>
                {report.status}
              </span>
            </div>

            <Section title="Report">
              <KeyVal label="Reason"    value={report.reason || '—'} />
              <KeyVal label="Submitted" value={fmtRelative(report.createdAt)} />
              <KeyVal label="Reporter"  value={
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  <UserAvatar src={reporter?.avatar} size={20} />
                  {reporter?.displayName || (report.reporterId || '').slice(0, 8)}
                </span>
              } />
              {report.details && (
                <div style={{ marginTop: 8, padding: 10, background: C.card2, borderRadius: 6, fontSize: 12, color: C.text, whiteSpace: 'pre-wrap' }}>
                  {report.details}
                </div>
              )}
            </Section>

            {/* Target snapshot */}
            <Section title="Target">
              {!target ? (
                <div style={{ color: C.textDim, fontSize: 12 }}>Target not found or deleted.</div>
              ) : target.type === 'post' ? (
                <>
                  {target.author && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                      <UserAvatar src={target.author.avatar} size={32} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 12, fontWeight: 700, color: C.text }}>{target.author.displayName}</div>
                        {target.author.username && <div style={{ fontSize: 10, color: C.textDim }}>@{target.author.username}</div>}
                      </div>
                      <button onClick={() => { onClose(); navigate(`/admin/users?uid=${target.authorId}`); }}
                        style={miniBtn(C.accent)}>Open author</button>
                    </div>
                  )}
                  {target.text && (
                    <div style={{ padding: 10, background: C.card2, borderRadius: 6, fontSize: 12, color: C.text, whiteSpace: 'pre-wrap', maxHeight: 160, overflow: 'auto' }}>
                      {target.text}
                    </div>
                  )}
                  <ReportedMedia items={target.mediaUrls} />
                  {target.status && target.status !== 'visible' && (
                    <div style={{ marginTop: 8, fontSize: 11, color: '#f04060', fontWeight: 700 }}>
                      Post status: {target.status}
                    </div>
                  )}
                </>
              ) : target.type === 'user' ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <UserAvatar src={target.avatar} size={40} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: C.text }}>{target.displayName}</div>
                    {target.username && <div style={{ fontSize: 11, color: C.textDim }}>@{target.username}</div>}
                    {target.bio && <div style={{ fontSize: 11, color: C.textDim, marginTop: 4 }}>{target.bio.slice(0, 80)}</div>}
                    {target.banned && <div style={{ fontSize: 10, color: '#f04060', fontWeight: 700, marginTop: 4 }}>Already banned</div>}
                  </div>
                  <button onClick={() => { onClose(); navigate(`/admin/users?uid=${target.uid}`); }} style={miniBtn(C.accent)}>Open user</button>
                </div>
              ) : target.type === 'comment' ? (
                <>
                  {target.text && (
                    <div style={{ padding: 10, background: C.card2, borderRadius: 6, fontSize: 12, color: C.text, whiteSpace: 'pre-wrap' }}>
                      {target.text}
                    </div>
                  )}
                  <KeyVal label="Comment id" value={target.id} />
                  {target.postId && <KeyVal label="On post" value={target.postId} />}
                </>
              ) : target.type === 'stream' ? (
                <>
                  <KeyVal label="Stream title" value={target.title || '—'} />
                  <KeyVal label="Host"   value={target.hostId || '—'} />
                  <KeyVal label="Status" value={target.status || '—'} />
                </>
              ) : (
                <KeyVal label="Target id" value={report.targetId} />
              )}
            </Section>

            {/* Sibling reports */}
            {siblings.length > 0 && (
              <Section title={`Other reports on this target (${siblings.length})`}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {siblings.slice(0, 10).map(s => {
                    const u = reporters[s.reporterId] || {};
                    return (
                      <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: 8, background: C.card2, borderRadius: 6 }}>
                        <UserAvatar src={u.avatar} size={20} />
                        <div style={{ fontSize: 11, color: C.text, flex: 1, minWidth: 0 }}>
                          <div style={{ fontWeight: 600 }}>{u.displayName || (s.reporterId || '').slice(0, 6)}</div>
                          <div style={{ color: C.textDim }}>{s.reason} · {fmtRelative(s.createdAt)}</div>
                        </div>
                        <span style={{ fontSize: 10, color: C.textDim, textTransform: 'uppercase' }}>{s.status}</span>
                      </div>
                    );
                  })}
                </div>
              </Section>
            )}

            {/* Resolution / Actions */}
            {resolved ? (
              <Section title="Resolution">
                <KeyVal label="Status"     value={report.status} />
                <KeyVal label="Resolved by" value={report.resolvedBy || '—'} />
                <KeyVal label="When"       value={fmtRelative(report.resolvedAt)} />
                {report.resolutionReason && (
                  <div style={{ marginTop: 8, padding: 10, background: C.card2, borderRadius: 6, fontSize: 12, color: C.text }}>
                    {report.resolutionReason}
                  </div>
                )}
              </Section>
            ) : (
              <Section title="Decision">
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
                  <ActionRow icon="check"     label="Approve"  danger onClick={() => act('approve')} />
                  <ActionRow icon="close"     label="Reject"   onClick={() => act('reject')} />
                  <ActionRow icon="arrow_upward" label="Escalate" onClick={() => act('escalate')} />
                </div>
                <p style={{ marginTop: 10, fontSize: 11, color: C.textDim, lineHeight: 1.5 }}>
                  Approve = take action against the target (auto-hides posts, ends streams). For users, approve the report then open the Users screen for ban/mute. Reject = no action. Escalate = senior review.
                </p>
              </Section>
            )}
          </>
        )}
      </aside>
      {prompt && <ReasonPrompt {...prompt} />}
    </>
  );
}

// ───────────────────────────────────────────────────────────
// UI primitives
// ───────────────────────────────────────────────────────────

function Section({ title, children }) {
  return (
    <div style={{ marginBottom: 18 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: C.textDim, marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{title}</div>
      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: 14 }}>
        {children}
      </div>
    </div>
  );
}

function KeyVal({ label, value }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', padding: '4px 0', fontSize: 12, gap: 8 }}>
      <span style={{ color: C.textDim, flexShrink: 0 }}>{label}</span>
      <span style={{ color: C.text, fontWeight: 500, textAlign: 'right', minWidth: 0, overflowWrap: 'anywhere' }}>{value}</span>
    </div>
  );
}

function ActionRow({ icon, label, danger = false, onClick }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: '10px 12px', borderRadius: 8,
        background: 'transparent', border: `1px solid ${danger ? '#f04060' : C.border}`,
        color: danger ? '#f04060' : C.text,
        fontSize: 12, fontWeight: 600, cursor: 'pointer',
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
      }}
    >
      <Icon name={icon} size={14} />
      {label}
    </button>
  );
}

function FilterLabel({ children }) {
  return <div style={{ fontSize: 10, fontWeight: 700, color: C.textDim, marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{children}</div>;
}

const th = { padding: '10px 14px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: C.textDim, textTransform: 'uppercase', letterSpacing: '0.05em' };
const td = { padding: '12px 14px', fontSize: 12, color: C.text };

const selectStyle = {
  width: '100%', padding: '8px 10px',
  background: '#0a0a14', border: `1px solid ${C.border}`, borderRadius: 6,
  color: C.text, fontSize: 12, marginBottom: 12, appearance: 'none', cursor: 'pointer',
};

const iconBtn = {
  padding: '7px 9px', background: 'transparent', border: `1px solid ${C.border}`,
  borderRadius: 6, color: C.textDim, cursor: 'pointer',
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
};

const miniBtn = (color, danger = false) => ({
  padding: '6px 12px', borderRadius: 6, border: `1px solid ${color}`,
  background: danger ? 'transparent' : `${color}25`,
  color, fontSize: 11, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap',
});

const bulkBtn = (color, danger = false) => ({
  padding: '7px 12px', borderRadius: 6, border: `1px solid ${color}`,
  background: danger ? 'transparent' : `${color}25`,
  color, fontSize: 11, fontWeight: 700, cursor: 'pointer',
});

// ⚠ adminGetReportDetail has always returned the post's media, and nothing drew
// it, so a moderator reviewing a reported photo or clip saw only its caption.
// On a visual platform that is most reports. Letterboxed, never cropped: a
// moderator must see the whole frame, including whatever is at the edges.
const VIDEO_RX = /\.(webm|mp4|mov|m4v|m3u8)(\?|#|$)/i;
function ReportedMedia({ items }) {
  const list = (Array.isArray(items) ? items : [])
    .map((m) => (typeof m === 'string' ? { url: m } : { url: m?.url || m?.src, type: m?.type }))
    .filter((m) => typeof m.url === 'string' && m.url.startsWith('https://'))
    .slice(0, 4);
  if (list.length === 0) return null;
  return (
    <div style={{ display: 'grid', gridTemplateColumns: list.length > 1 ? '1fr 1fr' : '1fr', gap: 6, marginTop: 8 }}>
      {list.map((m, i) => {
        const isVideo = String(m.type || '').startsWith('video') || VIDEO_RX.test(m.url);
        const box = { width: '100%', height: list.length > 1 ? 140 : 240, objectFit: 'contain', background: '#000', borderRadius: 6, display: 'block' };
        return isVideo
          ? <video key={i} src={m.url} controls muted playsInline preload="metadata" style={box} />
          : <img key={i} src={m.url} alt={'Reported media ' + (i + 1)} loading="lazy" style={box} />;
      })}
    </div>
  );
}
