// AdminSubscriptionsScreen — /admin/subscriptions
//
// Overview / All Subscriptions / Payments / Plans / Comp / Settings / Logs.
//
// ⚠ 2026-09-21: every tab here now shows something real or says plainly what it
// is. Payments reads the subscriptions/ rows each rail writes (the old invoices
// tab read a collection nothing wrote). Plans is READ-ONLY and comes from
// src/utils/tierSystem.js: the old editor saved prices no checkout ever used.
// Settings holds only the two switches the server enforces. Money is USD, and a
// figure built from list prices says so.

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useUI } from '../../context/UIContext';
import Icon from '../../components/Icon';
import UserAvatar from '../../components/UserAvatar';
import AdminShell, { ADMIN_COLORS as C } from './AdminShell';
import { call, fmtNumber, fmtMoney, fmtDate, fmtRelative, KpiCard, Tabs, useGuardedCall, ReasonPrompt } from './_adminGuarded';
import { TIERS } from '../../utils/tierSystem';

const usd = (n) => fmtMoney(n, '$');

// The rail a subscriber pays through (users.subscriptionPreferredMethod).
const RAILS = {
  coins:       { label: 'Coins',       icon: 'toll',            fg: '#f5c842', bg: '#2e2508' },
  card:        { label: 'Card',        icon: 'credit_card',     fg: '#93c5fd', bg: '#0f2140' },
  google_play: { label: 'Google Play', icon: 'shop',            fg: '#86efac', bg: '#0f2a1a' },
  huawei_iap:  { label: 'AppGallery',  icon: 'storefront',      fg: '#fca5a5', bg: '#2f1216' },
  comp:        { label: 'Comp',        icon: 'card_giftcard',   fg: '#d8b4fe', bg: '#241536' },
};
function RailPill({ method }) {
  const r = RAILS[method];
  if (!r) return <span style={{ color: C.textMuted, fontSize: 11 }}>—</span>;
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, fontWeight: 600,
      padding: '3px 8px', borderRadius: 999, background: r.bg, color: r.fg, whiteSpace: 'nowrap',
    }}>
      <Icon name={r.icon} size={13} />{r.label}
    </span>
  );
}

const TABS = [
  { id: 'overview',  label: 'Overview' },
  { id: 'all',       label: 'All Subscriptions' },
  { id: 'billing',   label: 'Payments' },
  { id: 'plans',     label: 'Plans' },
  { id: 'comp',      label: 'Comps' },
  { id: 'settings',  label: 'Settings' },
  { id: 'logs',      label: 'Logs' },
];

export default function AdminSubscriptionsScreen() {
  const [tab, setTab] = useState('overview');

  return (
    <AdminShell
      screen="subscriptions"
      title="Subscriptions"
      subtitle="Who pays for Lite and Pro, how they pay, and the switches that control new plans."
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
        <KpiCard icon="paid" color="#f0a500" label="MRR at list price"
          value={loading ? '—' : usd(stats?.mrrUSD)} sub={stats ? `ARR ${usd(stats.arrUSD)} · store and card prices vary` : null} />
        <KpiCard icon="account_balance" color="#3b82f6" label="Free Users"
          value={loading ? '—' : fmtNumber(stats?.freeCount)} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr 1fr', gap: 16, marginBottom: 16 }}>
        <Card title="New plans (30d)">
          {!trend ? <Empty label="Loading…" /> : <TrendChart points={trend.points} />}
        </Card>
        <Card title="Plan distribution">
          {!stats ? <Empty label="Loading…" /> : (
            <PlanDonut lite={stats.liteCount} pro={stats.proCount} />
          )}
        </Card>
        <Card title="How subscribers pay">
          {!stats ? <Empty label="Loading…" /> : <RailBreakdown byRail={stats.byRail || {}} total={stats.activeSubscriptions || 0} />}
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
              <RailPill method={r.method === 'cancellation' ? null : r.method} />
              <TierPill tier={r.tier} />
              <div style={{ fontSize: 10, color: C.textDim, width: 90, textAlign: 'right' }}>
                {r.method === 'cancellation' ? 'cancelled · ' : ''}{fmtRelative(r.createdAt)}
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
      padding: '12px 0', borderBottom: `1px solid ${C.border}`,
    }}>
      <div style={{ fontSize: 12, color: C.textDim }}>{label}</div>
      <div style={{ textAlign: 'right' }}>
        <div style={{ fontSize: 16, fontWeight: 700, color: C.text }} className="font-dmmono tabular-nums">
          {fmtNumber(data.count)}
        </div>
        <div style={{ fontSize: 10, color: C.textMuted }}>~{usd(data.estimatedUSD)} at list price</div>
      </div>
    </div>
  );
}

function RailBreakdown({ byRail, total }) {
  const order = ['coins', 'card', 'google_play', 'huawei_iap', 'comp'];
  if (!total) return <Empty label="No paid plans yet." />;
  return (
    <div style={{ display: 'grid', gap: 10 }}>
      {order.map((k) => {
        const n = byRail[k] || 0;
        const pct = total ? Math.round((n / total) * 100) : 0;
        return (
          <div key={k}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
              <RailPill method={k} />
              <span className="font-dmmono tabular-nums" style={{ fontSize: 12, color: C.text }}>{fmtNumber(n)}</span>
            </div>
            <div style={{ height: 6, borderRadius: 999, background: '#1d1d2c', overflow: 'hidden' }}>
              <div style={{ width: `${pct}%`, height: '100%', background: RAILS[k].fg }} />
            </div>
          </div>
        );
      })}
      <div style={{ fontSize: 11, color: C.textMuted, lineHeight: 1.5 }}>
        Counts use each subscriber's payment rail. Anyone else on a paid plan predates the rail field.
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
          display: 'grid', gridTemplateColumns: '34px 2fr 80px 100px 120px 120px 100px',
          padding: '10px 14px', borderBottom: `1px solid ${C.border}`,
          fontSize: 10, fontWeight: 700, color: C.textMuted, textTransform: 'uppercase',
          alignItems: 'center',
        }}>
          <input type="checkbox" checked={selected.size > 0 && selected.size === rows.slice(0, 50).length}
            onChange={toggleAllVisible} />
          <div>User</div>
          <div>Plan</div>
          <div>Status</div>
          <div>Paid via</div>
          <div>Period ends</div>
          <div style={{ textAlign: 'right' }}>Auto-Renew</div>
        </div>
        {loading && rows.length === 0 && <Empty label="Loading…" />}
        {!loading && rows.length === 0 && <Empty label="No paid subscriptions yet." />}
        {rows.map(r => (
          <div key={r.id} style={{
            display: 'grid', gridTemplateColumns: '34px 2fr 80px 100px 120px 120px 100px',
            padding: '12px 14px', borderBottom: `1px solid ${C.border}`,
            fontSize: 12, color: C.text, alignItems: 'center',
            background: selected.has(r.id) ? '#1a1430' : 'transparent',
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
            <div><RailPill method={r.method} /></div>
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
// PLANS (read-only)
// ───────────────────────────────────────────────────────────

function PlansTab() {
  // Read-only on purpose. A price lives in code (src/utils/tierSystem.js, the
  // card checkout in functions/payram.js) and in the Play and AppGallery
  // consoles. The editor that used to sit here saved a plans/ collection no
  // checkout ever read, so a "price change" changed nothing anyone paid.
  const COINS = { lite: 500, pro: 1000 };
  const STORE_ID = { lite: 'sub_lite', pro: 'sub_pro' };
  return (
    <>
      <div style={{ margin: '0 0 14px', padding: '12px 14px', borderRadius: 10, background: C.card, color: C.textDim, fontSize: 12, lineHeight: 1.6 }}>
        Prices are shown, not edited, here. The web price and plan perks come from the app's code; Google Play and
        AppGallery prices are set per country in their consoles under the product IDs below. Changing a price means
        changing it in those places, together.
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 12 }}>
        {['lite', 'pro'].map((id) => {
          const t = TIERS[id];
          return (
            <div key={id} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 18 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
                <TierPill tier={id} />
                <div style={{ fontSize: 15, fontWeight: 700, color: C.text }}>{t.name}</div>
                <div style={{ flex: 1 }} />
                <div style={{ fontSize: 11, color: C.textMuted }}>{t.tagline}</div>
              </div>
              <div className="font-dmmono tabular-nums" style={{ fontSize: 26, fontWeight: 800, color: C.text }}>
                {usd(t.price)}<span style={{ fontSize: 12, color: C.textDim, fontWeight: 500 }}> / month list</span>
              </div>
              <div style={{ display: 'grid', gap: 8, marginTop: 14 }}>
                <PriceRow rail="coins" value={`${fmtNumber(COINS[id])} coins`} note="Charged from the wallet; renews automatically if the balance covers it." />
                <PriceRow rail="card" value={usd(t.price)} note="Base price, adjusted by region at checkout and charged in USD." />
                <PriceRow rail="google_play" value={STORE_ID[id]} mono note="Price per market in Play Console." />
                <PriceRow rail="huawei_iap" value={STORE_ID[id]} mono note="Price per market in AppGallery Connect." />
              </div>
              <div style={{ marginTop: 14, fontSize: 10, fontWeight: 700, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0.05em' }}>What the plan includes</div>
              <ul style={{ margin: '6px 0 0', padding: 0, listStyle: 'none', fontSize: 12, color: C.textDim, display: 'grid', gap: 4 }}>
                {(t.features || []).map((f) => (
                  <li key={f} style={{ display: 'flex', gap: 6 }}><Icon name="check" size={14} />{f}</li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>
    </>
  );
}

function PriceRow({ rail, value, note, mono }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr', gap: 10, alignItems: 'start' }}>
      <RailPill method={rail} />
      <div>
        <div style={{ fontSize: 13, fontWeight: 600, color: C.text, fontFamily: mono ? 'ui-monospace, monospace' : undefined }}>{value}</div>
        <div style={{ fontSize: 11, color: C.textMuted, marginTop: 1 }}>{note}</div>
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
  const [composer, setComposer] = useState(null); // 'comp'
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
        </select>
        <div style={{ flex: 1 }} />
        <button onClick={() => setComposer('comp')} style={{ padding: '8px 14px', borderRadius: 8, background: C.accent, color: '#fff', border: 0, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>+ Comp user</button>
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
  const set = (k, v) => setDraft(d => {
    const next = { ...d, [k]: v };
    if (settings && settings[k] === v) delete next[k];
    return next;
  });

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
  const paused = !!get('newSubscriptionsPaused');
  const grace = get('gracePeriodDays') ?? 3;

  return (
    <>
      {overlay}
      <div style={{ display: 'grid', gap: 12, maxWidth: 760 }}>
        <SettingCard
          icon={paused ? 'pause_circle' : 'play_circle'}
          accent={paused ? '#f5c842' : '#4ade80'}
          title="New subscriptions"
          status={paused ? 'Paused' : 'Open'}
          body={paused
            ? 'Nobody can start a new plan. Existing plans keep working and renewing, and people can still cancel.'
            : 'Anyone can start Lite or Pro with coins, a card, Google Play or AppGallery.'}
          detail="Coins and card are refused on the server. Google Play and AppGallery are stopped by hiding the buy buttons in the app, because those stores charge before Vergr is asked."
        >
          <Switch on={!paused} onChange={(v) => set('newSubscriptionsPaused', !v)} label={paused ? 'Resume' : 'Pause'} />
        </SettingCard>

        <SettingCard
          icon="hourglass_bottom"
          accent="#93c5fd"
          title="Grace period"
          status={grace === 0 ? 'None' : `${grace} day${grace === 1 ? '' : 's'}`}
          body="How long a coin or card subscriber keeps their plan after it ends before being moved to Free. Coin plans keep retrying the renewal during this time, so topping up saves the plan."
          detail="Google Play and AppGallery plans never use this: the store decides when they end, and the daily store sync applies it."
        >
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {[0, 1, 3, 7, 14].map((d) => (
              <button key={d} type="button" onClick={() => set('gracePeriodDays', d)} style={{
                padding: '7px 12px', borderRadius: 8, border: 0, cursor: 'pointer',
                fontSize: 12, fontWeight: 700,
                background: grace === d ? C.accent : '#1d1d2c', color: grace === d ? '#fff' : C.textDim,
              }}>{d === 0 ? 'None' : `${d}d`}</button>
            ))}
          </div>
        </SettingCard>

        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 4 }}>
          <button onClick={save} disabled={!dirty || saving} style={{
            padding: '10px 18px', borderRadius: 8, border: 0, fontSize: 12, fontWeight: 700,
            background: dirty ? C.accent : '#26263a', color: dirty ? '#fff' : C.textMuted,
            cursor: dirty && !saving ? 'pointer' : 'default',
          }}>
            {saving ? 'Saving…' : 'Save changes'}
          </button>
          {dirty && (
            <button onClick={() => setDraft({})} style={{ padding: '10px 14px', borderRadius: 8, border: 0, background: 'transparent', color: C.textDim, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
              Discard
            </button>
          )}
          {dirty && <span style={{ fontSize: 11, color: '#f5c842', fontWeight: 600 }}>Unsaved. Saving asks for your authenticator code.</span>}
        </div>
      </div>
    </>
  );
}

function SettingCard({ icon, accent, title, status, body, detail, children }) {
  return (
    <div style={{ background: C.card, borderRadius: 12, padding: 18, display: 'grid', gridTemplateColumns: '40px 1fr auto', gap: 14, alignItems: 'start' }}>
      <div style={{ width: 40, height: 40, borderRadius: 10, background: '#1d1d2c', color: accent, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Icon name={icon} size={22} />
      </div>
      <div style={{ minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: C.text }}>{title}</div>
          <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 999, background: '#1d1d2c', color: accent, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{status}</span>
        </div>
        <div style={{ fontSize: 12, color: C.textDim, marginTop: 6, lineHeight: 1.55 }}>{body}</div>
        <div style={{ fontSize: 11, color: C.textMuted, marginTop: 6, lineHeight: 1.5 }}>{detail}</div>
      </div>
      <div style={{ alignSelf: 'center' }}>{children}</div>
    </div>
  );
}

function Switch({ on, onChange, label }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} onClick={() => onChange(!on)} style={{
      width: 46, height: 26, borderRadius: 999, border: 0, padding: 0, cursor: 'pointer',
      background: on ? '#22a35a' : '#3a3a4a', position: 'relative', transition: 'background 120ms',
    }}>
      <span style={{
        position: 'absolute', top: 3, left: on ? 23 : 3, width: 20, height: 20, borderRadius: '50%',
        background: '#fff', transition: 'left 120ms',
      }} />
    </button>
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
// PAYMENTS
// ───────────────────────────────────────────────────────────

function BillingInvoicesTab() {
  const { showToast } = useUI();
  const [stats, setStats] = useState(null);
  const [rows, setRows] = useState([]);
  const [cursor, setCursor] = useState(null);
  const [loading, setLoading] = useState(true);
  const [method, setMethod] = useState('');

  const load = useCallback(async ({ more = false, after = null } = {}) => {
    setLoading(true);
    try {
      const [s, r] = await Promise.all([
        more ? Promise.resolve(null) : call('adminGetBillingStats'),
        call('adminListInvoices', { filters: { method: method || undefined }, cursor: after, pageSize: 40 }),
      ]);
      if (s) setStats(s);
      setRows((prev) => more ? [...prev, ...(r.rows || [])] : (r.rows || []));
      setCursor(r.nextCursor || null);
    } catch (e) {
      showToast(e?.message || 'Failed to load payments', 'error');
    }
    setLoading(false);
  }, [method, showToast]);

  useEffect(() => { load(); }, [load]);

  const bm = stats?.byMethod || {};
  const monthLabel = stats ? new Date(stats.monthStartMs).toLocaleDateString(undefined, { month: 'long', year: 'numeric' }) : '';

  return (
    <>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 12, marginBottom: 16 }}>
        <KpiCard icon="receipt_long" color="#7c3aed" label={`Payments · ${monthLabel || 'this month'}`}
          value={stats ? fmtNumber(stats.payments) : '—'} />
        <KpiCard icon="toll" color="#f5c842" label="Paid in coins"
          value={stats ? `${fmtNumber(bm.coins?.coins || 0)} coins` : '—'} sub={stats ? `${fmtNumber(bm.coins?.count || 0)} payments` : null} />
        <KpiCard icon="credit_card" color="#93c5fd" label="Paid by card"
          value={stats ? usd(bm.card?.usd || 0) : '—'} sub={stats ? `${fmtNumber(bm.card?.count || 0)} payments, incl. fees and tax` : null} />
        <KpiCard icon="shop" color="#86efac" label="Google Play"
          value={stats ? fmtNumber(bm.google_play?.count || 0) : '—'} sub="payments · price set per market" />
        <KpiCard icon="storefront" color="#fca5a5" label="AppGallery"
          value={stats ? fmtNumber(bm.huawei_iap?.count || 0) : '—'} sub="payments · price set per market" />
      </div>

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
        {[['', 'All'], ['coins', 'Coins'], ['card', 'Card'], ['google_play', 'Google Play'], ['huawei_iap', 'AppGallery']].map(([k, label]) => (
          <button key={k || 'all'} type="button" onClick={() => setMethod(k)} style={{
            padding: '7px 12px', borderRadius: 999, border: 0, cursor: 'pointer', fontSize: 12, fontWeight: 600,
            background: method === k ? C.accent : '#1d1d2c', color: method === k ? '#fff' : C.textDim,
          }}>{label}</button>
        ))}
      </div>

      <div style={{ background: C.card, borderRadius: 12, overflow: 'hidden' }}>
        <div style={{
          display: 'grid', gridTemplateColumns: '2fr 120px 70px 130px 150px 110px',
          padding: '10px 14px', borderBottom: `1px solid ${C.border}`,
          fontSize: 10, fontWeight: 700, color: C.textMuted, textTransform: 'uppercase',
        }}>
          <div>User</div><div>Paid via</div><div>Plan</div><div>Amount</div><div>Covers</div><div style={{ textAlign: 'right' }}>When</div>
        </div>
        {loading && rows.length === 0 && <Empty label="Loading…" />}
        {!loading && rows.length === 0 && (
          <Empty label={method ? 'No payments through this rail yet.' : 'No subscription payments yet. Each one appears here the moment a plan is paid for, on any rail.'} />
        )}
        {rows.map(r => (
          <div key={r.id} style={{
            display: 'grid', gridTemplateColumns: '2fr 120px 70px 130px 150px 110px',
            padding: '12px 14px', borderBottom: `1px solid ${C.border}`,
            fontSize: 12, color: C.text, alignItems: 'center',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
              <UserAvatar src={r.user?.avatar} size={24} />
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {r.user?.displayName || r.user?.username || (r.userId || '').slice(0, 10) || '—'}
                </div>
                <div style={{ fontSize: 10, color: C.textMuted, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {r.user?.email || (r.user?.username ? `@${r.user.username}` : '—')}
                </div>
              </div>
            </div>
            <div><RailPill method={r.method} /></div>
            <TierPill tier={r.tier} />
            <div className="font-dmmono tabular-nums">
              {r.amount?.kind === 'coins' ? `${fmtNumber(r.amount.value)} coins`
                : r.amount?.kind === 'usd' ? usd(r.amount.value)
                : <span style={{ color: C.textMuted }}>set by the store</span>}
              {r.renewal && <div style={{ fontSize: 10, color: C.textMuted }}>renewal</div>}
            </div>
            <div style={{ fontSize: 11, color: C.textDim }}>
              {r.periodStart ? fmtDate(r.periodStart) : '—'} to {r.periodEnd ? fmtDate(r.periodEnd) : '—'}
            </div>
            <div style={{ fontSize: 11, color: C.textDim, textAlign: 'right' }}>{fmtRelative(r.createdAt)}</div>
          </div>
        ))}
        {cursor && (
          <div style={{ padding: 12, textAlign: 'center' }}>
            <button onClick={() => load({ more: true, after: cursor })} disabled={loading} style={{
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
// Pills + cards + chart primitives
// ───────────────────────────────────────────────────────────

function TierPill({ tier }) {
  if (!tier) return <span style={{ color: C.textMuted, fontSize: 10 }}>—</span>;
  const map = {
    lite: { bg: '#241536', fg: '#c4a1ff', label: 'LITE' },
    pro:  { bg: '#2e2508', fg: '#f5c842', label: 'PRO' },
    free: { bg: '#1d1d2c', fg: C.textDim, label: 'FREE' },
  };
  const m = map[tier] || map.free;
  return (
    <span style={{
      fontSize: 10, fontWeight: 700, padding: '3px 8px', borderRadius: 999,
      background: m.bg, color: m.fg, justifySelf: 'start',
    }}>{m.label}</span>
  );
}
function StatusPill({ status }) {
  const map = {
    active:    { bg: '#0f2a1a', fg: '#4ade80', label: 'ACTIVE' },
    trial:     { bg: '#0f2140', fg: '#93c5fd', label: 'TRIAL' },
    past_due:  { bg: '#2e2508', fg: '#f5c842', label: 'RENEWAL DUE' },
    cancelled: { bg: '#1d1d2c', fg: C.textDim, label: 'ENDED' },
  };
  const m = map[status] || map.active;
  return (
    <span style={{
      fontSize: 9, fontWeight: 700, padding: '3px 6px', borderRadius: 4,
      background: m.bg, color: m.fg, justifySelf: 'start',
    }}>{m.label}</span>
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
