// Wallet design primitives — inline-style, brand-aligned, used across the
// wallet shell + 13 screens. Single source of truth for the redesigned
// wallet visual language. Mirrors the design pack's `shared.jsx` API but
// targeted at production VERGR brand tokens + material-symbols icons.

import { useEffect, useRef, useState } from 'react';
import Icon from '../Icon';
import { formatUsd, formatMoneyFromEur } from '../../utils/currency';

// ── Brand tokens (mirrored from tailwind.config.js for inline-style use) ──
export const WALLET_TOKENS = {
  bg: '#0B0B14',
  surface1: '#14141F',
  surface2: '#1A1A2A',
  hairline: 'rgba(255,255,255,0.08)',
  hairlineStrong: 'rgba(255,255,255,0.14)',
  text: '#FFFFFF',
  textSecondary: '#9CA3AF',
  textMuted: '#6B7280',
  violet: '#7B1FFF',
  violetLight: '#B44FFF',
  pink: '#C87FFF',
  gold: '#F0A500',
  goldLight: '#F5C842',
  ember: '#F04060',
  gemBlue: '#3D7FFF',
  success: '#22C55E',
  warning: '#F59E0B',
};

// ── Currency glyphs (use the real PNG assets) ──
export const CoinGlyph = ({ size = 24 }) => (
  <img src="/brand/vc-coin.webp" alt="" width={size} height={size}
       style={{ display: 'inline-block', objectFit: 'contain', flexShrink: 0 }} />
);
export const GemGlyph = ({ size = 24 }) => (
  <img src="/brand/gems.webp" alt="" width={size} height={size}
       style={{ display: 'inline-block', objectFit: 'contain', flexShrink: 0 }} />
);
export const VPGlyph = ({ size = 24 }) => (
  <img src="/brand/vp-gem.webp" alt="" width={size} height={size}
       style={{ display: 'inline-block', objectFit: 'contain', flexShrink: 0 }} />
);
// Legacy CSS-gradient VP fallback (kept for places that need a non-image VP marker)
export const VPGlyphInline = ({ size = 24 }) => (
  <span style={{
    display: 'inline-grid', placeItems: 'center',
    width: size, height: size, borderRadius: '50%',
    background: `linear-gradient(135deg, ${WALLET_TOKENS.violet}, ${WALLET_TOKENS.pink})`,
    color: '#fff', fontWeight: 800, fontSize: Math.floor(size * 0.42),
    fontFamily: 'Syne, system-ui, sans-serif',
    lineHeight: 1, flexShrink: 0,
  }}>VP</span>
);

// ── fmt helpers ──
export const fmtNum = (n) => {
  if (n == null || isNaN(n)) return '0';
  return Math.round(n).toLocaleString('en-US');
};
// Despite the name, this formats a EUR amount in the USER'S local currency
// (converted via the live FX feed), falling back to EUR. Centralised here so
// every wallet money display localises automatically. See utils/currency.js.
export const fmtEUR = (n) => {
  if (n == null || isNaN(n)) return formatMoneyFromEur(0);
  return formatMoneyFromEur(n);
};

// A USD amount, shown AS USD. Deliberately NOT localised the way fmtEUR is:
// coin packs are priced natively in USD and USD is what the card is charged, so
// the dollar figure is the truth and a converted number beside it is only ever
// an estimate (that is <LocalPrice usd=... />'s job). Formatting a charged
// amount in a currency it will not be charged in is the displayed-versus-charged
// mismatch getCoinPriceQuote exists to prevent.
export const fmtUsd = (n) => formatUsd(n);

// ── AnimatedNumber: ticks from prev to new value over ~600ms ──
export const AnimatedNumber = ({ value, format = fmtNum, duration = 600 }) => {
  const [display, setDisplay] = useState(value);
  const prev = useRef(value);
  useEffect(() => {
    const from = prev.current;
    const to = value;
    if (from === to) return;
    const start = performance.now();
    let raf;
    const step = (t) => {
      const k = Math.min(1, (t - start) / duration);
      const eased = 1 - Math.pow(1 - k, 3);
      setDisplay(from + (to - from) * eased);
      if (k < 1) raf = requestAnimationFrame(step);
      else { setDisplay(to); prev.current = to; }
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value, duration]);
  return <span className="font-dmmono tabular-nums">{format(display)}</span>;
};

// ── Pill ──
export const Pill = ({ children, tone = 'neutral', size = 'md' }) => {
  const tones = {
    neutral: { bg: 'rgba(255,255,255,0.06)', fg: WALLET_TOKENS.textSecondary, bd: WALLET_TOKENS.hairline },
    violet:  { bg: 'rgba(123,31,255,0.14)',  fg: WALLET_TOKENS.violetLight,   bd: 'rgba(123,31,255,0.32)' },
    gold:    { bg: 'rgba(240,165,0,0.12)',   fg: WALLET_TOKENS.goldLight,     bd: 'rgba(240,165,0,0.30)' },
    success: { bg: 'rgba(34,197,94,0.12)',   fg: '#86EFAC',                   bd: 'rgba(34,197,94,0.30)' },
    warning: { bg: 'rgba(245,158,11,0.12)',  fg: '#FCD34D',                   bd: 'rgba(245,158,11,0.30)' },
    ember:   { bg: 'rgba(240,64,96,0.12)',   fg: '#FCA5A5',                   bd: 'rgba(240,64,96,0.30)' },
  };
  const t = tones[tone] || tones.neutral;
  const pad = size === 'sm' ? '2px 8px' : '4px 10px';
  const fs = size === 'sm' ? 10 : 11;
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 6,
      padding: pad, fontSize: fs, fontWeight: 600,
      letterSpacing: '0.02em', borderRadius: 999,
      background: t.bg, color: t.fg, border: `1px solid ${t.bd}`,
    }}>{children}</span>
  );
};

// ── StatusPill — maps known wallet/ledger statuses to pill tones ──
export const StatusPill = ({ status }) => {
  const map = {
    pending:               { tone: 'warning', label: 'Pending' },
    on_hold:               { tone: 'warning', label: 'On hold' },
    awaiting_offramp:      { tone: 'warning', label: 'At PayRam' },
    processing:            { tone: 'violet',  label: 'Processing' },
    ready:                 { tone: 'violet',  label: 'Ready' },
    settled:               { tone: 'success', label: 'Settled' },
    sent:                  { tone: 'success', label: 'Sent' },
    completed:             { tone: 'success', label: 'Completed' },
    failed:                { tone: 'ember',   label: 'Failed' },
    cancelled:             { tone: 'neutral', label: 'Cancelled' },
    rejected:              { tone: 'ember',   label: 'Rejected' },
  };
  const m = map[status] || { tone: 'neutral', label: status || 'Unknown' };
  return <Pill tone={m.tone} size="sm">{m.label}</Pill>;
};

// ── Callout (info / warning / danger / success) ──
export const Callout = ({ tone = 'info', icon, title, children, action }) => {
  const map = {
    info:    { bg: 'rgba(123,31,255,0.08)',  bd: 'rgba(123,31,255,0.28)',  fg: WALLET_TOKENS.violetLight, iconDefault: 'info' },
    warning: { bg: 'rgba(245,158,11,0.08)',  bd: 'rgba(245,158,11,0.28)',  fg: WALLET_TOKENS.goldLight,   iconDefault: 'warning' },
    danger:  { bg: 'rgba(240,64,96,0.08)',   bd: 'rgba(240,64,96,0.28)',   fg: '#FCA5A5',                 iconDefault: 'error' },
    success: { bg: 'rgba(34,197,94,0.08)',   bd: 'rgba(34,197,94,0.28)',   fg: '#86EFAC',                 iconDefault: 'check_circle' },
  };
  const m = map[tone] || map.info;
  return (
    <div style={{
      display: 'flex', gap: 12, padding: '14px 16px',
      background: m.bg, border: `1px solid ${m.bd}`, borderRadius: 12,
      color: WALLET_TOKENS.text,
    }}>
      <Icon name={icon || m.iconDefault} size={20} className="shrink-0" />
      <div style={{ flex: 1, minWidth: 0 }}>
        {title && <div style={{ fontWeight: 600, fontSize: 13, marginBottom: children ? 4 : 0, color: m.fg }}>{title}</div>}
        {children && <div style={{ fontSize: 13, color: WALLET_TOKENS.textSecondary, lineHeight: 1.5 }}>{children}</div>}
        {action && <div style={{ marginTop: 10 }}>{action}</div>}
      </div>
    </div>
  );
};

// ── LimitProgressBar ──
// `money` formats used/max as EUR amounts converted to the user's local
// currency (via fmtEUR). Otherwise they're plain numbers + an optional suffix.
export const LimitProgressBar = ({ used, max, label, suffix = '', money = false }) => {
  const pct = max > 0 ? Math.min(100, (used / max) * 100) : 0;
  const tone = pct >= 90 ? WALLET_TOKENS.ember : pct >= 60 ? WALLET_TOKENS.goldLight : WALLET_TOKENS.violetLight;
  const fmt = money ? fmtEUR : (v) => `${fmtNum(v)}${suffix}`;
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6, fontSize: 12 }}>
        <span style={{ color: WALLET_TOKENS.textSecondary }}>{label}</span>
        <span className="font-dmmono tabular-nums" style={{ color: WALLET_TOKENS.text, fontWeight: 600 }}>
          {fmt(used)} / {fmt(max)}
        </span>
      </div>
      <div style={{ height: 6, background: 'rgba(255,255,255,0.06)', borderRadius: 3, overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: tone, transition: 'width 0.3s ease' }} />
      </div>
    </div>
  );
};

// ── FeeBreakdown ──
export const FeeBreakdown = ({ items, total, totalLabel = 'You receive' }) => (
  <div style={{
    padding: 14, borderRadius: 10,
    background: WALLET_TOKENS.surface2,
    border: `1px solid ${WALLET_TOKENS.hairline}`,
  }}>
    {items.map((it, i) => (
      <div key={i} style={{
        display: 'flex', justifyContent: 'space-between',
        padding: '4px 0', fontSize: 13,
        color: it.tone === 'muted' ? WALLET_TOKENS.textMuted : WALLET_TOKENS.textSecondary,
      }}>
        <span>{it.label}</span>
        <span className="font-dmmono tabular-nums" style={{ color: WALLET_TOKENS.text }}>{it.value}</span>
      </div>
    ))}
    <div style={{ height: 1, background: WALLET_TOKENS.hairline, margin: '10px 0' }} />
    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14 }}>
      <span style={{ fontWeight: 600, color: WALLET_TOKENS.text }}>{totalLabel}</span>
      <span className="font-dmmono tabular-nums" style={{ fontWeight: 700, color: WALLET_TOKENS.text }}>{total}</span>
    </div>
  </div>
);

// ── LockedOverlay — covers a screen when it requires KYC/PIN ──
export const LockedOverlay = ({ icon = 'lock', title, body, actionLabel, onAction }) => (
  <div style={{
    padding: '48px 24px', textAlign: 'center',
    background: WALLET_TOKENS.surface1,
    border: `1px solid ${WALLET_TOKENS.hairline}`,
    borderRadius: 16,
  }}>
    <div style={{
      width: 64, height: 64, margin: '0 auto 18px',
      display: 'grid', placeItems: 'center', borderRadius: '50%',
      background: 'rgba(123,31,255,0.10)',
      border: `1px solid rgba(123,31,255,0.30)`,
      color: WALLET_TOKENS.violetLight,
    }}>
      <Icon name={icon} size={28} />
    </div>
    <div style={{ fontFamily: 'Syne, sans-serif', fontWeight: 700, fontSize: 20, marginBottom: 8 }}>{title}</div>
    {body && <div style={{ color: WALLET_TOKENS.textSecondary, fontSize: 14, maxWidth: 380, margin: '0 auto 20px', lineHeight: 1.55 }}>{body}</div>}
    {actionLabel && onAction && (
      <button onClick={onAction} style={{
        padding: '10px 22px', borderRadius: 999, fontSize: 13, fontWeight: 600,
        background: `linear-gradient(135deg, ${WALLET_TOKENS.violet}, ${WALLET_TOKENS.pink})`,
        color: '#fff', border: 0, cursor: 'pointer',
      }}>{actionLabel}</button>
    )}
  </div>
);

// ── Modal ──
export const Modal = ({ open, onClose, children, width = 480, title }) => {
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, zIndex: 200,
      background: 'rgba(5,3,12,0.72)', backdropFilter: 'blur(6px)',
      display: 'grid', placeItems: 'center', padding: 16,
    }}>
      <div onClick={(e) => e.stopPropagation()} style={{
        width: '100%', maxWidth: width,
        background: WALLET_TOKENS.surface1,
        border: `1px solid ${WALLET_TOKENS.hairlineStrong}`,
        borderRadius: 16,
        boxShadow: '0 24px 64px rgba(0,0,0,0.6)',
        maxHeight: '90vh', overflowY: 'auto',
      }}>
        {title && (
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '16px 20px', borderBottom: `1px solid ${WALLET_TOKENS.hairline}`,
          }}>
            <div style={{ fontFamily: 'Syne, sans-serif', fontWeight: 700, fontSize: 16 }}>{title}</div>
            <button onClick={onClose} style={{
              width: 32, height: 32, borderRadius: '50%',
              background: 'transparent', border: 0, color: WALLET_TOKENS.textSecondary,
              cursor: 'pointer', display: 'grid', placeItems: 'center',
            }}><Icon name="close" size={18} /></button>
          </div>
        )}
        <div style={{ padding: 20 }}>{children}</div>
      </div>
    </div>
  );
};

// ── Drawer (slide-in from right; used by TxDrawer) ──
export const Drawer = ({ open, onClose, children, width = 480 }) => {
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 190,
      pointerEvents: open ? 'auto' : 'none',
    }}>
      <div onClick={onClose} style={{
        position: 'absolute', inset: 0,
        background: 'rgba(5,3,12,0.6)',
        opacity: open ? 1 : 0,
        transition: 'opacity 0.2s',
      }} />
      <div style={{
        position: 'absolute', top: 0, right: 0, bottom: 0,
        width: '100%', maxWidth: width,
        background: WALLET_TOKENS.surface1,
        borderLeft: `1px solid ${WALLET_TOKENS.hairlineStrong}`,
        transform: `translateX(${open ? '0' : '100%'})`,
        transition: 'transform 0.28s cubic-bezier(0.2,0.8,0.2,1)',
        overflowY: 'auto',
      }}>
        {children}
      </div>
    </div>
  );
};

// ── PinPad: 6-digit numeric entry, dot-masked, on-screen keypad ──
// On desktop: keyboard input also works. Calls onComplete(value) when length=6.
export const PinPad = ({ value, onChange, onComplete, error, disabled }) => {
  // Keyboard input
  useEffect(() => {
    if (disabled) return;
    const onKey = (e) => {
      if (/^\d$/.test(e.key)) {
        if (value.length < 6) {
          const next = value + e.key;
          onChange(next);
          if (next.length === 6) setTimeout(() => onComplete?.(next), 80);
        }
      } else if (e.key === 'Backspace') {
        onChange(value.slice(0, -1));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [value, onChange, onComplete, disabled]);

  const press = (d) => {
    if (disabled || value.length >= 6) return;
    const next = value + d;
    onChange(next);
    if (next.length === 6) setTimeout(() => onComplete?.(next), 80);
  };
  const backspace = () => onChange(value.slice(0, -1));

  return (
    <div style={{ maxWidth: 320, margin: '0 auto', width: '100%' }}>
      {/* Dots */}
      <div style={{ display: 'flex', justifyContent: 'center', gap: 12, marginBottom: 28 }}>
        {[0, 1, 2, 3, 4, 5].map(i => (
          <div key={i} style={{
            width: 16, height: 16, borderRadius: '50%',
            background: i < value.length ? WALLET_TOKENS.violetLight : 'transparent',
            border: `1.5px solid ${error ? WALLET_TOKENS.ember : i < value.length ? WALLET_TOKENS.violetLight : WALLET_TOKENS.hairlineStrong}`,
            transition: 'all 0.15s',
            transform: i < value.length ? 'scale(1.08)' : 'scale(1)',
          }} />
        ))}
      </div>
      {/* Keypad */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
        {['1','2','3','4','5','6','7','8','9'].map(d => (
          <PinKey key={d} label={d} onClick={() => press(d)} disabled={disabled} />
        ))}
        <div />
        <PinKey label="0" onClick={() => press('0')} disabled={disabled} />
        <PinKey iconName="backspace" onClick={backspace} disabled={disabled || value.length === 0} />
      </div>
    </div>
  );
};

const PinKey = ({ label, iconName, onClick, disabled }) => (
  <button onClick={onClick} disabled={disabled} style={{
    height: 64, borderRadius: 16,
    background: disabled ? 'transparent' : WALLET_TOKENS.surface2,
    border: `1px solid ${WALLET_TOKENS.hairline}`,
    color: WALLET_TOKENS.text,
    fontSize: 22, fontWeight: 600,
    fontFamily: 'DM Mono, monospace',
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.4 : 1,
    display: 'grid', placeItems: 'center',
    transition: 'all 0.12s',
  }}
  onMouseDown={(e) => { if (!disabled) e.currentTarget.style.background = 'rgba(123,31,255,0.2)'; }}
  onMouseUp={(e) => { if (!disabled) e.currentTarget.style.background = WALLET_TOKENS.surface2; }}
  onMouseLeave={(e) => { if (!disabled) e.currentTarget.style.background = WALLET_TOKENS.surface2; }}>
    {iconName ? <Icon name={iconName} size={20} /> : label}
  </button>
);

// ── BalanceCard: hero balance card used on Home + History header ──
export const BalanceCard = ({ tone = 'coin', label, value, fiatEUR, action }) => {
  const tones = {
    coin: { glyph: <CoinGlyph size={28} />, ring: WALLET_TOKENS.gold,      gradient: 'rgba(240,165,0,0.10)' },
    gem:  { glyph: <GemGlyph size={28} />,  ring: WALLET_TOKENS.gemBlue,   gradient: 'rgba(61,127,255,0.10)' },
    vp:   { glyph: <VPGlyph size={28} />,   ring: WALLET_TOKENS.violetLight, gradient: 'rgba(123,31,255,0.10)' },
  };
  const t = tones[tone] || tones.coin;
  return (
    <div style={{
      padding: 20, borderRadius: 18,
      background: `linear-gradient(180deg, ${t.gradient} 0%, transparent 60%), ${WALLET_TOKENS.surface1}`,
      border: `1px solid ${WALLET_TOKENS.hairline}`,
      position: 'relative', overflow: 'hidden',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
        {t.glyph}
        <span style={{
          fontSize: 11, letterSpacing: '0.10em', textTransform: 'uppercase',
          color: WALLET_TOKENS.textSecondary, fontWeight: 600,
        }}>{label}</span>
      </div>
      <div style={{
        fontFamily: 'DM Mono, monospace', fontWeight: 700,
        fontSize: 36, lineHeight: 1, marginBottom: 6,
        color: WALLET_TOKENS.text,
      }} className="tabular-nums">
        <AnimatedNumber value={value} />
      </div>
      {fiatEUR != null && (
        <div style={{ fontSize: 13, color: WALLET_TOKENS.textSecondary }}>
          ≈ {fmtEUR(fiatEUR)}
        </div>
      )}
      {action && <div style={{ marginTop: 16 }}>{action}</div>}
    </div>
  );
};

// ── Donut chart (single-arc progress, used for KYC limit visualization) ──
export const Donut = ({ value, max, size = 80, stroke = 8, color = WALLET_TOKENS.violetLight, label }) => {
  const pct = max > 0 ? Math.min(1, value / max) : 0;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  return (
    <div style={{ position: 'relative', width: size, height: size }}>
      <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none"
                stroke="rgba(255,255,255,0.08)" strokeWidth={stroke} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none"
                stroke={color} strokeWidth={stroke}
                strokeDasharray={`${c * pct} ${c}`}
                strokeLinecap="round"
                style={{ transition: 'stroke-dasharray 0.3s' }} />
      </svg>
      {label && (
        <div style={{
          position: 'absolute', inset: 0, display: 'grid', placeItems: 'center',
          fontSize: 11, fontWeight: 600, color: WALLET_TOKENS.text, textAlign: 'center',
        }}>{label}</div>
      )}
    </div>
  );
};

// ── WalletButton (consistent CTA across screens) ──
export const WalletButton = ({ children, variant = 'primary', size = 'md', icon, iconRight, onClick, disabled, full, type = 'button' }) => {
  const sizes = {
    sm: { pad: '8px 14px', fs: 12, h: 32 },
    md: { pad: '11px 20px', fs: 13, h: 40 },
    lg: { pad: '14px 28px', fs: 14, h: 48 },
  };
  const s = sizes[size] || sizes.md;
  const variants = {
    primary: {
      bg: `linear-gradient(135deg, ${WALLET_TOKENS.violet}, ${WALLET_TOKENS.pink})`,
      color: '#fff', border: '0',
      shadow: '0 8px 24px -8px rgba(123,31,255,0.5)',
    },
    secondary: {
      bg: WALLET_TOKENS.surface2,
      color: WALLET_TOKENS.text,
      border: `1px solid ${WALLET_TOKENS.hairlineStrong}`,
      shadow: 'none',
    },
    ghost: {
      bg: 'transparent',
      color: WALLET_TOKENS.textSecondary,
      border: `1px solid ${WALLET_TOKENS.hairline}`,
      shadow: 'none',
    },
    danger: {
      bg: 'rgba(240,64,96,0.14)',
      color: '#FCA5A5',
      border: '1px solid rgba(240,64,96,0.34)',
      shadow: 'none',
    },
  };
  const v = variants[variant] || variants.primary;
  return (
    <button type={type} onClick={onClick} disabled={disabled} style={{
      padding: s.pad, height: s.h, fontSize: s.fs, fontWeight: 600,
      background: v.bg, color: v.color, border: v.border,
      borderRadius: 10, cursor: disabled ? 'not-allowed' : 'pointer',
      opacity: disabled ? 0.5 : 1, boxShadow: v.shadow,
      display: 'inline-flex', alignItems: 'center', gap: 8,
      justifyContent: 'center',
      width: full ? '100%' : undefined,
      transition: 'all 0.15s',
    }}>
      {icon && <Icon name={icon} size={s.fs + 4} />}
      {children}
      {iconRight && <Icon name={iconRight} size={s.fs + 4} />}
    </button>
  );
};

// ── WalletCard: generic surface ──
export const WalletCard = ({ children, padding = 20, style }) => (
  <div style={{
    padding,
    background: WALLET_TOKENS.surface1,
    border: `1px solid ${WALLET_TOKENS.hairline}`,
    borderRadius: 16,
    ...style,
  }}>{children}</div>
);

// ── SectionLabel (eyebrow-style label above blocks) ──
export const SectionLabel = ({ children }) => (
  <div style={{
    fontSize: 10, letterSpacing: '0.10em', textTransform: 'uppercase',
    color: WALLET_TOKENS.textMuted, fontWeight: 600, marginBottom: 10,
  }}>{children}</div>
);
