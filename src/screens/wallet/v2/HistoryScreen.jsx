// History (v2) — ports the design's HistoryScreen. Filter tabs expanded
// per the locked spec to real ledger categories: All / Tips / Conversions /
// Coin purchases / Tips / Unlocks / Memberships.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useUser } from '../../../context/UserContext';
import {
  WalletCard, WalletButton, StatusPill, WALLET_TOKENS, fmtNum, fmtEUR, txUnit,
} from '../../../components/wallet/primitives';
import Icon from '../../../components/Icon';
import { getTransactions } from '../../../firebase/firestore';

const FILTERS = [
  { id: 'all',          label: 'All',              match: () => true },
  { id: 'unlocks',      label: 'Unlocks',          match: (t) => /unlock|ticket|season_pass|coaching_payment/.test(String(t.type || '')) },
  { id: 'tips',         label: 'Tips sent',        match: (t) => t.type === 'tip_sent' },
  { id: 'purchases',    label: 'Coins bought',     match: (t) => t.type === 'buy' || t.type === 'coin_purchase' },
  { id: 'memberships',  label: 'Subscriptions',    match: (t) => t.type === 'membership' || t.type === 'fan_renewal' || t.type === 'subscription_payment' },
];

export default function HistoryScreen() {
  const { profile } = useUser();
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [txs, setTxs] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!profile?.uid) return;
    setLoading(true);
    getTransactions(profile.uid, 200)
      .then(setTxs)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [profile?.uid]);

  // The in-flight withdrawals section was removed on 2026-08-16 along with the
  // user-initiated withdrawal pipeline. There is no request for a user to make,
  // and therefore none to track or cancel. Money owed to a creator is paid on
  // Vergr's schedule and is reported in Creator Studio, not here: this screen is
  // the BUYER ledger (coins bought, tips sent, unlocks, subscriptions).

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
  const currency = txUnit(tx.currency);
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
