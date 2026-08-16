// src/components/wallet/PaymentMethodPicker.jsx
//
// Choose how to pay. Same coins either way; only the price differs.
//
// ## The model, and why it is this way round
//
// Google takes a service fee on every in-app purchase, and in tax-inclusive
// markets Play is the merchant of record and collects the VAT before paying us.
// Same money in from the buyer, materially less money out to us. Something has
// to give, and there are only two places it can: the coins or the price.
//
// It is the PRICE. An earlier version cut the coin count on Play instead, and
// that was the dangerous choice for two independent reasons:
//
//   1. Play's alternative-billing rules require the buyer to be able to compare
//      the options FAIRLY, with no thumb on the scale toward our own billing.
//      Expressing the penalty in the product itself — you receive fewer coins if
//      you pay Google — is the least defensible form of exactly that.
//   2. A Play IAP product carries ONE fixed quantity. A second quantity means
//      the shelf advertises one number and the Play sheet charges for another,
//      which is the displayed-versus-charged mismatch Play rejects for.
//
// So both rows sell the identical pack, and the Play row costs more. That is an
// ordinary, disclosable consequence of the store fee.
//
// ## The Play price is NEVER ours to calculate
//
// `src/utils/storePricing.js` can compute what a market should charge, but that
// is for deciding what to type into Play Console. At runtime the figure shown
// here must be Play's own formatted string, fetched through `fetchPlayPrices()`,
// because Play rounds to its own price points per market and applies its own
// tax-display rules. If the fetch has not answered, the row says so and cannot
// be selected. Guessing is the failure mode this whole file exists to avoid.
//
// ## Both rails are offered inside the Play app
//
// Google is required to permit alternative billing, so this picker is NOT hidden
// in a store build. Neither row is highlighted, badged or pre-selected as the
// better deal: same height, same type, same button treatment. The buyer decides.
import Icon from '../Icon';
import { WALLET_TOKENS } from './primitives';

/**
 * @param {'card'|'googlePlay'} value
 * @param {function} onChange
 * @param {boolean}  googlePlayAvailable  only inside a Play build with billing
 * @param {number}   coins                what the basket yields — the SAME on both rails
 * @param {string}   cardPrice            our own formatted total (we are the merchant)
 * @param {string}   playPrice            Play's OWN formatted string, or '' if unknown
 * @param {boolean}  playPriceLoading     true while the Play lookup is in flight
 * @param {string}   playUnavailableReason  set when Play cannot be offered at all
 */
export default function PaymentMethodPicker({
  value,
  onChange,
  googlePlayAvailable,
  coins,
  cardPrice,
  playPrice,
  playPriceLoading,
  playUnavailableReason,
}) {
  // A Play row we cannot price is a row nobody may choose. Selecting it would
  // send the buyer to a sheet showing a number this screen never displayed.
  const playSelectable = !!googlePlayAvailable && !!playPrice;

  const methods = [
    {
      // ONE card row, routing to PayRam (founder, 2026-08-13). Stripe was the
      // 'card' row from 2026-08-11 until Stripe closed the account. With one
      // processor left there is no second row to draw: two rows both reaching
      // the same provider under different names is a support ticket waiting to
      // happen, which was the reason they were named apart in the first place.
      //
      // Buyers do not know or care what a PayRam is, so the row says what it
      // does rather than who runs it.
      id: 'card',
      label: 'Card or crypto',
      icon: 'credit_card',
      price: cardPrice,
      available: true,
      note: 'Opens our payment provider',
    },
    {
      id: 'googlePlay',
      label: 'Google Play',
      icon: 'shop',
      price: playPrice,
      available: playSelectable,
      note: playUnavailableReason
        || (playPriceLoading
          ? 'Checking Google Play pricing…'
          : !playPrice
            ? 'Google Play pricing unavailable right now'
            // Rule 2: disclose the fee in words. We cannot add a surcharge line,
            // because Play charges its own SKU price, not ours plus something.
            : 'Billed by Google. Includes Google Play’s service fee'),
    },
  ];

  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{
        fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase',
        color: WALLET_TOKENS.textMuted, fontWeight: 700, marginBottom: 8,
      }}>
        Pay with
      </div>

      <div style={{ display: 'grid', gap: 8 }}>
        {methods.map((m) => {
          const active = value === m.id;
          return (
            <button
              key={m.id}
              onClick={() => m.available && onChange(m.id)}
              disabled={!m.available}
              style={{
                // Visual parity is a policy requirement, not a style choice:
                // identical padding, radius, type and tap target on both rows.
                display: 'flex', alignItems: 'center', gap: 12, textAlign: 'left',
                padding: '12px 14px', borderRadius: 12, width: '100%',
                cursor: m.available ? 'pointer' : 'not-allowed',
                opacity: m.available ? 1 : 0.45,
                background: active ? 'rgba(123,31,255,0.14)' : 'rgba(255,255,255,0.04)',
                border: `1px solid ${active ? WALLET_TOKENS.violet : WALLET_TOKENS.hairline}`,
                color: WALLET_TOKENS.text, font: 'inherit',
              }}
            >
              <span
                className="material-symbols-outlined"
                style={{ fontSize: 20, color: active ? WALLET_TOKENS.violetLight : WALLET_TOKENS.textMuted }}
              >
                {m.icon}
              </span>

              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: 'block', fontSize: 13.5, fontWeight: 700 }}>{m.label}</span>
                <span style={{ display: 'block', fontSize: 11.5, color: WALLET_TOKENS.textMuted, marginTop: 1 }}>
                  {m.note}
                </span>
              </span>

              {/* The PRICE is what differs, so the price is what each row
                  carries. Same treatment on both: no "best value", no colour
                  that scores one against the other. */}
              {m.price && (
                <span
                  className="font-dmmono tabular-nums"
                  style={{ flexShrink: 0, fontSize: 14, fontWeight: 800, color: WALLET_TOKENS.text }}
                >
                  {m.price}
                </span>
              )}

              <span style={{
                width: 16, height: 16, borderRadius: '50%', flexShrink: 0,
                border: `2px solid ${active ? WALLET_TOKENS.violet : WALLET_TOKENS.hairlineStrong}`,
                background: active ? WALLET_TOKENS.violet : 'transparent',
              }} />
            </button>
          );
        })}
      </div>

      {/* Stated plainly rather than as an asterisk. The buyer is about to notice
          the difference anyway, and "the store takes a cut" is both true and the
          reason every app that offers a choice gives. */}
      {coins > 0 && (
        <p style={{ fontSize: 11, color: WALLET_TOKENS.textMuted, lineHeight: 1.5, marginTop: 8 }}>
          <Icon name="info" size={12} style={{ verticalAlign: '-2px', marginRight: 4 }} />
          You get the same {coins.toLocaleString()} coins either way. Google charges a
          store fee on in-app purchases, so the price through Google Play is higher.
        </p>
      )}
    </div>
  );
}
