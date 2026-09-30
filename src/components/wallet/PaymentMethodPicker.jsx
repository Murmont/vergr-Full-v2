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
// ## The Play build offers Google Play ONLY (founder decision, 2026-09-11)
//
// Our own checkout next to Play Billing inside a Play app is allowed only for
// users in the US (Epic v. Google injunction, since Oct 2025) and, since
// 30 June 2026, the UK and EEA, and only for a developer ENROLLED in Google's
// alternative-billing / billing-choice programs, which also means integrating
// Google's alternative-billing APIs and reporting every such sale within 24
// hours. Vergr is not enrolled (Play Console > Settings > Billing choice shows
// "Enroll"), and the founder is enrolling once the EIN arrives. Until then the
// card row is NOT rendered on the Play build. An earlier comment here said
// "Google is required to permit alternative billing, so this picker is NOT
// hidden in a store build"; that is only true inside those programs.
//
// Wherever the card row IS offered (web, desktop, sideload, Huawei), both rows
// stay equal: same height, same type, same button treatment, neither
// highlighted or pre-selected. The buyer decides.
import Icon from '../Icon';
import { WALLET_TOKENS } from './primitives';
import { IS_PLAY_BUILD, IS_STORE_BUILD, IS_HUAWEI_BUILD, STORE_NAME } from '../../utils/platform';

// Google's official Play prism, full colour and unmodified: the 24dp asset from
// developer.android.com's billing-choice UX guidelines, which is where Google
// asks for it on a payment option. Inline so it works offline and needs no CSP
// entry. Exported for the checkout button that launches Google Play's sheet.
export function GooglePlayPrism({ size = 20 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true" style={{ display: 'block', flexShrink: 0 }}>
      <path d="M11.338 11.507L2.086 21.172C2.087 21.174 2.085 21.17 2.086 21.172C2.37 22.221 3.344 23 4.5 23C4.962 23 5.396 22.877 5.768 22.661L5.797 22.644L16.212 16.73L11.338 11.507Z" fill="#EA4335" />
      <path d="M20.698 9.861L20.689 9.855L16.193 7.289L11.127 11.726L16.212 16.73L20.683 14.188C21.468 13.772 22 12.958 22 12.02C22 11.088 21.475 10.279 20.698 9.861Z" fill="#FBBC04" />
      <path d="M2.085 2.828C2.029 3.029 2 3.241 2 3.461V20.54C2.009 20.785 2.03 20.971 2.086 21.172L11.656 11.754L2.085 2.828Z" fill="#4285F4" />
      <path d="M11.406 12L16.193 7.289L5.792 1.352C5.414 1.129 4.973 1 4.5 1C3.344 1 2.369 1.774 2.085 2.825C2.085 2.826 2.085 2.827 2.084 2.827L11.406 12Z" fill="#34A853" />
    </svg>
  );
}

// Google's official Google Pay acceptance mark, unmodified, drawn in the
// asset's own frame, which already carries the clear space Google requires
// (half the super-G height on every side). Source: Google-Pay-Acceptance.zip
// from the Google Pay brand guidelines, which say to "use the Google Pay mark to
// represent Google Pay as a payment option". It sits on the card row because
// PayRam's card checkout accepts Google Pay.
//
// It is the MARK, not the Google Pay BUTTON. The button has to launch the Google
// Pay API, which needs a processor on Google's list, and every one of those
// needs the LLC's EIN (founder, 2026-09-11: wait for the EIN).
export function GooglePayMark({ height = 24 }) {
  return (
    <svg width={Math.round((height * 1094) / 742)} height={height} viewBox="0 0 1094 742" role="img" aria-label="Google Pay" style={{ display: 'block', flexShrink: 0 }}>
      <path fill="#FFFFFF" d="M722.7,170h-352c-110,0-200,90-200,200l0,0c0,110,90,200,200,200h352c110,0,200-90,200-200l0,0C922.7,260,832.7,170,722.7,170z" />
      <path fill="#3C4043" d="M722.7,186.2c24.7,0,48.7,4.9,71.3,14.5c21.9,9.3,41.5,22.6,58.5,39.5c16.9,16.9,30.2,36.6,39.5,58.5c9.6,22.6,14.5,46.6,14.5,71.3s-4.9,48.7-14.5,71.3c-9.3,21.9-22.6,41.5-39.5,58.5c-16.9,16.9-36.6,30.2-58.5,39.5c-22.6,9.6-46.6,14.5-71.3,14.5h-352c-24.7,0-48.7-4.9-71.3-14.5c-21.9-9.3-41.5-22.6-58.5-39.5c-16.9-16.9-30.2-36.6-39.5-58.5c-9.6-22.6-14.5-46.6-14.5-71.3s4.9-48.7,14.5-71.3c9.3-21.9,22.6-41.5,39.5-58.5c16.9-16.9,36.6-30.2,58.5-39.5c22.6-9.6,46.6-14.5,71.3-14.5L722.7,186.2 M722.7,170h-352c-110,0-200,90-200,200l0,0c0,110,90,200,200,200h352c110,0,200-90,200-200l0,0C922.7,260,832.7,170,722.7,170L722.7,170z" />
      <path fill="#3C4043" d="M529.3,384.2v60.5h-19.2V295.3H561c12.9,0,23.9,4.3,32.9,12.9c9.2,8.6,13.8,19.1,13.8,31.5c0,12.7-4.6,23.2-13.8,31.7c-8.9,8.5-19.9,12.7-32.9,12.7h-31.7V384.2z M529.3,313.7v52.1h32.1c7.6,0,14-2.6,19-7.7c5.1-5.1,7.7-11.3,7.7-18.3c0-6.9-2.6-13-7.7-18.1c-5-5.3-11.3-7.9-19-7.9h-32.1V313.7z" />
      <path fill="#3C4043" d="M657.9,339.1c14.2,0,25.4,3.8,33.6,11.4c8.2,7.6,12.3,18,12.3,31.2v63h-18.3v-14.2h-0.8c-7.9,11.7-18.5,17.5-31.7,17.5c-11.3,0-20.7-3.3-28.3-10s-11.4-15-11.4-25c0-10.6,4-19,12-25.2c8-6.3,18.7-9.4,32-9.4c11.4,0,20.8,2.1,28.1,6.3v-4.4c0-6.7-2.6-12.3-7.9-17c-5.3-4.7-11.5-7-18.6-7c-10.7,0-19.2,4.5-25.4,13.6l-16.9-10.6C625.9,345.8,639.7,339.1,657.9,339.1z M633.1,413.3c0,5,2.1,9.2,6.4,12.5c4.2,3.3,9.2,5,14.9,5c8.1,0,15.3-3,21.6-9s9.5-13,9.5-21.1c-6-4.7-14.3-7.1-25-7.1c-7.8,0-14.3,1.9-19.5,5.6C635.7,403.1,633.1,407.8,633.1,413.3z" />
      <path fill="#3C4043" d="M808.2,342.4l-64,147.2h-19.8l23.8-51.5L706,342.4h20.9l30.4,73.4h0.4l29.6-73.4H808.2z" />
      <path fill="#4285F4" d="M452.93,372c0-6.26-0.56-12.25-1.6-18.01h-80.48v33L417.2,387c-1.88,10.98-7.930,20.34-17.2,26.58v21.41h27.59C443.7,420.08,452.93,398.04,452.93,372z" />
      <path fill="#34A853" d="M400.01,413.58c-7.68,5.18-17.57,8.21-29.14,8.21c-22.35,0-41.31-15.06-48.1-35.36h-28.46v22.08c14.1,27.98,43.08,47.18,76.56,47.18c23.14,0,42.58-7.61,56.73-20.71L400.01,413.58z" />
      <path fill="#FABB05" d="M320.09,370.05c0-5.7,0.95-11.21,2.68-16.39v-22.08h-28.46c-5.83,11.57-9.11,24.63-9.11,38.47s3.29,26.9,9.11,38.47l28.46-22.08C321.04,381.26,320.09,375.75,320.09,370.05z" />
      <path fill="#E94235" d="M370.87,318.3c12.63,0,23.94,4.35,32.87,12.85l24.45-24.43c-14.85-13.83-34.21-22.32-57.32-22.32c-33.47,0-62.46,19.2-76.56,47.18l28.46,22.08C329.56,333.36,348.52,318.3,370.87,318.3z" />
    </svg>
  );
}

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
  codaAvailable,
  codaPrice,
  playPrice,
  playPriceLoading,
  playUnavailableReason,
}) {
  // A Play row we cannot price is a row nobody may choose. Selecting it would
  // send the buyer to a sheet showing a number this screen never displayed.
  const playSelectable = !!googlePlayAvailable && !!playPrice;

  const methods = [
    // NOT rendered on the Play build: see "The Play build offers Google Play
    // ONLY" at the top of this file.
    // ⚠⚠ IS_STORE_BUILD, NOT IS_PLAY_BUILD. The Huawei build sells through
    // HUAWEI IAP too, and while this gate read IS_PLAY_BUILD the AppGallery
    // build rendered this card row — premium content sold outside HUAWEI IAP,
    // which is a Guideline 6.2 rejection. See STORE_NAME in utils/platform.js.
    !IS_STORE_BUILD && {
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
      // PayRam's checkout takes Google Pay, so the row carries Google's mark.
      googlePay: true,
    },
    // Codapay (founder, 2026-09-24): card and local payment methods through
    // Coda's hosted page. Web/desktop only, same as the PayRam row, and only
    // when app_config/general.codaCheckout lets this viewer see it.
    !IS_STORE_BUILD && codaAvailable && {
      id: 'coda',
      label: 'Card or local payment',
      icon: 'account_balance_wallet',
      price: codaPrice,
      available: true,
      note: 'Cards, wallets and local methods, priced in your currency',
    },
    {
      // The id stays 'googlePlay' because it is the internal name of THE STORE
      // RAIL and is persisted in the cart; only what the buyer reads changes.
      id: 'googlePlay',
      label: STORE_NAME || 'Google Play',
      icon: 'shop',
      price: playPrice,
      available: playSelectable,
      note: playUnavailableReason
        || (playPriceLoading
          ? `Checking ${STORE_NAME} pricing…`
          : !playPrice
            ? `${STORE_NAME} pricing unavailable right now`
            // Rule 2: disclose the fee in words. We cannot add a surcharge line,
            // because Play charges its own SKU price, not ours plus something.
            : (IS_HUAWEI_BUILD
              ? 'Billed by Huawei. Includes AppGallery’s service fee'
              : 'Billed by Google. Includes Google Play’s service fee')),
    },
  ].filter(Boolean);

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
                {/* ⚠ Google's prism is GOOGLE's mark. Never draw it for a
                    HUAWEI purchase — it misattributes who is taking the money,
                    and it is a trademark we have no licence to use there. The
                    Huawei row falls back to the plain shop glyph. */}
                {m.id === 'googlePlay' && !IS_HUAWEI_BUILD ? <GooglePlayPrism size={20} /> : m.icon}
              </span>

              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13.5, fontWeight: 700 }}>
                  {m.label}
                  {m.googlePay && <GooglePayMark height={24} />}
                </span>
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
          reason every app that offers a choice gives. Only where there IS a
          choice: the Play build shows Google Play alone. */}
      {coins > 0 && !IS_STORE_BUILD && (
        <p style={{ fontSize: 11, color: WALLET_TOKENS.textMuted, lineHeight: 1.5, marginTop: 8 }}>
          <Icon name="info" size={12} style={{ verticalAlign: '-2px', marginRight: 4 }} />
          You get the same {coins.toLocaleString()} coins either way. Google charges a
          store fee on in-app purchases, so the price through Google Play is higher.
        </p>
      )}
    </div>
  );
}
