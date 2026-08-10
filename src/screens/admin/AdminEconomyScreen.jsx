// AdminEconomyScreen — /admin/economy
//
// Tabs: Overview / Grant / Withdrawals / Transactions / Settings
//
// Note: refunds do not exist on VERGR. The Withdrawals tab can Approve a
// queued request, Mark it Processing, Mark it Sent, or Cancel it (which
// returns the held gems to the user wallet). Once a withdrawal is Sent it
// is final — there is no reversal action.
//
// All write actions go through guarded callables (audit + TOTP step-up + rate limit).

import { useState, useEffect, useCallback } from 'react';
import { useUI } from '../../context/UIContext';
import Icon from '../../components/Icon';
import UserAvatar from '../../components/UserAvatar';
import AdminShell, { ADMIN_COLORS as C } from './AdminShell';
import {
  call, fmtNumber, fmtMoney, fmtDate, fmtRelative,
  useGuardedCall, ReasonPrompt, KpiCard, Tabs,
} from './_adminGuarded';

const TABS = [
  { id: 'overview',     label: 'Overview' },
  { id: 'grant',        label: 'Grant' },
  { id: 'payouts',      label: 'Withdrawals' },
  { id: 'transactions', label: 'Transactions' },
  { id: 'settings',     label: 'Settings' },
];

export default function AdminEconomyScreen() {
  const [tab, setTab] = useState('overview');
  const { guarded, overlay } = useGuardedCall();

  return (
    <AdminShell
      screen="economy"
      title="Economy"
      subtitle="Monitor and move the virtual economy."
    >
      <Tabs tabs={TABS} active={tab} onChange={setTab} />
      {tab === 'overview'     && <OverviewTab />}
      {tab === 'grant'        && <GrantTab guarded={guarded} />}
      {tab === 'payouts'      && <PayoutsTab guarded={guarded} />}
      {tab === 'transactions' && <TransactionsTab />}
      {tab === 'settings'     && <SettingsTab guarded={guarded} />}
      {overlay}
    </AdminShell>
  );
}

// ───────────────────────────────────────────────────────────
// OVERVIEW
// ───────────────────────────────────────────────────────────

function OverviewTab() {
  const { showToast } = useUI();
  const [stats, setStats] = useState(null);
  const [topCoins, setTopCoins] = useState([]);
  const [topGems, setTopGems] = useState([]);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const [s, c, g] = await Promise.all([
        call('adminGetEconomyStats'),
        call('adminListTopWallets', { sortBy: 'balance', limit: 5 }),
        call('adminListTopWallets', { sortBy: 'gems',    limit: 5 }),
      ]);
      setStats(s); setTopCoins(c.rows || []); setTopGems(g.rows || []);
    } catch (err) {
      showToast(err?.message || 'Failed to load economy', 'error');
    }
    setLoading(false);
  }, [showToast]);

  useEffect(() => { reload(); }, [reload]);

  return (
    <>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12, marginBottom: 16 }}>
        <KpiCard icon="paid"        color="#f5c542" label="Coins in circulation" value={loading ? '—' : fmtNumber(stats?.coinsInCirculation)} sub={stats ? `${fmtNumber(stats.walletCount)} wallets` : null} />
        <KpiCard icon="diamond"     color="#7c3aed" label="Gems in circulation"  value={loading ? '—' : fmtNumber(stats?.gemsInCirculation)} />
        <KpiCard icon="schedule"    color="#3b82f6" label="Gems pending payout"  value={loading ? '—' : fmtNumber(stats?.gemsPendingPayout)} sub={stats ? `${fmtNumber(stats.pendingPayoutCount)} requests` : null} />
        <KpiCard icon="payments"    color="#22c55e" label="Total paid (all time)" value={loading ? '—' : fmtMoney(stats?.totalPaidEUR)} sub={stats ? `${fmtNumber(stats.totalPayoutsCount)} withdrawals` : null} />
        <KpiCard icon="local_activity" color="#b44fff" label="VP in circulation"  value={loading ? '—' : fmtNumber(stats?.vpInCirculation)} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 16 }}>
        <TopList title="Top coin holders" rows={topCoins} field="balance" suffix="coins" />
        <TopList title="Top gem holders"  rows={topGems}  field="gems"    suffix="gems" />
      </div>
    </>
  );
}

function TopList({ title, rows, field, suffix }) {
  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 16 }}>
      <h3 style={{ margin: 0, fontSize: 13, fontWeight: 700, color: C.text, marginBottom: 12 }}>{title}</h3>
      {rows.length === 0 ? (
        <div style={{ color: C.textDim, fontSize: 12 }}>No data yet.</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {rows.map((r, i) => (
            <div key={r.uid} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ width: 18, fontSize: 11, color: C.textDim, fontWeight: 700 }}>{i + 1}</div>
              <UserAvatar src={r.avatar} size={28} />
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: C.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {r.displayName}
                </div>
                {r.username && <div style={{ fontSize: 10, color: C.textDim }}>@{r.username}</div>}
              </div>
              <div className="font-dmmono tabular-nums" style={{ fontSize: 12, fontWeight: 700, color: C.text }}>
                {fmtNumber(r[field])} {suffix}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ───────────────────────────────────────────────────────────
// GRANT
// ───────────────────────────────────────────────────────────

function GrantTab({ guarded }) {
  const { showToast } = useUI();
  const [search, setSearch] = useState('');
  const [picked, setPicked] = useState(null); // { uid, displayName, ... }
  const [results, setResults] = useState([]);
  const [currency, setCurrency] = useState('coins');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [recent, setRecent] = useState([]);

  // Search users by username — uses the existing adminListUsers callable.
  useEffect(() => {
    const term = search.trim().toLowerCase();
    if (!term) { setResults([]); return; }
    let cancelled = false;
    const t = setTimeout(async () => {
      try {
        const r = await call('adminListUsers', { search: term, pageSize: 8 });
        if (!cancelled) setResults(r.rows || []);
      } catch (err) {
        if (!cancelled) setResults([]);
      }
    }, 250);
    return () => { cancelled = true; clearTimeout(t); };
  }, [search]);

  const loadRecent = useCallback(async () => {
    try {
      const r = await call('adminListTransactions', { type: 'admin_grant', pageSize: 8 });
      setRecent(r.rows || []);
    } catch {}
  }, []);
  useEffect(() => { loadRecent(); }, [loadRecent]);

  const submit = async () => {
    const amt = Number(amount);
    if (!picked) return showToast('Pick a user first', 'error');
    if (!Number.isFinite(amt) || amt === 0) return showToast('Amount must be a non-zero number', 'error');
    if (!reason.trim()) return showToast('Reason required', 'error');
    const callable = currency === 'coins' ? 'adminGrantCoins' : currency === 'vp' ? 'adminGrantVp' : 'adminGrantGems';
    setBusy(true);
    try {
      await guarded(() => call(callable, { targetUid: picked.uid, amount: amt, reason: reason.trim() }));
      showToast(`Granted ${amt} ${currency} to ${picked.displayName}`, 'success');
      setAmount(''); setReason('');
      loadRecent();
    } catch {}
    setBusy(false);
  };

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 360px', gap: 16 }}>
      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 18 }}>
        <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700, color: C.text }}>Grant currency</h3>
        <p style={{ margin: '6px 0 14px', fontSize: 12, color: C.textDim }}>
          Credit (or deduct using a negative amount) coins / gems / VP for a user. Every grant logs to <code>admin_actions/</code> and writes a transaction entry.
        </p>

        <Label>Target user</Label>
        {picked ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: 10, background: '#0a0a14', border: `1px solid ${C.border}`, borderRadius: 8, marginBottom: 12 }}>
            <UserAvatar src={picked.avatar} size={32} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, color: C.text, fontWeight: 600 }}>{picked.displayName}</div>
              {picked.username && <div style={{ fontSize: 11, color: C.textDim }}>@{picked.username}</div>}
            </div>
            <button onClick={() => { setPicked(null); setSearch(''); }} style={iconBtn}><Icon name="close" size={14} /></button>
          </div>
        ) : (
          <>
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search by display name, username, or email"
              style={inputStyle}
              autoFocus
            />
            {search.trim().length >= 2 && results.length === 0 && (
              <div style={{ fontSize: 11, color: C.textDim, padding: '6px 2px' }}>
                No matches. Try a shorter prefix.
              </div>
            )}
            {results.length > 0 && (
              <div style={{ background: '#0a0a14', border: `1px solid ${C.border}`, borderRadius: 8, marginTop: -6, marginBottom: 12, maxHeight: 240, overflowY: 'auto' }}>
                {results.map(r => (
                  <button
                    key={r.uid}
                    onClick={() => { setPicked(r); setSearch(''); setResults([]); }}
                    style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: 10, background: 'transparent', border: 0, color: C.text, cursor: 'pointer', textAlign: 'left' }}
                    onMouseEnter={e => e.currentTarget.style.background = C.card2}
                    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                  >
                    <UserAvatar src={r.avatar} size={28} />
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ fontSize: 12, fontWeight: 600 }}>{r.displayName}</div>
                      {r.username && <div style={{ fontSize: 10, color: C.textDim }}>@{r.username}</div>}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </>
        )}

        <Label>Currency</Label>
        <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
          {['coins', 'gems', 'vp'].map(c => (
            <button
              key={c}
              onClick={() => setCurrency(c)}
              style={{
                flex: 1, padding: 10, borderRadius: 8,
                background: currency === c ? C.accent : 'transparent',
                border: `1px solid ${currency === c ? C.accent : C.border}`,
                color: currency === c ? '#fff' : C.text,
                fontSize: 12, fontWeight: 700, cursor: 'pointer', textTransform: 'uppercase',
              }}
            >{c}</button>
          ))}
        </div>

        <Label>Amount (negative deducts)</Label>
        <input
          type="number"
          value={amount}
          onChange={e => setAmount(e.target.value)}
          placeholder="e.g. 1000 or -500"
          style={inputStyle}
        />

        <Label>Reason (logged to audit, shown to user)</Label>
        <textarea
          rows={3}
          value={reason}
          onChange={e => setReason(e.target.value)}
          placeholder="e.g. Tournament prize correction — match #1234"
          style={{ ...inputStyle, resize: 'vertical', fontFamily: 'inherit' }}
        />

        <button
          onClick={submit}
          disabled={busy || !picked || !amount || !reason.trim()}
          style={{
            marginTop: 14, padding: '12px 18px', borderRadius: 8, border: 0,
            background: busy ? '#555' : C.accent, color: '#fff',
            fontSize: 13, fontWeight: 700, cursor: busy ? 'wait' : 'pointer',
            display: 'inline-flex', alignItems: 'center', gap: 8,
            opacity: (!picked || !amount || !reason.trim()) ? 0.5 : 1,
          }}
        >
          <Icon name={busy ? 'hourglass_top' : 'send'} size={16} />
          {busy ? 'Granting…' : `Grant ${amount || 0} ${currency}`}
        </button>
      </div>

      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 16, alignSelf: 'flex-start' }}>
        <h3 style={{ margin: 0, fontSize: 13, fontWeight: 700, color: C.text, marginBottom: 10 }}>Recent grants</h3>
        {recent.length === 0 ? (
          <div style={{ fontSize: 12, color: C.textDim }}>No recent grants.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {recent.map(r => (
              <div key={r.id} style={{ fontSize: 12, padding: 10, background: C.card2, borderRadius: 8 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'baseline' }}>
                  <span style={{ color: C.text, fontWeight: 600 }}>{r.amount > 0 ? '+' : ''}{fmtNumber(r.amount)} {r.currency}</span>
                  <span style={{ color: C.textDim, fontSize: 10 }}>{fmtRelative(r.createdAt)}</span>
                </div>
                <div style={{ color: C.textDim, fontSize: 11, marginTop: 2 }}>{r.description || '—'}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ───────────────────────────────────────────────────────────
// PAYOUTS
// ───────────────────────────────────────────────────────────

const PAYOUT_STATUS_COLORS = {
  pending:            '#3b82f6',   // Phase 4 default state
  requested:          '#3b82f6',   // legacy
  on_hold:            '#f5c542',   // legacy
  ready:              '#7c3aed',
  processing:         '#b44fff',
  sent:               '#22c55e',
  failed:             '#f04060',   // Phase 4 — Circle reject / on-chain fail
  cancelled:          '#9ca3af',   // Phase 4 — user or admin cancelled
  rejected:           '#f04060',   // legacy
  queued_placeholder: '#f5c542',
};

// Phase 4 status names: `pending` (was: requested + on_hold). Keep legacy
// `requested`/`on_hold`/`ready` so older test rows show up under those pills.
const PAYOUT_FILTERS = [
  { id: 'all',        label: 'All' },
  { id: 'pending',    label: 'Pending' },
  { id: 'ready',      label: 'Ready' },
  { id: 'processing', label: 'Processing' },
  { id: 'sent',       label: 'Sent' },
  { id: 'failed',     label: 'Failed' },
  { id: 'cancelled',  label: 'Cancelled' },
];

function PayoutsTab({ guarded }) {
  const { showToast } = useUI();
  const [filter, setFilter] = useState('pending');
  const [rows, setRows] = useState([]);
  const [users, setUsers] = useState({});
  const [loading, setLoading] = useState(true);
  const [prompt, setPrompt] = useState(null);
  const [reviewing, setReviewing] = useState(null); // { payoutId } | null

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const r = await call('adminListPayoutRequests', { status: filter, pageSize: 50 });
      setRows(r.rows || []); setUsers(r.users || {});
    } catch (err) {
      showToast(err?.message || 'Failed to load payouts', 'error');
    }
    setLoading(false);
  }, [filter, showToast]);

  useEffect(() => { reload(); }, [reload]);

  const act = (payout, action) => {
    const labels = {
      approve: { title: 'Approve withdrawal', msg: 'Moves to "ready" — eligible for processing.', danger: false },
      mark_processing: { title: 'Mark processing', msg: 'Indicates the withdrawal is in flight to the user.', danger: false },
      mark_paid: { title: 'Mark sent', msg: 'Funds have been sent. Optionally attach a transaction hash. This is final — sent withdrawals cannot be reversed.', danger: false, extraField: { label: 'Tx hash (optional)', placeholder: '0x…' } },
      reject:   { title: 'Cancel withdrawal', msg: 'Returns held gems to the user wallet and marks the request rejected. Use this when you cannot fulfil the withdrawal (bad address, KYC issue, suspected abuse). Audit logged.', danger: true },
    };
    const cfg = labels[action];
    setPrompt({
      title: cfg.title,
      message: cfg.msg,
      extraField: cfg.extraField,
      danger: cfg.danger,
      onConfirm: async ({ reason, extra }) => {
        setPrompt(null);
        try {
          await guarded(() => call('adminUpdatePayoutStatus', { payoutId: payout.id, action, reason, txHash: extra || null }));
          showToast(`${cfg.title} ✓`, 'success');
          reload();
        } catch {}
      },
      onCancel: () => setPrompt(null),
    });
  };

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
        {PAYOUT_FILTERS.map(f => (
          <button
            key={f.id}
            onClick={() => setFilter(f.id)}
            style={{
              padding: '7px 12px', borderRadius: 6,
              background: filter === f.id ? `${C.accent}30` : 'transparent',
              border: `1px solid ${filter === f.id ? C.accent : C.border}`,
              color: filter === f.id ? C.text : C.textDim,
              fontSize: 11, fontWeight: 600, cursor: 'pointer',
            }}
          >{f.label}</button>
        ))}
        <button onClick={reload} style={iconBtn}><Icon name="refresh" size={14} /></button>
      </div>

      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 720 }}>
            <thead>
              <tr style={{ background: C.card2 }}>
                {['User', 'Gateway', 'Amount', 'Address', 'Status', 'Requested', 'Actions'].map(h => (
                  <th key={h} style={th}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map(p => {
                const u = users[p.uid] || {};
                const color = PAYOUT_STATUS_COLORS[p.status] || C.textDim;
                return (
                  <tr key={p.id} style={{ borderTop: `1px solid ${C.border}` }}>
                    <td style={td}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <UserAvatar src={u.avatar} size={26} />
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontSize: 12, fontWeight: 600 }}>{u.displayName || p.uid?.slice(0, 8)}</div>
                          {u.username && <div style={{ fontSize: 10, color: C.textDim }}>@{u.username}</div>}
                        </div>
                      </div>
                    </td>
                    <td style={td}><span style={{ fontSize: 11, color: C.textDim }}>{p.destinationType || p.gateway || '—'}</span></td>
                    <td style={td}>
                      <div style={{ fontSize: 12, fontWeight: 600 }} className="font-dmmono tabular-nums">
                        {p.gemsRequested ? `${fmtNumber(p.gemsRequested)} gems` : '—'}
                      </div>
                      {(p.netUSDC || p.amountEUR) && <div style={{ fontSize: 10, color: C.textDim }}>{p.netUSDC ? `${p.netUSDC} USDC` : fmtMoney(p.amountEUR)}</div>}
                    </td>
                    <td style={{ ...td, fontSize: 10, color: C.textDim, fontFamily: 'monospace', maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {p.destinationAddress || p.address || '—'}
                    </td>
                    <td style={td}>
                      <span style={{ padding: '3px 8px', borderRadius: 6, background: `${color}25`, color, fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                        {p.status}
                      </span>
                    </td>
                    <td style={{ ...td, fontSize: 11, color: C.textDim }}>{fmtRelative(p.createdAt)}</td>
                    <td style={td}>
                      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                        {['pending'].includes(p.status) && (
                          <button onClick={() => setReviewing({ payoutId: p.id })} style={miniBtn('#22c55e')}>Review &amp; release</button>
                        )}
                        {['pending', 'requested', 'on_hold', 'queued_placeholder'].includes(p.status) && (
                          <button onClick={() => act(p, 'approve')} style={miniBtn(C.accent)}>Mark ready</button>
                        )}
                        {['ready', 'requested', 'pending'].includes(p.status) && (
                          <button onClick={() => act(p, 'mark_processing')} style={miniBtn('#b44fff')}>Processing</button>
                        )}
                        {['processing', 'ready'].includes(p.status) && (
                          <button onClick={() => act(p, 'mark_paid')} style={miniBtn('#22c55e')}>Mark sent</button>
                        )}
                        {!['sent', 'cancelled', 'rejected', 'failed'].includes(p.status) && (
                          <button onClick={() => act(p, 'reject')} style={miniBtn('#f04060', true)}>Cancel</button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
              {!loading && rows.length === 0 && (
                <tr><td colSpan={7} style={{ padding: 40, textAlign: 'center', color: C.textDim, fontSize: 13 }}>
                  No payouts match this filter.
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
      {prompt && <ReasonPrompt {...prompt} />}
      {reviewing && (
        <ReviewReleaseModal
          payoutId={reviewing.payoutId}
          onClose={() => setReviewing(null)}
          onReleased={() => { setReviewing(null); reload(); }}
          guarded={guarded}
        />
      )}
    </>
  );
}

// ───────────────────────────────────────────────────────────
// REVIEW & RELEASE MODAL
// ───────────────────────────────────────────────────────────
// Shows the user's account dossier (KYC, account age, lifetime payouts,
// recent transactions, ban status) and lets admin approve a pending payout
// to be sent to Circle immediately — bypassing the 3-day hold.

function ReviewReleaseModal({ payoutId, onClose, onReleased, guarded }) {
  const { showToast } = useUI();
  const [ctx, setCtx] = useState(null);
  const [loading, setLoading] = useState(true);
  const [reason, setReason] = useState('');
  const [releasing, setReleasing] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await call('adminGetWithdrawalContext', { payoutId });
        if (!cancelled) setCtx(res);
      } catch (err) {
        if (!cancelled) showToast(err?.message || 'Could not load context', 'error');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [payoutId, showToast]);

  const release = async () => {
    if (reason.trim().length < 4) {
      showToast('Reason must be at least 4 characters', 'error');
      return;
    }
    setReleasing(true);
    try {
      await guarded(() => call('adminReleaseWithdrawalNow', { payoutId, reason: reason.trim() }));
      showToast('Withdrawal submitted to Circle ✓', 'success');
      onReleased?.();
    } catch (err) {
      showToast(err?.message || 'Release failed', 'error');
    }
    setReleasing(false);
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)',
      display: 'grid', placeItems: 'center', zIndex: 100, padding: 16,
    }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{
        background: C.bg, border: `1px solid ${C.border}`, borderRadius: 12,
        width: 640, maxWidth: '100%', maxHeight: '90vh', overflowY: 'auto',
        padding: 24,
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14 }}>
          <div>
            <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>Review &amp; release withdrawal</h3>
            <p style={{ margin: '4px 0 0', fontSize: 12, color: C.textDim }}>
              Bypasses the 3-day hold. Submits directly to Circle. Audited.
            </p>
          </div>
          <button onClick={onClose} style={iconBtn}><Icon name="close" size={16} /></button>
        </div>

        {loading && <div style={{ padding: 20, textAlign: 'center', color: C.textDim }}>Loading…</div>}

        {ctx && (
          <>
            {/* Payout summary */}
            <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: 14, marginBottom: 12 }}>
              <div style={{ fontSize: 11, color: C.textDim, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>Payout</div>
              <Row k="Gems" v={`${fmtNumber(ctx.payout.gemsRequested)} gems`} />
              <Row k="Net USDC" v={`${ctx.payout.netUSDC} USDC`} />
              <Row k="Destination" v={<span style={{ fontFamily: 'monospace', fontSize: 11 }}>{ctx.payout.destinationAddress}</span>} />
              <Row k="Requested" v={fmtRelative(ctx.payout.requestedAt)} />
              <Row k="Originally releases" v={fmtRelative(ctx.payout.releasesAt)} />
            </div>

            {/* User dossier */}
            <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: 14, marginBottom: 12 }}>
              <div style={{ fontSize: 11, color: C.textDim, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>User</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                <UserAvatar src={ctx.user.avatar} size={36} />
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>
                    {ctx.user.displayName}
                    {ctx.user.role === 'admin' && <span style={{ marginLeft: 6, fontSize: 10, color: '#f5c542', fontWeight: 700 }}>ADMIN</span>}
                    {ctx.user.banned && <span style={{ marginLeft: 6, fontSize: 10, color: '#f04060', fontWeight: 700 }}>BANNED</span>}
                  </div>
                  {ctx.user.username && <div style={{ fontSize: 11, color: C.textDim }}>@{ctx.user.username}</div>}
                </div>
              </div>
              <Row k="Account age" v={ctx.user.accountAgeDays != null ? `${ctx.user.accountAgeDays} days` : 'unknown'} />
              <Row k="KYC level" v={`L${ctx.user.kycLevel}`} tone={ctx.user.kycLevel >= 1 ? 'ok' : 'warn'} />
              <Row k="Email" v={ctx.user.email || '—'} />
              <Row k="Followers" v={fmtNumber(ctx.user.followerCount)} />
              <Row k="VP" v={fmtNumber(ctx.user.vp)} />
            </div>

            {/* Wallet + history */}
            <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: 14, marginBottom: 12 }}>
              <div style={{ fontSize: 11, color: C.textDim, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>Wallet &amp; history</div>
              <Row k="Gems balance" v={fmtNumber(ctx.wallet.gems)} />
              <Row k="Gems in escrow" v={fmtNumber(ctx.wallet.gemsInEscrow)} />
              <Row k="Coins balance" v={fmtNumber(ctx.wallet.balance)} />
              <Row k="Lifetime gems earned" v={fmtNumber(ctx.wallet.totalGemsEarned)} />
              <Row k="Prior successful payouts" v={`${ctx.history.lifetimePayouts} (€${ctx.history.lifetimePaidUSDC} total)`} />
            </div>

            {/* Risk-flag heuristics */}
            {(ctx.user.banned || ctx.user.kycLevel === 0 || ctx.user.accountAgeDays < 7 || ctx.history.lifetimePayouts === 0) && (
              <div style={{
                background: '#3d1a1a', border: '1px solid #5d2a2a', borderRadius: 8,
                padding: 10, marginBottom: 12, fontSize: 12, color: '#fca5a5',
              }}>
                <strong>⚠️ Heuristic flags:</strong>{' '}
                {[
                  ctx.user.banned && 'banned account',
                  ctx.user.kycLevel === 0 && 'no KYC',
                  ctx.user.accountAgeDays != null && ctx.user.accountAgeDays < 7 && `account is only ${ctx.user.accountAgeDays} days old`,
                  ctx.history.lifetimePayouts === 0 && 'first-ever payout',
                ].filter(Boolean).join(', ')}
              </div>
            )}

            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 11, color: C.textDim, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 }}>
                Reason (required, logged to audit)
              </div>
              <input value={reason}
                     onChange={e => setReason(e.target.value)}
                     placeholder="e.g. Manually reviewed, KYC verified, low risk"
                     style={{
                       width: '100%', padding: '10px 12px', fontSize: 13,
                       background: C.card, border: `1px solid ${C.border}`, borderRadius: 8,
                       color: C.text, outline: 'none',
                     }} />
            </div>

            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button onClick={onClose} disabled={releasing} style={{
                padding: '10px 16px', borderRadius: 8, background: 'transparent',
                border: `1px solid ${C.border}`, color: C.textDim, fontSize: 12, fontWeight: 600,
                cursor: 'pointer',
              }}>Cancel</button>
              <button onClick={release} disabled={releasing || reason.trim().length < 4} style={{
                padding: '10px 16px', borderRadius: 8, background: '#22c55e',
                border: '1px solid #22c55e', color: '#fff', fontSize: 12, fontWeight: 700,
                cursor: releasing || reason.trim().length < 4 ? 'not-allowed' : 'pointer',
                opacity: releasing || reason.trim().length < 4 ? 0.5 : 1,
              }}>{releasing ? 'Submitting…' : 'Release now'}</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Row({ k, v, tone }) {
  const color = tone === 'ok' ? '#86efac' : tone === 'warn' ? '#fcd34d' : C.text;
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '4px 0', fontSize: 12 }}>
      <span style={{ color: C.textDim }}>{k}</span>
      <span style={{ color, fontWeight: 500 }}>{v}</span>
    </div>
  );
}

// ───────────────────────────────────────────────────────────
// TRANSACTIONS
// ───────────────────────────────────────────────────────────

function TransactionsTab() {
  const { showToast } = useUI();
  const [rows, setRows] = useState([]);
  const [users, setUsers] = useState({});
  const [type, setType] = useState('');
  const [currency, setCurrency] = useState('');
  const [cursor, setCursor] = useState(null);
  const [nextCursor, setNextCursor] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (reset = false) => {
    setLoading(true);
    try {
      const r = await call('adminListTransactions', {
        type: type || null,
        currency: currency || null,
        cursor: reset ? null : cursor,
        pageSize: 50,
      });
      setRows(prev => reset ? r.rows : [...prev, ...r.rows]);
      setUsers(prev => ({ ...prev, ...r.users }));
      setNextCursor(r.nextCursor);
    } catch (err) {
      showToast(err?.message || 'Failed to load transactions', 'error');
    }
    setLoading(false);
  }, [type, currency, cursor, showToast]);

  useEffect(() => {
    setCursor(null); setRows([]);
    load(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type, currency]);

  return (
    <>
      <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
        <select value={type} onChange={e => setType(e.target.value)} style={smallSelect}>
          <option value="">All types</option>
          <option value="admin_grant">Admin grant</option>
          <option value="admin_deduction">Admin deduction</option>
          <option value="coin_purchase">Coin purchase (deposit)</option>
          <option value="coin_to_gem_conversion">Conversion</option>
          <option value="tip">Tip</option>
          <option value="withdrawal_requested">Withdrawal requested</option>
          <option value="withdrawal_cancelled">Withdrawal cancelled</option>
          <option value="withdrawal_failed">Withdrawal failed</option>
          <option value="membership">Membership</option>
        </select>
        <select value={currency} onChange={e => setCurrency(e.target.value)} style={smallSelect}>
          <option value="">All currencies</option>
          <option value="coins">Coins</option>
          <option value="gems">Gems</option>
          <option value="vp">VP</option>
        </select>
      </div>

      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 720 }}>
            <thead>
              <tr style={{ background: C.card2 }}>
                {['When', 'User', 'Type', 'Amount', 'Description'].map(h => <th key={h} style={th}>{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {rows.map(r => {
                const u = users[r.userId] || {};
                const positive = (r.amount || 0) > 0;
                return (
                  <tr key={r.id} style={{ borderTop: `1px solid ${C.border}` }}>
                    <td style={{ ...td, fontSize: 11, color: C.textDim, whiteSpace: 'nowrap' }}>{fmtRelative(r.createdAt)}</td>
                    <td style={td}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <UserAvatar src={u.avatar} size={24} />
                        <div style={{ fontSize: 12, fontWeight: 500 }}>{u.displayName || (r.userId || '').slice(0, 8)}</div>
                      </div>
                    </td>
                    <td style={{ ...td, fontSize: 11, color: C.textDim }}>{r.type}</td>
                    <td style={td}>
                      <span className="font-dmmono tabular-nums" style={{ fontSize: 12, fontWeight: 700, color: positive ? '#22c55e' : '#f04060' }}>
                        {positive ? '+' : ''}{fmtNumber(r.amount)} {r.currency}
                      </span>
                    </td>
                    <td style={{ ...td, fontSize: 11, color: C.textDim, maxWidth: 320, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {r.description || '—'}
                    </td>
                  </tr>
                );
              })}
              {!loading && rows.length === 0 && (
                <tr><td colSpan={5} style={{ padding: 40, textAlign: 'center', color: C.textDim, fontSize: 13 }}>
                  No transactions match these filters.
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
        <div style={{ padding: 12, borderTop: `1px solid ${C.border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ fontSize: 11, color: C.textDim }}>{loading ? 'Loading…' : `${rows.length} loaded`}</div>
          {nextCursor && (
            <button onClick={() => { setCursor(nextCursor); load(false); }} style={miniBtn(C.accent)}>Load more</button>
          )}
        </div>
      </div>
    </>
  );
}

// ───────────────────────────────────────────────────────────
// SETTINGS
// ───────────────────────────────────────────────────────────

const TOGGLE_LABELS = {
  liveStreamingPaused: { label: 'Pause all live streaming', desc: 'Halts new stream sessions platform-wide. Existing streams continue until they end.' },
  freeUploadsPaused:   { label: 'Pause free-tier uploads', desc: 'Free users see an error trying to upload until reactivated. Paid users unaffected.' },
  botsPaused:          { label: 'Pause news bots',          desc: 'Stops scheduled bot posts. Use during a content moderation review.' },
  conversionsPaused:   { label: 'Pause coin → gem conversions', desc: 'Users can\'t convert coins to gems. Useful during economy investigation.' },
  payoutsPaused:       { label: 'Pause payouts',            desc: 'New payout requests are blocked. In-flight payouts continue.' },
  tipsPaused:          { label: 'Pause tipping',            desc: 'Users can\'t send tips. Use only during a real incident.' },
};

function SettingsTab({ guarded }) {
  const { showToast } = useUI();
  const [cfg, setCfg] = useState(null);
  const [busyKey, setBusyKey] = useState(null);

  const reload = useCallback(async () => {
    try { setCfg(await call('adminGetEconomyConfig')); } catch (err) { showToast(err?.message || 'Failed to load config', 'error'); }
  }, [showToast]);

  useEffect(() => { reload(); }, [reload]);

  const toggle = async (key) => {
    setBusyKey(key);
    try {
      await guarded(() => call('adminSetEconomyConfig', { key, value: !cfg[key] }));
      showToast('Updated', 'success');
      await reload();
    } catch {}
    setBusyKey(null);
  };

  if (!cfg) return <div style={{ color: C.textDim, fontSize: 13 }}>Loading…</div>;

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: 12 }}>
      {Object.entries(TOGGLE_LABELS).map(([key, info]) => {
        const on = !!cfg[key];
        return (
          <div key={key} style={{ padding: 16, background: C.card, border: `1px solid ${on ? '#f04060' : C.border}`, borderRadius: 12 }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: C.text }}>{info.label}</div>
                <div style={{ fontSize: 11.5, color: C.textDim, marginTop: 4, lineHeight: 1.5 }}>{info.desc}</div>
              </div>
              <button
                onClick={() => toggle(key)}
                disabled={busyKey === key}
                style={{
                  padding: '8px 12px', borderRadius: 8, border: 0,
                  background: on ? '#f04060' : C.accent,
                  color: '#fff', fontSize: 11, fontWeight: 700, cursor: 'pointer',
                  minWidth: 78, opacity: busyKey === key ? 0.6 : 1,
                }}
              >{on ? 'Resume' : 'Pause'}</button>
            </div>
            <div style={{ marginTop: 10, fontSize: 10, fontWeight: 700, color: on ? '#f04060' : '#22c55e', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              {on ? '● Paused' : '● Active'}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ───────────────────────────────────────────────────────────
// Styles
// ───────────────────────────────────────────────────────────

const inputStyle = {
  width: '100%', padding: '10px 12px',
  background: '#0a0a14', border: `1px solid ${C.border}`, borderRadius: 8,
  color: C.text, fontSize: 13, marginBottom: 12,
};

const smallSelect = {
  padding: '7px 10px', background: '#0a0a14', border: `1px solid ${C.border}`,
  borderRadius: 6, color: C.text, fontSize: 12, appearance: 'none', cursor: 'pointer',
};

const th = { padding: '10px 14px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: C.textDim, textTransform: 'uppercase', letterSpacing: '0.05em' };
const td = { padding: '12px 14px', fontSize: 12, color: C.text };

const iconBtn = {
  padding: '8px 10px', background: 'transparent', border: `1px solid ${C.border}`,
  borderRadius: 6, color: C.textDim, cursor: 'pointer',
};

const miniBtn = (color, danger = false) => ({
  padding: '5px 10px', borderRadius: 6, border: `1px solid ${color}`,
  background: danger ? 'transparent' : `${color}25`,
  color, fontSize: 11, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap',
});

function Label({ children }) {
  return <div style={{ fontSize: 11, fontWeight: 700, color: C.textDim, marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{children}</div>;
}
