// Animated emoji renderer (Telegram-style). Renders the Noto Lottie animation
// (or founder-supplied custom art) for emojis that have one; any emoji without
// an animated version gets the normal unicode glyph.
//
// NOTE: rendering is NOT tier-gated — everyone SEES animated emoji (that's the
// tease, like Telegram Premium stickers). USING them (reacting/sending) is
// gated to Lite/Pro at the action site via <AnimatedEmojiUpsell>.
//
// Perf: the Lottie runtime (lottie_light, SVG renderer) is lazy-imported once;
// animation JSON is cached module-wide; each instance only mounts its player
// while visible (IntersectionObserver) and pauses off-screen — so a picker
// grid or long chat thread doesn't run dozens of hidden animations.
import { useEffect, useRef, useState } from 'react';
import { animatedEmojiSrc } from '../utils/reactionAssets';

let lottiePromise = null;
const loadLottie = () => (lottiePromise ||= import('lottie-web/build/player/lottie_light').then((m) => m.default));

// Warms the Lottie runtime chunk ahead of the first hover in a picker grid
// (hoverToPlay never calls loadLottie until hover, so without this the very
// first animated hover pays the JS-chunk fetch on top of the per-emoji one).
export const preloadLottieRuntime = () => { loadLottie(); };

const dataCache = new Map(); // src -> Promise<animationData>
const loadData = (src) => {
  if (!dataCache.has(src)) {
    dataCache.set(src, fetch(src).then((r) => {
      if (!r.ok) throw new Error(`emoji fetch ${r.status}`);
      return r.json();
    }).catch((err) => { dataCache.delete(src); throw err; }));
  }
  return dataCache.get(src);
};

// ── Picker-grid playback budget ──
// playOnceInView tiles queue for one of N concurrent fetch+init+play slots,
// so a grid full of animated emoji comes alive in staggered waves instead of
// stampeding the main thread the moment the picker opens (Telegram staggers
// too). Each animation plays ONCE and freezes on its end pose, so steady-state
// CPU is zero no matter how many tiles are on screen.
const PLAY_MAX = 6;
let playActive = 0;
const playQueue = [];
const acquirePlaySlot = () => new Promise((resolve) => {
  if (playActive < PLAY_MAX) { playActive += 1; resolve(); }
  else playQueue.push(resolve);
});
const releasePlaySlot = () => {
  const next = playQueue.shift();
  if (next) next();
  else playActive = Math.max(0, playActive - 1);
};

// One shared IntersectionObserver for every picker tile (a picker renders
// 1,500+ cells; per-cell observers are needless overhead). Fires each
// element's callback once, then forgets it.
let sharedIO = null;
const ioCallbacks = new WeakMap();
const observeOnce = (el, cb) => {
  if (!sharedIO) {
    sharedIO = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        const fn = ioCallbacks.get(e.target);
        if (fn) { ioCallbacks.delete(e.target); sharedIO.unobserve(e.target); fn(); }
      }
    }, { rootMargin: '60px' });
  }
  ioCallbacks.set(el, cb);
  sharedIO.observe(el);
  return () => { ioCallbacks.delete(el); sharedIO.unobserve(el); };
};

function GlyphSpan({ emoji, size, className, onMouseEnter, onMouseLeave }) {
  return (
    <span className={className} role="img" onMouseEnter={onMouseEnter} onMouseLeave={onMouseLeave}
      style={{ color: 'initial', fontSize: size, lineHeight: 1, display: 'inline-block' }}>
      {emoji}
    </span>
  );
}

// hoverToPlay: for a picker GRID of up to a few hundred emoji, running every
// animated one at once (the default "always" behaviour, used everywhere
// else — reaction bar, chips, chat bubbles) was the actual lag — dozens of
// concurrent fetch+decode+SVG-render cycles the moment the picker opens.
// With hoverToPlay a tile shows the plain glyph (free, instant) and only
// fetches/animates the ONE emoji currently under the cursor.
export default function ReactionEmoji({ emoji, size = 20, loop = true, className = '', hoverToPlay = false, playOnceInView = false }) {
  const anim = animatedEmojiSrc(emoji);
  const [hovering, setHovering] = useState(false);
  const hoverTimerRef = useRef(null);
  useEffect(() => () => clearTimeout(hoverTimerRef.current), []);

  const onEnter = () => {
    clearTimeout(hoverTimerRef.current);
    hoverTimerRef.current = setTimeout(() => setHovering(true), 120);
  };
  const onLeave = () => {
    clearTimeout(hoverTimerRef.current);
    setHovering(false);
  };

  if (!anim) {
    return <GlyphSpan emoji={emoji} size={size} className={className} onMouseEnter={hoverToPlay ? onEnter : undefined} onMouseLeave={hoverToPlay ? onLeave : undefined} />;
  }
  if (anim.type === 'custom' && !anim.src.endsWith('.json')) {
    return (
      <img src={anim.src} alt={emoji} width={size} height={size} draggable={false}
        className={className} style={{ display: 'inline-block', objectFit: 'contain' }} />
    );
  }
  if (playOnceInView) {
    return <InViewOnceEmoji src={anim.src} emoji={emoji} size={size} className={className} />;
  }
  if (hoverToPlay && !hovering) {
    return <GlyphSpan emoji={emoji} size={size} className={className} onMouseEnter={onEnter} onMouseLeave={onLeave} />;
  }
  return (
    <span onMouseEnter={hoverToPlay ? onEnter : undefined} onMouseLeave={hoverToPlay ? onLeave : undefined} style={{ display: 'inline-block' }}>
      <LottieEmoji key={anim.src} src={anim.src} emoji={emoji} size={size} loop={loop} className={className} />
    </span>
  );
}

// Picker-grid mode (Telegram behaviour): the glyph paints instantly, and when
// the tile scrolls into view the animation plays ONCE (budgeted, see slots
// above) then freezes on its end pose. The glyph stays visible underneath
// until the player has actually rendered, so a tile is never blank while the
// Lottie JSON downloads — that gap was the visible "loading delay".
function InViewOnceEmoji({ src, emoji, size, className }) {
  const hostRef = useRef(null);
  const [animReady, setAnimReady] = useState(false);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let cancelled = false;
    let animInst = null;
    let released = true; // becomes false while we hold a slot

    const release = () => { if (!released) { released = true; releasePlaySlot(); } };

    const start = async () => {
      await acquirePlaySlot();
      released = false;
      if (cancelled) { release(); return; }
      try {
        const [lottie, animationData] = await Promise.all([loadLottie(), loadData(src)]);
        if (cancelled || !hostRef.current) { release(); return; }
        animInst = lottie.loadAnimation({
          container: hostRef.current, renderer: 'svg', loop: false, autoplay: true, animationData,
        });
        animInst.addEventListener('DOMLoaded', () => { if (!cancelled) setAnimReady(true); });
        animInst.addEventListener('complete', release);
      } catch {
        release(); // glyph simply stays — never a broken tile
      }
    };

    const unobserve = observeOnce(host, start);
    return () => {
      cancelled = true;
      unobserve();
      release();
      try { animInst?.destroy(); } catch {}
    };
  }, [src]);

  return (
    <span className={className} style={{ position: 'relative', display: 'inline-block', width: size, height: size }}>
      <span role="img" aria-label={emoji} style={{
        position: 'absolute', inset: 0, fontSize: size, lineHeight: `${size}px`, textAlign: 'center',
        color: 'initial', opacity: animReady ? 0 : 1,
      }}>
        {emoji}
      </span>
      <span ref={hostRef} style={{ position: 'absolute', inset: 0, lineHeight: 0 }} />
    </span>
  );
}

function LottieEmoji({ src, emoji, size, loop, className }) {
  const hostRef = useRef(null);
  const animRef = useRef(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let cancelled = false;

    const ensurePlayer = async () => {
      if (animRef.current) { animRef.current.play(); return; }
      try {
        const [lottie, animationData] = await Promise.all([loadLottie(), loadData(src)]);
        if (cancelled || !hostRef.current) return;
        animRef.current = lottie.loadAnimation({
          container: hostRef.current, renderer: 'svg', loop, autoplay: true, animationData,
        });
      } catch {
        if (!cancelled) setFailed(true); // falls back to the glyph
      }
    };

    const io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (e.isIntersecting) ensurePlayer();
        else animRef.current?.pause();
      }
    }, { rootMargin: '80px' });
    io.observe(host);

    return () => {
      cancelled = true;
      io.disconnect();
      try { animRef.current?.destroy(); } catch {}
      animRef.current = null;
    };
  }, [src, loop]);

  if (failed) {
    return (
      <span className={className} role="img" style={{ color: 'initial', fontSize: size, lineHeight: 1, display: 'inline-block' }}>
        {emoji}
      </span>
    );
  }
  return (
    <span ref={hostRef} className={className} role="img" aria-label={emoji}
      style={{ display: 'inline-block', width: size, height: size, lineHeight: 0 }} />
  );
}
