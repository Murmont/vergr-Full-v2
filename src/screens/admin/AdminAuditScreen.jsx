// AdminAuditScreen — /admin/audit
//
// Paginated read of admin_actions/. Filter by actor, action, target type,
// and date range. Click any row to see full before/after diff in a slide-over.
// CSV export for the founder (sub-admins are limited to their own actions
// server-side).

import { useState, useEffect, useCallback } from 'react';
import { useUI } from '../../context/UIContext';
import Icon from '../../components/Icon';
import UserAvatar from '../../components/UserAvatar';
import AdminShell, { ADMIN_COLORS as C } from './AdminShell';
import { call, fmtRelative, fmtTime } from './_adminGuarded';

// Human labels for action codes — fall back to the raw code if missing.
const ACTION_LABELS = {
  admin_temp_ban:           'User suspended',
  admin_perma_ban:          'User permabanned',
  admin_unban:              'User unbanned',
  admin_mute:               'User muted',
  admin_unmute:             'User unmuted',
  admin_set_role:           'Role changed',
  admin_force_logout:       'Force logout',
  admin_send_password_reset:'Password reset sent',
  admin_grant_coins:        'Coins granted',
  admin_grant_vp:           'VP granted',
  admin_grant_gems:         'Gems granted',
  admin_deduct_coins:       'Coins deducted',
  admin_update_payout:      'Withdrawal status changed',
  admin_set_economy_config: 'Economy flag changed',
  admin_set_config_field:   'App config edited',
  admin_resolve_report:     'Report resolved',
  admin_bulk_resolve_reports:'Reports bulk resolved',
  admin_invite_sent:        'Admin invite sent',
  admin_screens_changed:    'Admin scope changed',
  admin_revoked:            'Admin access revoked',
  set_bots_paused:          'News bots toggled',
  bot_post_limit_set:       'Bot post cap changed',
  run_bot_sync_now:         'Bot sync triggered',
  delete_bot_posts:         'Bot posts deleted',
  send_announcement:        'Announcement sent',
  invite_to_vanguard:       'Vanguard invited',
  change_vanguard_rank:     'Vanguard rank changed',
  set_vanguard_status:      'Vanguard status changed',
};

const labelFor = (a) => ACTION_LABELS[a] || a.replace(/_/g, ' ');

export default function AdminAuditScreen() {
  const { showToast } = useUI();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [cursor, setCursor] = useState(null);
  const [hasMore, setHasMore] = useState(false);
  const [filters, setFilters] = useState({ actorUid: '', action: '', targetType: '' });
  const [facets, setFacets] = useState({ actors: [], actions: [], targetTypes: [] });
  const [selected, setSelected] = useState(null);
  const [exporting, setExporting] = useState(false);

  const load = useCallback(async ({ reset = true } = {}) => {
    setLoading(true);
    try {
      const r = await call('adminListAuditActions', {
        filters,
        cursor: reset ? null : cursor,
        pageSize: 50,
      });
      setRows(reset ? r.rows : [...rows, ...r.rows]);
      setCursor(r.nextCursor);
      setHasMore(!!r.nextCursor);
    } catch (e) {
      showToast(e?.message || 'Failed to load audit log', 'error');
    }
    setLoading(false);
  }, [filters, cursor, rows, showToast]);

  useEffect(() => { load({ reset: true }); /* eslint-disable-next-line */ }, [filters]);

  useEffect(() => {
    call('adminGetAuditFacets').then(setFacets).catch(() => {});
  }, []);

  const exportCsv = async () => {
    setExporting(true);
    try {
      const r = await call('adminExportAuditCsv', { filters });
      const blob = new Blob([r.csv], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `audit-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      showToast(`Exported ${r.rowCount} rows${r.truncated ? ' (truncated at 5000)' : ''}`, 'success');
    } catch (e) {
      showToast(e?.message || 'Export failed', 'error');
    }
    setExporting(false);
  };

  return (
    <AdminShell
      screen="audit"
      title="Audit Log"
      subtitle="Track every action administrators perform. Append-only & immutable."
      topBarRight={
        <button
          onClick={exportCsv}
          disabled={exporting}
          style={{
            padding: '8px 14px', borderRadius: 8, border: `1px solid ${C.border}`,
            background: C.card, color: C.text, fontSize: 12, fontWeight: 600,
            cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6,
          }}
        >
          <Icon name="download" size={14} /> {exporting ? 'Exporting…' : 'Export CSV'}
        </button>
      }
    >
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 280px', gap: 20 }}>
        <div style={{ minWidth: 0 }}>
          {/* Filter bar */}
          <div style={{
            display: 'flex', gap: 8, flexWrap: 'wrap',
            background: C.card, border: `1px solid ${C.border}`, borderRadius: 12,
            padding: 12, marginBottom: 12,
          }}>
            <FilterSelect
              value={filters.actorUid}
              onChange={v => setFilters(f => ({ ...f, actorUid: v }))}
              placeholder="All Admins"
              options={facets.actors.map(a => ({ value: a.uid, label: a.displayName || a.uid.slice(0, 8) }))}
            />
            <FilterSelect
              value={filters.action}
              onChange={v => setFilters(f => ({ ...f, action: v }))}
              placeholder="All Actions"
              options={facets.actions.map(a => ({ value: a, label: labelFor(a) }))}
            />
            <FilterSelect
              value={filters.targetType}
              onChange={v => setFilters(f => ({ ...f, targetType: v }))}
              placeholder="All Targets"
              options={facets.targetTypes.map(t => ({ value: t, label: t }))}
            />
            {(filters.actorUid || filters.action || filters.targetType) && (
              <button
                onClick={() => setFilters({ actorUid: '', action: '', targetType: '' })}
                style={{
                  padding: '8px 12px', borderRadius: 8, border: `1px solid ${C.border}`,
                  background: 'transparent', color: C.textDim, fontSize: 12,
                  cursor: 'pointer',
                }}
              >
                Clear filters
              </button>
            )}
          </div>

          {/* Table */}
          <div style={{
            background: C.card, border: `1px solid ${C.border}`, borderRadius: 12,
            overflow: 'hidden',
          }}>
            <div style={{
              display: 'grid', gridTemplateColumns: '120px 1.4fr 1.2fr 1.4fr 100px 90px',
              padding: '10px 14px', borderBottom: `1px solid ${C.border}`,
              fontSize: 10, fontWeight: 700, color: C.textMuted, textTransform: 'uppercase',
              letterSpacing: '0.06em',
            }}>
              <div>Time</div>
              <div>Admin</div>
              <div>Action</div>
              <div>Target</div>
              <div>IP</div>
              <div style={{ textAlign: 'right' }}>Result</div>
            </div>

            {loading && rows.length === 0 && (
              <div style={{ padding: 40, textAlign: 'center', color: C.textDim }}>Loading…</div>
            )}
            {!loading && rows.length === 0 && (
              <div style={{ padding: 40, textAlign: 'center', color: C.textDim }}>
                No audit actions match the current filters.
              </div>
            )}
            {rows.map(r => (
              <button
                key={r.id}
                onClick={() => setSelected(r)}
                style={{
                  display: 'grid', gridTemplateColumns: '120px 1.4fr 1.2fr 1.4fr 100px 90px',
                  width: '100%', padding: '12px 14px',
                  background: 'transparent', border: 0,
                  borderBottom: `1px solid ${C.border}`,
                  textAlign: 'left', color: C.text, fontSize: 12,
                  cursor: 'pointer', alignItems: 'center',
                  transition: 'background .12s',
                }}
                onMouseEnter={e => e.currentTarget.style.background = '#0a0a14'}
                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
              >
                <div style={{ color: C.textDim }}>{fmtRelative(r.createdAt)}</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                  <UserAvatar src={r.actorProfile?.avatar} size={24} />
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {r.actorProfile?.displayName || r.actor?.displayName || r.actor?.uid?.slice(0, 8) || '—'}
                    </div>
                    {r.actorProfile?.role === 'admin' && (
                      <div style={{ fontSize: 9, color: C.accent2, fontWeight: 700 }}>OWNER</div>
                    )}
                  </div>
                </div>
                <div>{labelFor(r.action)}</div>
                <div style={{ color: C.textDim, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {r.target?.type ? (
                    <>
                      <span style={{
                        fontSize: 9, fontWeight: 700, padding: '2px 6px', borderRadius: 4,
                        background: '#7c3aed20', color: '#b44fff', marginRight: 6,
                        textTransform: 'uppercase',
                      }}>{r.target.type}</span>
                      <span style={{ fontFamily: 'ui-monospace, monospace', fontSize: 11 }}>
                        {(r.target.id || '').slice(0, 18)}
                      </span>
                    </>
                  ) : '—'}
                </div>
                <div style={{ fontFamily: 'ui-monospace, monospace', fontSize: 11, color: C.textMuted }}>
                  {r.ip || '—'}
                </div>
                <div style={{ textAlign: 'right' }}>
                  <span style={{
                    fontSize: 10, fontWeight: 700, padding: '3px 8px', borderRadius: 999,
                    background: '#22c55e20', color: '#22c55e',
                  }}>SUCCESS</span>
                </div>
              </button>
            ))}

            {hasMore && (
              <div style={{ padding: 12, textAlign: 'center' }}>
                <button
                  onClick={() => load({ reset: false })}
                  disabled={loading}
                  style={{
                    padding: '8px 18px', borderRadius: 8,
                    background: C.accent, color: '#fff', border: 0,
                    fontSize: 12, fontWeight: 600, cursor: 'pointer',
                  }}
                >
                  {loading ? 'Loading…' : 'Load more'}
                </button>
              </div>
            )}
          </div>

          <div style={{ fontSize: 11, color: C.textMuted, marginTop: 12, textAlign: 'center' }}>
            Audit logs are append-only and retained per platform data-retention policy.
            All times shown in your local timezone.
          </div>
        </div>

        {/* Right rail — moderators panel */}
        <ModeratorsRail facets={facets} />
      </div>

      {selected && <DetailDrawer row={selected} onClose={() => setSelected(null)} />}
    </AdminShell>
  );
}

function FilterSelect({ value, onChange, placeholder, options }) {
  return (
    <select
      value={value}
      onChange={e => onChange(e.target.value)}
      style={{
        padding: '8px 12px', borderRadius: 8, border: `1px solid ${C.border}`,
        background: '#0a0a14', color: value ? C.text : C.textDim, fontSize: 12,
        minWidth: 140,
      }}
    >
      <option value="">{placeholder}</option>
      {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}

function ModeratorsRail({ facets }) {
  return (
    <aside style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 16 }}>
        <h3 style={{ margin: 0, fontSize: 13, fontWeight: 700, color: C.text, marginBottom: 12 }}>
          Active Admins
        </h3>
        {facets.actors.length === 0 && (
          <div style={{ fontSize: 12, color: C.textDim }}>No admins recorded in the last 500 actions.</div>
        )}
        {facets.actors.slice(0, 8).map(a => (
          <div key={a.uid} style={{
            display: 'flex', alignItems: 'center', gap: 10,
            padding: '8px 0', borderBottom: `1px dashed ${C.border}`,
          }}>
            <UserAvatar src={null} size={28} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: C.text,
                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {a.displayName || a.uid.slice(0, 10)}
              </div>
              <div style={{ fontSize: 10, color: C.textMuted, fontFamily: 'ui-monospace, monospace' }}>
                {a.uid.slice(0, 12)}
              </div>
            </div>
          </div>
        ))}
      </div>
    </aside>
  );
}

function DetailDrawer({ row, onClose }) {
  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 200,
        display: 'flex', justifyContent: 'flex-end',
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: 520, maxWidth: '100vw', height: '100%',
          background: C.bg, borderLeft: `1px solid ${C.border}`,
          padding: 24, overflowY: 'auto',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18 }}>
          <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: C.text }}>Audit Detail</h2>
          <button
            onClick={onClose}
            style={{
              width: 32, height: 32, borderRadius: 8, border: 0,
              background: C.card, color: C.textDim, cursor: 'pointer',
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            }}
          >
            <Icon name="close" size={16} />
          </button>
        </div>

        <DetailRow label="Action" value={labelFor(row.action)} />
        <DetailRow label="Actor" value={row.actorProfile?.displayName || row.actor?.uid?.slice(0, 12) || '—'} />
        <DetailRow label="Target Type" value={row.target?.type || '—'} />
        <DetailRow label="Target ID" value={row.target?.id || '—'} mono />
        <DetailRow label="Reason" value={row.reason || '—'} />
        <DetailRow label="IP" value={row.ip || '—'} mono />
        <DetailRow label="User-Agent" value={row.userAgent || '—'} small />
        <DetailRow label="Step-Up Required" value={row.stepUpEnforced ? 'Yes' : 'No'} />
        <DetailRow label="Step-Up Fresh" value={row.stepUpFresh ? 'Yes' : 'No'} />
        <DetailRow label="Timestamp (UTC)" value={fmtTime(row.createdAt)} />

        {row.before != null && (
          <div style={{ marginTop: 16 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: C.textDim, marginBottom: 6 }}>BEFORE</div>
            <pre style={{
              margin: 0, padding: 12, background: '#0a0a14', borderRadius: 8,
              border: `1px solid ${C.border}`, fontSize: 11, color: '#f04060',
              overflowX: 'auto', maxHeight: 240,
            }}>{JSON.stringify(row.before, null, 2)}</pre>
          </div>
        )}
        {row.after != null && (
          <div style={{ marginTop: 12 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: C.textDim, marginBottom: 6 }}>AFTER</div>
            <pre style={{
              margin: 0, padding: 12, background: '#0a0a14', borderRadius: 8,
              border: `1px solid ${C.border}`, fontSize: 11, color: '#22c55e',
              overflowX: 'auto', maxHeight: 240,
            }}>{JSON.stringify(row.after, null, 2)}</pre>
          </div>
        )}
        {row.meta && (
          <div style={{ marginTop: 12 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: C.textDim, marginBottom: 6 }}>META</div>
            <pre style={{
              margin: 0, padding: 12, background: '#0a0a14', borderRadius: 8,
              border: `1px solid ${C.border}`, fontSize: 11, color: C.textDim,
              overflowX: 'auto', maxHeight: 200,
            }}>{JSON.stringify(row.meta, null, 2)}</pre>
          </div>
        )}
      </div>
    </div>
  );
}

function DetailRow({ label, value, mono, small }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'flex-start', gap: 12, padding: '8px 0',
      borderBottom: `1px dashed ${C.border}`,
    }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: C.textDim, width: 130, flexShrink: 0 }}>{label}</div>
      <div style={{
        fontSize: small ? 10 : 12, color: C.text, flex: 1, wordBreak: 'break-all',
        fontFamily: mono ? 'ui-monospace, monospace' : 'inherit',
      }}>{value}</div>
    </div>
  );
}
