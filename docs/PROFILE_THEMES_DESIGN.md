# Profile themes: the design

Status: **DESIGN ONLY, nothing built.** Superseding the eight CSS gradients
currently shipped, which are a wallpaper picker and were correctly rejected.

Founder brief, verbatim constraints:
- Each theme is more impressive than the last, **and the first is not allowed to
  be poor**.
- Nothing simple or cheap-looking.
- **The accent colour the user picks must drive the profile page**, replacing the
  purple.
- Themes should bring the profile to life.

---

## 0. Why the current version failed

It painted a background and stopped. Every other surface on the page (post cards,
right rail, stat tiles, tab underline, dividers, avatar plate) rendered
identically whether you picked Nebula or Standard, so the page read as "dark
cards sitting on a picture". `background-attachment: fixed` made it worse: the
content slid over a static image, which is a desktop wallpaper, not a reward.

**A theme is not a backdrop. It is a light source, and everything on the page has
to be lit by it.** That is the whole of this document.

---

## 1. What is actually on the page (audited, not assumed)

| Surface | `/profile` (ProfileScreen.jsx) | `/user/:uid` (PublicProfileScreen.jsx) |
|---|---|---|
| Accent variable | **none**, 14 hardcoded `#B44FFF` / `#7B1FFF` | `accent` exists, used in 6 places |
| Accent source | n/a | `users.accentColor`, **which has no writer** |
| Cards | inline `#14141F` + `1px solid #1E1E2E` | same pattern |
| Tiles | `rgba(255,255,255,0.04-0.06)` + `1px solid rgba(255,255,255,0.08)` | same |
| Banner | 220px, parallax via `bannerRef` | same |
| Right rail | `OwnerRightPanel`, cards `#14141F` | `setRightPanel` |
| Stat rail | boxed card, VP bar `linear-gradient(90deg,#7B1FFF,#B44FFF)` | same |
| Tab underline | `2px solid #B44FFF` | `2px solid ${accent}` |

**Consequence:** the accent work is not new construction on the public profile,
it is finishing a system that was started and abandoned. On the own-profile it is
14 substitutions.

Available and unused on these screens: `src/styles/surface.css`
(`.vg-wash`, `.vg-material`, `.vg-grain`, `.vg-beam`, `.vg-rule-h`, `.vg-rule-v`,
`.vg-tile`, `.vg-bloom`, `.vg-seg`, `.vg-knob`). Measured from the founder's own
mockups. Imported per-screen, so the profile screens need the import added.

---

## 2. The contract (this is the part that makes it a system)

A theme sets **CSS custom properties on the profile root**, once. Every surface
below reads them. No per-element JS, no prop drilling, no extra reads, and both
profile screens consume the identical contract.

```
--vg-accent          the user's chosen colour, the ONE chroma the page obeys
--vg-accent-soft     accent at low alpha, for fills
--vg-key             colour of the key light
--vg-key-x           horizontal position of the key light (animatable)
--vg-ambient         base fill for a raised surface
--vg-rim             colour of a lit edge
--vg-rim-alpha       strength of a lit edge
--vg-recess          colour of a shadowed wall
--vg-page            the field the whole page sits in
```

Consumers, all restyled to read the tokens instead of hardcoded values:
page root, banner, identity block, stat rail, tab bar, section rules, post cards,
right-rail cards, buttons, chips, links, VP bar.

**Accent is a separate axis from theme.** Theme decides how light behaves; accent
decides what colour the light is where it matters. Twelve accents times eight
themes is 96 real combinations from one system, which is the only honest way to
get variety without drawing 96 backgrounds.

**Accent unification (prerequisite, not optional):** `cosmetics.accent` resolves
to a hex and is written to the SAME `accentColor` field the public profile
already reads, so the existing six consumers light up for free and there is one
accent in the product rather than two.

---

## 3. DEEP (L6) — the full design

Chosen first deliberately. It is the earliest theme anyone can equip, so it is
the one the whole user base sees, and **a system that only looks good when it is
loud is not a system**. If Deep is good at its quietest, the rest are easy.

### 3.1 The idea

*One cold light, far above, falling away into black water.*

Not "a dark gradient". The defining behaviour is a **single distant key source
above the page**, which means: strong vertical falloff, edges that catch light on
their TOP only, almost no ambient, and colour appearing solely where the light
lands. In a field that cold and that empty, **the user's accent is the only
chroma in the frame**, which is precisely how the accent stops being a hex swap
and becomes the subject.

Equip Ember and Deep is a red-lit vault. Equip Mint and it is under ice. Same
theme, unmistakably different profile.

### 3.2 The field

Four layers on the page root, painted once:

```
1. key light   radial-gradient(140% 72% at var(--vg-key-x) -18%,
                 rgba(150,180,255,0.17), transparent 70%)
2. accent bloom radial-gradient(52% 120% at 16% 14%,
                 var(--vg-accent) 0%, transparent 62%)   @ 0.13 alpha
3. depth pool  radial-gradient(130% 42% at 50% 108%,
                 rgba(18,38,78,0.38), transparent 72%)
4. base        linear-gradient(180deg,#0E1119 0%,#070910 38%,#04050A 100%)
+ grain        noise(0.05)
```

- The key is anchored at **-18%**, above the viewport, so the falloff is real
  rather than a band across the middle.
- The depth pool is what stops the bottom of a long profile being flat black.
- Grain at 0.05 is not texture here, it is **banding insurance**: a 2000px
  vertical falloff on a dark palette bands visibly without it.
- `background-attachment` is **scroll, not fixed**. Fixed was the tell that this
  was wallpaper. The field belongs to the page and travels with it.

### 3.3 Surfaces (this is where it stops being a background)

**Cards.** Today: `#14141F` with a 1px grey box on all four sides. Under Deep:

```
fill  linear-gradient(180deg, rgba(255,255,255,0.045), rgba(255,255,255,0.012))
rim   1px, TOP EDGE ONLY,
      linear-gradient(180deg, var(--vg-rim) 0%, transparent 60%)
      masked to the border box
```

With a light from above, the top edge catches and the other three do not. A card
therefore reads as **lifted out of the field** rather than pasted onto it, and
the four-sided hairline the founder already flagged as cheap disappears
completely. This single change does more than any background.

**Stat rail** (Followers / Following / VP). Today a boxed card. Under Deep it
becomes a **recess**: dark wall on the upper edge, lit lip on the lower, numbers
sitting *inside* the surface. Uses the deboss construction already documented in
CLAUDE.md (offset the alpha down and subtract for a dark top wall; offset up for
a lit bottom lip), masked so it fades to zero before the edges.

**Dividers.** `.vg-rule-h`, ramping in by 18% and out from 76%. A section break
becomes a seam in one continuous surface instead of a cage edge.

**Tab underline.** `2px solid var(--vg-accent)` plus `0 0 12px var(--vg-accent)`
at 40%, so the active tab glows rather than being merely coloured.

**VP bar.** Fill `linear-gradient(90deg, color-mix(--vg-accent, black 35%),
var(--vg-accent))`, with a knob at the head carrying `.vg-knob`'s halo pulse.

**Avatar plate.** The 3px `#B44FFF` ring becomes `var(--vg-accent)`.
⚠ This is the avatar plate on the profile only, and it is a static border that
already exists. It does NOT reintroduce a rank ring: rank still appears only in
live chat and the stream entrance ribbon.

**Buttons, chips, links, "View All", pinned icon, sort links:** all
`var(--vg-accent)`.

### 3.4 The motion (one, and it earns its place)

`--vg-key-x` drifts `46% → 54% → 46%` over **24 seconds**, ease-in-out, infinite.

Because the entire look of Deep is one light source, moving that source moves
every highlight on the page at once: the field brightens across, card rims
shift, the accent bloom breathes. At 24 seconds it is below the threshold you
consciously notice, which is what makes a surface feel alive rather than
animated.

Cost: one animated custom property. No content repaint, no JS, no asset.
`@media (prefers-reduced-motion: reduce)` pins it to 50%.

### 3.5 What Deep deliberately does NOT do

No stars, no particles, no blur, no glassmorphism, no gradient text. Deep is the
floor of the ladder and its job is to be **quietly expensive**. Every mechanism
it declines is one the themes above it can spend.

---

## 4. The escalation ladder (concepts only, each gets this treatment in turn)

Each rung adds a **mechanism**, not more colour. That is what makes them escalate
rather than just differ.

| Theme | L | The mechanism it adds |
|---|---|---|
| Deep | 6 | one key light + drifting source; rim-lit surfaces; accent as sole chroma |
| Grain | 16 | material tooth; warm key; cards gain a milled edge |
| Beam | 27 | a travelling shaft that crosses the identity block on a cycle |
| Carved | 38 | the page structure is cut into the surface, not laid on it |
| Aurora | 52 | multiple coloured sources; ribbons that respond to scroll position |
| Eclipse | 66 | a corona behind the avatar; chromatic rim on every lit edge |
| Nebula | 84 | parallax depth field; accent-tinted clouds; bloom on all lit edges |

Standard (L1) stays as the honest baseline: the contract with the light turned
down, so an unequipped profile is calm rather than broken.

---

## 5. Build order for Deep

1. **Unify the accent.** `cosmetics.accent` writes `users.accentColor`. Six
   existing consumers on the public profile light up immediately.
2. **Theme contract.** `src/utils/profileThemes.js` returns tokens, not a
   background string. `Standard` and `Deep` implemented; the other six keep their
   current background as a stopgap so nothing regresses.
3. **Import `surface.css`** into both profile screens.
4. **Own profile:** replace the 14 hardcoded purples with `var(--vg-accent)`.
5. **Card primitive.** One `<ThemedCard>`, top-rim only, replacing the inline
   `#14141F` + 4-sided border in both screens and `OwnerRightPanel`.
6. **Stat rail recess.**
7. **Motion.**
8. **Render headless at 1440 and 390 before deploying.** Non-negotiable: three
   consecutive versions of this shipped unrendered and all three were wrong.

Estimated surface touched: `profileThemes.js`, `ProfileScreen.jsx`,
`PublicProfileScreen.jsx`, `CosmeticEquip.jsx`, `surface.css`, plus one new
card component.

---

## 6. Open decision for the founder

**Does the accent apply to the whole app or only the profile?** The tokens make
app-wide trivial, but the brand rule ([[project-brand-no-cyan]], violet/pink/gold
only) exists for a reason, and a user picking Mint would tint surfaces well
outside their own profile. Recommendation: **profile page only**, so a personal
choice stays personal and Vergr's own chrome stays on-brand.
