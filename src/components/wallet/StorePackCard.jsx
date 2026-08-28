// The shop card, and the ONE definition of how a purchasable pack looks.
//
// ⚠ THE COIN PACKS SET THIS DESIGN AND EVERYTHING ELSE MATCHES IT. Founder,
// 2026-08-28: *"The card design should be the same as the coin packs but with a
// different colour."* So the shape, the top-lit gradient, the bloom behind the
// art, the fixed 132px art box and the footer price shelf are all lifted
// verbatim from `PackCard` in wallet/v2/BuyScreen.jsx. Only the TONE changes.
//
// ⚠ A second visual language in the same shop is the failure that got the
// milestone badges rejected ("those look like shit"): a Material Symbols glyph on
// a tinted square reads as a settings row, not as something you buy. If a new
// purchasable thing needs a card, give it a tone here — do not write a new card.
//
// TONES, and why each is that colour:
//   gold   — Coins. The existing coin packs.
//   violet — VP. Already the established VP tone: COIN_PACKS with
//            `badgeStyle: 'vp'` render violet on the buy screen today.
//   ember  — Boosts. Reach and promotion, deliberately the hottest of the three
//            so a boost never reads as a coin pack at a glance.
// No cyan: #4DFFD4 is off-brand (project-brand-no-cyan).
import { WALLET_TOKENS } from './primitives';
import Icon from '../Icon';

export const STORE_TONES = {
  gold: {
    accent: WALLET_TOKENS.gold,
    surface: 'linear-gradient(180deg, #2E2417 0%, #1D1826 46%, #171420 100%)',
    border: 'rgba(240,165,0,0.26)',
    bloom: 'rgba(240,165,0,0.26)',
    artShadow: 'rgba(240,165,0,0.34)',
  },
  violet: {
    accent: WALLET_TOKENS.violetLight,
    surface: 'linear-gradient(180deg, #2A1B44 0%, #1B1430 46%, #171126 100%)',
    border: 'rgba(180,79,255,0.34)',
    bloom: 'rgba(180,79,255,0.30)',
    artShadow: 'rgba(123,31,255,0.45)',
  },
  ember: {
    accent: WALLET_TOKENS.ember,
    surface: 'linear-gradient(180deg, #34161F 0%, #221320 46%, #191220 100%)',
    border: 'rgba(240,64,96,0.30)',
    bloom: 'rgba(240,64,96,0.26)',
    artShadow: 'rgba(240,64,96,0.40)',
  },
};

/**
 * ⚠ Gold is NEVER a flat fill — flat #F0A500 reads as orange paint. On the tones
 * that have a ramp this clips it to the glyphs, and the glow must be a FILTER
 * rather than a text-shadow because on the clipped path the glyphs themselves
 * are transparent.
 */
const RAMPS = {
  gold: 'linear-gradient(180deg,#FCEFB4 0%,#F5C842 42%,#E9A517 74%,#C97F12 100%)',
  violet: 'linear-gradient(180deg,#E9D2FF 0%,#C88BFF 42%,#9B45F5 74%,#6B18D6 100%)',
  ember: 'linear-gradient(180deg,#FFD2DA 0%,#FF8098 42%,#F04060 74%,#B81E3C 100%)',
};

/**
 * Art with a real fallback. The founder supplies the render; until it lands the
 * card shows `fallback` set in the tone's ramp, which is a deliberate choice over
 * an icon: a big number in metal still reads as a product, an icon does not.
 */
function PackArt({ src, srcSet, fallback, tone }) {
  return (
    <div style={{ position: 'relative', display: 'grid', placeItems: 'center', padding: '6px 0 2px' }}>
      {src ? (
        <picture>
          {srcSet && <source srcSet={srcSet} media="(min-resolution: 1.5dppx)" />}
          <img
            src={src}
            alt=""
            width={132}
            height={132}
            draggable={false}
            loading="eager"
            // Hide rather than break the grid. Explicit width/height keep the
            // layout from reflowing while the image loads OR when it never does.
            onError={(e) => { e.currentTarget.style.visibility = 'hidden'; }}
            style={{
              width: 132, height: 132, objectFit: 'contain',
              filter: `drop-shadow(0 10px 20px ${tone.artShadow})`,
            }}
          />
        </picture>
      ) : (
        <div style={{ width: 132, height: 132, display: 'grid', placeItems: 'center' }}>
          <span className="font-syne" style={{
            fontSize: 46, fontWeight: 800, lineHeight: 1,
            backgroundImage: tone.ramp, WebkitBackgroundClip: 'text',
            backgroundClip: 'text', color: 'transparent',
            filter: `drop-shadow(0 0 14px ${tone.bloom})`,
          }}>{fallback}</span>
        </div>
      )}
    </div>
  );
}

/**
 * @param {object}  props
 * @param {'gold'|'violet'|'ember'} props.toneId
 * @param {string}  [props.art]        image src; omit to show `fallback` instead
 * @param {string}  [props.artSrcSet]  2x source
 * @param {string}  props.fallback     shown when there is no art (e.g. "3x")
 * @param {string}  props.headline     the big line (e.g. "3x VP")
 * @param {string}  props.name         the quiet line under it
 * @param {string}  [props.badge]      ribbon across the top
 * @param {string}  [props.pill]       small tinted chip (e.g. "6 hours")
 * @param {node}    props.price        footer shelf content
 * @param {boolean} [props.disabled]
 * @param {string}  [props.note]       one line under the price
 */
export default function StorePackCard({
  toneId = 'violet', art, artSrcSet, fallback, headline, name, badge, pill,
  price, note, disabled, busy, onClick, ariaLabel,
}) {
  const tone = { ...(STORE_TONES[toneId] || STORE_TONES.violet), ramp: RAMPS[toneId] || RAMPS.violet };
  const dead = disabled || busy;
  return (
    <div
      role="button"
      tabIndex={dead ? -1 : 0}
      aria-label={ariaLabel || name}
      aria-disabled={dead || undefined}
      onClick={() => !dead && onClick?.()}
      onKeyDown={(e) => {
        if (!dead && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); onClick?.(); }
      }}
      style={{
        position: 'relative', borderRadius: 18, overflow: 'hidden',
        display: 'flex', flexDirection: 'column',
        cursor: dead ? 'not-allowed' : 'pointer',
        // Lit from the top, tinted by the tone. This is the whole difference
        // between "bright and vibrant" and "dark and moody".
        background: tone.surface,
        border: `1px solid ${tone.border}`,
        boxShadow: '0 10px 28px rgba(0,0,0,0.42)',
        paddingTop: badge ? 20 : 14,
        opacity: disabled ? 0.55 : 1,
      }}
    >
      {/* Bloom behind the artwork, so the illustration sits IN light rather than
          on a flat panel. */}
      <div aria-hidden style={{
        position: 'absolute', top: -70, left: '50%', transform: 'translateX(-50%)',
        width: 240, height: 190, pointerEvents: 'none',
        background: `radial-gradient(ellipse at center, ${tone.bloom} 0%, transparent 70%)`,
      }} />

      {badge && (
        <div style={{
          position: 'absolute', top: 0, left: '50%', transform: 'translateX(-50%)',
          background: tone.accent, color: '#12101A',
          padding: '3px 12px', borderRadius: '0 0 10px 10px',
          fontSize: 10, fontWeight: 800, letterSpacing: '0.06em',
          textTransform: 'uppercase', whiteSpace: 'nowrap',
          boxShadow: '0 4px 12px rgba(0,0,0,0.35)',
        }}>
          {badge}
        </div>
      )}

      <PackArt src={art} srcSet={artSrcSet} fallback={fallback} tone={tone} />

      <div style={{ position: 'relative', padding: '0 16px 14px', textAlign: 'center' }}>
        <div className="font-dmmono tabular-nums" style={{
          fontSize: 25, fontWeight: 800, color: '#FFFFFF', marginBottom: 2, lineHeight: 1.1,
        }}>
          {headline}
        </div>

        {pill && (
          <div style={{
            display: 'inline-block', marginBottom: 5, padding: '2px 9px', borderRadius: 999,
            fontSize: 11.5, fontWeight: 700, color: tone.accent,
            background: `${tone.bloom}`,
          }}>
            {pill}
          </div>
        )}

        <div style={{ fontSize: 11.5, color: 'rgba(255,255,255,0.52)', lineHeight: 1.4 }}>
          {name}
        </div>
      </div>

      {/* Footer bar. A product card has a price shelf; a panel of text does not. */}
      <div style={{
        position: 'relative', marginTop: 'auto',
        background: 'rgba(0,0,0,0.30)',
        borderTop: '1px solid rgba(255,255,255,0.07)',
        padding: '11px 14px',
        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
        flexDirection: 'column',
      }}>
        <span className="font-dmmono tabular-nums" style={{
          fontSize: 17, fontWeight: 800, color: '#FFFFFF',
          display: 'inline-flex', alignItems: 'center', gap: 6,
        }}>
          {busy ? <Icon name="progress_activity" size={16} /> : price}
        </span>
        {note && (
          <span style={{ fontSize: 10.5, color: 'rgba(255,255,255,0.45)', textAlign: 'center' }}>
            {note}
          </span>
        )}
      </div>
    </div>
  );
}
