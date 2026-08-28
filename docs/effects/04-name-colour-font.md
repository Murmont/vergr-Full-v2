# 04 — Username colour and font

**STATUS: SHIPPED + DEPLOYED 2026-08-24.** Font at L3 (`name_font`), colour at
L12 (`name_color`). Rules: [00-RULES.md](00-RULES.md)

---

## 0. WHAT SHIPPED, AND WHAT THIS DOCUMENT GOT WRONG

| | |
|---|---|
| Colour | `cosmetics.nameColor`, free hex, contrast-corrected on read |
| Font | `cosmetics.nameFont`, enum of the 3 already-loaded families |
| Picker | `ColorField.jsx`, shared with the gradient editor |
| Resolvers | `nameColorFor()` / `nameFontFor()` in `rankUnlocks.js` |
| Guard | `scripts/name-contrast-check.mjs`, 34 assertions, in `npm run check` |

### 0.1 ⚠ "Reuse `inkFor`" WAS WRONG AND WOULD HAVE MADE NAMES INVISIBLE

§4 said to pass the colour through `inkFor()` from `profileThemes.js`. Read
before use: it multiplies the colour by `0.95` up to 40 times, i.e. it **only
ever DARKENS**. That is correct for dark ink on a LIGHT surface, which is the
one case it was written for (and `LIGHT_COLLECTIONS` is now empty, so it is
dead code).

Vergr's name surfaces are `#14141F` and `#0B0B14`. Darkening a low-contrast
colour there makes it **worse**, and after 40 iterations returns something
indistinguishable from the background. It is also **not exported**, so the
instruction was not even followable as written.

Replaced by `ensureContrast()` in `src/utils/color.js`, which picks the
DIRECTION from the background luminance: lighten on a dark surface, darken on a
light one. It respects the user's pick as far as legibility allows rather than
overriding it.

### 0.2 The contrast guesses were half right, and only measurement settled it

§1.1 flagged three accents as risky. Measured, all 12 accents on both surfaces:

| Accent | Predicted | Measured on `#0B0B14` | Verdict |
|---|---|---|---|
| `violet` `#7B1FFF` | risky | **3.25:1** → lifted to 4.59:1 | prediction correct |
| `ruby` `#E0115F` | risky | **4.12:1** → lifted to 4.59:1 | prediction correct |
| `onyx` `#8A8F98` | "likely under 4.5:1" | **6.03:1** | **prediction WRONG**, it was always fine |

`scripts/name-contrast-check.mjs` runs all 12 accents plus five pathological
picks (pure black, near-black, deep navy, dark violet, mid grey) across both
surfaces = 34 assertions, wired into `npm run check` so the build fails if a
name colour can ever be illegible. Pure black lifts to `#7e7e7e` rather than
staying invisible, which is the case `inkFor` could not have handled.

### 0.3 Colour precedence, because three systems now colour the same text

Resolved in `<UserName>`, highest first:

1. the animated gradient (L63) — replaces any flat colour, never stacks
2. the user's CHOSEN colour (L12) — their pick beats the automatic one
3. the rank colour (L3 `chatcolor`) — automatic, not chosen
4. nothing — inherit from the call site

The Vanguard mask still wins over all four, and `context="plain"` opts out
entirely.

### 0.4 The font enum is a cost decision, not a taste one

Verified live: equipping the Display face loaded **zero** new font families
(`document.fonts` before and after are identical). The three options are the
families the app already ships. Enforced in `firestore.rules` as
`in ['default','display','mono']`, because a free string is a free webfont
download on the busiest surface in the app.

---

## 1. Research

### 1.1 Colour

No technique research needed — it is one token. The research that *is* needed is
legibility, and it has a hard number.

WCAG requires **4.5:1** for normal text and **3:1** for large text.
Source: [Axess Lab](https://axesslab.com/glassmorphism-meets-accessibility-can-frosted-glass-be-inclusive/)

The 12 accents in `PROFILE_ACCENTS` (`src/utils/rankUnlocks.js`) are brand
colours chosen against dark surfaces. Three need checking before shipping:

| Accent | Hex | Risk |
|---|---|---|
| `onyx` | `#8A8F98` | mid-grey on `#14141F` — likely under 4.5:1 |
| `violet` | `#7B1FFF` | dark violet on near-black |
| `ruby` | `#E0115F` | saturated red on dark |

`src/utils/profileThemes.js` already contains a working contrast solver
(`inkFor`, WCAG relative luminance + iterative adjust). **Reuse it — do not
write a second one.** It is currently inert (`LIGHT_COLLECTIONS` is empty) but
correct.

### 1.2 Font

⚠ **A free-choice font picker is not viable.** A font the user picks is a
webfont download, and a chat with 30 distinct speakers would trigger up to 30
font loads on the busiest surface in the app.

The app already loads exactly three families (`tailwind.config.js`, CLAUDE.md
Stack section): **Syne** (headings), **DM Sans** (body), **DM Mono** (numbers).
The unlock is therefore a **curated pick from what is already loaded**, costing
zero additional bytes:

| Option | Family | Character |
|---|---|---|
| Default | DM Sans 700 | what every name renders as today |
| Display | Syne 800 | the entry-ribbon voice |
| Mono | DM Mono 500 | technical |

Any fourth option means a new webfont; do not add one without a size budget.

## 2. Cost

**Zero.** Both resolve from `vpLevel` plus `cosmetics.accent`, already on the
user doc the relay loads once per connection (R9).

## 3. Surfaces

Every **MUST** row in [01 §3.1](01-username-component.md), applied inside
`<UserName>` only.

⚠ **One extra surface that is not a name render** and is easy to miss: the
accent already drives `--vg-accent` on the profile root
(`ProfileScreen.jsx`, `PublicProfileScreen.jsx`, `NativeProfileScreens.jsx`) and
the avatar orbit reads it. Changing how the accent resolves changes those too.
Verify the orbit still matches the name after any change here.

Excluded per 01 §3.2: `src/screens/admin/**`, onboarding, auth, settings,
marketing, Vanguard-masked personas.

## 4. Implementation

1. `<UserName>` reads `cosmetics.accent` → `PROFILE_ACCENTS` → hex.
2. Pass it through `inkFor(hex, surfaceHex, 4.5)` from `profileThemes.js` so a
   low-contrast accent is lifted rather than shipped unreadable. The surface hex
   differs per context: chat rows sit on `#14141F`, the profile on `#000000`.
3. Font: a three-value enum on `cosmetics.nameFont`, mapped to the three loaded
   families. Never a free string — an arbitrary value is an arbitrary font load.
4. Add both rows to `EFFECTS` in `src/utils/rankUnlocks.js` (font L3, colour
   L12).

## 5. Verification

- **Contrast, measured:** for all 12 accents x the 2 surface colours, assert the
  computed ratio is >= 4.5:1. A script, not a spot check — 24 combinations.
- Assert `font-family` computes to one of exactly three families across every
  surface; anything else means a call site bypassed the enum.
- Assert `document.fonts` gains no new family when a name font is equipped.
- Assert the avatar orbit and the name resolve to the same accent on all three
  profile screens.
