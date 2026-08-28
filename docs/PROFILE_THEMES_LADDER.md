# Profile theme ladder: the complete spec

Status: **PLAN ONLY.** Nothing built. Each theme gets a local preview for
founder approval before any of it is deployed.

Companion to `docs/PROFILE_THEMES_DESIGN.md` (the token contract + Deep).

---

## 0. The bar, taken from this codebase and not invented

**`DesktopUpdateGate.jsx`** — rAF canvas particle mesh: 42 nodes, DPR-aware with
a `ResizeObserver`, distance-linked edges whose alpha falls with distance,
per-node `shadowBlur`, over three blurred orbs on independent 17s / 21s / 26s
cycles (one reversed), a scan band at 8.5s, a vignette, a 1px top highlight.

**Creator studio earnings** — SVG filter work: `pathLength=100` so bevel strokes
at different radii align angularly for free; a three-pass additive bloom
(σ 1.1 / 3.6 / 9 at .42 / .34 / .22) on its own `plus-lighter` layer *under* the
sharp blocks; deboss from offset-alpha inner shadows; a recess that fades to zero
before it reaches an edge. Founder art at `/brand/earnings/tier-vault.webp`
(1x 25KB + @2x 61KB) served via `<picture>` with a `min-width:1024px` media
source so phones never fetch it, plus a 370-byte inlined LQIP.

**Deep (L6), already built, is layered CSS gradients** — the cheapest of the
three techniques in this repo, and the reason it reads thin. It gets a second
pass (§11).

---

## 1. Seven axes, not one

The first draft of this plan varied **light only**, which is why it was not
finished. A theme owns all seven of these:

1. **Render technique** — the mechanism drawing it
2. **Light rule** — direction and quality, which every surface then obeys
3. **Surface rule** — what a card *is* in this material
4. **Type + layout** — a theme that shares L6's typography is under-designed
5. **Accent role** — what the user's colour physically *is* here
6. **Identity marker** — how the avatar carries identity (never a static ring)
7. **Banner behaviour** — how the theme treats art the user uploaded

Plus, per theme: **entrance choreography**, **ambient motion**, **interaction
response**, **assets**, **performance tier**.

### The two rules that never bend

**Identity is never a static concentric stroke.** A ring means state (live,
unseen status). Every theme expresses identity on the avatar in its OWN
material, but never as a still ring. Deep uses a travelling light; Grain uses a
pressed impression; Carved uses a machined bezel. Different forms, same rule.

**The uploaded banner is never recoloured.** Each theme may *treat* it (mask it,
recess it, refract it), but the art's own colours stay the user's.

---

## 2. Technique ladder at a glance

| L | Theme | Render technique | Glow | Cards | Layout shift |
|---|---|---|---|---|---|
| 6 | Deep | layered CSS + Houdini `@property` | soft | float | baseline |
| 16 | **Grain** | SVG `feDiffuseLighting` on turbulence | **none** | **pressed in** | editorial |
| 27 | **Beam** | CSS mask + `plus-lighter` additive | hard-edged | float, cast shadows | cinematic |
| 38 | **Carved** | SVG `feSpecularLighting`, moving source | specular only | **routed cavities** | instrument panel |
| 52 | **Aurora** | canvas curl-noise flow field | translucent | **frosted panes** | floating |
| 66 | **Eclipse** | WebGL fragment shader | extreme | silhouette rims | centred, sparse |
| 84 | **Nebula** | WebGL volumetric + parallax | additive | **float in depth** | spatial |

**Proof this is not palette-swapping:** Grain has no emissive light and no
floating elements; Carved has no floating elements either but is *all* specular;
Aurora's surfaces are transparent; Nebula's cards are occluded by foreground
clouds. Each deletes a mechanic the others depend on.

---

## 3. GRAIN — L16 — *print, not light*

**Idea.** The page is not lit, it is **printed**. Ink pressed into stock. Zero
emissive light anywhere, which is what makes it read as expensive beside seven
glowing themes: it is the only one that behaves like a physical object.

**Technique.** `feTurbulence` (fractalNoise, low frequency) → `feDiffuseLighting`
with `feDistantLight` → composite. The noise becomes a **height map** and the
lighting pass shades it, producing real relief rather than stacked noise.

**Light rule.** One distant lamp, fixed azimuth ~135°. Hard, matte, no falloff
bloom. Every edge in the theme obeys that one angle.

**Surface rule.** Nothing floats. Panels are **debossed into the stock**: pressed
edge dark on the lit side, catching on the other, using the creator studio's
inner-shadow carve construction.

**Type + layout.** The theme's loudest voice. Editorial: a large tight display
face for the name, generous leading, a genuine baseline grid, and section labels
in small caps with wide tracking. The stat block becomes a **printed masthead**
rather than a rail. This is the only rung where type does the heavy lifting.

**Accent role.** **Ink.** Saturated, matte, zero glow. Rules, the VP bar as a
printed band, and one oversized tinted display numeral set behind the stat block
letterpress-style.

**Identity marker.** A **pressed impression** around the avatar — a debossed
ring in the stock catching the same lamp, with the accent as ink in the groove.
Static, but it is *relief*, not a stroke, so it never reads as a state ring.

**Banner behaviour.** The banner is **printed onto the stock**: the paper's
relief multiplies over it so the art picks up tooth, and it ends on a torn deckle
edge rather than a straight cut. Colours untouched.

**Entrance.** The page **prints**: a single pass sweeps top to bottom over ~600ms,
ink resolving from nothing as it passes. One gesture, no bounce.

**Ambient motion.** Almost none, deliberately, and that is the flex. The light
**angle** eases a few degrees over ~40s so the relief shifts and the paper
breathes without anything moving.

**Interaction.** A card presses **deeper** on hover, its shadow tightening. No
lift, no glow, no colour change.

**Assets.** A real scanned-paper normal map beats `feTurbulence` here. One WebP
(~30KB, @2x for desktop only, LQIP inline) using the tier-vault delivery pattern.
Falls back to pure `feTurbulence` if it fails to load.

**Perf.** Static after entrance. Filter is composited once. Safe everywhere.

---

## 4. BEAM — L27 — *projection, with something in the air*

**Idea.** Light from **behind the viewer**, not above. Shafts become hard-edged
and volumetric, and content **casts shadows onto the field**.

**Technique.** `mask-image` cuts the shaft geometry over an **additive
`plus-lighter` bloom layer** (emission SUMS rather than averaging into smudge),
with `feTurbulence` displacement for dust.

**Light rule.** Directional and hard, ~101°, from behind camera. Objects occlude
it and throw shadows.

**Surface rule.** Cards float and **cast a shadow in the shaft direction** — lit
objects, not surfaces. Edges facing a shaft get a hot rim.

**Type + layout.** Cinematic. Wider margins, larger name, the identity block
positioned so a shaft crosses it. Content sits lower with more air above,
letterboxed feel.

**Accent role.** The beam colour. The whole room takes the user's colour, so this
is the most saturated rung on the ladder.

**Identity marker.** The avatar sits **in a shaft**, catching an anamorphic
streak that flares as the beam crosses it. Motion + occlusion, not a stroke.

**Banner behaviour.** Shafts pass **in front of** the banner, and the banner
occludes the dust behind it. The art is a lit object in the room.

**Entrance.** Projector strike: one blown-out flash, then the shafts settle to
level over ~700ms as the dust catches up.

**Ambient motion.** Two desynchronised shaft cycles; dust drifting perpendicular
and brightening inside beams; the anamorphic flare on crossing.

**Interaction.** Hover brightens the card's shaft-facing rim and lengthens its
cast shadow.

**Assets.** None. Procedural genuinely wins for volumetric dust.

**Perf.** CSS + one filter. Mobile-safe.

---

## 5. CARVED — L38 — *milled from one block*

**Idea.** Not a page with panels on it. **One block of material with the
interface machined into it.** Nothing floats. Every edge is a chamfer.

**Technique.** `feSpecularLighting` with a **moving `fePointLight`** — real
lighting maths, so chamfers genuinely catch and lose a highlight as the lamp
travels, with `specularExponent` controlling how hard the metal reads.

**Light rule.** One point source travelling a slow arc *above the block*.
Everything responds simultaneously, because it is one lamp on one object.

**Surface rule.** **Routed cavities.** Floor slightly darker than the face,
chamfered walls, a crisp bright line where a chamfer faces the lamp. Zero
floating elements.

**Type + layout.** Instrument panel. Tight, technical, `DM Mono` for every
figure, labels engraved in small caps. Elements align to a visible machining
grid. Denser than any other rung.

**Accent role.** **Anodised**, living inside the chamfer channels, so colour
appears in cut edges rather than on faces. The most restrained accent on the
ladder, and the most convincing.

**Identity marker.** A **machined bezel** around the avatar — a countersunk
seat with a chamfered lip whose specular highlight sweeps as the lamp passes.
It moves because the light moves, not because it animates.

**Banner behaviour.** The banner is **inset into a routed pocket** with
chamfered walls that catch the specular. Art untouched; it just sits in a
milled recess.

**Entrance.** The panel is **cut**: cavities route open in sequence, tool-path
order, over ~900ms, chamfers catching light as each completes.

**Ambient motion.** The point light travels its arc; highlights sweep along
chamfers in sequence. The single most convincing "expensive" effect available,
because it is genuine specular response rather than an animated gradient.

**Interaction.** The lamp biases toward the cursor, so hovering brings a
highlight to that chamfer. Direct, physical, unmistakable.

**Assets.** A real brushed-metal normal map beats procedural anisotropy. One
WebP (~40KB, desktop @2x, LQIP), same delivery pattern.

**Perf.** SVG filter with a moving light: measure carefully. Likely reduced
`specularExponent` and a coarser filter region on mobile.

---

## 6. AURORA — L52 — *the page is translucent*

**Idea.** The first rung where surfaces stop being opaque. Light passes
**through** the interface, and the aurora **responds to how fast you scroll**.

**Technique.** Canvas 2D **curl-noise flow field** on rAF: particles advected
along a divergence-free noise field, drawn as long low-alpha ribbon strokes with
additive compositing. Scroll velocity biases the field.

**Light rule.** Multiple coloured sources, soft, from behind everything. Nothing
casts a shadow; things are silhouetted or lit through.

**Surface rule.** **Frosted panes.** `backdrop-filter` blur, so ribbons are
visible *through* the rail and the cards. A card's edge is a bright refraction
line, not a rim light.

**Type + layout.** Floating. Everything gains air; the identity block is not
anchored to the banner edge but drifts below it. Lighter weights, more letter
spacing, text sits on glass so it needs its own contrast floor.

**Accent role.** The **dominant curtain hue**, with two harmonics derived from
it, so the user's colour defines the whole sky rather than an ornament.

**Identity marker.** The avatar is a **pane the aurora passes behind**, with a
refraction ring where the glass edge bends the light. It shimmers because what's
behind it moves.

**Banner behaviour.** The banner sits **behind the glass**, so curtains pass in
front of it and it refracts slightly at the seam. Colours untouched, but it
participates in the atmosphere.

**Entrance.** Curtains **bloom** from the horizon upward over ~1s, and the glass
panes fade from fully transparent to frosted as they arrive.

**Ambient motion.** Continuous flow; scroll velocity surges the curtains and
they ease back to baseline after a fling.

**Interaction.** Hover ripples the flow field locally — a real disturbance in
the particle field, not a CSS transition.

**Assets.** None. Procedural is correct for a flow field.

**Perf.** Canvas capped to the header box, DPR ≤2, particle count halved on
mobile, paused off-screen.

---

## 7. ECLIPSE — L66 — *one occluded star*

**Idea.** Near-total darkness with one violently bright rim. The most aggressive
contrast on the ladder. Everything that is not the corona is silhouette.

**Technique.** **WebGL fragment shader.** Required: the corona needs turbulent
domain-warped noise around a disc, the field needs lensing distortion, and edges
need chromatic aberration. None is reachable in CSS or canvas 2D at cost.

**Light rule.** One source, occluded. Extreme dynamic range: near-black to
blown-out within a few pixels.

**Surface rule.** Cards are **defined only by their rim**. No fill, no shadow —
just where the corona catches an edge. The sparsest surface treatment here.

**Type + layout.** Centred and sparse. Fewer elements visible at once, the
identity block centred under the corona rather than left-aligned. Near-white type
on near-black. The layout that most changes the page's shape.

**Accent role.** The **corona's temperature ramp** — the user's colour sets
whether the star burns cold blue or hot amber.

**Identity marker.** The avatar **is** the occluding body. Its silhouette blocks
the star, and the corona burns around it. The most dramatic identity treatment on
the ladder, and structurally impossible to confuse with a ring because the light
is *behind* the avatar, not on it.

**Banner behaviour.** The banner is **silhouetted**: the shader renders it as a
dark occluding shape with corona light bleeding around its edges. This is the one
theme that meaningfully transforms the banner, so it needs a toggle if a user
wants their art readable.

**Entrance.** **Totality**: the page starts blown out, the disc slides across
over ~1.2s, and the corona resolves as it seats. Genuinely theatrical, once.

**Ambient motion.** Plasma turbulence continuously; occasional prominences arc
off the limb and fall back; a slow breath in intensity.

**Interaction.** Pointer position shifts the lensing slightly, so the field bends
around the cursor.

**Assets.** None. Procedural.

**Perf.** Shader with a hard step cap. Desktop full, mobile reduced octaves.
Static poster fallback if WebGL is absent.

---

## 8. NEBULA — L84 — *volume, with real depth*

**Idea.** Top of the ladder, and the only rung with genuine **z-depth**. The
interface floats *inside* a volume rather than in front of a picture.

**Technique.** **WebGL raymarched volumetric** (small fixed step count through 3D
noise) plus a multi-layer parallax star field. Clouds are volume, so their edges
are soft in a way no gradient reproduces, and they **occlude each other
correctly**.

**Light rule.** Emissive from within the volume. Hot cores bloom additively;
nothing is lit from outside.

**Surface rule.** Cards sit at a depth **between cloud layers**, so nearer wisps
pass in front of them. That is the effect that cannot be faked and is why this is
L84.

**Type + layout.** Spatial. Elements sit at different depths and parallax at
different rates, so the layout has real dimensionality. Type is the nearest layer
and stays crisp while everything behind it moves.

**Accent role.** The **cloud tint** — the volume itself is the user's colour.

**Identity marker.** The avatar floats at its own depth with wisps passing **in
front of** it, plus a soft volumetric halo behind. Occlusion is the marker,
which no other theme has.

**Banner behaviour.** The banner sits at a **depth plane**, with foreground
clouds drifting across it and a slight parallax offset from the content. Art
untouched; it gains position in space.

**Entrance.** You **arrive**: the volume rushes past as the camera settles over
~1.1s, stars streaking then slowing, clouds resolving from motion blur.

**Ambient motion.** Slow volumetric drift, twinkle, depth parallax on scroll and
pointer.

**Interaction.** Pointer parallax on desktop; hovering a card pushes it slightly
deeper so a wisp crosses in front.

**Assets.** None. Raymarching is procedural by nature.

**Perf.** The heaviest rung. Hard step cap, DPR ≤1.5, reduced octaves on mobile,
static poster fallback. If it cannot hold 4ms on a mid-range phone it ships
desktop-only and mobile gets Eclipse's treatment with Nebula's palette.

---

## 9. Accent compatibility

Not every accent suits every theme, and pretending otherwise ships bad
combinations. Each theme declares a **hue response**, not a whitelist:

- **Grain** desaturates cool accents ~15% (cyan ink on warm stock reads sickly)
  and keeps warm ones at full strength.
- **Carved** treats every accent as anodised, which naturally compresses toward
  metallic. No accent looks wrong; none looks loud.
- **Eclipse** maps accent to a corona *temperature*, so cool accents give a blue
  giant and warm ones a red one. All valid.
- **Aurora / Nebula** derive two harmonics from the accent rather than using it
  raw, so the sky is a palette rather than one colour.

The transform lives in `themeTokens()` beside the theme, so it is data.

---

## 10. Engineering budget

Non-negotiable for every animated theme:

- **Pause when not visible.** `IntersectionObserver` + `visibilitychange`. Zero
  rAF when hidden or when the header has scrolled away.
- **DPR capped at 2** (1.5 for Nebula); canvas sized to the header box, never
  the page.
- **`prefers-reduced-motion`** pins every theme to a static frame, entrance
  included.
- **Static poster fallback** if WebGL is unavailable or the first frame blows
  budget. Nobody sees a broken theme.
- **4ms frame budget, measured** on a mid-range phone. Miss it and the theme
  simplifies or ships desktop-only.
- **Entrance runs once per session**, not per navigation. A cinematic that
  replays every time you tap back becomes an obstacle.
- **Zero network cost.** Two small WebP normal maps total (Grain, Carved),
  desktop-only via `<picture>` media source, LQIP inline. No fetches, no reads.

---

## 11. Deep needs a second pass

Deep is layered CSS gradients and will look it beside Grain and Carved. It also
currently has no type treatment, no entrance, and no banner behaviour of its own,
because those axes did not exist when it was built. Its pass:

- key light moves into an SVG lighting filter for real falloff
- a type treatment (it should be the *quiet* one: restrained, wide, calm)
- entrance: the light **rises** from below over ~700ms
- banner: the seam gains a subtle caustic where the light meets the art

---

## 12. Order of work

**Grain first.** It is the strongest disproof of "these are all the same theme",
because it deletes glow entirely and changes the typography. If Grain does not
read as a completely different product surface from Deep, the ladder is wrong and
should be cut to two or three themes rather than eight mediocre ones.

Then **Carved** (the other structural opposite), then Beam, Aurora, Eclipse,
Nebula, then Deep's second pass.

Each: local preview → founder approval → build. No deploys before sign-off.
