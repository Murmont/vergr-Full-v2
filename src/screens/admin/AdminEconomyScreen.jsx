// AdminEconomyScreen — /admin/economy
//
// Tabs: Overview / Grant / Payouts / Transactions / Settings
//
// The Withdrawals tab was replaced by Payouts on 2026-08-17. Users cannot
// withdraw and never could since 2026-08-16: the whole user-initiated flow was
// deleted and its callables undeployed. Money leaves Vergr in exactly ONE way -
// runCreatorPayouts computes what Vergr owes its creators as suppliers and pays
// them on Vergr's schedule, so that is what this screen shows. The legacy
// withdrawal rows are still reachable, collapsed, read-mostly, because a handful
// of pre-deletion test rows exist and a blank screen is worse than a labelled one.
//
// Refunds do not exist. Cancelling a legacy row returns the held amount to the
// wallet; a row already marked Sent can never be reversed.
//
// All write actions go through guarded callables (audit + TOTP step-up + rate limit).

import { useState, useEffect, useCallback } from 'react';
import AdminPromosTab from './AdminPromosTab';
import AdminPaymentsTab from './AdminPaymentsTab';
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
  { id: 'payments',     label: 'Payments' },
  { id: 'grant',        label: 'Grant' },
  { id: 'payouts',      label: 'Creator payouts' },
  { id: 'promos',       label: 'Coin sales' },
  { id: 'transactions', label: 'Transactions' },
  { id: 'settings',     label: 'Settings' },
];

// Money rows are micro-USD. 'owed' is the admin grant, 'usd' is every revenue
// share credit (tips, sales, accruals). Treating only 'owed' as money printed a
// $0.001234 tip as "+1,234 usd".
const isMoneyRow = (r) => r.currency === 'owed' || r.currency === 'usd';
// Sub-cent amounts keep four places: a tip share is often a fraction of a cent,
// and rounding it to $0.00 makes a real credit look like nothing happened.
const usd = (micro) => {
  const v = (Number(micro) || 0) / 1e6;
  const d = v !== 0 && Math.abs(v) < 0.01 ? 4 : 2;
  return `$${v.toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d })}`;
};

export default function AdminEconomyScreen() {
  const [tab, setTab] = useState('overview');
  const { guarded, overlay } = useGuardedCall();

  return (
    <AdminShell
      screen="economy"
      title="Economy"
      subtitle="Coins in, revenue share out. No user-initiated withdrawal exists."
    >
      <Tabs tabs={TABS} active={tab} onChange={setTab} />
      {tab === 'overview'     && <OverviewTab />}
      {tab === 'payments'     && <AdminPaymentsTab guarded={guarded} />}
      {tab === 'grant'        && <GrantTab guarded={guarded} />}
      {tab === 'payouts'      && <PayoutsTab guarded={guarded} />}
      {tab === 'promos'       && <AdminPromosTab />}
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
  const [topOwed, setTopOwed] = useState([]);
  const [loading, setLoading] = useState(true);

  const [payout, setPayout] = useState(null);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const [s, c, g, po] = await Promise.all([
        call('adminGetEconomyStats'),
        call('adminListTopWallets', { sortBy: 'balance', limit: 5 }),
        call('adminListTopWallets', { sortBy: 'owedMicroUsd', limit: 5 }),
        call('adminGetPayoutOverview').catch(() => null),
      ]);
      setStats(s); setTopCoins(c.rows || []); setTopOwed(g.rows || []); setPayout(po);
    } catch (err) {
      showToast(err?.message || 'Failed to load economy', 'error');
    }
    setLoading(false);
  }, [showToast]);

  useEffect(() => { reload(); }, [reload]);

  return (
    <>
      {payout && !payout.partnerConfigured && (
        <div style={{
          padding: 14, marginBottom: 16, borderRadius: 12,
          background: 'rgba(240,64,96,0.10)', border: '1px solid rgba(240,64,96,0.35)',
          fontSize: 12.5, color: '#f8a5b4', lineHeight: 1.55,
        }}>
          <strong style={{ color: '#f04060' }}>No payout partner is wired.</strong> Nobody can be paid.
          A run that cannot disburse marks itself <code>blocked</code> and moves nothing, deliberately -
          the alternative is debiting the payable and failing to send it. {usd(payout.liability?.owedMicroUsd)}
          {' '}is owed to {fmtNumber(payout.liability?.creditorCount)} creator(s) and will keep accruing
          until <code>disbursePayout()</code> is implemented and{' '}
          <code>PAYOUT_PARTNER_CONFIGURED</code> is flipped in the same commit.
        </div>
      )}

      {payout?.legacyOpenWithdrawals > 0 && (
        <div style={{
          padding: 12, marginBottom: 16, borderRadius: 12,
          background: 'rgba(245,197,66,0.10)', border: '1px solid rgba(245,197,66,0.30)',
          fontSize: 12, color: '#f5c542',
        }}>
          {fmtNumber(payout.legacyOpenWithdrawals)} legacy withdrawal row(s) are still in a non-terminal
          state. Nothing processes them any more, cancel them on the Creator payouts tab to return the
          held amount to the wallet.
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12, marginBottom: 16 }}>
        <KpiCard icon="paid"        color="#f5c542" label="Coins in circulation" value={loading ? '—' : fmtNumber(stats?.coinsInCirculation)} sub={stats ? `${fmtNumber(stats.walletCount)} wallets` : null} />
        {/* This is a LIABILITY, not a balance the creator can call on. */}
        <KpiCard icon="request_quote" color="#7c3aed" label="Revenue share owed" value={loading ? '—' : usd(stats?.owedMicroUsd)}
          sub={payout ? `${fmtNumber(payout.liability?.creditorCount)} creditor(s)` : null} />
        <KpiCard icon="payments"    color="#22c55e" label="Paid to creators"     value={loading ? '—' : usd(payout?.statements?.paidMicroUsd ?? stats?.paidMicroUsd)}
          sub={payout ? `${fmtNumber(payout.statements?.paidCount)} statement(s)` : null} />
        <KpiCard icon="how_to_reg"  color="#3b82f6" label="Enrolled for payout"  value={loading ? '—' : fmtNumber(payout?.accounts?.enrolled ?? stats?.enrolledForPayout)}
          sub={payout ? `min ${usd(payout.minPayoutMicroUsd)} · ${payout.minAccountAgeDays}d account age` : null} />
        <KpiCard icon="local_activity" color="#b44fff" label="VP in circulation"  value={loading ? '—' : fmtNumber(stats?.vpInCirculation)} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 16 }}>
        <TopList title="Top coin holders" rows={topCoins} field="balance" suffix="coins" />
        {/* micro-USD is an internal unit and must never be printed at a user, or
            at a founder reading a liability figure off a dashboard. */}
        <TopList title="Most owed"        rows={topOwed}  field="owedMicroUsd" money />
      </div>
    </>
  );
}

function TopList({ title, rows, field, suffix, money = false }) {
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
                {money ? usd(r[field]) : `${fmtNumber(r[field])} ${suffix}`}
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
    if (currency === 'owed' && Math.abs(amt) > 1000) return showToast('Max $1,000 per adjustment', 'error');
    if (!reason.trim()) return showToast('Reason required', 'error');
    const callable = currency === 'coins' ? 'adminGrantCoins' : currency === 'vp' ? 'adminGrantVp' : 'adminGrantOwed';
    // The payable is stored in micro-USD. Nobody is going to type 25000000 to
    // mean $25, so the field takes DOLLARS and the conversion happens here.
    const wire = currency === 'owed' ? Math.round(amt * 1e6) : amt;
    setBusy(true);
    try {
      await guarded(() => call(callable, { targetUid: picked.uid, amount: wire, reason: reason.trim() }));
      showToast(`Adjusted ${currency === 'owed' ? usd(wire) : `${amt} ${currency}`} for ${picked.displayName}`, 'success');
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
          Credit (or deduct with a negative amount) coins, VP, or the revenue share Vergr owes.
          Every adjustment logs to <code>admin_actions/</code> and writes a transaction entry.
          <br />
          A grant is a comp, a support credit or test data. It is <strong>never</strong> revenue, so it
          lands in <code>totalGranted*</code> and is deliberately kept out of the creator's earnings
          totals.
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

        <Label>What to adjust</Label>
        <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
          {[
            { id: 'coins', label: 'Coins' },
            { id: 'owed',  label: 'Revenue share (USD)' },
            { id: 'vp',    label: 'VP' },
          ].map(({ id: c, label: cLabel }) => (
            <button
              key={c}
              onClick={() => setCurrency(c)}
              style={{
                flex: 1, padding: 10, borderRadius: 8,
                background: currency === c ? C.accent : 'transparent',
                border: `1px solid ${currency === c ? C.accent : C.border}`,
                color: currency === c ? '#fff' : C.text,
                fontSize: 12, fontWeight: 700, cursor: 'pointer',
              }}
            >{cLabel}</button>
          ))}
        </div>

        <Label>{currency === 'owed' ? 'Amount in USD (negative deducts)' : 'Amount (negative deducts)'}</Label>
        <input
          type="number"
          step={currency === 'owed' ? '0.01' : '1'}
          value={amount}
          onChange={e => setAmount(e.target.value)}
          placeholder={currency === 'owed' ? 'e.g. 25.50 or -10' : 'e.g. 1000 or -500'}
          style={inputStyle}
        />
        {currency === 'owed' && (
          <div style={{ fontSize: 11, color: C.textDim, marginTop: -6, marginBottom: 12 }}>
            Stored as {usd(Math.round((Number(amount) || 0) * 1e6))} in micro-USD on the wallet payable. Max $1,000.
          </div>
        )}

        <Label>Reason (logged to audit, shown to user)</Label>
        <textarea
          rows={3}
          value={reason}
          onChange={e => setReason(e.target.value)}
          placeholder="e.g. Support credit, ticket #1234"
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
          {busy ? 'Applying…' : currency === 'owed'
            ? `Adjust by ${usd(Math.round((Number(amount) || 0) * 1e6))}`
            : `Grant ${amount || 0} ${currency}`}
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
                  <span style={{ color: C.text, fontWeight: 600 }}>{isMoneyRow(r)
                    ? `${r.amount > 0 ? '+' : ''}${usd(r.amountMicroUsd ?? r.amount)}`
                    : `${r.amount > 0 ? '+' : ''}${fmtNumber(r.amount)} ${r.currency}`}</span>
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
// CREATOR PAYOUTS
// ───────────────────────────────────────────────────────────
//
// This is the only way money leaves Vergr. `runCreatorPayouts` (daily 05:00 UTC, inside cronMoney)
// works out what Vergr owes each enrolled creator as a supplier and pays it on
// Vergr's schedule. There is no user-initiated withdrawal and there has not been
// one since 2026-08-16.
//
// The legacy withdrawal queue lives at the bottom, collapsed, because a few
// pre-deletion test rows exist and nothing processes them any more.

const PAYOUT_STATUS_COLORS = {
  // Statement + run statuses (live pipeline)
  paid:                '#22c55e',
  pending:             '#3b82f6',
  complete:            '#22c55e',
  complete_with_errors:'#f5c542',
  blocked:             '#f04060',
  running:             '#b44fff',
  // Legacy withdrawal-row statuses
  requested:           '#3b82f6',
  on_hold:             '#f5c542',
  ready:               '#7c3aed',
  processing:          '#b44fff',
  sent:                '#22c55e',
  failed:              '#f04060',
  cancelled:           '#9ca3af',
  rejected:            '#f04060',
  queued_placeholder:  '#f5c542',
};

function StatusChip({ status }) {
  const color = PAYOUT_STATUS_COLORS[status] || C.textDim;
  return (
    <span style={{
      padding: '3px 8px', borderRadius: 6, background: `${color}25`, color,
      fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em',
      whiteSpace: 'nowrap',
    }}>{String(status || '—').replace(/_/g, ' ')}</span>
  );
}

function PayoutsTab({ guarded }) {
  const { showToast } = useUI();
  const [ov, setOv] = useState(null);
  const [statements, setStatements] = useState([]);
  const [users, setUsers] = useState({});
  const [runFilter, setRunFilter] = useState(null);
  const [loading, setLoading] = useState(true);
  const [preview, setPreview] = useState(null);
  const [previewing, setPreviewing] = useState(false);
  const [showLegacy, setShowLegacy] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const [o, s] = await Promise.all([
        call('adminGetPayoutOverview'),
        call('adminListPayoutStatements', { runId: runFilter, pageSize: 50 }),
      ]);
      setOv(o);
      setStatements(s.rows || []);
      setUsers(s.users || {});
    } catch (err) {
      showToast(err?.message || 'Failed to load payouts', 'error');
    }
    setLoading(false);
  }, [runFilter, showToast]);

  useEffect(() => { reload(); }, [reload]);

  // Dry run. Shows exactly who WOULD be paid and who is skipped, with reasons,
  // and moves nothing. This is the thing to read before the first real run.
  const runPreview = async () => {
    setPreviewing(true);
    try {
      setPreview(await call('previewCreatorPayoutRun', {}));
    } catch (err) {
      showToast(err?.message || 'Preview failed', 'error');
    }
    setPreviewing(false);
  };

  return (
    <>
      {ov && !ov.partnerConfigured && (
        <div style={{
          padding: 14, marginBottom: 14, borderRadius: 12,
          background: 'rgba(240,64,96,0.10)', border: '1px solid rgba(240,64,96,0.35)',
          fontSize: 12.5, color: '#f8a5b4', lineHeight: 1.55,
        }}>
          <strong style={{ color: '#f04060' }}>Payout partner not wired, nobody can be paid.</strong>
          {' '}<code>disbursePayout()</code> throws, so every run marks itself <code>blocked</code> and
          moves nothing rather than debiting a payable it cannot send. Flip{' '}
          <code>PAYOUT_PARTNER_CONFIGURED</code> in the same commit that implements the partner.
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12, marginBottom: 16 }}>
        <KpiCard icon="request_quote" color="#7c3aed" label="Owed to creators"
          value={loading ? '—' : usd(ov?.liability?.owedMicroUsd)}
          sub={ov ? `${fmtNumber(ov.liability?.creditorCount)} creditor(s)` : null} />
        <KpiCard icon="payments" color="#22c55e" label="Paid to date"
          value={loading ? '—' : usd(ov?.statements?.paidMicroUsd)}
          sub={ov ? `${fmtNumber(ov.statements?.paidCount)} statement(s)` : null} />
        <KpiCard icon="how_to_reg" color="#3b82f6" label="Enrolled"
          value={loading ? '—' : fmtNumber(ov?.accounts?.enrolled)}
          sub={ov ? `${fmtNumber(ov.accounts?.frozen)} frozen` : null} />
        <KpiCard icon="error" color="#f04060" label="Failed statements"
          value={loading ? '—' : fmtNumber(ov?.statements?.failedCount)} />
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
        <button onClick={runPreview} disabled={previewing} style={{
          padding: '8px 14px', borderRadius: 8, border: 0,
          background: previewing ? '#555' : C.accent, color: '#fff',
          fontSize: 12, fontWeight: 700, cursor: previewing ? 'wait' : 'pointer',
          display: 'inline-flex', alignItems: 'center', gap: 6,
        }}>
          <Icon name={previewing ? 'hourglass_top' : 'science'} size={14} />
          {previewing ? 'Running…' : 'Dry-run today’s payout'}
        </button>
        <button onClick={reload} style={iconBtn}><Icon name="refresh" size={14} /></button>
        {ov && (
          <span style={{ fontSize: 11, color: C.textDim }}>
            Minimum {usd(ov.minPayoutMicroUsd)} · account must be {ov.minAccountAgeDays}+ days old ·
            balances below the minimum roll over, never expire
          </span>
        )}
      </div>

      {preview && (
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 16, marginBottom: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 10 }}>
            <h3 style={{ margin: 0, fontSize: 13, fontWeight: 700, color: C.text }}>
              Dry run for {preview.date}, nothing was moved
            </h3>
            <button onClick={() => setPreview(null)} style={iconBtn}><Icon name="close" size={13} /></button>
          </div>
          <div style={{ fontSize: 12, color: C.text, marginBottom: 10 }}>
            Would pay <strong>{fmtNumber(preview.wouldPay)}</strong> creator(s),{' '}
            <strong>{usd(preview.wouldPayMicroUsd)}</strong> total.
          </div>
          {(preview.plan || []).length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 10 }}>
              {preview.plan.map(pl => (
                <div key={pl.uid} style={{ display: 'flex', gap: 10, fontSize: 11, color: C.textDim }}>
                  <span style={{ fontFamily: 'monospace' }}>{pl.uid.slice(0, 10)}</span>
                  <span className="font-dmmono tabular-nums" style={{ color: C.text, fontWeight: 700 }}>{usd(pl.amountMicroUsd)}</span>
                  <span>{pl.cadence}</span>
                </div>
              ))}
            </div>
          )}
          {(preview.skipped || []).length > 0 && (
            <>
              <div style={{ fontSize: 11, fontWeight: 700, color: C.textDim, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>
                Skipped ({preview.skipped.length}), with the reason the run gave
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 3, maxHeight: 240, overflowY: 'auto' }}>
                {preview.skipped.map((s, i) => (
                  <div key={i} style={{ display: 'flex', gap: 10, fontSize: 11 }}>
                    <span style={{ fontFamily: 'monospace', color: C.textDim }}>{String(s.uid || '').slice(0, 10)}</span>
                    <span style={{ color: '#f5c542' }}>{s.reason || s.blockingReason || 'unknown'}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {/* Run history */}
      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 16, marginBottom: 16 }}>
        <h3 style={{ margin: 0, fontSize: 13, fontWeight: 700, color: C.text, marginBottom: 10 }}>Payout runs</h3>
        {(ov?.runs || []).length === 0 ? (
          <div style={{ fontSize: 12, color: C.textDim }}>
            No run has ever executed. The cron fires daily at 05:00 UTC and self-gates: a creator is only
            included on a day their cadence is due.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {ov.runs.map(r => (
              <button
                key={r.id}
                onClick={() => setRunFilter(runFilter === r.id ? null : r.id)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10, width: '100%',
                  padding: '9px 10px', borderRadius: 8, textAlign: 'left', cursor: 'pointer',
                  background: runFilter === r.id ? C.card2 : 'transparent',
                  border: `1px solid ${runFilter === r.id ? C.accent : C.border}`,
                  color: C.text,
                }}
              >
                <StatusChip status={r.status} />
                <span style={{ fontSize: 11, color: C.textDim, minWidth: 92 }}>{fmtRelative(r.startedAt)}</span>
                <span className="font-dmmono tabular-nums" style={{ fontSize: 12, fontWeight: 700 }}>
                  {usd(r.paidMicroUsd)}
                </span>
                <span style={{ fontSize: 11, color: C.textDim, flex: 1 }}>
                  {r.status === 'blocked'
                    ? `${fmtNumber(r.wouldPay)} would have been paid, ${r.blockedReason || 'no payout partner'}`
                    : `${fmtNumber(r.paidCount)} paid${r.failedCount ? `, ${fmtNumber(r.failedCount)} failed` : ''}`}
                </span>
                <span style={{ fontSize: 10, color: C.textMuted, fontFamily: 'monospace' }}>{r.id}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Statements, the remittance advice per creator per run */}
      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, overflow: 'hidden', marginBottom: 16 }}>
        <div style={{ padding: '12px 14px', borderBottom: `1px solid ${C.border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3 style={{ margin: 0, fontSize: 13, fontWeight: 700, color: C.text }}>
            Statements{runFilter ? ', filtered to one run' : ''}
          </h3>
          {runFilter && (
            <button onClick={() => setRunFilter(null)} style={miniBtn(C.accent)}>Clear filter</button>
          )}
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 680 }}>
            <thead>
              <tr style={{ background: C.card2 }}>
                {['Creator', 'Amount', 'Status', 'Cadence', 'Created', 'Reference'].map(h => <th key={h} style={th}>{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {statements.map(s => {
                const u = users[s.uid] || {};
                return (
                  <tr key={s.id} style={{ borderTop: `1px solid ${C.border}` }}>
                    <td style={td}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <UserAvatar src={u.avatar} size={26} />
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontSize: 12, fontWeight: 600 }}>{u.displayName || (s.uid || '').slice(0, 8)}</div>
                          {u.username && <div style={{ fontSize: 10, color: C.textDim }}>@{u.username}</div>}
                        </div>
                      </div>
                    </td>
                    <td style={td}>
                      <span className="font-dmmono tabular-nums" style={{ fontSize: 12, fontWeight: 700 }}>{usd(s.amountMicroUsd)}</span>
                    </td>
                    <td style={td}><StatusChip status={s.status} /></td>
                    <td style={{ ...td, fontSize: 11, color: C.textDim }}>{s.cadence || '—'}</td>
                    <td style={{ ...td, fontSize: 11, color: C.textDim }}>{fmtRelative(s.createdAt)}</td>
                    <td style={{ ...td, fontSize: 10, color: C.textDim, fontFamily: 'monospace', maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {s.reference || s.failureReason || '—'}
                    </td>
                  </tr>
                );
              })}
              {!loading && statements.length === 0 && (
                <tr><td colSpan={6} style={{ padding: 32, textAlign: 'center', color: C.textDim, fontSize: 13 }}>
                  No statements yet. One is written per creator per run, and doubles as their tax record.
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Legacy withdrawal rows, collapsed, deliberately unglamorous */}
      <button
        onClick={() => setShowLegacy(v => !v)}
        style={{
          display: 'flex', alignItems: 'center', gap: 8, width: '100%',
          padding: '11px 14px', borderRadius: 10, cursor: 'pointer', textAlign: 'left',
          background: C.card, border: `1px solid ${C.border}`, color: C.textDim, fontSize: 12,
        }}
      >
        <Icon name={showLegacy ? 'expand_less' : 'expand_more'} size={16} />
        <span style={{ flex: 1 }}>
          Legacy withdrawal requests (deleted flow, history only)
          {ov?.legacyOpenWithdrawals > 0 && (
            <strong style={{ color: '#f5c542' }}>, {fmtNumber(ov.legacyOpenWithdrawals)} still open</strong>
          )}
        </span>
      </button>
      {showLegacy && <LegacyWithdrawals guarded={guarded} />}
    </>
  );
}

// ───────────────────────────────────────────────────────────
// LEGACY WITHDRAWAL QUEUE (read-mostly)
// ───────────────────────────────────────────────────────────
//
// The user-initiated withdrawal flow was DELETED on 2026-08-16, source gone,
// callables undeployed. Nothing writes `payout_requests` any more and nothing
// processes it. This stays reachable for two reasons: pre-deletion test rows
// exist, and a row stuck in a non-terminal state is holding a balance that must
// be returnable to the wallet. Cancel is therefore the only action that still
// matters here.

const PAYOUT_FILTERS = [
  { id: 'all',        label: 'All' },
  { id: 'pending',    label: 'Pending' },
  { id: 'ready',      label: 'Ready' },
  { id: 'processing', label: 'Processing' },
  { id: 'sent',       label: 'Sent' },
  { id: 'failed',     label: 'Failed' },
  { id: 'cancelled',  label: 'Cancelled' },
];

function LegacyWithdrawals({ guarded }) {
  const { showToast } = useUI();
  const [filter, setFilter] = useState('pending');
  const [rows, setRows] = useState([]);
  const [users, setUsers] = useState({});
  const [loading, setLoading] = useState(true);
  const [prompt, setPrompt] = useState(null);


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
      reject:   { title: 'Cancel withdrawal', msg: 'Returns the held amount to the user and marks the request rejected. Legacy rows only: user-initiated withdrawal was removed 2026-08-16. Audit logged.', danger: true },
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
                        {/* Legacy rows stored gems, and 1 gem was 1 cent, so /100 really is dollars here. */}
                        {p.gemsRequested ? `$${(p.gemsRequested / 100).toFixed(2)}` : '—'}
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
                        {/* "Review & release" pushed a user-initiated withdrawal
                            out through Circle. That pipeline was deleted on
                            2026-08-16 with the gem unit, so the control and its
                            two callables are gone. Cancel/reject below still
                            works for any legacy row. */}
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
    </>
  );
}

// ───────────────────────────────────────────────────────────
// REVIEW & RELEASE MODAL
// ───────────────────────────────────────────────────────────
// Shows the user's account dossier (KYC, account age, lifetime payouts,
// recent transactions, ban status) and lets admin approve a pending payout
// to be sent to Circle immediately — bypassing the 3-day hold.

// ReviewReleaseModal REMOVED 2026-08-16 with the withdrawal pipeline.

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
  const [nextCursor, setNextCursor] = useState(null);
  const [loading, setLoading] = useState(true);

  // Cursor is an argument, not state, same bug the Users list had: a setCursor
  // followed by an immediate load() ran against the PREVIOUS cursor, because
  // setState is not synchronous, so Load more re-fetched page one.
  const load = useCallback(async (cursor = null) => {
    setLoading(true);
    try {
      const r = await call('adminListTransactions', {
        type: type || null,
        currency: currency || null,
        cursor,
        pageSize: 50,
      });
      setRows(prev => {
        if (!cursor) return r.rows;
        const seen = new Set(prev.map(x => x.id));
        return [...prev, ...r.rows.filter(x => !seen.has(x.id))];
      });
      setUsers(prev => ({ ...prev, ...r.users }));
      setNextCursor(r.nextCursor || null);
    } catch (err) {
      showToast(err?.message || 'Failed to load transactions', 'error');
    }
    setLoading(false);
  }, [type, currency, showToast]);

  useEffect(() => {
    setRows([]); setNextCursor(null);
    load(null);
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
          <option value="tip_received">Tip received</option>
          <option value="tip_sent">Tip sent</option>
          {/* The accrual row. Written by coinLedger settleEarnedShare, this is
              how the revenue share Vergr owes actually comes into being. */}
          <option value="revenue_share_accrued">Revenue share accrued</option>
          <option value="content_unlock_sale">Content unlock</option>
          <option value="event_ticket_sale">Event ticket</option>
          <option value="season_pass_sale">Season pass</option>
          <option value="vergrme_sale">Vergr.me sale</option>
          <option value="membership">Membership</option>
          <option value="creator_payout">Creator payout</option>
        </select>
        <select value={currency} onChange={e => setCurrency(e.target.value)} style={smallSelect}>
          <option value="">All currencies</option>
          <option value="coins">Coins</option>
          <option value="owed">Revenue share owed</option>
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
                        {isMoneyRow(r)
                          ? `${positive ? '+' : ''}${usd(r.amountMicroUsd ?? r.amount)}`
                          : `${positive ? '+' : ''}${fmtNumber(r.amount)} ${r.currency || 'coins'}`}
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
            <button onClick={() => load(nextCursor)} disabled={loading} style={miniBtn(C.accent)}>Load more</button>
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
  conversionsPaused:   { label: 'Pause revenue-share accrual', desc: 'Stops earned coins accruing a creator share. Useful during an economy investigation.' },
  payoutsPaused:       { label: 'Pause creator payouts',    desc: 'The scheduled payout run skips everyone. Accrual continues, so nothing is lost, creators are paid on the next run after this is resumed.' },
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
