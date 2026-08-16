// src/components/streams/StreamStateBadge.jsx
//
// The badge on a live card. LIVE for a free stream, PREMIUM plus a coin price
// for a paid one.
//
// ## Why this is a component and not six copies of a <span>
//
// A Premium Live is public and discoverable on purpose: people see it, want in,
// and buy coins to get in. The consequence is that the card MUST say it costs
// something. A viewer who taps a card that looks free and lands on a paywall was
// misled by our own list, and that is the kind of thing an underwriter reads as
// a dark pattern rather than an oversight.
//
// Explore, the home rail, the native Explore screen and the following rail each
// drew their own LIVE pill. Six pills means six chances for one to keep saying
// LIVE on a paid stream, so they all use this instead.
import Icon from '../Icon';

/**
 * @param {boolean} isPremium   from `streamPremium(stream)`
 * @param {number}  priceCoins  entry price, only meaningful when isPremium
 * @param {'sm'|'md'} size
 */
export default function StreamStateBadge({ isPremium, priceCoins = 0, size = 'md' }) {
  const sm = size === 'sm';
  const pad = sm ? 'px-1.5 py-0.5' : 'px-2 py-0.5';
  const text = sm ? 'text-[9px]' : 'text-[10px]';

  if (!isPremium) {
    return (
      <span className={`flex items-center gap-1 bg-brand-ember text-white ${text} font-bold ${pad} rounded tracking-wider`}>
        <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
        LIVE
      </span>
    );
  }

  return (
    <span
      className={`flex items-center gap-1 text-white ${text} font-bold ${pad} rounded tracking-wider`}
      style={{ background: 'linear-gradient(135deg, #C87FFF 0%, #7B1FFF 100%)' }}
    >
      PREMIUM
      {priceCoins > 0 && (
        <>
          <Icon name="paid" size={sm ? 10 : 11} className="text-brand-gold-light" />
          <span className="font-dmmono tabular-nums">{priceCoins.toLocaleString()}</span>
        </>
      )}
    </span>
  );
}
