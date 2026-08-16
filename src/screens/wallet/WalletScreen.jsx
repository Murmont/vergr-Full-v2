// Wallet redesigned to match the new VERGR design system:
//  • 3-up balance cards (VC Coins / VP Points / Gems) with big graphics
//  • Action bar with 6 wallet actions
//  • Two-column: Recent Transactions + Featured Packs
//  • Custom right rail: balance overview donut + recent activity + earn-more CTA
import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ListSkeleton } from '../../components/skeletons/GlassSkeletons';
import { useAuth } from '../../context/AuthContext';
import { useUser } from '../../context/UserContext';
import { useUI } from '../../context/UIContext';
import { getTransactions, getCoinPackages, sendCoins, searchUsers } from '../../firebase/firestore';
import { getVPLevel, getGemRate, getCommission } from '../../utils/vpSystem';
import TopBar from '../../components/TopBar';
import Icon from '../../components/Icon';
import { CoinIcon, VPIcon, GemIcon } from '../../components/CoinIcon';
import Modal from '../../components/Modal';
import UserAvatar from '../../components/UserAvatar';
import useResponsive from '../../hooks/useResponsive';
import { useLayout } from '../../context/LayoutContext';

// ─── Right rail ────────────────────────────────────────────────────
function WalletRightRail({ profile, wallet, transactions }) {
  const navigate = useNavigate();
  const coins = wallet?.balance || 0;
  const vp = wallet?.vp || 0;
  const gems = wallet?.gems || 0;
  // VP has NO monetary value — it only sets the user's level and commission
  // rate on payouts. Only Coins (€0.01 each) and Gems (€0.01 each, cashable)
  // contribute to the wallet's monetary balance.
  const coinsEUR = coins * 0.01;
  const gemsEUR = gems * 0.01;
  const totalEUR = coinsEUR + gemsEUR;
  const vpLevel = (typeof getVPLevel === 'function') ? getVPLevel(vp) : null;
  const commissionPct = vpLevel != null ? Math.round(getCommission(vp) * 100) : null;

  // Donut math — money only
  const total = Math.max(totalEUR, 0.0001);
  const fmtEUR = (amt) => {
    if (amt >= 0.01) return `€${amt.toFixed(2)}`;
    if (amt > 0) return `€${amt.toFixed(3).replace(/0+$/, '').replace(/\.$/, '')}`;
    return '€0.00';
  };
  const segs = [
    { value: coinsEUR, color: '#F5C542', label: 'VC Coins', display: fmtEUR(coinsEUR) },
    { value: gemsEUR,  color: '#3D7FFF', label: 'Gems',     display: fmtEUR(gemsEUR) },
  ];
  const C = 2 * Math.PI * 42; // circumference for r=42
  let acc = 0;
  const arcs = segs.map(s => {
    const len = (s.value / total) * C;
    const dash = `${len} ${C - len}`;
    const offset = -acc;
    acc += len;
    return { ...s, dash, offset };
  });

  const recentActivity = (transactions || []).slice(0, 5);
  const formatRel = (ts) => {
    if (!ts) return '';
    const d = ts.toDate ? ts.toDate() : new Date(ts);
    const diff = Date.now() - d.getTime();
    if (diff < 60000) return 'just now';
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
    return `${Math.floor(diff / 86400000)}d ago`;
  };

  return (
    <div className="w-full px-3 space-y-4">
      {/* User card */}
      <div className="flex items-center gap-3 p-3 rounded-2xl bg-surface-1 border border-white/[0.06]">
        <button
          onClick={() => navigate('/notifications')}
          className="w-9 h-9 rounded-full bg-surface-2 flex items-center justify-center text-text-secondary hover:text-text-primary"
        >
          <Icon name="notifications" size={18} />
        </button>
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <UserAvatar src={profile?.avatar} size={36} />
          <div className="min-w-0">
            <p className="text-sm font-bold text-text-primary truncate flex items-center gap-1">
              {profile?.displayName || profile?.username || 'You'}
              {profile?.verified && <Icon name="workspace_premium" size={14} className="text-brand-gold" />}
            </p>
            <p className="text-[10px] text-emerald-400 flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" /> Online
            </p>
          </div>
        </div>
      </div>

      {/* Balance overview donut */}
      <div className="p-4 rounded-2xl bg-surface-1 border border-white/[0.06]">
        <p className="text-text-muted text-[10px] uppercase tracking-wider font-bold mb-3">Your Balance Overview</p>
        <div className="flex items-center gap-3">
          <div className="relative w-[92px] h-[92px] shrink-0">
            <svg viewBox="0 0 100 100" className="-rotate-90 w-full h-full">
              <circle cx="50" cy="50" r="42" fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth="10" />
              {arcs.map((a, i) => (
                <circle
                  key={i}
                  cx="50" cy="50" r="42" fill="none"
                  stroke={a.color}
                  strokeWidth="10"
                  strokeDasharray={a.dash}
                  strokeDashoffset={a.offset}
                  strokeLinecap="butt"
                />
              ))}
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-[9px] uppercase tracking-wider text-text-muted">Total</span>
              <span className="text-base font-black font-dmmono tabular-nums text-text-primary leading-none">{fmtEUR(totalEUR)}</span>
            </div>
          </div>
          <ul className="flex-1 space-y-1.5 text-[11px]">
            {arcs.map((a, i) => (
              <li key={i} className="flex items-center justify-between">
                <span className="flex items-center gap-1.5 text-text-secondary">
                  <span className="w-2 h-2 rounded-full" style={{ background: a.color }} />
                  {a.label}
                </span>
                <span className="font-dmmono tabular-nums text-text-primary">{a.display}</span>
              </li>
            ))}
          </ul>
        </div>

        {/* VP — points only, not money. Shown as a separate stat row. */}
        <div className="mt-3 pt-3 border-t border-white/[0.06] flex items-center justify-between text-[11px]">
          <span className="flex items-center gap-1.5 text-text-secondary">
            <VPIcon size={12} />
            VP Points
            {vpLevel?.name && (
              <span className="ml-1 px-1.5 py-[1px] rounded-full text-[9px] font-bold uppercase tracking-wider" style={{ background: 'rgba(180,79,255,0.12)', color: '#B44FFF' }}>
                {vpLevel.name}
              </span>
            )}
          </span>
          <span className="font-dmmono tabular-nums font-bold" style={{ color: '#B44FFF' }}>
            {vp.toLocaleString()}
          </span>
        </div>
        {commissionPct != null && (
          <div className="mt-1.5 text-[10px] text-text-muted leading-relaxed space-y-1">
            <p>
              Convert coins to gems at <span className="font-dmmono tabular-nums font-bold" style={{ color: '#3D7FFF' }}>{100 - commissionPct}%</span> · platform commission <span className="font-dmmono tabular-nums text-text-secondary">{commissionPct}%</span>
            </p>
            <button
              onClick={() => navigate('/earn')}
              className="inline-flex items-center gap-1 font-semibold hover:underline"
              style={{ color: '#B44FFF' }}
            >
              Earn VP to reduce commission <Icon name="arrow_forward" size={11} />
            </button>
          </div>
        )}
      </div>

      {/* Recent activity */}
      <div className="p-4 rounded-2xl bg-surface-1 border border-white/[0.06]">
        <p className="text-text-muted text-[10px] uppercase tracking-wider font-bold mb-3">Recent Activity</p>
        {recentActivity.length === 0 ? (
          <p className="text-text-muted text-xs">No activity yet</p>
        ) : (
          <ul className="space-y-2.5">
            {recentActivity.map(tx => {
              const positive = (tx.amount || 0) > 0;
              const cur = (tx.currency === 'vp' || /VP/i.test(tx.description || '')) ? 'VP' : 'VC';
              return (
                <li key={tx.id} className="flex items-center gap-2.5">
                  <div className="w-7 h-7 rounded-lg bg-surface-2 flex items-center justify-center shrink-0">
                    <Icon name={tx.amount > 0 ? 'arrow_downward' : 'arrow_upward'} size={14} className={positive ? 'text-emerald-400' : 'text-brand-ember'} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[12px] font-semibold text-text-primary truncate">{tx.description || tx.desc || tx.type}</p>
                    <p className="text-[10px] text-text-muted">{formatRel(tx.createdAt)}</p>
                  </div>
                  <span className={`font-dmmono tabular-nums text-[11px] font-bold ${positive ? 'text-emerald-400' : 'text-text-secondary'}`}>
                    {positive ? '+' : ''}{tx.amount} {cur}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
        <button
          onClick={() => navigate('/transactions/filter')}
          className="mt-3 w-full py-2 rounded-lg bg-surface-2 hover:bg-surface-3 text-[11px] font-bold text-text-secondary flex items-center justify-center gap-1.5 transition-colors"
        >
          View All Activity <Icon name="arrow_forward" size={12} />
        </button>
      </div>

      {/* Earn more rewards */}
      <div className="p-4 rounded-2xl bg-gradient-to-br from-brand-violet/15 to-brand-pink/10 border border-brand-violet/25">
        <p className="text-brand-violet text-[10px] uppercase tracking-wider font-bold mb-1">Earn More Rewards</p>
        <p className="text-text-secondary text-[11px] mb-3">Complete tasks and challenges to earn more VP points and VC coins!</p>
        <div className="flex items-center justify-between text-[10px] mb-1.5">
          <span className="text-text-muted">Next Reward</span>
          <span className="font-dmmono font-bold text-brand-violet">200 VP</span>
        </div>
        <div className="h-1.5 rounded-full bg-white/[0.05] overflow-hidden mb-1">
          <div className="h-full bg-gradient-to-r from-brand-violet to-brand-pink" style={{ width: '75%' }} />
        </div>
        <p className="text-[9.5px] text-text-muted text-right font-dmmono mb-3">150 / 200</p>
        <button
          onClick={() => navigate('/earn')}
          className="w-full py-2.5 rounded-xl bg-gradient-to-r from-brand-violet to-brand-pink text-white text-[12px] font-bold flex items-center justify-center gap-1.5 hover:brightness-110"
        >
          <Icon name="bolt" size={14} /> Go to Challenges
        </button>
      </div>
    </div>
  );
}

// ─── Main screen ───────────────────────────────────────────────────
export default function WalletScreen() {
  const [transactions, setTransactions] = useState([]);
  const [coinPacks, setCoinPacks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('transactions');

  const [showSendModal, setShowSendModal] = useState(false);
  const [sendSearch, setSendSearch] = useState('');
  const [sendResults, setSendResults] = useState([]);
  const [sendTarget, setSendTarget] = useState(null);
  const [sendAmount, setSendAmount] = useState('');
  const [sending, setSending] = useState(false);

  const { currentUser } = useAuth();
  const { profile, wallet } = useUser();
  const { showToast } = useUI();
  const navigate = useNavigate();
  const { isMobile, isDesktop } = useResponsive();
  const { setRightPanel, setContentAlign } = useLayout();

  // Inject our custom right rail into the layout chrome
  useEffect(() => {
    setRightPanel(<WalletRightRail profile={profile} wallet={wallet} transactions={transactions} />);
    setContentAlign('left');
    return () => {
      setRightPanel(null);
      setContentAlign('center');
    };
  }, [setRightPanel, setContentAlign, profile, wallet, transactions]);

  useEffect(() => {
    if (!currentUser) return;
    (async () => {
      setLoading(true);
      try {
        const [txs, packs] = await Promise.all([
          getTransactions(currentUser.uid),
          getCoinPackages(),
        ]);
        setTransactions(txs);
        setCoinPacks(packs);
      } catch (err) {
        console.error('Failed to load wallet data:', err);
      }
      setLoading(false);
    })();
  }, [currentUser]);

  const handleSendSearch = async (term) => {
    setSendSearch(term);
    if (term.length < 2) { setSendResults([]); return; }
    try {
      const results = await searchUsers(term, 5);
      setSendResults(results.filter(u => u.id !== currentUser.uid));
    } catch (err) { console.error(err); }
  };

  const handleSend = async () => {
    if (!sendTarget || !sendAmount || sending) return;
    const amount = parseInt(sendAmount, 10);
    if (isNaN(amount) || amount <= 0 || amount > (wallet?.balance || 0)) return;
    setSending(true);
    try {
      await sendCoins(currentUser.uid, sendTarget.id, amount, `Sent to @${sendTarget.username}`);
      showToast(`Sent ${amount} coins to @${sendTarget.username}`, 'coins');
      setShowSendModal(false);
      setSendTarget(null);
      setSendAmount('');
      setSendSearch('');
      const txs = await getTransactions(currentUser.uid);
      setTransactions(txs);
    } catch (err) {
      console.error('Send failed:', err);
      showToast(err.message || 'Failed to send coins', 'error');
    }
    setSending(false);
  };

  const closeSendModal = () => {
    setShowSendModal(false);
    setSendTarget(null);
    setSendAmount('');
    setSendSearch('');
    setSendResults([]);
  };

  const formatDate = (ts) => {
    if (!ts) return '';
    const d = ts.toDate ? ts.toDate() : new Date(ts);
    return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }) + ' • ' +
           d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  };

  const getTxIcon = (type) => {
    switch (type) {
      case 'daily_reward':       return { icon: 'local_fire_department', color: 'text-brand-gold', bg: 'bg-brand-gold/10' };
      case 'quest_reward':       return { icon: 'emoji_events', color: 'text-brand-gold', bg: 'bg-brand-gold/10' };
      case 'tier_reward':        return { icon: 'workspace_premium', color: 'text-brand-violet', bg: 'bg-brand-violet/10' };
      case 'received':
      case 'tip_received':       return { icon: 'arrow_downward', color: 'text-emerald-400', bg: 'bg-emerald-400/10' };
      case 'sent':
      case 'tip_sent':           return { icon: 'send', color: 'text-brand-violet', bg: 'bg-brand-violet/10' };
      case 'purchase':           return { icon: 'shopping_bag', color: 'text-brand-gold', bg: 'bg-brand-gold/10' };
      case 'payout':
      case 'gem_cashout':        return { icon: 'diamond', color: 'text-brand-violet-light', bg: 'bg-brand-violet/10' };
      case 'tournament_entry':   return { icon: 'confirmation_number', color: 'text-brand-pink', bg: 'bg-brand-pink/10' };
      case 'tournament_prize':
      case 'tournament_win':     return { icon: 'emoji_events', color: 'text-brand-gold', bg: 'bg-brand-gold/10' };
      case 'squad_contribution': return { icon: 'groups', color: 'text-brand-violet', bg: 'bg-brand-violet/10' };
      case 'boost':              return { icon: 'trending_up', color: 'text-brand-pink', bg: 'bg-brand-pink/10' };
      case 'membership':         return { icon: 'card_membership', color: 'text-brand-pink', bg: 'bg-brand-pink/10' };
      case 'referral':           return { icon: 'person_add', color: 'text-brand-violet-light', bg: 'bg-brand-violet/10' };
      default:                   return { icon: 'swap_vert', color: 'text-text-muted', bg: 'bg-surface-3' };
    }
  };

  const vpLevelName = useMemo(() => {
    const lvl = getVPLevel?.(wallet?.vp || 0);
    return lvl?.name?.toUpperCase?.() || (wallet?.vp >= 1000 ? 'PRO' : 'ROOKIE');
  }, [wallet?.vp]);

  // Gem rate at the user's current VP tier — keep% of every coin tipped
  const gemRate = getGemRate?.(wallet?.vp || 0) ?? 1;
  const keepPct = Math.round(gemRate * 100);

  // Format a EUR amount so small balances stay visible (€0.001 instead of €0.00)
  const fmtEUR = (amt) => {
    if (amt >= 1) return `€${amt.toFixed(2)}`;
    if (amt >= 0.01) return `€${amt.toFixed(2)}`;
    if (amt > 0) return `€${amt.toFixed(3).replace(/0+$/, '').replace(/\.$/, '')}`;
    return '€0.00';
  };

  // ─── Three balance cards ─────────────────────────────────────────
  const renderBalanceCards = () => {
    const cards = [
      // Palette comes straight from the Claude Design wallet mock:
      // gold #f0a500/#f5c842, purple-light #b44fff, cyan (gems) #3d7fff.
      // All three card graphics render at the SAME 80x80 slot.
      {
        key: 'coins',
        label: 'VC COINS',
        labelStyle: { color: '#F5C842' },
        borderStyle: { borderColor: 'rgba(240,165,0,0.30)' },
        bgStyle: { background: '#14141F', boxShadow: '0 0 40px rgba(240,165,0,0.08)' },
        value: (wallet?.balance || 0).toLocaleString(),
        sub: `= €${((wallet?.balance || 0) * 0.01).toFixed(2)}`,
        graphic: <CoinIcon size={80} className="drop-shadow-[0_0_18px_rgba(240,165,0,0.7)]" />,
        cta: { label: 'Buy Coins', icon: 'add', onClick: () => navigate('/buy-coins'),
               style: { background: 'rgba(240,165,0,0.08)', color: '#F0A500', border: '1px solid rgba(240,165,0,0.35)' } },
      },
      {
        key: 'vp',
        label: 'VP POINTS',
        labelStyle: { color: '#B44FFF' },
        borderStyle: { borderColor: 'rgba(124,58,237,0.40)' },
        bgStyle: { background: 'linear-gradient(135deg, #14141F 0%, #1A1030 100%)', boxShadow: '0 0 40px rgba(124,58,237,0.12)' },
        value: (wallet?.vp || 0).toLocaleString(),
        sub: vpLevelName,
        subBadge: true,
        graphic: <VPIcon size={80} className="drop-shadow-[0_0_18px_rgba(140,80,255,0.8)]" />,
        cta: { label: 'Earn VP', icon: 'arrow_forward', onClick: () => navigate('/earn'),
               style: { background: 'rgba(123,31,255,0.12)', color: '#B44FFF', border: '1px solid rgba(180,79,255,0.45)' } },
      },
      {
        key: 'gems',
        label: 'GEMS',
        labelStyle: { color: '#3D7FFF' },
        borderStyle: { borderColor: 'rgba(61,127,255,0.30)' },
        bgStyle: { background: '#14141F', boxShadow: '0 0 40px rgba(61,127,255,0.08)' },
        // Gems = the withdrawable balance the user actually holds.
        value: (wallet?.gems || 0).toLocaleString(),
        sub: (() => {
          const have = wallet?.gems || 0;
          const couldGet = Math.floor((wallet?.balance || 0) * gemRate);
          const eur = fmtEUR(have * 0.01);
          if (couldGet > 0) return `≈ ${eur} · convert coins → +${couldGet.toLocaleString()} gems`;
          return `≈ ${eur} · withdrawable currency`;
        })(),
        graphic: <GemIcon size={80} className="drop-shadow-[0_0_18px_rgba(61,127,255,0.8)]" />,
        cta: { label: 'Convert Coins', icon: 'sync_alt', onClick: () => navigate('/wallet/convert'),
               style: { background: 'rgba(61,127,255,0.08)', color: '#3D7FFF', border: '1px solid rgba(61,127,255,0.35)' } },
      },
    ];

    return (
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {cards.map(c => (
          <div
            key={c.key}
            className="relative overflow-hidden rounded-2xl border p-5 flex flex-col"
            style={{ ...c.borderStyle, ...c.bgStyle }}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[10.5px] uppercase tracking-wider font-bold" style={c.labelStyle}>{c.label}</p>
                <p className="text-4xl font-black font-dmmono tabular-nums text-text-primary mt-2 leading-none">{c.value}</p>
                {c.subBadge ? (
                  <span className="inline-block mt-2 px-2.5 py-0.5 rounded-full bg-white/[0.06] text-[10px] font-bold tracking-wider text-text-secondary">{c.sub}</span>
                ) : (
                  <p className="text-text-muted text-[11px] mt-1.5 font-dmmono">{c.sub}</p>
                )}
              </div>
              <div
                className="shrink-0 flex items-center justify-center"
                style={{ width: 80, height: 80 }}
              >
                {c.graphic}
              </div>
            </div>
            <button
              onClick={c.cta.onClick}
              className="mt-4 w-full py-2.5 rounded-xl text-[12px] font-bold flex items-center justify-center gap-2 transition-colors hover:brightness-125"
              style={c.cta.style}
            >
              {c.cta.label} <Icon name={c.cta.icon} size={14} />
            </button>
          </div>
        ))}
      </div>
    );
  };

  // ─── Action bar (matches Claude Design wallet mock) ──────────────
  const renderActionBar = () => {
    const actions = [
      { icon: 'add_circle',   label: 'Buy VC Coins',        bg: 'rgba(240,165,0,0.12)',   color: '#F0A500', glow: 'rgba(240,165,0,0.25)',   onClick: () => navigate('/buy-coins') },
      { icon: 'emoji_events', label: 'Earn VP Points',      bg: 'rgba(124,58,237,0.15)',  color: '#B44FFF', glow: 'rgba(124,58,237,0.30)',  onClick: () => navigate('/earn') },
      { icon: 'sync_alt',     label: 'Convert to Gems',     bg: 'rgba(61,127,255,0.12)',  color: '#3D7FFF', glow: 'rgba(61,127,255,0.30)',  onClick: () => navigate('/wallet/convert') },
      { icon: 'savings',      label: 'Cash Out Gems',       bg: 'rgba(34,209,126,0.12)',  color: '#22D17E', glow: 'rgba(34,209,126,0.20)',  onClick: () => navigate('/request-payout') },
      { icon: 'send',         label: 'Send',                bg: 'rgba(59,130,246,0.15)',  color: '#60A5FA', glow: 'rgba(96,165,250,0.25)',  onClick: () => setShowSendModal(true) },
      { icon: 'history',      label: 'Transaction History', bg: 'rgba(156,163,175,0.10)', color: '#9CA3AF', glow: null,                     onClick: () => navigate('/transactions/filter') },
    ];
    return (
      <div
        className="flex items-center justify-around gap-2 rounded-xl px-6 py-4"
        style={{ background: '#14141F', border: '1px solid #1E1E2E' }}
      >
        {actions.map(a => (
          <motion.button
            key={a.label}
            onClick={a.onClick}
            whileTap={{ scale: 0.95 }}
            className="flex flex-col items-center gap-2 transition-transform hover:-translate-y-0.5"
          >
            <div
              className="w-10 h-10 rounded-full flex items-center justify-center"
              style={{ background: a.bg, color: a.color, boxShadow: a.glow ? `0 0 14px ${a.glow}` : undefined }}
            >
              <Icon name={a.icon} size={20} />
            </div>
            <span className="text-[11px] font-medium text-text-dim text-center" style={{ color: '#9CA3AF' }}>{a.label}</span>
          </motion.button>
        ))}
      </div>
    );
  };

  // ─── Recent transactions ─────────────────────────────────────────
  const renderTransactions = () => (
    <div className="rounded-2xl bg-surface-1 border border-white/[0.06] p-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-syne font-bold text-base text-text-primary">Recent Transactions</h2>
        <button
          onClick={() => navigate('/transactions/filter')}
          className="text-[11px] font-bold text-text-muted hover:text-text-primary px-3 py-1 rounded-full bg-surface-2 border border-white/[0.06]"
        >
          View All
        </button>
      </div>
      {loading ? (
        <ListSkeleton rows={4} />
      ) : transactions.length === 0 ? (
        <div className="text-center py-8">
          <Icon name="receipt_long" size={40} className="text-text-muted/20 mx-auto mb-3" />
          <p className="text-text-muted text-sm">No transactions yet</p>
        </div>
      ) : (
        <ul className="divide-y divide-white/[0.04]">
          {transactions.slice(0, 6).map(tx => {
            const style = getTxIcon(tx.type);
            const positive = (tx.amount || 0) > 0;
            const cur = (tx.currency === 'vp' || /VP/i.test(tx.description || '')) ? 'VP' : 'VC';
            return (
              <li key={tx.id}>
                <button
                  onClick={() => navigate(`/transaction/${tx.id}`)}
                  className="w-full flex items-center gap-3 py-2.5 text-left hover:bg-surface-2/40 rounded-lg px-2 -mx-2 transition-colors"
                >
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${style.bg} shrink-0`}>
                    <Icon name={style.icon} size={18} className={style.color} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] font-semibold text-text-primary truncate">{tx.description || tx.desc || tx.type}</p>
                    <p className="text-[10.5px] text-text-muted font-dmmono">{formatDate(tx.createdAt)}</p>
                  </div>
                  <span className={`font-dmmono tabular-nums text-[13px] font-bold ${positive ? 'text-emerald-400' : 'text-text-secondary'}`}>
                    {positive ? '+' : ''}{tx.amount} {cur}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <button
        onClick={() => navigate('/transactions/filter')}
        className="mt-3 w-full py-2.5 rounded-xl bg-brand-violet/10 text-brand-violet text-[12px] font-bold flex items-center justify-center gap-1.5 hover:bg-brand-violet/20 transition-colors"
      >
        View All Transactions <Icon name="arrow_forward" size={14} />
      </button>
    </div>
  );

  // ─── Featured packs (matches Claude Design wallet mock) ──────────
  const renderFeaturedPacks = () => {
    // Three featured picks pulled from the canonical pack catalogue. The
    // /buy-coins screen shows the full lineup.
    // Three featured picks. Source of truth: vpSystem.COIN_PACKS.
    const fallback = [
      // Mirrors vpSystem.js COIN_PACKS (native USD since 2026-08-11). Keep the
      // coins and prices identical to that file, or this teaser advertises a
      // deal the buy screen will not honour.
      { id: 'starter', name: 'Starter Pack',  coins: 78,     priceUSD: 0.99,   glow: 'rgba(240,165,0,0.5)' },
      { id: 'pro',     name: 'Pro Pack',      coins: 815,    priceUSD: 9.99,   glow: 'rgba(240,165,0,0.6)', popular: true },
      { id: 'titan',   name: 'Titan Pack',    coins: 12800,  priceUSD: 149.99, glow: 'rgba(140,80,255,0.5)', vpPack: true },
    ];
    const packs = (coinPacks && coinPacks.length >= 3)
      ? coinPacks.filter(p => ['starter', 'pro', 'titan'].includes(p.id)).slice(0, 3)
      : fallback;
    const finalPacks = packs.length === 3 ? packs : fallback;

    return (
      <div className="rounded-xl p-4 flex flex-col gap-2.5" style={{ background: '#14141F', border: '1px solid #1E1E2E' }}>
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-[15px] font-bold text-text-primary">Featured Packs</h2>
          <button
            onClick={() => navigate('/buy-coins')}
            className="text-[12px] font-semibold flex items-center gap-1 hover:text-white transition-colors"
            style={{ color: '#B44FFF' }}
          >
            View Store <Icon name="arrow_forward" size={10} />
          </button>
        </div>
        {finalPacks.map((p, i) => {
          const isFeatured = p.popular || p.badgeStyle === 'popular';
          const isVPPack = p.vpPack || (p.vpBonus || 0) > 0;
          const glow = p.glow || (isVPPack ? 'rgba(140,80,255,0.5)' : 'rgba(240,165,0,0.5)');
          const slug = `${p.id}-pack`;
          return (
            <div
              key={p.id}
              className={`relative flex items-center gap-3 rounded-[10px] px-3.5 py-3 transition-colors ${isFeatured ? 'mt-3' : ''}`}
              style={isFeatured
                ? { background: 'rgba(124,58,237,0.08)', border: '1px solid rgba(124,58,237,0.40)', boxShadow: '0 0 20px rgba(124,58,237,0.12)' }
                : { background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }
              }
            >
              {isFeatured && (
                <span
                  className="absolute -top-2.5 left-1/2 -translate-x-1/2 text-white text-[8px] font-bold tracking-wider px-2.5 py-[3px] rounded-full uppercase whitespace-nowrap"
                  style={{ background: 'linear-gradient(90deg, #F59E0B, #EF4444)' }}
                >
                  Most Popular
                </span>
              )}
              {/* Pack PNG, bare with drop-shadow — no container behind it */}
              <img
                src={`/brand/packs/${slug}.webp`}
                alt={p.name}
                className="w-12 h-12 object-contain shrink-0"
                style={{ filter: `drop-shadow(0 0 10px ${glow})` }}
                onError={(e) => { e.currentTarget.style.display = 'none'; }}
                draggable={false}
              />
              <div className="flex-1 min-w-0">
                <p className="text-[13px] font-semibold text-text-primary truncate">{p.name}</p>
                <p className="text-[11px] text-text-muted">{(p.coins || 0).toLocaleString()} VC Coins</p>
              </div>
              <button
                onClick={() => navigate('/buy-coins')}
                className="px-4 py-2 rounded-lg text-[13px] font-bold text-white transition-colors shrink-0 hover:brightness-125"
                style={isFeatured
                  ? { background: 'rgba(124,58,237,0.15)', border: '1px solid rgba(124,58,237,0.50)' }
                  : { background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)' }
                }
              >
                ${Number(p.priceUSD || 0).toFixed(2)}
              </button>
            </div>
          );
        })}
        <button
          onClick={() => navigate('/buy-coins')}
          className="mt-1 w-full py-3 rounded-[10px] text-[12px] font-semibold flex items-center justify-center gap-2 transition-colors"
          style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(124,58,237,0.50)', color: '#B44FFF' }}
        >
          Browse All Packs <Icon name="arrow_forward" size={12} />
        </button>
      </div>
    );
  };

  // ─── Layout ──────────────────────────────────────────────────────
  return (
    <div className="pb-8">
      {isMobile && (
        <TopBar title="Wallet" showBack actions={
          <button onClick={() => navigate('/wallet/security')} className="w-9 h-9 rounded-full bg-surface-2 flex items-center justify-center">
            <Icon name="settings" size={18} />
          </button>
        } />
      )}

      <div className="px-4 md:px-6 py-4 md:py-6">
        {/* Desktop header */}
        {!isMobile && (
          <div className="flex items-start justify-between mb-5">
            <div>
              <h1 className="font-syne text-3xl font-black text-text-primary">Wallet</h1>
              <p className="text-text-muted text-sm mt-1">Manage your assets, track transactions and view your balance</p>
            </div>
            <button
              onClick={() => navigate('/wallet/security')}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-surface-1 border border-white/[0.06] hover:border-white/[0.14] text-sm font-bold text-text-secondary"
            >
              <Icon name="settings" size={16} /> Wallet Settings
            </button>
          </div>
        )}

        {/* Balance cards */}
        {renderBalanceCards()}

        {/* Action bar */}
        <div className="mt-4">{renderActionBar()}</div>

        {/* Two-col on desktop, tabs on mobile */}
        {isDesktop ? (
          <div className="grid grid-cols-2 gap-5 mt-5">
            {renderTransactions()}
            {renderFeaturedPacks()}
          </div>
        ) : (
          <div className="mt-5">
            <div className="flex gap-2 mb-3 bg-surface-2/40 rounded-full p-1">
              {['transactions', 'packs'].map(tab => (
                <button key={tab} onClick={() => setActiveTab(tab)}
                  className={`relative flex-1 py-2 rounded-full text-sm font-semibold transition-colors ${activeTab === tab ? 'text-bg-dark' : 'text-text-muted'}`}>
                  {activeTab === tab && (
                    <motion.div
                      layoutId="walletTabPill"
                      className="absolute inset-0 bg-brand-violet rounded-full"
                      transition={{ type: 'spring', stiffness: 500, damping: 35 }}
                    />
                  )}
                  <span className="relative z-10">{tab === 'transactions' ? 'Transactions' : 'Featured Packs'}</span>
                </button>
              ))}
            </div>
            {activeTab === 'transactions' ? renderTransactions() : renderFeaturedPacks()}
          </div>
        )}
      </div>

      {/* Send modal */}
      <Modal isOpen={showSendModal} onClose={closeSendModal} title="Send Coins">
        {!sendTarget ? (
          <>
            <p className="text-text-secondary text-sm mb-3">Search for a user to send coins to</p>
            <input
              type="text"
              value={sendSearch}
              onChange={(e) => handleSendSearch(e.target.value)}
              placeholder="Search by username..."
              className="w-full bg-surface-2 border border-white/[0.06] rounded-xl py-3 px-4 text-sm text-text-primary placeholder:text-text-muted focus:border-brand-violet focus:outline-none"
              autoFocus
            />
            <div className="mt-3 space-y-2 max-h-60 overflow-y-auto">
              {sendResults.map(user => (
                <button key={user.id} onClick={() => setSendTarget(user)}
                  className="flex items-center gap-3 w-full p-3 rounded-xl bg-surface-2 border border-white/[0.06] hover:border-white/[0.12] transition-colors text-left">
                  <UserAvatar src={user.avatar} size={40} />
                  <div>
                    <p className="text-sm font-semibold">{user.displayName || user.username}</p>
                    <p className="text-xs text-text-muted">@{user.username}</p>
                  </div>
                </button>
              ))}
              {sendSearch.length >= 2 && sendResults.length === 0 && (
                <p className="text-text-muted text-sm text-center py-4">No users found</p>
              )}
            </div>
          </>
        ) : (
          <>
            <div className="flex items-center gap-3 p-3 rounded-xl bg-surface-2 border border-white/[0.06] mb-4">
              <UserAvatar src={sendTarget.avatar} size={40} />
              <div className="flex-1">
                <p className="text-sm font-semibold">{sendTarget.displayName || sendTarget.username}</p>
                <p className="text-xs text-text-muted">@{sendTarget.username}</p>
              </div>
              <button onClick={() => setSendTarget(null)} className="text-text-muted">
                <Icon name="close" size={18} />
              </button>
            </div>
            <label className="text-text-secondary text-xs font-bold uppercase mb-2 block">Amount</label>
            <input
              type="number"
              value={sendAmount}
              onChange={(e) => setSendAmount(e.target.value)}
              placeholder="0"
              className="w-full bg-surface-2 border border-white/[0.06] rounded-xl py-3 px-4 text-2xl font-dmmono text-text-primary placeholder:text-text-muted focus:border-brand-violet focus:outline-none text-center mb-2"
              autoFocus
            />
            <p className="text-text-muted text-xs text-center mb-4">
              Balance: <span className="text-brand-gold font-dmmono">{wallet?.balance || 0}</span> coins
            </p>
            <button
              onClick={handleSend}
              disabled={!sendAmount || parseInt(sendAmount, 10) <= 0 || parseInt(sendAmount, 10) > (wallet?.balance || 0) || sending}
              className={`w-full py-3.5 rounded-xl font-bold text-sm transition-all ${
                sendAmount && parseInt(sendAmount, 10) > 0 && parseInt(sendAmount, 10) <= (wallet?.balance || 0) && !sending
                  ? 'bg-brand-violet text-white'
                  : 'bg-surface-3 text-text-muted'
              }`}>
              {sending ? 'Sending...' : `Send ${sendAmount || 0} Coins`}
            </button>
          </>
        )}
      </Modal>
    </div>
  );
}
