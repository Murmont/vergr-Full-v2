// Apply a boost — the one sheet, opened from wherever the content is.
//
// ⚠ IT MUST NEVER SEND YOU AWAY. Founder, 2026-08-28: *"if I am on a stream I
// won't want to leave the stream in order to purchase more coins."* So this
// sheet does all three steps in place: spend a boost you own, buy one you don't,
// and top up coins if you are short. Navigating to /wallet/buy mid-stream is the
// thing it exists to avoid.
//
// The three states of one row:
//   own >= 1        -> "Use" (spends inventory, applies immediately)
//   own 0, afford   -> "Buy 50c" (quick purchase, stays open, becomes "Use")
//   own 0, short    -> "Add coins" (opens the cart here, still no navigation)
import { useState } from 'react';
import { getFunctions, httpsCallable } from 'firebase/functions';

import { useUser } from '../../context/UserContext';
import { useUI } from '../../context/UIContext';
import { useCart } from '../../context/CartContext';
import {
  boostsForTarget, boostCount, formatBoostDuration, boostArt,
} from '../../utils/boosts';
import { COIN_PACKS } from '../../utils/vpSystem';
import Icon from '../Icon';
import { CoinIcon } from '../CoinIcon';

const call = (n) => httpsCallable(getFunctions(undefined, 'europe-west1'), n);

const C = {
  card: '#14141F', soft: '#1A1A2A', line: 'rgba(255,255,255,0.08)',
  text: '#fff', dim: '#9CA3AF', muted: '#6B7280',
  ember: '#F04060', emberSoft: 'rgba(240,64,96,0.16)',
  violet: '#7B1FFF', violetLight: '#B44FFF',
};

/** Smallest pack that covers the shortfall, so the nudge is never oversized. */
const packFor = (coinsShort) =>
  [...COIN_PACKS].sort((a, b) => a.coins - b.coins).find((p) => p.coins >= coinsShort)
  || COIN_PACKS[COIN_PACKS.length - 1];

function Row({ boost, owned, coins, busy, onUse, onBuy, onTopUp }) {
  const afford = coins >= boost.coins;
  const working = busy === boost.id;
  return (
    <div style={{
      display: 'flex', gap: 12, alignItems: 'center', padding: 12,
      borderRadius: 14, background: 'rgba(255,255,255,0.035)',
      boxShadow: `inset 0 0 0 1px ${C.line}`,
    }}>
      <div style={{
        width: 46, height: 46, borderRadius: 12, flexShrink: 0,
        display: 'grid', placeItems: 'center', position: 'relative',
        background: 'radial-gradient(120% 120% at 30% 20%, rgba(240,64,96,0.30), rgba(10,10,18,0.9) 70%)',
      }}>
        <img
          src={boostArt(boost)}
          alt=""
          onError={(e) => { e.currentTarget.style.display = 'none'; }}
          style={{ width: '100%', height: '100%', objectFit: 'contain', borderRadius: 12 }}
        />
        {owned > 0 && (
          <span style={{
            position: 'absolute', top: -5, right: -5, minWidth: 18, height: 18,
            padding: '0 5px', borderRadius: 999, background: C.ember, color: '#fff',
            fontSize: 10, fontWeight: 800, display: 'grid', placeItems: 'center',
          }}>{owned}</span>
        )}
      </div>

      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ color: C.text, fontWeight: 800, fontSize: 14 }}>{boost.name}</div>
        <div style={{ color: C.dim, fontSize: 12, marginTop: 2 }}>
          {boost.short} · {formatBoostDuration(boost.minutes)}
        </div>
      </div>

      {owned > 0 ? (
        <button
          type="button" disabled={!!busy} onClick={() => onUse(boost)}
          style={{
            padding: '9px 16px', borderRadius: 11, border: 'none', flexShrink: 0,
            background: `linear-gradient(135deg, ${C.ember}, #FF6B84)`,
            color: '#fff', fontSize: 13, fontWeight: 800,
            cursor: busy ? 'not-allowed' : 'pointer',
          }}
        >{working ? '…' : 'Use'}</button>
      ) : afford ? (
        <button
          type="button" disabled={!!busy} onClick={() => onBuy(boost)}
          style={{
            padding: '9px 14px', borderRadius: 11, border: 'none', flexShrink: 0,
            display: 'inline-flex', alignItems: 'center', gap: 5,
            background: 'rgba(255,255,255,0.08)', color: C.text,
            fontSize: 13, fontWeight: 800, cursor: busy ? 'not-allowed' : 'pointer',
          }}
        >{working ? '…' : (<><CoinIcon size={13} />{boost.coins}</>)}</button>
      ) : (
        <button
          type="button" disabled={!!busy} onClick={() => onTopUp(boost)}
          style={{
            padding: '9px 14px', borderRadius: 11, border: 'none', flexShrink: 0,
            background: C.emberSoft, color: C.ember,
            fontSize: 12, fontWeight: 800, cursor: 'pointer', whiteSpace: 'nowrap',
          }}
        >Add coins</button>
      )}
    </div>
  );
}

/**
 * @param {'post'|'user'|'squad'|'stream'} target
 * @param {string} targetId
 * @param {string} [targetLabel] what the sheet says you are boosting
 * @param {boolean} [isLfg] a post that is a looking-for-teammates post
 */
/**
 * ⚠ `embedded` renders the rows ONLY — no scrim, no fixed positioning, no
 * close button. The live-stream gift menu is already a sheet with its own
 * backdrop and its own dismiss, and nesting a second fixed overlay inside it
 * gives two stacked scrims and two competing click-to-close targets. That is
 * the same note BoostPanel carried before this replaced it.
 */
export default function BoostSheet({
  target, targetId, targetLabel, isLfg = false, embedded = false, onClose, onApplied,
}) {
  const { wallet } = useUser();
  const { showToast } = useUI();
  const cart = useCart();
  const [busy, setBusy] = useState(null);
  const [topUp, setTopUp] = useState(null);

  // Boost coins (rewarded ads) spend here first, server-side: functions/boostCoins.js.
  const coins = (Number(wallet?.balance) || 0) + (Number(wallet?.boostCoins) || 0);

  // A post takes either the normal or the teammate boost, never both — spending
  // the wrong one is a refund conversation, so it is not offered.
  const list = boostsForTarget(target).filter((b) =>
    target !== 'post' ? true : (!!b.postType === !!isLfg));

  const use = async (boost) => {
    if (busy) return;
    setBusy(boost.id);
    try {
      await call('applyBoost')({ boostId: boost.id, targetId });
      showToast(`${boost.name} applied for ${formatBoostDuration(boost.minutes)}.`, 'success');
      onApplied?.(boost);
      onClose?.();
    } catch (e) {
      showToast(e?.message || 'Could not apply that boost.', 'error');
    } finally { setBusy(null); }
  };

  const buy = async (boost) => {
    if (busy) return;
    setBusy(boost.id);
    try {
      await call('purchaseBoostPack')({ boostId: boost.id, qty: 1 });
      // Deliberately stays open. The wallet snapshot updates the count in place,
      // so the row becomes "Use" and the next tap applies it — two taps total,
      // without ever leaving the stream.
      showToast(`${boost.name} added to your boosts.`, 'success');
    } catch (e) {
      showToast(e?.message || 'Could not buy that boost.', 'error');
    } finally { setBusy(null); }
  };

  const startTopUp = (boost) => setTopUp({ boost, pack: packFor(boost.coins - coins) });

  // The rows, shared by both modes.
  const body = (
    <>
      {!topUp && (
        <>
          <div style={{ display: 'grid', gap: 8 }}>
            {list.map((b) => (
              <Row
                key={b.id}
                boost={b}
                owned={boostCount(wallet, b.id)}
                coins={coins}
                busy={busy}
                onUse={use}
                onBuy={buy}
                onTopUp={startTopUp}
              />
            ))}
          </div>
          <p style={{ color: C.muted, fontSize: 11, margin: '12px 0 0', lineHeight: 1.5 }}>
            You have {coins.toLocaleString()} coins. Boosts you buy are kept in your
            wallet until you use them, and can be applied to anyone’s content.
          </p>
        </>
      )}

      {/* ⚠ Topping up happens HERE. Sending the user to /wallet/buy from a live
          stream means leaving the stream in order to spend money on it. */}
      {topUp && (
        <div>
          <button
            onClick={() => setTopUp(null)}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 5, marginBottom: 12,
              background: 'none', border: 'none', color: C.dim, fontSize: 12,
              fontWeight: 700, cursor: 'pointer', padding: 0,
            }}
          >
            <Icon name="arrow_back" size={14} /> Back to boosts
          </button>
          <div style={{
            padding: 14, borderRadius: 14, background: C.soft,
            boxShadow: `inset 0 0 0 1px ${C.line}`,
          }}>
            <div style={{ color: C.text, fontWeight: 800, fontSize: 14 }}>
              {topUp.pack.coins.toLocaleString()} coins
            </div>
            <div style={{ color: C.dim, fontSize: 12, marginTop: 3 }}>
              Enough for {topUp.boost.name} ({topUp.boost.coins} coins) with
              {' '}{(topUp.pack.coins - (topUp.boost.coins - coins)).toLocaleString()} left over.
            </div>
            <button
              onClick={() => { cart.add?.(topUp.pack.id, 1); cart.setOpen?.(true); onClose?.(); }}
              style={{
                width: '100%', marginTop: 12, padding: 13, borderRadius: 12, border: 'none',
                background: `linear-gradient(135deg, ${C.violet}, ${C.violetLight})`,
                color: '#fff', fontSize: 13, fontWeight: 800, cursor: 'pointer',
              }}
            >
              Add to basket · ${topUp.pack.priceUSD}
            </button>
          </div>
        </div>
      )}
    </>
  );

  if (embedded) return body;

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 400, background: 'rgba(0,0,0,0.72)',
        display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%', maxWidth: 460, background: C.card,
          borderTopLeftRadius: 18, borderTopRightRadius: 18,
          padding: 20, paddingBottom: 'calc(var(--vg-safe-b, 0px) + 20px)',
          boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.07)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3 }}>
          <Icon name="rocket_launch" size={17} style={{ color: C.ember }} />
          <span className="font-syne" style={{ color: C.text, fontWeight: 800, fontSize: 16 }}>
            Boost
          </span>
        </div>
        <p style={{ color: C.dim, fontSize: 12.5, margin: '0 0 14px', lineHeight: 1.45 }}>
          {targetLabel
            ? `Put ${targetLabel} in front of more people.`
            : 'Put this in front of more people.'}
        </p>

        {body}

        <button
          onClick={onClose}
          style={{
            width: '100%', marginTop: 12, padding: 13, borderRadius: 12, border: 'none',
            background: 'rgba(255,255,255,0.05)', color: C.dim,
            fontSize: 13, fontWeight: 800, cursor: 'pointer',
          }}
        >Close</button>
      </div>
    </div>
  );
}
