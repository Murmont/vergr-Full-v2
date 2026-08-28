// The two non-coin tabs of the shop: VP bonuses and Boosts.
//
// Lives here rather than inside BuyScreen so `/wallet/buy`, its native mirror and
// `/prestige` all render the SAME cards. A second implementation of a shop card
// is how two surfaces start disagreeing about a price.
import { useState } from 'react';
import { getFunctions, httpsCallable } from 'firebase/functions';

import { useUser } from '../../context/UserContext';
import { useUI } from '../../context/UIContext';
import { VP_BONUS_PACKS, formatDuration, bonusArt } from '../../utils/vpBonuses';
import { BOOSTS, boostInventory, formatBoostDuration, boostArt } from '../../utils/boosts';
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
 * VP bonus packs. Violet, because violet is already the VP tone on this screen:
 * COIN_PACKS with `badgeStyle: 'vp'` render violet today.
 *
 * ⚠ COINS ONLY, and there is deliberately no VP price. A VP-priced VP multiplier
 * is an infinite loop — see docs/VP_BONUS_PACKS_PLAN.md §11.2.
 */
export function BonusPacksTab({ compact = false }) {
  const { wallet } = useUser();
  const { showToast } = useUI();
  const [busy, setBusy] = useState(null);
  const coins = Number(wallet?.balance) || 0;

  const buy = async (pack) => {
    if (busy) return;
    setBusy(pack.id);
    try {
      await call('purchaseVpBonus')({ packId: pack.id });
      showToast(`${pack.name} started. ${pack.mult}x VP for ${formatDuration(pack.hours)}.`, 'success');
    } catch (e) {
      // The server owns every refusal (funds, too many running), so its message
      // is shown rather than a guess made here.
      showToast(e?.message || 'Could not start that bonus.', 'error');
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <Grid compact={compact}>
        {VP_BONUS_PACKS.map((p) => {
          const afford = coins >= p.coins;
          return (
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
              price={<><CoinIcon size={15} />{p.coins}</>}
              note={afford ? undefined : `${p.coins - coins} more coins needed`}
              disabled={!afford}
              busy={busy === p.id}
              onClick={() => buy(p)}
              ariaLabel={`Buy ${p.name} for ${p.coins} coins`}
            />
          );
        })}
      </Grid>
      <Note>
        A bonus starts the moment you buy it and runs down in real time, so start one
        when you are about to play. Bonuses add up on top of each other to a maximum
        of 3x, and your plan and rank multiply on top of that. Fourteen levels on the
        VP ladder hand you one free.
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
  const [busy, setBusy] = useState(null);
  const coins = Number(wallet?.balance) || 0;
  const inv = boostInventory(wallet);

  const buy = async (boost) => {
    if (busy) return;
    setBusy(boost.id);
    try {
      await call('purchaseBoostPack')({ boostId: boost.id, qty: 1 });
      showToast(`${boost.name} added to your boosts.`, 'success');
    } catch (e) {
      showToast(e?.message || 'Could not buy that boost.', 'error');
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <Grid compact={compact}>
        {BOOSTS.map((b) => {
          const owned = inv[b.id] || 0;
          const afford = coins >= b.coins;
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
              price={<><CoinIcon size={15} />{b.coins}</>}
              note={afford ? undefined : `${b.coins - coins} more coins needed`}
              disabled={!afford}
              busy={busy === b.id}
              onClick={() => buy(b)}
              ariaLabel={`Buy ${b.name} for ${b.coins} coins`}
            />
          );
        })}
      </Grid>
      <Note>
        Boosts are kept in your wallet until you use them. Apply one from the post,
        profile, squad or live stream you want to boost — your own or anyone
        else’s. Boosts on the same thing add up and extend each other.
      </Note>
    </>
  );
}
