// Buy coins (v2) — web + desktop + mobile-web presentation.
// The native APK uses NativeBuyScreen (separate file). Both share ONE checkout
// implementation via useBuyCheckout (money flow — never duplicated).
//   • 8 fixed COIN_PACKS as the headline + a Custom amount tab (€10 floor)
//   • PayRam checkout opens in a popup window; we poll until settle, credit
//     lands via the wallet snapshot. No redirect URL needed.

import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { COIN_PACKS } from '../../../utils/vpSystem';
import { STORE_COIN_PACKS } from '../../../utils/storePricing';
import { IS_STORE_BUILD, IS_HUAWEI_BUILD } from '../../../utils/platform';

// The pack GRID shows the standard ladder everywhere, including inside the Play
// app. Google's store fee is real, but it only applies if the buyer chooses
// Google Play, and they are free not to — alternative billing is permitted. So
// the reduced Play quantities belong where the choice is actually made: the
// basket's payment picker, which re-renders the coin count per method. Shrinking
// every pack on the shelf would charge everyone in the Android app for a fee
// most of them are about to avoid.
// Fee model: src/utils/storePricing.js.
const ACTIVE_COIN_PACKS = COIN_PACKS;
import {
  WalletCard, WalletButton, Pill, SectionLabel, FeeBreakdown,
  CoinGlyph, WALLET_TOKENS, fmtNum, fmtEUR, AnimatedNumber,
} from '../../../components/wallet/primitives';
import { useUI } from '../../../context/UIContext';
import { useBuyCheckout, MIN_CUSTOM_EUR, COIN_PRICE_EUR, checkoutCartViaPlay } from './buyCheckout';
import { auth } from '../../../firebase/config';
import Icon from '../../../components/Icon';
import LocalPrice from '../../../components/LocalPrice';
import PriceQuote from '../../../components/wallet/PriceQuote';
import CartDrawer from '../../../components/wallet/CartDrawer';
import { useCart } from '../../../context/CartContext';
import useResponsive from '../../../hooks/useResponsive';
import { getCoinPriceQuote } from '../../../firebase/firestore';

export default function BuyScreen() {
  const { showToast } = useUI();
  const [tab, setTab] = useState('packs');
  const [customEUR, setCustomEUR] = useState(20);
  const { checkout, startCheckout, cancelCheckout } = useBuyCheckout(showToast);
  const cart = useCart();
  const navigate = useNavigate();
  const { isDesktop } = useResponsive();

  // Desktop opens the basket in place so browsing is not interrupted; mobile
  // navigates to a real page, which can be linked, shared and backed out of.
  const openCart = () => (isDesktop ? cart.setOpen(true) : navigate('/wallet/cart'));

  const addToCart = (pack) => {
    cart.add(pack.id, 1);
    showToast(`${pack.name} added to your basket`, 'success');
  };

  const checkoutCart = async (lines, _quote, method) => {
    // Google Play cannot take a basket in one go, so it buys line by line.
    // Routing it here rather than through PayRam is not a preference: billing
    // digital goods inside a Play app any other way is a policy violation.
    if (method === 'googlePlay') {
      const res = await checkoutCartViaPlay(lines, auth.currentUser?.uid, showToast);
      if (res.bought === res.total) { cart.clear(); cart.setOpen(false); }
      return;
    }
    // SKUs and quantities only. The server re-prices the basket, which is why
    // no amount is sent from here.
    const ok = await startCheckout({ cart: lines }, 'your basket');
    // Cleared only once the payment page actually opened: clearing on click
    // would lose the basket to a blocked popup.
    if (ok === true) { cart.clear(); cart.setOpen(false); }
  };

  const customCoins = Math.floor((parseFloat(customEUR) || 0) / COIN_PRICE_EUR);

  // The whole ladder priced in ONE server call: regional multiplier applied,
  // then converted to the USD figure that will actually be charged. The screen
  // never does this arithmetic itself, because a second calculation is a second
  // chance to disagree with the statement the buyer eventually reads.
  const [ladder, setLadder] = useState(null);
  useEffect(() => {
    let alive = true;
    getCoinPriceQuote({ all: true })
      .then((q) => { if (alive) setLadder(q); })
      // A missing quote is not a broken screen: PriceQuote falls back to the
      // EUR sticker, which is what was shown before this existed.
      .catch(() => {});
    return () => { alive = false; };
  }, []);

  return (
    <div style={{ maxWidth: 1120, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ marginBottom: 24 }}>
        <div style={{
          fontSize: 11, letterSpacing: '0.12em', textTransform: 'uppercase',
          color: WALLET_TOKENS.violetLight, fontWeight: 600, marginBottom: 8,
        }}>Buy coins</div>
        <h1 style={{ fontFamily: 'Syne, sans-serif', fontWeight: 700, fontSize: 30, letterSpacing: '-0.02em' }}>
          Top up your wallet.
        </h1>
        <p style={{ color: WALLET_TOKENS.textSecondary, fontSize: 14, marginTop: 8 }}>
          Card, Apple Pay, or instant bank. Coins land within seconds.
        </p>
      </div>

      {/* Basket. Present on both breakpoints so the count is always visible;
          only where it LEADS differs. */}
      <button
        onClick={openCart}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 8, marginBottom: 18,
          padding: '9px 14px', borderRadius: 999, cursor: 'pointer',
          background: cart.count ? 'rgba(240,165,0,0.14)' : 'rgba(255,255,255,0.05)',
          border: `1px solid ${cart.count ? WALLET_TOKENS.gold : WALLET_TOKENS.hairline}`,
          color: cart.count ? WALLET_TOKENS.goldLight : WALLET_TOKENS.textSecondary,
          font: 'inherit', fontSize: 13, fontWeight: 700,
        }}
      >
        <span className="material-symbols-outlined" style={{ fontSize: 18 }}>shopping_cart</span>
        {cart.count ? `Basket · ${cart.count}` : 'Basket'}
      </button>

      {/* Tabs */}
      <div style={{
        display: 'inline-flex', gap: 4, padding: 4, marginBottom: 20,
        background: WALLET_TOKENS.surface2, borderRadius: 12,
      }}>
        <TabBtn active={tab === 'packs'}  onClick={() => setTab('packs')}>Coin packs</TabBtn>
        <TabBtn active={tab === 'custom'} onClick={() => setTab('custom')}>Custom amount</TabBtn>
      </div>

      {tab === 'packs' && (
        <div className="vg-walletBuy-grid" style={{
          display: 'grid', gap: 12,
          gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
        }}>
          {ACTIVE_COIN_PACKS.map(p => (
            <PackCard key={p.id} pack={p}
              quote={ladder?.packs?.[p.id]}
              busy={checkout?.status === 'waiting'}
              onAdd={() => addToCart(p)}
              onBuy={() => startCheckout({ packSku: p.id }, p.name)} />
          ))}
        </div>
      )}

      {tab === 'custom' && (
        <CustomTab eur={customEUR} setEur={setCustomEUR}
          busy={checkout?.status === 'waiting'}
          onContinue={() => startCheckout({ customCoins }, `${fmtNum(customCoins)} coins`)} />
      )}

      {checkout && (
        <CheckoutOverlay checkout={checkout} onCancel={cancelCheckout} />
      )}

      {/* Desktop only in practice: the drawer renders nothing unless the cart
          context is open, and mobile routes to /wallet/cart instead. */}
      <CartDrawer onCheckout={checkoutCart} busy={checkout?.status === 'waiting'} />
    </div>
  );
}

function CheckoutOverlay({ checkout, onCancel }) {
  const opening = checkout.status === 'opening';
  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 1000,
      background: 'rgba(5,5,12,0.78)', backdropFilter: 'blur(4px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
    }}>
      <WalletCard style={{ maxWidth: 420, textAlign: 'center' }}>
        <div style={{
          width: 56, height: 56, borderRadius: '50%', margin: '4px auto 16px',
          display: 'grid', placeItems: 'center',
          background: 'rgba(123,31,255,0.15)', border: `1px solid ${WALLET_TOKENS.violet}`,
        }}>
          <Icon name="open_in_new" size={26} style={{ color: WALLET_TOKENS.violetLight }} />
        </div>
        <div style={{ fontFamily: 'Syne, sans-serif', fontWeight: 700, fontSize: 18, marginBottom: 8 }}>
          {opening ? 'Opening secure checkout…' : 'Complete your payment'}
        </div>
        <p style={{ color: WALLET_TOKENS.textSecondary, fontSize: 13, lineHeight: 1.5, marginBottom: 18 }}>
          {opening
            ? 'A secure checkout window is opening. Hold on a moment.'
            : `Finish paying for ${checkout.label} in the checkout window. This page updates automatically the moment your coins land — keep it open.`}
        </p>
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 18 }}>
          <span className="font-dmmono" style={{
            display: 'inline-flex', alignItems: 'center', gap: 8,
            fontSize: 12, color: WALLET_TOKENS.textMuted,
          }}>
            <span style={{
              width: 8, height: 8, borderRadius: '50%',
              background: WALLET_TOKENS.goldLight,
            }} />
            Waiting for confirmation…
          </span>
        </div>
        <WalletButton variant="ghost" full onClick={onCancel}>Cancel</WalletButton>
      </WalletCard>
    </div>
  );
}

function CustomTab({ eur, setEur, onContinue, busy }) {
  // Re-quoted as the amount changes, debounced so dragging the slider does not
  // fire a call per pixel. The quote is the ONLY source of the charged figure.
  const [customQuote, setCustomQuote] = useState(null);
  const eurNum = parseFloat(eur) || 0;
  const coins = Math.floor(eurNum / COIN_PRICE_EUR);
  const valid = eurNum >= MIN_CUSTOM_EUR;
  const procFee = eurNum * 0.015; // illustrative card-processor fee (3rd party)

  useEffect(() => {
    if (!valid) { setCustomQuote(null); return undefined; }
    let alive = true;
    // 400ms: long enough that dragging the slider does not fire a call per
    // pixel, short enough that the figure has settled before anyone reaches
    // for the button.
    const t = setTimeout(() => {
      getCoinPriceQuote({ customCoins: coins })
        .then((q) => { if (alive) setCustomQuote(q); })
        .catch(() => { if (alive) setCustomQuote(null); });
    }, 400);
    return () => { alive = false; clearTimeout(t); };
  }, [coins, valid]);
  return (
    <WalletCard>
      <SectionLabel>Amount</SectionLabel>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
        {[10, 20, 50, 100, 250].map(n => (
          <button key={n} onClick={() => setEur(n)} style={{
            padding: '8px 14px', borderRadius: 10, fontSize: 13, fontWeight: 600,
            background: eur === n ? WALLET_TOKENS.violet : WALLET_TOKENS.surface2,
            color: eur === n ? '#fff' : WALLET_TOKENS.textSecondary,
            border: `1px solid ${eur === n ? WALLET_TOKENS.violet : WALLET_TOKENS.hairlineStrong}`,
            cursor: 'pointer',
          }}>{fmtEUR(n)}</button>
        ))}
      </div>
      <div style={{ position: 'relative', marginBottom: 14 }}>
        <span style={{
          position: 'absolute', left: 18, top: '50%', transform: 'translateY(-50%)',
          fontSize: 28, fontWeight: 700, color: WALLET_TOKENS.goldLight,
          fontFamily: 'DM Mono, monospace',
        }}>€</span>
        <input value={eur}
          onChange={(e) => setEur(e.target.value.replace(/[^\d.]/g, ''))}
          inputMode="decimal"
          style={{
            width: '100%', padding: '14px 14px 14px 42px',
            fontSize: 28, fontWeight: 700,
            fontFamily: 'DM Mono, monospace',
            color: WALLET_TOKENS.goldLight,
            background: WALLET_TOKENS.surface2,
            border: `1px solid ${WALLET_TOKENS.hairlineStrong}`,
            borderRadius: 10, outline: 'none',
          }} />
      </div>
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        marginBottom: 20,
      }}>
        <span style={{ fontSize: 13, color: WALLET_TOKENS.textSecondary }}>You receive</span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          <CoinGlyph size={22} />
          <span className="font-dmmono tabular-nums" style={{
            fontSize: 22, fontWeight: 700, color: WALLET_TOKENS.goldLight,
          }}>
            <AnimatedNumber value={coins} /> coins
          </span>
        </span>
      </div>

      <FeeBreakdown
        items={[
          { label: 'You pay',                  value: fmtEUR(eurNum) },
          { label: 'Payment processing (~1.5%)', value: `-${fmtEUR(procFee)}`, tone: 'muted' },
          { label: 'VERGR fee',                value: fmtEUR(0), tone: 'muted' },
        ]}
        total={`${fmtNum(coins)} coins`}
        totalLabel="You receive"
      />

      {/* The charged figure, quoted by the server with the regional multiplier
          and the live FX rate already applied, so it matches the statement. The
          EUR line above is the catalogue price the coins are counted from. */}
      {valid && (
        <div style={{ marginTop: 10 }}>
          <PriceQuote
            quote={customQuote}
            size="sm"
            fallback={(
              <div style={{ fontSize: 11, color: WALLET_TOKENS.textMuted }}>
                <LocalPrice eur={eurNum} prefix="≈ " /> · charged in USD
              </div>
            )}
          />
        </div>
      )}

      {!valid && eur && (
        <div style={{ marginTop: 12, fontSize: 12, color: '#FCD34D' }}>
          Minimum is {fmtEUR(MIN_CUSTOM_EUR)} (set by our card processor).
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 20 }}>
        <WalletButton variant="primary" size="lg" disabled={!valid || busy}
          icon="credit_card" iconRight="arrow_forward" onClick={onContinue}>
          Continue to checkout
        </WalletButton>
      </div>
    </WalletCard>
  );
}

function PackCard({ pack, onBuy, onAdd, busy, quote }) {
  const isPopular = pack.badgeStyle === 'popular';
  return (
    <div style={{
      padding: 18, borderRadius: 16,
      background: WALLET_TOKENS.surface1,
      border: `1px solid ${isPopular ? 'rgba(123,31,255,0.40)' : WALLET_TOKENS.hairline}`,
      position: 'relative', overflow: 'hidden',
      display: 'flex', flexDirection: 'column',
    }}>
      {pack.badge && (
        <div style={{ marginBottom: 10 }}>
          <Pill tone={pack.badgeStyle === 'vp' ? 'gold' : pack.badgeStyle === 'popular' ? 'violet' : 'neutral'} size="sm">
            {pack.badge}
          </Pill>
        </div>
      )}
      {/* Coin-pack graphic — /public/brand/packs/<id>-pack.webp */}
      <div style={{ height: 116, display: 'grid', placeItems: 'center', marginBottom: 6 }}>
        <img
          src={`/brand/packs/${pack.id}-pack.webp`}
          alt={pack.name}
          draggable={false}
          onError={(e) => { e.currentTarget.style.display = 'none'; }}
          style={{
            maxHeight: 110, maxWidth: '88%', objectFit: 'contain',
            filter: pack.badgeStyle === 'vp'
              ? 'drop-shadow(0 8px 22px rgba(123,31,255,0.40))'
              : 'drop-shadow(0 8px 22px rgba(240,165,0,0.30))',
          }}
        />
      </div>
      <div style={{ fontFamily: 'Syne, sans-serif', fontWeight: 700, fontSize: 16, marginBottom: 6 }}>
        {pack.name}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <CoinGlyph size={26} />
        <span className="font-dmmono tabular-nums" style={{ fontSize: 22, fontWeight: 700, color: WALLET_TOKENS.goldLight }}>
          {fmtNum(pack.coins)}
        </span>
      </div>
      {pack.vpBonus > 0 && (
        <div style={{ fontSize: 12, color: WALLET_TOKENS.goldLight, marginBottom: 8 }}>
          + {fmtNum(pack.vpBonus)} VP bonus
        </div>
      )}
      <div style={{ fontSize: 12, color: WALLET_TOKENS.textMuted, lineHeight: 1.4, marginBottom: 16, flex: 1 }}>
        {pack.tagline}
      </div>
      <div style={{ marginBottom: 12 }}>
        <PriceQuote
          quote={quote}
          fallback={(
            <span className="font-dmmono tabular-nums" style={{ fontSize: 22, fontWeight: 700 }}>
              <LocalPrice eur={pack.priceEUR} fallback={fmtEUR(pack.priceEUR)} />
            </span>
          )}
        />
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        {/* Add is the primary action now: the basket is what makes this a
            storefront rather than a row of one-click payment triggers. Buy now
            stays for the single-pack case, which is most purchases. */}
        <button
          onClick={onAdd}
          disabled={busy}
          style={{
            flex: 1, padding: '11px 12px', borderRadius: 10, cursor: busy ? 'not-allowed' : 'pointer',
            background: 'rgba(255,255,255,0.06)', border: `1px solid ${WALLET_TOKENS.hairline}`,
            color: WALLET_TOKENS.text, font: 'inherit', fontWeight: 700, fontSize: 13,
          }}
        >
          Add
        </button>
        <div style={{ flex: 1 }}>
          <WalletButton variant="primary" full disabled={busy} onClick={onBuy}>Buy now</WalletButton>
        </div>
      </div>
    </div>
  );
}

function TabBtn({ active, children, onClick }) {
  return (
    <button onClick={onClick} style={{
      padding: '8px 16px', borderRadius: 8, fontSize: 13, fontWeight: 600, height: 36,
      background: active ? WALLET_TOKENS.surface1 : 'transparent',
      color: active ? WALLET_TOKENS.text : WALLET_TOKENS.textSecondary,
      border: `1px solid ${active ? WALLET_TOKENS.hairlineStrong : 'transparent'}`,
      cursor: 'pointer',
    }}>{children}</button>
  );
}
