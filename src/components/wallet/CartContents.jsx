// src/components/wallet/CartContents.jsx
//
// The basket itself: line items, quantities, totals, and the terms.
//
// One component, two containers. Desktop mounts it in a slide-in drawer,
// mobile mounts it as a full page, and neither owns any of the logic. A cart
// whose maths lives in two files is a cart that eventually shows two different
// totals.
//
// ## What an underwriter is looking for here
//
// Itemised lines with unit price and quantity, a subtotal, a total in the
// currency that will actually be charged, and the refund and terms links at the
// point of payment rather than buried in a footer. All of that is on this
// screen deliberately.
//
// ## The total is quoted, never computed
//
// `getCoinPriceQuote({ cart })` re-prices every line server-side and returns the
// USD figure the card will be charged. Nothing in this file multiplies a price
// by a quantity to produce the number on the button.
import { useState, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import Icon from '../Icon';
import LocalPrice from '../LocalPrice';
import { useCart } from '../../context/CartContext';
import { useUser } from '../../context/UserContext';
import { getCoinPriceQuote } from '../../firebase/firestore';
import { COIN_PACKS } from '../../utils/vpSystem';
import { STORE_COIN_PACKS } from '../../utils/storePricing';
import { isPlayBillingSupported } from '../../utils/nativeBilling';
import PaymentMethodPicker from './PaymentMethodPicker';
import { WALLET_TOKENS, CoinGlyph, fmtNum } from './primitives';

const packById = (sku) => COIN_PACKS.find((p) => p.id === sku);
const storePackById = (sku) => STORE_COIN_PACKS.find((p) => p.id === sku);

export default function CartContents({ onCheckout, busy, onClose, variant = 'drawer' }) {
  const { lines, setQty, remove, clear, count } = useCart();
  useUser(); // re-render when the local-currency table warms

  // Google Play charges a store fee, so the SAME payment buys fewer coins there
  // (src/utils/storePricing.js). The method therefore changes the coin count,
  // not just the rail — which is why it lives next to the total.
  const playAvailable = isPlayBillingSupported();
  const [method, setMethod] = useState('card');
  const [quote, setQuote] = useState(null);
  const [quoting, setQuoting] = useState(false);
  const [err, setErr] = useState('');

  // Re-quote whenever the basket changes. The dependency is the CONTENT, not
  // the array identity, so a re-render that produces an equal cart does not
  // fire another call.
  const sig = useMemo(() => lines.map((l) => `${l.sku}:${l.qty}`).join(','), [lines]);

  useEffect(() => {
    if (!lines.length) { setQuote(null); setErr(''); return undefined; }
    let alive = true;
    setQuoting(true);
    setErr('');
    getCoinPriceQuote({ cart: lines })
      .then((q) => { if (alive) { setQuote(q); setQuoting(false); } })
      .catch((e) => {
        if (!alive) return;
        setQuoting(false);
        setQuote(null);
        // The quote fails closed when no trustworthy FX rate is available, and
        // so does the payment. Saying so beats showing a total we cannot honour.
        setErr(e?.message || 'Could not price your basket. Try again shortly.');
      });
    return () => { alive = false; };
  }, [sig]);

  const isPage = variant === 'page';

  // Coins the basket yields on each rail. The MONEY is identical (same packs,
  // same prices); only the coin quantity differs, because Play deducts its fee
  // before we ever see the payment.
  const cardCoins = lines.reduce((t, l) => t + ((packById(l.sku)?.coins || 0) * l.qty), 0);
  const playCoins = lines.reduce((t, l) => t + ((storePackById(l.sku)?.coins || packById(l.sku)?.coins || 0) * l.qty), 0);
  const coinsForMethod = method === 'googlePlay' ? playCoins : cardCoins;

  if (!lines.length) {
    return (
      <div style={{ padding: '48px 24px', textAlign: 'center' }}>
        <div style={{
          width: 56, height: 56, borderRadius: '50%', margin: '0 auto 14px',
          display: 'grid', placeItems: 'center', background: 'rgba(255,255,255,0.05)',
        }}>
          <Icon name="shopping_cart" size={26} className="text-text-muted" />
        </div>
        <div style={{ fontWeight: 700, marginBottom: 4 }}>Your basket is empty</div>
        <div style={{ fontSize: 13, color: WALLET_TOKENS.textMuted }}>
          Add a coin pack to get started.
        </div>
        {onClose && (
          <button
            onClick={onClose}
            style={{
              marginTop: 18, padding: '10px 18px', borderRadius: 10, cursor: 'pointer',
              background: 'rgba(255,255,255,0.06)', border: `1px solid ${WALLET_TOKENS.hairline}`,
              color: WALLET_TOKENS.text, font: 'inherit', fontWeight: 600, fontSize: 13,
            }}
          >
            Browse packs
          </button>
        )}
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0, flex: 1 }}>
      {/* Lines */}
      <div style={{ flex: 1, overflowY: 'auto', padding: isPage ? '0 0 8px' : '0 4px 8px' }}>
        {lines.map((line) => {
          const pack = packById(line.sku);
          if (!pack) return null;
          const lineQuote = quote?.lines?.find((l) => l.sku === line.sku);
          return (
            <div
              key={line.sku}
              style={{
                display: 'flex', gap: 12, alignItems: 'flex-start',
                padding: '14px 0', borderBottom: `1px solid ${WALLET_TOKENS.hairline}`,
              }}
            >
              <div style={{
                width: 40, height: 40, borderRadius: 10, flexShrink: 0,
                display: 'grid', placeItems: 'center', background: 'rgba(240,165,0,0.12)',
              }}>
                <CoinGlyph size={20} />
              </div>

              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 700, fontSize: 14 }}>{pack.name}</div>
                <div style={{ fontSize: 12, color: WALLET_TOKENS.textMuted, marginTop: 1 }}>
                  {fmtNum(pack.coins)} coins
                  {pack.vpBonus > 0 && ` · +${fmtNum(pack.vpBonus)} VP`}
                </div>
                {/* Unit price, so the line total is checkable rather than
                    asserted. */}
                <div style={{ fontSize: 11.5, color: WALLET_TOKENS.textMuted, marginTop: 3 }}>
                  €{pack.priceEUR.toFixed(2)} each
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 8 }}>
                  <div style={{
                    display: 'inline-flex', alignItems: 'center',
                    border: `1px solid ${WALLET_TOKENS.hairline}`, borderRadius: 8, overflow: 'hidden',
                  }}>
                    <QtyBtn label="Decrease" icon="remove" onClick={() => setQty(line.sku, line.qty - 1)} />
                    <span
                      className="font-dmmono tabular-nums"
                      style={{ minWidth: 30, textAlign: 'center', fontSize: 13, fontWeight: 700 }}
                    >
                      {line.qty}
                    </span>
                    <QtyBtn label="Increase" icon="add" onClick={() => setQty(line.sku, line.qty + 1)} />
                  </div>
                  <button
                    onClick={() => remove(line.sku)}
                    style={{
                      background: 'none', border: 0, padding: 0, cursor: 'pointer',
                      color: WALLET_TOKENS.textMuted, fontSize: 12, font: 'inherit',
                    }}
                  >
                    Remove
                  </button>
                </div>
              </div>

              <div className="font-dmmono tabular-nums" style={{ fontWeight: 700, fontSize: 14, whiteSpace: 'nowrap' }}>
                €{(lineQuote ? lineQuote.priceEUR : pack.priceEUR * line.qty).toFixed(2)}
              </div>
            </div>
          );
        })}

        <button
          onClick={clear}
          style={{
            marginTop: 12, background: 'none', border: 0, padding: 0, cursor: 'pointer',
            color: WALLET_TOKENS.textMuted, fontSize: 12, font: 'inherit',
          }}
        >
          Empty basket
        </button>
      </div>

      {/* Summary */}
      <div style={{ borderTop: `1px solid ${WALLET_TOKENS.hairline}`, paddingTop: 14 }}>
        <PaymentMethodPicker
          value={method}
          onChange={setMethod}
          googlePlayAvailable={playAvailable}
          cardCoins={cardCoins}
          playCoins={playCoins}
        />

        <Row label={`Coins (${count} item${count === 1 ? '' : 's'})`} value={`${fmtNum(coinsForMethod)} coins`} />
        <Row label="Subtotal" value={quote ? `€${quote.priceEUR.toFixed(2)}` : '—'} muted />
        <Row label="VERGR fee" value="€0.00" muted />

        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
          marginTop: 10, paddingTop: 10, borderTop: `1px solid ${WALLET_TOKENS.hairline}`,
        }}>
          <span style={{ fontWeight: 700, fontSize: 14 }}>Total</span>
          <span className="font-dmmono tabular-nums" style={{ fontWeight: 700, fontSize: 20 }}>
            {quote ? `$${quote.amountUSD.toFixed(2)}` : (quoting ? '…' : '—')}
          </span>
        </div>

        <div style={{ fontSize: 11, color: WALLET_TOKENS.textMuted, marginTop: 3, textAlign: 'right' }}>
          {quote && <LocalPrice eur={quote.priceEUR} prefix="≈ " />}
          <span>{quote ? ' · ' : ''}charged in USD</span>
        </div>

        {err && (
          <div style={{ marginTop: 10, fontSize: 12.5, color: '#f04060' }}>{err}</div>
        )}

        <button
          onClick={() => onCheckout?.(lines, quote, method)}
          disabled={busy || quoting || !quote}
          style={{
            width: '100%', marginTop: 14, padding: '13px 16px', borderRadius: 12,
            border: 0, cursor: busy || quoting || !quote ? 'not-allowed' : 'pointer',
            opacity: busy || quoting || !quote ? 0.55 : 1,
            background: WALLET_TOKENS.gold, color: '#141018',
            font: 'inherit', fontWeight: 800, fontSize: 15,
          }}
        >
          {busy ? 'Opening checkout…' : 'Checkout'}
        </button>

        {/* At the point of payment, not in a footer. Coins are digital goods
            delivered instantly, and saying so before the button is pressed is
            both the honest order and the order a reviewer expects. */}
        <p style={{ fontSize: 11, color: WALLET_TOKENS.textMuted, lineHeight: 1.55, marginTop: 10 }}>
          Coins are digital credit for use inside Vergr. They are delivered to your wallet
          immediately and are non-refundable once delivered, except as set out in our{' '}
          <Link to="/platform/refunds" style={{ color: WALLET_TOKENS.textSecondary, textDecoration: 'underline' }}>
            Refund Policy
          </Link>
          . By continuing you agree to our{' '}
          <Link to="/platform/terms" style={{ color: WALLET_TOKENS.textSecondary, textDecoration: 'underline' }}>
            Terms
          </Link>{' '}
          and{' '}
          <Link to="/platform/privacy" style={{ color: WALLET_TOKENS.textSecondary, textDecoration: 'underline' }}>
            Privacy Policy
          </Link>
          . Payment is handled by our payment provider on behalf of Murmont LLC, trading as VERGR.
        </p>
      </div>
    </div>
  );
}

function QtyBtn({ icon, onClick, label }) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      style={{
        width: 30, height: 30, display: 'grid', placeItems: 'center', cursor: 'pointer',
        background: 'rgba(255,255,255,0.04)', border: 0, color: WALLET_TOKENS.text,
      }}
    >
      <Icon name={icon} size={16} />
    </button>
  );
}

function Row({ label, value, muted }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', padding: '3px 0' }}>
      <span style={{ fontSize: 13, color: muted ? WALLET_TOKENS.textMuted : WALLET_TOKENS.textSecondary }}>{label}</span>
      <span className="font-dmmono tabular-nums" style={{ fontSize: 13, color: muted ? WALLET_TOKENS.textMuted : WALLET_TOKENS.text }}>
        {value}
      </span>
    </div>
  );
}
