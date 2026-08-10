// SFX bank — short Mixkit-sourced sound effects for streaming moments.
// All files royalty-free, commercial-safe, no attribution required.
// Curated to avoid clichés (no cash-register dings, fanfares, casino bells).
//
// Files are deliberately NOT auto-loaded; we lazy-create AudioContext + buffers
// on first play() so we don't waste decode time on cold pages.
//
// Files expected at /public/sfx/<name>.mp3 — see public/sfx/README.md for
// the curated source list + commit step.

const TRACKS = {
  // Chat / interaction
  tap:           '/sfx/tap.mp3',           // very short soft click
  heart:         '/sfx/heart.mp3',         // gentle "pop" for heart react
  tipSmall:      '/sfx/tip-small.mp3',     // soft chime for sub-50c tips
  tipMid:        '/sfx/tip-mid.mp3',       // warmer chime for 50-499c
  tipBig:        '/sfx/tip-big.mp3',       // brief glissando for 500c+
  // Stream lifecycle
  streamStart:   '/sfx/stream-start.mp3',  // soft whoosh on go-live
  streamEnd:     '/sfx/stream-end.mp3',    // soft fade-down
  // Social
  follow:        '/sfx/follow.mp3',        // very brief twinkle (for broadcaster, on receiving new follower)
  link:          '/sfx/link.mp3',          // chime when Multi-Guest links up
  unlink:        '/sfx/unlink.mp3',        // soft drop when partner leaves
};

let ctx = null;
const bufferCache = new Map();   // url → AudioBuffer
let userVolume = 0.55;           // 0..1, settable via setVolume()
let muted = false;

function getContext() {
  if (typeof window === 'undefined') return null;
  if (!ctx) {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return null;
    ctx = new Ctx();
  }
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  return ctx;
}

async function loadBuffer(url) {
  if (bufferCache.has(url)) return bufferCache.get(url);
  const ac = getContext();
  if (!ac) return null;
  try {
    const resp = await fetch(url);
    if (!resp.ok) { bufferCache.set(url, null); return null; }
    const arr = await resp.arrayBuffer();
    const buf = await ac.decodeAudioData(arr);
    bufferCache.set(url, buf);
    return buf;
  } catch {
    // Missing/undecodable file (the SPA rewrite serves index.html for absent
    // assets). SFX are optional garnish — fail silent, cache the miss so we
    // never refetch or log again this session.
    bufferCache.set(url, null);
    return null;
  }
}

/** Play a named track. Returns a promise resolving when started (not finished). */
export async function play(name, { volume = 1, rate = 1 } = {}) {
  if (muted) return;
  const url = TRACKS[name];
  if (!url) { console.warn('sfx unknown track:', name); return; }
  const ac = getContext();
  if (!ac) return;
  const buf = await loadBuffer(url);
  if (!buf) return;
  const src = ac.createBufferSource();
  src.buffer = buf;
  src.playbackRate.value = rate;
  const gain = ac.createGain();
  gain.gain.value = Math.max(0, Math.min(1, userVolume * volume));
  src.connect(gain).connect(ac.destination);
  src.start(0);
}

/** Preload selected tracks (called by the broadcaster + viewer on mount). */
export function preload(names) {
  names.forEach((n) => {
    const url = TRACKS[n];
    if (url) loadBuffer(url).catch(() => {});
  });
}

export function setVolume(v) {
  userVolume = Math.max(0, Math.min(1, v));
  try {
    localStorage.setItem('vergr_sfx_volume', String(userVolume));
  } catch {}
}
export function getVolume() { return userVolume; }

export function setMuted(m) {
  muted = !!m;
  try { localStorage.setItem('vergr_sfx_muted', m ? '1' : '0'); } catch {}
}
export function isMuted() { return muted; }

// Restore prefs on import.
try {
  const v = localStorage.getItem('vergr_sfx_volume');
  if (v != null) userVolume = Math.max(0, Math.min(1, parseFloat(v)));
  muted = localStorage.getItem('vergr_sfx_muted') === '1';
} catch {}
