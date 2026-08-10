// src/components/monetization/StreamPaywall.jsx
//
// What a viewer sees instead of the player when a broadcast is paid and they
// have not bought in.
//
// This is a real gate, not a hidden button. `createStreamSession` writes no
// `hlsUrl` onto a paid stream's document (that document is world-readable), and
// puts both playback URLs in `streams/{id}/private/playback`, which firestore
// rules deny to every client including the host. The URL reaches this screen
// only after `getAccess` has confirmed the purchase, so there is nothing on the
// page to un-hide.
import { useState } from 'react';
import Icon from '../Icon';
import { purchaseContentAccess } from '../../firebase/firestore';
import { useUser } from '../../context/UserContext';
import { useUI } from '../../context/UIContext';

export default function StreamPaywall({ streamId, priceCoins, title, hostName, onUnlocked }) {
  const { wallet } = useUser();
  const { showToast } = useUI();
  const [busy, setBusy] = useState(false);

  const balance = wallet?.balance ?? 0;
  const short = Math.max(0, priceCoins - balance);

  const buy = async () => {
    if (busy) return;
    if (short > 0) {
      showToast?.(`You need ${short.toLocaleString()} more coins.`, 'error');
      return;
    }
    setBusy(true);
    try {
      await purchaseContentAccess('stream', streamId);
      showToast?.('You are in', 'success');
      onUnlocked?.();
    } catch (e) {
      showToast?.(e?.message || 'Could not buy entry.', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="w-full h-full min-h-[280px] flex items-center justify-center bg-gradient-to-br from-brand-violet/20 via-black to-brand-gold/10 px-6">
      <div className="text-center max-w-sm">
        <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-brand-gold/15 border border-brand-gold/40 flex items-center justify-center">
          <Icon name="lock" className="text-brand-gold text-[30px]" />
        </div>

        <h3 className="font-syne font-bold text-xl text-white mb-1">
          {title || 'Paid stream'}
        </h3>
        {hostName && (
          <p className="text-[13px] text-white/60 mb-4">{hostName} is charging for entry</p>
        )}

        <button
          onClick={buy}
          disabled={busy}
          className="w-full rounded-2xl bg-brand-gold hover:bg-brand-gold-light disabled:opacity-60 text-black font-bold py-3 transition flex items-center justify-center gap-2"
        >
          <Icon name="paid" className="text-[20px]" />
          {busy ? 'Joining…' : `Join for ${priceCoins.toLocaleString()} coins`}
        </button>

        <p className="mt-3 text-[11.5px] text-white/45 leading-relaxed">
          One payment for this broadcast. Your balance is{' '}
          <span className="font-dmmono tabular-nums">{balance.toLocaleString()}</span> coins.
        </p>
      </div>
    </div>
  );
}
