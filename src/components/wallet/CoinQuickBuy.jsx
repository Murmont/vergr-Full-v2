// src/components/wallet/CoinQuickBuy.jsx
//
// The coin balance, and the shelf that opens when you tap it.
//
// ## Why this exists
//
// Buying coins used to require leaving whatever you were doing, navigating to
// /wallet/buy, and coming back. That is fine for someone who set out to top up
// and hopeless for the moment that actually drives most coin sales: you are
// about to tip, or unlock something, and you are short. Every surface that shows
// a balance is a place that moment happens, so every one of them should be able
// to sell.
//
// The full /wallet/buy screen stays exactly as it is. This is the impulse path,
// not a replacement for the shop.
//
// ## Drawer on desktop, sheet on mobile
//
// Deliberately not a route. Sending someone to a page loses the screen they were
// on, which is the thing that made the old flow lossy in the first place. On a
// phone it comes up as a bottom sheet, which is the shape a thumb expects.
import { useState, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import Icon from '../Icon';
import LocalPrice from '../LocalPrice';
import { COIN_PACKS, packValueBonusPct, MIN_SHOWN_VALUE_BONUS_PCT } from '../../utils/vpSystem';
import { useUser } from '../../context/UserContext';
import { WALLET_TOKENS, CoinGlyph, fmtNum, fmtUsd } from './primitives';

/**
 * Which packs the drawer shows.
 *
 * Three, because the drawer is an interruption and a wall of eight is a
 * decision. The entry pack, the one badged MOST POPULAR, and the one badged BEST
 * VALUE, in ladder order. Falls back to the first three if the badges ever move.
 */
function quickPicks() {
  const byBadge = (style) => COIN_PACKS.find((p) => p.badgeStyle === style);
  const picks = [COIN_PACKS[0], byBadge('popular'), byBadge('value')].filter(Boolean);
  const unique = picks.filter((p, i) => picks.findIndex((q) => q.id === p.id) === i);
  return unique.length >= 3 ? unique.slice(0, 3) : COIN_PACKS.slice(0, 3);
}

/**
 * The balance chip. Tapping it opens the shelf.
 *
 * @param {'compact'|'full'} size  compact drops the label, for tight headers
 * @param {function} onOpen        supply to override the default drawer
 */
export function CoinBalancePill({ size = 'full', onOpen }) {
  const { wallet } = useUser();
  const [open, setOpen] = useState(false);
  const compact = size === 'compact';

  return (
    <>
      <button
        onClick={() => (onOpen ? onOpen() : setOpen(true))}
        aria-label="Coins. Tap to buy more."
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 6,
          padding: compact ? '4px 6px 4px 8px' : '5px 6px 5px 10px',
          borderRadius: 999, cursor: 'pointer',
          background: 'rgba(240,165,0,0.12)',
          border: '1px solid rgba(240,165,0,0.28)',
          color: WALLET_TOKENS.text, font: 'inherit',
        }}
      >
        <CoinGlyph size={compact ? 15 : 17} />
        <span className="font-dmmono tabular-nums" style={{ fontSize: compact ? 12 : 13, fontWeight: 800 }}>
          {fmtNum(wallet?.balance || 0)}
        </span>
        {/* The + is the whole point: it says this number is a shop. */}
        <span style={{
          width: compact ? 16 : 18, height: compact ? 16 : 18, borderRadius: '50%',
          display: 'grid', placeItems: 'center',
          background: 'linear-gradient(135deg, #C87FFF 0%, #7B1FFF 100%)',
        }}>
          <Icon name="add" size={compact ? 11 : 12} style={{ color: '#fff' }} />
        </span>
      </button>

      {open && <CoinQuickBuySheet onClose={() => setOpen(false)} />}
    </>
  );
}

/** The shelf itself. Exported so a surface can open it without the pill. */
export function CoinQuickBuySheet({ onClose }) {
  const navigate = useNavigate();
  const { wallet } = useUser();
  const packs = useMemo(quickPicks, []);
  const [busy, setBusy] = useState('');

  // Escape closes it, and the page behind must not scroll while it is open.
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  const buy = async (pack) => {
    if (busy) return;
    setBusy(pack.id);
    // Checkout lives on the wallet screen, which owns the PayRam popup and the
    // settlement polling. Duplicating that here would mean two implementations
    // of the one flow that must never disagree, so this hands off with the pack
    // preselected instead.
    navigate(`/wallet/buy?pack=${encodeURIComponent(pack.id)}`);
    onClose?.();
  };

  return createPortal(
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 1200,
        background: 'rgba(5,5,12,0.72)', backdropFilter: 'blur(4px)',
        display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="vg-quickbuy"
        style={{
          width: '100%', maxWidth: 460,
          background: WALLET_TOKENS.bg,
          borderTop: `1px solid ${WALLET_TOKENS.hairlineStrong}`,
          borderRadius: '20px 20px 0 0',
          padding: '16px 16px calc(20px + env(safe-area-inset-bottom, 0px))',
          color: WALLET_TOKENS.text,
        }}
      >
        <div style={{
          width: 36, height: 4, borderRadius: 2, margin: '0 auto 14px',
          background: 'rgba(255,255,255,0.18)',
        }} />

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
          <div style={{ fontFamily: 'Syne, sans-serif', fontWeight: 800, fontSize: 17 }}>Get coins</div>
          <button
            onClick={onClose}
            aria-label="Close"
            style={{ background: 'none', border: 0, cursor: 'pointer', color: WALLET_TOKENS.textMuted, padding: 4 }}
          >
            <Icon name="close" size={20} />
          </button>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 14, color: WALLET_TOKENS.textSecondary, fontSize: 12.5 }}>
          <CoinGlyph size={15} />
          <span className="font-dmmono tabular-nums" style={{ fontWeight: 700 }}>{fmtNum(wallet?.balance || 0)}</span>
          <span>right now</span>
        </div>

        <div style={{ display: 'grid', gap: 10 }}>
          {packs.map((pack) => {
            const bonus = packValueBonusPct(pack);
            const isVp = pack.badgeStyle === 'vp';
            return (
              <button
                key={pack.id}
                onClick={() => buy(pack)}
                disabled={!!busy}
                style={{
                  display: 'flex', alignItems: 'center', gap: 12, width: '100%',
                  padding: 10, borderRadius: 14, textAlign: 'left',
                  cursor: busy ? 'not-allowed' : 'pointer', font: 'inherit',
                  color: WALLET_TOKENS.text,
                  background: isVp
                    ? 'linear-gradient(135deg, rgba(180,79,255,0.16), rgba(23,17,38,0.9))'
                    : 'linear-gradient(135deg, rgba(240,165,0,0.14), rgba(23,20,32,0.9))',
                  border: `1px solid ${isVp ? 'rgba(180,79,255,0.30)' : 'rgba(240,165,0,0.24)'}`,
                }}
              >
                <img
                  src={`/brand/packs/${pack.id}-pack.webp`}
                  alt=""
                  width={52}
                  height={52}
                  onError={(e) => { e.currentTarget.style.visibility = 'hidden'; }}
                  style={{ width: 52, height: 52, objectFit: 'contain', flexShrink: 0 }}
                />

                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <CoinGlyph size={17} />
                    <span className="font-dmmono tabular-nums" style={{ fontSize: 17, fontWeight: 800 }}>
                      {fmtNum(pack.coins)}
                    </span>
                    {bonus >= MIN_SHOWN_VALUE_BONUS_PCT && (
                      <span style={{
                        fontSize: 10, fontWeight: 800, padding: '2px 6px', borderRadius: 999,
                        background: WALLET_TOKENS.gold, color: '#141018',
                      }}>
                        {bonus}% MORE
                      </span>
                    )}
                  </span>
                  <span style={{ display: 'block', fontSize: 11.5, color: 'rgba(255,255,255,0.5)', marginTop: 2 }}>
                    {pack.name}
                  </span>
                </span>

                <span className="font-dmmono tabular-nums" style={{ fontSize: 15, fontWeight: 800, flexShrink: 0 }}>
                  <LocalPrice usd={pack.priceUSD} fallback={fmtUsd(pack.priceUSD)} />
                </span>
              </button>
            );
          })}
        </div>

        <button
          onClick={() => { navigate('/wallet/buy'); onClose?.(); }}
          style={{
            width: '100%', marginTop: 12, padding: '11px 12px', borderRadius: 12,
            background: 'rgba(255,255,255,0.05)', border: `1px solid ${WALLET_TOKENS.hairline}`,
            color: WALLET_TOKENS.text, font: 'inherit', fontWeight: 700, fontSize: 13, cursor: 'pointer',
          }}
        >
          See all packs
        </button>
      </div>
    </div>,
    document.body,
  );
}

export default CoinBalancePill;
