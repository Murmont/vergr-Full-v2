// src/components/wallet/PriceQuote.jsx
//
// The price of a coin pack, shown the way a payment processor expects to see
// it: the amount that will actually hit the card, in the currency it will hit
// the card in, with the local-currency figure beside it as an aid.
//
// ## Why this replaced a plain EUR figure
//
// The buy screen used to render `€4.79` with "billed in USD/USDT" underneath.
// Two problems. The user was told one number and charged another, which is the
// thing a processor objects to at underwriting. And the EUR figure ignored
// regional pricing entirely, so a buyer in a discount region saw the full
// sticker price right up until their statement said otherwise.
//
// ## The number is not computed here
//
// It comes from `getCoinPriceQuote`, which runs the identical regional-price
// and FX steps the payment path runs, against the same live rate. Nothing in
// this file multiplies anything. That is deliberate: two independent
// calculations of the same price will eventually disagree, and the one the user
// sees is the one they will argue about.
import { useUser } from '../../context/UserContext';
import LocalPrice from '../LocalPrice';
import { hasLocalEstimate } from '../../utils/currency';

/**
 * @param {object} quote     one entry from getCoinPriceQuote (priceEUR, amountUSD)
 * @param {string} size      'lg' on a pack card, 'sm' inline
 * @param {node}   fallback  shown while the quote is still loading
 */
export default function PriceQuote({ quote, size = 'lg', fallback = null }) {
  useUser(); // re-render when the local-currency rate table warms up

  if (!quote) return fallback;

  const big = size === 'lg';
  const usd = `$${Number(quote.amountUSD).toFixed(2)}`;

  // JUST THE PRICE.
  //
  // No "regional pricing applied" badge, no struck-through sticker price.
  // TikTok and Tango do neither: a buyer in Manila sees their price and that is
  // the whole interaction. Announcing the discount tells people the price
  // depends on where you say you are, which is an invitation to sit behind a
  // VPN, and it draws attention to price discrimination nobody asked to see.
  // The regional multiplier is a pricing mechanism, not a promotion.
  return (
    <div>
      <div className="font-dmmono tabular-nums" style={{ fontSize: big ? 22 : 15, fontWeight: 700 }}>
        {usd}
      </div>

      {/* The buyer's own currency, as an estimate. Never the charged figure:
          the charge is the USD above, and saying otherwise would recreate the
          problem this component exists to fix.
          Hidden entirely for a buyer already on USD — there is no estimate to
          give, and printing the same number twice reads as a bug (audit A3). */}
      {hasLocalEstimate(quote.priceUSD) && (
        <div style={{ fontSize: big ? 11 : 10, opacity: 0.62, marginTop: 2 }}>
          <LocalPrice usd={quote.priceUSD} prefix="≈ " />
          <span> · charged in USD</span>
        </div>
      )}
    </div>
  );
}
