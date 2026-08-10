// src/components/SendCoinsModal.jsx
//
// Tip someone COINS from a conversation.
//
// This replaced SendGemsModal on the DM wallet button. Gems are the
// withdrawable unit and sending them peer-to-peer is a money transfer with a
// different meaning, a different minimum and a different set of store problems.
// A tip inside a chat is the same gesture as a tip on a post or in a stream, so
// it uses the same unit and the same flat 10% fee, and the numbers a user sees
// here match the ones they see everywhere else.
//
// SendGemsModal still exists and is still correct where an actual gem transfer
// is intended. Do not point the chat wallet button back at it.
import { useState, useEffect } from 'react';
import Modal from './Modal';
import { CoinIcon } from './CoinIcon';
import { sendCoins } from '../firebase/firestore';
import { useAuth } from '../context/AuthContext';
import { useUser } from '../context/UserContext';
import { useUI } from '../context/UIContext';
import UserAvatar from './UserAvatar';

const QUICK_AMOUNTS = [50, 100, 500, 1000, 5000, 10000];

/** Flat 10% platform fee at send time, same as every other tip. Mirrors
 *  `sendCoins` in firestore.js — the server is authoritative, this is display. */
const FEE_PCT = 0.10;

export default function SendCoinsModal({ isOpen, onClose, recipient }) {
  const { currentUser } = useAuth();
  const { wallet, refreshWallet } = useUser();
  const { showToast } = useUI();
  const [amount, setAmount] = useState(500);
  const [custom, setCustom] = useState('');
  const [sending, setSending] = useState(false);

  // Reset between opens: a leftover custom amount from the last person you
  // tipped is a genuinely bad surprise.
  useEffect(() => {
    if (!isOpen) return;
    setAmount(500);
    setCustom('');
    setSending(false);
  }, [isOpen]);

  const toId = recipient?.id || recipient?.uid;
  const name = recipient?.displayName || recipient?.username || 'this person';
  const handle = recipient?.username || null;
  const balance = wallet?.balance || 0;

  const finalAmount = custom ? parseInt(custom, 10) : amount;
  const valid = Number.isFinite(finalAmount) && finalAmount > 0
    && finalAmount <= balance && !!toId && toId !== currentUser?.uid;
  const net = Math.floor((finalAmount || 0) * (1 - FEE_PCT));

  const handleSend = async () => {
    if (!valid || sending) return;
    setSending(true);
    try {
      await sendCoins(currentUser.uid, toId, finalAmount, `Tipped ${finalAmount} coins`);
      showToast(`Tipped ${finalAmount.toLocaleString()} coins to ${name}`, 'coins');
      await refreshWallet?.();
      onClose();
    } catch (err) {
      showToast(err?.message || 'Failed to send tip', 'error');
    }
    setSending(false);
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Send coins">
      <div className="flex items-center gap-3 p-3 rounded-xl bg-surface-2 border border-white/[0.06] mb-4">
        <UserAvatar src={recipient?.avatar} size={40} />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold text-text-primary truncate">{name}</p>
          <p className="text-xs text-text-muted truncate">
            {handle ? `@${handle} · goes straight to them` : 'Goes straight to them'}
          </p>
        </div>
      </div>

      <p className="text-text-secondary text-[11px] font-dmmono uppercase tracking-wider font-bold mb-2">Quick amount</p>
      <div className="grid grid-cols-3 gap-2 mb-4">
        {QUICK_AMOUNTS.map((v) => {
          const active = !custom && amount === v;
          return (
            <button
              key={v}
              onClick={() => { setAmount(v); setCustom(''); }}
              className={`flex items-center justify-center gap-1.5 py-2.5 rounded-xl border transition-all ${
                active
                  ? 'bg-gradient-to-r from-brand-violet/25 to-brand-pink/20 border-brand-violet/60 text-white shadow-lg shadow-brand-violet/20'
                  : 'bg-surface-2 border-white/[0.06] text-text-secondary hover:border-white/[0.14]'
              }`}
            >
              <CoinIcon size={14} />
              <span className="font-dmmono font-bold text-sm tabular-nums">{v.toLocaleString()}</span>
            </button>
          );
        })}
      </div>

      <p className="text-text-secondary text-[11px] font-dmmono uppercase tracking-wider font-bold mb-2">Custom amount</p>
      <div className="relative mb-4">
        <div className="absolute left-3 top-1/2 -translate-y-1/2"><CoinIcon size={18} /></div>
        <input
          type="number"
          value={custom}
          onChange={(e) => setCustom(e.target.value.replace(/[^0-9]/g, ''))}
          placeholder="Enter amount"
          className="w-full bg-surface-2 border border-white/[0.06] rounded-xl py-3 pl-10 pr-4 text-lg font-dmmono tabular-nums text-text-primary placeholder:text-text-muted focus:border-brand-violet focus:outline-none"
        />
      </div>

      <div className="flex items-center justify-between text-xs text-text-muted mb-1">
        <span className="font-dmmono">Your balance</span>
        <span className="inline-flex items-center gap-1 font-dmmono font-bold text-brand-gold tabular-nums">
          <CoinIcon size={12} /> {balance.toLocaleString()}
        </span>
      </div>
      {finalAmount > 0 && (
        <div className="flex items-center justify-between text-xs text-text-muted mb-4">
          <span className="font-dmmono">They receive (after 10% fee)</span>
          <span className="font-dmmono font-bold tabular-nums text-text-secondary">{net.toLocaleString()}</span>
        </div>
      )}

      <button
        onClick={handleSend}
        disabled={!valid || sending}
        className={`w-full py-3.5 rounded-xl font-extrabold text-sm transition-all flex items-center justify-center gap-2 ${
          valid && !sending
            ? 'bg-gradient-to-r from-brand-violet to-brand-pink text-white shadow-lg shadow-brand-violet/30 hover:brightness-110'
            : 'bg-surface-3 text-text-muted cursor-not-allowed'
        }`}
      >
        {sending ? 'Sending…' : (
          <><CoinIcon size={16} /> Send {finalAmount > 0 ? finalAmount.toLocaleString() : ''}</>
        )}
      </button>

      {!toId && <p className="text-center text-xs text-brand-ember mt-3">Could not find this user.</p>}
      {toId === currentUser?.uid && <p className="text-center text-xs text-text-muted mt-3">You can't send coins to yourself.</p>}
      {finalAmount > balance && <p className="text-center text-xs text-brand-ember mt-3">Insufficient balance.</p>}
    </Modal>
  );
}
