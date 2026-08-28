// Chat themes. Effect 12. Doc: docs/effects/12-bubble-themes.md
//
// A theme is a PATTERN plus FOUR COLOURS, applied to one conversation and seen
// by BOTH people (founder decision, 2026-08-25, matching Telegram and matching
// the per-chat wallpaper Vergr already stores on the same document).
//
// ⚠ THIS IS NOT THE WALLPAPER SYSTEM AND DOES NOT REPLACE IT.
// `src/utils/Chatbackgrounds.js` and the 7 images in public/backgrounds/static
// are a shipped feature and stay. A theme is a separate, additive choice with
// its own assets, served from R2 at cdn.vergr.app/chat-patterns/.
//
// COST: a theme is an id on the conversation doc, which every chat surface is
// already subscribed to. No new read, no listener, no asset beyond the one
// pattern tile the active theme uses.
// .js extension so the build guards can import this file under node unchanged,
// the same reason rankUnlocks.js carries them.
import { isUnlocked } from './rankUnlocks.js';
// ⚠ `ensureContrast` picks its direction from the background luminance, which
// is why it is used here and `inkFor()` from profileThemes.js is not: that one
// ONLY darkens, and would drive a colour to invisible. See CLAUDE.md.
import { ensureContrast, hexToRgb, luminance } from './color.js';

/** Level that unlocks chat themes. Rival L3 (RANK_TIERS: Rival is 21-30). */
// ⚠ THE FLOOR, NOT THE WHOLE SET. Chat themes are drip-fed one per level
// (CHAT_THEME_LEVELS in rankUnlocks.js); this is the level the FEATURE opens
// at, i.e. the first theme you earn. It was 23 while one row granted all
// eight. Copy shows it as "themes unlock at level N", which stays true.
export const CHAT_THEME_LEVEL = 7;

// ⚠ PALETTES ARE VERGR'S, NOT TELEGRAM'S. Telegram's eight are not in their
// open-source client: the app fetches them from their servers at runtime
// (`ChatThemeController.java`, `account.getChatThemes`), so copying them would
// mean lifting a competitor's brand assets. These are built from the same
// twelve colours the profile accents use, and they respect the no-cyan brand
// rule. See doc 12 §0.5.
//
// Four colours each, because the algorithm interpolates exactly 3 or 4 colour
// points. `day` is used when the app is in light mode, where the sheet the
// icons are punched out of is white rather than black.
export const CHAT_THEMES = [
  {
    id: 'arcade', level: 7, name: 'Arcade', blurb: 'Retro gaming', pattern: 'arcade',
    night: ['#7B1FFF', '#B44FFF', '#2A0B4D', '#C87FFF'],
    day:   ['#B98CFF', '#E0C6FF', '#8C5BE0', '#F1E4FF'],
    // ⚠ accent is #D69AFF, not the brand #C87FFF: that measured 2.84:1 against
    // the outgoing bubble and failed the 3:1 floor for link and timestamp text.
    out: ['#6B1FD6', '#9B3BFF'], in: '#241436', accent: '#D69AFF',
  },
  {
    id: 'dracula', level: 17, name: 'Dracula', blurb: 'Gothic, red and black', pattern: 'dracula',
    night: ['#150207', '#4A0812', '#8C1226', '#C2213A'],
    day:   ['#FFE9EC', '#FFC7CE', '#E88E9C', '#C2213A'],
    out: ['#7A0F20', '#B01A32'], in: '#2A0A11', accent: '#E8536B',
  },
  {
    id: 'gaia', level: 28, name: 'Gaia', blurb: 'Nature', pattern: 'gaia',
    night: ['#0E1A0F', '#24421F', '#5E8C3A', '#C9A227'],
    day:   ['#F2F7E8', '#D8E8C0', '#A8C87E', '#C9A227'],
    out: ['#2E5A22', '#4A7A2E'], in: '#16200F', accent: '#C9A227',
  },
  {
    id: 'chatter', level: 37, name: 'Chatter', blurb: 'Everyday', pattern: 'chatter',
    night: ['#2E0A16', '#8C1436', '#E03A5F', '#F07A3C'],
    day:   ['#FFF1E8', '#FFD4CC', '#FFA9A0', '#F5836A'],
    out: ['#8C1436', '#C22B4E'], in: '#2B1018', accent: '#F07A3C',
  },
  {
    id: 'cosmos', level: 46, name: 'Cosmos', blurb: 'Space', pattern: 'cosmos',
    night: ['#0B0B14', '#241B5C', '#5B3FD6', '#9E7BFF'],
    day:   ['#F6F2FF', '#DCD2FF', '#B9A6F5', '#8E79D8'],
    out: ['#3B2B9E', '#5B3FD6'], in: '#161038', accent: '#9E7BFF',
  },
  {
    id: 'neon', level: 56, name: 'Neon', blurb: 'Synthwave', pattern: 'neon',
    night: ['#12021F', '#3D0B57', '#A11A8C', '#F0479B'],
    day:   ['#FFEAF6', '#FFC6E6', '#F58FC7', '#F0479B'],
    // ⚠ accent lightened from #F0479B (2.81:1 on the outgoing bubble).
    out: ['#7A1470', '#B32A8C'], in: '#240A2E', accent: '#F76FB2',
  },
  {
    id: 'vault', level: 70, name: 'Vault', blurb: 'Prestige, gold', pattern: 'vault',
    night: ['#140D02', '#3D2708', '#8A5A12', '#E3B23C'],
    day:   ['#FFF7E4', '#FFE7B0', '#E8C878', '#C99A2E'],
    // ⚠ out[1] is #9E6817, NOT the #A8701A this palette started with. That
    // measured 4.20:1 against white text and failed the doc-12 floor. Every
    // bubble colour here is asserted by scripts/chat-contrast-check.mjs.
    out: ['#7A4E0F', '#9E6817'], in: '#241A08', accent: '#E3B23C',
  },
  {
    id: 'studio', level: 85, name: 'Studio', blurb: 'Creator', pattern: 'studio',
    night: ['#050B1F', '#0B1436', '#3D7FFF', '#B44FFF'],
    day:   ['#EAF0FF', '#C9D9FF', '#93B0F0', '#6E93E8'],
    out: ['#2B4FB8', '#5B3FD6'], in: '#0E162E', accent: '#7FB0FF',
  },
];

// ── HOW THE LIGHT MOVES ──────────────────────────────────────────────
// ⚠ FIVE OPTIONS BECAUSE ONE MOTION WAS THE PROBLEM. Founder, 2026-08-25:
// "your gradient animations all move in a circle, how creative of you", and
// after the first fix, "they all still move in a circular motion, create a few
// different options to choose from so that they aren't all the same".
//
// The second complaint was correct and the first fix was fake. Telegram rotates
// four colours around a ring, so it literally spins. The replacement used
// Lissajous paths but with frequency RATIOS of 1.32, 0.61, 1.45 and 1.34 — all
// close to 1:1, and a Lissajous at 1:1 with a phase offset IS AN ELLIPSE. It
// swapped a circle for a squashed circle.
//
// These five are structurally different from each other, not re-tuned versions
// of one idea. The maths lives in components/effects/visual/ChatGradient.jsx;
// this is just the list, so the picker and firestore.rules agree on the ids.
export const CHAT_MOTIONS = [
  { id: 'drift',  name: 'Drift',  blurb: 'Slow figure-eights' },
  { id: 'tide',   name: 'Tide',   blurb: 'Sweeps side to side' },
  { id: 'pulse',  name: 'Pulse',  blurb: 'Breathes in and out' },
  { id: 'wander', name: 'Wander', blurb: 'Never repeats' },
  { id: 'orbit',  name: 'Orbit',  blurb: 'Classic rotation' },
];

export const DEFAULT_CHAT_MOTION = 'drift';

/** The motion id in force for a conversation. Falls back, never throws. */
export const chatMotionFor = (conv) => {
  const id = conv?.chatThemeMotion;
  return CHAT_MOTIONS.some((m) => m.id === id) ? id : DEFAULT_CHAT_MOTION;
};

export const chatThemeById = (id) => CHAT_THEMES.find((t) => t.id === id) || null;

/**
 * The theme actually in force for a conversation, or null.
 *
 * ⚠ RESOLVED AT READ TIME, NEVER AT WRITE TIME. The id stays on the
 * conversation document; whether it renders depends on whether the person who
 * SET it still qualifies. So a lapsed Pro subscription stops showing the theme
 * by itself, with no cleanup job and no cron. Same pattern as
 * `typingStyleFor()` (docs/effects/06 §4.1).
 *
 * ⚠ The SETTER's unlock decides, not the viewer's (founder, 2026-08-25). That
 * is the whole point: their theme shows to someone who has not earned it.
 *
 * @param conv    the conversations/{id} doc
 * @param setter  the users/{uid} doc of `conv.chatThemeBy`
 */
export const chatThemeFor = (conv, setter) => {
  const theme = chatThemeById(conv?.chatTheme);
  if (!theme) return null;
  if (!canUseChatThemes(setter)) return null;
  // Custom colours override the preset's, keeping its pattern. The preset is
  // then a starting point rather than a fixed choice, which is how Telegram
  // works too (their picker lets you recolour the bubbles of any theme).
  const custom = chatThemeCustomColors(conv);
  return custom ? { ...theme, night: custom, day: custom, custom: true } : theme;
};

/**
 * The user's own colours for this chat, validated, or null.
 *
 * ⚠ VALIDATED ON THE READ PATH, not merely on write. These are interpolated
 * straight into canvas pixel values, and firestore.rules can check the list
 * SIZE but has no iteration to check each element. Same division of labour as
 * the name gradient (docs/effects/03): rules cap the shape, the reader proves
 * every value.
 */
export const chatThemeCustomColors = (conv) => {
  const raw = conv?.chatThemeColors;
  if (!Array.isArray(raw)) return null;
  const ok = raw.filter((c) => typeof c === 'string' && /^#[0-9a-fA-F]{6}$/.test(c));
  return ok.length >= 3 && ok.length <= 4 ? ok.slice(0, 4) : null;
};

/**
 * The bubble colours for a theme: `{ out: [a, b], in, accent }`.
 *
 * ⚠ THE CONTRAST FLOOR IS APPLIED HERE, NOT TRUSTED TO THE PALETTE. Doc 12 §1
 * finding 2: "a bubble theme may choose hue, radius and border. It may NOT
 * choose an opacity below the floor... a system constraint, not a preset value
 * a user can override." Custom colours come from a free hex picker, so a user
 * can absolutely pick a pale yellow. `ensureContrast` darkens until white text
 * clears 4.5:1, which means an unreadable bubble is not expressible.
 *
 * The presets are already above the floor and `scripts/chat-contrast-check.mjs`
 * asserts it, so for those this is a no-op that costs one comparison.
 */
export const chatBubbleColors = (theme) => {
  if (!theme) return null;
  const floor = (c) => ensureContrast(c, '#FFFFFF', 4.5);

  if (!theme.custom) {
    return { out: theme.out.map(floor), in: floor(theme.in), accent: theme.accent };
  }

  // Custom colours: the user picked the GRADIENT, so the bubbles follow it
  // rather than staying on the preset's, which would read as a bug. Ordered by
  // luminance so the result is deterministic whatever order they were picked in.
  const ranked = [...theme.night].sort((a, b) => luminance(a) - luminance(b));
  const darkest = ranked[0];
  const lightest = ranked[ranked.length - 1];
  const mid = ranked[Math.max(1, Math.floor(ranked.length / 2) - 1)];
  const upper = ranked[Math.min(ranked.length - 1, Math.floor(ranked.length / 2))];

  const out = [floor(mid), floor(upper)];
  return {
    out,
    in: floor(darkest),
    // The accent carries links and timestamps ON a bubble, so it is measured
    // against the bubble, never against the page. 3:1 is the WCAG large-text /
    // non-text floor, which is what a timestamp and a link underline are.
    accent: ensureContrast(lightest, out[0], 3),
  };
};

/**
 * CSS custom properties to hang on a themed bubble.
 *
 * ⚠ THE THEME USED TO STOP AT THE BUBBLE EDGE. Anything rendered INSIDE a
 * bubble kept the global brand violet: `ChatPollBubble` hardcoded
 * `rgba(123,31,255,0.45)` for its result fill, which is the violet bar on a
 * crimson Dracula bubble the founder screenshotted. Content in a themed bubble
 * has to take the theme's accent, or the theme looks half-applied — the same
 * failure that killed the profile-theme system (CLAUDE.md).
 *
 * Custom properties rather than props, because these components are nested
 * several levels down and some self-fetch their own data. Doc 12 §8 specifies
 * exactly this ("`data-bubble-theme` on the message container, with CSS custom
 * properties"). Every consumer keeps its current value as the var fallback, so
 * an unthemed chat renders byte-identically to before.
 *
 * ⚠ THE ALPHA VARIANTS ARE PRE-COMPUTED IN JS, NOT `color-mix()`. color-mix
 * needs Chrome 111 / Safari 16.2, and the Android WebView floor here is lower
 * (minSdk 24). Computing them costs one hex parse and works everywhere.
 */
export const chatBubbleVars = (bubble) => {
  if (!bubble) return null;
  const c = hexToRgb(bubble.accent);
  if (!c) return null;
  const a = (alpha) => `rgba(${c.r}, ${c.g}, ${c.b}, ${alpha})`;
  return {
    '--vg-chat-accent': bubble.accent,
    '--vg-chat-accent-70': a(0.70),
    '--vg-chat-accent-45': a(0.45),
    '--vg-chat-accent-28': a(0.28),
    '--vg-chat-accent-12': a(0.12),
  };
};

/**
 * The inline styles for the two bubble kinds: `{ out, in }`.
 *
 * ⚠ THIS LIVES HERE SO IT CAN BE ASSERTED. Doc 12 §8 requires two checks that
 * were impossible while these objects were built inline inside a 4,300-line
 * component: "no `backdrop-filter` appears in computed styles on any message
 * bubble", and "bubble opacity never computes below the floor". A rule nothing
 * can test is a preference, which is the same reason the contrast floor moved
 * into `chatBubbleColors`. `scripts/chat-contrast-check.mjs` asserts both.
 *
 * ⚠ `backgroundAttachment: 'fixed'` is doc 12 §0.3, the thread-anchored fill:
 * the gradient lays out against the viewport, so each bubble paints the slice
 * it happens to sit over and the colour shifts as you scroll. WebKit treats
 * `fixed` as `scroll`, so on iOS the gradient is per-bubble. Graceful
 * degradation, not a bug.
 *
 * ⚠ NO `backdrop-filter`, ever (doc 12 §1 finding 3). A thread is the worst
 * possible case for it: dozens of blurred surfaces all scrolling at once. The
 * fill is opaque instead, which the contrast floor required anyway.
 *
 * `bubble` null (no theme) returns the original hardcoded look untouched.
 */
export const chatBubbleStyles = (bubble) => {
  const vars = chatBubbleVars(bubble) || {};
  if (!bubble) {
    return {
      out: { background: 'linear-gradient(160deg, #9D4EFF 0%, #6E1FD1 100%)', boxShadow: '0 1px 2px rgba(0,0,0,0.28)' },
      in: { boxShadow: '0 1px 2px rgba(0,0,0,0.22)' },
    };
  }
  return {
    out: {
      backgroundImage: `linear-gradient(160deg, ${bubble.out[0]} 0%, ${bubble.out[1]} 100%)`,
      backgroundAttachment: 'fixed',
      backgroundSize: 'cover',
      boxShadow: '0 1px 2px rgba(0,0,0,0.28)',
      ...vars,
    },
    in: { background: bubble.in, boxShadow: '0 1px 2px rgba(0,0,0,0.22)', ...vars },
  };
};

/** Level OR Pro. Both are real gates; firestore.rules mirrors this. */
export const canUseChatThemes = (profile) => {
  if (!profile) return false;
  if (profile.role === 'admin') return true;
  const level = Number(profile.vpLevel) || 1;
  if (isUnlocked('chat_theme', level)) return true;
  // The plan is a top-level string written by the purchase flows. Reading any
  // of the three historical shapes here would be wrong: `resolveTier` is the
  // canonical reader and it exists because the client used to read three
  // different fields, only one of which matched what is stored.
  return profile.subscription === 'pro' || profile.subscription?.tier === 'pro';
};

/** The four colours for the current app appearance. */
export const chatThemeColors = (theme, isLight) =>
  (isLight ? theme?.day : theme?.night) || theme?.night || [];

/**
 * URL of the pattern tile.
 *
 * ⚠ SERVED FROM R2 (cdn.vergr.app), NOT FIREBASE HOSTING. Founder, 2026-08-25:
 * hosting egress is billed, R2 egress is $0. A tile is ~300KB and one is
 * fetched per themed conversation, so on Hosting a few thousand chat opens
 * would eat the daily transfer allowance on its own. Firebase Hosting is told
 * to skip the directory entirely (`ignore` in firebase.json).
 *
 * Upload with: node scripts/publish-chat-patterns.mjs
 *
 * ⚠ CROSS-ORIGIN IS FINE HERE. This is a CSS mask-image, and CSS never exposes
 * pixels to script, so no CORS header is required (unlike the canvas readback
 * the ambilight used to do). The native CSP already allows it: img-src carries
 * a bare `https:`.
 */
export const chatPatternUrl = (theme) =>
  (theme?.pattern ? `https://cdn.vergr.app/chat-patterns/${theme.pattern}.png` : null);
