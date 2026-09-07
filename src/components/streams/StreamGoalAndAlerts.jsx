// StreamGoalAndAlerts — two live-stream overlay primitives shared by the
// broadcaster (/broadcast/:id) and viewer (/watch/:id) screens.
//
//   <StreamGoalBar goal={streamDoc.goal} />
//       Frosted tip-goal progress bar. Reads streams/{id}.goal =
//       { active, targetCoins, reason, currentCoins }. Fills violet→pink→gold
//       as viewers tip; celebratory pulse when the goal is reached. Renders
//       nothing when no active goal.
//
//   <TipAlertOverlay lastTip={streamDoc.lastTip} anchor="bottom" />
//       Animated "NAME tipped N coins" card. Driven entirely by
//       streams/{id}.lastTip = { coins, fromName, ts } — which the viewer
//       tip path stamps on every successful tip. Both screens already
//       subscribe to the stream doc, so this is crowd-visible at ZERO extra
//       reads. Auto-dismisses; only the latest tip is shown.
//
// Palette matches BroadcasterScreen / ViewerStreamScreen inline tokens.

import { useEffect, useRef, useState } from 'react';
import { CoinIcon } from '../CoinIcon';
import { motion, AnimatePresence } from 'framer-motion';
import Icon from '../Icon';

const C = {
  card: '#12121e',
  border: 'rgba(255,255,255,0.10)',
  text: '#e8e8f0',
  textDim: '#a0a0b8',
  purple: '#7c3aed',
  purpleLight: '#b44fff',
  amber: '#F0A500',
  amberLight: '#F5C842',
};

// ⚠ COINS ARE DRAWN WITH THE BRAND COIN. This was `CoinGem`, a hand-drawn
// five-point STAR polygon standing in for a coin on the goal bar and the tip
// alert — so a 250-coin tip read "★ 250". Same defect as the Material "paid"
// glyph: a currency rendered as something that is not the currency.
const CoinGem = ({ size = 14 }) => <CoinIcon size={size} />;

// ─────────────────────────────────────────────────────────────
// StreamGoalBar
// ─────────────────────────────────────────────────────────────
export function StreamGoalBar({ goal, compact = false, style }) {
  if (!goal || !goal.active || !(goal.targetCoins > 0)) return null;
  const current = Math.max(0, goal.currentCoins || 0);
  const target = Math.max(1, goal.targetCoins || 1);
  const pct = Math.min(100, Math.round((current / target) * 100));
  const reached = current >= target;

  return (
    <div
      style={{
        width: '100%',
        // ⚠ SOLID, AND THE BORDER ONLY WHEN IT MEANS SOMETHING. At 0.66 over live
        // gameplay this bar changed colour with the frame behind it, and its hairline
        // was brighter than its own fill — the stroke separating it instead of a real
        // value step. The amber edge stays, because THAT one carries information (the
        // goal is reached); the neutral one is gone.
        background: '#100C1C',
        border: reached ? `1px solid ${C.amber}` : 'none',
        borderRadius: compact ? 10 : 12,
        padding: compact ? '7px 10px' : '9px 12px',
        boxShadow: reached ? `0 0 18px ${C.amber}44` : 'none',
        ...style,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
        <CoinGem size={compact ? 12 : 14} />
        <span style={{ fontSize: compact ? 10 : 11, fontWeight: 800, letterSpacing: '0.04em', color: C.text }}>
          {reached ? 'GOAL REACHED' : 'TIP GOAL'}
        </span>
        {goal.reason && (
          <span style={{
            fontSize: compact ? 10 : 11, color: C.textDim, fontWeight: 600,
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', flex: 1, minWidth: 0,
          }}>· {goal.reason}</span>
        )}
        <span style={{
          marginLeft: 'auto', fontSize: compact ? 10 : 11, fontWeight: 800,
          fontFamily: 'DM Mono, ui-monospace, monospace', color: reached ? C.amberLight : C.text,
        }}>
          {current.toLocaleString()} / {target.toLocaleString()}
        </span>
      </div>
      <div style={{
        position: 'relative', height: compact ? 6 : 8, borderRadius: 99,
        // ⚠ A SOLID GROOVE. The bar around it is opaque now, so a white wash for the
        // track just picked up whatever was behind the panel and read as haze.
        background: '#2A2A38', overflow: 'hidden',
      }}>
        <motion.div
          initial={false}
          animate={{ width: `${pct}%` }}
          transition={{ type: 'spring', stiffness: 120, damping: 22 }}
          style={{
            position: 'absolute', inset: 0, borderRadius: 99,
            background: reached
              ? `linear-gradient(90deg, ${C.amber}, ${C.amberLight})`
              : `linear-gradient(90deg, ${C.purple}, ${C.purpleLight}, ${C.amber})`,
            boxShadow: `0 0 10px ${reached ? C.amber : C.purpleLight}66`,
          }}
        />
        {/* moving shimmer */}
        {!reached && pct > 0 && (
          <motion.div
            animate={{ x: ['-30%', '130%'] }}
            transition={{ duration: 2.2, repeat: Infinity, ease: 'linear' }}
            style={{
              position: 'absolute', top: 0, bottom: 0, width: '28%',
              background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.45), transparent)',
            }}
          />
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// TipAlertOverlay
// ─────────────────────────────────────────────────────────────
// `lastTip` = { coins, fromName, ts } | null. We render a card whenever `ts`
// advances past the last one we showed, then auto-dismiss after `holdMs`.
// ⚠ ANCHORED AT THE BOTTOM BY DEFAULT NOW. At the top it landed on the host
// capsule and the viewer/close controls — the founder saw a tip pill sitting
// across Riven's name. `bottom` mirrors JoinAnnouncer's prop of the same name
// so a surface with a 30vh chat dock can lift the alert clear of the messages
// instead of covering the newest ones.
export function TipAlertOverlay({ lastTip, anchor = 'top', holdMs = 4500, bottom = 90 }) {
  const [shown, setShown] = useState(null);
  const seenTsRef = useRef(0);
  const timerRef = useRef(0);

  useEffect(() => {
    const ts = lastTip?.ts || 0;
    if (!ts || ts <= seenTsRef.current) return;
    // Ignore stale tips on first mount (older than 12s) so a page refresh
    // mid-stream doesn't replay an old alert.
    seenTsRef.current = ts;
    if (Date.now() - ts > 12_000) return;
    setShown({ ...lastTip, key: ts });
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setShown(null), holdMs);
  }, [lastTip?.ts, holdMs, lastTip]);

  useEffect(() => () => clearTimeout(timerRef.current), []);

  const pos = anchor === 'top'
    ? { top: 14, left: '50%', transform: 'translateX(-50%)' }
    : { bottom, left: '50%', transform: 'translateX(-50%)' };

  const big = (shown?.coins || 0) >= 500;

  return (
    <div style={{ position: 'absolute', zIndex: 40, pointerEvents: 'none', ...pos }}>
      <AnimatePresence>
        {shown && (
          <motion.div
            key={shown.key}
            initial={{ opacity: 0, y: anchor === 'top' ? -24 : 24, scale: 0.85 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: anchor === 'top' ? -16 : 16, scale: 0.9 }}
            transition={{ type: 'spring', stiffness: 360, damping: 24 }}
            style={{
              display: 'flex', alignItems: 'center', gap: 9,
              padding: big ? '10px 16px' : '8px 14px',
              borderRadius: 999,
              background: big
                ? `linear-gradient(135deg, ${C.amber}, ${C.amberLight})`
                : 'rgba(10,10,20,0.82)',
              backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)',
              border: `1px solid ${big ? '#fff6' : C.amber + '88'}`,
              boxShadow: big ? `0 0 26px ${C.amber}88` : `0 4px 18px rgba(0,0,0,0.4)`,
              color: big ? '#1a1205' : C.text,
              fontFamily: '"DM Sans", system-ui, sans-serif',
              whiteSpace: 'nowrap', maxWidth: '88vw',
            }}
          >
            <motion.span
              animate={big ? { rotate: [0, -12, 12, 0] } : {}}
              transition={{ duration: 0.6, repeat: big ? Infinity : 0, repeatDelay: 0.5 }}
              style={{ display: 'inline-flex' }}
            >
              <Icon name="volunteer_activism" size={big ? 18 : 15} className="" />
            </motion.span>
            <span style={{ fontSize: big ? 14 : 12.5, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis' }}>
              <strong>{shown.fromName || 'Someone'}</strong> tipped
            </span>
            <span style={{
              display: 'inline-flex', alignItems: 'center', gap: 4,
              fontSize: big ? 15 : 13, fontWeight: 800,
              fontFamily: 'DM Mono, ui-monospace, monospace',
              color: big ? '#1a1205' : C.amberLight,
            }}>
              <CoinGem size={big ? 15 : 12} />
              {(shown.coins || 0).toLocaleString()}
            </span>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// SubAlertOverlay — the "just subscribed" stream alert (design D1).
// Driven by streams/{id}.lastSub = { tierName, fromName, badge:{color,icon}, ts },
// stamped server-side by subscribeMembership when the creator is live. Same
// zero-extra-reads model as TipAlertOverlay (screens already watch the stream doc).
// ─────────────────────────────────────────────────────────────
export function SubAlertOverlay({ lastSub, anchor = 'bottom', holdMs = 5200, bottom = 90 }) {
  const [shown, setShown] = useState(null);
  const seenTsRef = useRef(0);
  const timerRef = useRef(0);

  useEffect(() => {
    const ts = lastSub?.ts || 0;
    if (!ts || ts <= seenTsRef.current) return;
    seenTsRef.current = ts;
    if (Date.now() - ts > 12_000) return; // don't replay an old alert on refresh
    setShown({ ...lastSub, key: ts });
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setShown(null), holdMs);
  }, [lastSub?.ts, holdMs, lastSub]);

  useEffect(() => () => clearTimeout(timerRef.current), []);

  const color = shown?.badge?.color || C.purpleLight;
  const pos = anchor === 'top'
    ? { top: 16, left: 16 }
    : { bottom, left: 16 };

  return (
    <div style={{ position: 'absolute', zIndex: 41, pointerEvents: 'none', ...pos }}>
      <AnimatePresence>
        {shown && (
          <motion.div
            key={shown.key}
            initial={{ opacity: 0, x: -60, scale: 0.9 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            exit={{ opacity: 0, x: -24, scale: 0.94 }}
            transition={{ type: 'spring', stiffness: 320, damping: 22 }}
            style={{
              position: 'relative', overflow: 'hidden',
              display: 'flex', alignItems: 'center', gap: 12,
              padding: '8px 14px 8px 9px', borderRadius: 13,
              background: `linear-gradient(100deg, ${C.purple}, ${color})`,
              boxShadow: `0 12px 34px ${color}88`,
              fontFamily: '"DM Sans", system-ui, sans-serif', maxWidth: '86vw',
            }}
          >
            {/* sheen sweep */}
            <motion.div
              initial={{ x: '-160%' }} animate={{ x: '160%' }}
              transition={{ duration: 1.2, repeat: Infinity, repeatDelay: 1.6, ease: 'easeInOut' }}
              style={{ position: 'absolute', inset: 0, background: 'linear-gradient(100deg,transparent 35%,rgba(255,255,255,0.32) 50%,transparent 65%)', pointerEvents: 'none' }}
            />
            <span style={{
              position: 'relative', zIndex: 1, width: 30, height: 30, flex: 'none',
              borderRadius: '36%', display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: `radial-gradient(125% 125% at 30% 22%, #fff, ${color})`,
              border: '2px solid rgba(255,255,255,0.85)', boxShadow: 'inset 0 2px 3px rgba(255,255,255,0.6)',
            }}>
              <Icon name={shown.badge?.icon || 'star'} filled size={16} style={{ color: '#fff', textShadow: '0 1px 2px rgba(0,0,0,0.3)' }} />
            </span>
            <div style={{ position: 'relative', zIndex: 1, color: '#fff' }}>
              <div style={{ fontWeight: 800, fontSize: 13 }}>{shown.fromName || 'Someone'}</div>
              <div style={{ fontSize: 11, opacity: 0.94 }}>just subscribed · <strong>{shown.tierName || 'Member'}</strong></div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default StreamGoalBar;
