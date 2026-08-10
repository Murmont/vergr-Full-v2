// Tip modal opened from a post's Tip button.
// Shows quick-pick amounts + custom input, sends coins to the post author,
// then records a tip on the post so the creator sees it in their dashboard.
import { useState } from 'react';
import Modal from './Modal';
import { CoinIcon } from './CoinIcon';
import { sendCoins } from '../firebase/firestore';
import { useAuth } from '../context/AuthContext';
import { useUser } from '../context/UserContext';
import { useUI } from '../context/UIContext';
import UserAvatar from './UserAvatar';

const QUICK_AMOUNTS = [50, 100, 500, 1000, 5000, 10000];

export default function TipPostModal({ isOpen, onClose, post }) {
  const { currentUser } = useAuth();
  const { wallet, refreshWallet } = useUser();
  const { showToast } = useUI();
  const [amount, setAmount] = useState(500);
  const [custom, setCustom] = useState('');
  const [sending, setSending] = useState(false);

  if (!post) return null;

  const authorId      = post.authorId || post.userId || post.ownerId;
  const authorName    = post.authorName || post.authorDisplayName || post.username || 'Creator';
  const authorAvatar  = post.authorAvatar || post.avatar;
  const balance       = wallet?.balance || 0;

  const finalAmount = custom ? parseInt(custom, 10) : amount;
  const valid = Number.isFinite(finalAmount) && finalAmount > 0 && finalAmount <= balance && authorId && authorId !== currentUser?.uid;

  const handleSend = async () => {
    if (!valid || sending) return;
    setSending(true);
    try {
      await sendCoins(currentUser.uid, authorId, finalAmount, `Tipped ${finalAmount} coins on post`, { postId: post.id });
      showToast(`Tipped ${finalAmount} coins to @${authorName}`, 'coins');
      await refreshWallet?.();
      onClose();
    } catch (err) {
      console.error(err);
      showToast(err.message || 'Failed to send tip', 'error');
    }
    setSending(false);
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Send a Tip">
      {/* Creator card */}
      <div className="flex items-center gap-3 p-3 rounded-xl bg-surface-2 border border-white/[0.06] mb-4">
        <UserAvatar src={authorAvatar} size={40} />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold text-text-primary truncate">{authorName}</p>
          <p className="text-xs text-text-muted truncate">Your tip goes directly to the creator</p>
        </div>
      </div>

      {/* Quick amounts */}
      <p className="text-text-secondary text-[11px] font-dmmono uppercase tracking-wider font-bold mb-2">Quick amount</p>
      <div className="grid grid-cols-3 gap-2 mb-4">
        {QUICK_AMOUNTS.map(v => {
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

      {/* Custom amount */}
      <p className="text-text-secondary text-[11px] font-dmmono uppercase tracking-wider font-bold mb-2">Custom amount</p>
      <div className="relative mb-4">
        <div className="absolute left-3 top-1/2 -translate-y-1/2">
          <CoinIcon size={18} />
        </div>
        <input
          type="number"
          value={custom}
          onChange={(e) => setCustom(e.target.value.replace(/[^0-9]/g, ''))}
          placeholder="Enter amount"
          className="w-full bg-surface-2 border border-white/[0.06] rounded-xl py-3 pl-10 pr-4 text-lg font-dmmono tabular-nums text-text-primary placeholder:text-text-muted focus:border-brand-violet focus:outline-none"
        />
      </div>

      <div className="flex items-center justify-between text-xs text-text-muted mb-4">
        <span className="font-dmmono">Your balance</span>
        <span className="inline-flex items-center gap-1 font-dmmono font-bold text-brand-gold tabular-nums">
          <CoinIcon size={12} /> {balance.toLocaleString()}
        </span>
      </div>

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
          <>
            <CoinIcon size={16} /> Tip {finalAmount > 0 ? finalAmount.toLocaleString() : ''}
          </>
        )}
      </button>

      {!authorId && (
        <p className="text-center text-xs text-brand-ember mt-3">This post has no author linked — cannot tip.</p>
      )}
      {authorId === currentUser?.uid && (
        <p className="text-center text-xs text-text-muted mt-3">You can't tip your own post.</p>
      )}
      {finalAmount > balance && (
        <p className="text-center text-xs text-brand-ember mt-3">Insufficient balance.</p>
      )}
    </Modal>
  );
}
