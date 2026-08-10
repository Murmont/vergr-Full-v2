// Cinematic 8-beat walkthrough — production-grade rewrite 2026-05-19.
//
// What changed vs the old port:
//   - RAF loop writes directly to DOM via refs. Zero React renders per frame.
//   - 4.5s per beat (was 7.6s). Total ~36s (was 60s).
//   - 400ms crossfade between beats. Real /brand/logo.png in Beat 1.
//   - Beat 3 rebuilt as CSS Grid so labels can't stack on top of each other.
//   - Beat 4 uses the real gem PNG (/brand/gems.webp) via GemGlyph primitive.
//   - Beat 7 claims rewritten — no false EMI / quarterly-audit claims.
//   - Respects prefers-reduced-motion.
//
// Keyboard:  →/Space next · ← prev · Esc skip.

import { useEffect, useMemo, useRef, useState, memo } from 'react';
import Icon from '../Icon';
import { CoinGlyph, GemGlyph, WALLET_TOKENS } from './primitives';

const TOTAL_BEATS = 8;
const BEAT_DURATION_MS = 4500;
const CROSSFADE_MS = 400;
const BEAT_LABELS = ['ARRIVAL', 'TWO CURRENCIES', 'EARNINGS', 'CASH OUT', 'PROTECTION', 'SEVEN DAYS', 'TRUST', 'BEGIN'];

const FONT_DISPLAY = 'Syne, system-ui, sans-serif';
const FONT_MONO = 'DM Mono, monospace';

const prefersReducedMotion = () =>
  typeof window !== 'undefined' &&
  window.matchMedia &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// ── Helper: Animated node ─────────────────────────────────────────
// Stores an apply(progress, node) callback on the DOM node. The RAF loop in
// Walkthrough walks the stage subtree and calls each one. React renders this
// component exactly once per beat.
function Animated({ apply, style, children, tag = 'div', ...rest }) {
  const ref = useRef(null);
  useEffect(() => {
    if (ref.current) ref.current.__apply = apply;
    return () => { if (ref.current) ref.current.__apply = null; };
  }, [apply]);
  const T = tag;
  return <T ref={ref} style={style} {...rest}>{children}</T>;
}

// ── BeatShell ─────────────────────────────────────────────────────
function BeatShell({ children, bg, vignette = true }) {
  return (
    <div style={{
      position: 'absolute', inset: 0,
      background: bg || 'radial-gradient(ellipse at center, #0d0a1a 0%, #050308 100%)',
      overflow: 'hidden',
      willChange: 'opacity',
    }}>
      {children}
      {vignette && (
        <div style={{
          position: 'absolute', inset: 0, pointerEvents: 'none',
          background: 'radial-gradient(ellipse at center, transparent 55%, rgba(0,0,0,0.65) 100%)',
        }} />
      )}
    </div>
  );
}

// ── Memoised particles (CSS keyframes; renders once per beat) ─────
const Particles = memo(function Particles({ count = 30, color = 'rgba(180,79,255,0.5)' }) {
  const dots = useMemo(() => Array.from({ length: count }).map(() => ({
    x: Math.random() * 100,
    y: Math.random() * 100,
    d: Math.random() * 3 + 1,
    delay: Math.random() * 2,
    dur: 3 + Math.random() * 4,
  })), [count]);
  return (
    <>
      {dots.map((d, i) => (
        <i key={i} style={{
          position: 'absolute',
          left: `${d.x}%`, top: `${d.y}%`,
          width: d.d, height: d.d, borderRadius: '50%',
          background: color,
          boxShadow: `0 0 ${d.d * 4}px ${color}`,
          opacity: 0.6,
          animation: `vgWalkFloatY ${d.dur}s ease-in-out ${d.delay}s infinite alternate`,
          willChange: 'transform',
        }} />
      ))}
      <style>{`@keyframes vgWalkFloatY { from { transform: translateY(0); } to { transform: translateY(-30px); } }`}</style>
    </>
  );
});

// ── Beat 1: Arrival ───────────────────────────────────────────────
const Beat1 = memo(function Beat1() {
  return (
    <BeatShell bg="radial-gradient(ellipse 900px 700px at 50% 48%, #14101e 0%, #0a0814 45%, #06040c 100%)">
      <Animated style={{
        position: 'absolute', left: '50%', top: '50%',
        width: 800, height: 800,
        background: 'radial-gradient(circle, rgba(123,31,255,0.25) 0%, transparent 60%)',
        filter: 'blur(20px)',
        transform: 'translate(-50%, -50%) scale(1)',
        opacity: 0,
        willChange: 'transform, opacity',
      }} apply={(p, n) => {
        n.style.opacity = Math.min(1, p * 3) * 0.8;
        n.style.transform = `translate(-50%, -50%) scale(${1 + p * 0.3})`;
      }} />

      <Particles count={36} />

      <Animated style={{
        position: 'absolute', left: '50%', top: '46%',
        transform: 'translate(-50%, -50%) scale(1)',
        textAlign: 'center', opacity: 0,
        willChange: 'transform, opacity',
      }} apply={(p, n) => {
        n.style.opacity = Math.min(1, p * 3);
        n.style.transform = `translate(-50%, -50%) scale(${1 + p * 0.08})`;
      }}>
        <img src="/brand/logo.png" alt="VERGR" style={{
          width: 120, height: 120, display: 'block', margin: '0 auto 28px',
          filter: 'drop-shadow(0 0 60px rgba(123,31,255,0.55))',
        }} />
        <div style={{
          fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 84,
          letterSpacing: '-0.04em', lineHeight: 1, color: WALLET_TOKENS.text,
        }}>VERGR Wallet</div>
      </Animated>

      <Animated style={{
        position: 'absolute', left: '50%', bottom: '20%',
        transform: 'translate(-50%, 24px)',
        opacity: 0, textAlign: 'center', maxWidth: 600,
        willChange: 'transform, opacity',
      }} apply={(p, n) => {
        n.style.opacity = Math.max(0, (p - 0.3) * 1.8);
        n.style.transform = `translate(-50%, ${Math.max(0, (1 - p * 1.4)) * 24}px)`;
      }}>
        <div style={{ fontSize: 19, color: WALLET_TOKENS.textSecondary, lineHeight: 1.5 }}>
          You've left the rest of the app.<br />
          This is where your money lives.
        </div>
      </Animated>
    </BeatShell>
  );
});

// ── Beat 2: Two currencies ───────────────────────────────────────
const Beat2 = memo(function Beat2() {
  return (
    <BeatShell bg="radial-gradient(ellipse at center, #0a0816 0%, #050308 100%)">
      <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center' }}>
        <div style={{
          display: 'grid', gridTemplateColumns: '1fr auto 1fr', gap: 80,
          alignItems: 'center', maxWidth: 1100, padding: '0 60px',
        }}>
          <Animated style={{
            opacity: 0, transform: 'translateX(0)', textAlign: 'center',
            transition: 'transform 0.6s cubic-bezier(0.2,0.8,0.2,1)',
          }} apply={(p, n) => {
            n.style.opacity = p > 0.05 ? 1 : 0;
            n.style.transform = p > 0.7 ? 'translateX(-20px)' : 'translateX(0)';
          }}>
            <div style={{ display: 'inline-block', filter: 'drop-shadow(0 0 60px rgba(240,165,0,0.4))' }}>
              <CoinGlyph size={160} />
            </div>
            <div style={{ fontFamily: FONT_DISPLAY, fontSize: 38, marginTop: 24, color: WALLET_TOKENS.goldLight, fontWeight: 700 }}>Coins</div>
            <div style={{ fontSize: 17, marginTop: 8, maxWidth: 280, margin: '8px auto 0', color: WALLET_TOKENS.textSecondary, lineHeight: 1.5 }}>
              You buy these. You spend them inside VERGR.
            </div>
            <div style={{ fontFamily: FONT_MONO, fontSize: 13, marginTop: 16, color: WALLET_TOKENS.textMuted, letterSpacing: '0.06em' }}>
              TIPS · MEMBERSHIPS · TOURNAMENT ENTRY
            </div>
          </Animated>

          <Animated style={{
            opacity: 0,
            color: WALLET_TOKENS.textMuted,
            fontFamily: FONT_MONO, fontSize: 11, letterSpacing: '0.2em',
            writingMode: 'vertical-rl', textTransform: 'uppercase',
            transition: 'opacity 0.5s ease',
          }} apply={(p, n) => { n.style.opacity = p > 0.7 ? 1 : 0; }}>
            TWO CURRENCIES
          </Animated>

          <Animated style={{
            opacity: 0, transform: 'translateX(0)', textAlign: 'center',
            transition: 'transform 0.6s cubic-bezier(0.2,0.8,0.2,1)',
          }} apply={(p, n) => {
            n.style.opacity = p > 0.42 ? 1 : 0;
            n.style.transform = p > 0.7 ? 'translateX(20px)' : 'translateX(0)';
          }}>
            <div style={{ display: 'inline-block', filter: 'drop-shadow(0 0 60px rgba(61,127,255,0.5))' }}>
              <GemGlyph size={160} />
            </div>
            <div style={{ fontFamily: FONT_DISPLAY, fontSize: 38, marginTop: 24, color: WALLET_TOKENS.gemBlue, fontWeight: 700 }}>Gems</div>
            <div style={{ fontSize: 17, marginTop: 8, maxWidth: 280, margin: '8px auto 0', color: WALLET_TOKENS.textSecondary, lineHeight: 1.5 }}>
              You earn these. Only gems cash out.
            </div>
            <div style={{ fontFamily: FONT_MONO, fontSize: 13, marginTop: 16, color: WALLET_TOKENS.textMuted, letterSpacing: '0.06em' }}>
              CONVERSION · WITHDRAWALS · PRIZES
            </div>
          </Animated>
        </div>
      </div>
    </BeatShell>
  );
});

// ── Beat 3: Earnings rails ───────────────────────────────────────
// Layout is CSS Grid so labels/rails always share the same coordinate space.
// Labels live in column 1, SVG rails in column 2, destination card in column 3.
const Beat3 = memo(function Beat3() {
  const sources = [
    { label: 'Tips from fans' },
    { label: 'Fan memberships' },
    { label: 'Tournament prizes' },
  ];
  return (
    <BeatShell bg="radial-gradient(ellipse 1400px 900px at 80% 50%, #16121c 0%, #0a0710 65%, #050308 100%)">
      <Animated style={{
        position: 'absolute', left: '50%', top: '11%', transform: 'translateX(-50%)',
        textAlign: 'center', opacity: 0, transition: 'opacity 0.5s ease',
      }} apply={(p, n) => { n.style.opacity = p > 0.05 ? 1 : 0; }}>
        <div style={{ fontFamily: FONT_MONO, fontSize: 11, letterSpacing: '0.16em', textTransform: 'uppercase', color: WALLET_TOKENS.goldLight, marginBottom: 8 }}>
          HOW EARNINGS ARRIVE
        </div>
        <div style={{ fontFamily: FONT_DISPLAY, fontSize: 44, letterSpacing: '-0.03em', color: WALLET_TOKENS.text, fontWeight: 700 }}>It just lands.</div>
      </Animated>

      <div style={{
        position: 'absolute',
        left: '50%', top: '52%', transform: 'translate(-50%, -50%)',
        width: 'min(1100px, 92vw)', height: 'min(380px, 50vh)',
        display: 'grid',
        gridTemplateColumns: '220px 1fr 220px',
        gridTemplateRows: '1fr 1fr 1fr',
        alignItems: 'center',
        columnGap: 24,
      }}>
        {sources.map((s, i) => (
          <Animated key={i} style={{
            gridColumn: 1, gridRow: i + 1,
            opacity: 0, transform: 'translateX(-16px)',
            transition: 'opacity 0.5s ease, transform 0.5s ease',
            textAlign: 'right',
          }} apply={(p, n) => {
            const on = p > 0.1 + i * 0.08;
            n.style.opacity = on ? 1 : 0;
            n.style.transform = on ? 'translateX(0)' : 'translateX(-16px)';
          }}>
            <div style={{ fontSize: 12, color: WALLET_TOKENS.goldLight, letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 6, fontWeight: 600 }}>
              {String(i + 1).padStart(2, '0')}
            </div>
            <div style={{ fontSize: 20, fontWeight: 500, lineHeight: 1.2, color: WALLET_TOKENS.text }}>{s.label}</div>
          </Animated>
        ))}

        <svg
          style={{ gridColumn: 2, gridRow: '1 / 4', width: '100%', height: '100%' }}
          viewBox="0 0 100 60"
          preserveAspectRatio="none"
        >
          <defs>
            <linearGradient id="vgWalkRailGrad" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="rgba(240,165,0,0)" />
              <stop offset="15%" stopColor="rgba(240,165,0,0.4)" />
              <stop offset="85%" stopColor="rgba(180,79,255,0.45)" />
              <stop offset="100%" stopColor="rgba(180,79,255,0)" />
            </linearGradient>
            <radialGradient id="vgWalkDotGlow">
              <stop offset="0" stopColor="#F5C842" />
              <stop offset="0.4" stopColor="#F0A500" />
              <stop offset="1" stopColor="rgba(240,165,0,0)" />
            </radialGradient>
          </defs>
          {sources.map((_, i) => {
            const y = 10 + i * 20;
            const d = `M 0 ${y} Q 50 30 100 30`;
            return (
              <Animated key={i} tag="g" style={{ opacity: 0, transition: 'opacity 0.4s ease' }}
                apply={(p, n) => { n.style.opacity = p > 0.1 + i * 0.06 ? 1 : 0; }}>
                <path d={d} fill="none" stroke="url(#vgWalkRailGrad)" strokeWidth="0.5"
                  vectorEffect="non-scaling-stroke" strokeLinecap="round"
                  pathLength="100" strokeDasharray="100"
                  style={{ animation: `vgWalkRailReveal 1.2s ease ${0.1 + i * 0.12}s both` }}
                />
                <circle cx="0" cy={y} r="1.1" fill="#F0A500"
                  style={{ filter: 'drop-shadow(0 0 4px rgba(240,165,0,0.9))' }} />
                <circle r="1.4" fill="url(#vgWalkDotGlow)">
                  <animateMotion dur="2.4s" repeatCount="indefinite"
                    begin={`${0.4 + i * 0.18}s`} path={d} />
                </circle>
              </Animated>
            );
          })}
        </svg>

        <Animated style={{
          gridColumn: 3, gridRow: '1 / 4',
          opacity: 0, transform: 'scale(0.94)',
          transition: 'opacity 0.6s ease, transform 0.6s cubic-bezier(0.2,0.8,0.2,1)',
          textAlign: 'center', justifySelf: 'center', alignSelf: 'center',
        }} apply={(p, n) => {
          const on = p > 0.35;
          n.style.opacity = on ? 1 : 0;
          n.style.transform = on ? 'scale(1)' : 'scale(0.94)';
        }}>
          <div style={{
            width: 160, height: 160, borderRadius: 22,
            background: 'linear-gradient(135deg, rgba(180,79,255,0.14), rgba(123,31,255,0.04))',
            border: '1px solid rgba(180,79,255,0.3)',
            display: 'grid', placeItems: 'center',
            boxShadow: '0 0 80px rgba(123,31,255,0.25), inset 0 1px 0 rgba(255,255,255,0.08)',
            margin: '0 auto', color: 'white',
          }}>
            <Icon name="account_balance_wallet" size={48} />
          </div>
          <div style={{ fontFamily: FONT_DISPLAY, fontSize: 20, marginTop: 16, letterSpacing: '-0.01em', color: WALLET_TOKENS.text, fontWeight: 700 }}>Your wallet</div>
        </Animated>
      </div>

      <Animated style={{
        position: 'absolute', left: '50%', bottom: '11%', transform: 'translateX(-50%)',
        textAlign: 'center', maxWidth: 580, opacity: 0,
        transition: 'opacity 0.5s ease',
      }} apply={(p, n) => { n.style.opacity = p > 0.6 ? 1 : 0; }}>
        <div style={{ fontSize: 16, lineHeight: 1.55, color: WALLET_TOKENS.textSecondary }}>
          You don't claim or transfer anything. Earnings land the moment they happen.
        </div>
      </Animated>

      <style>{`@keyframes vgWalkRailReveal { from { stroke-dashoffset: 100; } to { stroke-dashoffset: 0; } }`}</style>
    </BeatShell>
  );
});

// ── Beat 4: Cash out ─────────────────────────────────────────────
const Beat4 = memo(function Beat4() {
  return (
    <BeatShell bg="radial-gradient(ellipse at center, #061025 0%, #03060f 70%)">
      <Animated style={{
        position: 'absolute', left: '50%', top: '36%', transform: 'translate(-50%, -50%)',
        opacity: 0, transition: 'opacity 0.5s ease',
      }} apply={(p, n) => { n.style.opacity = p > 0.05 ? 1 : 0; }}>
        <div style={{ filter: 'drop-shadow(0 0 50px rgba(61,127,255,0.55))' }}>
          <GemGlyph size={120} />
        </div>
      </Animated>

      <svg style={{ position: 'absolute', inset: 0 }} width="100%" height="100%" preserveAspectRatio="none" viewBox="0 0 100 100">
        <defs>
          <linearGradient id="vgWalkGline" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#3D7FFF" />
            <stop offset="1" stopColor="#22C55E" />
          </linearGradient>
        </defs>
        <Animated tag="path" style={{ opacity: 0, transition: 'opacity 0.4s ease' }}
          apply={(p, n) => {
            n.style.opacity = p > 0.25 ? 1 : 0;
            n.setAttribute('stroke-dashoffset', String(Math.max(0, (1 - (p - 0.25) * 2.2) * 200)));
          }}
          d="M 50 38 Q 50 55, 30 70"
          stroke="url(#vgWalkGline)" strokeWidth="0.3" fill="none"
          vectorEffect="non-scaling-stroke" strokeDasharray="200"
        />
        <Animated tag="path" style={{ opacity: 0, transition: 'opacity 0.4s ease' }}
          apply={(p, n) => {
            n.style.opacity = p > 0.3 ? 1 : 0;
            n.setAttribute('stroke-dashoffset', String(Math.max(0, (1 - (p - 0.3) * 2.2) * 200)));
          }}
          d="M 50 38 Q 50 55, 70 70"
          stroke="url(#vgWalkGline)" strokeWidth="0.3" fill="none"
          vectorEffect="non-scaling-stroke" strokeDasharray="200"
        />
      </svg>

      <Animated style={{ position: 'absolute', left: '20%', top: '62%', textAlign: 'center', opacity: 0, transition: 'opacity 0.5s ease' }}
        apply={(p, n) => { n.style.opacity = p > 0.5 ? 1 : 0; }}>
        <div style={{
          width: 100, height: 100, borderRadius: 18,
          background: 'rgba(34,197,94,0.08)', border: '1px solid rgba(34,197,94,0.3)',
          display: 'grid', placeItems: 'center', margin: '0 auto',
          color: WALLET_TOKENS.success,
        }}>
          <Icon name="account_balance_wallet" size={40} />
        </div>
        <div style={{ fontFamily: FONT_DISPLAY, fontSize: 22, marginTop: 14, color: WALLET_TOKENS.text, fontWeight: 700 }}>Crypto wallet</div>
        <div style={{ fontSize: 14, marginTop: 4, color: WALLET_TOKENS.textSecondary }}>USDC on Base, your address.</div>
      </Animated>

      <Animated style={{ position: 'absolute', right: '20%', top: '62%', textAlign: 'center', opacity: 0, transition: 'opacity 0.5s ease' }}
        apply={(p, n) => { n.style.opacity = p > 0.6 ? 1 : 0; }}>
        <div style={{
          width: 100, height: 100, borderRadius: 18,
          background: 'rgba(34,197,94,0.08)', border: '1px solid rgba(34,197,94,0.3)',
          display: 'grid', placeItems: 'center', margin: '0 auto',
          color: WALLET_TOKENS.success,
        }}>
          <Icon name="account_balance" size={40} />
        </div>
        <div style={{ fontFamily: FONT_DISPLAY, fontSize: 22, marginTop: 14, color: WALLET_TOKENS.text, fontWeight: 700 }}>Bank account</div>
        <div style={{ fontSize: 14, marginTop: 4, color: WALLET_TOKENS.textSecondary }}>Euros, into the IBAN you choose.</div>
      </Animated>

      <Animated style={{
        position: 'absolute', left: '50%', top: '10%', transform: 'translateX(-50%)',
        textAlign: 'center', opacity: 0, transition: 'opacity 0.5s ease',
      }} apply={(p, n) => { n.style.opacity = p > 0.1 ? 1 : 0; }}>
        <div style={{ fontFamily: FONT_MONO, fontSize: 11, letterSpacing: '0.16em', textTransform: 'uppercase', color: WALLET_TOKENS.gemBlue, marginBottom: 8 }}>
          CASH OUT
        </div>
        <div style={{ fontFamily: FONT_DISPLAY, fontSize: 44, letterSpacing: '-0.03em', color: WALLET_TOKENS.text, fontWeight: 700 }}>You choose where.</div>
      </Animated>
    </BeatShell>
  );
});

// ── Beat 5: Three live shields ──────────────────────────────────
const Beat5 = memo(function Beat5() {
  const shields = [
    { label: 'PIN', sub: 'Locks the wallet.', delay: 0.10, icon: 'lock', color: '#B44FFF' },
    { label: '2FA', sub: 'Guards big moves.', delay: 0.22, icon: 'verified_user', color: '#3D7FFF' },
    { label: 'KYC', sub: 'Unlocks higher limits.', delay: 0.34, icon: 'verified', color: '#22C55E' },
  ];
  return (
    <BeatShell bg="radial-gradient(ellipse at center, #0c0820 0%, #050208 70%)">
      <div style={{ position: 'absolute', left: '50%', top: '15%', transform: 'translateX(-50%)', textAlign: 'center' }}>
        <div style={{ fontFamily: FONT_MONO, fontSize: 11, letterSpacing: '0.16em', textTransform: 'uppercase', color: WALLET_TOKENS.textSecondary, marginBottom: 8 }}>
          BUILT LIKE A BANK
        </div>
        <div style={{ fontFamily: FONT_DISPLAY, fontSize: 44, color: WALLET_TOKENS.text, fontWeight: 700 }}>Three live shields.</div>
      </div>
      <div style={{
        position: 'absolute', left: '50%', top: '52%', transform: 'translate(-50%, -50%)',
        display: 'flex', gap: 40, alignItems: 'center',
      }}>
        {shields.map((s, i) => (
          <Animated key={i} style={{
            transform: 'scale(0.85) translateY(20px)', opacity: 0,
            transition: 'transform 0.5s cubic-bezier(0.2,0.8,0.2,1), opacity 0.5s ease',
            textAlign: 'center', willChange: 'transform, opacity',
          }} apply={(p, n) => {
            const pp = Math.max(0, Math.min(1, (p - s.delay) * 3));
            n.style.opacity = pp;
            n.style.transform = `scale(${0.85 + pp * 0.15}) translateY(${(1 - pp) * 20}px)`;
          }}>
            <div style={{
              width: 180, height: 220, borderRadius: 18,
              background: `linear-gradient(180deg, ${s.color}26 0%, ${s.color}08 100%)`,
              border: `1px solid ${s.color}55`,
              display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 18,
              boxShadow: `0 0 40px ${s.color}33`,
              position: 'relative', overflow: 'hidden',
            }}>
              <div style={{
                position: 'absolute', inset: 0,
                background: `radial-gradient(circle at 50% 60%, ${s.color}33, transparent 70%)`,
                animation: 'vgWalkPulseGlow 3s ease-in-out infinite',
              }} />
              <div style={{
                width: 64, height: 64, borderRadius: 16,
                background: 'rgba(255,255,255,0.06)',
                display: 'grid', placeItems: 'center',
                border: `1px solid ${s.color}66`,
                zIndex: 1, color: s.color,
              }}>
                <Icon name={s.icon} size={28} />
              </div>
              <div style={{ position: 'relative', zIndex: 1 }}>
                <div style={{ fontFamily: FONT_DISPLAY, fontSize: 22, color: WALLET_TOKENS.text, fontWeight: 700 }}>{s.label}</div>
                <div style={{ fontSize: 13, marginTop: 4, color: WALLET_TOKENS.textSecondary }}>{s.sub}</div>
              </div>
              <div style={{
                position: 'absolute', top: 14, right: 14,
                width: 22, height: 22, borderRadius: '50%',
                background: WALLET_TOKENS.success,
                display: 'grid', placeItems: 'center',
                color: 'white',
              }}>
                <Icon name="check" size={12} />
              </div>
            </div>
          </Animated>
        ))}
      </div>
      <style>{`@keyframes vgWalkPulseGlow { 0%,100% { opacity: 0.4; } 50% { opacity: 0.9; } }`}</style>
    </BeatShell>
  );
});

// ── Beat 6: Seven days ──────────────────────────────────────────
const Beat6 = memo(function Beat6() {
  const days = ['Day 0', 'Day 1', 'Day 2', 'Day 3', 'Day 4', 'Day 5', 'Day 6', 'Day 7'];
  return (
    <BeatShell bg="radial-gradient(ellipse at center, #0d0c1a 0%, #050308 70%)">
      <div style={{ position: 'absolute', left: '50%', top: '14%', transform: 'translateX(-50%)', textAlign: 'center' }}>
        <div style={{ fontFamily: FONT_MONO, fontSize: 11, letterSpacing: '0.16em', textTransform: 'uppercase', color: WALLET_TOKENS.gemBlue, marginBottom: 8 }}>
          WHY THE WAIT
        </div>
        <div style={{ fontFamily: FONT_DISPLAY, fontSize: 44, letterSpacing: '-0.03em', color: WALLET_TOKENS.text, fontWeight: 700 }}>Seven days.</div>
        <div style={{ fontFamily: FONT_DISPLAY, fontSize: 44, color: WALLET_TOKENS.textSecondary, fontWeight: 700 }}>For you.</div>
      </div>
      <div style={{
        position: 'absolute', left: '50%', top: '54%', transform: 'translate(-50%, -50%)',
        width: 'min(920px, 86vw)',
      }}>
        <div style={{
          position: 'relative', height: 80,
          display: 'grid', gridTemplateColumns: `repeat(${days.length}, 1fr)`, alignItems: 'start',
        }}>
          <div style={{
            position: 'absolute', left: 'calc(100% / 16)', right: 'calc(100% / 16)', top: 9, height: 4, borderRadius: 4,
            background: 'rgba(255,255,255,0.06)',
          }} />
          <Animated style={{
            position: 'absolute', left: 'calc(100% / 16)', top: 9, height: 4, borderRadius: 4,
            width: 0,
            background: 'linear-gradient(90deg, #7B1FFF 0%, #3D7FFF 100%)',
            boxShadow: '0 0 12px rgba(123,31,255,0.5)',
            willChange: 'width',
          }} apply={(p, n) => {
            const fillP = Math.max(0, Math.min(1, (p - 0.15) * 1.6));
            n.style.width = `calc((100% - (100% / 8)) * ${fillP})`;
          }} />
          {days.map((d, i) => (
            <Animated key={i} style={{
              gridColumn: i + 1, textAlign: 'center', position: 'relative', zIndex: 1,
            }} apply={(p, n) => {
              const fillP = Math.max(0, Math.min(1, (p - 0.15) * 1.6));
              const reached = fillP * (days.length - 1) >= i - 0.2;
              const dot = n.querySelector('[data-dot]');
              const lbl = n.querySelector('[data-lbl]');
              if (dot) {
                dot.style.background = reached
                  ? (i === 7 ? WALLET_TOKENS.success : WALLET_TOKENS.violetLight)
                  : WALLET_TOKENS.surface2;
                dot.style.border = reached ? '0' : `1px solid ${WALLET_TOKENS.hairlineStrong}`;
                dot.style.boxShadow = reached
                  ? `0 0 12px ${i === 7 ? 'rgba(34,197,94,0.6)' : 'rgba(180,79,255,0.6)'}`
                  : 'none';
              }
              if (lbl) lbl.style.color = reached ? WALLET_TOKENS.textSecondary : WALLET_TOKENS.textMuted;
            }}>
              <div data-dot style={{
                width: 22, height: 22, borderRadius: '50%',
                margin: '0 auto',
                display: 'grid', placeItems: 'center',
                background: WALLET_TOKENS.surface2,
                border: `1px solid ${WALLET_TOKENS.hairlineStrong}`,
              }} />
              <div data-lbl style={{ fontFamily: FONT_MONO, fontSize: 11, marginTop: 10, color: WALLET_TOKENS.textMuted }}>{d}</div>
            </Animated>
          ))}
        </div>
        <Animated style={{
          position: 'absolute', left: 0, top: 96, opacity: 0,
          transition: 'opacity 0.5s ease', maxWidth: 200,
        }} apply={(p, n) => { n.style.opacity = p > 0.2 ? 1 : 0; }}>
          <div style={{ fontFamily: FONT_MONO, fontSize: 11, letterSpacing: '0.16em', textTransform: 'uppercase', color: WALLET_TOKENS.ember, marginBottom: 4 }}>
            FIRST HOUR
          </div>
          <div style={{ fontSize: 13, color: WALLET_TOKENS.textSecondary }}>
            Cancel for any reason. One click.
          </div>
        </Animated>
        <Animated style={{
          position: 'absolute', right: 0, top: 96, textAlign: 'right', opacity: 0,
          transition: 'opacity 0.5s ease', maxWidth: 220,
        }} apply={(p, n) => { n.style.opacity = p > 0.65 ? 1 : 0; }}>
          <div style={{ fontFamily: FONT_MONO, fontSize: 11, letterSpacing: '0.16em', textTransform: 'uppercase', color: WALLET_TOKENS.success, marginBottom: 4 }}>
            DAY 7
          </div>
          <div style={{ fontSize: 13, color: WALLET_TOKENS.textSecondary }}>
            Funds leave the wallet, on chain.
          </div>
        </Animated>
      </div>
      <Animated style={{
        position: 'absolute', left: '50%', bottom: '11%', transform: 'translateX(-50%)',
        textAlign: 'center', maxWidth: 640, opacity: 0,
        transition: 'opacity 0.5s ease',
      }} apply={(p, n) => { n.style.opacity = p > 0.6 ? 1 : 0; }}>
        <div style={{ fontSize: 17, lineHeight: 1.5, color: WALLET_TOKENS.textSecondary }}>
          If anyone steals a session, you have time to stop them. Industry standard, on your side.
        </div>
      </Animated>
    </BeatShell>
  );
});

// ── Beat 7: Trust — claims match what VERGR actually builds ────
const Beat7 = memo(function Beat7() {
  const items = [
    { label: 'Custody',  value: 'Circle MPC',     sub: 'USDC issuer infrastructure' },
    { label: 'Reserves', value: 'Cold reserve',   sub: 'Separated from operating funds' },
    { label: 'Proof',    value: 'On-chain PoR',   sub: 'Reserves match liabilities, publicly' },
    { label: 'Chain',    value: 'Base · USDC',    sub: 'Regulated stablecoin, low gas' },
  ];
  return (
    <BeatShell bg="radial-gradient(ellipse at center, #050a14 0%, #02050a 70%)">
      <div style={{ position: 'absolute', left: '50%', top: '14%', transform: 'translateX(-50%)', textAlign: 'center' }}>
        <div style={{ fontFamily: FONT_MONO, fontSize: 11, letterSpacing: '0.16em', textTransform: 'uppercase', color: WALLET_TOKENS.gemBlue, marginBottom: 8 }}>
          WHO'S BEHIND THIS
        </div>
        <div style={{ fontFamily: FONT_DISPLAY, fontSize: 44, color: WALLET_TOKENS.text, fontWeight: 700 }}>Real custody.</div>
        <div style={{ fontFamily: FONT_DISPLAY, fontSize: 44, color: WALLET_TOKENS.textSecondary, fontWeight: 700 }}>Real audit trail.</div>
      </div>
      <div style={{
        position: 'absolute', left: '50%', top: '54%', transform: 'translate(-50%, -50%)',
        display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 18,
        width: 'min(1000px, 92vw)',
      }}>
        {items.map((it, i) => (
          <Animated key={i} style={{
            opacity: 0, transform: 'translateY(20px)',
            transition: 'opacity 0.5s ease, transform 0.5s ease',
            padding: '24px 20px',
            border: `1px solid ${WALLET_TOKENS.hairlineStrong}`,
            borderRadius: 16,
            background: 'linear-gradient(180deg, rgba(255,255,255,0.03) 0%, rgba(255,255,255,0) 100%)',
            minHeight: 180,
            willChange: 'transform, opacity',
          }} apply={(p, n) => {
            const pp = Math.max(0, Math.min(1, (p - 0.1 - i * 0.08) * 3));
            n.style.opacity = pp;
            n.style.transform = `translateY(${(1 - pp) * 20}px)`;
          }}>
            <div style={{ fontFamily: FONT_MONO, fontSize: 11, letterSpacing: '0.16em', textTransform: 'uppercase', color: WALLET_TOKENS.violetLight, marginBottom: 12 }}>
              {it.label}
            </div>
            <div style={{ fontFamily: FONT_DISPLAY, fontSize: 22, marginBottom: 8, whiteSpace: 'nowrap', letterSpacing: '-0.01em', color: WALLET_TOKENS.text, fontWeight: 700 }}>
              {it.value}
            </div>
            <div style={{ fontSize: 13, color: WALLET_TOKENS.textSecondary }}>{it.sub}</div>
          </Animated>
        ))}
      </div>
    </BeatShell>
  );
});

// ── Beat 8: Begin ──────────────────────────────────────────────
const Beat8 = memo(function Beat8({ onBegin }) {
  return (
    <BeatShell bg="radial-gradient(ellipse 1000px 700px at 50% 65%, #15101f 0%, #0a0712 60%, #050308 100%)">
      <Particles count={24} />
      <Animated style={{
        position: 'absolute', left: '50%', top: '44%',
        transform: 'translate(-50%, calc(-50% + 20px))', opacity: 0,
        textAlign: 'center', willChange: 'opacity, transform',
      }} apply={(p, n) => {
        n.style.opacity = p > 0.05 ? 1 : 0;
        n.style.transform = p > 0.05 ? 'translate(-50%, -50%)' : 'translate(-50%, calc(-50% + 20px))';
      }}>
        <div style={{
          fontFamily: FONT_DISPLAY, fontSize: 96, letterSpacing: '-0.04em', lineHeight: 1,
          color: WALLET_TOKENS.text, fontWeight: 700,
          transition: 'transform 0.6s cubic-bezier(0.2,0.8,0.2,1)',
        }}>
          Let's set you up.
        </div>
        <Animated style={{
          marginTop: 20, fontSize: 18, color: WALLET_TOKENS.textSecondary, opacity: 0,
          transition: 'opacity 0.5s ease',
        }} apply={(p, n) => { n.style.opacity = p > 0.3 ? 1 : 0; }}>
          Sixty seconds. A PIN, then you're in.
        </Animated>
      </Animated>
      <Animated style={{
        position: 'absolute', left: '50%', bottom: '20%',
        transform: 'translate(-50%, 12px)', opacity: 0,
        transition: 'opacity 0.5s ease, transform 0.5s ease',
      }} apply={(p, n) => {
        const on = p > 0.35;
        n.style.opacity = on ? 1 : 0;
        n.style.transform = on ? 'translate(-50%, 0)' : 'translate(-50%, 12px)';
      }}>
        <button onClick={onBegin} style={{
          padding: '14px 40px', fontSize: 16, fontWeight: 600,
          borderRadius: 999, border: 'none', cursor: 'pointer',
          color: 'white',
          background: `linear-gradient(135deg, ${WALLET_TOKENS.violet} 0%, ${WALLET_TOKENS.pink} 100%)`,
          boxShadow: '0 12px 48px -8px rgba(123,31,255,0.6)',
          display: 'inline-flex', alignItems: 'center', gap: 10,
        }}>
          Begin setup
          <Icon name="arrow_forward" size={18} />
        </button>
      </Animated>
    </BeatShell>
  );
});

// ── BeatTagger: tags every node with __apply so the RAF loop finds them ──
function BeatTagger({ children }) {
  const ref = useRef(null);
  useEffect(() => {
    if (!ref.current) return;
    const walker = (node) => {
      if (node.__apply) node.setAttribute('data-anim', '1');
      for (let i = 0; i < node.children.length; i++) walker(node.children[i]);
    };
    walker(ref.current);
  });
  return <div ref={ref} style={{ position: 'absolute', inset: 0 }}>{children}</div>;
}

// ── Walkthrough host ─────────────────────────────────────────────
export default function WalletWalkthrough({ onComplete, onSkip }) {
  const [beat, setBeat] = useState(0);
  const [transitioning, setTransitioning] = useState(false);
  const stageRef = useRef(null);
  const progressBarRef = useRef(null);
  const tStartRef = useRef(performance.now());
  const reducedRef = useRef(prefersReducedMotion());

  // Single RAF loop. Reads __apply off every animated descendant and calls it.
  // Zero React renders per frame.
  useEffect(() => {
    let raf;
    tStartRef.current = performance.now();
    const tick = (t) => {
      const elapsed = t - tStartRef.current;
      const p = reducedRef.current ? 1 : Math.min(1, elapsed / BEAT_DURATION_MS);

      const stage = stageRef.current;
      if (stage) {
        const nodes = stage.querySelectorAll('[data-anim]');
        for (let i = 0; i < nodes.length; i++) {
          const fn = nodes[i].__apply;
          if (typeof fn === 'function') fn(p, nodes[i]);
        }
      }
      if (progressBarRef.current) progressBarRef.current.style.width = `${p * 100}%`;

      if (p >= 1) {
        if (beat < TOTAL_BEATS - 1) {
          advance(beat + 1);
        } else {
          raf = requestAnimationFrame(tick);
          return;
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [beat]);

  const advance = (next) => {
    if (transitioning) return;
    setTransitioning(true);
    setTimeout(() => {
      setBeat(next);
      tStartRef.current = performance.now();
      setTransitioning(false);
    }, CROSSFADE_MS);
  };

  // Keyboard nav
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'ArrowRight' || e.key === ' ') { e.preventDefault(); goNext(); }
      else if (e.key === 'ArrowLeft') { goPrev(); }
      else if (e.key === 'Escape') { onSkip && onSkip(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  });

  const goNext = () => {
    if (beat < TOTAL_BEATS - 1) advance(beat + 1);
    else onComplete && onComplete();
  };
  const goPrev = () => { if (beat > 0) advance(beat - 1); };
  const jumpTo = (i) => { if (i !== beat) advance(i); };

  const renderBeat = () => {
    if (beat === 0) return <Beat1 />;
    if (beat === 1) return <Beat2 />;
    if (beat === 2) return <Beat3 />;
    if (beat === 3) return <Beat4 />;
    if (beat === 4) return <Beat5 />;
    if (beat === 5) return <Beat6 />;
    if (beat === 6) return <Beat7 />;
    return <Beat8 onBegin={onComplete} />;
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'black', zIndex: 100, overflow: 'hidden' }}>
      {/* Stage: crossfade by animating opacity on this wrapper */}
      <div ref={stageRef} style={{
        position: 'absolute', inset: 0,
        opacity: transitioning ? 0 : 1,
        transition: `opacity ${CROSSFADE_MS}ms ease`,
        willChange: 'opacity',
      }}>
        <BeatTagger key={beat}>{renderBeat()}</BeatTagger>
      </div>

      {/* Chapter markers */}
      <div style={{
        position: 'absolute', top: 32, left: '50%', transform: 'translateX(-50%)',
        display: 'flex', gap: 8, zIndex: 10,
      }}>
        {Array.from({ length: TOTAL_BEATS }).map((_, i) => (
          <button key={i} onClick={() => jumpTo(i)} style={{
            height: 3, width: 36, borderRadius: 2,
            background: i < beat ? 'rgba(255,255,255,0.4)' : i === beat ? 'transparent' : 'rgba(255,255,255,0.1)',
            border: 'none', padding: 0, position: 'relative', overflow: 'hidden',
            cursor: 'pointer',
          }} aria-label={`Go to chapter ${i + 1}`}>
            {i === beat && (
              <i ref={progressBarRef} style={{
                position: 'absolute', left: 0, top: 0, bottom: 0,
                background: 'white', width: '0%',
              }} />
            )}
          </button>
        ))}
      </div>

      {/* Skip */}
      <button onClick={onSkip} style={{
        position: 'absolute', top: 28, right: 32, zIndex: 10,
        padding: '8px 14px', fontSize: 12, color: 'rgba(255,255,255,0.6)',
        background: 'rgba(255,255,255,0.04)',
        border: '1px solid rgba(255,255,255,0.1)',
        borderRadius: 999, letterSpacing: '0.02em',
        cursor: 'pointer',
        transition: 'color 0.2s ease',
      }} onMouseEnter={(e) => e.currentTarget.style.color = 'white'}
         onMouseLeave={(e) => e.currentTarget.style.color = 'rgba(255,255,255,0.6)'}>
        Skip walkthrough
      </button>

      {/* Click pads */}
      <div onClick={goPrev} aria-label="Previous beat"
        style={{ position: 'absolute', left: 0, top: 80, bottom: 80, width: 60, cursor: 'pointer', zIndex: 5 }} />
      <div onClick={goNext} aria-label="Next beat"
        style={{ position: 'absolute', right: 0, top: 80, bottom: 80, width: 60, cursor: 'pointer', zIndex: 5 }} />

      <div style={{
        position: 'absolute', bottom: 28, left: 32, zIndex: 10,
        fontFamily: FONT_MONO, fontSize: 11, color: 'rgba(255,255,255,0.4)', letterSpacing: '0.14em',
      }}>
        {String(beat + 1).padStart(2, '0')} / {String(TOTAL_BEATS).padStart(2, '0')}
      </div>

      <div style={{
        position: 'absolute', bottom: 28, right: 32, zIndex: 10,
        fontFamily: FONT_MONO, fontSize: 11, color: 'rgba(255,255,255,0.4)', letterSpacing: '0.14em',
      }}>
        {BEAT_LABELS[beat]}
      </div>
    </div>
  );
}
