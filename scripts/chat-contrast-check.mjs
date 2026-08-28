// Asserts every chat theme's BUBBLE colours are legible, and that the pattern
// assets a theme names actually exist.
//
// Why this is a build guard and not a code review: doc 12 §1 finding 2 is that
// the contrast floor "is a system constraint, not a preset value a user can
// override". A constraint nothing checks is a preference. This is the check.
//
// ⚠ IT ALSO GUARDS THE 7 WALLPAPERS. Chat themes are ADDITIVE — founder,
// 2026-08-25: "i dont want you messing with the existing backgrounds since
// users will still need them". public/backgrounds/static is a shipped feature
// and a theme must never cost one of those files.
//
//   node scripts/chat-contrast-check.mjs          run the assertions
//   node scripts/chat-contrast-check.mjs --list   print every one
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CHAT_THEMES, CHAT_MOTIONS, DEFAULT_CHAT_MOTION, chatMotionFor,
  chatBubbleColors, chatBubbleStyles,
} from '../src/utils/chatThemes.js';
import { contrastRatio } from '../src/utils/color.js';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const LIST = process.argv.includes('--list');

// WCAG 2.1: 4.5:1 for normal text. Message text is normal text.
const FLOOR = 4.5;
const HEX = /^#[0-9a-fA-F]{6}$/;

// The wallpapers this feature must never touch.
const WALLPAPERS = ['bg_1', 'bg_2', 'bg_3', 'bg_4', 'bg_5', 'bg_6', 'bg_7'];

let n = 0;
const fails = [];
const ok = (label, cond) => {
  n++;
  if (LIST) console.log(`  ${cond ? 'ok  ' : 'FAIL'}  ${label}`);
  if (!cond) fails.push(label);
};

for (const t of CHAT_THEMES) {
  const p = `theme ${t.id}`;

  // Identity and assets
  ok(`${p}: has a name`, typeof t.name === 'string' && t.name.length > 0);
  ok(`${p}: pattern tile exists`, existsSync(`${repo}/chat-pattern-tiles/${t.pattern}.png`));

  // Gradients: 4 points, all valid hex, for both appearances.
  for (const mode of ['night', 'day']) {
    const c = t[mode];
    ok(`${p}: ${mode} has 4 colours`, Array.isArray(c) && c.length === 4);
    ok(`${p}: ${mode} all valid hex`, Array.isArray(c) && c.every((x) => HEX.test(x)));
  }

  // ── THE FLOOR ───────────────────────────────────────────────────
  // White text sits on both bubble kinds. Every stop of the outgoing gradient
  // counts, not just its ends, because the thread-anchored fill (doc 12 §0.3)
  // means a bubble can land on ANY slice of it depending on scroll position.
  for (const [i, c] of t.out.entries()) {
    ok(`${p}: outgoing stop ${i} valid hex`, HEX.test(c));
    const r = contrastRatio(c, '#FFFFFF');
    ok(`${p}: outgoing stop ${i} contrast ${r.toFixed(2)} >= ${FLOOR}`, r >= FLOOR);
  }
  ok(`${p}: incoming valid hex`, HEX.test(t.in));
  const ri = contrastRatio(t.in, '#FFFFFF');
  ok(`${p}: incoming contrast ${ri.toFixed(2)} >= ${FLOOR}`, ri >= FLOOR);

  // The accent carries links and timestamps ON a bubble, so it is measured
  // against the bubble it sits on, never against the page.
  ok(`${p}: accent valid hex`, HEX.test(t.accent));
  const ra = Math.min(contrastRatio(t.accent, t.in), contrastRatio(t.accent, t.out[0]));
  ok(`${p}: accent contrast ${ra.toFixed(2)} >= 3 on both bubbles`, ra >= 3);
}

// Theme ids must be unique, or chatThemeById silently resolves the wrong one.
const ids = CHAT_THEMES.map((t) => t.id);
ok(`theme ids unique`, new Set(ids).size === ids.length);

// ⚠ The wallpapers are NOT part of this feature and must survive it.
for (const w of WALLPAPERS) {
  ok(`wallpaper ${w}.png untouched`, existsSync(`${repo}/public/backgrounds/static/${w}.png`));
}

// The rules enum must know every theme, or the picker offers what the server
// refuses. Same class of bug as the nameFont enum (CLAUDE.md).
const rules = readFileSync(`${repo}/firestore.rules`, 'utf8');
for (const id of ids) {
  ok(`firestore.rules accepts '${id}'`, rules.includes(`'${id}'`));
}

// ── DOC 12 §8: the two rules that were enforced but never asserted ──
// "Assert no backdrop-filter appears in computed styles on any message bubble"
// and "assert bubble opacity never computes below the floor". Both were true in
// the code and untested, which this session showed twice is how things drift.
// ⚠ ChatThreadScreen is deliberately NOT in this list, and that is not a gap.
// Doc 12 §1 finding 3 bans blur ON MESSAGE BUBBLES and explicitly allows it
// elsewhere ("reserve blur for single large surfaces such as a header"). That
// file legitimately uses `backdrop-blur-sm` on video overlay buttons, scrub
// pills, date separators and reply chips. A whole-file scan flagged all of them
// and would have pushed someone to strip working UI to appease the guard. The
// bubble itself is covered precisely by the style-object assertions below.
//
// These two ARE whole-file scannable: chatThemes.js builds the bubble styles
// and nothing else, and ChatPollBubble renders only inside a bubble, so blur
// there would be exactly the per-bubble case the doc rules out.
const BUBBLE_FILES = [
  'src/components/messages/ChatPollBubble.jsx',
  'src/utils/chatThemes.js',
];
for (const f of BUBBLE_FILES) {
  const src = readFileSync(`${repo}/${f}`, 'utf8');
  // ⚠ A thread is the worst case for this: dozens of blurred surfaces all
  // scrolling at once. Doc 12 §1 finding 3 bans it outright here.
  //
  // ⚠ MATCH USAGE, NOT THE WORD. The first version matched the bare name and
  // failed on these files' own COMMENTS explaining why the property is banned.
  // A guard that flags its own documentation gets deleted, not obeyed. So:
  // the CSS property with its colon, the JSX style key, or a Tailwind class.
  const used = /backdrop-filter\s*:/.test(src)
    || /backdropFilter\s*:/.test(src)
    || /\bbackdrop-blur\b/.test(src);
  ok(`${f}: no backdrop-filter in use`, !used);
}

for (const t of CHAT_THEMES) {
  const styles = chatBubbleStyles(chatBubbleColors(t));
  for (const kind of ['out', 'in']) {
    const st = styles[kind];
    ok(`theme ${t.id}: ${kind} bubble sets no backdropFilter`,
      !Object.keys(st).some((k) => /backdrop/i.test(k)));
    // An explicit opacity below 1 would put the pattern straight through the
    // text, which is exactly what the floor exists to stop.
    ok(`theme ${t.id}: ${kind} bubble sets no opacity < 1`,
      st.opacity === undefined || Number(st.opacity) >= 1);
    // ...and no translucent fill sneaking in via an rgba/hsla background.
    const fill = `${st.background || ''} ${st.backgroundImage || ''}`;
    const alphas = [...fill.matchAll(/rgba?\([^)]*?,\s*([0-9.]+)\s*\)/g)].map((m) => Number(m[1]));
    ok(`theme ${t.id}: ${kind} bubble fill is opaque`, alphas.every((a) => a >= 1));
    // The accent must reach INSIDE the bubble, or content keeps the global
    // brand violet and the theme looks half-applied.
    ok(`theme ${t.id}: ${kind} bubble carries --vg-chat-accent`,
      typeof st['--vg-chat-accent'] === 'string' && HEX.test(st['--vg-chat-accent']));
  }
}

// An unthemed chat must render exactly as it did before this feature existed.
const plain = chatBubbleStyles(null);
ok('no theme: outgoing keeps the original violet', /#9D4EFF/.test(plain.out.background || ''));
ok('no theme: incoming adds no background', plain.in.background === undefined);
ok('no theme: no stray custom properties', !Object.keys(plain.out).some((k) => k.startsWith('--')));

// Motion ids must be mirrored in firestore.rules, same reason as theme ids.
for (const mo of CHAT_MOTIONS) {
  ok(`firestore.rules accepts motion '${mo.id}'`, rules.includes(`'${mo.id}'`));
  ok(`motion '${mo.id}' has a name`, typeof mo.name === 'string' && mo.name.length > 0);
}
ok('default motion is a real motion', CHAT_MOTIONS.some((m) => m.id === DEFAULT_CHAT_MOTION));
ok('chatMotionFor falls back on junk', chatMotionFor({ chatThemeMotion: 'nope' }) === DEFAULT_CHAT_MOTION);
ok('chatMotionFor handles a missing conv', chatMotionFor(null) === DEFAULT_CHAT_MOTION);

// Every game-icons artist whose work ships must be credited somewhere public.
// CC BY 3.0 is an attribution licence; an uncredited icon is a licence breach.
const manifest = JSON.parse(
  readFileSync(`${repo}/scripts/chat-pattern-icons/manifest.json`, 'utf8'),
);
const artists = new Set();
for (const t of Object.values(manifest)) {
  for (const i of t.icons) if (i.author) artists.add(i.author);
}
// The credits page lives with the other marketing screens, per repo convention.
const creditsPath = `${repo}/src/screens/marketing/PublicMarketingScreens.jsx`;
const credits = existsSync(creditsPath) ? readFileSync(creditsPath, 'utf8').toLowerCase() : '';
ok('credits page exists', credits.length > 0);
for (const a of artists) {
  // manifest slugs are kebab-case ('caro-asercion'); the page prints them as
  // display names ('Caro Asercion'), so compare on the words.
  const words = a.split('-');
  ok(`credits name '${a}'`, words.every((w) => credits.includes(w)));
}

console.log(`chat-contrast-check: ${n} assertions, ${fails.length} failed`);
if (fails.length) {
  for (const f of fails) console.error(`  FAIL  ${f}`);
  process.exit(1);
}
