// ═══════════════════════════════════════════════════════════════════
// RANK UNLOCKS: what every level actually gives you
// ═══════════════════════════════════════════════════════════════════
//
// The defect this fixes: before this table, levels 2 to 40 gave literally
// nothing. You earned VP, a number went up, and no part of the product
// changed. That is not a ladder, it is a progress bar.
//
// ── TWO RULES THIS FILE EXISTS TO ENFORCE ──
//
// 1. ZERO RUNTIME COST. Everything here is derived from `vpLevel`, which
//    `functions/vpLevel.js` already denormalises onto the user doc, and which
//    the chat relay already stamps on every message from the profile it loads
//    ONCE per connection. So resolving somebody's unlocks costs no Firestore
//    read, no callable, no trigger. If you ever find yourself adding a lookup
//    to answer "what has this user unlocked", you have taken a wrong turn:
//    the answer is a pure function of a number you already have.
//
// 2. RANK NEVER TOUCHES THE AVATAR RING. Founder ruling: the avatar ring
//    belongs to live and status. A rank ring appears in exactly two places,
//    the live-stream entrance banner and live chat, and nowhere else. So there
//    are deliberately NO avatar-frame unlocks in this table, and the profile
//    cosmetics below (accent, theme) colour the PAGE, never the ring.
//
// Adding a reward later should be a row here, not a code change anywhere else.

// Where an unlock shows up. Used by the UI to group and to explain.
import { RANK_TIERS, levelCost } from './vpSystem.js';
// .js extension so the node preview harnesses can import this file unchanged.
import { isHexColor, ensureContrast } from './color.js';
import { NAME_FONTS, NAME_FONT_IDS, fontById, ensureNameFont } from './nameFonts.js';
import { VP_BONUS_PACKS, bonusPackById, formatDuration } from './vpBonuses.js';

export const UNLOCK_SURFACE = {
  chat:    { label: 'Live chat',        icon: 'forum' },
  entry:   { label: 'Stream entry',     icon: 'sensor_door' },
  profile: { label: 'Profile',          icon: 'account_circle' },
  social:  { label: 'Posts & comments', icon: 'chat_bubble' },
  utility: { label: 'Perks',            icon: 'bolt' },
};

// ── The witness ladder ──────────────────────────────────────────────
// What the ROOM sees when you walk in. This is the headline reward: the only
// one a stranger can observe, which is what makes the ladder legible to
// somebody who has never opened the levels page.
// EVERY TIER BELOW IS ENFORCED TODAY. An earlier draft also claimed a
// "tinted entry line" at L11 and a "full banner" at L51; neither is rendered by
// JoinAnnouncer, which draws one ribbon for anyone who earns a card. Promising
// a visual the component does not draw is the same defect this table exists to
// fix, so those two rows were cut. They belong with the entrance-banner ART
// work (docs/ENTRY_BANNER_ART_SPEC.md), where the ribbon gets its visual tiers.
//
// Enforced in: functions/streamJoins.js (who earns a card at all) and
// src/components/streams/JoinAnnouncer.jsx (sweep at 71, shimmer + sound at 91).
export const ENTRY_TIERS = [
  { min: 1,  id: 'followers', label: 'Followers see you arrive',
    desc: 'People who follow you get your entry ribbon. Strangers in the room do not.' },
  { min: 31, id: 'ribbon',    label: 'Everyone sees you arrive',
    desc: 'Your ribbon shows to the whole room, including people who have never met you.' },
  { min: 71, id: 'sweep',     label: 'Ribbon + light sweep',
    desc: 'Light travels the ribbon edge as it lands.' },
  { min: 91, id: 'shimmer',   label: 'Ribbon + shimmer + sound',
    desc: 'The ribbon shimmers and the room hears you arrive.' },
];

export const entryTier = (level = 1) => {
  let t = ENTRY_TIERS[0];
  for (const e of ENTRY_TIERS) if (level >= e.min) t = e;
  return t;
};

// ── Chat name colours ───────────────────────────────────────────────
// Derived, not stored. The relay already puts `vpLevel` on every message, so
// colouring a name in live chat is a local lookup on a number that arrived
// with the message. No read, no join, no lookup table in Firestore.
export const CHAT_NAME_COLORS = [
  { min: 1,   color: '#C9CDD4' },
  { min: 3,   color: '#9EE6C8' },
  { min: 11,  color: '#CD7F32' },
  { min: 21,  color: '#C0C0C0' },
  { min: 31,  color: '#F5C542' },
  { min: 41,  color: '#4DFFD4' },
  { min: 51,  color: '#9B8CFF' },
  { min: 61,  color: '#B0B6C0' },
  { min: 71,  color: '#FF4D7E' },
  { min: 81,  color: '#C87FFF' },
  { min: 91,  color: '#FFB347' },
  { min: 100, color: '#FFFFFF' },
];

export const chatNameColor = (level = 0) => {
  if (!level || level < 3) return null;   // below L3 you get the default colour
  let c = CHAT_NAME_COLORS[0].color;
  for (const e of CHAT_NAME_COLORS) if (level >= e.min) c = e.color;
  return c;
};

// ── Cosmetic pools ──────────────────────────────────────────────────
// These carry levels 1-20, which is where the entire user base actually sits.
// They are cheap to build and cheap to run, and they are what stops the early
// ladder feeling empty. They are NOT the headline at high rank: by L50 the
// headline has to be something a room can see.

export const PROFILE_ACCENTS = [
  { id: 'violet',   name: 'Violet',   color: '#7B1FFF', level: 2 },
  { id: 'pink',     name: 'Orchid',   color: '#C87FFF', level: 6 },
  { id: 'ember',    name: 'Ember',    color: '#F04060', level: 12 },
  { id: 'gold',     name: 'Gold',     color: '#F0A500', level: 18 },
  { id: 'mint',     name: 'Mint',     color: '#4DFFD4', level: 24 },
  { id: 'azure',    name: 'Azure',    color: '#3D7FFF', level: 33 },
  { id: 'rose',     name: 'Rose',     color: '#FF7AB8', level: 44 },
  { id: 'onyx',     name: 'Onyx',     color: '#8A8F98', level: 57 },
  { id: 'ruby',     name: 'Ruby',     color: '#E0115F', level: 68 },
  { id: 'aurora',   name: 'Aurora',   color: '#FFB347', level: 79 },
  { id: 'mythic',   name: 'Mythic',   color: '#B44FFF', level: 88 },
  { id: 'immortal', name: 'Immortal', color: '#FFFFFF', level: 100 },
];

// ── EFFECTS REGISTRY ────────────────────────────────────────────────
//
// THE ONLY PLACE that maps a level to an effect. Effect files under
// `src/components/effects/` own how a thing LOOKS and know nothing about
// levels; this table owns WHEN you get it. See effects/README.md for why the
// split exists (short version: the theme system had two files both claiming to
// define a theme, so the preview and the profile disagreed and neither file
// showed it).
//
// `defaultOn` is what happens the moment it unlocks. Every effect here is on by
// default and the user may switch it off.
//
// ⚠ TURNING AN EFFECT OFF NEEDS NO SECURITY RULE, and that is deliberate.
// `users/{uid}.cosmetics.fx` stores OPT-OUTS only: `{ ambilight: false }` means
// "I turned this off". Writing `true` for something you have not unlocked buys
// nothing, because `isEffectOn()` below ANDs the opt-out against `vpLevel`,
// which is server-written and server-only. A visitor's client evaluates the
// PROFILE OWNER's vpLevel, so an effect cannot be faked to anybody else.
export const EFFECTS = [
  {
    id: 'orbit',
    name: 'Avatar orbit',
    desc: 'A light in your accent colour travels the edge of your avatar.',
    level: 6,
    surface: 'profile',
    defaultOn: true,
  },
  {
    id: 'ambiance',
    name: 'Profile music',
    desc: 'A track that plays for visitors, with the artist credited.',
    level: 81,
    surface: 'profile',
    // ⚠ defaultOn FALSE, unlike every other effect here. The others are
    // visual and cost a visitor nothing; this one makes NOISE at them. An
    // audio loop that switches itself on the moment you reach L81 would play
    // at every visitor before the owner even knew they had it.
    defaultOn: false,
  },
  {
    id: 'ambilight',
    name: 'Ambilight',
    desc: 'Your banner and videos throw their own colour into the page behind them.',
    level: 21,
    surface: 'profile',
    defaultOn: true,
  },
];

/** Effect row by id, or null. */
export const effectById = (id) => EFFECTS.find((e) => e.id === id) || null;

/**
 * Is `id` active for this user?
 *
 * @param {string} id       effect id
 * @param {object} profile  the users/{uid} doc — the OWNER's, not the viewer's
 * @returns {boolean}
 */
export const isEffectOn = (id, profile) => {
  const fx = effectById(id);
  if (!fx) return false;
  // Admin sees everything, so cosmetics can be judged without levelling an
  // account to 100. Mirrors the same allowance in firestore.rules.
  const level = profile?.role === 'admin' ? 100 : (Number(profile?.vpLevel) || 1);
  if (level < fx.level) return false;
  const opt = profile?.cosmetics?.fx?.[id];
  return opt === undefined ? fx.defaultOn : opt !== false;
};

// ── TYPING INDICATOR STYLES ─────────────────────────────────────────
// Doc: docs/effects/06-typing-indicator.md. The LOOK of each one lives in
// src/components/effects/triggers/TypingStyles.{jsx,css} and nowhere else.
//
// ONE unlock opens the whole set, exactly like `name_font` (L3) opening all 18
// faces, rather than one style bolted to each level. `dots` is level 1 because
// it is what everybody already has: it is the default, not a reward.
//
// TYPING_STYLE_LEVEL is the single number. Changing it here changes the ladder
// row, the picker and (via scripts/vp-mirror-check.mjs) what firestore.rules is
// required to say.
export const TYPING_STYLE_LEVEL = 32;   // Challenger L2 (RANK_TIERS: 31-40)

// ── The animated crest. Effect 21, docs/effects/21-animated-crest.md ──
//
// The crest already exists from L1 and upgrades at every rank band. At L62 it
// gains an intermittent specular sweep: a narrow bright band crossing the crest,
// clipped to the crest's own silhouette.
//
// ⚠ THE DUTY CYCLE IS THE DESIGN, NOT A TUNING KNOB. The sweep is 900ms of a
// 5.6s cycle, so 84% of the time NOTHING MOVES. That is the answer to "what
// happens when several people in one chat have it" — with a per-uid phase
// offset, two crests almost never sweep together, and when they do it is for a
// fraction of a second. A continuous animation on every high-rank row is how
// chat becomes noise, which is why RankBadge exists instead of an avatar ring.
//
// ⚠ Twitch does not allow animated chat badges AT ALL (PNG only, 25 KB, no
// animation). That is not a reason to refuse, but it IS the bar: this has to be
// restrained enough that a chat reader would not call it noise. See doc §3.
// ── Chat theme unlock levels ────────────────────────────────────────
//
// ⚠ THE LEVELS LIVE HERE, THE LOOK LIVES IN chatThemes.js, and the direction of
// that dependency is deliberate: `chatThemes.js` already imports `isUnlocked`
// from this file, so importing CHAT_THEMES back the other way would be a
// circular import. This is the id + level half only.
//
// `scripts/vp-mirror-check.mjs` asserts these ids match CHAT_THEMES exactly, so
// a theme added in one file and not the other fails the build rather than
// silently becoming unreachable (or unlockable at level undefined).
export const CHAT_THEME_LEVELS = [
  { id: 'arcade',  name: 'Arcade',  level: 7 },
  { id: 'dracula', name: 'Dracula', level: 17 },
  { id: 'gaia',    name: 'Gaia',    level: 28 },
  { id: 'chatter', name: 'Chatter', level: 37 },
  { id: 'cosmos',  name: 'Cosmos',  level: 46 },
  { id: 'neon',    name: 'Neon',    level: 56 },
  { id: 'vault',   name: 'Vault',   level: 70 },
  { id: 'studio',  name: 'Studio',  level: 85 },
];

/** The level a single chat theme unlocks at. Unknown id = the old flat gate. */
export const chatThemeLevel = (id) =>
  CHAT_THEME_LEVELS.find((t) => t.id === id)?.level ?? CHAT_THEME_LEVEL_BASE;

/** The first theme anyone earns — what "chat themes" as a feature unlocks at. */
export const CHAT_THEME_LEVEL_BASE = 7;

export const ANIMATED_CREST_LEVEL = 62;   // Veteran L2 (RANK_TIERS: 61-70)
/** One sweep, in ms. Mirrored in surface.css `--vg-crest-sweep`. */
export const CREST_SWEEP_MS = 900;
/** Full cycle, in ms. Mirrored in surface.css `--vg-crest-cycle`. */
export const CREST_CYCLE_MS = 5600;

/**
 * Per-user phase offset for the sweep, as a NEGATIVE animation-delay.
 *
 * ⚠ NEGATIVE ON PURPOSE. A positive delay means every crest sits dark until its
 * first turn comes round, so a chat that just opened shows nothing for seconds.
 * A negative delay starts the animation already part-way through, so the phases
 * are spread from the first painted frame.
 *
 * Deterministic from the uid, so the same person keeps the same phase across
 * reloads and across every viewer's screen.
 */
export const crestPhaseMs = (uid) => {
  const s = String(uid || '');
  let h = 0;
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return -(Math.abs(h) % CREST_CYCLE_MS);
};

export const TYPING_STYLES = [
  { id: 'dots',  name: 'Dots',    desc: 'The default three dots.',            level: 1 },
  { id: 'wave',  name: 'Wave',    desc: 'The dots rise and fall in turn.',    level: 9 },
  { id: 'bars',  name: 'Levels',  desc: 'Three bars, like a voice meter.',    level: 23 },
  { id: 'orbit', name: 'Orbit',   desc: 'A light circles a small track.',     level: 32 },
  { id: 'pixel', name: 'Pixel',   desc: 'Hard blinking squares, no easing.',  level: 49 },
  { id: 'comet', name: 'Comet',   desc: 'A light sweeps across a track.',     level: 64 },
];
export const TYPING_STYLE_IDS = TYPING_STYLES.map(s => s.id);

export const PROFILE_THEMES = [
  { id: 'default', name: 'Standard', level: 1 },
  { id: 'deep',    name: 'Deep',     level: 6 },
  { id: 'grain',   name: 'Grain',    level: 16 },
  { id: 'beam',    name: 'Beam',     level: 27 },
  { id: 'carved',  name: 'Carved',   level: 38 },
  { id: 'aurora',  name: 'Aurora',   level: 52 },
  { id: 'eclipse', name: 'Eclipse',  level: 66 },
  { id: 'nebula',  name: 'Nebula',   level: 84 },
];


// ── The ladder ──────────────────────────────────────────────────────
// One row per unlock. `level` is where it lands. Every level 1-100 has at
// least one row (asserted by `assertNoDeadLevels` below, which the levels
// screen calls in dev).
//
// kind:    machine name, also the Firestore field when equippable
// surface: which UNLOCK_SURFACE it shows on
// equip:   true if the user chooses to turn it on (writes their OWN doc, one
//          write, user-initiated). false = automatic, nothing to store.

// ── The VP earn bonus ───────────────────────────────────────────────
// +0.5% per level, so L100 earns 1.495x base. MIRRORED in
// functions/walletActions.js and functions/engagementVp.js. If you change the
// number here, change it in both, or the screen will promise a rate the server
// does not pay.
export const VP_BONUS_PER_LEVEL = 0.005;
export const VP_BONUS_MAX = 1.5;

export const rankVpBonus = (level = 1) =>
  Math.min(VP_BONUS_MAX, 1 + (Math.max(1, level) - 1) * VP_BONUS_PER_LEVEL);

const row = (level, id, kind, name, surface, desc, extra = {}) =>
  ({ level, id, kind, name, surface, desc, equip: false, ...extra });

// Utility rewards that repeat.
//
// ⚠ THE BOOST TOKEN IS THE LADDER'S GAP FILLER. Founder, 2026-08-27:
// "I have already told you how boosts will work in the VP ladder, we are using
// them to fill empty gaps." So every level that would otherwise give nothing but
// the +0.5% earn rate now grants a token, and the ladder has NO hollow levels.
//
// History, so nobody "tidies" this back: it was [5,14,26,41,50,76,93] (7, with
// TWO in Elite and none in Challenger/Champion/Veteran/Mythic), then 11 for one
// per rank band, now 37 to close the last 26 gaps. The worst of those was
// L94-99: six consecutive levels and ~66,000 VP immediately before L100, the
// longest dry stretch on the ladder at the point a player is most invested.
//
// ⚠ EVERY ENTRY HERE IS AN ECONOMY CHANGE and therefore a FOUNDER decision,
// never a session one. Do not add, remove or re-space a level to make a guard
// pass. MIRRORED in functions/vpLevel.js, which is what actually grants them;
// vp-mirror-check.mjs fails the build if the two drift.
//
// ⚠ A token always redeems at the BASE tier (TOKEN_TIER_ID in
// src/utils/streamBoost.js), because the wallet holds one flat `boostTokens`
// count with no tier on it. Granting a Super/Mega token at high levels would be
// a schema change, not a constant change.
const BOOST_TOKEN_LEVELS = [
  5, 14, 22, 26, 34, 36, 41, 43, 50, 53,
  58, 65, 74, 76, 78, 80, 82, 86, 89, 93,
  95, 97, 99,
];

// ⚠ VP BONUS PACKS ON THE LADDER. Founder, 2026-08-28: the packs are bought with
// COINS ONLY, but they are ALSO earned here.
//
// These 14 levels used to hand out a boost token and were taken over by a pack,
// which is what fixed the real complaint about the filled ladder: L93-99 was
// SEVEN identical 'Stream Boost token' rows in a row, with shorter runs at
// 41-43, 58-59 and 76-78. Every one of those runs is now broken, and no two
// consecutive levels grant the same thing anywhere on the ladder.
//
// The pack scales with the band, because a level in Ascendant costs 11,000 VP
// and a level in Rookie costs 2,000: Happy Hour early, Long Surge at the top.
//
// ⚠ ECONOMY. Founder decision. The levels here and the packs in vpBonuses.js are
// both mirrored in functions/vpLevel.js, which is what actually grants them.
const BONUS_LADDER_LEVELS = {
  10: 'happy_hour',
  19: 'happy_hour',
  29: 'flash',
  39: 'flash',
  42: 'half_day',
  48: 'creator',
  55: 'community',
  59: 'day',
  69: 'watcher',
  77: 'weekend',
  87: 'day',
  94: 'weekend',
  96: 'long',
  98: 'day',
};

export const bonusPackForLevel = (level) => BONUS_LADDER_LEVELS[level] || null;

// ⚠ HOW MANY tokens a level grants, and why it is not always one.
//
// A level in Ascendant costs 11,000 VP. A level in Rookie costs 2,000. Granting
// a single token at each meant the SAME reward cost 5.5x more at the top of the
// ladder, which is the real defect behind L93-99 reading as seven identical
// filler rows: the reward never scaled with what it cost to reach.
//
// The count is DERIVED from the level's own VP cost rather than hand-assigned,
// so it tracks rank by construction (cost brackets and rank bands are both 10
// levels wide) and cannot drift out of step with a cost change:
//
//     tokens = max(1, round(levelCost(level) / 4000))
//
//   Rookie..Challenger 1  ·  Elite..Legend 2  ·  Mythic + Ascendant 3
//   37 qualifying levels, 75 tokens across a full 648,000 VP run to L100.
//
// ⚠ THIS IS THE ECONOMY. Both this divisor and BOOST_TOKEN_LEVELS are FOUNDER
// decisions, never session ones. MIRRORED in functions/vpLevel.js, which is what
// actually grants them; vp-mirror-check.mjs expands all 100 levels on both sides
// and fails the build if a single count disagrees.
export const BOOST_TOKEN_VP_PER_TOKEN = 4000;

export const boostTokensForLevel = (level) =>
  (BOOST_TOKEN_LEVELS.includes(level)
    ? Math.max(1, Math.round(levelCost(level) / BOOST_TOKEN_VP_PER_TOKEN))
    : 0);

const buildLadder = () => {
  const out = [];

  out.push(row(1, 'crest_rookie', 'crest', 'Rookie crest', 'chat',
    'Your crest appears beside your name in live chat.'));

  // A crest upgrade at every rank-band start. This is the answer to the
  // founder's question about crest vs badge: they are ONE thing. The crest is
  // the rank mark, it changes when the band changes, and it renders in live
  // chat and the entrance banner only. There is no second 'badge' artefact.
  for (const t of RANK_TIERS) {
    if (t.min === 1) continue;
    out.push(row(t.min, 'crest_' + t.name.toLowerCase(), 'crest', t.name + ' crest', 'chat',
      'Your crest becomes ' + t.name + ', in ' + t.ringColor + '.', { color: t.ringColor }));
  }

  // Effect 21. The crest itself does not change — it catches the light.
  out.push(row(ANIMATED_CREST_LEVEL, 'animated_crest', 'crest', 'Living crest', 'chat',
    'Light sweeps across your crest in live chat, every few seconds.'));

  for (const a of PROFILE_ACCENTS) {
    out.push(row(a.level, 'accent_' + a.id, 'accent', a.name + ' accent', 'profile',
      'Colours your profile header and highlights. Never your avatar ring.',
      { equip: true, color: a.color }));
  }
  for (const t of PROFILE_THEMES) {
    if (t.level === 1) continue;
    out.push(row(t.level, 'theme_' + t.id, 'theme', t.name + ' profile theme', 'profile',
      'A different surface treatment for your profile page.', { equip: true }));
  }
  for (const l of BOOST_TOKEN_LEVELS) {
    const n = boostTokensForLevel(l);
    out.push(row(l, 'boost_' + l, 'boost',
      n === 1 ? 'Stream Boost token' : `${n} Stream Boost tokens`, 'utility',
      n === 1
        ? 'A free Stream Boost. Spend it on your own stream or on anyone else’s.'
        : `${n} free Stream Boosts. Spend them on your own stream or on anyone else’s.`,
      { tokens: n }));
  }

  // VP bonus packs. A pack is a TIMED multiplier, so the row says how long it
  // runs — a reward with no stated duration reads as permanent.
  for (const [lvl, packId] of Object.entries(BONUS_LADDER_LEVELS)) {
    const pack = bonusPackById(packId);
    if (!pack) continue;   // a typo here must not silently drop a level's reward
    out.push(row(Number(lvl), 'bonus_' + packId + '_' + lvl, 'vp_bonus',
      pack.name, 'utility',
      `${pack.mult}x VP for ${formatDuration(pack.hours)}. Yours to start whenever you want.`,
      { packId }));
  }

  // Witness ladder, mirrored from ENTRY_TIERS so the two can never disagree.
  for (const e of ENTRY_TIERS) {
    if (e.min === 1) continue;   // L1 is the baseline, not an unlock
    out.push(row(e.min, 'entry_' + e.id, 'entry', e.label, 'entry', e.desc));
  }

  // ⚠ These two were chat-only until 2026-08-24, which is why their old names
  // said "in chat". They now render through <UserName>, so they apply on every
  // surface a name appears on (founder-approved). The copy was corrected to
  // match; do NOT narrow it back without changing the code too, or the levels
  // screen promises something different from what ships.
  out.push(row(3, 'chatcolor', 'chatcolor', 'Coloured name', 'chat',
    'Your name is tinted to your rank colour everywhere it appears.'));
  // ── DRIP-FED POOLS ────────────────────────────────────────────────────
  //
  // ⚠⚠ THESE USED TO BE THREE ROWS HANDING OVER THIRTY-TWO THINGS AT ONCE:
  // 18 typefaces at L3, 8 chat themes at L23, 6 typing styles at L32. That
  // single decision is most of the reason 56 of 100 levels gave nothing but the
  // +0.5% rate bump — the content to fill them was already BUILT and SHIPPED,
  // it was just all granted in one go.
  //
  // PROFILE_ACCENTS and PROFILE_THEMES below were drip-fed one per level from
  // the very first version, so the pattern existed the whole time and was
  // applied inconsistently. This makes the three pools match them.
  //
  // ⚠ THE LEVEL LIVES ON THE ITEM, never here. `nameFonts.js`, `chatThemes.js`
  // and TYPING_STYLES each carry their own `level`, so adding a font is a
  // one-line change in one file and the ladder follows automatically.
  for (const f of NAME_FONTS) {
    // The three bundled faces share L3: they trigger no download, so there is
    // nothing to earn by staggering them, and one row covers all three.
    if (f.level <= 3) continue;
    out.push(row(f.level, 'font_' + f.id, 'name_font', f.name + ' typeface', 'social',
      'Render your name in ' + f.name + '.', { equip: true }));
  }
  out.push(row(3, 'name_font', 'name_font', 'Choose your typeface', 'social',
    'Render your name in the display or mono face instead of the default.', { equip: true }));
  out.push(row(12, 'name_color', 'name_color', 'Choose your name colour', 'social',
    'Pick any colour for your name, instead of the one your rank gives you.', { equip: true }));

  // Chat themes, one per level. ⚠ THE WHOLE SET IS ALSO GRANTED BY PRO, and
  // that second gate lives in canUseChatThemes() because it is a plan check,
  // not a level check. firestore.rules mirrors both.
  for (const t of CHAT_THEME_LEVELS) {
    out.push(row(t.level, 'chattheme_' + t.id, 'chat_theme', t.name + ' chat theme', 'social',
      'An animated background for a chat. Both of you see it.', { equip: true }));
  }

  // The typing indicator other people watch while you write to them.
  // `dots` is the default everyone already has, so it is not a row.
  for (const t of TYPING_STYLES) {
    if (t.level <= 1) continue;
    out.push(row(t.level, 'typing_' + t.id, 'typing_style', t.name + ' typing indicator', 'social',
      t.desc, { equip: true }));
  }

  // Social + profile utility.
  out.push(row(63, 'name_effect',   'name_effect',   'Animated name',  'chat',
    'Your name carries a slow gradient sweep everywhere it appears.', { equip: true }));
  // Mythic LV1 = L81, the slot docs/effects/00-RULES.md already assigns it.
  // ⚠ ADDING a ladder row grants it to everyone ALREADY at that level, which is
  // why moving one is a founder decision. This is not a move: the slot was
  // approved on the scope table and simply had no row, so the reward was
  // promised in the plan and unearnable in the product.
  out.push(row(81, 'ambiance', 'ambiance', 'Profile music', 'profile',
    'Pick a track from Audius, or upload your own. It plays for visitors.', { equip: true }));
  // ── Squad environments (effect 11) ───────────────────────────────
  // TWO TIERS, and the split is the doc's, not an invention: a static room is
  // safe anywhere, weather is a running rAF and earns a higher slot.
  // Champion is levels 51-60 and Legend 71-80, so the doc's "Champion LV2" and
  // "Legend LV3" resolve to 52 and 73.
  //
  // ⚠ IT BELONGS TO THE SQUAD, NOT THE VIEWER. A squad is a shared place, so
  // the environment is set by an owner who holds the unlock and is then seen by
  // every member regardless of their own level. Gating it per-viewer would mean
  // two people in one room seeing two different rooms, which stops it being a
  // room at all.
  out.push(row(52, 'squad_environment', 'squad_environment', 'Squad environments', 'social',
    'Give your squad chat a room: a lit scene behind the whole thread.', { equip: true }));
  out.push(row(73, 'squad_weather', 'squad_weather', 'Squad weather', 'social',
    'Your squad room gets live weather — rain, snow, embers, drifting light.', { equip: true }));

  // Animated banner (scope-table effect 16). Contender L3 — Contender is 11-20,
  // so LV3 is 13. Level ONLY, deliberately not level-OR-Pro: Pro advertises
  // "5GB uploads + 4K photos" and a vergr.me design kit, and it does not claim
  // this. Inventing an unadvertised Pro perk is how tier copy goes stale.
  out.push(row(13, 'animated_banner', 'animated_banner', 'Animated banner', 'profile',
    'Your profile banner can be a short looping clip instead of a still.'));

  // Animated avatar (scope-table effect 20). ⚠ THE FEATURE ALREADY EXISTED as a
  // Pro-only perk; the founder overruled the Pro-only gate, so this row is the
  // second way in. Nothing new is built — `uploadAvatar` already passes an
  // animated file through uncompressed, it just asked the wrong question.
  //
  // ⚠ LEVEL OR PRO, exactly like chat_theme. The plan half stays out of this
  // table (it is a plan check, not a level check) and lives in
  // canUseAnimatedAvatar() below.
  //
  // L45 is deliberate: 41 already carries the Elite crest AND a boost token, and
  // the ladder's real gaps are BETWEEN the band starts, not on them.
  out.push(row(45, 'animated_avatar', 'animated_avatar', 'Animated avatar', 'profile',
    'Your avatar can be a GIF or animated WebP instead of a still.'));

  // The Golden Thread (effect 07). Legend LV2 — Legend is 71-80, so LV2 is 72.
  //
  // ⚠ THE HOLDER CANNOT SEE THEIR OWN THREAD, and that is the design. It renders
  // in the BROADCASTER's chat only, because §1's purpose is "so the streamer can
  // track that person". Twitch's own chat highlights "will never be visible to
  // other viewers"; this follows that, and it is what stops ten Legends in one
  // chat turning into spaghetti — there is one path, and the host chooses it.
  //
  // What the holder gets is the scarcest thing in a fast chat: the streamer can
  // actually follow them. They see a small gold mark on their OWN messages on
  // their OWN screen confirming they hold it (.vg-thread-own).
  out.push(row(72, 'golden_thread', 'golden_thread', 'Golden Thread', 'chat',
    'Your messages are linked for the streamer, so they can follow you in a busy chat.'));

  // Text-to-speech on a stream (effect 13). Ascendant LV2 — and ⚠ ASCENDANT IS
  // 91-99, NOT 81-90 (that band is Mythic), so LV2 is 92. I quoted L82 once
  // before checking RANK_TIERS; the doc's band names are not level numbers.
  //
  // ⚠ ALSO GRANTED BY PRO, exactly like chat_theme. That second gate is a PLAN
  // check, not a level check, so it lives in canUseStreamTts() and not in this
  // table. Founder, 2026-08-26: "both, can be unlocked or by subscribing to pro".
  // There is NO coin charge — the two gates ARE the price.
  out.push(row(92, 'tts_stream', 'tts_stream', 'Speak on stream', 'social',
    'Send a message the whole stream hears out loud, not just reads.', { equip: false }));

  out.push(row(100, 'name_glow',    'name_glow',     'Immortal name glow',  'chat',
    'Permanent glow on your name, and the only crest nobody else can hold.'));

  // ── Every level earns faster than the last ───────────────────────
  // This is the answer to "no dead levels", and it is deliberately NOT a
  // cosmetic. Earlier drafts filled the gaps with invented rewards (emote
  // packs, pinned-post slots, comment tints, a trophy case), none of which
  // have a system behind them. A ladder that promises fifteen things and
  // delivers five is the exact defect this whole table exists to fix, so the
  // unbacked rows were cut rather than shipped. What is left is real.
  //
  // The VP bonus IS real: functions/walletActions.js and functions/engagementVp.js
  // both ALREADY fetch the user doc to read the plan multiplier, so reading
  // vpLevel from that same snapshot costs nothing extra. See rankVpBonus().
  for (let lvl = 2; lvl <= 100; lvl++) {
    out.push(row(lvl, 'vprate_' + lvl, 'vp_rate',
      '+' + (VP_BONUS_PER_LEVEL * 100).toFixed(1) + '% VP earn rate', 'utility',
      'Everything you do earns ' + Math.round(rankVpBonus(lvl) * 1000) / 10 + '% of base VP from now on.'));
  }

  return out.sort((a, b) => (a.level - b.level) || a.id.localeCompare(b.id));
};

export const RANK_UNLOCKS = buildLadder();

// ── Lookups. All pure, all O(n) over ~140 rows, all free. ────────────

/** Everything granted exactly AT this level (what the level-up modal shows). */
export const unlocksForLevel = (level) =>
  RANK_UNLOCKS.filter(u => u.level === level);

/** Everything the user has, cumulative. */
export const unlockedThrough = (level = 1) =>
  RANK_UNLOCKS.filter(u => u.level <= level);

/** Everything still ahead, nearest first (what the levels screen teases). */
export const lockedFrom = (level = 1) =>
  RANK_UNLOCKS.filter(u => u.level > level);

export const isUnlocked = (id, level = 1) => {
  const u = RANK_UNLOCKS.find(x => x.id === id);
  return !!u && level >= u.level;
};

/** Hex for an accent id, or null. */
export const accentHex = (id) => PROFILE_ACCENTS.find(a => a.id === id)?.color || null;

// Two is the minimum for a gradient; six is where extra stops stop being
// legible on a name a few characters long. Mirrored in firestore.rules.
export const MAX_GRADIENT_STOPS = 6;

/**
 * The user's profile accent, as hex.
 *
 * ⚠ THE ONE PLACE ACCENT RESOLVES. `ProfileScreen`, `PublicProfileScreen` and
 * `NativeProfileScreens` each hand-rolled `PROFILE_ACCENTS.find(...)`, which
 * meant a free-hex accent would have worked in the picker and silently done
 * nothing on two of the three profiles. The avatar orbit reads the same token,
 * so a second resolver here would desync the name from the ring.
 *
 * `accentHex` (free colour, chosen with the picker) wins over `accent` (one of
 * the 12 preset ids), and the preset stays supported so nothing already equipped
 * breaks.
 */
export const accentFor = (profile, fallback = '#B44FFF') => {
  const raw = profile?.cosmetics?.accentHex;
  if (isHexColor(raw)) return raw.toLowerCase();
  return accentHex(profile?.cosmetics?.accent) || fallback;
};

/**
 * The typeface this person has equipped, or null.
 *
 * ⚠ IT CHECKS THE LEVEL, AND IT DID NOT BEFORE. This used to be a bare
 * `fontById(...)` lookup with no gate at all, which was survivable only while
 * ONE row at L3 granted all 18 faces — there was nothing to gate. Now that the
 * faces are drip-fed across the ladder, a stored `cosmetics.nameFont` naming a
 * face you have not reached would have rendered anyway.
 *
 * Same shape as `typingStyleFor` below: firestore.rules enforces the FLOOR (you
 * must have the feature at all, and the id must be in the enum), and this
 * resolver enforces the per-item level at render time. Every surface draws
 * names through <UserName>, so this is the one place it has to hold.
 *
 * Falls back to null — the default face — for an unknown id or a face above
 * the person's level, never to a broken render.
 */
export const nameFontFor = (profile) => {
  const f = fontById(profile?.cosmetics?.nameFont);
  if (!f) return null;
  const level = profile?.role === 'admin' ? 100 : (Number(profile?.vpLevel) || 1);
  return level >= (f.level || 1) ? f : null;
};

/** Has this person reached the level for one specific typeface? */
export const canUseFont = (id, level = 1) => {
  const f = fontById(id);
  return !!f && (Number(level) || 1) >= (f.level || 1);
};

/**
 * The typing-indicator style this person has equipped, as an id.
 *
 * ⚠ PASS THE TYPIST'S PROFILE, NOT THE VIEWER'S. The whole point of this
 * cosmetic is that the OTHER person sees it, so a viewer-resolved style would
 * show you your own indicator on somebody else's typing, which is both wrong
 * and the easiest mistake to make here (see effects/useEffectEnabled.js).
 *
 * COSTS NOTHING. Every surface that draws an indicator has already loaded the
 * typist's user doc for their name and avatar (docs/effects/06 §4.1), so this
 * is a property read, never a fetch.
 *
 * Falls back to 'dots' for an unknown id, a missing profile, or a style above
 * the person's level — the level is re-checked here rather than trusted,
 * because `cosmetics` is client-written and only firestore.rules gates it at
 * write time. A doc written before a rules change could still carry a style
 * its owner can no longer hold.
 */
export const typingStyleFor = (profile) => {
  const chosen = TYPING_STYLES.find(s => s.id === profile?.cosmetics?.typingStyle);
  if (!chosen) return 'dots';
  const level = profile?.role === 'admin' ? 100 : (Number(profile?.vpLevel) || 1);
  return level >= chosen.level ? chosen.id : 'dots';
};

/**
 * The user's chosen name colour, lifted to stay legible, or null.
 *
 * ⚠ CONTRAST IS ENFORCED, NOT TRUSTED. The colour is free (eyedropper, hex,
 * anything), so #000000 on a near-black surface is one tap away. `ensureContrast`
 * lifts it to 4.5:1 (WCAG normal text) rather than overriding the choice
 * outright, so the user gets as close to what they picked as legibility allows.
 *
 * ⚠ Do NOT reach for `inkFor()` in profileThemes.js — it only DARKENS, which on
 * these near-black surfaces drives a low-contrast name to invisible. See the
 * note on ensureContrast() in utils/color.js.
 *
 * @param {object} profile the OWNER's users/{uid} doc
 * @param {number} level   already resolved (admin ⇒ 100)
 * @param {string} onHex   the surface the name sits on
 */
export const nameColorFor = (profile, level, onHex = '#14141F') => {
  if (!isUnlocked('name_color', level)) return null;
  const raw = profile?.cosmetics?.nameColor;
  const hex = isHexColor(raw) ? raw.toLowerCase() : accentHex(raw);
  return hex ? ensureContrast(hex, onHex, 4.5) : null;
};

/** Level an accent id needs, or Infinity if it is not a real accent. */
export const accentMinLevel = (id) =>
  PROFILE_ACCENTS.find(a => a.id === id)?.level ?? Infinity;

/**
 * The THREE stops of a user's animated name gradient.
 *
 * ⚠ THE USER PICKS THESE, AS FREE HEX. Founder, 2026-08-24: "users should be
 * allowed to choose the colours for their gradient, it is after all their
 * achievement and not our choice", and then: "forcing the user to select from
 * swatches is bad UX". So the UNLOCK is what is earned (L63 `name_effect`); the
 * colours themselves are unconstrained. The accents remain as PRESETS in the
 * picker, not as the only options.
 *
 * ⚠ EVERY VALUE IS VALIDATED AS HEX before it reaches CSS. These strings are
 * interpolated into a `linear-gradient()` via custom properties, so an
 * unvalidated value could rewrite the gradient rather than colour it. Mirrored
 * in firestore.rules — the picker is not the boundary.
 *
 * The rank colour is only the DEFAULT, for someone who has not chosen yet, so
 * nobody who already had the effect loses it by never opening the picker.
 *
 * @param {object} profile the OWNER's users/{uid} doc
 * @param {number} level   already resolved (admin ⇒ 100)
 * @returns {{a: string, b: string, c: string}|null}
 */
/**
 * The colour stops of a user's animated name gradient, as an array of hex.
 *
 * ⚠ THE USER PICKS THESE, AND PICKS HOW MANY. Founder, 2026-08-24: "it is after
 * all their achievement and not our choice", then "what if the user doesn't want
 * 3 colours? why must you try to force things". So the count is 2..MAX_STOPS and
 * nothing here assumes three.
 *
 * ⚠ EVERY STOP IS HEX-VALIDATED HERE, and this is the real boundary. These
 * strings are interpolated into a `linear-gradient()`, and firestore.rules
 * cannot iterate a list, so per-item validation has to happen on the READ path.
 * An invalid entry is DROPPED, not rendered.
 *
 * @param {object} profile the OWNER's users/{uid} doc
 * @param {number} level   already resolved (admin ⇒ 100)
 * @returns {string[]|null} 2+ hex colours, or null when the effect should not run
 */
export const nameGradientFor = (profile, level) => {
  const g = profile?.cosmetics?.nameGradient || {};
  const pick = (v) => (isHexColor(v) ? v.toLowerCase() : accentHex(v));

  const raw = Array.isArray(g.stops)
    ? g.stops
    // Legacy shapes, kept so nobody's saved gradient breaks: {a,b,c} was the
    // three-colour version, {from,to} the two-colour one before it.
    : [g.a ?? g.from, g.b ?? g.to, g.c];

  const stops = raw.map(pick).filter(Boolean).slice(0, MAX_GRADIENT_STOPS);
  if (stops.length >= 2) return stops;

  // Nothing chosen: derive a default from the rank colour so the effect still
  // reads as earned. At level 100 the rank colour is #FFFFFF, so a white-on-white
  // ramp would make the TOP of the ladder the only invisible reward on it.
  const base = chatNameColor(level);
  if (!base) return null;
  return /^#(f|F){3,6}$/.test(base)
    ? ['#ffffff', '#b44fff', '#4dffd4']
    : [base, '#ffffff'];
};

/**
 * The CSS `background-image` for a name sweep, built so the loop is SEAMLESS.
 *
 * ⚠ READ docs/effects/03-name-gradient.md §0.1 BEFORE CHANGING ANY NUMBER HERE.
 * The animation translates the image by exactly one period, so the image must
 * contain a whole number of identical periods and must begin and end on the same
 * colour. Two cycles across a 200%-wide image ⇒ one period = one element width,
 * which is exactly what `background-position: 0% → 100%` travels.
 *
 * 90deg is deliberate: an angled gradient has a vertical component, so a
 * horizontal translation would not land on the same pixels and the seam returns.
 */
export const nameSweepImage = (stops) => {
  if (!stops || stops.length < 2) return null;
  const n = stops.length;
  const parts = [];
  for (let cycle = 0; cycle < 2; cycle++) {
    for (let i = 0; i < n; i++) {
      parts.push(`${stops[i]} ${(cycle * 50 + (i / n) * 50).toFixed(4)}%`);
    }
  }
  parts.push(`${stops[0]} 100%`);   // closes the second cycle on the first colour
  return `linear-gradient(90deg, ${parts.join(', ')})`;
};

/** The level an unlock id needs. Mirrors the firestore.rules gate exactly. */
export const unlockLevel = (id) => {
  const u = RANK_UNLOCKS.find(x => x.id === id);
  return u ? u.level : 999;
};

/** The next thing you will get, for the "keep going" line. */
export const nextUnlock = (level = 1) =>
  RANK_UNLOCKS.find(u => u.level > level) || null;

/** Options of one equippable kind that this level can actually use. */
export const availableOfKind = (kind, level = 1) =>
  RANK_UNLOCKS.filter(u => u.kind === kind && u.level <= level);

/** How many slots a repeating unlock has granted (pins, links). */
export const slotsFor = (kind, level = 1) =>
  unlockedThrough(level)
    .filter(u => u.kind === kind)
    .reduce((max, u) => Math.max(max, u.slots || 0), kind === 'pin_slot' ? 1 : 0);

/** Dev guard: the whole point of the table is that no level is empty. */
export const assertNoDeadLevels = () => {
  const missing = [];
  for (let l = 1; l <= 100; l++) {
    if (!RANK_UNLOCKS.some(u => u.level === l)) missing.push(l);
  }
  return missing;
};

/**
 * The REAL coverage guard.
 *
 * ⚠ `assertNoDeadLevels` above is NOT coverage and never was. Every level
 * carries a `vprate_` row by construction, so it returned an empty list the
 * entire time 56 of the 100 levels gave nothing but the +0.5% earn rate. It was
 * green while the ladder was half hollow, which is worse than no guard: it ended
 * the enquiry. Keep it (it still catches a level with no row at all), but never
 * cite it as proof the ladder is populated.
 *
 * This one counts rows that are NOT `vprate_` — something the player can see,
 * equip or spend. Any level returning zero is a level that costs VP and pays
 * nothing visible.
 */
export const assertNoHollowLevels = () => {
  const hollow = [];
  for (let l = 1; l <= 100; l++) {
    const real = RANK_UNLOCKS.some(u => u.level === l && !String(u.id).startsWith('vprate_'));
    if (!real) hollow.push(l);
  }
  return hollow;
};

// Re-exported so callers keep importing name cosmetics from one module.
export { NAME_FONTS, NAME_FONT_IDS, fontById, ensureNameFont };

/**
 * Animated avatar (scope-table effect 20): LEVEL OR PRO.
 *
 * ⚠ Same shape and the same two-shape subscription read as `canUseChatThemes()`
 * in chatThemes.js. That comment is worth repeating: the client historically
 * wrote the plan in more than one place, so reading only `profile.subscription`
 * as a string silently fails for accounts stored the other way.
 *
 * ⚠ TAKES THE RAW USER DOC, not a context profile, because its only caller is
 * `uploadAvatar` in firestore.js — which has ALREADY fetched that document to
 * resolve the tier. So this gate costs no extra read.
 */
/**
 * Animated banner (scope-table effect 16): LEVEL ONLY, no plan half.
 * ⚠ Takes the raw user doc, like canUseAnimatedAvatar — its caller has already
 * fetched it, so this costs no extra read.
 */
export const canUseAnimatedBanner = (u) => {
  if (!u) return false;
  if (u.role === 'admin') return true;
  return isUnlocked('animated_banner', Number(u.vpLevel) || 1);
};

export const canUseAnimatedAvatar = (u) => {
  if (!u) return false;
  if (u.role === 'admin') return true;
  if (isUnlocked('animated_avatar', Number(u.vpLevel) || 1)) return true;
  return u.subscription === 'pro' || u.subscription?.tier === 'pro';
};
