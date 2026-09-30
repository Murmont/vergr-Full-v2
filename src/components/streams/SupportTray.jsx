// SupportTray: the right-edge tab on the phone viewer and the tray it opens.
//
// Founder, 2026-09-10: "there should be a sort of line tag that can be clicked
// or pulled left on the right side of the screen which opens a tray". Before
// this a phone viewer could not subscribe to the creator while watching at all,
// and could gift a sub only by tapping one person in chat.
//
// PURE: props only, no Firestore, no context. The real viewer passes what it
// loaded and the admin preview passes its mock tiers, so there is one
// definition of the tray and the two cannot drift.
//
// ⚠ TAP IS THE PRIMARY GESTURE, THE PULL IS A BONUS. Android gesture navigation
// claims any swipe that STARTS in the right-edge back zone (about 20dp), so a
// pull that begins at the very edge goes to the system, not to us. The hit area
// reaches inward past that zone, and a plain tap always opens the tray.
//
// ⚠ EVERY POINTER EVENT STOPS HERE. The video underneath turns a tap into a
// like and toggles focus mode; a tap on the tab must do neither.
import { useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import Icon from '../Icon';
import UserAvatar from '../UserAvatar';
import { CoinIcon } from '../CoinIcon';

const T = {
  panel: '#12101E', row: '#1A1A2A', tab: '#100C1C',
  text: '#e8e8f0', dim: '#a0a0b8', muted: '#6b7280',
  purple: '#7c3aed', purpleLight: '#b44fff', gold: '#F5C842',
};
const GOLD_RAMP = 'linear-gradient(180deg, #FCEFB4 0%, #F5C842 38%, #E9A517 72%, #C97F12 100%)';
// A pull this far left opens the tray; a drag this far right on the tray closes it.
const PULL_OPEN_PX = 24;
const PUSH_CLOSE_PX = 60;

function TrayRow({ icon, iconColor, title, sub, onClick }) {
  return (
    <button type="button" onClick={onClick} style={{
      display: 'flex', alignItems: 'center', gap: 12, width: '100%', textAlign: 'left',
      padding: 12, borderRadius: 14, border: 'none', cursor: 'pointer', background: T.row, color: T.text,
    }}>
      <span style={{ flexShrink: 0, width: 38, height: 38, borderRadius: 12, background: T.tab, display: 'grid', placeItems: 'center' }}>
        <Icon name={icon} size={20} filled style={{ color: iconColor }} />
      </span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: 'block', fontSize: 14, fontWeight: 800 }}>{title}</span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, color: T.dim, marginTop: 2 }}>{sub}</span>
      </span>
      <Icon name="chevron_right" size={20} style={{ color: T.muted, flexShrink: 0 }} />
    </button>
  );
}

export default function SupportTray({
  open, onOpen, onClose,
  hostName = 'this creator', hostAvatar = null,
  tiers = [],           // the creator's PUBLISHED tiers; the caller hides the tab when empty
  membership = null,    // { tierName } when the viewer already belongs
  onSubscribe, onGiftSubs, onManage,
  top = '40%',
  hideTab = false,      // picture-in-picture or focus mode: hide the tab, keep the state
}) {
  const drag = useRef(null);

  // Escape closes it for anyone on a keyboard.
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const down = (e) => {
    e.stopPropagation();
    drag.current = { x: e.clientX, y: e.clientY, moved: false };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };
  const move = (e) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.x;
    if (Math.abs(dx) > 6 || Math.abs(e.clientY - d.y) > 6) d.moved = true;
    if (dx < -PULL_OPEN_PX && !open) { drag.current = null; onOpen?.(); }
  };
  const up = (e) => {
    e.stopPropagation();
    const d = drag.current;
    drag.current = null;
    if (d && !d.moved) (open ? onClose : onOpen)?.();
  };

  // The cheapest tier is the honest headline; the sheet shows the rest.
  const from = tiers.reduce((m, t) => Math.min(m, Math.max(0, Math.floor(t.priceCoins || 0))), Infinity);

  return (
    <>
      {!hideTab && !open && (
        <button
          type="button" aria-label={`Support ${hostName}`} aria-expanded={open}
          onPointerDown={down} onPointerMove={move} onPointerUp={up}
          onPointerCancel={() => { drag.current = null; }}
          // Pointer taps are handled in `up`; this is the keyboard path only
          // (a keyboard click has detail 0), so a tap never toggles twice.
          onClick={(e) => { e.stopPropagation(); if (e.detail === 0) onOpen?.(); }}
          style={{
            position: 'absolute', right: 0, top, transform: 'translateY(-50%)', zIndex: 12,
            width: 36, height: 84, padding: 0, border: 'none', background: 'transparent',
            cursor: 'pointer', touchAction: 'none',
            display: 'flex', alignItems: 'center', justifyContent: 'flex-end',
          }}
        >
          <span style={{
            width: 22, height: 64, borderRadius: '12px 0 0 12px', background: T.tab,
            boxShadow: '0 4px 14px rgba(0,0,0,0.45)',
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 6,
          }}>
            <Icon name="star" size={12} filled style={{ color: T.gold }} />
            <span style={{ width: 3, height: 26, borderRadius: 999, background: GOLD_RAMP }} />
          </span>
        </button>
      )}

      <AnimatePresence>
        {open && (
          <motion.div
            key="support-scrim"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => { e.stopPropagation(); onClose?.(); }}
            style={{ position: 'absolute', inset: 0, zIndex: 58, background: 'rgba(0,0,0,0.35)' }}
          />
        )}
        {open && (
          <motion.div
            key="support-tray" role="dialog" aria-label={`Support ${hostName}`}
            initial={{ x: '105%' }} animate={{ x: 0 }} exit={{ x: '105%' }}
            transition={{ type: 'spring', stiffness: 420, damping: 40 }}
            drag="x" dragConstraints={{ left: 0, right: 0 }} dragElastic={{ left: 0, right: 0.6 }}
            onDragEnd={(e, info) => { if (info.offset.x > PUSH_CLOSE_PX || info.velocity.x > 400) onClose?.(); }}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
            style={{
              position: 'absolute', right: 0, top, y: '-50%', zIndex: 59,
              width: 'min(82vw, 300px)', padding: '14px 12px 12px',
              background: T.panel, borderRadius: '20px 0 0 20px', color: T.text,
              boxShadow: '-10px 0 30px rgba(0,0,0,0.5)', touchAction: 'pan-y',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '0 2px 12px' }}>
              <UserAvatar src={hostAvatar} size={32} showLiftRing={false} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.08em', color: T.muted }}>SUPPORT</div>
                <div style={{ fontSize: 15, fontWeight: 800, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{hostName}</div>
              </div>
              <button type="button" aria-label="Close" onClick={onClose} style={{
                width: 32, height: 32, borderRadius: '50%', border: 'none', cursor: 'pointer',
                background: T.row, color: T.dim, display: 'grid', placeItems: 'center', flexShrink: 0,
              }}><Icon name="close" size={17} /></button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {membership ? (
                <TrayRow icon="workspace_premium" iconColor={T.gold}
                  title={`You're a ${membership.tierName || 'member'}`}
                  sub="Manage your membership" onClick={onManage} />
              ) : (
                <TrayRow icon="star" iconColor={T.gold} title="Subscribe"
                  sub={Number.isFinite(from)
                    ? <>From <CoinIcon size={12} /> <b style={{ color: T.text, fontVariantNumeric: 'tabular-nums' }}>{from.toLocaleString()}</b> a month</>
                    : 'See the tiers'}
                  onClick={onSubscribe} />
              )}
              <TrayRow icon="redeem" iconColor={T.purpleLight} title="Gift subs"
                sub="A month for viewers you pick" onClick={onGiftSubs} />
            </div>

            <div style={{ fontSize: 11, color: T.muted, lineHeight: 1.45, padding: '10px 4px 0' }}>
              Your own sub renews monthly in coins. A gifted sub lasts one month and does not renew.
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
