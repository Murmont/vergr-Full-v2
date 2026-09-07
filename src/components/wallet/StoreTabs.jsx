// The two non-coin tabs of the shop: VP bonuses and Boosts.
//
// Lives here rather than inside BuyScreen so `/wallet/buy`, its native mirror and
// `/prestige` all render the SAME cards. A second implementation of a shop card
// is how two surfaces start disagreeing about a price.
//
// ══ TWO PRICES, AND NO DEAD CARDS ═══════════════════════════════════
//
// Founder, 2026-08-28, on finding every card greyed out: *"What does my balance
// have to do with the opacity? ... we cant create a design that prevents the
// user from checking out if they are already there and willing to pay."*
//
// Every item now carries BOTH a coin price and a cash price, so there is nothing
// a card can be dimmed for:
//
//   wallet covers the coin price  →  buy with coins, instantly, in place
//   wallet does not               →  the cash price, through the rail this
//                                    build actually has
//
// The rail differs by build and that is a platform fact, not a choice:
//   Play build  →  Play Billing sheet (the item is an IAP, `vpb_*` / `boost_*`)
//   web/desktop →  the basket, which is the card rail with its fee lines
//
// ⚠ Google Play Billing is an ANDROID-APP API. `isPlayBillingSupported()` is
// true only when the Kotlin bridge exists. A browser has no bridge, so the Play
// row is correctly unavailable there and no amount of Play Console
// configuration changes it. See docs/play/BOOST_BONUS_PRICING_PLAN.md §3.
//
// ⚠⚠ THE CASH PRICE IS NEVER DERIVED FROM THE COIN PRICE. Pricing an item at
// `playPriceFor(its coin count)` put a 75-coin bonus at $1.09, exactly what a
// 78-coin pack costs. Nobody buys that, and it says a coin is worth nothing. The
// rule lives in src/utils/storeItems.js and the numbers are mirrored server-side.
import { useState } from 'react';
import { getFunctions, httpsCallable } from 'firebase/functions';

import { useUser } from '../../context/UserContext';
import { useUI } from '../../context/UIContext';
import { useCart } from '../../context/CartContext';
import { useAuth } from '../../context/AuthContext';
import { VP_BONUS_PACKS, formatDuration, bonusArt } from '../../utils/vpBonuses';
import { BOOSTS, boostInventory, formatBoostDuration, boostArt } from '../../utils/boosts';
import { bonusSku, boostSku, usd } from '../../utils/storeItems';
import { isPlayBillingSupported, buyStoreItem } from '../../utils/nativeBilling';
import StorePackCard from './StorePackCard';
import { CoinIcon } from '../CoinIcon';
import { WALLET_TOKENS } from './primitives';

const call = (name) => httpsCallable(getFunctions(undefined, 'europe-west1'), name);

/**
 * Shared grid so every tab lays out identically to the coin packs.
 *
 * `compact` is the NATIVE layout: a fixed 2-up that renders two columns at any
 * width with no media query, matching NativePackCard on the same screen. The
 * auto-fill default would collapse to one column on a phone and look nothing
 * like the coin packs sitting one tab away.
 */
function Grid({ children, compact }) {
  return (
    <div className={compact ? undefined : 'vg-walletBuy-grid'} style={{
      display: 'grid', gap: compact ? 10 : 12,
      gridTemplateColumns: compact
        ? 'repeat(2, minmax(0, 1fr))'
        : 'repeat(auto-fill, minmax(240px, 1fr))',
    }}>
      {children}
    </div>
  );
}

function Note({ children }) {
  return (
    <p style={{
      color: WALLET_TOKENS.textMuted, fontSize: 11.5, lineHeight: 1.5,
      margin: '14px 0 0',
    }}>{children}</p>
  );
}

/**
 * One buy decision, shared by both tabs, because the rule must not be able to
 * differ between a bonus and a boost.
 *
 * Returns everything a card needs to render and act, so neither tab decides
 * anything about payment for itself.
 */
function useStoreBuy({ coinBuy, skuFor, labelFor }) {
  const { wallet } = useUser();
  const { currentUser } = useAuth();
  const { showToast } = useUI();
  const { add, setOpen } = useCart();
  const [busy, setBusy] = useState(null);
  const coins = Number(wallet?.balance) || 0;
  const playAvailable = isPlayBillingSupported();

  const buy = async (entry) => {
    if (busy) return;
    setBusy(entry.id);
    try {
      // ── COINS ─────────────────────────────────────────────────────
      // The wallet covers it, so spend it. Cheapest for the buyer and it is the
      // reason to hold coins at all.
      if (coins >= entry.coins) {
        await coinBuy(entry);
        return;
      }

      const sku = skuFor(entry);

      // ── CASH, PLAY BUILD ──────────────────────────────────────────
      // Straight to the Play sheet: Google collects, the server verifies the
      // token and grants the item through the same helper the coin path uses.
      if (playAvailable) {
        await buyStoreItem(sku, currentUser?.uid);
        showToast(`${entry.name} is yours.`, 'success');
        return;
      }

      // ── CASH, WEB ─────────────────────────────────────────────────
      // Into the basket, which is where the card rail and its fee lines live.
      // Deliberately NOT a redirect straight to a payment page: the founder's
      // rule is that fees are added at the checkout, and the checkout is the
      // basket.
      add(sku, 1);
      setOpen(true);
      showToast(`${entry.name} added to your basket.`, 'success');
    } catch (e) {
      if (e?.code === 'cancelled' || e?.code === 'canceled') return;
      // The server owns every refusal (funds, too many running), so its message
      // is shown rather than a guess made here.
      showToast(e?.message || labelFor(entry), 'error');
    } finally {
      setBusy(null);
    }
  };

  /**
   * Which price is the big one, and what the quiet line underneath says.
   *
   * Both are always shown. A shelf that prints one price and charges in a
   * currency the buyer did not expect is exactly the surprise this avoids.
   */
  const priceProps = (entry) => {
    const affordable = coins >= entry.coins;
    return {
      price: affordable
        ? <><CoinIcon size={15} />{entry.coins}</>
        : <>{usd(entry.priceUSD)}</>,
      secondary: affordable
        ? <>or {usd(entry.priceUSD)}</>
        : <>or <CoinIcon size={12} />{entry.coins}</>,
      note: affordable
        ? undefined
        : (playAvailable ? 'Pay with Google Play' : 'Adds to your basket'),
      ariaLabel: affordable
        ? `Buy ${entry.name} for ${entry.coins} coins`
        : `Buy ${entry.name} for ${usd(entry.priceUSD)}`,
    };
  };

  return { buy, busy, priceProps, coins };
}

/**
 * VP bonus packs. Violet, because violet is already the VP tone on this screen:
 * COIN_PACKS with `badgeStyle: 'vp'` render violet today.
 *
 * ⚠ THERE IS NO VP PRICE AND NONE MAY BE ADDED. A VP-priced VP multiplier is an
 * infinite loop: price it above what it returns and nobody buys it, below and VP
 * inflates without limit. See docs/VP_BONUS_PACKS_PLAN.md §11.2. Coins and cash
 * only.
 */
export function BonusPacksTab({ compact = false }) {
  const { showToast } = useUI();

  const { buy, busy, priceProps } = useStoreBuy({
    skuFor: (p) => bonusSku(p.id),
    labelFor: () => 'Could not start that bonus.',
    coinBuy: async (p) => {
      await call('purchaseVpBonus')({ packId: p.id });
      showToast(`${p.name} started. ${p.mult}x VP for ${formatDuration(p.hours)}.`, 'success');
    },
  });

  return (
    <>
      <Grid compact={compact}>
        {VP_BONUS_PACKS.map((p) => (
          <StorePackCard
            key={p.id}
            toneId="violet"
            art={bonusArt(p)}
            artSrcSet={bonusArt(p, true)}
            fallback={`${p.mult}x`}
            headline={`${p.mult}x VP`}
            pill={formatDuration(p.hours)}
            name={p.name}
            badge={Array.isArray(p.scope) ? 'Focused' : undefined}
            busy={busy === p.id}
            onClick={() => buy(p)}
            {...priceProps(p)}
          />
        ))}
      </Grid>
      <Note>
        A bonus starts the moment you buy it and runs down in real time, so start one
        when you are about to play. Bonuses add up on top of each other to a maximum
        of 3x, and your plan and rank multiply on top of that. Fourteen levels on the
        VP ladder hand you one free. Pay with coins if you have them; the price in
        coins is always the cheaper of the two.
      </Note>
    </>
  );
}

/**
 * Boosts. Ember, deliberately the hottest of the three tones so a boost never
 * reads as a coin pack at a glance.
 *
 * ⚠ THIS TAB SELLS INVENTORY, IT DOES NOT FIRE A BOOST. Founder, 2026-08-28:
 * boosts are tokens you keep. Buying adds to `wallets/{uid}.boosts`; you apply
 * one later from the post, profile, squad or stream itself — yours or anyone
 * else's. The previous version made you choose a target at checkout, which is
 * why there was nothing to own and nowhere to see it.
 *
 * ⚠ ONE CATALOGUE. `src/utils/boosts.js` replaced BOOST_COSTS and BOOST_TIERS,
 * which had drifted into two products both called "Stream Boost" at two prices.
 */
export function BoostsTab({ compact = false }) {
  const { wallet } = useUser();
  const { showToast } = useUI();
  const inv = boostInventory(wallet);

  const { buy, busy, priceProps } = useStoreBuy({
    skuFor: (b) => boostSku(b.id),
    labelFor: () => 'Could not buy that boost.',
    coinBuy: async (b) => {
      await call('purchaseBoostPack')({ boostId: b.id, qty: 1 });
      showToast(`${b.name} added to your boosts.`, 'success');
    },
  });

  return (
    <>
      <Grid compact={compact}>
        {BOOSTS.map((b) => {
          const owned = inv[b.id] || 0;
          return (
            <StorePackCard
              key={b.id}
              toneId="ember"
              art={boostArt(b)}
              artSrcSet={boostArt(b, true)}
              fallback={formatBoostDuration(b.minutes).replace(' ', '')}
              headline={formatBoostDuration(b.minutes)}
              pill={b.short}
              name={b.name}
              badge={owned > 0 ? `You have ${owned}` : undefined}
              busy={busy === b.id}
              onClick={() => buy(b)}
              {...priceProps(b)}
            />
          );
        })}
      </Grid>
      <Note>
        Boosts are kept in your wallet until you use them. Apply one from the post,
        profile, squad or live stream you want to boost — your own or anyone
        else’s. Boosts on the same thing add up and extend each other. Pay with
        coins if you have them; the price in coins is always the cheaper of the two.
      </Note>
    </>
  );
}
