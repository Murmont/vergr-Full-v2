// VP bonus packs — the shop, and the countdown for whatever is running.
//
// ⚠ COINS ONLY. Founder, 2026-08-28. There is deliberately no VP price anywhere
// in this file and none may be added: a VP-priced VP multiplier is an infinite
// loop (docs/VP_BONUS_PACKS_PLAN.md §11.2). Packs are ALSO earned free from the
// ladder, which is why the copy says "earn or buy" rather than only selling.
//
// ⚠ Every price and duration comes from VP_BONUS_PACKS, which is mirrored
// server-side and guarded by vp-mirror-check. A card that prints its own numbers
// is how the button and the wallet stop agreeing.
import { useEffect, useState } from 'react';
import { getFunctions, httpsCallable } from 'firebase/functions';

import { useUser } from '../../context/UserContext';
import { useUI } from '../../context/UIContext';
import {
  VP_BONUS_PACKS, VP_BONUS_CEILING, activeBonuses, bonusRemainingMs,
  formatRemaining, formatDuration, bonusArt, bonusPackById,
} from '../../utils/vpBonuses';
import Icon from '../Icon';
import StorePackCard from '../wallet/StorePackCard';
import { CoinIcon } from '../CoinIcon';

const C = {
  line: 'rgba(255,255,255,0.08)',
  dim: '#9CA3AF',
  muted: '#6B7280',
  violet: '#7B1FFF',
  violetLight: '#B44FFF',
};


/** Live countdown on the longest-running bonus. Renders nothing when idle. */
export function BonusTimer({ user, className = '', style }) {
  const [ms, setMs] = useState(() => bonusRemainingMs(user));

  useEffect(() => {
    // Stops itself the moment the last bonus lapses. A timer still ticking on an
    // expired bonus is a wrong number on screen.
    const id = setInterval(() => {
      const left = bonusRemainingMs(user);
      setMs(left);
      if (left <= 0) clearInterval(id);
    }, 1000);
    return () => clearInterval(id);
  }, [user]);

  if (ms <= 0) return null;
  const live = activeBonuses(user);
  const best = live.reduce((m, b) => Math.max(m, Number(b.mult) || 1), 1);
  return (
    <span
      className={className}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 5,
        padding: '3px 9px', borderRadius: 999, fontSize: 11, fontWeight: 800,
        background: `linear-gradient(135deg, ${C.violet}, ${C.violetLight})`,
        color: '#fff', letterSpacing: '0.02em', ...style,
      }}
    >
      <Icon name="bolt" size={11} className="" />
      {best}x VP
      <span style={{ opacity: 0.75, fontVariantNumeric: 'tabular-nums' }}>{formatRemaining(ms)}</span>
    </span>
  );
}

export default function BonusShop() {
  const { profile, wallet } = useUser();
  const { showToast } = useUI();
  const [busy, setBusy] = useState(null);

  const coins = Number(wallet?.balance) || 0;
  const live = activeBonuses(profile);

  const buy = async (pack) => {
    if (busy) return;
    setBusy(pack.id);
    try {
      const call = httpsCallable(getFunctions(undefined, 'europe-west1'), 'purchaseVpBonus');
      await call({ packId: pack.id });
      showToast(`${pack.name} started. ${pack.mult}x VP for ${formatDuration(pack.hours)}.`, 'success');
    } catch (e) {
      // The server owns every refusal (not enough coins, too many running), so
      // its message is shown rather than a guess made here.
      showToast(e?.message || 'Could not start that bonus.', 'error');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div>
      {live.length > 0 && (
        <div
          style={{
            marginBottom: 14, padding: 12, borderRadius: 16,
            background: 'linear-gradient(135deg, rgba(123,31,255,0.20), rgba(180,79,255,0.06))',
            boxShadow: 'inset 0 0 0 1px rgba(180,79,255,0.35)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span className="font-syne" style={{ color: '#fff', fontWeight: 800, fontSize: 14 }}>
              Running now
            </span>
            <BonusTimer user={profile} />
          </div>
          <div style={{ marginTop: 8, display: 'grid', gap: 4 }}>
            {live.map((b, i) => {
              const pack = bonusPackById(b.id);
              return (
                <div key={`${b.id}-${i}`} style={{ color: C.dim, fontSize: 12 }}>
                  {pack?.name || b.id}
                  <span style={{ color: C.muted }}>
                    {' — '}{b.source?.startsWith('level_')
                      ? `earned at level ${b.source.slice(6)}`
                      : 'bought with coins'}
                  </span>
                </div>
              );
            })}
          </div>
          {live.length > 1 && (
            <p style={{ color: C.muted, fontSize: 11, margin: '8px 0 0', lineHeight: 1.45 }}>
              Bonuses add up on top of each other, to a maximum of {VP_BONUS_CEILING}x.
              Your plan and your rank multiply on top of that.
            </p>
          )}
        </div>
      )}

      {/* ⚠ The SAME card the coin packs use, in the violet tone. Founder,
          2026-08-28. Do not hand-roll a second card here. */}
      <div
        style={{
          display: 'grid', gap: 12,
          gridTemplateColumns: 'repeat(auto-fill, minmax(210px, 1fr))',
        }}
      >
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
      </div>

      <p style={{ color: C.muted, fontSize: 11, margin: '12px 0 0', lineHeight: 1.5 }}>
        You have {coins.toLocaleString()} coins. Bonuses start the moment you buy them
        and run down in real time, so start one when you are about to play.
        Fourteen levels on the ladder hand you one free.
      </p>
    </div>
  );
}
