// UserName — the ONE place a person's name is rendered.
//
// ── WHY THIS EXISTS ─────────────────────────────────────────────────
//
// Measured 2026-08-24: **723 JSX sites across 148 files** render a display name
// or handle, and there was no shared component for it. `UserAvatar` exists and
// is used in 124 files, which is exactly why the avatar orbit effect was a
// one-line change — and why four name effects (font, colour, animated gradient,
// animated crest) were otherwise going to mean editing 723 call sites with
// nothing to catch a miss.
//
// Full analysis, the complete surface inventory, and the MUST / MUST-NOT split:
//   docs/effects/01-username-component.md
//
// ── THE CONTRACT ────────────────────────────────────────────────────
//
// It renders the NAME TEXT ONLY — a <span>. It deliberately does NOT render the
// surrounding button, link or navigation, because every call site has its own
// interaction (navigate to profile, open a sheet, do nothing). Callers keep
// their wrapper and swap only the text node.
//
// Resolution order, and the order matters:
//   1. the Vanguard identity mask — WINS OVER EVERY COSMETIC. A masked persona
//      shows nothing personal, cosmetics included.
//   2. bot / deleted fallbacks
//   3. the accent colour        (docs/effects/04)
//   4. the font choice          (docs/effects/04)
//   5. the animated gradient    (docs/effects/03)
//
// ⚠ PHASE A: only `context="plain"` is implemented, and it renders
// byte-identically to what every call site rendered before. That is deliberate.
// The migration must be a pure refactor with zero visual change, verified, and
// only THEN do effects get added behind this one component. Shipping the
// refactor and the effects together would make a regression impossible to
// attribute.

import { applyVanguardMask } from '../utils/vanguard';
import {
  chatNameColor, isUnlocked, nameGradientFor, nameSweepImage,
  nameColorFor, nameFontFor, ensureNameFont,
} from '../utils/rankUnlocks';
import { hexToRgb } from '../utils/color';

// What a name actually sits on, per context. The contrast solver needs the real
// backdrop or it corrects against the wrong thing: chat rows sit on surface-1,
// a profile heading on the near-black page.
const SURFACE_HEX = {
  chat: '#14141F',
  feed: '#14141F',
  profile: '#0B0B14',
  plain: '#14141F',
};

/**
 * @param {object}  props
 * @param {object}  props.user     the user being NAMED (not the viewer)
 * @param {object}  [props.viewer] the signed-in user, for the Vanguard mask
 * @param {boolean} [props.masked] pass true if `user` is ALREADY masked, so the
 *                                 mask is not applied twice (PostCard and the
 *                                 profile screens already compute it for the
 *                                 avatar and would otherwise double-apply)
 * @param {'plain'|'chat'|'profile'|'feed'} [props.context]
 * @param {string}  [props.fallback] what to show when there is no name at all.
 *                                 Defaults differ per mode ON PURPOSE: a
 *                                 display name falls back to 'User', but a
 *                                 handle with nothing to show renders NOTHING,
 *                                 because a bare "@" is worse than an absence.
 *                                 Pass one explicitly and handle mode uses it
 *                                 (`fallback="you"` renders `@you`), which is
 *                                 what the composer previews need.
 * @param {string}  [props.className]
 * @param {object}  [props.style]
 * @param {boolean} [props.handle]  render `@username` instead of the display name
 */
export default function UserName({
  user,
  viewer,
  masked = false,
  context = 'plain',
  fallback,
  className = '',
  style,
  handle = false,
  ...rest
}) {
  const u = masked ? user : applyVanguardMask(user, viewer);

  // ⚠ The two modes resolve differently and both are load-bearing.
  //
  // handle: 37 call sites wrote `@{u.username}`, i.e. a LITERAL @ in JSX text
  // followed by the handle. With no handle those rendered a stray "@". Rendering
  // nothing instead is the one deliberate improvement in Phase A, and it is
  // unreachable in practice because `maintainUsernameIndex` assigns every
  // account a handle. An explicitly-passed fallback still wins, so the composer
  // previews that read `@{profile?.username || 'you'}` keep saying "@you".
  const h = u?.username || fallback;
  const text = handle
    ? (h ? `@${h}` : '')
    : (u?.displayName || u?.username || fallback || 'User');

  // ── COSMETICS ──────────────────────────────────────────────────────
  //
  // Everything below resolves from ONE number, `vpLevel`, which is
  // server-written and server-only, so a client cannot fake it and a visitor
  // evaluates the OWNER's. That is what makes these free.
  //
  // ⚠ THREE GATES, AND EACH ONE IS LOAD-BEARING:
  //
  //  1. the Vanguard mask WINS over every cosmetic. A masked persona is
  //     anonymous; a rank-coloured sweeping name would defeat the mask outright.
  //  2. `context === 'plain'` opts out entirely — admin tables, forms and
  //     exports must show the true, plainly-legible name (01 §3.2).
  //  3. NO LEVEL ⇒ NO COSMETIC, silently. Not defensive coding, the cost model.
  //     A feed post's author is a denormalised snapshot with no vpLevel
  //     (CreateComposer.jsx:989), so a name there renders plain rather than
  //     costing a Firestore read per author.
  //
  // ⚠ USERNAME COSMETICS SHOW ON EVERY SURFACE (founder, 2026-08-24). Do not
  // narrow this to chat. CLAUDE.md's "rank shows in live chat and the stream
  // entrance ribbon only" governs the rank CREST and the avatar ring — a badge
  // announcing someone's rank — NOT the user's own name styling. Widening the
  // name effects beyond chat is the entire reason <UserName> was built and why
  // 01 §3.1 lists every surface as MUST-adopt.
  // Admin resolves to 100 so cosmetics can be judged on a real account without
  // grinding one to max. Same allowance `isEffectOn()` already makes, and it
  // mirrors firestore.rules — keep the three in step.
  const level = u?.role === 'admin' ? 100 : (Number(u?.vpLevel) || 0);
  // ⚠ COSMETICS APPLY TO THE DISPLAY NAME ONLY, NEVER TO THE @HANDLE.
  // Founder, 2026-08-24: "the animation and gradient or even the colour is only
  // supposed to effect the display name never the @user." He is right, and not
  // only aesthetically: the handle is an IDENTIFIER. It is how you find, tag and
  // report someone, so it has to stay plain, legible and consistent everywhere.
  // A swept, recoloured @handle is decoration applied to a primary key.
  //
  // This shipped wrong because `handle` was treated as a text-formatting flag
  // and nothing downstream re-checked it.
  const cosmetic = !!level && !handle && !u?.isVanguardPersona && context !== 'plain';

  // L63 `name_effect`. The level lives in RANK_UNLOCKS, which is what the levels
  // screen promises; moving it retroactively grants the reward to people who
  // have not earned it, so it is a founder decision, not a tuning knob.
  //
  // ⚠ `cosmetics.nameEffect` is the user's own switch, and it WAS INERT: the
  // Prestige screen has offered this toggle for a while and NOTHING read it —
  // neither ChatPanel's old inline version nor the first pass of this file. A
  // control the user trusts that does nothing is worse than no control (see the
  // three inert kill switches in CLAUDE.md). Read as an OPT-OUT, matching
  // `isEffectOn()`: undefined means on, so nobody loses an effect they have.
  const sweep = cosmetic
    && isUnlocked('name_effect', level)
    && u?.cosmetics?.nameEffect !== false;
  // ── COLOUR PRECEDENCE, highest first ───────────────────────────────
  //   1. the animated gradient (L63) — replaces any flat colour, never stacks
  //   2. the user's CHOSEN colour (L12 `name_color`) — their pick beats the
  //      automatic one, which is the whole point of earning the choice
  //   3. the rank colour (L3 `chatcolor`) — automatic, not chosen
  //   4. nothing: inherit from the call site, exactly as before any of this
  //
  // ⚠ The chosen colour is contrast-corrected in nameColorFor(), not here, and
  // NOT with profileThemes' inkFor(), which only darkens and would drive a name
  // to invisible on these near-black surfaces.
  const chosen = cosmetic ? nameColorFor(u, level, SURFACE_HEX[context] || SURFACE_HEX.plain) : null;
  const tint = chosen || (cosmetic ? chatNameColor(level) : null);

  // L3 `name_font`. A CURATED enum, never a free string — but 18 faces, not
  // three. The webfont cost is handled by DEMAND LOADING rather than by
  // shipping a boring list: `ensureNameFont` injects a family's stylesheet the
  // first time a name using it renders, once per page, `display=swap` so the
  // name is never invisible while the file is in flight. See utils/nameFonts.js.
  const font = cosmetic && isUnlocked('name_font', level) ? nameFontFor(u) : null;
  if (font) ensureNameFont(font.id);
  const fontStyle = font && font.id !== 'default'
    ? { fontFamily: font.stack, fontWeight: font.weight }
    : null;

  // The user's OWN colours, however many they chose (2 to 6); the rank colour is
  // only the default. `nameGradientFor` hex-validates every stop and DROPS any
  // that fails, which is the real boundary — firestore.rules cannot iterate a
  // list, so per-item validation has to happen here, on the read path.
  //
  // The image is built in JS rather than from CSS custom properties because the
  // STOP COUNT VARIES and CSS cannot loop. `.vg-name-sweep` still owns the clip,
  // the fill and the animation, so the seamless-loop maths lives in one place.
  const stops = sweep ? nameGradientFor(u, level) : null;
  const image = stops && nameSweepImage(stops);

  // ── L100 `name_glow` — the last row on the ladder ──────────────────
  // ⚠ THIS ROW WAS INERT UNTIL 2026-08-25. RANK_UNLOCKS promised "Immortal name
  // glow" at L100 and NOTHING read it: this file resolved font, colour, chat
  // colour and the gradient, and had no glow at all. Exactly what CLAUDE.md
  // bans ("do not add a row to that table for something that does not exist
  // yet") and the same shape as the inert `cosmetics.nameEffect` toggle above.
  // `scripts/vp-mirror-check.mjs` now fails the build on a ladder row with no
  // consumer, so this cannot recur silently.
  //
  // ⚠ A FILTER, NOT text-shadow. On the gradient path the glyphs are
  // TRANSPARENT (the colour comes from a clipped background image), so a
  // text-shadow draws behind nothing. CLAUDE.md records the same finding on the
  // earnings gauge. `drop-shadow` follows the rendered alpha, so it works on
  // both paths and needs no special case.
  //
  // ⚠ TWO PASSES, hot-and-tight plus wide-and-faint. One blur reads as a smudge;
  // light falls off, so it needs more than one radius. Same lesson as the
  // earnings bloom.
  //
  // ⚠ STATIC ON PURPOSE. A pulsing name on every surface in the app would be
  // exhausting, and an animation here would have to answer BOTH reduced-motion
  // switches (docs/effects/06 §8.2.2). A steady halo has neither problem and
  // costs nothing to render.
  const glow = cosmetic && isUnlocked('name_glow', level);
  // The glow takes the name's OWN colour: the first gradient stop, else the
  // chosen/rank tint, else white for an inherited colour we cannot read.
  const glowRgb = glow ? hexToRgb((stops && stops[0]) || chosen || tint || '#FFFFFF') : null;
  const glowStyle = glowRgb
    ? {
      filter: `drop-shadow(0 0 3px rgba(${glowRgb.r},${glowRgb.g},${glowRgb.b},0.55))`
            + ` drop-shadow(0 0 9px rgba(${glowRgb.r},${glowRgb.g},${glowRgb.b},0.30))`,
    }
    : null;
  if (image) {
    return (
      // ⚠⚠ `dir="auto"` ON USER-GENERATED TEXT. Measured 2026-09-03: NOT ONE element in
      // the whole app set `dir`, so an Arabic or Hebrew display name renders inside an LTR
      // box. The glyphs shape correctly, which is why it looks fine at a glance, but the
      // ellipsis lands on the wrong side of a truncated name and mixed RTL/LTR content
      // (a handle, a number, punctuation) orders wrongly against it.
      //
      // `auto` infers direction from the first strong character, so it costs nothing for the
      // Latin names that dominate today and is correct the moment one is not.
      <span
        dir="auto"
        className={`vg-name-sweep ${className}`}
        style={{ backgroundImage: image, ...fontStyle, ...glowStyle, ...style }}
        {...rest}
      >
        {text}
      </span>
    );
  }

  return (
    <span
      dir="auto"
      className={className}
      style={(tint || fontStyle || glowStyle)
        ? { ...(tint ? { color: tint } : null), ...fontStyle, ...glowStyle, ...style }
        : style}
      {...rest}
    >
      {text}
    </span>
  );
}
