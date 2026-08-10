import Icon from '../Icon';

// A glossy enamel "gem" subscriber badge, ported from the membership design system.
// One gem per tier; its colour comes from the creator's swatch pick. Pass `months`
// to engrave a loyalty count (turns gold at a year). Reused by the tier editor, the
// subscribe panel, profile headers and (later) chat. Pure CSS — scales to any size.

// Mix a hex colour toward white (amt>0) or black (amt<0). amt in [-1,1].
function shade(hex, amt) {
  const h = (hex || '#7B1FFF').replace('#', '');
  const n = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  let r = parseInt(n.slice(0, 2), 16), g = parseInt(n.slice(2, 4), 16), b = parseInt(n.slice(4, 6), 16);
  const t = amt < 0 ? 0 : 255, p = Math.abs(amt);
  r = Math.round((t - r) * p + r); g = Math.round((t - g) * p + g); b = Math.round((t - b) * p + b);
  return `rgb(${r},${g},${b})`;
}
function rgba(hex, a) {
  const h = (hex || '#7B1FFF').replace('#', '');
  const n = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  return `rgba(${parseInt(n.slice(0, 2), 16)},${parseInt(n.slice(2, 4), 16)},${parseInt(n.slice(4, 6), 16)},${a})`;
}

export default function BadgeGem({ color = '#7B1FFF', icon = 'favorite', size = 60, months = 0, className = '', style = {} }) {
  const light = shade(color, 0.55);
  const dark = shade(color, -0.4);
  const yearPlus = months >= 12;
  const ring = yearPlus ? 'rgba(240,165,0,0.85)' : 'rgba(255,255,255,0.9)';
  const glyph = Math.round(size * 0.45);
  return (
    <span className={`relative inline-flex shrink-0 ${className}`} style={{ width: size, height: size, ...style }}>
      <span
        className="absolute inset-0 flex items-center justify-center"
        style={{
          borderRadius: '36%',
          background: `radial-gradient(125% 125% at 30% 22%, ${light}, ${color} 50%, ${dark})`,
          boxShadow: `0 0 0 ${Math.max(1.5, size * 0.04)}px ${ring}, 0 ${size * 0.1}px ${size * 0.23}px ${rgba(color, 0.5)}, inset 0 ${size * 0.05}px ${size * 0.07}px rgba(255,255,255,0.6), inset 0 -${size * 0.1}px ${size * 0.15}px ${rgba(dark, 0.55)}`,
        }}
      >
        {/* top gloss */}
        <span className="absolute" style={{ left: '18%', right: '34%', top: '11%', height: '30%', borderRadius: '50%', background: 'linear-gradient(180deg,rgba(255,255,255,0.82),rgba(255,255,255,0))' }} />
        <span className="relative inline-flex text-white" style={{ textShadow: `0 2px 3px ${rgba(dark, 0.6)}` }}>
          <Icon name={icon} filled size={glyph} />
        </span>
      </span>
      {months > 0 && (
        <span
          className="absolute font-dmmono font-bold flex items-center justify-center"
          style={{
            bottom: -size * 0.07, right: -size * 0.07,
            width: size * 0.34, height: size * 0.34, fontSize: Math.max(8, size * 0.15),
            borderRadius: '50%',
            background: yearPlus ? 'linear-gradient(135deg,#ffd97a,#F0A500)' : '#0b0e15',
            border: yearPlus ? 'none' : `1px solid ${rgba(color, 0.55)}`,
            color: yearPlus ? '#5a3a00' : color,
            boxShadow: '0 1px 3px rgba(0,0,0,0.5)',
          }}
        >
          {months}
        </span>
      )}
    </span>
  );
}

// Tier-glyph presets the creator can pick from (Material Symbols, filled).
export const BADGE_GLYPHS = ['favorite', 'star', 'workspace_premium', 'bolt', 'diamond', 'military_tech', 'rocket_launch', 'sports_esports', 'whatshot', 'shield'];
// Default swatches offered in the editor (brand-forward, no cyan).
export const BADGE_COLORS = ['#7B1FFF', '#B44FFF', '#C87FFF', '#F0A500', '#F04060', '#3D7FFF', '#34d399', '#FF7AD6'];
