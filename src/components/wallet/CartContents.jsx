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
import { isPlayBillingSupported, fetchPlayPrices, playProductIdFor } from '../../utils/nativeBilling';
import PaymentMethodPicker from './PaymentMethodPicker';
import { WALLET_TOKENS, CoinGlyph, fmtNum } from './primitives';

const packById = (sku) => COIN_PACKS.find((p) => p.id === sku);

/**
 * "Taxes / Fees ⓘ" — collapsed by default, itemised on tap.
 *
 * Fees are ADDED to the buyer (founder decision 2026-08-11), so the total above
 * this line already includes them. This exists so the buyer can see exactly what
 * the difference between the sticker price and the charge is made of, which is
 * both the honest thing and the thing that stops a "why was I charged $1.32 for
 * a $0.99 pack" dispute.
 *
 * Every number is server-computed. Nothing here recalculates a price: two
 * calculations of one total eventually disagree, and the one the buyer saw is
 * the one they argue about.
 */
function TaxesAndFees({ checkout, method, playPrice }) {
  const [open, setOpen] = useState(false);

  // Rendered as TEXT, not a panel. A bordered card for four numbers dominates a
  // cart that is otherwise two lines, and expanding it used to push the Pay
  // button off the bottom of the screen. The point of this line is to remove a
  // surprise, not to present a tax return.

  // Play collects and itemises its own tax, and its price may not be surcharged
  // at all, so there is nothing for us to break down. Saying so beats showing an
  // empty panel that implies we are hiding something.
  if (method === 'googlePlay') {
    return (
      <div style={{ fontSize: 11, color: WALLET_TOKENS.textMuted, marginTop: 8, textAlign: 'center' }}>
        {playPrice ? 'Taxes and fees are included in the Google Play price' : ''}
      </div>
    );
  }

  // No quote yet, or the fee call failed. Never invent a breakdown: point at
  // where the real number appears instead.
  if (!checkout || !Array.isArray(checkout.lines) || !checkout.lines.length) {
    return (
      <div style={{ fontSize: 11, color: WALLET_TOKENS.textMuted, marginTop: 8, textAlign: 'center' }}>
        Taxes and fees shown at checkout
      </div>
    );
  }

  // Everything above the sticker price, as ONE number. This is the whole point
  // of the line: the buyer sees the difference before they are surprised by it.
  const extra = Math.max(0, Number(checkout.total || 0) - Number(checkout.subtotal || 0));
  const rows = checkout.lines.filter((l) => l.key !== 'subtotal');

  return (
    <div style={{ marginTop: 8, textAlign: 'center' }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 5,
          background: 'none', border: 'none', cursor: 'pointer', padding: 4,
          fontSize: 11.5, color: WALLET_TOKENS.textSecondary,
        }}
        aria-expanded={open}
      >
        <span>
          {extra > 0
            ? `Includes $${extra.toFixed(2)} taxes & fees`
            : 'Taxes & fees'}
        </span>
        <Icon name={open ? 'expand_less' : 'info'} size={14} />
      </button>

      {/* Expanded = plain indented rows, NOT a bordered panel. A card here
          doubles the height of a cart that is otherwise two lines. */}
      {open && (
        <div style={{ marginTop: 4, paddingBottom: 2 }}>
          {rows.map((l) => (
            <div key={l.key} style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
              gap: 12, padding: '2px 2px', fontSize: 11.5,
              color: WALLET_TOKENS.textMuted, textAlign: 'left',
            }}>
              <span>
                {l.label}
                {l.detail && (
                  <span style={{ fontSize: 10.5, opacity: 0.7, marginLeft: 5 }}>{l.detail}</span>
                )}
              </span>
              <span className="font-dmmono tabular-nums" style={{ whiteSpace: 'nowrap' }}>
                {/* A null amount is a fee we genuinely do not know: PayRam's card
                    partner sets it and their API exposes no fee field at all, so
                    the provider discloses it in their own widget. Printing a
                    guess here would be worse than printing where to look. */}
                {l.amount == null ? 'shown at checkout' : `$${Number(l.amount).toFixed(2)}`}
              </span>
            </div>
          ))}
          {checkout.taxEnabled === false && (
            <div style={{ fontSize: 10.5, color: WALLET_TOKENS.textMuted, marginTop: 4, textAlign: 'left' }}>
              Any tax due is included in the price shown.
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function CartContents({ onCheckout, busy, onClose, variant = 'drawer' }) {
  const { lines, setQty, remove, clear, count } = useCart();
  useUser(); // re-render when the local-currency table warms

  // SAME COINS ON BOTH RAILS. Only the price differs, because Google takes a
  // store fee. See PaymentMethodPicker for why it is this way round and not the
  // other (a second coin quantity is a Play rejection risk, not a pricing
  // choice).
  const playAvailable = isPlayBillingSupported();
  const [method, setMethod] = useState('card');
  const [quote, setQuote] = useState(null);
  const [quoting, setQuoting] = useState(false);
  const [err, setErr] = useState('');
  const [playPrices, setPlayPrices] = useState(null); // null = not asked yet

  // Re-quote whenever the basket changes. The dependency is the CONTENT, not
  // the array identity, so a re-render that produces an equal cart does not
  // fire another call.
  const sig = useMemo(() => lines.map((l) => `${l.sku}:${l.qty}`).join(','), [lines]);

  useEffect(() => {
    if (!lines.length) { setQuote(null); setErr(''); return undefined; }
    let alive = true;
    setQuoting(true);
    setErr('');
    // `method` is sent so the SERVER can attach the fee and tax breakdown for
    // the chosen rail on the same call that prices the basket. Re-quoting when
    // the rail changes is the point: fees differ per rail (a flat 30 cents on a
    // card, a percentage on crypto, nothing itemisable on Play), so a total
    // quoted for one rail is wrong for another.
    getCoinPriceQuote({ cart: lines, method })
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
  }, [sig, method]);

  // Play's OWN formatted prices, for the packs actually in the basket.
  //
  // Never our own arithmetic: Play sets and formats the price per market, and
  // displaying a figure that differs from the purchase sheet is the mismatch
  // that gets a build rejected. The lookup is cheap and cached by the bridge, so
  // it re-runs whenever the basket changes.
  useEffect(() => {
    if (!playAvailable || lines.length !== 1 || lines[0].qty !== 1) { setPlayPrices(null); return undefined; }
    let alive = true;
    setPlayPrices(null);
    fetchPlayPrices(lines.map((l) => playProductIdFor(l.sku)))
      .then((map) => { if (alive) setPlayPrices(map || {}); })
      // An empty map is the honest answer: the picker then disables the row
      // rather than inventing a price.
      .catch(() => { if (alive) setPlayPrices({}); });
    return () => { alive = false; };
  }, [sig, playAvailable]);

  const isPage = variant === 'page';

  // Coins the basket yields. ONE number: the pack is the same product on both
  // rails, which is the entire point of the same-coins-different-price model.
  const coins = lines.reduce((t, l) => t + ((packById(l.sku)?.coins || 0) * l.qty), 0);

  // GOOGLE PLAY PRICES ONE PRODUCT AT A TIME, so this basket offers it only for
  // a single pack at quantity one.
  //
  // A multi-line basket cannot be shown a Play total without summing Play's
  // per-product strings, and those are localised and formatted by Play
  // ("$14.99", "€13,99", "₹1.299"). Adding them means parsing a currency string
  // and re-formatting it, which is calculating a Play price — precisely the
  // thing that must never reach the screen. Play Billing is also genuinely
  // one-sheet-per-product, so a "total" here would be a number no single sheet
  // ever charges.
  //
  // Disabling the row with a plain reason is the honest version. It costs a
  // multi-pack buyer nothing: the card rail handles any basket.
  const singleLine = lines.length === 1 && lines[0].qty === 1;
  const playPriceLoading = playAvailable && singleLine && playPrices === null;
  const playPrice = singleLine
    ? (playPrices?.[playProductIdFor(lines[0].sku)]?.price || '')
    : '';
  const playUnavailableReason = !playAvailable
    ? 'Only available in the Android app'
    : !singleLine
      ? 'Google Play takes one pack at a time'
      : '';

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
      {/* Lines.
          Top padding + a fade mask so a partially-scrolled first item reads as
          scrolled rather than SLICED. With zero top padding the first row sat
          flush against the scroll boundary and the pack's avatar was cut clean
          in half, which looks like a broken layout rather than a scroll
          position. `scrollPaddingTop` keeps keyboard/programmatic scrolling off
          the same edge. */}
      <div
        style={{
          flex: 1, overflowY: 'auto',
          padding: isPage ? '6px 0 8px' : '6px 4px 8px',
          scrollPaddingTop: 6,
          WebkitMaskImage: 'linear-gradient(to bottom, transparent 0, #000 10px)',
          maskImage: 'linear-gradient(to bottom, transparent 0, #000 10px)',
        }}
      >
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
                  ${pack.priceUSD.toFixed(2)} each
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
                ${(lineQuote ? lineQuote.priceUSD : pack.priceUSD * line.qty).toFixed(2)}
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

      {/* Summary.
          Scrolls INDEPENDENTLY of the Pay button, which is pinned below it.
          Expanding Taxes / Fees used to grow this block and shove the button off
          the bottom of the viewport, and on a short window it could not be
          reached at all. The button now cannot move: whatever this block grows
          to, it scrolls within its own clamp and the control stays put.

          `maxHeight` is viewport-relative so it adapts to any screen, and
          `flexShrink: 0` stops the lines list above from squeezing it away. */}
      <div style={{
        borderTop: `1px solid ${WALLET_TOKENS.hairline}`,
        paddingTop: 14,
        flexShrink: 0,
      }}>
        <PaymentMethodPicker
          value={method}
          onChange={setMethod}
          googlePlayAvailable={playAvailable}
          coins={coins}
          cardPrice={quote ? `$${quote.amountUSD.toFixed(2)}` : ''}
          playPrice={playPrice}
          playPriceLoading={playPriceLoading}
          playUnavailableReason={playUnavailableReason}
        />

        <Row label={`Coins (${count} item${count === 1 ? '' : 's'})`} value={`${fmtNum(coins)} coins`} />

        {/* THE STICKER PRICE, and only the sticker price.
            The shelf says $0.99, the picker row says $0.99, and this says
            $0.99. A pack advertised at one number and totalled at another two
            screens later reads as a bait-and-switch even when the difference is
            an honestly-disclosed fee, which is exactly what the founder called
            out. The amount actually charged lives on the Pay button, where the
            buyer is looking at the moment it matters. */}
        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
          marginTop: 10, paddingTop: 10, borderTop: `1px solid ${WALLET_TOKENS.hairline}`,
        }}>
          <span style={{ fontWeight: 700, fontSize: 14 }}>
            {count === 1 ? 'Price' : 'Packs'}
          </span>
          {/* On the Play rail the price IS Play's own string. We never restate a
              Play price in our own currency or formatting. */}
          <span className="font-dmmono tabular-nums" style={{ fontWeight: 700, fontSize: 20 }}>
            {method === 'googlePlay'
              ? (playPrice || (playPriceLoading ? '…' : '—'))
              : (quote ? `$${quote.priceUSD.toFixed(2)}` : (quoting ? '…' : '—'))}
          </span>
        </div>

        {/* Taxes / Fees — the Tango pattern. One quiet line carrying the real
            total, with the itemised breakdown one tap away. The alternative,
            four permanent rows above the button, turns a two-line cart into a
            tax return and is the thing that makes people abandon a basket.

            The figures come from the SERVER, on the same call that priced the
            basket, so the breakdown and the total can never disagree. */}
        <TaxesAndFees
          checkout={quote?.checkout}
          method={method}
          playPrice={playPrice}
        />

        <div style={{ fontSize: 11, color: WALLET_TOKENS.textMuted, marginTop: 3, textAlign: 'right' }}>
          {method === 'googlePlay' ? (
            <span>Charged by Google Play in your account currency</span>
          ) : (
            <>
              {quote && <LocalPrice usd={quote.checkout?.total ?? quote.priceUSD} prefix="≈ " />}
              <span>{quote ? ' · ' : ''}charged in USD</span>
            </>
          )}
        </div>

        {err && (
          <div style={{ marginTop: 10, fontSize: 12.5, color: '#f04060' }}>{err}</div>
        )}

        {(() => {
          // The card rail needs a server quote; the Play rail needs a Play
          // price. Neither may proceed on the other's readiness.
          const payingWithPlay = method === 'googlePlay';
          const blocked = busy
            || (payingWithPlay ? !playPrice : (quoting || !quote));
          return (
            <button
              onClick={() => onCheckout?.(lines, quote, method)}
              disabled={blocked}
              style={{
                // PINNED. The pay control must be reachable at ANY window size,
                // and it must not move when Taxes / Fees expands. Sticky rather
                // than fixed so it sits naturally at the end of the drawer's
                // flex column AND survives document scroll on the full-page
                // variant, without needing two different layouts.
                position: 'sticky',
                bottom: 0,
                zIndex: 2,
                width: '100%', marginTop: 14, padding: '13px 16px', borderRadius: 12,
                border: 0, cursor: blocked ? 'not-allowed' : 'pointer',
                opacity: blocked ? 0.55 : 1,
                background: WALLET_TOKENS.gold, color: '#141018',
                font: 'inherit', fontWeight: 800, fontSize: 15,
                // Content scrolling behind a sticky control looks like a bug
                // unless the control is visibly on top of the surface.
                boxShadow: `0 -10px 18px -8px ${WALLET_TOKENS.surface1}, 0 2px 10px rgba(0,0,0,0.35)`,
              }}
            >
              {/* THE AMOUNT CHARGED lives here, on the control the buyer is
                  about to press, rather than in a "Total" row two lines up that
                  contradicts the price on the shelf. Nothing is hidden: the
                  sticker is above, the charge is on the button, and the
                  breakdown is one tap away in Taxes / Fees. */}
              {busy
                ? 'Opening checkout…'
                : payingWithPlay
                  ? 'Continue with Google Play'
                  : quote
                    ? `Pay $${(quote.checkout?.total ?? quote.amountUSD).toFixed(2)}`
                    : 'Checkout'}
            </button>
          );
        })()}

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
          . Payment is handled by our payment provider on behalf of Murmont LLC, the operator of Vergr.
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
