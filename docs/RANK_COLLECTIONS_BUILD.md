# Rank collections: the build plan

Status: **PLAN. Nothing built.** Every collection gets a local preview and
founder sign-off before it is deployed.

Supersedes the "profile themes" framing in `PROFILE_THEMES_LADDER.md`. That
document's seven-axis design work is still valid and becomes the *visual
language* of each collection; this document is the architecture and the code.

---

## 1. Why this is a collection and not a theme

A profile theme is a reward on the page a user visits least. Nobody grinds 100
levels for something only they see.

What the platforms that make this work actually ship:

- **Discord** sells a *collection*: avatar decoration + profile effect +
  **nameplate**. The nameplate sits behind the username in the member list and
  in DMs, so it is seen constantly. The profile effect is the capstone, not the
  product.
- **Twitch** sub badges render **on every message you type**. Tiny surface,
  maximum frequency, escalating with tenure.

The mechanism is the same in both: a cosmetic works when it is **visual proof of
dedication that other people repeatedly encounter**. Someone sees it, does not
have it, and now wants it.

So a Vergr collection is one visual family expressed on three surfaces, ordered
by how often OTHERS see them:

| Surface | Frequency | Renders |
|---|---|---|
| **Chat nameplate** | every message, whole room | 100s per stream |
| **Entrance ribbon** | every room you join | 1 at a time |
| **Profile theme** | when someone opens your profile | 1 |

⚠ This lands exactly inside the founder ruling (rank shows in **live chat** and
the **stream entrance**, nowhere else). Chat nameplate and entrance ribbon *are*
those two surfaces. Nothing new is exposed.

---

## 2. The performance rule that decides every technique

**A nameplate renders hundreds of times per stream. A theme renders once.**
They therefore cannot use the same technique, and this is the single most
important constraint in the build:

| Tier | Size | Instances | Allowed |
|---|---|---|---|
| **Nameplate** | ~28px tall | 100s | **Pure CSS only.** One shared background-image tile. **Zero filters, zero canvas, zero blend modes.** |
| **Ribbon** | 280x70 | 1 | CSS + at most **one** SVG filter, + framer-motion |
| **Theme** | full page | 1 | Anything: canvas, WebGL, SVG filter chains |

Getting this wrong is how a chat panel drops frames. An `feDiffuseLighting`
filter on 200 chat rows is a guaranteed jank; the same filter once on a profile
is free.

**Consequence:** each collection expresses its material three times at three
fidelities. Grain's paper is a real lit height-map on the profile, a single
static filter on the ribbon, and a two-layer CSS gradient plus one shared noise
tile in chat. Same family, three budgets.

---

## 3. The contract

New file `src/utils/rankCollections.js`. Pure data + pure functions, derived from
`vpLevel`, which the relay already stamps on every message (`Msg.VpLevel`, see
`infra/chat/src/main.go`). **Zero reads, zero callables.**

```js
// src/utils/rankCollections.js
import { PROFILE_ACCENTS } from './rankUnlocks';

/** One shared noise tile for EVERY nameplate on screen. The browser decodes it
 *  once and reuses it, so 200 chat rows cost one image.
 *  ⚠ Single-quoted url() with %22 inside: a double-quoted url() silently kills
 *  the whole `background` shorthand wherever the CSS lands in a style attribute.
 *  That cost an afternoon on the profile themes. */
export const NOISE_TILE = (a = 0.06) =>
  "url('data:image/svg+xml," +
  "%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%2264%22 height=%2264%22%3E" +
  "%3Cfilter id=%22n%22%3E%3CfeTurbulence type=%22fractalNoise%22 baseFrequency=%221.1%22 " +
  "numOctaves=%223%22 stitchTiles=%22stitch%22/%3E%3C/filter%3E" +
  "%3Crect width=%22100%25%22 height=%22100%25%22 filter=%22url(%23n)%22 opacity=%22" + a +
  "%22/%3E%3C/svg%3E')";

const hexA = (hex, alpha) => {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
};

/** Collections in ladder order. `min` is the level that unlocks it. */
export const COLLECTIONS = [
  { id: 'standard', min: 1,  name: 'Standard' },
  { id: 'deep',     min: 6,  name: 'Deep'     },
  { id: 'grain',    min: 16, name: 'Grain'    },
  { id: 'beam',     min: 27, name: 'Beam'     },
  { id: 'carved',   min: 38, name: 'Carved'   },
  { id: 'aurora',   min: 52, name: 'Aurora'   },
  { id: 'eclipse',  min: 66, name: 'Eclipse'  },
  { id: 'nebula',   min: 84, name: 'Nebula'   },
];

export const collectionById = (id) =>
  COLLECTIONS.find((c) => c.id === id) || COLLECTIONS[0];

export const unlockedCollections = (level = 1) =>
  COLLECTIONS.filter((c) => level >= c.min);

export const accentHex = (id) =>
  PROFILE_ACCENTS.find((a) => a.id === id)?.color || '#B44FFF';

/** NAMEPLATE. Pure CSS, no filters. Returns a style object for the chat row.
 *  Called once per message render, so it must stay allocation-light and must
 *  never build a filter, a canvas, or a blend mode. */
export const nameplateStyle = (collectionId, accent) => {
  const fn = NAMEPLATES[collectionId];
  return fn ? fn(accent || '#B44FFF') : null;
};

export const NAMEPLATES = {
  standard: () => null,   // no plate below L6: the ladder has to start somewhere

  // DEEP — wet, lit from above. Top edge catches, bottom falls to nothing.
  deep: (a) => ({
    background:
      `linear-gradient(180deg, rgba(150,180,255,0.10) 0%, rgba(8,10,18,0.55) 70%),` +
      `linear-gradient(90deg, ${hexA(a, 0.20)} 0%, transparent 46%)`,
    boxShadow: `inset 0 1px 0 rgba(190,210,255,0.22), inset 2px 0 0 ${hexA(a, 0.85)}`,
    borderRadius: 8,
  }),

  // GRAIN — printed stock. Pressed in, not lit. Tooth from the shared tile.
  grain: (a) => ({
    background:
      NOISE_TILE(0.07) + `,` +
      `linear-gradient(180deg, rgba(255,240,214,0.055) 0%, rgba(12,10,9,0.30) 100%)`,
    backgroundSize: '64px 64px, auto',
    boxShadow:
      `inset 0 1px 0 rgba(0,0,0,0.55),` +          // pressed upper edge
      `inset 0 -1px 0 rgba(255,235,200,0.07),` +   // catching lower lip
      `inset 3px 0 0 ${a}`,                        // ink rule, matte, full strength
    borderRadius: 3,                                // print has square corners
  }),

  // BEAM — a shaft crosses the plate. Hard-edged, brightest off-centre.
  beam: (a) => ({
    background:
      `linear-gradient(101deg, transparent 18%, ${hexA(a, 0.34)} 34%, ` +
      `rgba(255,255,255,0.16) 41%, ${hexA(a, 0.20)} 48%, transparent 66%),` +
      `linear-gradient(180deg, rgba(10,7,20,0.55), rgba(6,4,12,0.75))`,
    boxShadow: `inset 0 0 0 1px ${hexA(a, 0.18)}`,
    borderRadius: 8,
  }),

  // CARVED — routed into the block. Chamfer catches on one side only.
  carved: (a) => ({
    background: `linear-gradient(180deg, rgba(0,0,0,0.42) 0%, rgba(255,255,255,0.025) 100%)`,
    boxShadow:
      `inset 0 2px 3px -1px rgba(0,0,0,0.9),` +     // dark upper wall
      `inset 0 -1px 0 rgba(255,255,255,0.10),` +    // lit lower lip
      `inset -1px 0 0 ${hexA(a, 0.55)}`,            // anodised channel
      borderRadius: 5,
  }),

  // AURORA — frosted glass with colour behind it.
  aurora: (a) => ({
    background:
      `linear-gradient(100deg, ${hexA(a, 0.26)} 0%, rgba(61,150,255,0.16) 42%, ` +
      `rgba(180,79,255,0.20) 76%, transparent 100%),` +
      `linear-gradient(180deg, rgba(255,255,255,0.055), rgba(255,255,255,0.015))`,
    boxShadow: `inset 0 1px 0 rgba(255,255,255,0.20)`,
    borderRadius: 10,
  }),

  // ECLIPSE — near-black with one hot rim on the leading edge.
  eclipse: (a) => ({
    background: `linear-gradient(90deg, ${hexA(a, 0.30)} 0%, rgba(0,0,0,0.72) 18%, rgba(0,0,0,0.82) 100%)`,
    boxShadow: `inset 3px 0 6px -2px ${a}, inset 0 0 0 1px rgba(255,255,255,0.05)`,
    borderRadius: 8,
  }),

  // NEBULA — depth. Two cloud stops plus a hot core, tinted by the accent.
  nebula: (a) => ({
    background:
      NOISE_TILE(0.05) + `,` +
      `radial-gradient(60% 200% at 18% 50%, ${hexA(a, 0.42)} 0%, transparent 60%),` +
      `radial-gradient(50% 180% at 72% 50%, rgba(61,127,255,0.26) 0%, transparent 62%),` +
      `linear-gradient(180deg, rgba(10,4,22,0.70), rgba(4,2,10,0.85))`,
    backgroundSize: '64px 64px, auto, auto, auto',
    boxShadow: `inset 0 0 0 1px ${hexA(a, 0.20)}`,
    borderRadius: 10,
  }),
};
```

### Where the nameplate attaches (exact, from the real markup)

`src/components/streams/ChatPanel.jsx`, `ChatRow`, the `motion.div` at ~line 675.
It already computes a `background`; the plate composes with it:

```jsx
// BEFORE (line ~684)
background: isTip
  ? (overlay ? 'rgba(120,80,0,0.55)' : 'rgba(240,165,0,0.10)')
  : (m.flagged ? (...) : (overlay ? 'rgba(0,0,0,0.38)' : 'transparent')),

// AFTER — tip and flagged still win, because those are STATE and state
// outranks identity. A nameplate never hides a moderation signal.
...(isTip || m.flagged
  ? { background: isTip ? (overlay ? 'rgba(120,80,0,0.55)' : 'rgba(240,165,0,0.10)')
                        : (overlay ? 'rgba(120,30,30,0.55)' : 'rgba(239,68,68,0.08)') }
  : (plate || { background: overlay ? 'rgba(0,0,0,0.38)' : 'transparent' })),
```

with, at the top of `ChatRow`:

```jsx
// Derived from the vpLevel the relay already puts on the message. No lookup.
const plate = useMemo(
  () => nameplateStyle(collectionForLevel(vpLevel), m.accent),
  [vpLevel, m.accent],
);
```

**One relay change required.** `m.accent` is not on the wire yet. Add it exactly
as `VpLevel` was added, in the profile the relay ALREADY loads once per
connection (`infra/chat/src/main.go`, `loadUserProfile`):

```go
// Accent id, denormalised onto the user doc. Read from the doc we are ALREADY
// fetching, so the nameplate costs no extra Firestore read: one read per
// connection, not per message.
if c, ok := d["cosmetics"].(map[string]interface{}); ok {
    if s, ok := c["accent"].(string); ok { up.Accent = s }
    if s, ok := c["collection"].(string); ok { up.Collection = s }
}
```

```go
// Msg struct
Accent     string `json:"accent,omitempty"`     // equipped accent id
Collection string `json:"collection,omitempty"` // equipped collection id
```

⚠ Send the **equipped** collection, not one derived from level, or a user who
unlocked Nebula but prefers Grain would be shown wrong. Server still clamps:
`if levelFor(collection) > up.VpLevel { collection = "" }`.

---

## 4. GRAIN in full

The first build, because it is the strongest disproof of "these are all the same
theme": it has **no emissive light anywhere** and changes the typography.

### 4.1 Nameplate

Code above. Two gradients + the shared tile + three inset shadows. No filter.
Renders identically at 200 rows.

### 4.2 Ribbon (entrance)

Reuses `JoinAnnouncer`'s geometry exactly (`w`, `h`, `avatarD`, `avatarCx`,
`textLeft`, the length-adaptive `nameScale` at lines ~130-140 — all measured and
all correct). Grain changes only the material:

```jsx
// Replaces the "Clipped art plate" block (~line 168) when collection==='grain'.
// ONE filter, rendered once. The deckle edge is a mask, not an image.
<svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden>
  <filter id="vg-grain-stock" x="0" y="0" width="100%" height="100%">
    <feTurbulence type="fractalNoise" baseFrequency="0.62" numOctaves="4"
                  seed="7" result="tex" />
    {/* the noise becomes a HEIGHT MAP and the lighting pass shades it:
        this is what makes it read as fibre you could feel rather than
        grey speckle laid on top */}
    <feDiffuseLighting in="tex" surfaceScale="1.6" diffuseConstant="1.05"
                       lightingColor="#F6EBD6" result="lit">
      <feDistantLight azimuth="135" elevation="58" />
    </feDiffuseLighting>
    <feComposite in="lit" in2="SourceGraphic" operator="arithmetic"
                 k1="1" k2="0" k3="0" k4="0" />
  </filter>
</svg>

<div style={{
  position: 'absolute', inset: 0, borderRadius: 2, overflow: 'hidden',
  background: '#141110',
  filter: 'url(#vg-grain-stock)',
  // deckle: a torn right edge instead of a clean cut
  WebkitMaskImage: DECKLE_MASK, maskImage: DECKLE_MASK,
}} />
```

Name is **ink**, so it drops the gradient fill that every other rank uses:

```jsx
// Grain overrides nameGradient. Ink does not have a highlight.
const nameFill = collection === 'grain'
  ? { color: accent, WebkitTextFillColor: accent, textShadow: 'none' }
  : { backgroundImage: nameGradient, WebkitBackgroundClip: 'text',
      WebkitTextFillColor: 'transparent' };
```

Entrance motion override (Grain prints, it does not fly in):

```jsx
// framer-motion variant swap. `spring.bouncy` is wrong for paper.
const grainEnter = {
  initial: { opacity: 0, clipPath: 'inset(0 100% 0 0)' },
  animate: { opacity: 1, clipPath: 'inset(0 0% 0 0)' },
  transition: { duration: 0.62, ease: [0.22, 0.61, 0.36, 1] },
};
```

### 4.3 Theme (profile)

Full technique. One filter on the header, plus real relief on every surface.

```jsx
// src/components/profile/themes/GrainTheme.jsx
// Rendered ONCE. The filter is the whole theme, so it is allowed to be real.
export const GrainDefs = () => (
  <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden>
    {/* the stock */}
    <filter id="vg-grain-paper">
      <feTurbulence type="fractalNoise" baseFrequency="0.5" numOctaves="5"
                    seed="3" result="tex" />
      <feDiffuseLighting in="tex" surfaceScale="2.1" diffuseConstant="1.0"
                         lightingColor="#F3E7D2" result="lit">
        {/* the ONE lamp every edge in this theme obeys.
            --vg-grain-az eases 130 -> 140 -> 130 over 40s: the relief shifts
            and the paper breathes without anything moving. */}
        <feDistantLight azimuth="135" elevation="55" />
      </feDiffuseLighting>
      <feComposite in="lit" in2="SourceGraphic" operator="arithmetic"
                   k1="1.05" k2="0" k3="0" k4="-0.06" />
    </filter>

    {/* the press: every panel is stamped INTO the stock */}
    <filter id="vg-grain-deboss" x="-6%" y="-6%" width="112%" height="112%">
      <feOffset in="SourceAlpha" dx="0" dy="1" result="d" />
      <feGaussianBlur in="d" stdDeviation="1" result="db" />
      <feComposite in="SourceAlpha" in2="db" operator="out" result="wall" />
      <feFlood floodColor="#000" floodOpacity="0.62" result="ink" />
      <feComposite in="ink" in2="wall" operator="in" result="topWall" />
      <feOffset in="SourceAlpha" dx="0" dy="-1" result="u" />
      <feGaussianBlur in="u" stdDeviation="1" result="ub" />
      <feComposite in="SourceAlpha" in2="ub" operator="out" result="lipMask" />
      <feFlood floodColor="#FFEFD8" floodOpacity="0.14" result="lipCol" />
      <feComposite in="lipCol" in2="lipMask" operator="in" result="lip" />
      <feMerge>
        <feMergeNode in="SourceGraphic" />
        <feMergeNode in="topWall" />
        <feMergeNode in="lip" />
      </feMerge>
    </filter>
  </svg>
);
```

```css
/* surface.css additions, scoped so they cannot leak */
.vg-profile[data-collection='grain'] {
  --vg-field: #0C0B0A;
  --vg-ink: var(--vg-accent);
  background: #0C0B0A;
}
/* the header is the only element carrying the paper filter: one composite */
.vg-profile[data-collection='grain'] .vg-grain-stock { filter: url(#vg-grain-paper); }

/* panels are PRESSED IN. No rim light: this theme has no emissive light. */
.vg-profile[data-collection='grain'] .vg-card {
  background: rgba(255,240,214,0.028);
  border: 0;
  border-radius: 3px;
  box-shadow: inset 0 1px 0 rgba(0,0,0,0.55), inset 0 -1px 0 rgba(255,235,200,0.06);
}
.vg-profile[data-collection='grain'] .vg-card::before { content: none; }  /* kill Deep's rim */

/* type: editorial. The theme's loudest voice, and the axis the first plan missed. */
.vg-profile[data-collection='grain'] .vg-name {
  font-family: Syne, sans-serif; font-weight: 800;
  font-size: clamp(28px, 4vw, 44px); letter-spacing: -0.02em; line-height: 0.95;
}
.vg-profile[data-collection='grain'] .vg-label {
  font-size: 10px; letter-spacing: 0.18em; text-transform: uppercase;
  color: rgba(255,240,214,0.45);
}

/* the light angle breathes. One property, no repaint of content. */
@property --vg-grain-az { syntax: '<number>'; inherits: true; initial-value: 135; }
@keyframes vg-grain-breathe { 0%,100% { --vg-grain-az: 130 } 50% { --vg-grain-az: 141 } }
.vg-profile[data-collection='grain'] { animation: vg-grain-breathe 40s ease-in-out infinite; }
@media (prefers-reduced-motion: reduce) {
  .vg-profile[data-collection='grain'] { animation: none; }
}
```

⚠ **`feDistantLight azimuth` is not animatable from CSS.** The `@property`
above drives a *paired* CSS lighting fallback; the true azimuth ease needs a
2-line rAF writing the SVG attribute:

```js
// GrainTheme.jsx — 40s ease on ONE attribute. Pauses off-screen and when hidden.
useEffect(() => {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const el = document.querySelector('#vg-grain-paper feDistantLight');
  if (!el) return;
  let raf = 0, t0 = performance.now(), on = true;
  const vis = () => { on = !document.hidden; if (on) { t0 = performance.now() - 0; raf = requestAnimationFrame(tick); } };
  const tick = (t) => {
    if (!on) return;
    el.setAttribute('azimuth', String(135 + 5.5 * Math.sin(((t - t0) / 40000) * Math.PI * 2)));
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
  document.addEventListener('visibilitychange', vis);
  return () => { cancelAnimationFrame(raf); document.removeEventListener('visibilitychange', vis); };
}, []);
```

### 4.4 Grain's banner behaviour

The paper's relief multiplies **over** the user's art (colours untouched) and the
banner ends on a deckle edge rather than a straight cut:

```jsx
<div className="absolute inset-0" style={{
  filter: 'url(#vg-grain-paper)', mixBlendMode: 'overlay', opacity: 0.55,
  WebkitMaskImage: DECKLE_MASK, maskImage: DECKLE_MASK,
}} />
```

### 4.5 Grain's accent response

Cyan ink on warm stock reads sickly, so cool accents desaturate ~15%. Data, not
a special case:

```js
grain: { hueResponse: (hex) => desaturateCool(hex, 0.15) },
```

---

## 5. The remaining five: technique kernels

Boilerplate (mount, pause, DPR, fallback) is shared. What differs is the kernel,
which is the only genuinely hard part, so that is what is specified.

### BEAM (L27) — additive shafts + dust
```css
/* the bloom SUMS with what is behind it. A semi-transparent blur averages and
   reads as smudge; this is the creator-studio lesson. */
.vg-beam-layer { mix-blend-mode: plus-lighter; }   /* screen = fallback */
```
Shafts are `mask-image` wedges over that layer; dust is one `feTurbulence`
displacement drifting perpendicular. Cards gain `box-shadow` in the shaft
direction so they cast.

### CARVED (L38) — real specular, moving light
```jsx
<feSpecularLighting surfaceScale="3" specularConstant="0.9"
                    specularExponent="28" lightingColor="#DCE6FF">
  <fePointLight x={lx} y={ly} z="42" />   {/* lx,ly eased on a slow arc */}
</feSpecularLighting>
```
`specularExponent` is how hard the metal reads. The lamp biases toward the
cursor on hover, which is why it feels physical rather than animated.

### AURORA (L52) — curl-noise flow field on canvas
```js
// divergence-free field: ribbons fold instead of spraying
const curl = (x, y, t) => {
  const e = 0.6;
  const n = (a, b) => noise2(a * 0.0016, b * 0.0016 + t * 0.00004);
  return [ (n(x, y + e) - n(x, y - e)) / (2 * e),
          -(n(x + e, y) - n(x - e, y)) / (2 * e) ];
};
// scroll velocity biases the field, so a fling makes the curtains surge
field.bias = clamp(scrollVel * 0.0012, -1.4, 1.4);
```
Drawn as long low-alpha strokes with `globalCompositeOperation='lighter'`.
Surfaces use `backdrop-filter: blur(14px)` so ribbons pass behind them.

### ECLIPSE (L66) — fragment shader
```glsl
// domain-warped corona: filaments, not a uniform ring
float fbm(vec2 p){ float v=0., a=.5; for(int i=0;i<5;i++){ v+=a*noise(p); p*=2.03; a*=.5; } return v; }
vec2  warp = vec2(fbm(p*3.+t*.05), fbm(p*3.+7.+t*.04));
float r    = length(p + warp*.06);
float rim  = smoothstep(R, R+.004, r) * exp(-(r-R)*26.);
// lensing: the field bends near the disc
vec2  luv  = uv + normalize(p) * (-.018 / max(r*r, .02));
// chromatic aberration on the limb
col = vec3(tex(luv*1.004).r, tex(luv).g, tex(luv*0.996).b) + rim*coronaRamp(accent);
```

### NEBULA (L84) — raymarched volume, correct occlusion
```glsl
// 24 fixed steps. Front-to-back accumulation is what gives real occlusion,
// which is the effect that cannot be faked and the reason this is L84.
vec4 acc = vec4(0.);
for (int i = 0; i < 24; i++) {
  vec3  p   = ro + rd * (float(i) * 0.09);
  float d   = fbm3(p * 1.7 + vec3(0., 0., t * 0.02));
  float den = smoothstep(0.52, 0.78, d) * 0.16;
  vec3  c   = mix(accentA, accentB, d) + hotCore(p) ;
  acc.rgb  += (1. - acc.a) * c * den;
  acc.a    += (1. - acc.a) * den;
  if (acc.a > 0.97) break;               // early out, keeps the budget
}
```
Cards are drawn at a z between cloud layers so nearer wisps pass in front.

---

## 6. Engineering budget (enforced, not aspirational)

```js
// shared by every animated collection
const useThemeLoop = (draw, ref) => {
  useEffect(() => {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;   // static frame
    let raf = 0, vis = true, io;
    const loop = (t) => { if (vis) draw(t); raf = requestAnimationFrame(loop); };
    io = new IntersectionObserver(([e]) => { vis = e.isIntersecting; }, { threshold: 0 });
    if (ref.current) io.observe(ref.current);
    const onVis = () => { vis = !document.hidden; };
    document.addEventListener('visibilitychange', onVis);
    raf = requestAnimationFrame(loop);
    return () => { cancelAnimationFrame(raf); io?.disconnect();
                   document.removeEventListener('visibilitychange', onVis); };
  }, [draw, ref]);
};
```

- DPR capped at 2 (1.5 for Nebula); canvas sized to the **header box**, never the page
- Static poster fallback if WebGL is absent or frame 1 blows budget
- **4ms frame budget, measured** on a mid-range phone, not assumed
- Entrance plays **once per session**, not per navigation
- **Nameplates never animate.** 200 animating rows is not a design, it is a bug
- Zero network cost. Two desktop-only WebP normal maps total (Grain, Carved)

---

## 7. Verification harness (so we do not repeat the Deep afternoon)

The Deep work took an afternoon because three versions shipped unrendered and a
fourth shipped with a `url("...")` that silently voided its own `background`.
That is preventable and this is how:

```bash
# 1. render every collection at all THREE scales into one sheet
node scripts/theme-preview.mjs            # writes preview.html from the real modules
chrome --headless=new --force-device-scale-factor=2 \
       --window-size=1600,2400 --screenshot=out.png file:///.../preview.html
```

The harness imports the **real** `rankCollections.js`, so a preview cannot drift
from what ships. It renders each collection as: 6 stacked chat rows, one ribbon,
one full profile header. Any collection that looks wrong at nameplate scale is
caught before a line of theme code is written.

```js
// 2. assert every declared background actually parsed. This is the exact
//    failure that cost the afternoon: an invalid url() drops the WHOLE
//    shorthand and the element silently renders its parent's colour.
document.querySelectorAll('[data-plate]').forEach((el) => {
  const bg = getComputedStyle(el).backgroundImage;
  if (bg === 'none') throw new Error(`nameplate ${el.dataset.plate} produced no background`);
});
```

Run both before any deploy. Founder sees the sheet, not the live site.

---

## 8. Order

1. **Grain**, all three scales, local preview. It deletes glow and changes type,
   so if it still reads as Deep-with-a-filter the ladder is wrong and should be
   cut to two or three collections rather than eight mediocre ones.
2. **Carved** — the other structural opposite (nothing floats, all specular).
3. Beam, Aurora, Eclipse, Nebula.
4. **Deep's second pass**: its light moves into an SVG lighting filter, and it
   gains the type treatment, entrance and banner behaviour the other seven have.

Nothing deploys without the sheet and a founder yes.
