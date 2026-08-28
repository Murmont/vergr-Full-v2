// The typefaces a user can put their name in, and the loader that fetches one
// ONLY when it is actually on screen.
//
// ── WHY THE OLD THREE-FONT LIST WAS THE WRONG ANSWER ────────────────
//
// The first version offered DM Sans / Syne / DM Mono and justified it as "the
// families already loaded, so it costs nothing". Founder, 2026-08-24: "there are
// only 3 options for typeface? can't we add cool and weird fonts and stuff not
// plain and boring fonts". Fair — that was a cost argument used to avoid work,
// and it made an earned reward boring.
//
// The cost concern was real but the conclusion was lazy. The actual risk is a
// live chat with 30 speakers triggering 30 font downloads. The fix is not fewer
// fonts, it is DEMAND LOADING plus a cap:
//
//   * a family's stylesheet is injected the FIRST time a name using it renders,
//     never before, and never again (`loaded` Set)
//   * only weight 400 is requested, because a name is one short string
//   * `display=swap`, so a name is never invisible while a font is in flight
//   * the browser caches it, so the second stream costs nothing
//
// A realistic worst case is a chat where 10 distinct faces appear: ~10 small
// woff2 files, once, then cached forever. That is a far better trade than
// shipping a boring reward.
//
// ⚠ NO CSP CHANGE IS NEEDED, and this was checked rather than assumed:
// `src-tauri/tauri.conf.json` already allows `https://fonts.googleapis.com` in
// `style-src` and `https://fonts.gstatic.com` in `font-src`, so this works in
// the native build as well as on the web.
//
// ⚠ Cost to Vergr: ZERO. Google Fonts is free and served from Google's CDN, so
// this adds no bandwidth to R2 or Hosting.

/**
 * `google` is the family name as Google Fonts spells it, or null for a family
 * the app already ships (never demand-loaded).
 *
 * `stack` is what actually goes into `font-family`, always with a real fallback
 * so a failed load degrades to something sane instead of Times New Roman.
 */
export const NAME_FONTS = [
  // Already loaded by index.html — these never trigger a fetch.
  { id: 'default',  name: 'Default',   google: null, stack: "'DM Sans', sans-serif",      weight: 700, level: 3 },
  { id: 'display',  name: 'Display',   google: null, stack: "'Syne', sans-serif",         weight: 800, level: 3 },
  { id: 'mono',     name: 'Mono',      google: null, stack: "'DM Mono', monospace",       weight: 500, level: 3 },

  // Demand-loaded. Chosen to actually look like something a player would want on
  // a gamertag: sci-fi, techwear, arcade, racing, horror, neon.
  { id: 'orbitron', name: 'Orbitron',  google: 'Orbitron:wght@700',       stack: "'Orbitron', sans-serif",     weight: 700, level: 4 },
  { id: 'audiowide',name: 'Audiowide', google: 'Audiowide',               stack: "'Audiowide', sans-serif",    weight: 400, level: 8 },
  { id: 'russo',    name: 'Russo',     google: 'Russo+One',               stack: "'Russo One', sans-serif",    weight: 400, level: 15 },
  { id: 'blackops', name: 'Black Ops', google: 'Black+Ops+One',           stack: "'Black Ops One', system-ui", weight: 400, level: 35 },
  { id: 'chakra',   name: 'Chakra',    google: 'Chakra+Petch:wght@700',   stack: "'Chakra Petch', sans-serif", weight: 700, level: 20 },
  { id: 'michroma', name: 'Michroma',  google: 'Michroma',                stack: "'Michroma', sans-serif",     weight: 400, level: 25 },
  { id: 'bungee',   name: 'Bungee',    google: 'Bungee',                  stack: "'Bungee', system-ui",        weight: 400, level: 40 },
  { id: 'arcade',   name: 'Arcade',    google: 'Press+Start+2P',          stack: "'Press Start 2P', monospace",weight: 400, level: 47 },
  { id: 'terminal', name: 'Terminal',  google: 'VT323',                   stack: "'VT323', monospace",         weight: 400, level: 30 },
  { id: 'neon',     name: 'Neon',      google: 'Monoton',                 stack: "'Monoton', system-ui",       weight: 400, level: 60 },
  { id: 'faster',   name: 'Faster',    google: 'Faster+One',              stack: "'Faster One', system-ui",    weight: 400, level: 67 },
  { id: 'glitch',   name: 'Glitch',    google: 'Rubik+Glitch',            stack: "'Rubik Glitch', system-ui",  weight: 400, level: 83 },
  { id: 'pixel',    name: 'Pixel',     google: 'Silkscreen',              stack: "'Silkscreen', monospace",    weight: 400, level: 54 },
  { id: 'tourney',  name: 'Tourney',   google: 'Tourney:wght@800',        stack: "'Tourney', sans-serif",      weight: 800, level: 75 },
  { id: 'creep',    name: 'Creep',     google: 'Creepster',               stack: "'Creepster', system-ui",     weight: 400, level: 90 },
];

export const NAME_FONT_IDS = NAME_FONTS.map((f) => f.id);
export const fontById = (id) => NAME_FONTS.find((f) => f.id === id) || null;

// One injection per family per page, ever.
const loaded = new Set();

/**
 * Ensure the stylesheet for `id` is in the document. Safe to call on every
 * render: after the first call for a family it is a Set lookup and nothing else.
 */
export function ensureNameFont(id) {
  const f = fontById(id);
  if (!f || !f.google || loaded.has(f.google)) return;
  if (typeof document === 'undefined') return;
  loaded.add(f.google);
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  // display=swap so the name paints immediately in the fallback and swaps when
  // the face arrives. Without it a slow font leaves the name INVISIBLE, which on
  // a chat surface is worse than the wrong font.
  link.href = `https://fonts.googleapis.com/css2?family=${f.google}&display=swap`;
  document.head.appendChild(link);
}
