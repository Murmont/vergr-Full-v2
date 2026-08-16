import { useEffect, useState, useRef, useMemo, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import './FirstBootIntro.css';

const SEEN_KEY = 'vergr.firstBoot.v1';
const PENDING_KEY = 'vergr.firstBoot.pending';
export const FIRST_BOOT_EVENT = 'vergr:firstboot';
const A = '/brand/firstboot';

const CHAPTERS = [
  { key: 'cold',    component: 'ChapterCold',      duration: 4200 },
  { key: 'economy', component: 'ChapterEconomy',   duration: 4600 },
  { key: 'rank',    component: 'ChapterAdvantage', duration: 4400 },
  { key: 'reach',   component: 'ChapterReach',     duration: 4400 },
  { key: 'crew',    component: 'ChapterCrew',      duration: 4200 },
  { key: 'private', component: 'ChapterPrivate',   duration: 5200 },
  { key: 'handoff', component: 'ChapterHandoff',   duration: 6000 },
];

const MICROCOPY = [
  'compiling your lobby', 'negotiating with the server', 'tuning the crowd',
  'unboxing your wallet', 'warming up the mic', 'stretching the squad',
  'polishing your VP rank', 'loading the unfair advantage',
];

function easeOut(x) { return 1 - Math.pow(1 - x, 3); }

function HeroLine({ children, size = 'M', active }) {
  const sizes = {
    S: 'clamp(22px, 4.6vw, 34px)',
    M: 'clamp(28px, 5.6vw, 44px)',
    L: 'clamp(34px, 6.6vw, 56px)',
  };
  return (
    <div
      className="hero-line"
      style={{
        fontSize: sizes[size],
        opacity: active ? 1 : 0,
        transform: active ? 'translateY(0)' : 'translateY(14px)',
        transition: 'opacity 800ms cubic-bezier(.2,.7,.2,1) 400ms, transform 900ms cubic-bezier(.2,.7,.2,1) 400ms',
      }}
    >
      {children}
    </div>
  );
}

// ─── Motion background ──────────────────────────────────────────────────────
function Motes({ count = 28 }) {
  const motes = useMemo(() => Array.from({ length: count }).map((_, i) => ({
    i,
    size: 1 + Math.random() * 2.5,
    left: Math.random() * 100,
    top: Math.random() * 100,
    delay: -Math.random() * 18,
    duration: 14 + Math.random() * 18,
    driftX: (Math.random() - 0.5) * 80,
    driftY: (Math.random() - 0.5) * 60,
    hue: ['#ffffff', '#5EE7FF', '#C87FFF', '#F5C542'][Math.floor(Math.random() * 4)],
  })), [count]);
  return motes.map((m) => (
    <div key={m.i} className="mbg-mote" style={{
      left: m.left + '%', top: m.top + '%', width: m.size, height: m.size,
      background: m.hue, boxShadow: `0 0 ${4 + m.size * 3}px ${m.hue}, 0 0 ${10 + m.size * 4}px ${m.hue}`,
      opacity: 0.7, '--dx': m.driftX + 'px', '--dy': m.driftY + 'px',
      animation: `fb-mote-drift ${m.duration}s linear ${m.delay}s infinite`,
    }} />
  ));
}

function MotionBackground() {
  return (
    <div className="mbg" aria-hidden="true">
      <div className="mbg-base" />
      <div style={{
        position: 'absolute', inset: '-8%',
        backgroundImage: 'url("/brand/loader-nebula.webp")',
        backgroundSize: 'cover', backgroundPosition: 'center center',
        opacity: 0.95, animation: 'fb-plate-drift 48s ease-in-out infinite alternate', willChange: 'transform',
      }} />
      <div className="mbg-cloud c2" style={{ opacity: 0.18, mixBlendMode: 'screen' }} />
      <div className="mbg-cloud c4" style={{ opacity: 0.18, mixBlendMode: 'screen' }} />
      <Motes count={28} />
      <div className="mbg-bloom" style={{ opacity: 0.35 }} />
      <div className="mbg-chromatic" />
      <div className="mbg-vignette" />
    </div>
  );
}

// ─── CHAPTER 1 — Cold Open ──────────────────────────────────────────────────
function ChapterCold({ active }) {
  const shards = [
    { label: 'CLIP', sub: '00:14', angle: 0,   r: 132, color: '#5EE7FF' },
    { label: 'TIER', sub: 'S → A', angle: 72,  r: 138, color: '#F5C542' },
    { label: 'LFG',  sub: '4 / 5', angle: 144, r: 130, color: '#C87FFF' },
    { label: 'ACH',  sub: '+ 850', angle: 216, r: 138, color: '#7B6FFF' },
    { label: 'XP',   sub: '12,480',angle: 288, r: 132, color: '#FF4D6A' },
  ];
  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', display: 'grid', placeItems: 'center' }}>
      <div style={{
        position: 'absolute', width: 290, height: 290, borderRadius: '50%',
        border: '1px dashed rgba(255,255,255,0.08)',
        animation: active ? 'fb-orbit 60s linear infinite' : 'none',
        opacity: active ? 1 : 0, transition: 'opacity 800ms',
      }}>
        {shards.map((s, i) => {
          const rad = (s.angle * Math.PI) / 180;
          const x = Math.cos(rad) * s.r, y = Math.sin(rad) * s.r;
          return (
            <div key={i} style={{
              position: 'absolute', left: '50%', top: '50%',
              transform: `translate(calc(-50% + ${x}px), calc(-50% + ${y}px))`,
              animation: active ? 'fb-orbit-rev 60s linear infinite' : 'none',
            }}>
              <div className="glass shard" style={{
                padding: '8px 11px', borderRadius: 12, minWidth: 60,
                background: 'linear-gradient(135deg, rgba(255,255,255,0.10), rgba(255,255,255,0.02))',
                animation: active ? `fb-float-y ${3 + (i % 3)}s ease-in-out ${i * 0.2}s infinite` : 'none',
                opacity: active ? 1 : 0,
                transition: `opacity 600ms ${500 + i * 100}ms, transform 800ms ${500 + i * 100}ms`,
              }}>
                <div className="mono" style={{ fontSize: 9, color: s.color, letterSpacing: '0.12em' }}>{s.label}</div>
                <div className="mono" style={{ fontSize: 11, color: '#fff', marginTop: 2 }}>{s.sub}</div>
              </div>
            </div>
          );
        })}
      </div>

      <div style={{
        position: 'relative', width: 168, height: 168, borderRadius: '50%',
        display: 'grid', placeItems: 'center',
        transform: active ? 'scale(1)' : 'scale(0.4)', opacity: active ? 1 : 0,
        transition: 'transform 1000ms cubic-bezier(.2,.7,.2,1), opacity 700ms',
        animation: active ? 'fb-pulse-glow 4s ease-in-out infinite' : 'none',
      }}>
        <div style={{
          position: 'absolute', inset: 0, borderRadius: '50%',
          background: 'conic-gradient(from 0deg, #7B6FFF, #C87FFF, #FF4D6A, #F5C542, #5EE7FF, #7B6FFF)',
          animation: active ? 'fb-orbit 18s linear infinite' : 'none', filter: 'blur(0.3px)',
        }} />
        <div style={{ position: 'relative', width: 'calc(100% - 8px)', height: 'calc(100% - 8px)', borderRadius: '50%', overflow: 'hidden', background: '#0A0B12' }}>
          <img src={`${A}/avatar.webp`} alt="" draggable="false" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block', userSelect: 'none' }} />
          <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(120deg, transparent 30%, rgba(255,255,255,0.18) 50%, transparent 70%)', animation: active ? 'fb-shimmer 3.4s linear infinite' : 'none', mixBlendMode: 'screen' }} />
        </div>
        <div style={{ position: 'absolute', bottom: 6, right: 6, width: 18, height: 18, borderRadius: '50%', background: '#22D67A', boxShadow: '0 0 12px #22D67A, 0 0 0 3px rgba(7,8,13,0.95)', animation: active ? 'fb-live-pulse 2s ease-in-out infinite' : 'none', zIndex: 5 }} />
      </div>

      <div style={{ position: 'absolute', left: 0, right: 0, bottom: '18%', display: 'grid', placeItems: 'center' }}>
        <HeroLine active={active} size="L">You don't post here.<br/><span className="accent">You play here.</span></HeroLine>
      </div>
    </div>
  );
}

// ─── CHAPTER 2 — Economy ────────────────────────────────────────────────────
function ChapterEconomy({ active }) {
  const [coins, setCoins] = useState(0);
  
  useEffect(() => {
    if (!active) { setCoins(0); return; }
    let raf;
    const start = performance.now();
    const tick = (t) => {
      const dt = Math.min(1, (t - start - 1400) / 1600);
      if (dt > 0) { setCoins(Math.floor(1000 * easeOut(dt))); }
      if (dt < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [active]);

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', display: 'grid', placeItems: 'center' }}>
      <div style={{ position: 'absolute', top: '22%', left: '50%', transform: 'translateX(-50%)', width: 100, height: 100, perspective: 600 }}>
        <img src={`${A}/vc-coin.webp`} alt="" draggable="false" style={{
          width: 100, height: 100, display: 'block',
          filter: 'drop-shadow(0 0 24px rgba(245,197,66,0.55)) drop-shadow(0 0 8px rgba(200,127,255,0.35))',
          animation: active ? 'fb-coin-tumble 2.4s cubic-bezier(.4,0,.2,1) forwards' : 'none',
          opacity: active ? 1 : 0, transformStyle: 'preserve-3d', backfaceVisibility: 'visible', userSelect: 'none',
        }} />
        {active && [...Array(8)].map((_, i) => {
          const angle = (i / 8) * Math.PI * 2;
          return (
            <img key={i} src={`${A}/vc-coin.webp`} alt="" draggable="false" style={{
              position: 'absolute', left: '50%', top: '50%', width: 28, height: 28, marginLeft: -14, marginTop: -14,
              filter: 'drop-shadow(0 0 10px rgba(245,197,66,0.9))',
              animation: `fb-shard-out 1.4s cubic-bezier(.2,.7,.2,1) ${2.2 + i * 0.05}s forwards`,
              '--dx': Math.cos(angle) * 60 + 'px', '--dy': Math.sin(angle) * 60 + 'px', opacity: 0, userSelect: 'none',
            }} />
          );
        })}
      </div>

      <div className="glass" style={{
        position: 'absolute', top: '46%', left: '50%',
        transform: active ? 'translateX(-50%) translateY(0) scale(1)' : 'translateX(-50%) translateY(20px) scale(0.92)',
        opacity: active ? 1 : 0, transition: 'all 900ms cubic-bezier(.2,.7,.2,1) 2.2s',
        padding: '18px 22px', minWidth: 240, borderRadius: 20,
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div className="mono" style={{ fontSize: 10, color: 'var(--ink-faint)', letterSpacing: '0.12em', textTransform: 'uppercase' }}>Wallet</div>
          <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
            <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#5EE7FF', boxShadow: '0 0 8px #5EE7FF' }} />
            <div className="mono" style={{ fontSize: 9, color: 'var(--ink-faint)', letterSpacing: '0.1em' }}>SYNCED</div>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 10 }}>
          <img src={`${A}/vc-coin.webp`} alt="" draggable="false" style={{ width: 36, height: 36, filter: 'drop-shadow(0 0 8px rgba(245,197,66,0.7))', userSelect: 'none' }} />
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
            <span className="mono" style={{ fontSize: 36, fontWeight: 500, color: '#fff', letterSpacing: '-0.02em' }}>{coins.toLocaleString()}</span>
            <span className="mono" style={{ fontSize: 13, color: 'var(--cyan)' }}>coins</span>
          </div>
        </div>
        <div style={{ height: 1, background: 'var(--hairline)', margin: '12px 0' }} />
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div className="mono" style={{ fontSize: 10, color: 'var(--ink-faint)', letterSpacing: '0.1em' }}>SPENDABLE ON VERGR</div>
          <span className="mono" style={{ fontSize: 16, color: '#fff', fontWeight: 500 }}>TIPS &middot; UNLOCKS</span>
        </div>
      </div>

      <div style={{ position: 'absolute', left: 0, right: 0, bottom: '18%', display: 'grid', placeItems: 'center' }}>
        <HeroLine active={active} size="M">Coins in.<br/><span className="accent">Creators paid.</span></HeroLine>
      </div>
    </div>
  );
}

// ─── CHAPTER 3 — VP Rank ────────────────────────────────────────────────────
// Level ranges mirror RANK_TIERS in src/utils/vpSystem.js (Immortal L100 omitted — no badge art).
const VP_RANKS = [
  { key: 'rookie',     name: 'Rookie',     range: '1-10',  color: '#C9883F', glow: 'rgba(201,136,63,0.7)' },
  { key: 'contender',  name: 'Contender',  range: '11-20', color: '#4ECDC4', glow: 'rgba(78,205,196,0.7)' },
  { key: 'rival',      name: 'Rival',      range: '21-30', color: '#C2CAD2', glow: 'rgba(194,202,210,0.6)' },
  { key: 'challenger', name: 'Challenger', range: '31-40', color: '#FF6B3D', glow: 'rgba(255,107,61,0.75)' },
  { key: 'elite',      name: 'Elite',      range: '41-50', color: '#F5C542', glow: 'rgba(245,197,66,0.75)' },
  { key: 'champion',   name: 'Champion',   range: '51-60', color: '#5EB7FF', glow: 'rgba(94,183,255,0.75)' },
  { key: 'veteran',    name: 'Veteran',    range: '61-70', color: '#6FD66F', glow: 'rgba(111,214,111,0.75)' },
  { key: 'legend',     name: 'Legend',     range: '71-80', color: '#FF8C2B', glow: 'rgba(255,140,43,0.8)' },
  { key: 'mythic',     name: 'Mythic',     range: '81-90', color: '#B47BFF', glow: 'rgba(180,123,255,0.8)' },
  { key: 'ascendant',  name: 'Ascendant',  range: '91-99', color: '#C7D1FF', glow: 'rgba(199,209,255,0.85)' },
];

function ChapterAdvantage({ active }) {
  const KEYFRAMES = [0, 4, 9];
  const [step, setStep] = useState(0);
  useEffect(() => {
    if (!active) { setStep(0); return; }
    const t1 = setTimeout(() => setStep(1), 1400);
    const t2 = setTimeout(() => setStep(2), 2900);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, [active]);
  const rankIdx = KEYFRAMES[step];
  const r = VP_RANKS[rankIdx];

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', display: 'grid', placeItems: 'center' }}>
      <div style={{ position: 'absolute', top: '14%', left: '50%', transform: 'translateX(-50%)', width: 220, height: 220, display: 'grid', placeItems: 'center' }}>
        <div style={{ position: 'absolute', inset: '-10%', background: `radial-gradient(circle, ${r.glow} 0%, transparent 65%)`, filter: 'blur(20px)', transition: 'background 700ms ease', opacity: active ? 1 : 0 }} />
        {VP_RANKS.map((rr, i) => (
          <img key={rr.key} src={`${A}/rank-${rr.key}.webp`} alt="" draggable="false" style={{
            position: 'absolute', width: 200, height: 200, objectFit: 'contain',
            opacity: i === rankIdx && active ? 1 : 0,
            transform: i === rankIdx && active ? 'scale(1) rotate(0deg)' : 'scale(0.6) rotate(-8deg)',
            transition: 'opacity 700ms cubic-bezier(.2,.7,.2,1), transform 900ms cubic-bezier(.2,.7,.2,1)',
            filter: 'drop-shadow(0 8px 24px rgba(0,0,0,0.5))', userSelect: 'none',
            animation: i === rankIdx && active ? 'fb-float-y 4s ease-in-out infinite' : 'none',
          }} />
        ))}
      </div>

      <div style={{ position: 'absolute', top: '52%', left: 0, right: 0, display: 'grid', placeItems: 'center', gap: 6 }}>
        <div className="mono" style={{ fontSize: 10, color: 'var(--ink-faint)', letterSpacing: '0.18em', textTransform: 'uppercase', opacity: active ? 1 : 0, transition: 'opacity 600ms' }}>VP Rank</div>
        <div className="syne" style={{
          fontSize: 'clamp(34px, 7.5vw, 48px)', fontWeight: 700, color: r.color, textShadow: `0 0 28px ${r.glow}`,
          lineHeight: 1, letterSpacing: '-0.02em', transition: 'color 600ms, text-shadow 600ms',
          opacity: active ? 1 : 0, transform: active ? 'translateY(0)' : 'translateY(8px)',
        }}>{r.name}</div>
        <div className="mono" style={{ fontSize: 12, color: 'var(--ink-dim)', letterSpacing: '0.12em', marginTop: 2, opacity: active ? 1 : 0, transition: 'opacity 600ms' }}>LV {r.range}</div>
      </div>

      <div style={{ position: 'absolute', bottom: '20%', left: 0, right: 0, display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 8, padding: '0 16px' }}>
        {VP_RANKS.map((rr, i) => {
          const reached = i <= rankIdx, isCurrent = i === rankIdx;
          return (
            <div key={rr.key} style={{
              position: 'relative', width: isCurrent ? 30 : 22, height: isCurrent ? 30 : 22, display: 'grid', placeItems: 'center',
              transition: 'width 500ms cubic-bezier(.2,.7,.2,1), height 500ms cubic-bezier(.2,.7,.2,1)',
              opacity: active ? (reached ? 1 : 0.32) : 0,
              filter: isCurrent ? `drop-shadow(0 0 8px ${rr.glow})` : (reached ? 'none' : 'grayscale(70%)'),
            }}>
              <img src={`${A}/rank-${rr.key}.webp`} alt="" draggable="false" style={{ width: '100%', height: '100%', objectFit: 'contain', userSelect: 'none' }} />
            </div>
          );
        })}
      </div>

      <div style={{ position: 'absolute', left: 0, right: 0, bottom: '7%', display: 'grid', placeItems: 'center' }}>
        <HeroLine active={active} size="M">From Rookie.<br/><span className="accent">To Ascendant.</span></HeroLine>
      </div>
    </div>
  );
}

// ─── CHAPTER 4 — Reach ──────────────────────────────────────────────────────
function ChapterReach({ active }) {
  const fullUrl = 'vergr.me/nyx';
  const [typed, setTyped] = useState('');
  const [phase, setPhase] = useState('type');
  useEffect(() => {
    if (!active) { setTyped(''); setPhase('type'); return; }
    let i = 0;
    const ti = setInterval(() => { i++; setTyped(fullUrl.slice(0, i)); if (i >= fullUrl.length) clearInterval(ti); }, 80);
    const t1 = setTimeout(() => setPhase('live'), 1700);
    const t2 = setTimeout(() => setPhase('tip'), 2600);
    return () => { clearInterval(ti); clearTimeout(t1); clearTimeout(t2); };
  }, [active]);

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', display: 'grid', placeItems: 'center' }}>
      <div className="glass" style={{
        position: 'absolute', top: '22%', padding: '14px 22px', borderRadius: 999, display: 'flex', alignItems: 'center', gap: 8,
        opacity: phase === 'type' ? 1 : 0.3, transform: phase === 'type' ? 'scale(1)' : 'scale(0.9) translateY(-10px)', transition: 'all 700ms cubic-bezier(.4,.0,.2,1)',
      }}>
        <span className="mono" style={{ fontSize: 11, color: 'var(--cyan)', letterSpacing: '0.1em' }}>https://</span>
        <span className="mono" style={{ fontSize: 16, color: '#fff', letterSpacing: '0.02em' }}>{typed}</span>
        <span style={{ display: 'inline-block', width: 2, height: 18, background: '#fff', animation: 'fb-blink-cursor 0.9s steps(1) infinite' }} />
      </div>

      <div className="glass" style={{
        position: 'absolute', top: '34%', width: 220, height: 130, padding: 0, borderRadius: 16, overflow: 'hidden',
        opacity: phase !== 'type' ? 1 : 0, transform: phase !== 'type' ? 'scale(1) translateY(0)' : 'scale(0.85) translateY(20px)', transition: 'all 700ms cubic-bezier(.2,.7,.2,1)',
      }}>
        <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(135deg, rgba(94,231,255,0.25), rgba(123,111,255,0.4) 50%, rgba(255,77,106,0.3))' }} />
        <div style={{ position: 'absolute', top: 10, left: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
          <div style={{ width: 7, height: 7, borderRadius: '50%', background: '#FF4D6A', boxShadow: '0 0 8px #FF4D6A', animation: 'fb-live-pulse 1.6s ease-in-out infinite' }} />
          <span className="mono" style={{ fontSize: 9, color: '#fff', letterSpacing: '0.16em', fontWeight: 500 }}>LIVE</span>
        </div>
        <div style={{ position: 'absolute', top: 10, right: 12 }}><span className="mono" style={{ fontSize: 9, color: 'rgba(255,255,255,0.85)', letterSpacing: '0.1em' }}>3.4K</span></div>
        <div style={{ position: 'absolute', bottom: 12, left: 12, right: 12 }}>
          <div className="syne" style={{ fontSize: 13, fontWeight: 600, color: '#fff', textShadow: '0 1px 2px rgba(0,0,0,0.5)' }}>nyx · ranked grind to elite</div>
        </div>
        <div style={{ position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%,-50%)', width: 36, height: 36, borderRadius: '50%', background: 'rgba(7,8,13,0.5)', backdropFilter: 'blur(8px)', border: '1px solid rgba(255,255,255,0.2)', display: 'grid', placeItems: 'center' }}>
          <div style={{ width: 0, height: 0, borderLeft: '10px solid #fff', borderTop: '6px solid transparent', borderBottom: '6px solid transparent', marginLeft: 3 }} />
        </div>
      </div>

      {phase === 'tip' && [...Array(6)].map((_, i) => {
        const sx = -120 + (i % 2 === 0 ? -60 : 60) - (i * 8);
        const sy = 80 - i * 14;
        return (
          <img key={i} src={`${A}/vc-coin.webp`} alt="" draggable="false" style={{
            position: 'absolute', top: 'calc(34% + 65px)', left: '50%', width: 26, height: 26, marginLeft: -13, marginTop: -13,
            filter: 'drop-shadow(0 0 10px rgba(245,197,66,0.8))', '--sx': sx + 'px', '--sy': sy + 'px',
            animation: `fb-gem-in 1.1s cubic-bezier(.2,.7,.2,1) ${i * 0.08}s forwards`, opacity: 0, userSelect: 'none',
          }} />
        );
      })}

      <div style={{ position: 'absolute', left: 0, right: 0, bottom: '14%', display: 'grid', placeItems: 'center' }}>
        <HeroLine active={active} size="M">Your handle. Your link.<br/><span className="accent">Your stage.</span></HeroLine>
      </div>
    </div>
  );
}

// ─── CHAPTER 5 — Crew ───────────────────────────────────────────────────────
function ChapterCrew({ active }) {
  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', display: 'grid', placeItems: 'center' }}>
      <div style={{ position: 'absolute', top: '11%', left: 0, right: 0, bottom: '30%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, padding: '0 20px' }}>
        <div style={{ display: 'contents' }}>
          <div className="glass" style={{
            position: 'relative', width: 'min(86%, 330px)', padding: 14, borderRadius: 16,
            transform: active ? 'rotate(-2deg) translateY(0)' : 'rotate(-2deg) translateY(16px)',
            opacity: active ? 1 : 0, transition: 'all 700ms cubic-bezier(.2,.7,.2,1) 150ms',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
              <div style={{ display: 'flex' }}>
                {['#7B6FFF', '#C87FFF', '#5EE7FF', '#F5C542'].map((c, i) => (
                  <div key={i} style={{ width: 18, height: 18, borderRadius: '50%', background: c, marginLeft: i ? -6 : 0, border: '1.5px solid var(--surface)' }} />
                ))}
              </div>
              <div className="mono" style={{ fontSize: 9, color: 'var(--ink-faint)', letterSpacing: '0.1em', textTransform: 'uppercase' }}>SQUAD · 4</div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div style={{ display: 'flex', gap: 6 }}><div className="mono" style={{ fontSize: 10, color: '#5EE7FF', fontWeight: 600 }}>vex</div><div style={{ fontSize: 11, color: 'var(--ink)' }}>queue ranked?</div></div>
              <div style={{ display: 'flex', gap: 6 }}><div className="mono" style={{ fontSize: 10, color: '#F5C542', fontWeight: 600 }}>kai</div><div style={{ fontSize: 11, color: 'var(--ink)' }}>i'm down. nyx?</div></div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 2 }}><div className="mono" style={{ fontSize: 10, color: '#C87FFF', fontWeight: 600 }}>nyx</div><span className="type-dot" /><span className="type-dot" /><span className="type-dot" /></div>
            </div>
          </div>

          <div className="glass" style={{
            position: 'relative', width: 'min(86%, 330px)', borderRadius: 16, padding: 14,
            transform: active ? 'rotate(1.5deg) translateY(0)' : 'rotate(1.5deg) translateY(16px)',
            opacity: active ? 1 : 0, transition: 'all 700ms cubic-bezier(.2,.7,.2,1) 300ms',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
              <div className="mono" style={{ fontSize: 9, color: 'var(--gold)', letterSpacing: '0.12em', textTransform: 'uppercase' }}>★ Final</div>
              <div className="mono" style={{ fontSize: 9, color: 'var(--ink-faint)', letterSpacing: '0.1em' }}>BO5</div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 8px', background: 'rgba(255,255,255,0.04)', borderRadius: 8 }}>
                <div className="syne" style={{ fontSize: 11, color: '#fff', fontWeight: 600 }}>REBOOT.GG</div><div className="mono" style={{ fontSize: 12, color: '#5EE7FF' }}>3</div>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 8px', background: 'rgba(255,255,255,0.02)', borderRadius: 8 }}>
                <div className="syne" style={{ fontSize: 11, color: 'var(--ink-dim)' }}>VOID.CULT</div><div className="mono" style={{ fontSize: 12, color: 'var(--ink-dim)' }}>1</div>
              </div>
            </div>
            <div style={{ borderTop: '1px solid var(--hairline)', marginTop: 10, paddingTop: 10, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div className="mono" style={{ fontSize: 9, color: 'var(--ink-faint)', letterSpacing: '0.12em', textTransform: 'uppercase' }}>Pool</div>
              <div className="mono" style={{ fontSize: 14, fontWeight: 500, color: 'var(--gold)' }}>50,000<span style={{ fontSize: 10, marginLeft: 3 }}>coins</span></div>
            </div>
          </div>

          <div className="glass" style={{
            position: 'relative', width: 'min(86%, 330px)', padding: 14, borderRadius: 16,
            transform: active ? 'rotate(-1.5deg) translateY(0)' : 'rotate(-1.5deg) translateY(16px)',
            opacity: active ? 1 : 0, transition: 'all 700ms cubic-bezier(.2,.7,.2,1) 450ms',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
              <div style={{ width: 22, height: 22, borderRadius: '50%', background: 'linear-gradient(135deg, #FF4D6A, #C87FFF)' }} />
              <div><div className="syne" style={{ fontSize: 11, fontWeight: 600, color: '#fff' }}>@orbit</div><div className="mono" style={{ fontSize: 8, color: 'var(--cyan)', letterSpacing: '0.1em' }}>● ONLINE</div></div>
            </div>
            <div style={{ background: 'rgba(123,111,255,0.16)', border: '1px solid rgba(123,111,255,0.25)', borderRadius: 10, padding: '8px 10px', fontSize: 11, color: 'var(--ink)' }}>gg, your aim looked unreal</div>
            <div style={{ marginTop: 6, background: 'rgba(255,255,255,0.04)', borderRadius: 10, padding: '8px 10px', fontSize: 11, color: 'var(--ink-dim)' }}>haha thx, custom binds</div>
          </div>
        </div>
      </div>

      <div style={{ position: 'absolute', left: 0, right: 0, bottom: '14%', display: 'grid', placeItems: 'center' }}>
        <HeroLine active={active} size="M">Squads. DMs.<br/><span className="accent">Live events.</span></HeroLine>
      </div>
    </div>
  );
}

// ─── CHAPTER 6 — Private (E2E) ──────────────────────────────────────────────
function LockIcon({ size = 12, armed = false }) {
  const color = armed ? '#5EE7FF' : 'rgba(255,255,255,0.55)';
  return (
    <svg width={size * 1.1} height={size * 1.3} viewBox="0 0 11 13" fill="none" style={{ filter: armed ? `drop-shadow(0 0 4px ${color})` : 'none', transition: 'filter 600ms' }}>
      <rect x="1.5" y="5.5" width="8" height="6.5" rx="1.4" fill={color} fillOpacity="0.85"/>
      <path d="M 3 5.5 V 4 a 2.5 2.5 0 0 1 5 0 V 5.5" stroke={color} strokeWidth="1.2" fill="none" strokeLinecap="round"/>
      <circle cx="5.5" cy="8.5" r="0.85" fill="#07080D"/>
    </svg>
  );
}

function ChapterPrivate({ active }) {
  const target1 = 'meet at the gates. 11pm.';
  const target2 = 'aim file dropped 🔒';
  const cipher = '▓▒█░◇◆◈⬡⬢⌬⏣⎔';
  const [scram1, setScram1] = useState('');
  const [scram2, setScram2] = useState('');
  const [keyArmed, setKeyArmed] = useState(false);

  useEffect(() => {
    if (!active) { setScram1(''); setScram2(''); setKeyArmed(false); return; }
    const cipherFill = (str) => str.split('').map((c) => (c === ' ' ? ' ' : cipher[Math.floor(Math.random() * cipher.length)])).join('');
    setScram1(cipherFill(target1));
    setScram2(cipherFill(target2));
    const armT = setTimeout(() => setKeyArmed(true), 700);
    let i1 = 0;
    const dec1 = setInterval(() => {
      i1++;
      setScram1((prev) => { const out = prev.split(''); for (let k = 0; k < out.length; k++) { if (k < i1) out[k] = target1[k]; else if (out[k] !== ' ') out[k] = cipher[Math.floor(Math.random() * cipher.length)]; } return out.join(''); });
      if (i1 >= target1.length) clearInterval(dec1);
    }, 55);
    let dec2;
    const dec2Start = setTimeout(() => {
      let i2 = 0;
      dec2 = setInterval(() => {
        i2++;
        setScram2((prev) => { const out = prev.split(''); for (let k = 0; k < out.length; k++) { if (k < i2) out[k] = target2[k]; else if (out[k] !== ' ') out[k] = cipher[Math.floor(Math.random() * cipher.length)]; } return out.join(''); });
        if (i2 >= target2.length) clearInterval(dec2);
      }, 50);
    }, 1700);
    return () => { clearTimeout(armT); clearTimeout(dec2Start); clearInterval(dec1); clearInterval(dec2); };
  }, [active]);

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', display: 'grid', placeItems: 'center' }}>
      <div className="glass" style={{
        position: 'absolute', top: '17%', width: 'min(86%, 320px)', padding: 0, borderRadius: 22, overflow: 'hidden',
        opacity: active ? 1 : 0, transform: active ? 'translateY(0) scale(1)' : 'translateY(20px) scale(0.94)', transition: 'all 900ms cubic-bezier(.2,.7,.2,1)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px', borderBottom: '1px solid var(--hairline)', background: 'linear-gradient(180deg, rgba(94,231,255,0.06), transparent)' }}>
          <div style={{ width: 32, height: 32, borderRadius: '50%', background: 'linear-gradient(135deg, #FF4D6A, #C87FFF)', border: '1.5px solid rgba(255,255,255,0.15)' }} />
          <div style={{ flex: 1 }}>
            <div className="syne" style={{ fontSize: 13, fontWeight: 600, color: '#fff' }}>@orbit</div>
            <div className="mono" style={{ fontSize: 8.5, color: 'var(--ink-faint)', letterSpacing: '0.14em', textTransform: 'uppercase', marginTop: 1 }}>vergr.me/orbit</div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '4px 9px 4px 7px', borderRadius: 999, background: 'rgba(94,231,255,0.10)', border: '1px solid rgba(94,231,255,0.30)', boxShadow: keyArmed ? '0 0 14px rgba(94,231,255,0.45)' : 'none', transition: 'box-shadow 600ms' }}>
            <LockIcon size={10} armed={keyArmed} />
            <span className="mono" style={{ fontSize: 8.5, color: 'var(--cyan)', letterSpacing: '0.12em', fontWeight: 500 }}>E2E</span>
          </div>
        </div>

        <div style={{ padding: '14px 14px 16px', display: 'flex', flexDirection: 'column', gap: 10, minHeight: 180 }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6, maxWidth: '85%' }}>
            <div style={{ background: 'rgba(123,111,255,0.18)', border: '1px solid rgba(123,111,255,0.30)', borderRadius: '14px 14px 14px 4px', padding: '9px 12px', fontSize: 13, color: 'var(--ink)', fontFamily: 'DM Mono, monospace', letterSpacing: '0.01em', minWidth: 100 }}>{scram1 || ' '}</div>
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', maxWidth: '85%', marginLeft: 'auto' }}>
            <div style={{ background: 'rgba(94,231,255,0.12)', border: '1px solid rgba(94,231,255,0.30)', borderRadius: '14px 14px 4px 14px', padding: '9px 12px', fontSize: 13, color: 'var(--ink)', fontFamily: 'DM Mono, monospace', letterSpacing: '0.01em', minWidth: 100 }}>{scram2 || ' '}</div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, paddingTop: 6, opacity: keyArmed && active ? 1 : 0, transition: 'opacity 800ms 400ms' }}>
            <LockIcon size={9} armed={true} />
            <span className="mono" style={{ fontSize: 9, color: 'var(--ink-faint)', letterSpacing: '0.16em', textTransform: 'uppercase' }}>Private. Never read by AI or moderators</span>
          </div>
        </div>
      </div>

      <div style={{ position: 'absolute', left: 0, right: 0, bottom: '16%', display: 'grid', placeItems: 'center' }}>
        <HeroLine active={active} size="M">Yours.<br/><span className="accent">Instant secure messaging.</span></HeroLine>
      </div>
    </div>
  );
}

// ─── CHAPTER 7 — Handoff ────────────────────────────────────────────────────
function ChapterHandoff({ active, onEnter }) {
  const [collapsed, setCollapsed] = useState(false);
  const [ctaShow, setCtaShow] = useState(false);
  useEffect(() => {
    if (!active) { setCollapsed(false); setCtaShow(false); return; }
    const t1 = setTimeout(() => setCollapsed(true), 800);
    const t2 = setTimeout(() => setCtaShow(true), 1900);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, [active]);

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', display: 'grid', placeItems: 'center' }}>
      <div style={{ position: 'absolute', top: '30%', left: 0, right: 0, display: 'grid', placeItems: 'center', height: 80 }}>
        {!collapsed && [...Array(12)].map((_, i) => {
          const angle = (i / 12) * Math.PI * 2;
          return (
            <div key={i} style={{
              position: 'absolute', width: 3, height: 3, borderRadius: '50%',
              background: ['#5EE7FF', '#7B6FFF', '#C87FFF', '#F5C542'][i % 4], boxShadow: '0 0 8px currentColor',
              transform: `translate(${Math.cos(angle) * 80}px, ${Math.sin(angle) * 80}px)`,
              opacity: active ? 1 : 0, transition: 'transform 700ms cubic-bezier(.4,0,.2,1), opacity 400ms',
            }} />
          );
        })}
        <div className="wordmark" style={{ fontSize: 'clamp(48px, 11vw, 88px)', opacity: collapsed ? 1 : 0, transform: collapsed ? 'scale(1)' : 'scale(0.6)', transition: 'all 900ms cubic-bezier(.2,.7,.2,1)' }}>VERGR</div>
      </div>

      <div style={{ position: 'absolute', top: '50%', left: 0, right: 0, display: 'grid', placeItems: 'center' }}>
        <HeroLine active={collapsed} size="S">Ready, Player.</HeroLine>
      </div>

      <div style={{ position: 'absolute', bottom: '20%', left: 0, right: 0, display: 'grid', placeItems: 'center' }}>
        <button className="cta-cyan" onClick={onEnter} style={{ opacity: ctaShow ? 1 : 0, transform: ctaShow ? 'translateY(0)' : 'translateY(10px)', transition: 'opacity 700ms, transform 700ms', pointerEvents: ctaShow ? 'auto' : 'none' }}>
          Enter VERGR <span className="arrow">→</span>
        </button>
      </div>
    </div>
  );
}

const COMPONENTS = { ChapterCold, ChapterEconomy, ChapterAdvantage, ChapterReach, ChapterCrew, ChapterPrivate, ChapterHandoff };

// ─── Orchestrator ───────────────────────────────────────────────────────────
export function FirstBootIntro({ onComplete }) {
  const [chapter, setChapter] = useState(0);
  const [progress, setProgress] = useState(0);
  const [microIdx, setMicroIdx] = useState(0);
  const [leaving, setLeaving] = useState(false);
  const startRef = useRef(performance.now());
  const doneRef = useRef(false);

  const finish = useCallback(() => {
    if (doneRef.current) return;
    doneRef.current = true;
    setLeaving(true);
    setTimeout(() => onComplete?.(), 600);
  }, [onComplete]);

  // Drive chapter progression (play once, no loop)
  useEffect(() => {
    let raf;
    const tick = (t) => {
      const dur = CHAPTERS[chapter].duration;
      const p = Math.min(1, (t - startRef.current) / dur);
      setProgress(p);
      if (p >= 1 && chapter < CHAPTERS.length - 1) {
        setChapter((c) => c + 1);
        startRef.current = t;
        setProgress(0);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [chapter]);

  // Rotating microcopy
  useEffect(() => {
    const i = setInterval(() => setMicroIdx((m) => (m + 1) % MICROCOPY.length), 2400);
    return () => clearInterval(i);
  }, []);

  const jumpTo = (idx) => { setChapter(idx); startRef.current = performance.now(); setProgress(0); };
  const isHandoff = chapter === CHAPTERS.length - 1;

  return (
    <div className={`fb-root${leaving ? ' fb-leaving' : ''}`} role="dialog" aria-label="Welcome to VERGR">
      <MotionBackground />

      <div className="progress-sliver">
        <div className="progress-sliver-fill" style={{ width: `${((chapter + progress) / CHAPTERS.length) * 100}%` }} />
      </div>

      {CHAPTERS.map((ch, i) => {
        const C = COMPONENTS[ch.component];
        const cls = 'chapter ' + (i === chapter ? 'in' : i < chapter ? 'out' : '');
        return (
          <div key={ch.key} className={cls} style={{ display: Math.abs(i - chapter) <= 1 ? 'grid' : 'none' }}>
            <C active={i === chapter} onEnter={finish} />
          </div>
        );
      })}

      {!isHandoff && (
        <div className="skip-intro" onClick={() => jumpTo(CHAPTERS.length - 1)}>
          Skip intro <span className="arrow">→</span>
        </div>
      )}
      {!isHandoff && <div className="microcopy" key={microIdx}>{MICROCOPY[microIdx]}</div>}
    </div>
  );
}

// ─── Gate: plays the intro once, right after a new user finishes onboarding ───
// OnboardingCompleteScreen sets PENDING_KEY + fires FIRST_BOOT_EVENT before
// routing to '/'. We do NOT show it on a cold first visit — only post-onboarding.
export default function FirstBootGate() {
  const { loading } = useAuth();
  const [show, setShow] = useState(false);

  useEffect(() => {
    const trigger = () => {
      let seen = true, pending = false;
      try {
        seen = localStorage.getItem(SEEN_KEY) === '1';
        pending = localStorage.getItem(PENDING_KEY) === '1';
      } catch {}
      if (pending && !seen) setShow(true);
    };
    // Covers a reload that happens while the intro is still pending.
    if (!loading) trigger();
    window.addEventListener(FIRST_BOOT_EVENT, trigger);
    return () => window.removeEventListener(FIRST_BOOT_EVENT, trigger);
  }, [loading]);

  const complete = useCallback(() => {
    try { localStorage.setItem(SEEN_KEY, '1'); localStorage.removeItem(PENDING_KEY); } catch {}
    setShow(false);
  }, []);

  if (!show) return null;
  return <FirstBootIntro onComplete={complete} />;
}
