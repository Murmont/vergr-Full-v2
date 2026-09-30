// src/components/wallet/CartDrawer.jsx
//
// The basket: slides in from the right over whatever page you are on (desktop,
// and in the app the buy screen and streams), without navigating.
//
// A drawer rather than a route on desktop because the buying flow is "add,
// glance, keep browsing, add another". Sending someone to a separate URL after
// each tap turns eight packs into eight page loads. Mobile does the opposite
// (a full page at /wallet/cart) because a drawer on a 390px screen is just a
// page with less room and a worse close target.
import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import Icon from '../Icon';
import CartContents from './CartContents';
import { useCart } from '../../context/CartContext';
import { WALLET_TOKENS } from './primitives';

export default function CartDrawer({ onCheckout, busy, onCodaSettled }) {
  const { open, setOpen, count } = useCart();

  // Escape closes. A panel that traps you is worse than no panel.
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, setOpen]);

  if (!open) return null;

  // PORTALLED to <body>. The wallet shell sets backdrop-filter in places, which
  // makes an ancestor a containing block for position:fixed and would pin this
  // to a column instead of the viewport.
  return createPortal(
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 200, display: 'flex', justifyContent: 'flex-end' }}
      onClick={() => setOpen(false)}
    >
      {/* A plain dim behind the drawer. No blur: blurred glass is banned here. */}
      <div style={{ position: 'absolute', inset: 0, background: 'rgba(5,5,10,0.72)' }} />

      <aside
        onClick={(e) => e.stopPropagation()}
        style={{
          position: 'relative', width: 'min(420px, 100vw)', height: '100%',
          background: WALLET_TOKENS.surface1,
          display: 'flex', flexDirection: 'column',
          // Full height, so on a phone it must clear the status bar and the
          // gesture bar (the app draws edge to edge). Both are 0 on desktop.
          padding: 'calc(18px + env(safe-area-inset-top, 0px)) 20px calc(20px + var(--vg-safe-b, 0px))',
          color: WALLET_TOKENS.text,
          animation: 'vgCartIn 180ms ease-out',
        }}
      >
        <style>{'@keyframes vgCartIn{from{transform:translateX(24px);opacity:0}to{transform:none;opacity:1}}'}</style>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <h2 style={{ fontSize: 17, fontWeight: 800, display: 'flex', alignItems: 'center', gap: 8 }}>
            <Icon name="shopping_cart" size={20} />
            Your basket
            {count > 0 && (
              <span
                className="font-dmmono tabular-nums"
                style={{
                  fontSize: 11, fontWeight: 800, padding: '2px 7px', borderRadius: 999,
                  background: WALLET_TOKENS.gold, color: '#141018',
                }}
              >
                {count}
              </span>
            )}
          </h2>
          <button
            onClick={() => setOpen(false)}
            aria-label="Close basket"
            style={{ background: 'none', border: 0, cursor: 'pointer', color: WALLET_TOKENS.textMuted, padding: 4 }}
          >
            <Icon name="close" size={20} />
          </button>
        </div>

        <CartContents onCheckout={onCheckout} busy={busy} onClose={() => setOpen(false)} variant="drawer" onCodaSettled={onCodaSettled} />
      </aside>
    </div>,
    document.body,
  );
}
