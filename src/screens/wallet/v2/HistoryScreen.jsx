// History (v2) — ports the design's HistoryScreen. Filter tabs expanded
// per the locked spec to real ledger categories: All / Tips / Conversions /
// Withdrawals / Coin purchases / Tournament prizes / Memberships.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useUser } from '../../../context/UserContext';
import {
  WalletCard, WalletButton, StatusPill, WALLET_TOKENS, fmtNum, fmtEUR,
} from '../../../components/wallet/primitives';
import Icon from '../../../components/Icon';
import { getTransactions } from '../../../firebase/firestore';
import { getMyWithdrawals, cancelWithdrawal } from '../../../firebase/walletCallables';

const FILTERS = [
  { id: 'all',          label: 'All',              match: () => true },
  { id: 'tips',         label: 'Tips',             match: (t) => t.type === 'tip_received' || t.type === 'tip_sent' },
  { id: 'conversions',  label: 'Conversions',      match: (t) => t.type === 'conversion' || t.type === 'coin_to_gem_conversion' },
  { id: 'withdrawals',  label: 'Withdrawals',      match: (t) => t.type === 'withdrawal' || t.type === 'gem_withdrawal' || t.type === 'withdrawal_cancelled' },
  { id: 'purchases',    label: 'Coin purchases',   match: (t) => t.type === 'buy' || t.type === 'coin_purchase' },
  { id: 'tournaments',  label: 'Tournament prizes', match: (t) => t.type === 'tournament' || t.type === 'tournament_prize' || t.type === 'tournament_refund' },
  { id: 'memberships',  label: 'Memberships',      match: (t) => t.type === 'membership' || t.type === 'fan_renewal' },
];

export default function HistoryScreen() {
  const { profile } = useUser();
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [txs, setTxs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [withdrawals, setWithdrawals] = useState([]);

  useEffect(() => {
    if (!profile?.uid) return;
    setLoading(true);
    getTransactions(profile.uid, 200)
      .then(setTxs)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [profile?.uid]);

  // Poll withdrawals every 20s so the user sees status transitions
  // (pending → processing → sent) without manually refreshing.
  const loadWithdrawals = useCallback(async () => {
    try {
      const res = await getMyWithdrawals({ limit: 25 });
      setWithdrawals(res?.rows || []);
    } catch { /* silent */ }
  }, []);

  useEffect(() => {
    if (!profile?.uid) return;
    loadWithdrawals();
    const t = setInterval(loadWithdrawals, 20_000);
    return () => clearInterval(t);
  }, [profile?.uid, loadWithdrawals]);

  // Only "active" withdrawals get the dedicated section at top.
  // Terminal states (sent/cancelled/failed) flow into the main transaction
  // table via the existing withdrawal_* ledger rows.
  const activeWithdrawals = withdrawals.filter(w =>
    w.status === 'pending' || w.status === 'ready' || w.status === 'processing'
  );

  const filtered = useMemo(() => {
    const f = FILTERS.find(x => x.id === filter);
    return txs.filter(t => f.match(t) && (
      !search ||
      (t.description || '').toLowerCase().includes(search.toLowerCase()) ||
      String(t.amount || '').includes(search)
    ));
  }, [txs, filter, search]);

  return (
    <div style={{ maxWidth: 1120, margin: '0 auto' }}>
      <div style={{ marginBottom: 24 }}>
        <div style={{ fontSize: 11, letterSpacing: '0.12em', textTransform: 'uppercase', color: WALLET_TOKENS.violetLight, fontWeight: 600, marginBottom: 8 }}>History</div>
        <h1 style={{ fontFamily: 'Syne, sans-serif', fontWeight: 700, fontSize: 30, letterSpacing: '-0.02em' }}>Transactions.</h1>
      </div>

      {/* Active withdrawals — pending / processing rows with cancel + countdown */}
      {activeWithdrawals.length > 0 && (
        <div style={{ marginBottom: 24 }}>
          <div style={{
            fontSize: 11, letterSpacing: '0.10em', textTransform: 'uppercase',
            color: WALLET_TOKENS.textMuted, fontWeight: 600, marginBottom: 10,
          }}>Active withdrawals · {activeWithdrawals.length}</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {activeWithdrawals.map(w => (
              <WithdrawalRow key={w.id} w={w} onChanged={loadWithdrawals} />
            ))}
          </div>
        </div>
      )}

      {/* Filter pills */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 16 }}>
        {FILTERS.map(f => (
          <button key={f.id} onClick={() => setFilter(f.id)} style={{
            padding: '8px 14px', borderRadius: 999, fontSize: 12, fontWeight: 600,
            background: filter === f.id ? WALLET_TOKENS.violet : WALLET_TOKENS.surface2,
            color: filter === f.id ? '#fff' : WALLET_TOKENS.textSecondary,
            border: `1px solid ${filter === f.id ? WALLET_TOKENS.violet : WALLET_TOKENS.hairline}`,
            cursor: 'pointer',
          }}>{f.label}</button>
        ))}
      </div>

      {/* Search + actions */}
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center', marginBottom: 16 }}>
        <div style={{ position: 'relative', flex: '1 1 240px', minWidth: 200 }}>
          <Icon name="search" size={16}
                className="text-zinc-500"
                style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)' }} />
          <input value={search} onChange={(e) => setSearch(e.target.value)}
                 placeholder="Search by amount, label"
                 style={{
                   width: '100%', padding: '10px 14px 10px 38px', fontSize: 13,
                   background: WALLET_TOKENS.surface2,
                   border: `1px solid ${WALLET_TOKENS.hairline}`,
                   borderRadius: 10, color: WALLET_TOKENS.text, outline: 'none',
                 }} />
        </div>
        <WalletButton variant="ghost" size="sm" icon="download" onClick={() => exportCsv(filtered)}>
          Export CSV
        </WalletButton>
      </div>

      <WalletCard padding={0}>
        {loading ? (
          <Empty>Loading transactions…</Empty>
        ) : filtered.length === 0 ? (
          <Empty>Nothing here yet.</Empty>
        ) : (
          <>
            {/* Header */}
            <div style={{
              display: 'grid',
              gridTemplateColumns: '160px 1.4fr 1fr 110px 110px',
              gap: 16, padding: '12px 20px',
              fontSize: 10, color: WALLET_TOKENS.textMuted,
              letterSpacing: '0.10em', textTransform: 'uppercase', fontWeight: 600,
              borderBottom: `1px solid ${WALLET_TOKENS.hairline}`,
            }}>
              <div>Date</div>
              <div>Activity</div>
              <div>Type</div>
              <div style={{ textAlign: 'right' }}>Amount</div>
              <div style={{ textAlign: 'right' }}>Status</div>
            </div>
            {filtered.map(t => <HistoryRow key={t.id} tx={t} />)}
          </>
        )}
      </WalletCard>
    </div>
  );
}

function HistoryRow({ tx }) {
  const when = tx.createdAt
    ? new Date(tx.createdAt.seconds ? tx.createdAt.seconds * 1000 : tx.createdAt).toLocaleString()
    : '';
  const amount = tx.amount || 0;
  const credit = amount >= 0;
  const currency = tx.currency === 'gems' ? 'gems' : 'c';
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: '160px 1.4fr 1fr 110px 110px',
      gap: 16, padding: '14px 20px', alignItems: 'center',
      borderBottom: `1px solid ${WALLET_TOKENS.hairline}`,
      fontSize: 13,
    }}>
      <span className="font-dmmono" style={{ color: WALLET_TOKENS.textMuted, fontSize: 12 }}>{when}</span>
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {tx.description || tx.type || 'Transaction'}
      </span>
      <span style={{ color: WALLET_TOKENS.textMuted, fontSize: 12 }}>{tx.type}</span>
      <span className="font-dmmono tabular-nums" style={{
        textAlign: 'right', fontWeight: 600,
        color: credit ? '#86EFAC' : WALLET_TOKENS.text,
      }}>
        {credit ? '+' : ''}{fmtNum(amount)} {currency}
      </span>
      <span style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <StatusPill status={tx.status || 'settled'} />
      </span>
    </div>
  );
}

// Single active-withdrawal card. Shows status, amount, destination, countdown
// to release, and cancel button (when within cancelDeadline + status=pending).
function WithdrawalRow({ w, onChanged }) {
  const [now, setNow] = useState(Date.now());
  const [cancelling, setCancelling] = useState(false);
  const [error, setError] = useState(null);

  // Tick countdown every second while displayed
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const canCancel = w.status === 'pending' && w.cancelDeadline && now < w.cancelDeadline;
  const releaseIn = w.releasesAt ? w.releasesAt - now : 0;
  const cancelIn = w.cancelDeadline ? w.cancelDeadline - now : 0;

  const STATUS_META = {
    pending:    { color: '#3B82F6', label: 'Pending', icon: 'schedule' },
    ready:      { color: '#A78BFA', label: 'Ready to send', icon: 'task_alt' },
    processing: { color: '#B44FFF', label: 'Processing on Base', icon: 'sync' },
  };
  const meta = STATUS_META[w.status] || { color: WALLET_TOKENS.textMuted, label: w.status, icon: 'help' };

  const cancel = async () => {
    if (!confirm('Cancel this withdrawal and refund your gems?')) return;
    setCancelling(true);
    setError(null);
    try {
      await cancelWithdrawal({ payoutId: w.id });
      onChanged?.();
    } catch (e) {
      setError(e?.message || 'Cancel failed');
    } finally {
      setCancelling(false);
    }
  };

  const addrShort = w.destinationAddress
    ? `${w.destinationAddress.slice(0, 8)}…${w.destinationAddress.slice(-6)}`
    : '—';

  return (
    <WalletCard padding={0}>
      <div style={{
        padding: 16, display: 'grid',
        gridTemplateColumns: '32px 1fr auto', gap: 14, alignItems: 'flex-start',
      }}>
        <div style={{
          width: 32, height: 32, borderRadius: 8,
          background: `${meta.color}25`, color: meta.color,
          display: 'grid', placeItems: 'center', marginTop: 2,
        }}>
          <Icon name={meta.icon} size={18} />
        </div>
        <div style={{ minWidth: 0 }}>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 4 }}>
            <span style={{
              fontSize: 10, padding: '3px 8px', borderRadius: 999,
              background: `${meta.color}20`, color: meta.color,
              fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em',
            }}>{meta.label}</span>
            <span className="font-dmmono" style={{ fontSize: 13, fontWeight: 600 }}>
              {fmtNum(w.gemsRequested)} gems
            </span>
            {w.netUSDC && (
              <span style={{ fontSize: 12, color: WALLET_TOKENS.textMuted }}>
                → {w.netUSDC} USDC
              </span>
            )}
          </div>
          <div style={{ fontSize: 12, color: WALLET_TOKENS.textMuted, fontFamily: 'monospace' }}>
            {addrShort}
          </div>
          <div style={{ marginTop: 8, display: 'flex', gap: 14, fontSize: 11, color: WALLET_TOKENS.textMuted, flexWrap: 'wrap' }}>
            {w.status === 'pending' && releaseIn > 0 && (
              <span><Icon name="schedule" size={11} style={{ verticalAlign: 'middle', marginRight: 4 }} />
                Releases in {fmtDuration(releaseIn)}
              </span>
            )}
            {w.status === 'pending' && cancelIn > 0 && (
              <span style={{ color: '#FCD34D' }}>
                <Icon name="undo" size={11} style={{ verticalAlign: 'middle', marginRight: 4 }} />
                Cancellable for {fmtDuration(cancelIn)}
              </span>
            )}
            {w.status === 'processing' && (
              <span><Icon name="sync" size={11} style={{ verticalAlign: 'middle', marginRight: 4 }} />
                Submitted to Circle, awaiting confirmation
              </span>
            )}
            {w.status === 'ready' && (
              <span><Icon name="task_alt" size={11} style={{ verticalAlign: 'middle', marginRight: 4 }} />
                Queued for next batch (every 15 min)
              </span>
            )}
          </div>
          {error && (
            <div style={{ marginTop: 8, fontSize: 12, color: '#FCA5A5' }}>{error}</div>
          )}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'flex-end' }}>
          {canCancel && (
            <WalletButton variant="ghost" size="sm" icon="close"
                          onClick={cancel} disabled={cancelling}>
              {cancelling ? 'Cancelling…' : 'Cancel'}
            </WalletButton>
          )}
          {w.circleTxHash && (
            <a href={`https://sepolia.basescan.org/tx/${w.circleTxHash}`}
               target="_blank" rel="noreferrer noopener"
               style={{ fontSize: 11, color: WALLET_TOKENS.violetLight, textDecoration: 'none' }}>
              View on Basescan ↗
            </a>
          )}
        </div>
      </div>
    </WalletCard>
  );
}

function fmtDuration(ms) {
  if (ms <= 0) return '0s';
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m`;
  const d = Math.floor(h / 24);
  return `${d}d ${h % 24}h`;
}

function Empty({ children }) {
  return (
    <div style={{ padding: 60, textAlign: 'center', color: WALLET_TOKENS.textMuted, fontSize: 14 }}>
      <Icon name="receipt_long" size={36} />
      <div style={{ marginTop: 8 }}>{children}</div>
    </div>
  );
}

function exportCsv(rows) {
  const headers = ['date', 'description', 'type', 'amount', 'currency', 'status'];
  const lines = rows.map(t => [
    t.createdAt ? new Date(t.createdAt.seconds ? t.createdAt.seconds * 1000 : t.createdAt).toISOString() : '',
    (t.description || t.type || '').replace(/"/g, '""'),
    t.type || '',
    t.amount ?? '',
    t.currency || '',
    t.status || '',
  ].map(v => `"${v}"`).join(','));
  const csv = [headers.join(','), ...lines].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `vergr-wallet-history-${Date.now()}.csv`;
  document.body.appendChild(a); a.click();
  document.body.removeChild(a); URL.revokeObjectURL(url);
}
