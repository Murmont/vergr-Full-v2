// AdminSubscriptionsScreen — /admin/subscriptions
//
// Pass 1: Overview / All Subscriptions / Billing & Invoices.
// Pass 2: Plans & Pricing / Comp & Overrides / Settings / Logs + bulk actions.

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useUI } from '../../context/UIContext';
import Icon from '../../components/Icon';
import UserAvatar from '../../components/UserAvatar';
import AdminShell, { ADMIN_COLORS as C } from './AdminShell';
import { call, fmtNumber, fmtMoney, fmtDate, fmtRelative, KpiCard, Tabs, useGuardedCall, ReasonPrompt } from './_adminGuarded';

const TABS = [
  { id: 'overview',  label: 'Overview' },
  { id: 'all',       label: 'All Subscriptions' },
  { id: 'billing',   label: 'Billing & Invoices' },
  { id: 'plans',     label: 'Plans & Pricing' },
  { id: 'comp',      label: 'Comp & Overrides' },
  { id: 'settings',  label: 'Settings' },
  { id: 'logs',      label: 'Logs' },
];

export default function AdminSubscriptionsScreen() {
  const [tab, setTab] = useState('overview');

  return (
    <AdminShell
      screen="subscriptions"
      title="Subscriptions"
      subtitle="Manage subscription plans, users, billing and revenue."
    >
      <Tabs tabs={TABS} active={tab} onChange={setTab} />
      {tab === 'overview' && <OverviewTab />}
      {tab === 'all'      && <AllSubscriptionsTab />}
      {tab === 'billing'  && <BillingInvoicesTab />}
      {tab === 'plans'    && <PlansTab />}
      {tab === 'comp'     && <CompOverridesTab />}
      {tab === 'settings' && <SettingsTab />}
      {tab === 'logs'     && <LogsTab />}
    </AdminShell>
  );
}

// ───────────────────────────────────────────────────────────
// OVERVIEW
// ───────────────────────────────────────────────────────────

function OverviewTab() {
  const { showToast } = useUI();
  const [stats, setStats] = useState(null);
  const [trend, setTrend] = useState(null);
  const [recent, setRecent] = useState([]);
  const [renewals, setRenewals] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [s, t, r, ren] = await Promise.all([
        call('adminGetSubscriptionStats'),
        call('adminGetSubscriptionTrend', { days: 30 }),
        call('adminGetRecentSubscriptionEvents', { limit: 8 }),
        call('adminGetUpcomingRenewals'),
      ]);
      setStats(s); setTrend(t); setRecent(r.rows || []); setRenewals(ren);
    } catch (e) {
      showToast(e?.message || 'Failed to load overview', 'error');
    }
    setLoading(false);
  }, [showToast]);

  useEffect(() => { load(); }, [load]);

  return (
    <>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12, marginBottom: 16 }}>
        <KpiCard icon="workspace_premium" color="#7c3aed" label="Active Subscriptions"
          value={loading ? '—' : fmtNumber(stats?.activeSubscriptions)} sub={stats ? `${fmtNumber(stats.liteCount)} Lite · ${fmtNumber(stats.proCount)} Pro` : null} />
        <KpiCard icon="trending_up" color="#22c55e" label="New (7d)"
          value={loading ? '—' : fmtNumber(stats?.newWeek)} />
        <KpiCard icon="trending_down" color="#f04060" label="Cancelled (30d)"
          value={loading ? '—' : fmtNumber(stats?.cancelledMonth)} />
        <KpiCard icon="paid" color="#f0a500" label="MRR"
          value={loading ? '—' : fmtMoney(stats?.mrrEUR)} sub={stats ? `ARR ${fmtMoney(stats.arrEUR)}` : null} />
        <KpiCard icon="account_balance" color="#3b82f6" label="Free Users"
          value={loading ? '—' : fmtNumber(stats?.freeCount)} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr', gap: 16, marginBottom: 16 }}>
        <Card title="Subscription Trend (30d)">
          {!trend ? <Empty label="Loading…" /> : <TrendChart points={trend.points} />}
        </Card>
        <Card title="Plan Distribution">
          {!stats ? <Empty label="Loading…" /> : (
            <PlanDonut lite={stats.liteCount} pro={stats.proCount} />
          )}
        </Card>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 16 }}>
        <Card title="Recent Subscriptions">
          {recent.length === 0 && <Empty label="No subscription events yet." />}
          {recent.map(r => (
            <div key={r.id} style={{
              display: 'flex', alignItems: 'center', gap: 10,
              padding: '10px 0', borderBottom: `1px dashed ${C.border}`,
            }}>
              <UserAvatar src={r.user?.avatar} size={32} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: C.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {r.user?.displayName || r.user?.username || (r.userId || '').slice(0, 10)}
                </div>
                <div style={{ fontSize: 11, color: C.textMuted }}>
                  {r.user?.email || '—'}
                </div>
              </div>
              <TierPill tier={r.tier} />
              <div style={{ fontSize: 10, color: C.textDim, width: 90, textAlign: 'right' }}>
                {fmtRelative(r.createdAt)}
              </div>
            </div>
          ))}
        </Card>

        <Card title="Upcoming Renewals">
          {!renewals ? <Empty label="Loading…" /> : (
            <>
              <RenewalRow label="Today"      data={renewals.today} />
              <RenewalRow label="This Week"  data={renewals.thisWeek} />
              <RenewalRow label="This Month" data={renewals.thisMonth} />
            </>
          )}
        </Card>
      </div>
    </>
  );
}

function RenewalRow({ label, data }) {
  return (
    <div style={{
      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      padding: '12px 0', borderBottom: `1px dashed ${C.border}`,
    }}>
      <div style={{ fontSize: 12, color: C.textDim }}>{label}</div>
      <div style={{ textAlign: 'right' }}>
        <div style={{ fontSize: 16, fontWeight: 700, color: C.text }} className="font-dmmono tabular-nums">
          {fmtNumber(data.count)}
        </div>
        <div style={{ fontSize: 10, color: C.textMuted }}>~{fmtMoney(data.estimatedEUR)}</div>
      </div>
    </div>
  );
}

// ───────────────────────────────────────────────────────────
// ALL SUBSCRIPTIONS
// ───────────────────────────────────────────────────────────

function AllSubscriptionsTab() {
  const { showToast } = useUI();
  const { guarded, overlay } = useGuardedCall();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [cursor, setCursor] = useState(null);
  const [hasMore, setHasMore] = useState(false);
  const [search, setSearch] = useState('');
  const [tierFilter, setTierFilter] = useState('');
  const [selected, setSelected] = useState(new Set());
  const [bulkPrompt, setBulkPrompt] = useState(null); // { kind: 'cancel'|'comp' }

  const load = useCallback(async ({ reset = true } = {}) => {
    setLoading(true);
    try {
      const r = await call('adminListSubscriptions', {
        filters: { tier: tierFilter || undefined },
        cursor: reset ? null : cursor,
        pageSize: 25,
        search,
      });
      setRows(reset ? r.rows : [...rows, ...r.rows]);
      setCursor(r.nextCursor);
      setHasMore(!!r.nextCursor);
    } catch (e) {
      showToast(e?.message || 'Failed to load subscriptions', 'error');
    }
    setLoading(false);
  }, [tierFilter, search, cursor, rows, showToast]);

  useEffect(() => { load({ reset: true }); setSelected(new Set()); /* eslint-disable-next-line */ }, [tierFilter, search]);

  const toggleRow = (id) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id); else next.add(id);
    if (next.size > 50) { showToast('Max 50 per bulk action', 'error'); return; }
    setSelected(next);
  };
  const toggleAllVisible = () => {
    if (selected.size > 0) { setSelected(new Set()); return; }
    setSelected(new Set(rows.slice(0, 50).map(r => r.id)));
  };

  const runBulk = async ({ kind, reason, extra }) => {
    const ids = Array.from(selected);
    try {
      if (kind === 'cancel') {
        const res = await guarded(() => call('adminBulkCancelSubscriptions', { userIds: ids, reason }));
        showToast(`Cancelled ${res.succeeded}/${ids.length} subscriptions`, 'success');
      } else if (kind === 'comp') {
        // extra carries `"lite:30"` (tier:days) — parsed below
        const [tier, daysStr] = String(extra || 'lite:30').split(':');
        const durationDays = Number(daysStr) || 30;
        const res = await guarded(() => call('adminBulkCompSubscriptions', { userIds: ids, tier, durationDays, reason }));
        showToast(`Comped ${res.succeeded}/${ids.length} users with ${tier.toUpperCase()} for ${durationDays}d`, 'success');
      }
      setBulkPrompt(null);
      setSelected(new Set());
      load({ reset: true });
    } catch { /* toast already shown */ }
  };

  return (
    <>
      {overlay}
      {bulkPrompt && (
        <ReasonPrompt
          title={bulkPrompt.kind === 'cancel' ? `Cancel ${selected.size} subscriptions?` : `Comp ${selected.size} users?`}
          message={bulkPrompt.kind === 'cancel'
            ? `Auto-renew will be turned off for ${selected.size} users. Their current period stays active until expiry. This action is audited.`
            : `Selected users will be moved to the chosen plan for the duration below. Auto-renew is OFF on comps (admin must extend manually).`}
          extraField={bulkPrompt.kind === 'comp' ? {
            label: 'Plan + duration (format: tier:days, e.g. lite:30)',
            placeholder: 'lite:30',
            defaultValue: 'lite:30',
            required: true,
          } : null}
          onCancel={() => setBulkPrompt(null)}
          onConfirm={({ reason, extra }) => runBulk({ kind: bulkPrompt.kind, reason, extra })}
        />
      )}

      <div style={{
        display: 'flex', gap: 8, flexWrap: 'wrap',
        background: C.card, border: `1px solid ${C.border}`, borderRadius: 12,
        padding: 12, marginBottom: 12,
      }}>
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search by username, name or email"
          style={{
            flex: 1, minWidth: 220, padding: '8px 12px',
            background: '#0a0a14', border: `1px solid ${C.border}`, borderRadius: 8,
            color: C.text, fontSize: 12,
          }}
        />
        <select
          value={tierFilter}
          onChange={e => setTierFilter(e.target.value)}
          style={{
            padding: '8px 12px', borderRadius: 8, border: `1px solid ${C.border}`,
            background: '#0a0a14', color: tierFilter ? C.text : C.textDim, fontSize: 12,
          }}
        >
          <option value="">All Plans</option>
          <option value="lite">Lite</option>
          <option value="pro">Pro</option>
        </select>
      </div>

      {selected.size > 0 && (
        <div style={{
          display: 'flex', gap: 10, alignItems: 'center', padding: '10px 14px',
          background: '#7c3aed20', border: `1px solid ${C.accent}40`, borderRadius: 10,
          marginBottom: 12,
        }}>
          <div style={{ fontSize: 12, color: C.text, fontWeight: 600 }}>
            {selected.size} selected
          </div>
          <div style={{ flex: 1 }} />
          <button onClick={() => setBulkPrompt({ kind: 'cancel' })} style={{
            padding: '8px 14px', borderRadius: 8, background: '#f04060', color: '#fff',
            border: 0, fontSize: 12, fontWeight: 600, cursor: 'pointer',
          }}>Cancel selected</button>
          <button onClick={() => setBulkPrompt({ kind: 'comp' })} style={{
            padding: '8px 14px', borderRadius: 8, background: C.accent, color: '#fff',
            border: 0, fontSize: 12, fontWeight: 600, cursor: 'pointer',
          }}>Comp selected</button>
          <button onClick={() => setSelected(new Set())} style={{
            padding: '8px 14px', borderRadius: 8, background: 'transparent', color: C.textDim,
            border: `1px solid ${C.border}`, fontSize: 12, cursor: 'pointer',
          }}>Clear</button>
        </div>
      )}

      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, overflow: 'hidden' }}>
        <div style={{
          display: 'grid', gridTemplateColumns: '34px 2fr 80px 100px 80px 120px 100px',
          padding: '10px 14px', borderBottom: `1px solid ${C.border}`,
          fontSize: 10, fontWeight: 700, color: C.textMuted, textTransform: 'uppercase',
          alignItems: 'center',
        }}>
          <input type="checkbox" checked={selected.size > 0 && selected.size === rows.slice(0, 50).length}
            onChange={toggleAllVisible} />
          <div>User</div>
          <div>Plan</div>
          <div>Status</div>
          <div>Price</div>
          <div>Next Billing</div>
          <div style={{ textAlign: 'right' }}>Auto-Renew</div>
        </div>
        {loading && rows.length === 0 && <Empty label="Loading…" />}
        {!loading && rows.length === 0 && <Empty label="No paid subscriptions yet." />}
        {rows.map(r => (
          <div key={r.id} style={{
            display: 'grid', gridTemplateColumns: '34px 2fr 80px 100px 80px 120px 100px',
            padding: '12px 14px', borderBottom: `1px solid ${C.border}`,
            fontSize: 12, color: C.text, alignItems: 'center',
            background: selected.has(r.id) ? '#7c3aed10' : 'transparent',
          }}>
            <input type="checkbox" checked={selected.has(r.id)} onChange={() => toggleRow(r.id)} />
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
              <UserAvatar src={r.avatar} size={28} />
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {r.displayName || r.username || r.id.slice(0, 10)}
                </div>
                <div style={{ fontSize: 10, color: C.textMuted, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {r.email || `@${r.username || '—'}`}
                </div>
              </div>
            </div>
            <TierPill tier={r.tier} />
            <StatusPill status={r.uiStatus} />
            <div className="font-dmmono tabular-nums" style={{ fontSize: 12 }}>
              {fmtMoney(r.priceEUR)}
            </div>
            <div style={{ fontSize: 11, color: C.textDim }}>{r.periodEnd ? fmtDate(r.periodEnd) : '—'}</div>
            <div style={{ textAlign: 'right', fontSize: 11, color: r.autoRenew ? '#22c55e' : '#f0a500', fontWeight: 600 }}>
              {r.autoRenew ? 'ON' : 'OFF'}
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
      </div>
    </>
  );
}

// ───────────────────────────────────────────────────────────
// PLANS & PRICING
// ───────────────────────────────────────────────────────────

function PlansTab() {
  const { showToast } = useUI();
  const { guarded, overlay } = useGuardedCall();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null); // plan object or { __new: true }
  const [scheduling, setScheduling] = useState(null); // plan object

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await call('adminListPlans');
      setRows(r.rows || []);
    } catch (e) {
      showToast(e?.message || 'Failed to load plans', 'error');
    }
    setLoading(false);
  }, [showToast]);

  useEffect(() => { load(); }, [load]);

  const save = async (plan) => {
    try {
      await guarded(() => call('adminUpsertPlan', plan));
      showToast(`Plan ${plan.id} saved`, 'success');
      setEditing(null); load();
    } catch { /* toast shown */ }
  };
  const remove = async (id) => {
    if (!window.confirm(`Delete plan "${id}"? Built-in plans (lite, pro) will be deactivated rather than deleted.`)) return;
    try {
      await guarded(() => call('adminDeletePlan', { id }));
      showToast(`Plan ${id} removed`, 'success');
      load();
    } catch { /* toast shown */ }
  };
  const schedule = async ({ planId, priceEUR, priceCoins, effectiveAt }) => {
    try {
      await guarded(() => call('adminSchedulePriceChange', {
        planId, priceEUR, priceCoins,
        effectiveAt: new Date(effectiveAt).getTime(),
      }));
      showToast('Price change scheduled', 'success');
      setScheduling(null); load();
    } catch { /* toast shown */ }
  };
  const cancelSchedule = async (planId) => {
    try {
      await call('adminCancelScheduledPriceChange', { planId });
      showToast('Scheduled change cancelled', 'success');
      load();
    } catch (e) { showToast(e?.message || 'Failed', 'error'); }
  };

  return (
    <>
      {overlay}
      {editing && <PlanEditor initial={editing} onSave={save} onCancel={() => setEditing(null)} />}
      {scheduling && <ScheduleEditor plan={scheduling} onSave={schedule} onCancel={() => setScheduling(null)} />}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <div style={{ fontSize: 12, color: C.textDim }}>
          Plans drive subscription pricing across the app. Built-in plans (lite, pro) cannot be deleted, only deactivated.
        </div>
        <button onClick={() => setEditing({ __new: true, id: '', priceEUR: 0, priceCoins: 0, periodDays: 30, active: true, features: [] })}
          style={{ padding: '8px 14px', borderRadius: 8, background: C.accent, color: '#fff', border: 0, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
          + Create plan
        </button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 12 }}>
        {loading && rows.length === 0 && <Empty label="Loading…" />}
        {rows.map(p => (
          <div key={p.id} style={{
            background: C.card, border: `1px solid ${p.active ? C.border : '#f0406040'}`, borderRadius: 12, padding: 16,
            opacity: p.active ? 1 : 0.7,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
              <div style={{ width: 36, height: 36, borderRadius: 8, background: `${p.color || '#7c3aed'}20`, border: `1px solid ${p.color || '#7c3aed'}40`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Icon name={p.id === 'pro' ? 'workspace_premium' : 'bolt'} size={20} />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: C.text }}>{p.displayName || p.name}</div>
                <div style={{ fontSize: 11, color: C.textMuted, fontFamily: 'ui-monospace, monospace' }}>{p.id}</div>
              </div>
              {!p.active && <span style={{ fontSize: 9, padding: '2px 6px', borderRadius: 4, background: '#f0406020', color: '#f04060', fontWeight: 700 }}>INACTIVE</span>}
            </div>
            <div style={{ fontSize: 22, fontWeight: 800, color: C.text }} className="font-dmmono tabular-nums">
              {fmtMoney(p.priceEUR)} <span style={{ fontSize: 11, color: C.textDim, fontWeight: 500 }}>/ {p.periodDays}d</span>
            </div>
            <div style={{ fontSize: 11, color: C.textDim, marginTop: 2 }}>
              or {fmtNumber(p.priceCoins)} coins
            </div>
            {p.scheduledPrice && (
              <div style={{ marginTop: 10, padding: 10, background: '#f0a50015', border: '1px solid #f0a50040', borderRadius: 8 }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: '#f0a500', textTransform: 'uppercase' }}>Price change scheduled</div>
                <div style={{ fontSize: 12, color: C.text, marginTop: 4 }}>
                  {p.scheduledPrice.priceEUR != null && <>→ {fmtMoney(p.scheduledPrice.priceEUR)}</>}
                  {p.scheduledPrice.priceCoins != null && <> · {fmtNumber(p.scheduledPrice.priceCoins)} coins</>}
                </div>
                <div style={{ fontSize: 11, color: C.textDim, marginTop: 2 }}>
                  Effective {fmtDate(p.scheduledPrice.effectiveAt)}
                </div>
                <button onClick={() => cancelSchedule(p.id)} style={{
                  marginTop: 8, padding: '4px 10px', borderRadius: 6, background: 'transparent',
                  border: '1px solid #f0a50060', color: '#f0a500', fontSize: 10, fontWeight: 600, cursor: 'pointer',
                }}>Cancel scheduled change</button>
              </div>
            )}
            {p.tagline && <div style={{ fontSize: 12, color: C.textDim, marginTop: 10, fontStyle: 'italic' }}>{p.tagline}</div>}
            <ul style={{ margin: '10px 0 0', padding: 0, listStyle: 'none', fontSize: 11, color: C.textDim }}>
              {(p.features || []).slice(0, 5).map((f, i) => (
                <li key={i} style={{ padding: '2px 0' }}>• {f}</li>
              ))}
            </ul>
            <div style={{ display: 'flex', gap: 6, marginTop: 12 }}>
              <button onClick={() => setEditing(p)} style={{ flex: 1, padding: '6px 10px', borderRadius: 6, background: 'transparent', border: `1px solid ${C.border}`, color: C.text, fontSize: 11, cursor: 'pointer' }}>Edit</button>
              <button onClick={() => setScheduling(p)} style={{ flex: 1, padding: '6px 10px', borderRadius: 6, background: 'transparent', border: `1px solid ${C.border}`, color: C.text, fontSize: 11, cursor: 'pointer' }}>Schedule price</button>
              <button onClick={() => remove(p.id)} style={{ padding: '6px 10px', borderRadius: 6, background: 'transparent', border: '1px solid #f0406040', color: '#f04060', fontSize: 11, cursor: 'pointer' }}>{['lite','pro'].includes(p.id) ? 'Deactivate' : 'Delete'}</button>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

function PlanEditor({ initial, onSave, onCancel }) {
  const isNew = initial?.__new;
  const [form, setForm] = useState({
    id: initial.id || '',
    name: initial.name || initial.id || '',
    displayName: initial.displayName || '',
    priceEUR: initial.priceEUR ?? 0,
    priceCoins: initial.priceCoins ?? 0,
    periodDays: initial.periodDays || 30,
    color: initial.color || '#7B6FFF',
    tagline: initial.tagline || '',
    features: (initial.features || []).join('\n'),
    active: initial.active !== false,
  });
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const submit = () => {
    onSave({
      ...form,
      priceEUR: Number(form.priceEUR),
      priceCoins: Number(form.priceCoins),
      periodDays: Number(form.periodDays),
      features: form.features.split('\n').map(s => s.trim()).filter(Boolean),
    });
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)', zIndex: 250, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 22, width: 520, maxWidth: '95vw', maxHeight: '90vh', overflow: 'auto' }}>
        <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: C.text }}>{isNew ? 'Create plan' : `Edit plan: ${form.id}`}</h3>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 14 }}>
          <Field label="Plan ID" disabled={!isNew} value={form.id} onChange={v => set('id', v)} placeholder="lite | pro | custom_id" />
          <Field label="Display name" value={form.displayName} onChange={v => set('displayName', v)} placeholder="VERGR Lite" />
          <Field label="Price (EUR)" type="number" value={form.priceEUR} onChange={v => set('priceEUR', v)} />
          <Field label="Price (coins)" type="number" value={form.priceCoins} onChange={v => set('priceCoins', v)} />
          <Field label="Period (days)" type="number" value={form.periodDays} onChange={v => set('periodDays', v)} />
          <Field label="Accent color" value={form.color} onChange={v => set('color', v)} placeholder="#7B6FFF" />
          <div style={{ gridColumn: '1 / -1' }}>
            <Field label="Tagline" value={form.tagline} onChange={v => set('tagline', v)} placeholder="Level up faster" />
          </div>
          <div style={{ gridColumn: '1 / -1' }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: C.textDim, marginBottom: 6 }}>Features (one per line, max 24)</div>
            <textarea rows={6} value={form.features} onChange={e => set('features', e.target.value)}
              style={{ width: '100%', padding: '10px 12px', background: '#0a0a14', border: `1px solid ${C.border}`, borderRadius: 8, color: C.text, fontSize: 12, resize: 'vertical', fontFamily: 'inherit' }} />
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: C.text }}>
            <input type="checkbox" checked={form.active} onChange={e => set('active', e.target.checked)} />
            Active
          </label>
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
          <button onClick={onCancel} style={{ flex: 1, padding: '10px', borderRadius: 8, background: 'transparent', border: `1px solid ${C.border}`, color: C.textDim, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>Cancel</button>
          <button onClick={submit} disabled={!form.id} style={{ flex: 1, padding: '10px', borderRadius: 8, background: C.accent, color: '#fff', border: 0, fontSize: 12, fontWeight: 700, cursor: 'pointer', opacity: !form.id ? 0.5 : 1 }}>
            {isNew ? 'Create' : 'Save'}
          </button>
        </div>
        <p style={{ margin: '10px 0 0', fontSize: 10, color: C.textMuted }}>
          Step-up TOTP required. Action is audited.
        </p>
      </div>
    </div>
  );
}

function ScheduleEditor({ plan, onSave, onCancel }) {
  const minStr = useMemo(() => {
    const d = new Date(Date.now() + 5 * 60 * 1000);
    return d.toISOString().slice(0, 16);
  }, []);
  const [form, setForm] = useState({
    priceEUR: plan.priceEUR,
    priceCoins: plan.priceCoins,
    effectiveAt: minStr,
  });
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)', zIndex: 250, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 22, width: 440, maxWidth: '95vw' }}>
        <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: C.text }}>Schedule price change · {plan.id}</h3>
        <p style={{ margin: '6px 0 14px', fontSize: 12, color: C.textDim }}>
          Current: {fmtMoney(plan.priceEUR)} / {fmtNumber(plan.priceCoins)} coins. The new prices apply at the chosen date via the daily 02:00 UTC cron.
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <Field label="New price (EUR)" type="number" value={form.priceEUR} onChange={v => set('priceEUR', v)} />
          <Field label="New price (coins)" type="number" value={form.priceCoins} onChange={v => set('priceCoins', v)} />
          <div style={{ gridColumn: '1 / -1' }}>
            <Field label="Effective at" type="datetime-local" value={form.effectiveAt} onChange={v => set('effectiveAt', v)} />
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
          <button onClick={onCancel} style={{ flex: 1, padding: '10px', borderRadius: 8, background: 'transparent', border: `1px solid ${C.border}`, color: C.textDim, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>Cancel</button>
          <button onClick={() => onSave({ planId: plan.id, priceEUR: Number(form.priceEUR), priceCoins: Number(form.priceCoins), effectiveAt: form.effectiveAt })}
            style={{ flex: 1, padding: '10px', borderRadius: 8, background: C.accent, color: '#fff', border: 0, fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
            Schedule
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, value, onChange, type = 'text', placeholder, disabled }) {
  return (
    <div>
      <div style={{ fontSize: 11, fontWeight: 600, color: C.textDim, marginBottom: 6 }}>{label}</div>
      <input type={type} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} disabled={disabled}
        style={{ width: '100%', padding: '10px 12px', background: '#0a0a14', border: `1px solid ${C.border}`, borderRadius: 8, color: disabled ? C.textMuted : C.text, fontSize: 12, opacity: disabled ? 0.6 : 1 }} />
    </div>
  );
}

// ───────────────────────────────────────────────────────────
// COMP & OVERRIDES
// ───────────────────────────────────────────────────────────

function CompOverridesTab() {
  const { showToast } = useUI();
  const { guarded, overlay } = useGuardedCall();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('active');
  const [typeFilter, setTypeFilter] = useState('');
  const [composer, setComposer] = useState(null); // 'comp' | 'discount'
  const [revoke, setRevoke] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await call('adminListOverrides', {
        filters: { status: statusFilter || undefined, type: typeFilter || undefined },
        pageSize: 50,
      });
      setRows(r.rows || []);
    } catch (e) { showToast(e?.message || 'Failed to load', 'error'); }
    setLoading(false);
  }, [statusFilter, typeFilter, showToast]);

  useEffect(() => { load(); }, [load]);

  const grantComp = async (form) => {
    try {
      await guarded(() => call('adminCompUser', form));
      showToast('User comped', 'success');
      setComposer(null); load();
    } catch { /* toast shown */ }
  };
  const grantDiscount = async (form) => {
    try {
      await guarded(() => call('adminApplyOverride', form));
      showToast('Discount applied', 'success');
      setComposer(null); load();
    } catch { /* toast shown */ }
  };
  const doRevoke = async ({ reason }) => {
    try {
      await guarded(() => call('adminRevokeOverride', { overrideId: revoke.id, reason }));
      showToast('Override revoked', 'success');
      setRevoke(null); load();
    } catch { /* toast shown */ }
  };

  return (
    <>
      {overlay}
      {composer === 'comp' && <CompComposer onSave={grantComp} onCancel={() => setComposer(null)} />}
      {composer === 'discount' && <DiscountComposer onSave={grantDiscount} onCancel={() => setComposer(null)} />}
      {revoke && (
        <ReasonPrompt
          title={`Revoke ${revoke.type} for ${revoke.user?.displayName || revoke.userId}?`}
          message={revoke.type === 'comp'
            ? 'Comp will be revoked and the user immediately downgraded to free.'
            : 'Discount will be cancelled. Future renewals charge full price.'}
          onCancel={() => setRevoke(null)}
          onConfirm={doRevoke}
        />
      )}

      <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
          style={{ padding: '8px 12px', borderRadius: 8, border: `1px solid ${C.border}`, background: '#0a0a14', color: C.text, fontSize: 12 }}>
          <option value="">All statuses</option>
          <option value="active">Active</option>
          <option value="revoked">Revoked</option>
          <option value="consumed">Consumed</option>
          <option value="expired">Expired</option>
        </select>
        <select value={typeFilter} onChange={e => setTypeFilter(e.target.value)}
          style={{ padding: '8px 12px', borderRadius: 8, border: `1px solid ${C.border}`, background: '#0a0a14', color: C.text, fontSize: 12 }}>
          <option value="">All types</option>
          <option value="comp">Comp</option>
          <option value="discount">Discount</option>
        </select>
        <div style={{ flex: 1 }} />
        <button onClick={() => setComposer('comp')} style={{ padding: '8px 14px', borderRadius: 8, background: C.accent, color: '#fff', border: 0, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>+ Comp user</button>
        <button onClick={() => setComposer('discount')} style={{ padding: '8px 14px', borderRadius: 8, background: 'transparent', color: C.text, border: `1px solid ${C.accent}`, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>+ Apply discount</button>
      </div>

      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, overflow: 'hidden' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '2fr 80px 80px 110px 110px 110px 80px', padding: '10px 14px', borderBottom: `1px solid ${C.border}`, fontSize: 10, fontWeight: 700, color: C.textMuted, textTransform: 'uppercase' }}>
          <div>User</div><div>Type</div><div>Tier</div><div>Detail</div><div>Expires</div><div>Created</div><div style={{ textAlign: 'right' }}>Status</div>
        </div>
        {loading && rows.length === 0 && <Empty label="Loading…" />}
        {!loading && rows.length === 0 && <Empty label="No overrides yet." />}
        {rows.map(r => (
          <div key={r.id} style={{ display: 'grid', gridTemplateColumns: '2fr 80px 80px 110px 110px 110px 80px', padding: '12px 14px', borderBottom: `1px solid ${C.border}`, fontSize: 12, color: C.text, alignItems: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
              <UserAvatar src={r.user?.avatar} size={26} />
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.user?.displayName || r.user?.username || r.userId.slice(0, 10)}</div>
                <div style={{ fontSize: 10, color: C.textMuted }}>{r.reason || '—'}</div>
              </div>
            </div>
            <div><OverrideTypePill type={r.type} /></div>
            <TierPill tier={r.tier} />
            <div style={{ fontSize: 11, color: C.textDim }}>
              {r.type === 'comp' ? `${r.durationDays}d` : `${r.discountPercent}% × ${r.remainingUses}/${r.applyToCount}`}
            </div>
            <div style={{ fontSize: 11, color: C.textDim }}>{fmtDate(r.expiresAt)}</div>
            <div style={{ fontSize: 11, color: C.textDim }}>{fmtRelative(r.createdAt)}</div>
            <div style={{ textAlign: 'right', display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 8 }}>
              <OverrideStatusPill status={r.status} />
              {r.status === 'active' && (
                <button onClick={() => setRevoke(r)} title="Revoke"
                  style={{ background: 'transparent', border: 0, color: '#f04060', cursor: 'pointer', padding: 0 }}>
                  <Icon name="cancel" size={16} />
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

function CompComposer({ onSave, onCancel }) {
  const [form, setForm] = useState({ userId: '', tier: 'lite', durationDays: 30, reason: '' });
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));
  return (
    <ComposerShell title="Comp a user" subtitle="Grant free Lite/Pro for N days. Auto-renew is off — admin must extend manually." onCancel={onCancel} onSave={() => onSave({ ...form, durationDays: Number(form.durationDays) })} disabled={!form.userId || !form.reason.trim()}>
      <Field label="User UID" value={form.userId} onChange={v => set('userId', v)} placeholder="user id" />
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <SelectField label="Tier" value={form.tier} onChange={v => set('tier', v)} options={[{ value: 'lite', label: 'Lite' }, { value: 'pro', label: 'Pro' }]} />
        <Field label="Duration (days)" type="number" value={form.durationDays} onChange={v => set('durationDays', v)} />
      </div>
      <ReasonField value={form.reason} onChange={v => set('reason', v)} />
    </ComposerShell>
  );
}

function DiscountComposer({ onSave, onCancel }) {
  const [form, setForm] = useState({ userId: '', tier: 'lite', discountPercent: 50, applyToCount: 1, reason: '' });
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));
  return (
    <ComposerShell title="Apply discount" subtitle="Apply a % discount to this user's next N renewals." onCancel={onCancel} onSave={() => onSave({ ...form, discountPercent: Number(form.discountPercent), applyToCount: Number(form.applyToCount) })} disabled={!form.userId || !form.reason.trim()}>
      <Field label="User UID" value={form.userId} onChange={v => set('userId', v)} placeholder="user id" />
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
        <SelectField label="Tier" value={form.tier} onChange={v => set('tier', v)} options={[{ value: 'lite', label: 'Lite' }, { value: 'pro', label: 'Pro' }]} />
        <Field label="Discount %" type="number" value={form.discountPercent} onChange={v => set('discountPercent', v)} />
        <Field label="# of renewals" type="number" value={form.applyToCount} onChange={v => set('applyToCount', v)} />
      </div>
      <ReasonField value={form.reason} onChange={v => set('reason', v)} />
    </ComposerShell>
  );
}

function ComposerShell({ title, subtitle, children, onCancel, onSave, disabled }) {
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)', zIndex: 250, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 22, width: 480, maxWidth: '95vw' }}>
        <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: C.text }}>{title}</h3>
        <p style={{ margin: '6px 0 14px', fontSize: 12, color: C.textDim }}>{subtitle}</p>
        <div style={{ display: 'grid', gap: 10 }}>{children}</div>
        <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
          <button onClick={onCancel} style={{ flex: 1, padding: '10px', borderRadius: 8, background: 'transparent', border: `1px solid ${C.border}`, color: C.textDim, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>Cancel</button>
          <button onClick={onSave} disabled={disabled} style={{ flex: 1, padding: '10px', borderRadius: 8, background: C.accent, color: '#fff', border: 0, fontSize: 12, fontWeight: 700, cursor: 'pointer', opacity: disabled ? 0.5 : 1 }}>Save</button>
        </div>
      </div>
    </div>
  );
}

function SelectField({ label, value, onChange, options }) {
  return (
    <div>
      <div style={{ fontSize: 11, fontWeight: 600, color: C.textDim, marginBottom: 6 }}>{label}</div>
      <select value={value} onChange={e => onChange(e.target.value)}
        style={{ width: '100%', padding: '10px 12px', background: '#0a0a14', border: `1px solid ${C.border}`, borderRadius: 8, color: C.text, fontSize: 12 }}>
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  );
}

function ReasonField({ value, onChange }) {
  return (
    <div>
      <div style={{ fontSize: 11, fontWeight: 600, color: C.textDim, marginBottom: 6 }}>Reason (audit log) — min 4 chars</div>
      <textarea rows={3} value={value} onChange={e => onChange(e.target.value)} placeholder="Required."
        style={{ width: '100%', padding: '10px 12px', background: '#0a0a14', border: `1px solid ${C.border}`, borderRadius: 8, color: C.text, fontSize: 12, resize: 'vertical', fontFamily: 'inherit' }} />
    </div>
  );
}

function OverrideTypePill({ type }) {
  const m = type === 'comp'
    ? { bg: '#22c55e20', fg: '#22c55e', label: 'COMP' }
    : { bg: '#3b82f620', fg: '#3b82f6', label: 'DISCOUNT' };
  return <span style={{ fontSize: 9, fontWeight: 700, padding: '3px 6px', borderRadius: 4, background: m.bg, color: m.fg }}>{m.label}</span>;
}

function OverrideStatusPill({ status }) {
  const map = {
    active:   { bg: '#22c55e20', fg: '#22c55e' },
    revoked:  { bg: '#f0406020', fg: '#f04060' },
    consumed: { bg: '#5a5a8520', fg: C.textDim },
    expired:  { bg: '#5a5a8520', fg: C.textDim },
  };
  const m = map[status] || map.active;
  return <span style={{ fontSize: 9, fontWeight: 700, padding: '3px 6px', borderRadius: 4, background: m.bg, color: m.fg, textTransform: 'uppercase' }}>{status}</span>;
}

// ───────────────────────────────────────────────────────────
// SETTINGS
// ───────────────────────────────────────────────────────────

function SettingsTab() {
  const { showToast } = useUI();
  const { guarded, overlay } = useGuardedCall();
  const [settings, setSettings] = useState(null);
  const [draft, setDraft] = useState({});
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await call('adminGetSubscriptionSettings');
      setSettings(r.settings);
      setDraft({});
    } catch (e) { showToast(e?.message || 'Failed to load settings', 'error'); }
  }, [showToast]);

  useEffect(() => { load(); }, [load]);

  const dirty = Object.keys(draft).length > 0;
  const get = (k) => draft[k] !== undefined ? draft[k] : settings?.[k];
  const set = (k, v) => setDraft(d => ({ ...d, [k]: v }));

  const save = async () => {
    setSaving(true);
    try {
      await guarded(() => call('adminSetSubscriptionSettings', { settings: draft }));
      showToast('Settings saved', 'success');
      load();
    } catch { /* toast */ }
    setSaving(false);
  };

  if (!settings) return <Empty label="Loading…" />;

  return (
    <>
      {overlay}
      <Card title="Subscription system flags">
        <p style={{ margin: '0 0 14px', fontSize: 12, color: C.textDim }}>
          These flags control the subscription engine globally. Changes are TOTP-gated and audited.
        </p>
        <ToggleRow label="Subscriptions enabled" subtitle="Master switch. When off, all paid plan signups are blocked."
          value={!!get('enabled')} onChange={v => set('enabled', v)} />
        <ToggleRow label="Allow free signup" subtitle="When off, new users must pick a paid tier on signup."
          value={!!get('allowFreeSignup')} onChange={v => set('allowFreeSignup', v)} />
        <ToggleRow label="Require payment method" subtitle="Users must have a card on file before they can subscribe."
          value={!!get('requirePaymentMethod')} onChange={v => set('requirePaymentMethod', v)} />

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginTop: 14 }}>
          <Field label="Currency (ISO 4217)" value={get('currency') || 'EUR'} onChange={v => set('currency', String(v || '').toUpperCase())} />
          <Field label="Trial days (0 = no trial)" type="number" value={get('trialDays') ?? 0} onChange={v => set('trialDays', Math.max(0, parseInt(v) || 0))} />
          <Field label="Grace period (days)" type="number" value={get('gracePeriodDays') ?? 3} onChange={v => set('gracePeriodDays', Math.max(0, parseInt(v) || 0))} />
          <SelectField label="Checkout mode" value={get('checkoutMode') || 'cryptomus'} onChange={v => set('checkoutMode', v)} options={[
            { value: 'cryptomus', label: 'Cryptomus (card + crypto)' },
            { value: 'coins_only', label: 'Coins only' },
            { value: 'disabled', label: 'Disabled' },
          ]} />
        </div>

        <div style={{ display: 'flex', gap: 8, marginTop: 18 }}>
          <button onClick={() => setDraft({})} disabled={!dirty} style={{ padding: '10px 16px', borderRadius: 8, background: 'transparent', border: `1px solid ${C.border}`, color: C.textDim, fontSize: 12, fontWeight: 600, cursor: 'pointer', opacity: dirty ? 1 : 0.5 }}>Reset</button>
          <button onClick={save} disabled={!dirty || saving} style={{ padding: '10px 18px', borderRadius: 8, background: C.accent, color: '#fff', border: 0, fontSize: 12, fontWeight: 700, cursor: 'pointer', opacity: !dirty ? 0.5 : 1 }}>
            {saving ? 'Saving…' : 'Save changes'}
          </button>
          {dirty && <span style={{ alignSelf: 'center', fontSize: 11, color: '#f0a500', fontWeight: 600 }}>{Object.keys(draft).length} unsaved change{Object.keys(draft).length === 1 ? '' : 's'}</span>}
        </div>
      </Card>
    </>
  );
}

function ToggleRow({ label, subtitle, value, onChange }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 0', borderBottom: `1px dashed ${C.border}` }}>
      <div>
        <div style={{ fontSize: 13, fontWeight: 600, color: C.text }}>{label}</div>
        {subtitle && <div style={{ fontSize: 11, color: C.textDim, marginTop: 2 }}>{subtitle}</div>}
      </div>
      <button onClick={() => onChange(!value)} style={{
        width: 42, height: 24, borderRadius: 999, border: 0, padding: 0,
        background: value ? C.accent : '#3a3a4a', position: 'relative', cursor: 'pointer',
        transition: 'background 120ms',
      }}>
        <span style={{
          position: 'absolute', top: 2, left: value ? 20 : 2,
          width: 20, height: 20, borderRadius: '50%', background: '#fff',
          transition: 'left 120ms',
        }} />
      </button>
    </div>
  );
}

// ───────────────────────────────────────────────────────────
// LOGS
// ───────────────────────────────────────────────────────────

function LogsTab() {
  const { showToast } = useUI();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await call('adminListSubscriptionLogs', { limit: 100 });
      setRows(r.rows || []);
    } catch (e) { showToast(e?.message || 'Failed to load logs', 'error'); }
    setLoading(false);
  }, [showToast]);

  useEffect(() => { load(); }, [load]);

  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, overflow: 'hidden' }}>
      <div style={{ display: 'grid', gridTemplateColumns: '140px 160px 1fr 140px', padding: '10px 14px', borderBottom: `1px solid ${C.border}`, fontSize: 10, fontWeight: 700, color: C.textMuted, textTransform: 'uppercase' }}>
        <div>When</div>
        <div>Source</div>
        <div>Action</div>
        <div>Target</div>
      </div>
      {loading && rows.length === 0 && <Empty label="Loading…" />}
      {!loading && rows.length === 0 && <Empty label="No subscription events yet." />}
      {rows.map((r, i) => (
        <div key={`${r.source}_${r.id}_${i}`} style={{ display: 'grid', gridTemplateColumns: '140px 160px 1fr 140px', padding: '10px 14px', borderBottom: `1px solid ${C.border}`, fontSize: 12, color: C.text, alignItems: 'center' }}>
          <div style={{ fontSize: 11, color: C.textDim }}>{fmtRelative(r.createdAt)}</div>
          <div>
            <span style={{ fontSize: 9, fontWeight: 700, padding: '3px 6px', borderRadius: 4, background: r.source === 'admin_action' ? '#7c3aed20' : '#22c55e20', color: r.source === 'admin_action' ? '#b44fff' : '#22c55e', textTransform: 'uppercase' }}>
              {r.source === 'admin_action' ? 'Admin' : 'Event'}
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ fontFamily: 'ui-monospace, monospace', fontSize: 11 }}>{r.action}</div>
            {r.actor && (
              <>
                <span style={{ color: C.textMuted }}>·</span>
                <UserAvatar src={r.actor.avatar} size={20} />
                <span style={{ fontSize: 11, color: C.textDim }}>{r.actor.displayName || r.actor.username || ''}</span>
              </>
            )}
            {r.reason && <span style={{ fontSize: 11, color: C.textMuted, fontStyle: 'italic' }}>— {r.reason}</span>}
          </div>
          <div style={{ fontSize: 10, color: C.textMuted, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {r.target ? `${r.target.type}/${(r.target.id || '').slice(0, 12)}` : '—'}
          </div>
        </div>
      ))}
    </div>
  );
}

// ───────────────────────────────────────────────────────────
// BILLING & INVOICES
// ───────────────────────────────────────────────────────────

function BillingInvoicesTab() {
  const { showToast } = useUI();
  const [stats, setStats] = useState(null);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [s, r] = await Promise.all([
        call('adminGetBillingStats'),
        call('adminListInvoices', { filters: { status: statusFilter || undefined }, pageSize: 50 }),
      ]);
      setStats(s); setRows(r.rows || []);
    } catch (e) {
      showToast(e?.message || 'Failed to load billing', 'error');
    }
    setLoading(false);
  }, [statusFilter, showToast]);

  useEffect(() => { load(); }, [load]);

  return (
    <>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12, marginBottom: 16 }}>
        <KpiCard icon="receipt_long" color="#7c3aed" label="Billed (This Month)"
          value={loading ? '—' : fmtMoney(stats?.totalBilledEUR)} />
        <KpiCard icon="check_circle" color="#22c55e" label="Collected"
          value={loading ? '—' : fmtMoney(stats?.collectedEUR)} />
        <KpiCard icon="schedule" color="#f0a500" label="Pending"
          value={loading ? '—' : fmtMoney(stats?.pendingEUR)} />
        <KpiCard icon="warning" color="#f04060" label="Overdue"
          value={loading ? '—' : fmtMoney(stats?.overdueEUR)} />
        <KpiCard icon="undo" color="#b44fff" label="Refunded (This Month)"
          value={loading ? '—' : fmtMoney(stats?.refundedEUR)} />
      </div>

      <div style={{
        display: 'flex', gap: 8, flexWrap: 'wrap',
        background: C.card, border: `1px solid ${C.border}`, borderRadius: 12,
        padding: 12, marginBottom: 12,
      }}>
        <select
          value={statusFilter}
          onChange={e => setStatusFilter(e.target.value)}
          style={{
            padding: '8px 12px', borderRadius: 8, border: `1px solid ${C.border}`,
            background: '#0a0a14', color: statusFilter ? C.text : C.textDim, fontSize: 12,
          }}
        >
          <option value="">All Statuses</option>
          <option value="paid">Paid</option>
          <option value="pending">Pending</option>
          <option value="overdue">Overdue</option>
          <option value="failed">Failed</option>
          <option value="refunded">Refunded</option>
        </select>
      </div>

      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, overflow: 'hidden' }}>
        <div style={{
          display: 'grid', gridTemplateColumns: '140px 2fr 80px 100px 100px 100px 100px',
          padding: '10px 14px', borderBottom: `1px solid ${C.border}`,
          fontSize: 10, fontWeight: 700, color: C.textMuted, textTransform: 'uppercase',
        }}>
          <div>Invoice ID</div>
          <div>User</div>
          <div>Plan</div>
          <div>Amount</div>
          <div>Issue Date</div>
          <div>Due Date</div>
          <div style={{ textAlign: 'right' }}>Status</div>
        </div>
        {loading && rows.length === 0 && <Empty label="Loading…" />}
        {!loading && rows.length === 0 && (
          <Empty label="No invoices yet. Cryptomus webhook will populate this once the processor goes live." />
        )}
        {rows.map(r => (
          <div key={r.id} style={{
            display: 'grid', gridTemplateColumns: '140px 2fr 80px 100px 100px 100px 100px',
            padding: '12px 14px', borderBottom: `1px solid ${C.border}`,
            fontSize: 12, color: C.text, alignItems: 'center',
          }}>
            <div style={{ fontFamily: 'ui-monospace, monospace', fontSize: 11 }}>{r.invoiceNumber}</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
              <UserAvatar src={r.user?.avatar} size={24} />
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {r.user?.displayName || r.user?.username || '—'}
                </div>
                <div style={{ fontSize: 10, color: C.textMuted, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {r.user?.email || '—'}
                </div>
              </div>
            </div>
            <TierPill tier={r.plan} />
            <div className="font-dmmono tabular-nums">{fmtMoney(r.amount, r.currency === 'EUR' ? '€' : r.currency + ' ')}</div>
            <div style={{ fontSize: 11, color: C.textDim }}>{r.issueDate ? fmtDate(r.issueDate) : '—'}</div>
            <div style={{ fontSize: 11, color: C.textDim }}>{r.dueDate ? fmtDate(r.dueDate) : '—'}</div>
            <div style={{ textAlign: 'right' }}><InvoiceStatusPill status={r.status} /></div>
          </div>
        ))}
      </div>
    </>
  );
}

// ───────────────────────────────────────────────────────────
// Pills + cards + chart primitives
// ───────────────────────────────────────────────────────────

function TierPill({ tier }) {
  if (!tier) return <span style={{ color: C.textMuted, fontSize: 10 }}>—</span>;
  const map = {
    lite: { bg: '#7c3aed20', fg: '#b44fff', label: 'LITE' },
    pro:  { bg: '#f0a50020', fg: '#f0a500', label: 'PRO' },
    free: { bg: '#5a5a8520', fg: C.textDim, label: 'FREE' },
  };
  const m = map[tier] || map.free;
  return (
    <span style={{
      fontSize: 10, fontWeight: 700, padding: '3px 8px', borderRadius: 999,
      background: m.bg, color: m.fg, border: `1px solid ${m.fg}40`,
    }}>{m.label}</span>
  );
}

function StatusPill({ status }) {
  const map = {
    active:    { bg: '#22c55e20', fg: '#22c55e', label: 'ACTIVE' },
    trial:     { bg: '#3b82f620', fg: '#3b82f6', label: 'TRIAL' },
    past_due:  { bg: '#f0a50020', fg: '#f0a500', label: 'PAST DUE' },
    cancelled: { bg: '#5a5a8520', fg: C.textDim, label: 'CANCELLED' },
  };
  const m = map[status] || map.active;
  return (
    <span style={{
      fontSize: 9, fontWeight: 700, padding: '3px 6px', borderRadius: 4,
      background: m.bg, color: m.fg,
    }}>{m.label}</span>
  );
}

function InvoiceStatusPill({ status }) {
  const map = {
    paid:     { bg: '#22c55e20', fg: '#22c55e' },
    pending:  { bg: '#3b82f620', fg: '#3b82f6' },
    overdue:  { bg: '#f0a50020', fg: '#f0a500' },
    failed:   { bg: '#f0406020', fg: '#f04060' },
    refunded: { bg: '#b44fff20', fg: '#b44fff' },
  };
  const m = map[status] || { bg: '#5a5a8520', fg: C.textDim };
  return (
    <span style={{
      fontSize: 10, fontWeight: 700, padding: '3px 8px', borderRadius: 999,
      background: m.bg, color: m.fg, textTransform: 'uppercase',
    }}>{status || '—'}</span>
  );
}

function Card({ title, children }) {
  return (
    <div style={{
      background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 16,
    }}>
      <h3 style={{ margin: 0, marginBottom: 12, fontSize: 13, fontWeight: 700, color: C.text }}>
        {title}
      </h3>
      {children}
    </div>
  );
}

function Empty({ label }) {
  return (
    <div style={{ padding: 24, textAlign: 'center', color: C.textDim, fontSize: 12 }}>{label}</div>
  );
}

function TrendChart({ points }) {
  if (!points || points.length === 0) {
    return <Empty label="No subscription activity in this window." />;
  }
  const W = 600, H = 160, P = 20;
  const maxV = Math.max(1, ...points.map(p => p.lite + p.pro));
  const stepX = points.length > 1 ? (W - 2 * P) / (points.length - 1) : 0;
  const y = (v) => H - P - ((v / maxV) * (H - 2 * P));
  const liteD = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${P + i * stepX} ${y(p.lite)}`).join(' ');
  const proD  = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${P + i * stepX} ${y(p.pro)}`).join(' ');
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ width: '100%', height: 180 }}>
      <path d={liteD} fill="none" stroke="#b44fff" strokeWidth="2" />
      <path d={proD}  fill="none" stroke="#f0a500" strokeWidth="2" />
      {/* Legend */}
      <g transform={`translate(${P}, ${P})`}>
        <rect width="10" height="10" fill="#b44fff" />
        <text x="14" y="9" fontSize="10" fill={C.textDim}>Lite</text>
        <rect x="50" width="10" height="10" fill="#f0a500" />
        <text x="64" y="9" fontSize="10" fill={C.textDim}>Pro</text>
      </g>
    </svg>
  );
}

function PlanDonut({ lite, pro }) {
  const total = lite + pro;
  if (total === 0) return <Empty label="No active paid subscriptions yet." />;
  const litePct = (lite / total) * 100;
  // donut math
  const R = 60, CIRC = 2 * Math.PI * R;
  const liteLen = (litePct / 100) * CIRC;
  const proLen  = CIRC - liteLen;
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-around', padding: '8px 0' }}>
      <svg width="140" height="140" viewBox="0 0 140 140">
        <circle cx="70" cy="70" r={R} fill="none" stroke="#1e1e30" strokeWidth="16" />
        <circle cx="70" cy="70" r={R} fill="none" stroke="#b44fff" strokeWidth="16"
          strokeDasharray={`${liteLen} ${CIRC - liteLen}`} strokeDashoffset={CIRC / 4} transform="rotate(-90 70 70)" />
        <circle cx="70" cy="70" r={R} fill="none" stroke="#f0a500" strokeWidth="16"
          strokeDasharray={`${proLen} ${CIRC - proLen}`} strokeDashoffset={CIRC / 4 - liteLen} transform="rotate(-90 70 70)" />
        <text x="70" y="68" textAnchor="middle" fontSize="20" fontWeight="700" fill={C.text}
          className="font-dmmono tabular-nums">{fmtNumber(total)}</text>
        <text x="70" y="86" textAnchor="middle" fontSize="10" fill={C.textDim}>Total</text>
      </svg>
      <div style={{ fontSize: 12 }}>
        <LegendRow color="#b44fff" label="Lite" count={lite} pct={litePct} />
        <LegendRow color="#f0a500" label="Pro"  count={pro}  pct={100 - litePct} />
      </div>
    </div>
  );
}

function LegendRow({ color, label, count, pct }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0' }}>
      <span style={{ width: 10, height: 10, borderRadius: 2, background: color }} />
      <span style={{ width: 50, color: C.text }}>{label}</span>
      <span style={{ width: 50, color: C.text, fontWeight: 600 }} className="font-dmmono tabular-nums">{fmtNumber(count)}</span>
      <span style={{ color: C.textDim, fontSize: 11 }}>{pct.toFixed(1)}%</span>
    </div>
  );
}
