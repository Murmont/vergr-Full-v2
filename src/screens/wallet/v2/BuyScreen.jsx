// Buy coins (v2) — web + desktop + mobile-web presentation.
// The native APK uses NativeBuyScreen (separate file). Both share ONE checkout
// implementation via useBuyCheckout (money flow — never duplicated).
//   • 8 fixed COIN_PACKS as the headline + a Custom amount tab ($10 floor)
//   • PayRam checkout opens in a popup window; we poll until settle, credit
//     lands via the wallet snapshot. No redirect URL needed.

import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { COIN_PACKS, packValueBonusPct, MIN_SHOWN_VALUE_BONUS_PCT } from '../../../utils/vpSystem';

// ONE LADDER, EVERYWHERE. A pack is the same product whichever rail pays for it,
// which is what lets the Play IAP product and this shelf agree exactly on what
// is being sold. Google's store fee shows up as a higher PRICE on the Play row
// of the basket's payment picker, never as fewer coins here.
// Fee model + the reasoning: src/utils/storePricing.js.
const ACTIVE_COIN_PACKS = COIN_PACKS;
import {
  WalletCard, WalletButton, SectionLabel, FeeBreakdown,
  // fmtEUR is deliberately NOT imported. Coins are natively USD and fmtEUR is a
  // EUR->local CONVERTER, so importing it here is how A27 happened. Use fmtUsd
  // for charged amounts, and <LocalPrice usd=... /> for an estimate beside them.
  CoinGlyph, WALLET_TOKENS, fmtNum, fmtUsd, AnimatedNumber,
} from '../../../components/wallet/primitives';
import { useUI } from '../../../context/UIContext';
import { useBuyCheckout, MIN_CUSTOM_USD, COIN_PRICE_USD } from './buyCheckout';
import Icon from '../../../components/Icon';
import LocalPrice from '../../../components/LocalPrice';
import { hasLocalEstimate } from '../../../utils/currency';
import PriceQuote from '../../../components/wallet/PriceQuote';
import { BonusPacksTab, BoostsTab } from '../../../components/wallet/StoreTabs';
import { useCart } from '../../../context/CartContext';
import { useUser } from '../../../context/UserContext';
import useAppGate, { codaOfferedTo } from '../../../hooks/useAppGate';
import { CodaCheckoutBlock } from '../../../components/wallet/CodaPay';
import { IS_STORE_BUILD } from '../../../utils/platform';
import useResponsive from '../../../hooks/useResponsive';
import { getCoinPriceQuote } from '../../../firebase/firestore';
import { useActiveCoinPromo, promoBonusForPack } from '../../../utils/coinPromo';

export default function BuyScreen() {
  const { showToast } = useUI();
  const [tab, setTab] = useState('packs');
  // USD, not EUR. The ladder was re-denominated to native USD on 2026-08-11 and
  // this state kept its old name, which is what caused the custom-amount panel
  // to show four different prices for one purchase (audit A27): the name led
  // the chips into fmtEUR, which CONVERTS EUR to local currency and so inflated
  // every label by the live FX rate.
  const [customUSD, setCustomUSD] = useState(20);
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

  // Tapping a pack ADDS IT AND OPENS THE BASKET. It used to jump straight to the
  // payment provider, which skipped the one screen carrying the fee breakdown,
  // the payment-method choice and the refund terms, and left the buyer no way to
  // change their mind without backing out of a live checkout.
  //
  // Almost nobody buys two packs at once, so the basket is really a confirm
  // step. Treating it as one is both the clearer flow and the thing an
  // underwriter expects to see before money moves.
  const buyPack = (pack) => {
    cart.add(pack.id, 1);
    openCart();
  };



  // ARRIVING FROM THE QUICK-BUY DRAWER.
  //
  // `/wallet/buy?pack=pro` means the user already chose, in the drawer, from a
  // row showing the coins and the price. Making them choose again here would
  // throw away the impulse the drawer exists to catch, so checkout opens
  // straight away.
  //
  // The param is consumed once (replace, not push) so a refresh or a back
  // gesture does not relaunch a payment window the user has finished with.
  useEffect(() => {
    const sku = new URLSearchParams(window.location.search).get('pack');
    if (!sku) return;
    const pack = ACTIVE_COIN_PACKS.find((p) => p.id === sku);
    window.history.replaceState({}, '', '/wallet/buy');
    // Into the basket, which shows the local payment methods and the full price
    // before anything is paid (PayRam is hidden, founder 2026-09-25).
    if (pack) buyPack(pack);
  }, []);

  const customCoins = Math.floor((parseFloat(customUSD) || 0) / COIN_PRICE_USD);
  // The website sells through Codapay (PayRam hidden). Custom amounts too.
  const { profile } = useUser();
  const appGate = useAppGate();
// !IS_STORE_BUILD first: a compile-time false on Play/AppGallery, so the store
  // bundle drops the Coda checkout entirely instead of shipping it unreachable.
  const codaOn = !IS_STORE_BUILD && codaOfferedTo(appGate, profile);

  // The active coin sale, if any. Read from the server so the badge can never
  // promise a bonus the server will not credit, and so a promo that has hit its
  // cap stops advertising itself.
  const promo = useActiveCoinPromo();

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
        <TabBtn active={tab === 'bonuses'} onClick={() => setTab('bonuses')}>VP bonuses</TabBtn>
        <TabBtn active={tab === 'boosts'} onClick={() => setTab('boosts')}>Boosts</TabBtn>
      </div>

      {tab === 'packs' && (
        <div className="vg-walletBuy-grid" style={{
          display: 'grid', gap: 12,
          gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
        }}>
          {ACTIVE_COIN_PACKS.map(p => (
            <PackCard key={p.id} pack={p} promo={promo}
              quote={ladder?.packs?.[p.id]}
              busy={checkout?.status === 'waiting'}
              onAdd={() => addToCart(p)}
              onBuy={() => buyPack(p)} />
          ))}
        </div>
      )}

      {tab === 'custom' && (
        <CustomTab usd={customUSD} setUsd={setCustomUSD}
          busy={checkout?.status === 'waiting'}
          codaOn={codaOn}
          profile={profile}
          onCodaSettled={(s) => showToast(`Added ${Number(s?.coins || 0).toLocaleString()} coins to your wallet!`, 'success')}
          onContinue={() => startCheckout({ customCoins }, `${fmtNum(customCoins)} coins`)} />
      )}

      {/* Same cards as the coin packs, different tone. StoreTabs is shared with
          /prestige so the two surfaces cannot drift apart. */}
      {tab === 'bonuses' && <BonusPacksTab />}
      {tab === 'boosts' && <BoostsTab />}

      {checkout && (
        <CheckoutOverlay checkout={checkout} onCancel={cancelCheckout} />
      )}

      {/* The basket is GlobalCartDrawer (AppRouter), which serves every page.
          This screen used to mount a second copy, so on /wallet/buy two baskets
          stacked on top of each other. */}
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

// EVERY FIGURE ON THIS PANEL IS USD. It is the live checkout, so the rule is
// the one stated on fmtUsd in primitives.jsx: never format a charged amount in
// a currency it will not be charged in.
//
// Audit A27 — this panel showed FOUR different numbers for one purchase
// ($23.06 chip / €20 input / $20.00 "You pay" / $19.99 CTA). Causes, all fixed
// here, and worth knowing before touching it again:
//
//   1. The state was still called `eur` after the 2026-08-11 re-denomination to
//      native USD, so the chips were passed to `fmtEUR`. Despite the name that
//      is a CONVERTER, not a formatter: it reads its argument as EUR and
//      returns local currency, inflating a USD 20 into "$23.06".
//   2. The input carried a hardcoded `€` in front of a USD number.
//   3. The processing-fee line ran through `fmtEUR` too (this one is not in the
//      audit write-up, it was found while fixing the rest).
//   4. "You pay" echoed the amount TYPED, but you are charged for whole coins,
//      and `coins` is floored. $20 buys 1574 coins = $19.99. So the CTA's
//      $19.99 was RIGHT and "You pay" was the wrong one — the opposite of what
//      the audit assumed. "You pay" now reads from the server quote.
// PayRam is hidden (founder, 2026-09-25); its server stays. Flip to show it again.
const SHOW_PAYRAM = false;

function CustomTab({ usd, setUsd, onContinue, busy, codaOn, profile, onCodaSettled }) {
  // Re-quoted as the amount changes, debounced so dragging the slider does not
  // fire a call per pixel. The quote is the ONLY source of the charged figure.
  const [customQuote, setCustomQuote] = useState(null);
  const usdNum = parseFloat(usd) || 0;
  const coins = Math.floor(usdNum / COIN_PRICE_USD);
  const valid = usdNum >= MIN_CUSTOM_USD;

  // What the card is actually charged: the server's quote once it lands, and
  // until then the floored catalogue value, which is what you are buying and
  // already accounts for the rounding that made "You pay" wrong. Never the
  // raw typed amount.
  const chargedUsd = customQuote ? Number(customQuote.amountUSD) : coins * COIN_PRICE_USD;
  const procFee = chargedUsd * 0.015; // illustrative card-processor fee (3rd party)

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
          <button key={n} onClick={() => setUsd(n)} style={{
            padding: '8px 14px', borderRadius: 10, fontSize: 13, fontWeight: 600,
            background: usd === n ? WALLET_TOKENS.violet : WALLET_TOKENS.surface2,
            color: usd === n ? '#fff' : WALLET_TOKENS.textSecondary,
            border: `1px solid ${usd === n ? WALLET_TOKENS.violet : WALLET_TOKENS.hairlineStrong}`,
            cursor: 'pointer',
          }}>{fmtUsd(n)}</button>
        ))}
      </div>
      <div style={{ position: 'relative', marginBottom: 14 }}>
        <span style={{
          position: 'absolute', left: 18, top: '50%', transform: 'translateY(-50%)',
          fontSize: 28, fontWeight: 700, color: WALLET_TOKENS.goldLight,
          fontFamily: 'DM Mono, monospace',
        }}>$</span>
        <input value={usd}
          onChange={(e) => setUsd(e.target.value.replace(/[^\d.]/g, ''))}
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

      {!valid && usd && (
        <div style={{ marginTop: 12, fontSize: 12, color: '#FCD34D' }}>
          Minimum is {fmtUsd(MIN_CUSTOM_USD)} (set by our card processor).
        </div>
      )}

      {/* Codapay: this amount's local methods and full prices, and the form in
          place. Minimum unchanged. */}
      {(!IS_STORE_BUILD && codaOn) ? (
        valid ? (
          <CodaCheckoutBlock
            payload={{ customCoins: coins }}
            profile={profile}
            onSettled={onCodaSettled}
          />
        ) : null
      ) : SHOW_PAYRAM ? (
        <>
      <FeeBreakdown
        items={[
          { label: 'You pay',                  value: fmtUsd(chargedUsd) },
          { label: 'Payment processing (~1.5%)', value: `-${fmtUsd(procFee)}`, tone: 'muted' },
          { label: 'VERGR fee',                value: fmtUsd(0), tone: 'muted' },
        ]}
        total={`${fmtNum(coins)} coins`}
        totalLabel="You receive"
      />

      {/* The charged figure, quoted by the server with the live FX rate already
          applied, so it matches the statement. This and the "You pay" row above
          are now the SAME number by construction: both read `chargedUsd`, which
          is this quote once it lands. They used to disagree by the rounding to
          whole coins. */}
      {valid && (
        <div style={{ marginTop: 10 }}>
          <PriceQuote
            quote={customQuote}
            size="sm"
            fallback={hasLocalEstimate(chargedUsd) ? (
              <div style={{ fontSize: 11, color: WALLET_TOKENS.textMuted }}>
                <LocalPrice usd={chargedUsd} prefix="≈ " /> · charged in USD
              </div>
            ) : null}
          />
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 20 }}>
        <WalletButton variant="primary" size="lg" disabled={!valid || busy}
          icon="credit_card" iconRight="arrow_forward" onClick={onContinue}>
          Continue to checkout
        </WalletButton>
      </div>
        </>
      ) : (
        <div style={{ marginTop: 16, background: '#1C1C2B', borderRadius: 12, padding: '12px 14px', fontSize: 13, color: WALLET_TOKENS.textSecondary }}>
          Buying on the web is not open yet. You can buy coins in the Vergr Android app.
        </div>
      )}
    </WalletCard>
  );
}

/**
 * Badge colours. SOLID fills, not tinted glass.
 *
 * The old badge was a translucent pill sitting in the content flow, which on a
 * near-black card was almost invisible and did nothing to pull the eye toward
 * the packs worth buying. A badge is a merchandising device: it should be the
 * brightest thing on the card and it should sit on the top edge where the eye
 * lands first.
 */
const BADGE_TONES = {
  popular: { bg: '#7B1FFF', fg: '#FFFFFF' },
  value: { bg: '#F0A500', fg: '#141018' },
  vp: { bg: '#C87FFF', fg: '#141018' },
  hot: { bg: '#F04060', fg: '#FFFFFF' },
};

/**
 * A coin pack on the shelf.
 *
 * ## Why this got rebuilt
 *
 * The old card was `#14141F` on a `#0B0B14` page with a 1px hairline: two
 * near-blacks and no light source, so the card read as a hole cut into the page
 * rather than an object sitting on it. Everything below is in service of making
 * it look like something you would pick up.
 *
 * - A lit surface. A warm top-down gradient plus a tinted rim, so the card has a
 *   direction the light comes from.
 * - A solid badge straddling the top edge, centred, in the tier's colour.
 * - Coin count centred under the artwork with the real coin glyph, large.
 * - The honest value line ("+10% more coins per euro"), shown only where the
 *   difference is big enough to be worth reading.
 * - A distinct footer bar for the price, which is what separates a product card
 *   from a panel of text.
 * - The whole card is the buy target. Two equal buttons made a shelf item look
 *   like a settings row; the basket moves to a quiet "+" in the corner.
 */
function PackCard({ pack, onBuy, onAdd, busy, quote, promo }) {
  // What THIS pack gets from the active sale. The server decides whether the
  // pack qualifies; this only mirrors that decision for display.
  const sale = promoBonusForPack(promo, pack);
  const tone = BADGE_TONES[pack.badgeStyle] || BADGE_TONES.popular;
  const isVp = pack.badgeStyle === 'vp';
  const accent = isVp ? WALLET_TOKENS.violetLight : WALLET_TOKENS.gold;
  const valueBonus = packValueBonusPct(pack);
  const showValue = valueBonus >= MIN_SHOWN_VALUE_BONUS_PCT;

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => !busy && onBuy()}
      onKeyDown={(e) => { if (!busy && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); onBuy(); } }}
      style={{
        position: 'relative', borderRadius: 18, overflow: 'hidden',
        display: 'flex', flexDirection: 'column',
        cursor: busy ? 'not-allowed' : 'pointer',
        // Lit from the top, tinted by the tier. This is the whole difference
        // between "bright and vibrant" and "dark and moody".
        background: isVp
          ? 'linear-gradient(180deg, #2A1B44 0%, #1B1430 46%, #171126 100%)'
          : 'linear-gradient(180deg, #2E2417 0%, #1D1826 46%, #171420 100%)',
        border: `1px solid ${isVp ? 'rgba(180,79,255,0.34)' : 'rgba(240,165,0,0.26)'}`,
        boxShadow: '0 10px 28px rgba(0,0,0,0.42)',
        paddingTop: pack.badge ? 20 : 14,
      }}
    >
      {/* Warm bloom behind the artwork, so the illustration sits in light
          rather than on a flat panel. */}
      <div aria-hidden style={{
        position: 'absolute', top: -70, left: '50%', transform: 'translateX(-50%)',
        width: 240, height: 190, pointerEvents: 'none',
        background: `radial-gradient(ellipse at center, ${isVp ? 'rgba(180,79,255,0.30)' : 'rgba(240,165,0,0.26)'} 0%, transparent 70%)`,
      }} />

      {pack.badge && (
        <div style={{
          position: 'absolute', top: 0, left: '50%', transform: 'translateX(-50%)',
          background: tone.bg, color: tone.fg,
          padding: '3px 12px', borderRadius: '0 0 10px 10px',
          fontSize: 10, fontWeight: 800, letterSpacing: '0.06em',
          textTransform: 'uppercase', whiteSpace: 'nowrap',
          boxShadow: '0 4px 12px rgba(0,0,0,0.35)',
        }}>
          {pack.badge}
        </div>
      )}

      {/* FIXED SQUARE BOX. Every illustration is normalised to the same optical
          size by scripts/packArt.mjs, and width/height are explicit so the grid
          never reflows while they load. */}
      <div style={{ position: 'relative', display: 'grid', placeItems: 'center', padding: '6px 0 2px' }}>
        <img
          src={`/brand/packs/${pack.id}-pack.webp`}
          alt=""
          width={132}
          height={132}
          draggable={false}
          loading="eager"
          onError={(e) => { e.currentTarget.style.visibility = 'hidden'; }}
          style={{
            width: 132, height: 132, objectFit: 'contain',
            filter: `drop-shadow(0 10px 20px ${isVp ? 'rgba(123,31,255,0.45)' : 'rgba(240,165,0,0.34)'})`,
          }}
        />
      </div>

      <div style={{ position: 'relative', padding: '0 16px 14px', textAlign: 'center' }}>
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7, marginBottom: 2,
        }}>
          <CoinGlyph size={26} />
          <span className="font-dmmono tabular-nums" style={{ fontSize: 25, fontWeight: 800, color: '#FFFFFF' }}>
            {fmtNum(pack.coins)}
          </span>
        </div>

        {/* The reason to buy the bigger pack, stated. */}
        {showValue && (
          <div style={{ fontSize: 12, fontWeight: 700, color: accent, marginBottom: 4 }}>
            {valueBonus}% More
          </div>
        )}

        {pack.vpBonus > 0 && (
          <div style={{ fontSize: 11.5, fontWeight: 700, color: WALLET_TOKENS.violetLight, marginBottom: 4 }}>
            +{fmtNum(pack.vpBonus)} VP
          </div>
        )}

        {/* Sale bonus. The NUMBER comes from the server (getActiveCoinPromo),
            never computed here, so what the card promises is by construction
            what the server will credit. Per reference-client-side-price-constant
            the client is told, it does not decide. */}
        {sale && (
          <div style={{
            display: 'inline-block', marginBottom: 5, padding: '2px 9px', borderRadius: 999,
            fontSize: 11.5, fontWeight: 800,
            background: '#123A22', color: '#4ADE80',
          }}>
            +{fmtNum(sale.amount)} {sale.unit} free
          </div>
        )}

        <div style={{ fontSize: 11.5, color: 'rgba(255,255,255,0.52)', lineHeight: 1.4 }}>
          {pack.name}
        </div>
      </div>

      {/* Footer bar. A product card has a price shelf; a panel of text does not. */}
      <div style={{
        position: 'relative', marginTop: 'auto',
        background: 'rgba(0,0,0,0.30)',
        borderTop: '1px solid rgba(255,255,255,0.07)',
        padding: '11px 14px',
        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
      }}>
        <PriceQuote
          quote={quote}
          fallback={(
            <span className="font-dmmono tabular-nums" style={{ fontSize: 17, fontWeight: 800, color: '#FFFFFF' }}>
              <LocalPrice usd={pack.priceUSD} fallback={fmtUsd(pack.priceUSD)} />
            </span>
          )}
        />
      </div>

      {/* The basket, quietly. The card itself is the buy action, so this must
          not steal the tap: hence the stopPropagation. */}
      <button
        onClick={(e) => { e.stopPropagation(); if (!busy) onAdd(); }}
        disabled={busy}
        aria-label={`Add ${pack.name} to basket`}
        title="Add to basket"
        style={{
          position: 'absolute', top: pack.badge ? 26 : 10, right: 10,
          width: 30, height: 30, borderRadius: 9,
          display: 'grid', placeItems: 'center',
          background: 'rgba(0,0,0,0.34)', border: '1px solid rgba(255,255,255,0.14)',
          color: '#FFFFFF', cursor: busy ? 'not-allowed' : 'pointer', padding: 0,
        }}
      >
        <Icon name="add_shopping_cart" size={15} />
      </button>
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
