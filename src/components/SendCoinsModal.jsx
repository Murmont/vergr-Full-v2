// src/components/SendCoinsModal.jsx
import { useState, useEffect } from 'react';
import Modal from './Modal';
import Icon from './Icon';
import { searchUsers, sendCoins, getWallet } from '../firebase/firestore';
import { useAuth } from '../context/AuthContext';
import { useUser } from '../context/UserContext';
import { useUI } from '../context/UIContext';
import { COIN_VALUE_EUR } from '../utils/vpSystem';
import { formatMoneyFromEur } from '../utils/currency';

const SendCoinsModal = ({ isOpen, onClose, preselectedUser }) => {
  const { currentUser } = useAuth();
  const { wallet, refreshWallet } = useUser();
  const { showToast } = useUI();

  const [searchTerm, setSearchTerm] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [selectedUser, setSelectedUser] = useState(preselectedUser || null);
  const [amount, setAmount] = useState('');
  const [sending, setSending] = useState(false);

  // Reset when modal opens/closes
  useEffect(() => {
    if (!isOpen) {
      setSearchTerm('');
      setSearchResults([]);
      setSelectedUser(preselectedUser || null);
      setAmount('');
      setSending(false);
    }
  }, [isOpen, preselectedUser]);

  // Search users when term changes (if no preselected user)
  useEffect(() => {
    if (selectedUser) return;
    const search = async () => {
      if (searchTerm.length < 2) {
        setSearchResults([]);
        return;
      }
      try {
        const results = await searchUsers(searchTerm, 5);
        setSearchResults(results.filter(u => u.id !== currentUser?.uid));
      } catch (err) {
        console.error(err);
      }
    };
    search();
  }, [searchTerm, selectedUser, currentUser]);

  const handleSend = async () => {
    if (!selectedUser || !amount || sending) return;
    const coins = parseInt(amount);
    if (isNaN(coins) || coins <= 0) {
      showToast('Please enter a valid amount', 'error');
      return;
    }
    if (coins > (wallet?.balance || 0)) {
      showToast('Insufficient balance', 'error');
      return;
    }

    setSending(true);
    try {
      await sendCoins(currentUser.uid, selectedUser.id, coins, `Sent ${coins} coins to @${selectedUser.username || selectedUser.displayName}`);
      showToast(`Sent ${coins} coins to @${selectedUser.username || selectedUser.displayName}`, 'coins');
      await refreshWallet();
      onClose();
    } catch (err) {
      console.error(err);
      showToast(err.message || 'Failed to send coins', 'error');
    }
    setSending(false);
  };

  // Helper to get display name
  const getDisplayName = (user) => {
    if (user.username) return `@${user.username}`;
    if (user.displayName) return user.displayName;
    return 'User';
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Wallet">
      {!selectedUser ? (
        <>
          <p className="text-text-secondary text-sm mb-3">Send coins from your wallet to another user</p>
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Search by username..."
            className="w-full bg-surface-2 border border-white/[0.06] rounded-xl py-3 px-4 text-sm text-text-primary placeholder:text-text-muted focus:border-brand-violet focus:outline-none"
            autoFocus
          />
          <div className="mt-3 space-y-2 max-h-60 overflow-y-auto">
            {searchResults.map(user => (
              <button
                key={user.id}
                onClick={() => setSelectedUser(user)}
                className="flex items-center gap-3 w-full p-3 rounded-xl bg-surface-2 border border-white/[0.06] hover:border-white/[0.12] transition-colors text-left"
              >
                <img
                  src={user.avatar || `https://api.dicebear.com/7.x/avataaars/svg?seed=${user.username}`}
                  alt=""
                  className="w-10 h-10 rounded-full object-cover"
                />
                <div>
                  <p className="text-sm font-semibold">{user.displayName || user.username}</p>
                  <p className="text-xs text-text-muted">{getDisplayName(user)}</p>
                </div>
              </button>
            ))}
            {searchTerm.length >= 2 && searchResults.length === 0 && (
              <p className="text-text-muted text-sm text-center py-4">No users found</p>
            )}
          </div>
        </>
      ) : (
        <>
          <div className="flex items-center gap-3 p-3 rounded-xl bg-surface-2 border border-white/[0.06] mb-4">
            <img
              src={selectedUser.avatar || `https://api.dicebear.com/7.x/avataaars/svg?seed=${selectedUser.username || selectedUser.id}`}
              alt=""
              className="w-10 h-10 rounded-full object-cover"
            />
            <div className="flex-1">
              <p className="text-sm font-semibold">{selectedUser.displayName || selectedUser.username || 'User'}</p>
              <p className="text-xs text-text-muted">{getDisplayName(selectedUser)}</p>
            </div>
            {!preselectedUser && (
              <button onClick={() => setSelectedUser(null)} className="text-text-muted">
                <Icon name="close" size={18} />
              </button>
            )}
          </div>

          {/* The amount IS the screen. A labelled input box made a coin
              transfer feel like filling in a form; this reads as money. */}
          <div className="relative rounded-2xl overflow-hidden mb-3 border border-white/[0.06]"
            style={{ background: 'radial-gradient(120% 100% at 50% 0%, rgba(123,31,255,0.18), rgba(20,20,31,0) 70%), #14141F' }}>
            <div className="px-5 pt-5 pb-4 flex flex-col items-center">
              <div className="flex items-center gap-2 mb-1">
                <span className="w-5 h-5 rounded-full flex items-center justify-center text-[11px] font-black text-bg-dark"
                  style={{ background: 'linear-gradient(135deg,#F5C842,#F0A500)' }}>c</span>
                <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-text-muted">You send</span>
              </div>
              <input
                type="number"
                inputMode="numeric"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0"
                className="w-full bg-transparent border-none outline-none text-center font-dmmono font-bold text-text-primary placeholder:text-white/20 tabular-nums"
                style={{ fontSize: 44, lineHeight: 1.1 }}
                autoFocus
              />
              <p className="text-base font-bold mt-0.5" style={{ color: '#B44FFF' }}>
                {formatMoneyFromEur((parseInt(amount) || 0) * COIN_VALUE_EUR)}
              </p>
            </div>

            {/* One tap to a sensible amount — nobody wants to type "500". */}
            <div className="flex gap-1.5 px-3 pb-3">
              {[50, 100, 500, 1000].map((v) => (
                <button
                  key={v}
                  onClick={() => setAmount(String(v))}
                  disabled={v > (wallet?.balance || 0)}
                  className="flex-1 h-9 rounded-lg text-[12px] font-bold bg-white/[0.05] text-text-secondary border border-white/[0.06] active:scale-95 transition disabled:opacity-30"
                >
                  {v}
                </button>
              ))}
              <button
                onClick={() => setAmount(String(wallet?.balance || 0))}
                disabled={!(wallet?.balance > 0)}
                className="px-3 h-9 rounded-lg text-[12px] font-bold bg-brand-gold/15 text-brand-gold border border-brand-gold/25 active:scale-95 transition disabled:opacity-30"
              >
                Max
              </button>
            </div>
          </div>

          <div className="flex items-center justify-between px-1 mb-4">
            <span className="text-[11px] text-text-muted">Wallet balance</span>
            <span className="text-[12px] font-bold text-text-secondary tabular-nums">
              <span className="text-brand-gold font-dmmono">{(wallet?.balance || 0).toLocaleString()}</span> coins
              <span className="text-text-muted font-normal"> · {formatMoneyFromEur((wallet?.balance || 0) * COIN_VALUE_EUR)}</span>
            </span>
          </div>

          <button
            onClick={handleSend}
            disabled={!amount || parseInt(amount) <= 0 || parseInt(amount) > (wallet?.balance || 0) || sending}
            className={`w-full py-3.5 rounded-xl font-bold text-sm transition-all ${
              amount && parseInt(amount) > 0 && parseInt(amount) <= (wallet?.balance || 0) && !sending
                ? 'text-white'
                : 'bg-surface-3 text-text-muted'
            }`}
            style={
              amount && parseInt(amount) > 0 && parseInt(amount) <= (wallet?.balance || 0) && !sending
                ? { background: 'linear-gradient(135deg, #7B1FFF, #B44FFF)' }
                : undefined
            }
          >
            {sending
              ? 'Sending…'
              : `Send ${(parseInt(amount) || 0).toLocaleString()} coins · ${formatMoneyFromEur((parseInt(amount) || 0) * COIN_VALUE_EUR)}`}
          </button>
          {/* This flows through the same secured path as a tip, which carries
              the locked flat 10% platform fee — so the recipient does NOT get
              the full amount. Saying otherwise would be a lie about someone's
              money, so the real figure is stated up front. */}
          <p className="text-[10.5px] text-text-muted text-center mt-2.5 leading-snug">
            They receive{' '}
            <span className="text-text-secondary font-bold">
              {Math.floor((parseInt(amount) || 0) * 0.9).toLocaleString()} coins
            </span>{' '}
            after the 10% platform fee.
          </p>
        </>
      )}
    </Modal>
  );
};

export default SendCoinsModal;