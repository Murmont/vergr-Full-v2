// Payout sub-screens: status, history, saved addresses.
// Reads from real `payouts/*` and `users/{uid}/savedAddresses/*` collections.

import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ListSkeleton } from '../../components/skeletons/GlassSkeletons';
import {
  collection, query, where, orderBy, limit, getDocs, getDoc, doc,
  addDoc, deleteDoc, updateDoc, serverTimestamp,
} from 'firebase/firestore';
import { db } from '../../firebase/config';
import { useAuth } from '../../context/AuthContext';
import { useUser } from '../../context/UserContext';
import { useUI } from '../../context/UIContext';
import { useLayout } from '../../context/LayoutContext';
import useResponsive from '../../hooks/useResponsive';
import TopBar from '../../components/TopBar';
import Icon from '../../components/Icon';
import { GemIcon } from '../../components/CoinIcon';

// ─── Shared helpers ────────────────────────────────────────────────

const STATUS_TONE = {
  pending:           { label: 'Pending',    bg: 'rgba(245,197,66,0.12)', color: '#F5C842' },
  awaiting_approval: { label: 'In review',  bg: 'rgba(245,197,66,0.12)', color: '#F5C842' },
  sending:           { label: 'Broadcasting', bg: 'rgba(61,127,255,0.12)', color: '#3D7FFF' },
  finished:          { label: 'Confirmed',  bg: 'rgba(34,209,126,0.12)', color: '#22D17E' },
  failed:            { label: 'Failed',     bg: 'rgba(240,60,96,0.12)',  color: '#F04060' },
  rejected:          { label: 'Rejected',   bg: 'rgba(240,60,96,0.12)',  color: '#F04060' },
  refunded:          { label: 'Refunded',   bg: 'rgba(251,146,60,0.12)', color: '#FB923C' },
};

function StatusBadge({ status }) {
  const tone = STATUS_TONE[status] || STATUS_TONE.pending;
  return (
    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold"
          style={{ background: tone.bg, color: tone.color }}>
      <span className="w-1.5 h-1.5 rounded-full" style={{ background: tone.color }} /> {tone.label}
    </span>
  );
}

const fmtTs = (t) => {
  if (!t) return '';
  const d = t.toDate ? t.toDate() : new Date(t);
  return d.toLocaleString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
};
const fmtDateOnly = (t) => {
  if (!t) return '';
  const d = t.toDate ? t.toDate() : new Date(t);
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
};
const fmtTimeOnly = (t) => {
  if (!t) return '';
  const d = t.toDate ? t.toDate() : new Date(t);
  return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
};

const truncate = (s, n = 14) => (s && s.length > n) ? `${s.slice(0, Math.ceil(n / 2))}…${s.slice(-Math.floor(n / 2))}` : s || '';

// ════════════════════════════════════════════════════════════════════
// PayoutStatusScreen — /wallet/payout/:payoutId
// ════════════════════════════════════════════════════════════════════

export function PayoutStatusScreen() {
  const navigate = useNavigate();
  const { payoutId } = useParams();
  const { showToast } = useUI();
  const { setRightPanel, setContentAlign } = useLayout();
  const { isMobile } = useResponsive();

  const [payout, setPayout] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setRightPanel(null);
    setContentAlign('left');
    return () => { setRightPanel(null); setContentAlign('center'); };
  }, [setRightPanel, setContentAlign]);

  useEffect(() => {
    if (!payoutId) return;
    setLoading(true);
    getDoc(doc(db, 'payouts', payoutId))
      .then(s => setPayout(s.exists() ? { id: s.id, ...s.data() } : null))
      .catch(err => console.warn('Payout fetch failed', err))
      .finally(() => setLoading(false));
  }, [payoutId]);

  if (loading) {
    return <PayoutStatusSkeleton onBack={() => navigate('/wallet')} />;
  }
  if (!payout) {
    return (
      <div className="px-4 md:px-7 py-6 max-w-[760px] mx-auto">
        {isMobile && <TopBar title="Payout" showBack />}
        <p className="text-text-muted">Payout not found.</p>
      </div>
    );
  }

  const tone = STATUS_TONE[payout.status] || STATUS_TONE.pending;
  const isComplete = payout.status === 'finished';
  const isFailed = ['failed', 'rejected', 'refunded'].includes(payout.status);

  const STEPS = [
    { key: 'created',      label: 'Request received', desc: 'Your payout request has been received.',             date: payout.createdAt },
    { key: 'approved',     label: 'Approved',         desc: 'Your payout has been approved and queued.',          date: payout.approvedAt || payout.createdAt },
    { key: 'broadcasting', label: 'Processing',       desc: 'Your payout is being processed.',                    date: payout.sentAt },
    { key: 'confirming',   label: 'Sending',          desc: 'Your payout is being sent to your wallet.',          date: payout.confirmingAt },
    { key: 'finished',     label: 'Sent',             desc: 'Your payout has been sent successfully.',            date: payout.completedAt || payout.sentAt },
  ];

  const stepReached = (key) => {
    const order = ['created', 'approved', 'broadcasting', 'confirming', 'finished'];
    const map = { pending: 0, awaiting_approval: 1, approved: 1, sending: 2, confirming: 3, finished: 4, failed: 4, rejected: 4, refunded: 4 };
    return order.indexOf(key) <= (map[payout.status] ?? 0);
  };

  return (
    <div className="pb-10">
      {isMobile && <TopBar title="Payout Status" showBack />}
      <div className="px-4 md:px-7 py-5 md:py-7 max-w-[780px] mx-auto">
        {!isMobile && <Header title="Payout Status" subtitle="Track your payout from request to completion." onBack={() => navigate('/wallet')} />}

        {/* Hero status */}
        <div className="rounded-2xl p-7 md:p-8 mb-5 flex items-center gap-6 overflow-hidden relative bg-surface-1 border border-surface-3"
             style={{ background: `linear-gradient(135deg, #14141F 0%, ${tone.color}11 100%)` }}>
          <div className="relative shrink-0">
            <div className="w-[100px] h-[100px] rounded-full flex items-center justify-center"
                 style={{ border: `2px solid ${tone.color}`, boxShadow: `0 0 40px ${tone.color}40` }}>
              <div className="w-[76px] h-[76px] rounded-full flex items-center justify-center"
                   style={{ background: `${tone.color}22` }}>
                <Icon name={isComplete ? 'check_circle' : isFailed ? 'error' : 'pending'} size={44} style={{ color: tone.color }} />
              </div>
            </div>
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-[11px] font-bold tracking-widest uppercase mb-1.5" style={{ color: tone.color }}>{tone.label}</div>
            <h2 className="font-syne font-black text-2xl md:text-3xl text-text-primary mb-1">
              {isComplete ? 'Payout Confirmed!' : isFailed ? 'Withdrawal failed' : 'Withdrawal in progress'}
            </h2>
            <p className="text-text-muted text-sm mb-3">
              {isComplete ? 'Your payout has been sent to your wallet.' :
               isFailed   ? 'Your gems have been re-credited to your wallet.' :
                            'We\'re processing your withdrawal — payouts are batched weekly.'}
            </p>
            <div className="font-dmmono text-xl md:text-2xl font-bold" style={{ color: tone.color }}>
              ≈ €{(payout.eurAfterSpread || payout.eurEstimate || 0).toFixed(2)}
            </div>
            <div className="text-text-muted text-xs mt-1 font-dmmono">to {truncate(payout.payoutAddress, 18)}</div>
          </div>
        </div>

        {/* Progress timeline */}
        <div className="rounded-2xl bg-surface-1 border border-surface-3 p-5 md:p-6 mb-5">
          <h3 className="font-syne font-bold text-[15px] text-text-primary mb-5">Payout Progress</h3>
          <div className="relative">
            <div className="absolute left-[17px] top-5 bottom-5 w-[2px]" style={{ background: 'linear-gradient(to bottom, #22D17E, #22D17E)' }} />
            {STEPS.map((step, i) => {
              const done = stepReached(step.key);
              const isActive = (i === STEPS.length - 1 && isComplete) ||
                               (step.key === 'broadcasting' && payout.status === 'sending') ||
                               (step.key === 'approved' && payout.status === 'awaiting_approval');
              return (
                <div key={step.key} className="flex gap-4 relative">
                  <div className={`w-9 h-9 rounded-full shrink-0 flex items-center justify-center z-[1] transition-all`}
                       style={{
                         background: done ? (isActive ? '#22D17E' : 'rgba(34,209,126,0.15)') : '#1E1E2E',
                         border: `2px solid ${done ? '#22D17E' : '#2A2A3E'}`,
                         boxShadow: isActive ? '0 0 16px rgba(34,209,126,0.40)' : 'none',
                       }}>
                    {done
                      ? <Icon name="check" size={14} style={{ color: isActive ? '#fff' : '#22D17E' }} />
                      : <span className="font-dmmono text-[10px] text-text-muted">{i + 1}</span>
                    }
                  </div>
                  <div className={`flex-1 flex justify-between items-start pb-5 ${i < STEPS.length - 1 ? 'border-b border-surface-3' : ''}`}>
                    <div>
                      <div className="text-sm font-bold"
                           style={{ color: isActive ? '#22D17E' : done ? '#FFFFFF' : '#6B7280' }}>
                        {i + 1}. {step.label}
                      </div>
                      <div className="text-xs text-text-muted mt-1">{step.desc}</div>
                    </div>
                    {step.date && (
                      <span className="font-dmmono text-[11px] text-text-muted shrink-0 ml-3">{fmtTs(step.date)}</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Receipt */}
        <div className="rounded-2xl bg-surface-1 border border-surface-3 p-5 md:p-6 mb-5">
          <h3 className="font-syne font-bold text-[15px] text-text-primary mb-3">Payout Receipt</h3>

          <ReceiptRow
            iconNode={<GemIcon size={18} />}
            iconBg="rgba(180,79,255,0.12)"
            label="Gems debited"
            value={`${payout.gems?.toLocaleString?.() || payout.gems} gems`}
            valueSub={`≈ €${(payout.eurValue || 0).toFixed(2)}`}
          />
          <ReceiptRow
            iconNode={<Icon name="account_balance_wallet" size={18} style={{ color: '#22D17E' }} />}
            iconBg="rgba(34,209,126,0.12)"
            label="Amount sent"
            value={`≈ €${(payout.eurAfterSpread || payout.eurEstimate || 0).toFixed(2)}`}
            valueSub={`${payout.gemsAfterSpread || payout.gems} gems`}
            valueColor="#22D17E"
          />

          <DetailRow label="Wallet address" value={truncate(payout.walletAddress || payout.payoutAddress, 24)} copy={payout.walletAddress || payout.payoutAddress} />
          {payout.hash && (
            <DetailRow label="Transaction ID" value={truncate(payout.hash, 18)} copy={payout.hash} />
          )}
          <DetailRow label="Reference" value={payout.id || '—'} />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5">
          <FooterBtn icon="arrow_back"  onClick={() => navigate('/wallet')}>Back to Wallet</FooterBtn>
          <FooterBtn icon="receipt_long" onClick={() => navigate('/wallet/payout/history')}>All payouts</FooterBtn>
          <FooterBtn icon="warning" tone="ember" onClick={() => showToast?.('Support not yet wired', 'info')}>Report a problem</FooterBtn>
        </div>
      </div>
    </div>
  );
}

function PayoutStatusSkeleton({ onBack }) {
  return (
    <div className="px-4 md:px-7 py-6 max-w-[780px] mx-auto">
      <div className="h-7 w-48 rounded skeleton-wave mb-2" />
      <div className="rounded-2xl bg-surface-1 border border-surface-3 p-7 mb-5 h-[160px]" />
      <div className="rounded-2xl bg-surface-1 border border-surface-3 p-5 h-[300px]" />
    </div>
  );
}

function ReceiptRow({ iconNode, iconBg, label, value, valueSub, valueColor }) {
  return (
    <div className="flex items-center justify-between py-3.5 border-b border-surface-3 last:border-0">
      <div className="flex items-center gap-3">
        <div className="w-9 h-9 rounded-full flex items-center justify-center" style={{ background: iconBg }}>
          {iconNode}
        </div>
        <span className="text-sm text-text-primary">{label}</span>
      </div>
      <div className="text-right">
        <div className="font-dmmono font-bold text-base" style={{ color: valueColor || '#FFFFFF' }}>{value}</div>
        {valueSub && <div className="text-[11px] text-text-muted font-dmmono">{valueSub}</div>}
      </div>
    </div>
  );
}

function DetailRow({ label, value, copy, link }) {
  return (
    <div className="flex items-center justify-between py-3 border-b border-surface-3 last:border-0">
      <div className="flex items-center gap-2.5">
        <div className="w-7" />
        <span className="text-[13px] text-text-muted">{label}</span>
      </div>
      <div className="flex items-center gap-1.5 max-w-[60%] overflow-hidden">
        <span className={`font-dmmono text-xs ${link ? 'text-brand-violet-light underline cursor-pointer' : 'text-text-primary'} truncate`}>{value}</span>
        {copy && (
          <button onClick={() => navigator.clipboard?.writeText(copy)}
                  className="text-text-muted hover:text-text-primary p-1 transition-colors">
            <Icon name="content_copy" size={13} />
          </button>
        )}
      </div>
    </div>
  );
}

function FooterBtn({ icon, children, tone, onClick }) {
  const styles = tone === 'ember'
    ? { background: 'rgba(240,60,96,0.10)', color: '#F04060', border: '1px solid rgba(240,60,96,0.30)' }
    : { background: 'rgba(255,255,255,0.04)', color: '#9CA3AF', border: '1px solid rgba(255,255,255,0.08)' };
  return (
    <button onClick={onClick}
      className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-semibold transition-colors hover:brightness-125"
      style={styles}>
      {icon && <Icon name={icon} size={14} />} {children}
    </button>
  );
}

function Header({ title, subtitle, onBack }) {
  return (
    <div className="mb-5">
      <button onClick={onBack} className="flex items-center gap-1.5 text-text-muted text-[13px] mb-1.5 hover:text-text-primary transition-colors">
        <Icon name="arrow_back" size={16} />
      </button>
      <h1 className="font-syne text-[22px] font-bold text-text-primary mb-1">{title}</h1>
      <p className="text-text-muted text-[13px]">{subtitle}</p>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════
// PayoutHistoryScreen — /wallet/payout/history
// ════════════════════════════════════════════════════════════════════

const STATUS_FILTERS = ['All', 'pending', 'sending', 'finished', 'failed'];
const STATUS_FILTER_LABELS = { All: 'All', pending: 'Pending', sending: 'Sending', finished: 'Confirmed', failed: 'Failed' };

export function PayoutHistoryScreen() {
  const { currentUser } = useAuth();
  const { wallet } = useUser();
  const navigate = useNavigate();
  const { setRightPanel, setContentAlign } = useLayout();
  const { isMobile } = useResponsive();

  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('All');

  useEffect(() => {
    setRightPanel(null);
    setContentAlign('left');
    return () => { setRightPanel(null); setContentAlign('center'); };
  }, [setRightPanel, setContentAlign]);

  useEffect(() => {
    if (!currentUser?.uid) return;
    setLoading(true);
    const q = query(
      collection(db, 'payouts'),
      where('userId', '==', currentUser.uid),
      orderBy('createdAt', 'desc'),
      limit(50),
    );
    getDocs(q).then(snap => {
      setItems(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    }).catch(err => console.warn('Payout history failed', err))
      .finally(() => setLoading(false));
  }, [currentUser?.uid]);

  const filtered = useMemo(() => {
    if (statusFilter === 'All') return items;
    return items.filter(p => p.status === statusFilter);
  }, [items, statusFilter]);

  const gemBalance = wallet?.gems || 0;

  return (
    <div className="pb-10">
      {isMobile && <TopBar title="Payout History" showBack />}
      <div className="px-4 md:px-7 py-5 md:py-7">
        {!isMobile && (
          <div className="flex items-start justify-between mb-5">
            <Header title="Payout History" subtitle="View and track all your withdrawal requests." onBack={() => navigate('/wallet')} />
            <div className="flex items-center gap-1.5 mt-2">
              <GemIcon size={16} />
              <span className="font-dmmono font-bold text-sm text-text-primary tabular-nums">{gemBalance.toLocaleString()}</span>
            </div>
          </div>
        )}

        {/* Filter bar */}
        <div className="rounded-2xl bg-surface-1 border border-surface-3 p-3 mb-4 flex flex-wrap items-center gap-2">
          {STATUS_FILTERS.map(f => {
            const active = statusFilter === f;
            const tone = STATUS_TONE[f];
            return (
              <button key={f} onClick={() => setStatusFilter(f)}
                className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-md text-[13px] font-semibold transition-colors"
                style={active
                  ? { background: '#7B1FFF', color: '#fff' }
                  : { background: 'transparent', color: '#9CA3AF' }}>
                {f !== 'All' && tone && <span className="w-1.5 h-1.5 rounded-full" style={{ background: tone.color }} />}
                {STATUS_FILTER_LABELS[f]}
              </button>
            );
          })}
          <button onClick={() => navigate('/wallet/addresses')}
            className="ml-auto flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[12px] font-semibold transition-colors"
            style={{ background: 'rgba(180,79,255,0.10)', color: '#B44FFF', border: '1px solid rgba(180,79,255,0.30)' }}>
            <Icon name="account_balance_wallet" size={13} /> Saved Addresses
          </button>
        </div>

        {/* Table */}
        <div className="rounded-2xl bg-surface-1 border border-surface-3 overflow-hidden">
          {loading ? (
            <ListSkeleton rows={5} />
          ) : filtered.length === 0 ? (
            <div className="py-12 px-6 flex flex-col items-center text-center">
              <div className="text-5xl mb-3">💼</div>
              <h3 className="font-syne font-bold text-lg text-text-primary mb-1">No withdrawals yet</h3>
              <p className="text-text-muted text-[13px] mb-4">Your first withdrawal will show here.</p>
              <button onClick={() => navigate('/request-payout')}
                className="px-4 py-2 rounded-lg text-[13px] font-bold"
                style={{ background: 'transparent', color: '#B44FFF', border: '1px solid #B44FFF' }}>
                + Request a payout
              </button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-surface-3">
                    {['Date & time', 'Status', 'Amount', 'Wallet', 'Reference', ''].map(h => (
                      <th key={h} className="text-left text-[10px] font-bold tracking-widest uppercase text-text-muted py-3 px-4">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(p => (
                    <tr key={p.id}
                      onClick={() => navigate(`/wallet/payout/${p.id}`)}
                      className="border-b border-surface-3 last:border-0 hover:bg-white/[0.02] cursor-pointer transition-colors">
                      <td className="py-3.5 px-4">
                        <div className="font-dmmono text-[13px] text-text-primary tabular-nums">{fmtDateOnly(p.createdAt)}</div>
                        <div className="font-dmmono text-[11px] text-text-muted tabular-nums">{fmtTimeOnly(p.createdAt)}</div>
                      </td>
                      <td className="py-3.5 px-4">
                        <StatusBadge status={p.status} />
                      </td>
                      <td className="py-3.5 px-4">
                        <div className="flex items-center gap-1.5">
                          <GemIcon size={13} />
                          <span className="font-dmmono text-[13px] text-text-primary tabular-nums">{p.gems?.toLocaleString?.() || p.gemsRequested?.toLocaleString?.() || '—'}</span>
                          <Icon name="arrow_forward" size={13} className="text-text-muted" />
                          <span className="font-dmmono text-[13px] font-bold text-text-primary">≈ €{(p.eurAfterSpread || p.eurEstimate || 0).toFixed(2)}</span>
                        </div>
                      </td>
                      <td className="py-3.5 px-4">
                        <span className="font-dmmono text-xs text-text-muted">{truncate(p.payoutAddress, 18)}</span>
                      </td>
                      <td className="py-3.5 px-4">
                        <span className="font-dmmono text-xs text-text-muted">{p.id ? truncate(p.id, 14) : '—'}</span>
                      </td>
                      <td className="py-3.5 px-4">
                        <Icon name="chevron_right" size={18} className="text-text-muted" />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="mt-4 flex items-center justify-center gap-1.5 text-text-muted">
          <Icon name="lock" size={13} />
          <span className="text-xs">Payouts are processed securely in weekly batches</span>
        </div>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════
// SavedAddressesScreen — /wallet/addresses
// ════════════════════════════════════════════════════════════════════

export function SavedAddressesScreen() {
  const { currentUser } = useAuth();
  const { showToast } = useUI();
  const { setRightPanel, setContentAlign } = useLayout();
  const { isMobile } = useResponsive();
  const navigate = useNavigate();

  const [addresses, setAddresses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);

  useEffect(() => {
    setRightPanel(null);
    setContentAlign('left');
    return () => { setRightPanel(null); setContentAlign('center'); };
  }, [setRightPanel, setContentAlign]);

  const load = async () => {
    if (!currentUser?.uid) return;
    setLoading(true);
    try {
      const snap = await getDocs(query(
        collection(db, `users/${currentUser.uid}/savedAddresses`),
        orderBy('createdAt', 'desc'),
      ));
      setAddresses(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    } finally { setLoading(false); }
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [currentUser?.uid]);

  const handleSetDefault = async (id) => {
    const updates = addresses.map(a => updateDoc(
      doc(db, `users/${currentUser.uid}/savedAddresses`, a.id),
      { isDefault: a.id === id },
    ));
    await Promise.all(updates);
    setAddresses(addresses.map(a => ({ ...a, isDefault: a.id === id })));
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Delete this saved address?')) return;
    await deleteDoc(doc(db, `users/${currentUser.uid}/savedAddresses`, id));
    setAddresses(addresses.filter(a => a.id !== id));
  };

  const handleAdd = async (data) => {
    const ref = await addDoc(
      collection(db, `users/${currentUser.uid}/savedAddresses`),
      { ...data, createdAt: serverTimestamp() },
    );
    if (data.isDefault) {
      await Promise.all(addresses.map(a => updateDoc(
        doc(db, `users/${currentUser.uid}/savedAddresses`, a.id),
        { isDefault: false },
      )));
    }
    setShowAdd(false);
    setAddresses(prev => [{ id: ref.id, ...data }, ...prev.map(a => data.isDefault ? { ...a, isDefault: false } : a)]);
    showToast?.('Address saved', 'success');
  };

  return (
    <div className="pb-10">
      {isMobile && <TopBar title="Saved Addresses" showBack />}
      <div className="px-4 md:px-7 py-5 md:py-7">
        {!isMobile && (
          <div className="flex items-start justify-between mb-5">
            <Header title="Saved Payout Addresses" subtitle="Manage your saved wallet addresses for faster withdrawals." onBack={() => navigate('/wallet')} />
            <button onClick={() => setShowAdd(true)}
              className="mt-2 flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-bold text-white"
              style={{ background: '#7B1FFF' }}>
              <Icon name="add" size={14} /> Add new address
            </button>
          </div>
        )}

        {loading ? (
          <ListSkeleton rows={4} />
        ) : addresses.length === 0 ? (
          <div className="rounded-2xl bg-surface-1 border border-surface-3 p-12 text-center">
            <div className="text-5xl mb-2">👛</div>
            <h3 className="font-syne font-bold text-lg text-text-primary mb-1.5">No saved addresses yet</h3>
            <p className="text-text-muted text-[13px] mb-5">Add your first wallet address to skip pasting next time you withdraw.</p>
            <button onClick={() => setShowAdd(true)}
              className="px-4 py-2 rounded-lg text-[13px] font-bold inline-flex items-center gap-1.5"
              style={{ background: 'transparent', color: '#B44FFF', border: '1px solid #B44FFF' }}>
              <Icon name="add" size={14} /> Add your first address
            </button>
          </div>
        ) : (
          <div className="rounded-2xl bg-surface-1 border border-surface-3 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-surface-3">
                    {['Network', 'Label', 'Address', 'Default', 'Actions'].map(h => (
                      <th key={h} className="text-left text-[10px] font-bold tracking-widest uppercase text-text-muted py-3 px-4">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {addresses.map(a => (
                    <tr key={a.id} className="border-b border-surface-3 last:border-0 hover:bg-white/[0.02] transition-colors">
                      <td className="py-3.5 px-4">
                        <div className="flex items-center gap-2.5">
                          <div className="w-7 h-7 rounded-full flex items-center justify-center" style={{ background: 'rgba(180,79,255,0.15)' }}>
                            <Icon name="account_balance_wallet" size={14} style={{ color: '#B44FFF' }} />
                          </div>
                          <span className="text-[13px] text-text-muted">{a.network || a.code || '—'}</span>
                        </div>
                      </td>
                      <td className="py-3.5 px-4">
                        <div className="flex items-center gap-2">
                          <span className="text-[13px] text-text-primary">{a.label || '—'}</span>
                          {a.isDefault && (
                            <span className="text-[10px] font-bold px-2 py-0.5 rounded"
                                  style={{ color: '#22D17E', background: 'rgba(34,209,126,0.12)', border: '1px solid rgba(34,209,126,0.20)' }}>
                              Default
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="py-3.5 px-4">
                        <div className="flex items-center gap-1.5">
                          <span className="font-dmmono text-xs text-text-muted truncate max-w-[200px]">{a.address}</span>
                          <button onClick={() => navigator.clipboard?.writeText(a.address)} className="text-text-muted hover:text-text-primary p-1">
                            <Icon name="content_copy" size={13} />
                          </button>
                        </div>
                      </td>
                      <td className="py-3.5 px-4">
                        <button onClick={() => handleSetDefault(a.id)} className="p-1">
                          <Icon name={a.isDefault ? 'star' : 'star_border'} size={20}
                                style={{ color: a.isDefault ? '#B44FFF' : '#6B7280' }} />
                        </button>
                      </td>
                      <td className="py-3.5 px-4">
                        <div className="flex items-center gap-2">
                          <button onClick={() => handleDelete(a.id)} className="text-text-muted hover:text-brand-ember p-1 transition-colors">
                            <Icon name="delete" size={16} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {showAdd && (
          <AddAddressModal onClose={() => setShowAdd(false)} onSave={handleAdd} />
        )}
      </div>
    </div>
  );
}

function AddAddressModal({ onClose, onSave }) {
  const [network, setNetwork] = useState('');
  const [label, setLabel]     = useState('');
  const [address, setAddress] = useState('');
  const [isDefault, setDef]   = useState(false);
  const [saving, setSaving]   = useState(false);

  const submit = async () => {
    if (!address.trim() || saving) return;
    setSaving(true);
    try {
      await onSave({ network: network.trim(), label: label.trim() || 'Payout Wallet', address: address.trim(), isDefault });
    } finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-[200] flex items-end md:items-center justify-center p-0 md:p-4" style={{ background: 'rgba(0,0,0,0.70)' }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()}
           className="bg-surface-1 border border-surface-3 rounded-t-2xl md:rounded-2xl p-6 w-full max-w-[600px] animate-slide-up"
           style={{ boxShadow: '0 -20px 60px rgba(0,0,0,0.8)' }}>
        <div className="flex items-start justify-between mb-1.5">
          <div>
            <h3 className="font-syne font-bold text-lg text-text-primary mb-1">Add payout address</h3>
            <p className="text-text-muted text-[13px]">Save your wallet address for faster withdrawals.</p>
          </div>
          <button onClick={onClose} className="text-text-muted hover:text-text-primary p-1"><Icon name="close" size={20} /></button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-5">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-wider text-text-muted mb-2">1. Network / type</p>
            <input type="text" value={network} onChange={e => setNetwork(e.target.value)}
                   placeholder="e.g. TRC-20, Polygon, ERC-20"
                   className="w-full bg-surface-3 border border-white/[0.08] rounded-lg py-2.5 px-3 text-sm text-text-primary outline-none placeholder:text-text-muted" />
          </div>
          <div>
            <p className="text-[11px] font-bold uppercase tracking-wider text-text-muted mb-2">2. Label</p>
            <input type="text" value={label} onChange={e => setLabel(e.target.value)}
                   placeholder="e.g. Main wallet"
                   className="w-full bg-surface-3 border border-white/[0.08] rounded-lg py-2.5 px-3 text-sm text-text-primary outline-none placeholder:text-text-muted" />
          </div>
        </div>

        <div className="mt-4">
          <p className="text-[11px] font-bold uppercase tracking-wider text-text-muted mb-2">3. Wallet address</p>
          <input type="text" value={address} onChange={e => setAddress(e.target.value.trim())}
                 placeholder="Paste your wallet address"
                 className="w-full bg-surface-3 border border-white/[0.08] rounded-lg py-2.5 px-3 text-sm text-text-primary outline-none placeholder:text-text-muted font-dmmono" />
          <p className="text-[10.5px] text-text-muted mt-1.5">
            Double-check your address — payouts sent to the wrong address cannot be recovered.
          </p>
        </div>

        <label className="flex items-center gap-2 mt-4 cursor-pointer text-[13px] text-text-secondary">
          <input type="checkbox" checked={isDefault} onChange={e => setDef(e.target.checked)} />
          Set as default address
        </label>

        <div className="flex gap-2 mt-5 justify-end">
          <button onClick={onClose}
            className="px-4 py-2.5 rounded-lg text-[13px] font-semibold"
            style={{ background: 'transparent', color: '#9CA3AF', border: '1px solid #2A2A3E' }}>
            Cancel
          </button>
          <button onClick={submit} disabled={!address.trim() || saving}
            className="px-5 py-2.5 rounded-lg text-[13px] font-bold text-white disabled:opacity-50"
            style={{ background: '#7B1FFF' }}>
            {saving ? 'Saving…' : 'Save address'}
          </button>
        </div>
      </div>
    </div>
  );
}
