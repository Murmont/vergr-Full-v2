// The coin balance chip, used in headers across the app.
//
// ## Tapping it opens the shop, not the wallet
//
// It used to navigate to /wallet. That is the wrong destination for the moment
// this chip is usually read: somebody glances at their balance because they are
// about to tip, unlock, or join something and they suspect they are short.
// Sending them to another screen costs them whatever they were doing, and the
// purchase they were one tap away from making.
//
// So it opens the quick-buy sheet in place. `/wallet` is still one tap further
// in ("See all packs"), and the full buy screen is untouched.
import { useState } from 'react';
import { formatCoins } from '../utils/helpers';
import { CoinIcon } from './CoinIcon';
import { CoinQuickBuySheet } from './wallet/CoinQuickBuy';

export default function CoinDisplay({ amount = 0, size = 'md', className = '', clickable = true }) {
  const [buyOpen, setBuyOpen] = useState(false);

  const sizes = {
    sm: { text: 'text-xs',  icon: 13, plus: 14 },
    md: { text: 'text-sm',  icon: 15, plus: 15 },
    lg: { text: 'text-lg',  icon: 18, plus: 17 },
    xl: { text: 'text-xl',  icon: 22, plus: 19 },
  };
  const s = sizes[size] || sizes.md;

  const content = (
    <span className={`inline-flex items-center gap-1 font-dmmono font-semibold tabular-nums ${s.text} text-text-primary ${className}`}>
      <CoinIcon size={s.icon} />
      {formatCoins(amount)}
    </span>
  );

  if (!clickable) return content;

  return (
    <>
      <button
        onClick={() => setBuyOpen(true)}
        aria-label="Coins. Tap to buy more."
        className="inline-flex items-center gap-1.5 bg-surface-2/60 pl-2.5 pr-1.5 py-1.5 rounded-full border border-white/[0.06] hover:bg-surface-2 transition-colors active:scale-95"
      >
        {content}
        {/* The + is what turns a readout into a shop. Without it people read the
            number and never learn the chip does anything. */}
        <span
          className="grid place-items-center rounded-full text-white"
          style={{
            width: s.plus, height: s.plus,
            background: 'linear-gradient(135deg, #C87FFF 0%, #7B1FFF 100%)',
            fontSize: Math.round(s.plus * 0.72), lineHeight: 1, fontWeight: 700,
          }}
        >
          +
        </span>
      </button>

      {buyOpen && <CoinQuickBuySheet onClose={() => setBuyOpen(false)} />}
    </>
  );
}
