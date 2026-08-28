import { useState, useEffect, useRef, useCallback } from 'react';
import {
  resolveAppearance,
  resolveBackground,
  resolveLinkStyle,
  resolveBlockStyle,
  SOCIAL_META,
  needsDarkText,
  loadVergrMeFont,
  TEXT_SIZE_PX,
  TEXT_WEIGHTS,
  blockFontFamily,
  sanitizeCustomCss,
  SUPPORT_PROVIDERS,
  supportUrl,
} from '../utils/vergrMeThemes';
import { getBlocks } from '../hooks/useVergrMe';
import InlineVideoPlayer from './media/InlineVideoPlayer';
import SocialGlyph from './vergrme/SocialIcons';
import UserName from './UserName';

/**
 * Shared WYSIWYG renderer for a vergr.me page (v2, block-based).
 * Used by the public page (/u/:username) AND the editor's live preview so the
 * two can never drift. Pass `interactive={false}` for the preview (actions are
 * inert) and `handlers` for the live page:
 *   handlers.onBlock(block)  — link/message/email/tip/product/vergr taps
 *   handlers.onShare()       — share button
 *   handlers.onSubscribe()   — follow/subscribe button
 */
export default function VergrMeView({
  data,
  avatarUrl,
  interactive = true,
  handlers = {},
}) {
  // Lazy-load the page font + any per-block font overrides (zero-cost webfonts).
  useEffect(() => {
    if (!data) return;
    loadVergrMeFont(data.font);
    getBlocks(data).forEach((b) => b.font && loadVergrMeFont(b.font));
  }, [data]);

  // Has the header (and its Share/Follow pair) scrolled out of view? Declared
  // ABOVE the `if (!data)` early return — hooks cannot sit after a conditional
  // return. Callback ref so it attaches when the sentinel mounts.
  const [headerOut, setHeaderOut] = useState(false);
  const headerIO = useRef(null);
  const headerSentinelRef = useCallback((el) => {
    if (headerIO.current) { headerIO.current.disconnect(); headerIO.current = null; }
    if (!el || typeof IntersectionObserver === 'undefined') { setHeaderOut(false); return; }
    headerIO.current = new IntersectionObserver(
      ([entry]) => setHeaderOut(!entry.isIntersecting),
      { threshold: 0 },
    );
    headerIO.current.observe(el);
  }, []);

  if (!data) return null;

  const { t, accent, font, titleColor, bioColor, designLang, spec, space } = resolveAppearance(data);
  const dl = designLang || 'minimal';
  const atc = needsDarkText(accent) ? '#111' : '#fff';
  const bg = resolveBackground(data, t, accent);
  const linkSty = resolveLinkStyle(data, accent, t);
  const now = Date.now();
  const inSchedule = (b) => {
    // Scheduling only hides on the live public page; the editor preview always
    // shows blocks so they remain editable.
    if (!interactive) return true;
    if (b.startAt && now < new Date(b.startAt).getTime()) return false;
    if (b.endAt && now > new Date(b.endAt).getTime()) return false;
    return true;
  };
  const blocks = getBlocks(data).filter((b) => b.enabled !== false && inSchedule(b));

  const header = data.headerStyle || { layout: 'centered', variant: 'banner' };
  const leftAlign = header.layout === 'left';

  const on = (fn) => (interactive && fn ? fn : undefined);
  const fire = (block) => on(() => handlers.onBlock && handlers.onBlock(block));
  const onLead = interactive ? handlers.onLead : null;

  const customCss = sanitizeCustomCss(data.customCss);

  return (
    <div
      id="vm-custom-scope"
      style={{
        position: 'relative',
        minHeight: '100%',
        background: t.bg,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        fontFamily: font.body,
        overflow: 'hidden',
      }}
    >
      {/* Full-page background layer */}
      <BackgroundLayer bg={bg} />

      {/* Sandboxed custom CSS (Pro). @scope keeps it off Vergr app chrome. */}
      {customCss && <style>{`@scope (#vm-custom-scope) {\n${customCss}\n}`}</style>}

      <style>{`
        .lbtn:hover{opacity:0.82;transform:translateY(-1px)}
        .lbtn:active{transform:scale(0.97);opacity:0.75}
        .sbtn:hover{opacity:0.7}
        .mbtn:hover{opacity:0.88;transform:translateY(-1px)}
        @keyframes vmpulse{0%,100%{box-shadow:0 0 0 0 ${accent}66}50%{box-shadow:0 0 0 8px ${accent}00}}
        .vm-highlight,.vm-pulse{animation:vmpulse 2s ease-in-out infinite}
        @keyframes vmgrad{0%{background-position:0% 50%}50%{background-position:100% 50%}100%{background-position:0% 50%}}
        .vm-animated{background-size:200% 200%;animation:vmgrad 8s ease infinite}
        @keyframes vmwobble{0%,100%{transform:rotate(0)}25%{transform:rotate(-2.5deg)}75%{transform:rotate(2.5deg)}}
        .vm-wobble{animation:vmwobble 1.6s ease-in-out infinite}
        @keyframes vmshake{0%,100%{transform:translateX(0)}20%{transform:translateX(-4px)}40%{transform:translateX(4px)}60%{transform:translateX(-3px)}80%{transform:translateX(3px)}}
        .vm-shake{animation:vmshake 1.8s ease-in-out infinite}
        @keyframes vmflash{0%,55%,100%{opacity:1}30%{opacity:0.45}}
        .vm-flash{animation:vmflash 1.8s ease-in-out infinite}
        .vm-scanlines{background:repeating-linear-gradient(to bottom, rgba(0,0,0,0) 0px, rgba(0,0,0,0) 2px, rgba(0,0,0,0.16) 3px, rgba(0,0,0,0) 4px)}
        @keyframes vmin{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:none}}
        .vm-in{animation:vmin .5s cubic-bezier(.2,.7,.3,1) both}
        @keyframes vmaurora{0%,100%{transform:translate3d(-4%,-3%,0) rotate(0deg)}50%{transform:translate3d(5%,4%,0) rotate(8deg)}}
        .vm-aurora{animation:vmaurora 14s ease-in-out infinite}
        @keyframes vmblob1{0%,100%{transform:translate(0,0) scale(1)}50%{transform:translate(8%,6%) scale(1.12)}}
        @keyframes vmblob2{0%,100%{transform:translate(0,0) scale(1)}50%{transform:translate(-7%,-5%) scale(1.08)}}
        .vm-blob1{animation:vmblob1 16s ease-in-out infinite}
        .vm-blob2{animation:vmblob2 19s ease-in-out infinite}
        @media (prefers-reduced-motion: reduce){.vm-animated,.vm-pulse,.vm-highlight,.vm-wobble,.vm-shake,.vm-flash,.vm-aurora,.vm-blob1,.vm-blob2,.vm-in{animation:none!important}}
      `}</style>

      <DesignDecor dl={dl} accent={accent} />


      <div className="w-full" style={{ maxWidth: space.maxW, position: 'relative', zIndex: 1 }}>
        <Header
          data={data}
          header={header}
          t={t}
          accent={accent}
          atc={atc}
          avatarUrl={avatarUrl}
          font={font}
          titleColor={titleColor}
          bioColor={bioColor}
          leftAlign={leftAlign}
          interactive={interactive}
          handlers={handlers}
          spec={spec}
        />
        {/* Sentinel for the floating action cluster. ActionRow (in the header)
            and FloatingActions (pinned bottom-right) render the SAME Share and
            Follow buttons off the same two flags, so with defaults every
            visitor saw both at once — on the page a creator hands to an
            audience who have never used Vergr (audit A13). The floating pair
            now appears only once the header pair has scrolled out of view. */}
        <div ref={headerSentinelRef} style={{ height: 1 }} aria-hidden />

        <div
          className="flex flex-col pb-12"
          style={{ alignItems: leftAlign ? 'stretch' : 'center', paddingTop: header.variant === 'banner' ? space.pt + 28 : space.pt, gap: space.gap, paddingLeft: space.px, paddingRight: space.px }}
        >
          {!leftAlign && (
            <ProfileText data={data} t={t} font={font} titleColor={titleColor} bioColor={bioColor} spec={spec} center />
          )}

          {groupRows(blocks).map((row, ri) => {
            // Each top-level row fades+slides in, staggered. The wrapper mirrors
            // the parent's alignment so wrapping doesn't change any block layout.
            // Public page only (interactive); the editor preview renders static.
            const wrap = {
              width: '100%', display: 'flex', flexDirection: 'column',
              alignItems: leftAlign ? 'stretch' : 'center',
              ...(interactive ? { animationDelay: `${Math.min(ri, 14) * 55}ms` } : null),
            };
            return (
              <div key={`row${ri}`} className={interactive ? 'vm-in' : undefined} style={wrap}>
                {row.grid ? (
                  <div style={{ width: '100%', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: space.gap }}>
                    {row.items.map((block) => (
                      <Block key={block.id} block={block} t={t} accent={accent} atc={atc} linkSty={linkSty} font={font} dl={dl} spec={spec} interactive={interactive} fire={fire} onLead={onLead} />
                    ))}
                  </div>
                ) : (
                  <Block key={row.items[0].id} block={row.items[0]} t={t} accent={accent} atc={atc} linkSty={linkSty} font={font} dl={dl} spec={spec} interactive={interactive} fire={fire} onLead={onLead} />
                )}
              </div>
            );
          })}

          {!data.hideBranding && (
            <div className="flex flex-col items-center gap-2 mt-6">
              <p style={{ fontSize: 11, color: t.textMuted }}>Made with Vergr.me</p>
              {interactive ? (
                <a
                  href="https://vergr.app/linkinbio"
                  style={brandPill(accent, atc)}
                >
                  Get your free link in bio
                </a>
              ) : (
                <span style={brandPill(accent, atc)}>Get your free link in bio</span>
              )}
            </div>
          )}
        </div>
      </div>

      {interactive && data.floatingActions !== false && headerOut && (
        <FloatingActions data={data} accent={accent} atc={atc} handlers={handlers} />
      )}
    </div>
  );
}

// Floating share/follow cluster, pinned bottom-right, stays put on scroll.
// Public page only (interactive). Honours the same show flags as the header.
function FloatingActions({ data, accent, atc, handlers }) {
  const showShare = data.showShare !== false;
  const showSub = data.showSubscribe !== false;
  if (!showShare && !showSub) return null;
  const fab = {
    width: 48, height: 48, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontSize: 20, cursor: 'pointer', border: 'none', boxShadow: '0 6px 20px rgba(0,0,0,0.35)',
  };
  return (
    <div style={{ position: 'fixed', right: 16, bottom: 20, display: 'flex', flexDirection: 'column', gap: 10, zIndex: 40, alignItems: 'center' }}>
      {showSub && (
        <button aria-label="Follow" onClick={handlers.onSubscribe} style={{ ...fab, background: accent, color: atc }}>+</button>
      )}
      {showShare && (
        <button aria-label="Share" onClick={handlers.onShare} style={{ ...fab, width: 44, height: 44, fontSize: 17, background: 'rgba(20,20,31,0.82)', color: '#fff', backdropFilter: 'blur(10px)', border: '1px solid rgba(255,255,255,0.12)' }}>⤴</button>
      )}
    </div>
  );
}

// Carousels bleed past the 480px column's 20px side padding and fade out at the
// right edge so it reads as "more to scroll", not a hard cut at the box border.
const CAROUSEL_BLEED = {
  width: 'calc(100% + 40px)',
  marginLeft: -20,
  marginRight: -20,
  paddingLeft: 20,
  paddingRight: 20,
  WebkitMaskImage: 'linear-gradient(to right, #000 86%, transparent 100%)',
  maskImage: 'linear-gradient(to right, #000 86%, transparent 100%)',
};

// Autolink http(s)://, www., and bare gaming/common-TLD domains in free text.
const URL_RE = /((?:https?:\/\/|www\.)[^\s<]+|[a-z0-9][a-z0-9-]*\.(?:com|net|org|io|gg|tv|me|app|co|dev|xyz|live|store|shop)(?:\/[^\s<]*)?)/gi;
function linkify(text, accent) {
  if (!text) return null;
  const out = [];
  let last = 0;
  let m;
  URL_RE.lastIndex = 0;
  while ((m = URL_RE.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const raw = m[0];
    const href = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
    out.push(
      <a key={m.index} href={href} target="_blank" rel="noopener noreferrer"
        style={{ color: accent, fontWeight: 600, textDecoration: 'underline', wordBreak: 'break-word' }}>
        {raw}
      </a>
    );
    last = m.index + raw.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out.length ? out : text;
}

const brandPill = (accent, atc) => ({
  background: accent,
  color: atc,
  padding: '8px 18px',
  borderRadius: 999,
  fontSize: 12,
  fontWeight: 700,
  textDecoration: 'none',
});

function tintRgba(color, opacity) {
  if (color === '#ffffff') return `rgba(255,255,255,${opacity})`;
  return `rgba(0,0,0,${opacity})`;
}

// ---- Design languages -----------------------------------------
// Each theme's `designLang` yields STRUCTURAL style fragments layered over the
// resolved link style, so the same card reads as a different app per theme.
// Fragments: card (container), title, iconWrap, hideIcon, titlePrefix, trail,
// trailStyle. They're additive — the user's own overrides still win underneath.
// Section-header (title) variants per design language.
function dlHeader(dl, accent, t) {
  switch (dl) {
    case 'terminal': return { prefix: '// ', text: { textTransform: 'none', color: accent, fontFamily: 'monospace' } };
    case 'editorial': return { wrap: { borderTop: `1px solid ${t.border}`, paddingTop: 10 }, text: { textTransform: 'none', letterSpacing: '0.02em' } };
    case 'brutalist': return { text: { color: t.text } };
    case 'luxe': return { text: { color: accent, letterSpacing: '0.18em' } };
    default: return {};
  }
}

// Decorative overlay per design language (scanlines / paper grain / neon glow).
// Pure CSS/SVG, pointer-events none, respects prefers-reduced-motion implicitly
// (no animation). Scoped to the page container.
function DesignDecor({ dl, accent }) {
  if (dl === 'terminal') {
    return <div className="vm-scanlines" style={{ position: 'absolute', inset: 0, zIndex: 5, pointerEvents: 'none', opacity: 0.5 }} />;
  }
  if (dl === 'zine' || dl === 'editorial') {
    const grain = "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='140' height='140'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.5'/%3E%3C/svg%3E\")";
    return <div style={{ position: 'absolute', inset: 0, zIndex: 5, pointerEvents: 'none', opacity: dl === 'zine' ? 0.12 : 0.07, backgroundImage: grain, mixBlendMode: 'multiply' }} />;
  }
  if (dl === 'neon') {
    return <div style={{ position: 'absolute', inset: 0, zIndex: 0, pointerEvents: 'none', background: `radial-gradient(ellipse at 50% 0%, ${accent}22, transparent 60%)` }} />;
  }
  return null;
}

function BackgroundLayer({ bg }) {
  if (bg.kind === 'effect') return <EffectBg bg={bg} />;
  if (bg.kind === 'media') {
    const filter = bg.blur ? `blur(${bg.blur}px)` : undefined;
    // Slight scale hides blur edge-bleed.
    const mediaStyle = { width: '100%', height: '100%', objectFit: 'cover', filter, transform: bg.blur ? 'scale(1.06)' : undefined };
    return (
      <div style={{ position: 'absolute', inset: 0, zIndex: 0, overflow: 'hidden' }}>
        {bg.mediaType === 'video' ? (
          <video
            src={bg.url}
            autoPlay
            muted={bg.muted !== false}
            loop
            playsInline
            style={mediaStyle}
          />
        ) : (
          <div style={{ ...mediaStyle, background: `url(${bg.url}) center/cover no-repeat` }} />
        )}
        {bg.overlay > 0 && (
          <div style={{ position: 'absolute', inset: 0, background: tintRgba(bg.tintColor, bg.overlay) }} />
        )}
      </div>
    );
  }
  return (
    <div
      className={bg.animated ? 'vm-animated' : ''}
      style={{ position: 'absolute', inset: 0, zIndex: 0, background: bg.css, backgroundSize: bg.animated ? '220% 220%' : undefined }}
    />
  );
}

// Coded animated backgrounds (zero cost, pure CSS/canvas). aurora + blobs are
// CSS keyframes; particles is a requestAnimationFrame canvas (Pro).
function EffectBg({ bg }) {
  const base = { position: 'absolute', inset: 0, zIndex: 0, overflow: 'hidden', background: bg.c2 };
  if (bg.effect === 'particles') return <ParticlesBg base={base} color={bg.accent || bg.c1} />;
  return (
    <div style={base}>
      {bg.effect === 'aurora' && (
        <div className="vm-aurora" style={{
          position: 'absolute', inset: '-25%', filter: 'blur(45px)',
          background: `radial-gradient(40% 40% at 28% 30%, ${bg.c1}66, transparent 70%), radial-gradient(40% 40% at 72% 58%, ${bg.c1}44, transparent 70%), radial-gradient(50% 50% at 50% 82%, ${bg.c1}33, transparent 70%)`,
        }} />
      )}
      {bg.effect === 'blobs' && (
        <>
          <div className="vm-blob1" style={{ position: 'absolute', width: '55%', height: '55%', borderRadius: '50%', background: `${bg.c1}55`, filter: 'blur(60px)', top: '4%', left: '8%' }} />
          <div className="vm-blob2" style={{ position: 'absolute', width: '50%', height: '50%', borderRadius: '50%', background: `${bg.c1}3a`, filter: 'blur(60px)', bottom: '4%', right: '6%' }} />
        </>
      )}
    </div>
  );
}

function ParticlesBg({ base, color }) {
  const ref = useRef(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return undefined;
    const ctx = canvas.getContext('2d');
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    let raf, w, h;
    const dots = [];
    const seed = () => {
      w = canvas.width = canvas.offsetWidth || 480;
      h = canvas.height = canvas.offsetHeight || 800;
      const n = Math.min(80, Math.max(24, Math.floor((w * h) / 14000)));
      dots.length = 0;
      for (let i = 0; i < n; i++) dots.push({ x: Math.random() * w, y: Math.random() * h, r: Math.random() * 1.8 + 0.4, vx: (Math.random() - 0.5) * 0.25, vy: (Math.random() - 0.5) * 0.25, a: Math.random() * 0.5 + 0.18 });
    };
    seed();
    const draw = () => {
      ctx.clearRect(0, 0, w, h);
      for (const dt of dots) {
        if (!reduce) {
          dt.x += dt.vx; dt.y += dt.vy;
          if (dt.x < 0) dt.x = w; if (dt.x > w) dt.x = 0;
          if (dt.y < 0) dt.y = h; if (dt.y > h) dt.y = 0;
        }
        ctx.beginPath();
        ctx.arc(dt.x, dt.y, dt.r, 0, Math.PI * 2);
        ctx.fillStyle = color; ctx.globalAlpha = dt.a; ctx.fill();
      }
      ctx.globalAlpha = 1;
      if (!reduce) raf = requestAnimationFrame(draw);
    };
    draw();
    const onResize = () => { seed(); if (reduce) draw(); };
    window.addEventListener('resize', onResize);
    return () => { cancelAnimationFrame(raf); window.removeEventListener('resize', onResize); };
  }, [color]);
  return <div style={base}><canvas ref={ref} style={{ width: '100%', height: '100%', display: 'block' }} /></div>;
}

function Header({ data, header, t, accent, atc, avatarUrl, font, titleColor, bioColor, leftAlign, interactive, handlers, spec }) {
  const variant = header.variant || 'banner';
  const baseSize = variant === 'portrait' ? 92 : 70;
  const avatarSize = header.avatarSize === 'hero' ? Math.round(baseSize * 1.6) : baseSize;
  const shape = header.avatarShape || 'circle';
  const HEX = 'polygon(50% 0%, 100% 25%, 100% 75%, 50% 100%, 0% 75%, 0% 25%)';
  const shapeStyle = shape === 'hexagon'
    ? { clipPath: HEX }
    : { borderRadius: shape === 'square' ? avatarSize * 0.22 : '50%' };
  // Per design-language avatar frame: the user's identity, not Vergr chrome.
  const frame = spec?.avatar?.frame || 'ring';
  const frameDeco = ({
    soft:     { boxShadow: `0 14px 32px ${accent}40` },
    hard:     { border: `2.5px solid ${t.text}`, boxShadow: `4px 4px 0 0 ${t.text}` },
    hairline: { border: `1px solid ${t.border}` },
    glow:     { boxShadow: `0 0 26px ${accent}cc, 0 0 8px ${accent}` },
    glass:    { border: '1px solid rgba(255,255,255,0.35)', boxShadow: '0 8px 24px rgba(0,0,0,0.3)' },
    sticker:  { border: `2px solid ${t.text}`, boxShadow: `3px 3px 0 0 ${t.text}` },
    terminal: { border: `1px solid ${accent}`, boxShadow: `0 0 12px ${accent}55` },
    luxe:     { border: `1px solid ${accent}88` },
    ring:     {},
  })[frame] || {};
  const showRing = frame === 'ring';
  const bannerBg =
    data.background?.type === 'gradient' || !data.background
      ? `linear-gradient(160deg, ${accent}55 0%, ${accent}18 42%, transparent 100%)`
      : `linear-gradient(160deg, ${accent}44 0%, transparent 100%)`;
  // An uploaded banner image wins over the accent wash. Keep a soft bottom
  // scrim so the avatar + actions stay legible over any photo.
  const bannerImg = header.bannerUrl;
  const bannerStyle = bannerImg
    ? { backgroundImage: `linear-gradient(180deg, rgba(0,0,0,0.05) 0%, rgba(0,0,0,0.35) 100%), url(${bannerImg})`, backgroundSize: 'cover', backgroundPosition: 'center' }
    : { background: bannerBg };

  const Avatar = (
    <div style={{ position: 'relative', width: avatarSize, height: avatarSize }}>
      {/* Minimal's accent ring — a slightly larger shape behind the avatar so it
          works for hexagon (where a CSS border can't follow the clip-path).
          Other design languages use their own frame treatment (frameDeco). */}
      {showRing && (
        <div style={{ position: 'absolute', inset: -3, background: accent, pointerEvents: 'none', ...(shape === 'hexagon' ? { clipPath: HEX } : { borderRadius: shape === 'square' ? avatarSize * 0.26 : '50%' }) }} />
      )}
      {avatarUrl ? (
        <img
          src={avatarUrl}
          alt={data.displayName}
          style={{ position: 'relative', width: avatarSize, height: avatarSize, objectFit: 'cover', ...shapeStyle, ...frameDeco }}
        />
      ) : (
        <div
          style={{
            position: 'relative', width: avatarSize, height: avatarSize, background: t.surface,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: avatarSize * 0.37, color: t.text, ...shapeStyle, ...frameDeco,
          }}
        >
          {(data.displayName || '?').charAt(0).toUpperCase()}
        </div>
      )}
    </div>
  );

  if (variant === 'banner') {
    return (
      <div style={{ height: 120, position: 'relative', ...bannerStyle }} className={header.variant === 'animated' && !bannerImg ? 'vm-animated' : ''}>
        <ActionRow data={data} t={t} accent={accent} interactive={interactive} handlers={handlers} />
        <div style={{ position: 'absolute', bottom: -34, left: leftAlign ? 20 : '50%', transform: leftAlign ? 'none' : 'translateX(-50%)' }}>
          {Avatar}
        </div>
        {leftAlign && (
          <div style={{ position: 'absolute', bottom: -34, left: 20 + avatarSize + 12, paddingTop: 38 }}>
            <ProfileText data={data} t={t} font={font} titleColor={titleColor} bioColor={bioColor} spec={spec} />
          </div>
        )}
      </div>
    );
  }

  // minimal / portrait / animated-without-banner
  return (
    <div className="flex flex-col items-center gap-2" style={{ paddingTop: 28, alignItems: leftAlign ? 'flex-start' : 'center', paddingLeft: leftAlign ? 20 : 0 }}>
      <ActionRow data={data} t={t} accent={accent} interactive={interactive} handlers={handlers} inline />
      {Avatar}
    </div>
  );
}

function ProfileText({ data, t, font, titleColor, bioColor, spec, center }) {
  const p = spec?.profile || {};
  return (
    <div className="flex flex-col gap-1" style={{ alignItems: center ? 'center' : 'flex-start', textAlign: center ? 'center' : 'left', width: center ? '100%' : 'auto' }}>
      <h1 style={{ fontSize: 22, fontWeight: 700, color: titleColor || t.text, letterSpacing: '-0.02em', fontFamily: font.heading, display: 'inline-flex', alignItems: 'center', gap: 6, justifyContent: center ? 'center' : 'flex-start', ...p.title }}>
        {p.prefix}<UserName user={data} masked fallback={' '} />
        {data.verified && (
          <span title="Verified" style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 18, height: 18, borderRadius: '50%', background: '#3D7FFF', color: '#fff', fontSize: 11, fontWeight: 900, flexShrink: 0 }}>✓</span>
        )}
      </h1>
      <p style={{ fontSize: 13, color: t.textSub, ...p.username }}><UserName user={data} masked handle /></p>
      {data.bio && (
        <p style={{ fontSize: 13, color: bioColor || t.textSub, lineHeight: 1.6, maxWidth: 320, marginTop: 4, whiteSpace: 'pre-line', ...p.bio }}>{data.bio}</p>
      )}
      {data.showFollowers && data.followerCount > 0 && (
        <p style={{ fontSize: 12, color: t.textMuted, marginTop: 2 }}>
          {data.followerCount.toLocaleString()} followers
        </p>
      )}
    </div>
  );
}

function ActionRow({ data, t, accent, interactive, handlers, inline }) {
  const showShare = data.showShare !== false;
  const showSub = data.showSubscribe !== false;
  if (!showShare && !showSub) return null;
  const btn = {
    width: 34, height: 34, borderRadius: '50%', background: 'rgba(0,0,0,0.28)',
    backdropFilter: 'blur(8px)', border: `1px solid ${t.border}`, color: t.text,
    display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: interactive ? 'pointer' : 'default',
    fontSize: 15,
  };
  return (
    <div style={{ position: inline ? 'static' : 'absolute', top: 10, right: 12, display: 'flex', gap: 8, zIndex: 2 }}>
      {showShare && (
        <button style={btn} onClick={interactive && handlers.onShare ? handlers.onShare : undefined} aria-label="Share">⤴</button>
      )}
      {showSub && (
        <button style={{ ...btn, background: accent, color: needsDarkText(accent) ? '#111' : '#fff', borderColor: 'transparent' }} onClick={interactive && handlers.onSubscribe ? handlers.onSubscribe : undefined} aria-label="Follow">+</button>
      )}
    </div>
  );
}

// ---- Block renderer -------------------------------------------
function Block({ block, t, accent, atc, linkSty, font, dl = 'minimal', spec, interactive, fire, onLead }) {
  const cursor = interactive ? 'pointer' : 'default';
  const d = spec?.link || {};

  switch (block.type) {
    case 'header': {
      const hd = dlHeader(dl, accent, t);
      return (
        <div style={{ width: '100%', marginTop: 6, ...hd.wrap }}>
          <p style={{
            fontSize: block.fontSize ? TEXT_SIZE_PX[block.fontSize] : 12,
            fontWeight: TEXT_WEIGHTS[block.weight] || 700,
            letterSpacing: '0.08em', textTransform: 'uppercase',
            color: block.color || t.textSub,
            textAlign: block.align || 'center',
            fontFamily: blockFontFamily(block) || font.heading,
            ...hd.text,
          }}>
            {hd.prefix}{block.text}
          </p>
        </div>
      );
    }

    case 'text': {
      const inner = (
        <p style={{
          width: '100%', margin: 0,
          fontSize: block.fontSize ? TEXT_SIZE_PX[block.fontSize] : 13,
          fontWeight: TEXT_WEIGHTS[block.weight] || 400,
          color: block.color || (block.bgColor ? (needsDarkText(block.bgColor) ? '#111' : '#fff') : t.textSub),
          lineHeight: 1.6, textAlign: block.align || 'center', whiteSpace: 'pre-line',
          fontFamily: blockFontFamily(block),
        }}>
          {linkify(block.text, accent)}
        </p>
      );
      // A background colour turns the text block into a coloured callout/banner.
      if (block.bgColor) {
        return (
          <div style={{ width: '100%', background: block.bgColor, padding: '14px 16px', borderRadius: linkSty.borderRadius }}>
            {inner}
          </div>
        );
      }
      return inner;
    }

    case 'socials': {
      const active = Object.entries(block.socials || {}).filter(([, v]) => v);
      if (!active.length) return null;
      // The theme's design language sets the DEFAULT chip treatment; an explicit
      // block.colorMode still wins so the user can override.
      const sc = spec?.social || { mode: 'brand', radius: 12 };
      const mode = block.colorMode || sc.mode || 'brand'; // brand | theme | mono
      const radius = sc.radius ?? 12;
      const chipSize = sc.plain ? 30 : 40;
      const styFor = (meta) => {
        let wrap; let glyph;
        if (mode === 'brand') { const c = meta?.brand || accent; wrap = { background: c, border: 'none' }; glyph = needsDarkText(c) ? '#111' : '#fff'; }
        else if (mode === 'mono') { const c = block.monoColor || t.text; wrap = { background: 'transparent', border: `${sc.border || 1}px solid ${c}` }; glyph = c; }
        else { wrap = { background: t.surface, border: `0.5px solid ${t.border}` }; glyph = t.textSub; }
        wrap.borderRadius = radius;
        if (sc.glow) wrap.boxShadow = `0 0 12px ${accent}77`;
        if (sc.glass) { wrap.backdropFilter = 'blur(10px)'; wrap.WebkitBackdropFilter = 'blur(10px)'; }
        if (sc.plain) { wrap = { background: 'transparent', border: 'none' }; glyph = mode === 'brand' ? (meta?.brand || t.text) : t.text; }
        return { wrap: { ...wrap, width: chipSize, height: chipSize }, glyph };
      };
      const cls = 'flex items-center justify-center no-underline';
      return (
        <div className="flex flex-wrap gap-2.5 justify-center" style={{ width: '100%' }}>
          {active.map(([key, handle]) => {
            const meta = SOCIAL_META[key];
            const s = styFor(meta);
            const inner = <SocialGlyph name={key} size={sc.plain ? 22 : 19} color={s.glyph} />;
            return interactive ? (
              <a key={key} href={`${meta?.baseUrl || ''}${handle}`} target="_blank" rel="noopener noreferrer" className={`sbtn ${cls}`} style={s.wrap}>
                {inner}
              </a>
            ) : (
              <span key={key} className={cls} style={s.wrap}>{inner}</span>
            );
          })}
        </div>
      );
    }

    case 'image':
      return (
        <div style={{ width: '100%', cursor: block.link ? cursor : 'default' }} onClick={block.link ? fire(block) : undefined}>
          {block.url ? (
            <img src={block.url} alt={block.caption || ''} loading="lazy" decoding="async" style={{ width: '100%', borderRadius: linkSty.borderRadius, display: 'block' }} />
          ) : (
            <Placeholder t={t} label="Image" radius={linkSty.borderRadius} />
          )}
          {block.caption && <p style={{ fontSize: 11, color: t.textMuted, textAlign: 'center', marginTop: 6 }}>{block.caption}</p>}
        </div>
      );

    case 'gallery': {
      const imgs = (block.images || []).filter(Boolean);
      if (!imgs.length) return <Placeholder t={t} label="Gallery" radius={linkSty.borderRadius} />;
      if (block.layout === 'carousel') {
        return (
          <div style={{ display: 'flex', gap: 8, overflowX: 'auto', scrollSnapType: 'x mandatory', WebkitOverflowScrolling: 'touch', paddingBottom: 4, ...CAROUSEL_BLEED }}>
            {imgs.map((src, i) => (
              <img key={i} src={src} alt="" loading="lazy" decoding="async" style={{ width: '70%', flexShrink: 0, aspectRatio: '1', objectFit: 'cover', borderRadius: 10, scrollSnapAlign: 'center' }} />
            ))}
          </div>
        );
      }
      const cols = block.layout === 'grid2' ? 2 : 3;
      return (
        <div style={{ width: '100%', display: 'grid', gridTemplateColumns: `repeat(${cols}, 1fr)`, gap: 6 }}>
          {imgs.map((src, i) => (
            <img key={i} src={src} alt="" loading="lazy" decoding="async" style={{ width: '100%', aspectRatio: '1', objectFit: 'cover', borderRadius: 8 }} />
          ))}
        </div>
      );
    }

    case 'video': {
      const embed = videoEmbedUrl(block);
      if (embed) {
        return (
          <div style={{ width: '100%', borderRadius: linkSty.borderRadius, overflow: 'hidden', aspectRatio: '16/9', background: '#000' }}>
            <iframe src={embed} title={block.title || 'Video'} allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowFullScreen style={{ width: '100%', height: '100%', border: 0 }} />
          </div>
        );
      }
      if (block.url) {
        // Direct-file (R2) video — custom HTML controls so playback works inside
        // the native Tauri WebView (native <video controls> is touch-dead there).
        return <InlineVideoPlayer src={block.url} maxHeightClass="max-h-72" objectFit="contain" style={{ borderRadius: linkSty.borderRadius }} />;
      }
      return <Placeholder t={t} label="Video" radius={linkSty.borderRadius} />;
    }

    case 'music': {
      const embed = musicEmbedUrl(block);
      if (!embed) return <Placeholder t={t} label="Music" radius={linkSty.borderRadius} />;
      return (
        <iframe src={embed} title="Music" allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture" loading="lazy" style={{ width: '100%', height: block.provider === 'apple' ? 175 : block.provider === 'spotify' ? 152 : 120, border: 0, borderRadius: linkSty.borderRadius }} />
      );
    }

    case 'embed':
      return block.url ? (
        <iframe src={block.url} title="Embed" loading="lazy" style={{ width: '100%', height: block.height || 320, border: 0, borderRadius: linkSty.borderRadius }} />
      ) : (
        <Placeholder t={t} label="Embed" radius={linkSty.borderRadius} />
      );

    case 'product': {
      const pbs = resolveBlockStyle(block, { ...linkSty, ...d.card }, t, accent);
      return (
        <button className="lbtn" onClick={fire(block)} style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 12, padding: 12, cursor, ...pbs.card }}>
          {block.imageUrl ? (
            <img src={block.imageUrl} alt="" style={{ width: 48, height: 48, borderRadius: 9, objectFit: 'cover' }} />
          ) : (
            <IconTile t={t} emoji="🛍️" />
          )}
          <div className="flex-1 min-w-0" style={{ textAlign: 'left' }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: pbs.text }}>{block.title || 'Product'}</div>
            {block.desc && <div style={{ fontSize: 11, color: pbs.card.color ? pbs.card.color : t.textSub, marginTop: 2 }}>{block.desc}</div>}
          </div>
          {block.price && <span style={{ fontSize: 13, fontWeight: 700, color: pbs.accent }}>{block.price}</span>}
        </button>
      );
    }

    case 'email':
      return (
        <CardButton fire={fire} block={block} cursor={cursor} linkSty={linkSty} t={t} d={d}
          emoji="✉️" title={block.label || 'Connect with me'} subtitle={block.email} accent={accent} />
      );

    case 'message': {
      const mbs = resolveBlockStyle(block, { borderRadius: linkSty.borderRadius, border: 'none', background: accent, color: atc }, t, accent);
      return (
        <button className="mbtn" onClick={fire(block)} style={{ width: '100%', padding: '13px 16px', ...mbs.card, fontSize: 15, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, cursor }}>
          <span>💬</span> {block.label || 'Message on Vergr'}
        </button>
      );
    }

    case 'tip': {
      const tbs = resolveBlockStyle(block, { background: `${accent}15`, border: `1px solid ${accent}30`, borderRadius: linkSty.borderRadius }, t, accent);
      return (
        <button className="lbtn" onClick={fire(block)} style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 12, padding: 12, ...tbs.card, cursor }}>
          <div style={{ width: 36, height: 36, borderRadius: 9, background: `${tbs.accent}20`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18 }}>🪙</div>
          <div className="flex-1" style={{ textAlign: 'left' }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: tbs.card.color || tbs.accent }}>{block.label || 'Send a tip'}</div>
            <div style={{ fontSize: 11, color: t.textSub, marginTop: 2 }}>Tip coins on Vergr</div>
          </div>
          <span style={{ fontSize: 16, color: tbs.card.color || tbs.accent }}>›</span>
        </button>
      );
    }

    case 'invite':
      return <InviteBlock block={block} t={t} accent={accent} atc={atc} linkSty={linkSty} cursor={cursor} fire={fire} />;

    case 'support': {
      const prov = SUPPORT_PROVIDERS[block.provider] || SUPPORT_PROVIDERS.bmac;
      const txt = needsDarkText(prov.brand) ? '#111' : '#fff';
      return (
        <button className="lbtn" onClick={fire(block)} style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, padding: '13px 16px', borderRadius: linkSty.borderRadius, border: 'none', background: prov.brand, color: txt, fontSize: 14, fontWeight: 700, cursor }}>
          <span style={{ fontSize: 17 }}>{prov.emoji}</span>
          {block.label || prov.cta}
        </button>
      );
    }

    case 'services':
      return <ServicesBlock block={block} t={t} accent={accent} linkSty={linkSty} d={d} cursor={cursor} fire={fire} />;

    case 'contact':
      return <ContactBlock block={block} t={t} accent={accent} atc={atc} linkSty={linkSty} interactive={interactive} onLead={onLead} />;

    case 'booking':
      return block.url ? (
        <iframe src={block.url} title="Booking" loading="lazy" style={{ width: '100%', height: block.height || 660, border: 0, borderRadius: linkSty.borderRadius, background: '#fff' }} />
      ) : (
        <Placeholder t={t} label="Booking" radius={linkSty.borderRadius} />
      );

    case 'collection':
      return <CollectionBlock block={block} t={t} accent={accent} linkSty={linkSty} d={d} interactive={interactive} fire={fire} />;

    // Tournaments are retired. A page saved before that may still carry this
    // block, so render NOTHING rather than (a) advertising "My tournament 🏆"
    // on a public creator page or (b) falling through to the default LinkBlock,
    // which would draw a dead link to a route that no longer exists.
    case 'vergr_tournament':
      return null;

    case 'vergr_stream':
    case 'vergr_event':
    case 'vergr_squad':
    case 'vergr_group':
      return (
        <CardButton fire={fire} block={block} cursor={cursor} linkSty={linkSty} t={t} d={d}
          emoji={VERGR_EMOJI[block.type]} title={block._title || VERGR_LABEL[block.type]} subtitle={block._subtitle || 'View on Vergr'} accent={accent} highlight />
      );

    case 'countdown':
      return <CountdownBlock block={block} t={t} accent={accent} atc={atc} linkSty={linkSty} interactive={interactive} fire={fire} />;

    case 'faq':
      return <FaqBlock block={block} t={t} accent={accent} linkSty={linkSty} font={font} />;

    case 'map':
      return <MapBlock block={block} t={t} accent={accent} linkSty={linkSty} />;

    case 'divider':
      return <DividerBlock block={block} t={t} />;

    case 'membership':
      return <MembershipPromo block={block} t={t} accent={accent} atc={atc} linkSty={linkSty} font={font} interactive={interactive} fire={fire} />;

    case 'digital_product':
      return <DigitalProductBlock block={block} t={t} accent={accent} linkSty={linkSty} interactive={interactive} fire={fire} />;

    case 'shop_catalog':
      return <ShopCatalogBlock block={block} t={t} accent={accent} linkSty={linkSty} font={font} interactive={interactive} fire={fire} />;

    case 'link':
    default:
      return <LinkBlock block={block} t={t} accent={accent} linkSty={linkSty} d={d} interactive={interactive} fire={fire} cursor={cursor} />;
  }
}

// Group blocks into rows: consecutive half-width link blocks tile into a
// 2-column grid; everything else is a full-width row. Featured links stay full.
function groupRows(blocks) {
  const rows = [];
  let i = 0;
  const isHalf = (b) => b.type === 'link' && b.size === 'half' && !b.featured;
  while (i < blocks.length) {
    if (isHalf(blocks[i])) {
      const items = [];
      while (i < blocks.length && isHalf(blocks[i])) { items.push(blocks[i]); i++; }
      for (let j = 0; j < items.length; j += 2) rows.push({ grid: true, items: items.slice(j, j + 2) });
    } else {
      rows.push({ grid: false, items: [blocks[i]] });
      i++;
    }
  }
  return rows;
}

// Link card with optional behaviours: animation, sensitive-content blur,
// 18+ age gate, and passcode lock (all gates run only on the live page).
function LinkBlock({ block, t, accent, linkSty, d = {}, interactive, fire, cursor }) {
  const [revealed, setRevealed] = useState(!block.sensitive);
  const [gate, setGate] = useState(null); // 'age' | 'pass'
  const [pass, setPass] = useState('');
  const [err, setErr] = useState(false);
  const doFire = fire(block);

  const animClass = ({ pulse: 'vm-pulse', wobble: 'vm-wobble', shake: 'vm-shake', flash: 'vm-flash' })[
    block.animation || (block.highlight ? 'pulse' : '')
  ] || '';

  const proceed = () => {
    if (block.ageGate) { setGate('age'); return; }
    if (block.passcode) { setGate('pass'); return; }
    doFire && doFire();
  };
  const onClick = !interactive ? undefined : () => {
    if (block.sensitive && !revealed) { setRevealed(true); return; }
    proceed();
  };
  const submitPass = () => {
    if (pass === block.passcode) { setGate(null); setPass(''); setErr(false); doFire && doFire(); }
    else setErr(true);
  };

  const panel = { position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '0 12px', borderRadius: linkSty.borderRadius, background: t.bg, border: `1px solid ${t.border}`, zIndex: 2 };
  const gbtn = (bg, col) => ({ padding: '6px 12px', borderRadius: 8, fontSize: 12, fontWeight: 700, background: bg, color: col, border: 'none', cursor });

  // Showcase / featured: a large image-led card. Standard: an icon row. Both
  // now share ONE onClick, so the age/passcode gate + sensitive blur apply to a
  // featured card too (it previously opened straight through, ignoring them).
  const bs = resolveBlockStyle(block, { ...linkSty, ...d.card }, t, accent);
  const cardStyle = { width: '100%', cursor, ...bs.card, filter: block.sensitive && !revealed ? 'blur(6px)' : undefined };
  const card = block.featured ? (
    <button className={`lbtn ${animClass}`} onClick={onClick} style={{ ...cardStyle, padding: 0, overflow: 'hidden', display: 'block' }}>
      {block.thumbUrl && <img src={block.thumbUrl} alt="" loading="lazy" decoding="async" style={{ width: '100%', maxHeight: 200, objectFit: 'cover', display: 'block' }} />}
      <div style={{ padding: '14px 16px', textAlign: 'left' }}>
        <div style={{ fontSize: 16, fontWeight: 700, color: bs.text, ...d.title }}>{block.title || 'Featured'}</div>
        {block.subtitle && <div style={{ fontSize: 12, color: bs.card.color || t.textSub, marginTop: 3, opacity: 0.85 }}>{block.subtitle}</div>}
      </div>
    </button>
  ) : (
    <button className={`lbtn ${animClass}`} onClick={onClick} style={{ ...cardStyle, display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px' }}>
      {!d.hideIcon && (block.thumbUrl ? (
        <img src={block.thumbUrl} alt="" style={{ width: 36, height: 36, borderRadius: 9, objectFit: 'cover', ...d.iconWrap }} />
      ) : (!block.icon && faviconFor(block.url)) ? (
        <div style={{ width: 36, height: 36, borderRadius: 9, background: t.iconBg, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, ...d.iconWrap }}>
          <img src={faviconFor(block.url)} alt="" loading="lazy" width={20} height={20} style={{ borderRadius: 4 }} />
        </div>
      ) : (
        <IconTile t={t} emoji={block.icon || '🔗'} extra={d.iconWrap} />
      ))}
      <div className="flex-1 min-w-0" style={{ textAlign: 'left' }}>
        <div style={{ fontSize: 14, fontWeight: 500, color: bs.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', ...d.title }}>
          {d.titlePrefix}{block.title || 'Link'}
        </div>
        {block.subtitle && (
          <div style={{ fontSize: 11, color: bs.card.color ? bs.card.color : t.textSub, opacity: bs.card.color ? 0.8 : 1, marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {block.subtitle}
          </div>
        )}
      </div>
      <span style={{ fontSize: 16, color: block.style?.accent ? bs.accent : (bs.card.color || t.textMuted), ...d.trailStyle }}>{d.trail || '›'}</span>
    </button>
  );

  return (
    <div style={{ width: '100%', position: 'relative' }}>
      {card}
      <LinkBadges block={block} t={t} interactive={interactive} />

      {block.sensitive && !revealed && (
        <div onClick={onClick} style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, cursor, color: t.text, fontSize: 12, fontWeight: 600 }}>
          🔞 Sensitive content — tap to view
        </div>
      )}

      {gate === 'age' && (
        <div style={panel}>
          <span style={{ fontSize: 12, color: t.text }}>Are you 18 or older?</span>
          <button style={gbtn(accent, needsDarkText(accent) ? '#111' : '#fff')} onClick={() => { if (block.passcode) setGate('pass'); else { setGate(null); doFire && doFire(); } }}>Yes</button>
          <button style={gbtn(t.surface, t.textSub)} onClick={() => setGate(null)}>No</button>
        </div>
      )}

      {gate === 'pass' && (
        <div style={panel}>
          <input
            autoFocus type="password" value={pass}
            onChange={(e) => { setPass(e.target.value); setErr(false); }}
            onKeyDown={(e) => e.key === 'Enter' && submitPass()}
            placeholder="Passcode" style={{ flex: 1, minWidth: 0, padding: '6px 10px', borderRadius: 8, background: t.surface, border: `1px solid ${err ? '#F04060' : t.border}`, color: t.text, fontSize: 12, outline: 'none' }}
          />
          <button style={gbtn(accent, needsDarkText(accent) ? '#111' : '#fff')} onClick={submitPass}>Unlock</button>
          <button style={gbtn(t.surface, t.textSub)} onClick={() => { setGate(null); setPass(''); setErr(false); }}>✕</button>
        </div>
      )}
    </div>
  );
}

// Passive state badges on the card itself, so a lock/age/schedule is VISIBLE
// before a tap instead of only being discovered on tap. Age (18+) and passcode
// always show (visitor + creator); the schedule clock shows only in the editor
// preview (the live page just hides an out-of-window block).
function LinkBadges({ block, t, interactive }) {
  const badges = [];
  if (block.ageGate) badges.push({ k: 'age', el: '18+', bg: 'rgba(240,64,96,0.92)', bd: 'rgba(255,255,255,0.28)' });
  if (block.passcode) badges.push({ k: 'lock', el: '🔒', bg: 'rgba(0,0,0,0.42)', bd: t.border });
  if (!interactive && (block.startAt || block.endAt)) badges.push({ k: 'sched', el: '🕑', bg: 'rgba(0,0,0,0.42)', bd: t.border });
  if (!badges.length) return null;
  return (
    <div style={{ position: 'absolute', top: 7, right: 9, display: 'flex', gap: 4, zIndex: 4, pointerEvents: 'none' }}>
      {badges.map((b) => (
        <span key={b.k} style={{ display: 'inline-flex', alignItems: 'center', height: 18, padding: '0 6px', fontSize: 10, fontWeight: 800, letterSpacing: '0.02em', lineHeight: 1, color: '#fff', background: b.bg, border: `1px solid ${b.bd}`, borderRadius: 6, backdropFilter: 'blur(4px)', WebkitBackdropFilter: 'blur(4px)' }}>
          {b.el}
        </span>
      ))}
    </div>
  );
}

function CardButton({ fire, block, cursor, linkSty, t, d = {}, emoji, title, subtitle, accent, highlight }) {
  const bs = resolveBlockStyle(block, { ...linkSty, ...d.card }, t, accent);
  return (
    <button className={`lbtn ${highlight ? 'vm-highlight' : ''}`} onClick={fire(block)} style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', cursor, ...bs.card }}>
      {!d.hideIcon && <IconTile t={t} emoji={emoji} extra={d.iconWrap} />}
      <div className="flex-1 min-w-0" style={{ textAlign: 'left' }}>
        <div style={{ fontSize: 14, fontWeight: 500, color: bs.text, ...d.title }}>{d.titlePrefix}{title}</div>
        {subtitle && <div style={{ fontSize: 11, color: bs.card.color ? bs.card.color : t.textSub, marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{subtitle}</div>}
      </div>
      <span style={{ fontSize: 16, color: block.style?.accent ? bs.accent : (bs.card.color || t.textMuted), ...d.trailStyle }}>{d.trail || '›'}</span>
    </button>
  );
}

// Invite & earn — the viral loop card. Inherently a Vergr block, so it carries
// a light Vergr-accent gradient. Tap → owner's reflink (handled in VergrMePage).
function InviteBlock({ block, t, accent, atc, linkSty, cursor, fire }) {
  return (
    <button
      className="lbtn"
      onClick={fire(block)}
      style={{
        width: '100%', display: 'flex', alignItems: 'center', gap: 12, padding: '14px 16px',
        borderRadius: linkSty.borderRadius, border: `1px solid ${accent}40`, cursor,
        background: `linear-gradient(135deg, ${accent}26, ${accent}0D)`,
      }}
    >
      <div style={{ width: 40, height: 40, borderRadius: 11, background: accent, color: atc, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, flexShrink: 0 }}>🎁</div>
      <div className="flex-1 min-w-0" style={{ textAlign: 'left' }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: t.text }}>{block.label || 'Join me on Vergr'}</div>
        <div style={{ fontSize: 11, color: t.textSub, marginTop: 2 }}>We both earn rewards when you sign up</div>
      </div>
      <span style={{ fontSize: 16, color: accent }}>›</span>
    </button>
  );
}

// Services / pricing — a titled list of offerings, each optionally tappable.
function ServicesBlock({ block, t, accent, linkSty, d = {}, cursor, fire }) {
  const items = (block.items || []).filter((it) => it && (it.name || it.price));
  if (!items.length) return <Placeholder t={t} label="Services" radius={linkSty.borderRadius} />;
  return (
    <div style={{ width: '100%' }}>
      {block.title && (
        <p style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: t.textSub, marginBottom: 10, textAlign: 'center' }}>{block.title}</p>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {items.map((it, i) => {
          const tappable = !!it.url;
          const Row = tappable ? 'button' : 'div';
          return (
            <Row key={i} className={tappable ? 'lbtn' : ''} onClick={tappable ? fire({ type: 'link', url: it.url, id: `${block.id}:${i}` }) : undefined}
              style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', cursor: tappable ? cursor : 'default', textAlign: 'left', ...linkSty, ...d.card }}>
              <div className="flex-1 min-w-0">
                <div style={{ fontSize: 14, fontWeight: 600, color: linkSty.color || t.text }}>{it.name || 'Service'}</div>
                {it.desc && <div style={{ fontSize: 11, color: t.textSub, marginTop: 2 }}>{it.desc}</div>}
              </div>
              {it.price && <span style={{ fontSize: 14, fontWeight: 700, color: accent, whiteSpace: 'nowrap' }}>{it.price}</span>}
              {tappable && <span style={{ fontSize: 16, color: linkSty.color || t.textMuted, ...d.trailStyle }}>{d.trail || '›'}</span>}
            </Row>
          );
        })}
      </div>
    </div>
  );
}

// Native contact form → owner's vergrMeLeads (via handlers.onLead on the live
// page; inert in the editor preview). Email always required.
function ContactBlock({ block, t, accent, atc, linkSty, interactive, onLead }) {
  const [v, setV] = useState({ name: '', email: '', phone: '', message: '' });
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(false);
  const [failed, setFailed] = useState(false);
  const inputSty = { width: '100%', padding: '10px 12px', borderRadius: 10, background: t.surface, border: `1px solid ${t.border}`, color: t.text, fontSize: 13, outline: 'none' };

  const submit = async (e) => {
    e.preventDefault();
    if (!interactive) return;
    if (!/.+@.+\..+/.test(v.email)) { setErr(true); return; }
    // No sink for the lead = it would go nowhere; never fake a success.
    if (!onLead) { setFailed(true); return; }
    setBusy(true); setFailed(false);
    try {
      const lead = { email: v.email.slice(0, 180), name: (v.name || '').slice(0, 120) };
      if (block.message !== false) lead.message = (v.message || '').slice(0, 2000);
      if (block.phone) lead.phone = (v.phone || '').slice(0, 40);
      await onLead(lead);
      setSent(true);
    } catch {
      // Save failed — tell the visitor so they can retry, instead of
      // confirming a message that the page owner will never receive.
      setFailed(true);
    } finally { setBusy(false); }
  };

  if (sent) {
    return (
      <div style={{ width: '100%', padding: '16px', borderRadius: linkSty.borderRadius, background: t.surface, border: `1px solid ${t.border}`, textAlign: 'center', color: t.text, fontSize: 13 }}>
        ✓ Thanks — your message was sent.
      </div>
    );
  }
  return (
    <form onSubmit={submit} style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 8 }}>
      {block.title && <p style={{ fontSize: 13, fontWeight: 600, color: t.text, marginBottom: 2 }}>{block.title}</p>}
      <input style={inputSty} placeholder="Your name" value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} />
      <input style={{ ...inputSty, borderColor: err ? '#F04060' : t.border }} type="email" placeholder="Your email" value={v.email} onChange={(e) => { setV({ ...v, email: e.target.value }); setErr(false); }} />
      {block.phone && <input style={inputSty} type="tel" placeholder="Your phone" value={v.phone} onChange={(e) => setV({ ...v, phone: e.target.value })} />}
      {block.message !== false && <textarea style={{ ...inputSty, resize: 'vertical', minHeight: 76 }} placeholder="Message" value={v.message} onChange={(e) => setV({ ...v, message: e.target.value })} />}
      {failed && <p style={{ fontSize: 12, color: '#F04060', margin: 0 }}>Couldn't send just now. Please try again.</p>}
      <button type="submit" disabled={busy} style={{ width: '100%', padding: '12px 16px', borderRadius: linkSty.borderRadius, border: 'none', background: accent, color: atc, fontSize: 14, fontWeight: 700, cursor: interactive ? 'pointer' : 'default', opacity: busy ? 0.6 : 1 }}>
        {busy ? 'Sending…' : (failed ? 'Try again' : (block.label || 'Send'))}
      </button>
    </form>
  );
}

// Destination favicon for a bare link block (no custom thumb/emoji). Google's
// public s2 endpoint is free and cached; a broken host just renders nothing
// visible inside the tile.
function faviconFor(url) {
  try {
    const host = new URL(url).hostname;
    return host ? `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=64` : null;
  } catch { return null; }
}

function IconTile({ t, emoji, extra }) {
  return (
    <div style={{ width: 36, height: 36, borderRadius: 9, background: t.iconBg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, flexShrink: 0, ...extra }}>
      {emoji}
    </div>
  );
}

function Placeholder({ t, label, radius }) {
  return (
    <div style={{ width: '100%', aspectRatio: '16/9', borderRadius: radius || 12, background: t.surface, border: `1px dashed ${t.border}`, display: 'flex', alignItems: 'center', justifyContent: 'center', color: t.textMuted, fontSize: 12 }}>
      {label}
    </div>
  );
}

const VERGR_EMOJI = { vergr_stream: '🔴', vergr_event: '🎟️', vergr_squad: '🛡️', vergr_group: '💬' };
const VERGR_LABEL = { vergr_stream: 'My live stream', vergr_event: 'Ticketed event', vergr_squad: 'My squad', vergr_group: 'Join my group' };

// Small dashed note used for editor-only states (a block that renders nothing on
// the live page still needs to be visible + explained while editing).
function EditorNote({ t, radius, children }) {
  return (
    <div style={{ width: '100%', padding: '11px 13px', borderRadius: radius || 12, background: t.surface, border: `1px dashed ${t.border}`, color: t.textMuted, fontSize: 11, lineHeight: 1.5, textAlign: 'center' }}>
      {children}
    </div>
  );
}

// Countdown: a live DD/HH/MM/SS timer to a target datetime. On zero it can hide
// (removed from the live page), show a message, or reveal a link button.
function CountdownBlock({ block, t, accent, atc, linkSty, interactive, fire }) {
  const [now, setNow] = useState(Date.now());
  const target = block.target ? new Date(block.target).getTime() : 0;
  useEffect(() => {
    if (!target) return undefined;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [target]);

  const tileRadius = Math.min(linkSty.borderRadius ?? 14, 16);
  const bs = resolveBlockStyle(block, { background: t.surface, border: `1px solid ${t.border}`, borderRadius: tileRadius }, t, accent);

  if (!target) {
    return interactive ? null : <EditorNote t={t} radius={linkSty.borderRadius}>Set a target date for this countdown.</EditorNote>;
  }

  const diff = target - now;
  if (diff <= 0) {
    const mode = block.expired || 'hide';
    if (mode === 'reveal' && block.revealUrl) {
      const rbs = resolveBlockStyle(block, { background: accent, color: atc, border: 'none', borderRadius: linkSty.borderRadius }, t, accent);
      return (
        <button className="lbtn" onClick={fire({ type: 'link', url: block.revealUrl, id: block.id })}
          style={{ width: '100%', padding: '14px 16px', ...rbs.card, fontSize: 15, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, cursor: interactive ? 'pointer' : 'default' }}>
          <span>🎉</span> {block.revealLabel || 'It’s here — open now'}
        </button>
      );
    }
    if (mode === 'hide') {
      return interactive ? null : <EditorNote t={t} radius={linkSty.borderRadius}>Countdown reached zero — hidden on the live page.</EditorNote>;
    }
    return (
      <div style={{ width: '100%', textAlign: 'center', padding: '16px', ...bs.card, color: bs.text, fontSize: 14, fontWeight: 600 }}>
        {block.endedText || 'This has ended'}
      </div>
    );
  }

  const s = Math.floor(diff / 1000);
  const units = [
    [Math.floor(s / 86400), 'Days'],
    [Math.floor((s % 86400) / 3600), 'Hrs'],
    [Math.floor((s % 3600) / 60), 'Min'],
    [s % 60, 'Sec'],
  ];
  return (
    <div style={{ width: '100%' }}>
      {block.title && (
        <p style={{ textAlign: 'center', fontSize: 12, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: block.style?.text || t.textSub, marginBottom: 10 }}>{block.title}</p>
      )}
      <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
        {units.map(([val, label], i) => (
          <div key={i} style={{ flex: 1, maxWidth: 84, textAlign: 'center', padding: '12px 4px', ...bs.card }}>
            <div style={{ fontSize: 26, fontWeight: 800, lineHeight: 1, color: bs.accent, fontVariantNumeric: 'tabular-nums', fontFeatureSettings: '"tnum"' }}>{String(val).padStart(2, '0')}</div>
            <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: t.textMuted, marginTop: 5 }}>{label}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// FAQ: tap-to-expand accordion. Works in the editor preview too (local state,
// no side effects) so the creator can check their answers.
function FaqBlock({ block, t, accent, linkSty, font }) {
  const [open, setOpen] = useState(null);
  const items = (block.items || []).filter((it) => it && (it.q || it.a));
  if (!items.length) return null;
  const radius = Math.min(linkSty.borderRadius ?? 14, 16);
  const bs = resolveBlockStyle(block, { background: t.surface, border: `1px solid ${t.border}`, borderRadius: radius }, t, accent);
  return (
    <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 8 }}>
      {block.title && (
        <p style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: block.style?.text || t.textSub, textAlign: 'center', marginBottom: 2, fontFamily: font.heading }}>{block.title}</p>
      )}
      {items.map((it, i) => {
        const isOpen = open === i;
        return (
          <div key={i} style={{ ...bs.card, overflow: 'hidden' }}>
            <button onClick={() => setOpen(isOpen ? null : i)} style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '13px 15px', background: 'transparent', border: 'none', cursor: 'pointer', textAlign: 'left' }}>
              <span style={{ flex: 1, fontSize: 13.5, fontWeight: 600, color: bs.text }}>{it.q || 'Question'}</span>
              <span style={{ fontSize: 20, color: bs.accent, lineHeight: 1, transform: isOpen ? 'rotate(45deg)' : 'none', transition: 'transform 0.2s ease' }}>+</span>
            </button>
            {isOpen && it.a && (
              <div style={{ padding: '0 15px 14px', fontSize: 12.5, lineHeight: 1.6, color: block.style?.text ? bs.text : t.textSub, whiteSpace: 'pre-line' }}>{it.a}</div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// Map: an address on a zero-cost, no-API-key Google Maps embed (the legacy
// output=embed iframe, same class as our other embeds — no billing).
function MapBlock({ block, t, accent, linkSty }) {
  if (!block.address) return <Placeholder t={t} label="Add an address" radius={linkSty.borderRadius} />;
  const src = `https://maps.google.com/maps?q=${encodeURIComponent(block.address)}&z=${block.zoom || 14}&output=embed`;
  const bs = resolveBlockStyle(block, { border: `1px solid ${t.border}`, borderRadius: linkSty.borderRadius }, t, accent);
  return (
    <div style={{ width: '100%' }}>
      <div style={{ width: '100%', height: block.height || 220, overflow: 'hidden', ...bs.card }}>
        <iframe src={src} title={block.address} loading="lazy" referrerPolicy="no-referrer-when-downgrade" style={{ width: '100%', height: '100%', border: 0 }} />
      </div>
      {block.caption && <p style={{ fontSize: 11, color: block.style?.text || t.textMuted, textAlign: 'center', marginTop: 6 }}>{block.caption}</p>}
    </div>
  );
}

// Divider: line / dashed / dots / pure space, with an optional centered label.
// The per-block accent/text colour recolours the line, dots and label.
function DividerBlock({ block, t }) {
  const variant = block.variant || 'line';
  const pad = { sm: 4, md: 10, lg: 20 }[block.spacing || 'md'];
  const custom = block.style?.accent || block.style?.text;
  if (variant === 'space') return <div style={{ width: '100%', height: pad * 2 }} />;
  if (variant === 'dots') {
    return (
      <div style={{ width: '100%', padding: `${pad}px 0`, display: 'flex', gap: 6, justifyContent: 'center' }}>
        {[0, 1, 2].map((i) => <span key={i} style={{ width: 5, height: 5, borderRadius: 999, background: custom || t.textMuted }} />)}
      </div>
    );
  }
  const line = { flex: 1, height: 0, borderTop: `1px ${variant === 'dashed' ? 'dashed' : 'solid'} ${custom || t.border}` };
  return (
    <div style={{ width: '100%', padding: `${pad}px 0`, display: 'flex', alignItems: 'center', gap: 12 }}>
      <span style={line} />
      {block.label && <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: custom || t.textMuted, whiteSpace: 'nowrap' }}>{block.label}</span>}
      {block.label && <span style={line} />}
    </div>
  );
}

// Membership: the creator's PUBLISHED tiers (enriched with live data on the
// public page). Subscribe taps route into the app (auth + wallet live there).
function MembershipPromo({ block, t, accent, atc, linkSty, font, interactive, fire }) {
  const tiers = block._tiers || [];
  if (!tiers.length) {
    // Live page with no published tiers → render nothing. Editor → explain.
    return interactive ? null : (
      <EditorNote t={t} radius={linkSty.borderRadius}>Your published membership tiers appear here. Create them in Creator Studio → Memberships.</EditorNote>
    );
  }
  const radius = Math.min(linkSty.borderRadius ?? 14, 18);
  const bs = resolveBlockStyle(block, { background: t.surface, border: `1px solid ${t.border}`, borderRadius: radius }, t, accent);
  const acc = bs.accent;
  const accTxt = needsDarkText(acc) ? '#111' : '#fff';
  return (
    <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 10 }}>
      {block.title && (
        <p style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: block.style?.text || t.textSub, textAlign: 'center', fontFamily: font.heading }}>{block.title}</p>
      )}
      {tiers.map((tier) => {
        const gem = tier.badge?.color || acc;
        const perks = (tier.perks || []).filter(Boolean).slice(0, 3);
        return (
          <div key={tier.id} style={{ position: 'relative', ...bs.card, border: tier.popular ? `1px solid ${acc}` : bs.card.border, padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
            {tier.popular && (
              <span style={{ position: 'absolute', top: -8, right: 14, fontSize: 9, fontWeight: 800, letterSpacing: '0.06em', textTransform: 'uppercase', color: accTxt, background: acc, padding: '2px 8px', borderRadius: 999 }}>Popular</span>
            )}
            <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
              <span style={{ width: 22, height: 22, borderRadius: 6, background: gem, transform: 'rotate(45deg)', flexShrink: 0, boxShadow: `0 0 10px ${gem}66` }} />
              <div style={{ flex: 1, minWidth: 0, fontSize: 14, fontWeight: 700, color: bs.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{tier.name || 'Member'}</div>
              <div style={{ textAlign: 'right', flexShrink: 0 }}>
                <div style={{ fontSize: 15, fontWeight: 800, color: acc, fontVariantNumeric: 'tabular-nums' }}>● {Number(tier.priceCoins || 0).toLocaleString()}</div>
                <div style={{ fontSize: 9, color: t.textMuted, marginTop: 1 }}>coins / mo</div>
              </div>
            </div>
            {perks.length > 0 && (
              <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 5 }}>
                {perks.map((p, i) => (
                  <li key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 7, fontSize: 11.5, color: block.style?.text ? bs.text : t.textSub, lineHeight: 1.4 }}>
                    <span style={{ color: acc, fontWeight: 800, flexShrink: 0 }}>✓</span><span style={{ flex: 1 }}>{p}</span>
                  </li>
                ))}
              </ul>
            )}
            <button className="lbtn" onClick={fire({ ...block, _tierId: tier.id })} style={{ width: '100%', padding: '10px', borderRadius: Math.min(radius, 12), border: 'none', background: acc, color: accTxt, fontSize: 13, fontWeight: 700, cursor: interactive ? 'pointer' : 'default' }}>
              Subscribe
            </button>
          </div>
        );
      })}
    </div>
  );
}

// Digital product: wallet-native paid download. Enriched with `_product`
// (the seller's public vergrMeProducts doc) and `_owned` (this signed-in
// viewer already bought it) on the live page; the editor preview explains.
function DigitalProductBlock({ block, t, accent, linkSty, interactive, fire }) {
  const p = block._product;
  if (!p) {
    return interactive ? null : (
      <EditorNote t={t} radius={linkSty.borderRadius}>
        {block.productId ? 'Your digital product renders here on the live page.' : 'Pick a product for this block (or create one in the Products tab).'}
      </EditorNote>
    );
  }
  const radius = Math.min(linkSty.borderRadius ?? 14, 18);
  const bs = resolveBlockStyle(block, { background: t.surface, border: `1px solid ${t.border}`, borderRadius: radius }, t, accent);
  const acc = bs.accent;
  const accTxt = needsDarkText(acc) ? '#111' : '#fff';
  const owned = !!block._owned;
  const price = Number(p.priceCoins || 0);
  const physical = p.kind === 'physical';
  // Synced through the public Shopify app: paid in the store's own currency at
  // Shopify Checkout, so showing a coin price here would be a straight lie.
  const permalink = p.checkoutMode === 'permalink';
  const storePrice = permalink
    ? `${(p.variants?.[0]?.storePrice || p.storePrice || '')} ${p.storeCurrency || ''}`.trim()
    : '';
  const fromPrice = permalink && (p.variants || []).length > 1;
  const ship = physical ? Math.max(0, Number(p.shippingCoins) || 0) : 0;
  const soldOut = physical && typeof p.stock === 'number' && p.stock <= 0;
  const lowStock = physical && typeof p.stock === 'number' && p.stock > 0 && p.stock <= 5;
  const canTap = interactive && !soldOut;
  return (
    <div style={{ ...bs.card, overflow: 'hidden', width: '100%' }}>
      {p.coverUrl && (
        <img src={p.coverUrl} alt="" loading="lazy" decoding="async" style={{ width: '100%', aspectRatio: '16/9', objectFit: 'cover', display: 'block', ...(soldOut ? { filter: 'grayscale(1) brightness(0.7)' } : {}) }} />
      )}
      <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
          <div style={{ flex: 1, minWidth: 0, fontSize: 14.5, fontWeight: 700, color: bs.text }}>{p.name || 'Product'}</div>
          {permalink ? (
            <div style={{ flexShrink: 0, fontSize: 14, fontWeight: 800, color: bs.text, fontVariantNumeric: 'tabular-nums' }}>
              {fromPrice && <span style={{ fontSize: 10, fontWeight: 600, opacity: 0.6, marginRight: 3 }}>from</span>}
              {storePrice}
            </div>
          ) : (
            <div style={{ flexShrink: 0, fontSize: 14, fontWeight: 800, color: '#F0A500', fontVariantNumeric: 'tabular-nums' }}>● {price.toLocaleString()}<span style={{ fontSize: 10, fontWeight: 600, marginLeft: 2 }}>coins</span></div>
          )}
        </div>
        {p.desc && (
          <p style={{ fontSize: 11.5, color: block.style?.text ? bs.text : t.textSub, lineHeight: 1.45, display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{p.desc}</p>
        )}
        {!physical && p.fileName && (
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 10.5, color: t.textMuted, background: t.iconBg, borderRadius: 8, padding: '4px 8px', alignSelf: 'flex-start', maxWidth: '100%' }}>
            <span aria-hidden>📦</span>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.fileName}</span>
            <span style={{ flexShrink: 0 }}>· instant download</span>
          </div>
        )}
        {physical && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 10.5, color: t.textMuted, flexWrap: 'wrap' }}>
            {/* Shopify calculates shipping at its own checkout, so we must not
                promise a coin shipping cost (or "free") we do not control. */}
            <span style={{ background: t.iconBg, borderRadius: 8, padding: '4px 8px' }}>
              {permalink ? '🚚 Shipping calculated at checkout'
                : ship > 0 ? `🚚 + ${ship.toLocaleString()} coins shipping` : '🚚 Free shipping'}
            </span>
            {lowStock && <span style={{ background: 'rgba(240,64,96,0.14)', color: '#F04060', borderRadius: 8, padding: '4px 8px', fontWeight: 700 }}>Only {p.stock} left</span>}
          </div>
        )}
        <button
          className="lbtn"
          onClick={canTap ? fire(block) : undefined}
          disabled={soldOut}
          style={{ width: '100%', padding: '10px', marginTop: 2, borderRadius: Math.min(radius, 12), border: 'none', background: soldOut ? t.iconBg : acc, color: soldOut ? t.textMuted : accTxt, fontSize: 13, fontWeight: 700, cursor: canTap ? 'pointer' : 'default', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
        >
          {soldOut ? <>Sold out</>
            : permalink ? <>Buy{storePrice ? ` · ${storePrice}` : ''}</>
            : physical ? <>Buy · {(price + ship).toLocaleString()} coins{ship > 0 ? ' incl. shipping' : ''}</>
            : owned ? <>⬇ Download</>
            : <>Buy for {price.toLocaleString()} coins</>}
        </button>
      </div>
    </div>
  );
}

// Shop catalog: an EXTERNAL store's products (Shopify/WooCommerce import,
// snapshotted onto the block) as a swipeable carousel. Link-out only — the
// shop's own checkout handles payment.
function ShopCatalogBlock({ block, t, accent, linkSty, font, interactive, fire }) {
  const items = (block.items || []).filter((it) => it && it.title && it.url);
  if (!items.length) {
    return interactive ? null : (
      <EditorNote t={t} radius={linkSty.borderRadius}>Paste your Shopify or WooCommerce store URL in this block's settings and hit Import to show your products here.</EditorNote>
    );
  }
  const radius = Math.min(linkSty.borderRadius ?? 14, 18);
  const bs = resolveBlockStyle(block, { background: t.surface, border: `1px solid ${t.border}`, borderRadius: radius }, t, accent);
  const cur = block.currency || '';
  return (
    <div style={{ width: '100%' }}>
      {block.title && (
        <p style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: block.style?.text || t.textSub, textAlign: 'center', fontFamily: font?.heading, marginBottom: 8 }}>{block.title}</p>
      )}
      <div style={{ display: 'flex', gap: 10, overflowX: 'auto', paddingBottom: 4, scrollbarWidth: 'none', WebkitOverflowScrolling: 'touch' }}>
        {items.map((it, i) => (
          <button
            key={i}
            className="lbtn"
            onClick={fire({ type: 'link', url: it.url, id: `${block.id}:${i}` })}
            style={{ ...bs.card, width: 132, flexShrink: 0, padding: 0, overflow: 'hidden', textAlign: 'left', cursor: interactive ? 'pointer' : 'default', display: 'block' }}
          >
            {it.imageUrl ? (
              <img src={it.imageUrl} alt="" loading="lazy" decoding="async" style={{ width: '100%', aspectRatio: '1', objectFit: 'cover', display: 'block' }} />
            ) : (
              <div style={{ width: '100%', aspectRatio: '1', background: t.iconBg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 24 }}>🛍️</div>
            )}
            <div style={{ padding: '8px 10px' }}>
              <div style={{ fontSize: 11.5, fontWeight: 600, color: bs.text, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', lineHeight: 1.3, minHeight: 30 }}>{it.title}</div>
              {it.price && <div style={{ fontSize: 11.5, fontWeight: 800, color: bs.accent, marginTop: 3, fontVariantNumeric: 'tabular-nums' }}>{it.currency || cur}{it.price}</div>}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

// Collection: a group of links rendered in one of four structural layouts
// (stack / grid / carousel / showcase). Each item taps through like a link.
function CollectionBlock({ block, t, accent, linkSty, d = {}, interactive, fire }) {
  const items = (block.items || []).filter((it) => it && (it.title || it.url || it.thumbUrl));
  if (!items.length) return <Placeholder t={t} label="Collection" radius={linkSty.borderRadius} />;
  const layout = block.layout || 'grid';
  const cursor = interactive ? 'pointer' : 'default';
  const clickFor = (it, i) => fire({ type: 'link', url: it.url, id: `${block.id}:${i}` });

  const Tile = ({ it, i, big }) => (
    <button onClick={clickFor(it, i)} className="lbtn" style={{ width: '100%', padding: 0, overflow: 'hidden', display: 'block', cursor, textAlign: 'left', ...linkSty, ...d.card }}>
      {it.thumbUrl ? (
        <img src={it.thumbUrl} alt="" loading="lazy" decoding="async" style={{ width: '100%', aspectRatio: big ? '16/9' : '1', objectFit: 'cover', display: 'block' }} />
      ) : (
        <div style={{ width: '100%', aspectRatio: big ? '16/9' : '1', background: t.iconBg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22 }}>🔗</div>
      )}
      <div style={{ padding: big ? '12px 14px' : '8px 10px' }}>
        <div style={{ fontSize: big ? 15 : 12.5, fontWeight: 600, color: linkSty.color || t.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{it.title || 'Link'}</div>
        {it.subtitle && <div style={{ fontSize: 11, color: t.textSub, marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{it.subtitle}</div>}
      </div>
    </button>
  );

  const Row = ({ it, i }) => (
    <button onClick={clickFor(it, i)} className="lbtn" style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', cursor, ...linkSty, ...d.card }}>
      {it.thumbUrl ? <img src={it.thumbUrl} alt="" style={{ width: 36, height: 36, borderRadius: 9, objectFit: 'cover' }} /> : <IconTile t={t} emoji="🔗" extra={d.iconWrap} />}
      <div className="flex-1 min-w-0" style={{ textAlign: 'left' }}>
        <div style={{ fontSize: 14, fontWeight: 500, color: linkSty.color || t.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{it.title || 'Link'}</div>
        {it.subtitle && <div style={{ fontSize: 11, color: t.textSub, marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{it.subtitle}</div>}
      </div>
      <span style={{ fontSize: 16, color: linkSty.color || t.textMuted }}>›</span>
    </button>
  );

  return (
    <div style={{ width: '100%' }}>
      {block.title && (
        <p style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: t.textSub, marginBottom: 10 }}>{block.title}</p>
      )}
      {layout === 'stack' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>{items.map((it, i) => <Row key={i} it={it} i={i} />)}</div>
      )}
      {layout === 'grid' && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>{items.map((it, i) => <Tile key={i} it={it} i={i} />)}</div>
      )}
      {layout === 'carousel' && (
        <div style={{ display: 'flex', gap: 12, overflowX: 'auto', scrollSnapType: 'x mandatory', WebkitOverflowScrolling: 'touch', paddingBottom: 4, ...CAROUSEL_BLEED }}>
          {items.map((it, i) => <div key={i} style={{ width: '62%', flexShrink: 0, scrollSnapAlign: 'center' }}><Tile it={it} i={i} /></div>)}
        </div>
      )}
      {layout === 'showcase' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <Tile it={items[0]} i={0} big />
          {items.length > 1 && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>{items.slice(1).map((it, i) => <Tile key={i + 1} it={it} i={i + 1} />)}</div>
          )}
        </div>
      )}
    </div>
  );
}

// ---- Embed URL helpers ----------------------------------------
function videoEmbedUrl(block) {
  const url = block.url || '';
  const yt = url.match(/(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([\w-]{11})/);
  if (yt) return `https://www.youtube.com/embed/${yt[1]}`;
  const vimeo = url.match(/vimeo\.com\/(\d+)/);
  if (vimeo) return `https://player.vimeo.com/video/${vimeo[1]}`;
  // TikTok video → official embed player by video id.
  const tt = url.match(/tiktok\.com\/(?:@[\w.]+\/video\/|v\/)(\d+)/);
  if (tt) return `https://www.tiktok.com/embed/v2/${tt[1]}`;
  // Twitch channel or VOD. Needs parent= the host serving the page.
  if (block.provider === 'twitch' || url.includes('twitch.tv')) {
    const parent = typeof window !== 'undefined' ? window.location.hostname : 'vergr.me';
    const vod = url.match(/twitch\.tv\/videos\/(\d+)/);
    if (vod) return `https://player.twitch.tv/?video=${vod[1]}&parent=${parent}&autoplay=false`;
    const chan = url.match(/twitch\.tv\/([\w]+)/);
    if (chan) return `https://player.twitch.tv/?channel=${chan[1]}&parent=${parent}&autoplay=false`;
  }
  return null;
}

function musicEmbedUrl(block) {
  const url = block.url || '';
  if (block.provider === 'spotify' || url.includes('spotify.com')) {
    const m = url.match(/spotify\.com\/(track|album|playlist|artist)\/([\w]+)/);
    if (m) return `https://open.spotify.com/embed/${m[1]}/${m[2]}`;
  }
  if (block.provider === 'soundcloud' || url.includes('soundcloud.com')) {
    return `https://w.soundcloud.com/player/?url=${encodeURIComponent(url)}&color=%23B44FFF`;
  }
  // Apple Music → embed.music.apple.com mirrors the public URL path.
  if (block.provider === 'apple' || url.includes('music.apple.com')) {
    const m = url.match(/music\.apple\.com\/(.+)$/);
    if (m) return `https://embed.music.apple.com/${m[1]}`;
  }
  return null;
}
