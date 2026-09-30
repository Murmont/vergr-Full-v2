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
import { useState, useEffect } from 'react';
import { getFunctions, httpsCallable } from 'firebase/functions';

import { useUser } from '../../context/UserContext';
import { useUI } from '../../context/UIContext';
import { useCart } from '../../context/CartContext';
import { useAuth } from '../../context/AuthContext';
import { VP_BONUS_PACKS, formatDuration, bonusArt } from '../../utils/vpBonuses';
import { BOOSTS, boostInventory, formatBoostDuration, boostArt } from '../../utils/boosts';
import { bonusSku, boostSku, usd } from '../../utils/storeItems';
import { isPlayBillingSupported, buyStoreItem, fetchPlayPrices } from '../../utils/nativeBilling';
import StorePackCard from './StorePackCard';
import { CoinIcon } from '../CoinIcon';
import { WALLET_TOKENS, Modal } from './primitives';
import Icon from '../Icon';
import { GooglePlayPrism } from './PaymentMethodPicker';

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
 * ⚠⚠ THE BUYER CHOOSES THE RAIL. THIS HOOK DOES NOT. Founder, 2026-09-11:
 * *"the user should be able to choose to buy with the coins they have, or with
 * money."*
 *
 * The previous version decided for them and offered no way back: a wallet that
 * covered the price spent coins and never showed Play, and a wallet that did not
 * went to Play and never showed coins. Neither branch was reachable from the
 * other. The card printed both prices, which made it LOOK like a choice, so the
 * one thing it taught the buyer was wrong.
 *
 * Tapping a card now opens `PayChoice`. `pay()` below is the only thing that
 * moves money, and it takes the rail as an argument.
 */
function useStoreBuy({ coinBuy, skuFor, labelFor, entries = [] }) {
  const { wallet } = useUser();
  const { currentUser } = useAuth();
  const { showToast } = useUI();
  const { add, setOpen } = useCart();
  const [busy, setBusy] = useState(null);
  const [choosing, setChoosing] = useState(null);
  // Boost coins (rewarded ads) spend here first, server-side: functions/boostCoins.js.
  const coins = (Number(wallet?.balance) || 0) + (Number(wallet?.boostCoins) || 0);
  const playAvailable = isPlayBillingSupported();

  // On the Play build the cash price is GOOGLE's localised string, fetched once
  // per tab. Printing our own USD figure beside "Pay with Google Play" shows a
  // number that can differ from Google's sheet, which is the mismatch the Play
  // coin packs already avoid.
  const [playPrices, setPlayPrices] = useState({});
  const skuKey = entries.map(skuFor).join(',');
  useEffect(() => {
    if (!playAvailable || !skuKey) return undefined;
    let alive = true;
    fetchPlayPrices(skuKey.split(',')).then((m) => { if (alive) setPlayPrices(m || {}); }).catch(() => {});
    return () => { alive = false; };
  }, [playAvailable, skuKey]);
  // ⚠ On the Play app never fall back to our USD: Google charges its own (higher)
  // price, so our figure would show less than the sheet charges. Blank until it loads.
  const cashFor = (entry) => (playAvailable
    ? (playPrices[skuFor(entry)]?.price || '')
    : usd(entry.priceUSD));

  /** Open the chooser. Nothing is charged here. */
  const buy = (entry) => { if (!busy) setChoosing(entry); };

  const pay = async (entry, method) => {
    if (busy) return;
    setBusy(entry.id);
    setChoosing(null);
    try {
      // ── COINS ─────────────────────────────────────────────────────
      // Cheapest for the buyer, and the reason to hold coins at all. The
      // server re-checks the balance, so a stale wallet read cannot overdraw.
      if (method === 'coins') {
        await coinBuy(entry);
        return;
      }

      const sku = skuFor(entry);

      // ── CASH, PLAY BUILD ──────────────────────────────────────────
      // Google collects, the server verifies the token and grants the item
      // through the same helper the coin path uses.
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
   * The shelf shows the price the buyer is most likely to pay, with the other
   * one under it. Both are always present: a shelf that prints one price and
   * charges in a currency the buyer did not expect is the surprise this avoids.
   */
  const priceProps = (entry) => {
    const affordable = coins >= entry.coins;
    return {
      price: affordable
        ? <><CoinIcon size={15} />{entry.coins}</>
        : <>{cashFor(entry)}</>,
      secondary: affordable
        ? (cashFor(entry) ? <>or {cashFor(entry)}</> : null)
        : <>or <CoinIcon size={12} />{entry.coins}</>,
      note: 'Choose how to pay',
      ariaLabel: cashFor(entry)
        ? `Buy ${entry.name}, ${entry.coins} coins or ${cashFor(entry)}`
        : `Buy ${entry.name}, ${entry.coins} coins`,
    };
  };

  const chooser = (
    <PayChoice
      entry={choosing}
      cash={choosing ? cashFor(choosing) : ''}
      coins={coins}
      playAvailable={playAvailable}
      onPick={pay}
      onClose={() => setChoosing(null)}
    />
  );

  return { buy, busy, priceProps, coins, chooser };
}

/**
 * How do you want to pay. Two rails, both always visible, so the buyer can see
 * the one they are not taking and why.
 *
 * ⚠ THE COINS ROW IS SHOWN EVEN WHEN THE WALLET IS SHORT, disabled, naming the
 * shortfall. Hiding it is what made the old flow feel like it had decided for
 * you, and the shortfall is the one number that tells a buyer coins are worth
 * topping up.
 *
 * Solid fills only. No hairline-on-transparent "glass" rows: see the Appearance
 * panel ruling in CLAUDE.md.
 */
function PayChoice({ entry, cash, coins, playAvailable, onPick, onClose }) {
  if (!entry) return null;
  const short = Math.max(0, entry.coins - coins);
  const canCoins = short === 0;

  const Row = ({ disabled, onClick, icon, title, sub, amount }) => (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      style={{
        display: 'grid', gridTemplateColumns: '34px minmax(0,1fr) auto',
        gap: 12, alignItems: 'center', width: '100%', textAlign: 'left',
        padding: '13px 14px', borderRadius: 12, border: 0,
        background: disabled ? WALLET_TOKENS.surface2 : '#20203A',
        color: disabled ? WALLET_TOKENS.textMuted : WALLET_TOKENS.text,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.6 : 1, font: 'inherit',
      }}
    >
      <span style={{
        width: 34, height: 34, borderRadius: 9, display: 'grid', placeItems: 'center',
        background: disabled ? 'transparent' : WALLET_TOKENS.surface1,
      }}>{icon}</span>
      <span style={{ minWidth: 0 }}>
        <span style={{ display: 'block', fontWeight: 700, fontSize: 14 }}>{title}</span>
        <span style={{ display: 'block', fontSize: 11.5, color: WALLET_TOKENS.textSecondary }}>{sub}</span>
      </span>
      <span style={{
        fontFamily: 'DM Mono, monospace', fontWeight: 500, fontSize: 15,
        fontVariantNumeric: 'tabular-nums', display: 'flex', alignItems: 'center', gap: 4,
      }}>{amount}</span>
    </button>
  );

  return (
    <Modal open onClose={onClose} width={420} title={entry.name}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <Row
          disabled={!canCoins}
          onClick={() => onPick(entry, 'coins')}
          icon={<CoinIcon size={19} />}
          title="Pay with coins"
          sub={canCoins
            ? `You have ${coins.toLocaleString()}`
            : `You need ${short.toLocaleString()} more`}
          amount={<><CoinIcon size={14} />{entry.coins.toLocaleString()}</>}
        />
        <Row
          onClick={() => onPick(entry, 'cash')}
          icon={playAvailable ? <GooglePlayPrism size={19} /> : <Icon name="shopping_bag" size={19} />}
          title={playAvailable ? 'Pay with Google Play' : 'Pay with money'}
          sub={playAvailable ? 'Card or whatever Play has on file' : 'Adds it to your basket'}
          amount={cash}
        />
      </div>
    </Modal>
  );
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

  const { buy, busy, priceProps, chooser } = useStoreBuy({
    skuFor: (p) => bonusSku(p.id),
    entries: VP_BONUS_PACKS,
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
      {chooser}
      <Note>
        A bonus starts the moment you buy it and runs down in real time, so start one
        when you are about to post, stream or watch. Bonuses add up on top of each other to a maximum
        of 3x, and your plan and rank multiply on top of that. Fourteen levels on the
        VP ladder hand you one free. Tap a pack and pick how to pay: coins if you
        have them, or money. Coins are the cheaper of the two.
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

  const { buy, busy, priceProps, chooser } = useStoreBuy({
    skuFor: (b) => boostSku(b.id),
    entries: BOOSTS,
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
      {chooser}
      <Note>
        Boosts are kept in your wallet until you use them. Apply one from the post,
        profile, squad or live stream you want to boost — your own or anyone
        else’s. Boosts on the same thing add up and extend each other. Tap a boost
        and pick how to pay: coins if you have them, or money. Coins are cheaper.
      </Note>
    </>
  );
}
