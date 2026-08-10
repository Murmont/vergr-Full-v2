// src/components/wallet/PaymentMethodPicker.jsx
//
// Choose how to pay, and see what that choice costs you in coins.
//
// ## Why the coin count moves
//
// This is the Tango behaviour, and it is not a discount or a penalty we
// invented: Google takes a service fee on every in-app purchase, and in
// tax-inclusive markets Play is the merchant of record and collects the VAT
// before paying us. Same money in from the buyer, materially less money out to
// us. `src/utils/storePricing.js` already models that exactly, which is why the
// Play ladder carries ~15-20% fewer coins per pack than the web ladder.
//
// Hiding that and shipping one number would mean either selling coins below the
// floor through Play or overcharging on the web. Showing it is honest, and it
// is the strongest argument for the cheaper rail: the buyer can see, in coins,
// exactly what the store fee costs them.
//
// ## Both rails are offered inside the Play app
//
// Google is required to permit alternative billing, so this picker is NOT
// hidden in a store build. Play is offered because some people want it; card is
// offered because it buys more coins. The user decides, and neither option is
// pre-selected on their behalf beyond the default.
//
// ## What this does NOT do
//
// It does not price anything. Each method reports its own coin count from the
// ladder that method actually uses, and the money total still comes from the
// server quote. This component picks a lane.
import Icon from '../Icon';
import { WALLET_TOKENS } from './primitives';

/**
 * @param {'card'|'googlePlay'} value
 * @param {function} onChange
 * @param {boolean}  googlePlayAvailable  only inside a Play build with billing
 * @param {number}   cardCoins            coins on the web ladder
 * @param {number}   playCoins            coins on the Play ladder
 */
export default function PaymentMethodPicker({
  value,
  onChange,
  googlePlayAvailable,
  cardCoins,
  playCoins,
}) {
  const methods = [
    {
      id: 'card',
      label: 'Card, Apple Pay or crypto',
      icon: 'credit_card',
      coins: cardCoins,
      available: true,
      note: 'Processed by our payment provider',
    },
    {
      id: 'googlePlay',
      label: 'Google Play',
      icon: 'shop',
      coins: playCoins,
      available: googlePlayAvailable,
      note: googlePlayAvailable
        ? 'Billed to your Google account'
        : 'Only available in the Android app',
    },
  ];

  // ALWAYS rendered, including on the web where Google Play cannot work.
  //
  // This used to return null unless Play billing was available, which meant the
  // picker was invisible on web and desktop — every place it is easiest to
  // look at. Showing Google Play greyed out with the reason is more useful than
  // hiding it: the buyer learns the option exists in the app, and they can see
  // what it would cost them in coins.
  const best = Math.max(cardCoins || 0, playCoins || 0);

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
          const fewer = best > 0 && m.coins > 0 && m.coins < best;
          return (
            <button
              key={m.id}
              onClick={() => m.available && onChange(m.id)}
              disabled={!m.available}
              style={{
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

              {m.coins > 0 && (
                <span style={{ textAlign: 'right', flexShrink: 0 }}>
                  <span
                    className="font-dmmono tabular-nums"
                    style={{ display: 'block', fontSize: 14, fontWeight: 800, color: fewer ? WALLET_TOKENS.textSecondary : WALLET_TOKENS.goldLight }}
                  >
                    {m.coins.toLocaleString()}
                  </span>
                  <span style={{ display: 'block', fontSize: 10, color: WALLET_TOKENS.textMuted }}>coins</span>
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

      {/* Stated once, plainly, rather than as an asterisk. The buyer is about to
          notice the difference anyway; explaining it is better than letting them
          think we changed the price on them. */}
      {cardCoins > 0 && playCoins > 0 && cardCoins !== playCoins && (
        <p style={{ fontSize: 11, color: WALLET_TOKENS.textMuted, lineHeight: 1.5, marginTop: 8 }}>
          <Icon name="info" size={12} style={{ verticalAlign: '-2px', marginRight: 4 }} />
          Google charges a store fee on in-app purchases, so the same payment buys
          fewer coins through Google Play.
        </p>
      )}
    </div>
  );
}
