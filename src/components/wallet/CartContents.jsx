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
import useAppGate, { codaOfferedTo } from '../../hooks/useAppGate';
import { getCoinPriceQuote } from '../../firebase/firestore';
import { hasLocalEstimate } from '../../utils/currency';
import { COIN_PACKS } from '../../utils/vpSystem';
import { storeItemBySku, isStoreItemSku } from '../../utils/storeItems';
import {
  isPlayBillingSupported, fetchPlayPrices, playProductIdFor,
  billingChoiceSupported, getBillingChoiceMode, prepareAltBilling, buyWithChoice,
} from '../../utils/nativeBilling';
import { auth } from '../../firebase/config';
import PaymentMethodPicker, { GooglePlayPrism } from './PaymentMethodPicker';
import { CodaCheckoutBlock } from './CodaPay';
import { IS_STORE_BUILD, IS_PLAY_BUILD, IS_HUAWEI_BUILD, STORE_NAME } from '../../utils/platform';
import { WALLET_TOKENS, CoinGlyph, fmtNum } from './primitives';
// The operating entity is named on a checkout disclosure, so it must come from
// the one source of truth rather than be typed here. Costs no bundle weight:
// AppRouter already pulls legalContent into the main chunk via TosVersionGate.
import { OPERATOR } from '../../screens/marketing/legal/legalContent';

const packById = (sku) => COIN_PACKS.find((p) => p.id === sku);

/**
 * A basket may hold coin packs AND store items (VP bonuses, boosts).
 *
 * ⚠ A store item's SKU IS its Play product id (`vpb_flash`, `boost_post`).
 * Running one through playProductIdFor() asks Play for `coins_vpb_flash`, which
 * does not exist, and the sheet reports "product not loaded" instead of failing
 * usefully. This is the ONE place that mapping happens.
 */
const playIdForSku = (sku) => (isStoreItemSku(sku) ? sku : playProductIdFor(sku));

/**
 * One basket row, whatever the SKU is. Returns null for a SKU we do not sell.
 *
 * ⚠ This is the ONLY place a cart line is resolved. Everything the row renderer
 * needs comes back non-null, so no field below it can dereference an absent
 * pack, which is exactly how adding a boost to the basket crashed the drawer.
 */
function rowFor(sku) {
  const pack = packById(sku);
  if (pack) {
    return {
      name: pack.name,
      detail: `${fmtNum(pack.coins)} coins${pack.vpBonus > 0 ? ` · +${fmtNum(pack.vpBonus)} VP` : ''}`,
      unitUSD: pack.priceUSD,
      tint: '#2A2212',
      art: null,
    };
  }
  const item = storeItemBySku(sku);
  if (!item) return null;
  return {
    name: item.name,
    detail: item.detail,
    unitUSD: item.priceUSD,
    tint: item.kind === 'bonus' ? '#241838' : '#2E1620',
    art: item.art,
  };
}

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

export default function CartContents({ onCheckout, busy, onClose, variant = 'drawer', onCodaSettled }) {
  const { lines, setQty, remove, clear, count } = useCart();
  const { profile } = useUser(); // also re-renders when the local-currency table warms
  const gate = useAppGate();
  const codaOffered = codaOfferedTo(gate, profile);

  // SAME COINS ON BOTH RAILS. Only the price differs, because Google takes a
  // store fee. See PaymentMethodPicker for why it is this way round and not the
  // other (a second coin quantity is a Play rejection risk, not a pricing
  // choice).
  const playAvailable = isPlayBillingSupported();

  // CODA INSIDE THE GOOGLE PLAY APP (founder, 2026-09-27): the same Coda
  // checkout as the website, with Google Play offered underneath. Which shape
  // applies is Google's call per user (BillingBridge.kt), so until Google
  // approves the enrolment the mode is 'none' and this is the Play-only basket.
  //   developer / alternative: Coda methods drawn here, Play button under them
  //   google / user_choice:    Google draws the choice on the Play button; if
  //                            the buyer picks Vergr, the Coda form opens here
  const [choice, setChoice] = useState({ mode: 'none' });
  useEffect(() => {
    if (!IS_PLAY_BUILD || !playAvailable || !codaOffered || !billingChoiceSupported()) return undefined;
    let alive = true;
    getBillingChoiceMode(gate.playUserChoice === true).then((c) => { if (alive) setChoice(c); });
    return () => { alive = false; };
  }, [playAvailable, codaOffered, gate.playUserChoice]);
  const storeCoda = IS_PLAY_BUILD && codaOffered && (choice.mode === 'developer' || choice.mode === 'alternative');
  const googleChoice = IS_PLAY_BUILD && codaOffered && (choice.mode === 'google' || choice.mode === 'user_choice');
  // Google's token from its own choice screen, once the buyer picked Vergr there.
  const [chosenPlay, setChosenPlay] = useState(null);
  const [choiceBusy, setChoiceBusy] = useState(false);
  const codaAvailable = IS_STORE_BUILD ? (codaOffered && (storeCoda || !!chosenPlay)) : codaOffered;
  // A STORE build offers the store's own billing only, so it starts there.
  // ⚠ IS_STORE_BUILD, not IS_PLAY_BUILD — Huawei sells through HUAWEI IAP too,
  // and starting it on 'card' would open PayRam inside the AppGallery build.
  const [method, setMethod] = useState(IS_STORE_BUILD ? 'googlePlay' : 'card');
  // Coda switched off (or this viewer lost staff) while it was selected: fall
  // back to the rail this build may always sell through. ⚠ On a store build that
  // is the store's own billing, NEVER 'card': the card row is our own checkout,
  // which the Play / AppGallery app must not open.
  useEffect(() => {
    if (method === 'coda' && !codaAvailable) setMethod(IS_STORE_BUILD ? 'googlePlay' : 'card');
  }, [method, codaAvailable]);
  // WEBSITE / DESKTOP CHECKOUT IS CODAPAY, EMBEDDED (founder, 2026-09-25).
  // The methods for the buyer's country are listed right here with their full
  // price; PayRam is hidden (its server stays) and there is no popup.
  const codaMode = !IS_STORE_BUILD || storeCoda || !!chosenPlay;
  // `inPlay` prices each method with Google's fee added on top (the order adds
  // the same fee when it carries the token), so the price shown is the charge.
  const codaPayload = useMemo(() => ({
    cart: lines.map((l) => ({ sku: l.sku, qty: l.qty })),
    ...(IS_STORE_BUILD ? { inPlay: true } : {}),
  }), [lines]);
  const [quote, setQuote] = useState(null);
  const [quoting, setQuoting] = useState(false);
  const [err, setErr] = useState('');
  const [playPrices, setPlayPrices] = useState(null); // null = not asked yet

  // Re-quote whenever the basket changes. The dependency is the CONTENT, not
  // the array identity, so a re-render that produces an equal cart does not
  // fire another call.
  const sig = useMemo(() => lines.map((l) => `${l.sku}:${l.qty}`).join(','), [lines]);
  // Google's token belongs to the product it was issued for.
  useEffect(() => { setChosenPlay(null); }, [sig]);

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
    getCoinPriceQuote({ cart: lines, method: method === 'coda' ? 'coda_card' : method })
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
    fetchPlayPrices(lines.map((l) => playIdForSku(l.sku)))
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
    ? (playPrices?.[playIdForSku(lines[0].sku)]?.price || '')
    : '';
  const playUnavailableReason = !playAvailable
    ? 'Only available in the Android app'
    : !singleLine
      ? 'Google Play takes one pack at a time'
      : '';

  // Google draws the choice (google / user_choice): the Play button goes
  // through buyWithChoice. A Play purchase finishes as normal; picking Vergr on
  // Google's screen hands back its token and the Coda form opens right here.
  const buyViaChoice = async () => {
    setChoiceBusy(true);
    setErr('');
    try {
      const r = await buyWithChoice(playIdForSku(lines[0].sku), auth.currentUser?.uid);
      if (r?.choice) { setChosenPlay({ token: r.choice.token, program: r.choice.program }); return; }
      onCodaSettled?.({ coins: Number(r?.coins) || 0 });
    } catch (e) {
      if (e?.code !== 'cancelled' && e?.code !== 'canceled') setErr(e?.message || 'Google Play could not complete that purchase.');
    } finally {
      setChoiceBusy(false);
    }
  };

  // The Google Play option under the Coda form. Where Vergr draws the choice,
  // Google requires its own artwork and loyalty line on the Play option.
  const playOption = IS_PLAY_BUILD && codaMode ? (
    <div style={{ marginTop: 12 }}>
      <div style={{ fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase', color: WALLET_TOKENS.textMuted, fontWeight: 700, marginBottom: 8 }}>
        Or pay with
      </div>
      <button
        type="button"
        onClick={() => onCheckout?.(lines, quote, 'googlePlay')}
        disabled={busy || !playPrice}
        aria-label="Pay with Google Play"
        style={{
          display: 'flex', alignItems: 'center', gap: 12, width: '100%', padding: '10px 14px', borderRadius: 12, border: 0,
          background: '#FFFFFF', color: '#141018', font: 'inherit', textAlign: 'left',
          cursor: busy || !playPrice ? 'default' : 'pointer', opacity: busy || !playPrice ? 0.55 : 1,
        }}
      >
        {choice.playImage
          ? <img src={choice.playImage} alt="Google Play" draggable={false} style={{ height: 32, width: 'auto', maxWidth: 128, objectFit: 'contain', display: 'block' }} />
          : <GooglePlayPrism size={22} />}
        <span style={{ flex: 1, minWidth: 0 }}>
          <span style={{ display: 'block', fontWeight: 800, fontSize: 14 }}>Google Play</span>
          {(choice.playLoyalty || playUnavailableReason) && (
            <span style={{ display: 'block', fontSize: 11.5, color: '#4A4A5A', marginTop: 1 }}>
              {playUnavailableReason || choice.playLoyalty}
            </span>
          )}
        </span>
        <span className="font-dmmono tabular-nums" style={{ fontWeight: 800, fontSize: 14, whiteSpace: 'nowrap' }}>
          {playPrice || (playPriceLoading ? '…' : '')}
        </span>
      </button>
    </div>
  ) : null;

  if (!lines.length) {
    return (
      <div style={{ padding: '48px 24px', textAlign: 'center' }}>
        <div style={{
          width: 56, height: 56, borderRadius: '50%', margin: '0 auto 14px',
          display: 'grid', placeItems: 'center', background: '#1C1C2B',
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
              background: '#1C1C2B', border: 0,
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
          // A coin pack or a store item, flattened into ONE row object.
          //
          // ⚠⚠ `pack` AND `item` ARE DELIBERATELY NOT IN SCOPE BELOW THIS BLOCK.
          // The first version kept both and branched at each field, and one
          // survivor forty lines down (`pack.priceUSD * line.qty` in the line
          // total) dereferenced null the moment a boost was added and took the
          // whole basket to the ErrorBoundary. A single non-null row has nothing
          // to deref through, so the bug cannot recur by omission.
          //
          // One row shape rather than two components, too: the fields line up
          // (name, what you get, unit price, quantity), and a basket that looked
          // like two different products depending on the line would be the
          // "second visual language" problem in a smaller box.
          const row = rowFor(line.sku);
          if (!row) return null;
          const { name: rowName, detail: rowDetail, unitUSD: rowUnitUSD, tint: rowTint, art: rowArt } = row;
          const lineQuote = quote?.lines?.find((l) => l.sku === line.sku);
          return (
            <div
              key={line.sku}
              style={{
                display: 'flex', gap: 12, alignItems: 'flex-start',
                padding: '12px 0',
              }}
            >
              <div style={{
                width: 40, height: 40, borderRadius: 10, flexShrink: 0,
                display: 'grid', placeItems: 'center', background: rowTint,
                overflow: 'hidden',
              }}>
                {/* The item's own art, so a basket looks like what was clicked
                    in the shop. Falls back to the coin glyph rather than an
                    empty square when the render has not shipped yet. */}
                {rowArt ? (
                  <img
                    src={rowArt} alt="" width={40} height={40} draggable={false}
                    style={{ objectFit: 'contain' }}
                    onError={(e) => { e.currentTarget.style.display = 'none'; }}
                  />
                ) : <CoinGlyph size={20} />}
              </div>

              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 700, fontSize: 14 }}>{rowName}</div>
                <div style={{ fontSize: 12, color: WALLET_TOKENS.textMuted, marginTop: 1 }}>
                  {rowDetail}
                </div>
                {/* Unit price, so the line total is checkable rather than
                    asserted. */}
                <div style={{ fontSize: 11.5, color: WALLET_TOKENS.textMuted, marginTop: 3 }}>
                  ${rowUnitUSD.toFixed(2)} each
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 8 }}>
                  <div style={{
                    display: 'inline-flex', alignItems: 'center',
                    background: '#1C1C2B', borderRadius: 8, overflow: 'hidden',
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
                {/* ⚠ `rowUnitUSD`, never `pack.priceUSD`. A store-item line has
                    no pack, and reading through the null here crashed the whole
                    basket to the ErrorBoundary the first time a boost was added.
                    Every field below the resolve must use a row* variable. */}
                ${(lineQuote ? lineQuote.priceUSD : rowUnitUSD * line.qty).toFixed(2)}
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
        paddingTop: 12,
        flexShrink: 0,
      }}>
        {codaMode ? (
          <CodaCheckoutBlock
            payload={codaPayload}
            enabled={codaAvailable && lines.length > 0}
            profile={profile}
            emptyText="Buying on the web is not open yet. You can buy coins in the Vergr Android app."
            onSettled={onCodaSettled}
            preparePlay={storeCoda && !chosenPlay ? prepareAltBilling : null}
            presetPlay={chosenPlay}
            alternative={playOption}
            summary={(
              <Row
                label={coins > 0 ? `Coins (${count} item${count === 1 ? '' : 's'})` : `${count} item${count === 1 ? '' : 's'}`}
                value={coins > 0 ? `${fmtNum(coins)} coins` : 'Applied on purchase'}
              />
            )}
            legal={<CodaLegal />}
          />
        ) : (<>
        <PaymentMethodPicker
          value={method}
          onChange={setMethod}
          googlePlayAvailable={playAvailable}
          coins={coins}
          cardPrice={quote && method !== 'coda' ? `$${quote.amountUSD.toFixed(2)}` : ''}
          codaAvailable={codaAvailable}
          // No USD price on the Coda row: Coda charges a LOCAL price per method,
          // shown per method in the basket (CodaPay.jsx). A dollar figure here
          // would contradict it.
          codaPrice=""
          playPrice={playPrice}
          playPriceLoading={playPriceLoading}
          playUnavailableReason={playUnavailableReason}
        />

        {/* A basket of boosts and bonuses yields no coins, so this row would read
            "Coins (2 items) — 0 coins", which looks like a fault rather than a
            fact. It states what the basket is instead. */}
        <Row
          label={coins > 0
            ? `Coins (${count} item${count === 1 ? '' : 's'})`
            : `${count} item${count === 1 ? '' : 's'}`}
          value={coins > 0 ? `${fmtNum(coins)} coins` : 'Applied on purchase'}
        />

        {/* THE STICKER PRICE, and only the sticker price.
            The shelf says $0.99, the picker row says $0.99, and this says
            $0.99. A pack advertised at one number and totalled at another two
            screens later reads as a bait-and-switch even when the difference is
            an honestly-disclosed fee, which is exactly what the founder called
            out. The amount actually charged lives on the Pay button, where the
            buyer is looking at the moment it matters. */}
        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
          marginTop: 10,
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
        {method !== 'coda' && (
          <TaxesAndFees
            checkout={quote?.checkout}
            method={method}
            playPrice={playPrice}
          />
        )}

        <div style={{ fontSize: 11, color: WALLET_TOKENS.textMuted, marginTop: 3, textAlign: 'right' }}>
          {method === 'googlePlay' ? (
            <span>Charged by Google Play in your account currency</span>
          ) : method === 'coda' ? (
            <span>Charged in your currency. Each method shows its price next.</span>
          ) : (
            <>
              {/* The estimate is suppressed for a buyer already on USD (A3), so
                  the separator has to go with it or the line reads
                  " · charged in USD". */}
              {quote && hasLocalEstimate(quote.checkout?.total ?? quote.priceUSD) && (
                <>
                  <LocalPrice usd={quote.checkout?.total ?? quote.priceUSD} prefix="≈ " />
                  <span> · </span>
                </>
              )}
              <span>charged in USD</span>
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
          const blocked = busy || choiceBusy
            || (payingWithPlay ? !playPrice : (quoting || !quote));
          const viaChoice = googleChoice && payingWithPlay && singleLine;
          return (
            <button
              onClick={viaChoice ? buyViaChoice : () => onCheckout?.(lines, quote, method)}
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
                // Google asks for its prism on a NEUTRAL light or dark ground,
                // and its yellow disappears on gold, so the Play button is white.
                background: payingWithPlay ? '#FFFFFF' : WALLET_TOKENS.gold, color: '#141018',
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
              {busy || choiceBusy
                ? 'Opening checkout…'
                : payingWithPlay
                  ? (
                    // The store's own purchase sheet opens from here, so the
                    // button says which store it is. ⚠ Google's prism is
                    // GOOGLE's mark and is drawn ONLY on the Play build — using
                    // it for a Huawei purchase misattributes who takes the money
                    // and is a trademark we have no licence for there.
                    <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                      {!IS_HUAWEI_BUILD && <GooglePlayPrism size={20} />}
                      {`Buy with ${STORE_NAME || 'Google Play'}`}
                    </span>
                  )
                  : method === 'coda'
                    ? 'Choose how to pay'
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
          . Payment is handled by our payment provider on behalf of {OPERATOR.legalName}, the operator of Vergr.
        </p>
        </>)}
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
        background: '#1C1C2B', border: 0, color: WALLET_TOKENS.text,
      }}
    >
      <Icon name={icon} size={16} />
    </button>
  );
}

/** Terms at the point of payment, for the Coda checkout. */
function CodaLegal() {
  return (
    <p style={{ fontSize: 11, color: WALLET_TOKENS.textMuted, lineHeight: 1.55, marginTop: 10 }}>
      Coins are digital credit for use inside Vergr. They are delivered to your wallet
      immediately and are non-refundable once delivered, except as set out in our{' '}
      <Link to="/platform/refunds" style={{ color: WALLET_TOKENS.textSecondary, textDecoration: 'underline' }}>Refund Policy</Link>
      . By continuing you agree to our{' '}
      <Link to="/platform/terms" style={{ color: WALLET_TOKENS.textSecondary, textDecoration: 'underline' }}>Terms</Link>{' '}and{' '}
      <Link to="/platform/privacy" style={{ color: WALLET_TOKENS.textSecondary, textDecoration: 'underline' }}>Privacy Policy</Link>
      . Payment is processed by Coda on behalf of {OPERATOR.legalName}, the operator of Vergr.
    </p>
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
