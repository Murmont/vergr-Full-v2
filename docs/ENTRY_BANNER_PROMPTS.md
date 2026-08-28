# Entry banner background prompts, 11 ranks

Paste-ready image-generation prompts for the rank entry banners. Companion to
`docs/ENTRY_BANNER_ART_SPEC.md` (measurements, palettes, delivery) and
`docs/ENTRY_ANNOUNCEMENTS_SPEC.md` (behaviour, placement, security).

**Generate at 1536 x 384 (4:1), then downscale to 560x140 and 280x70.**

---

## How to use this file

Each rank has a self-contained prompt. Every one already carries the composition
rules, so you can paste a single block straight into ChatGPT with no setup.

**The three composition rules baked into every prompt, and why they exist:**
the app draws the avatar, the glowing ring and two lines of text *on top* of your
image at runtime. So the left 30% must stay near-black and empty (avatar sits
there), the middle must stay calm (the name and "to watch the LIVE" sit there),
and all the spectacle lives in the right 38%. Break those and the text becomes
unreadable, which is the one failure mode that makes it look cheap.

**Negative prompt for every generation** (append if the tool supports it):

```
no text, no letters, no words, no numbers, no logos, no watermark, no signature,
no UI elements, no borders, no frame, no people in the left half, nothing bright
on the left third, no busy detail in the centre
```

The escalation across the 11 is deliberate: **forged metal (1 to 4), crystal and
gem (5 to 7), elemental and mythic (8 to 9), cosmic and divine (10 to 11).**

---

## 1. ROOKIE — "Proving Ground"

Palette: ring `#9AA3B2`, name `#C7CEDA` to `#8E97A6`

```
Ultra-wide 4:1 cinematic banner background. A gritty underground proving ground at
first light: a scarred gunmetal steel bulkhead wall, cold blue-grey light raking
hard across it, rivets and deep scratches catching sharp specular highlights. In
the right third, a battered plain steel shield emblem stands edge-lit in the dark,
and behind it an angle grinder throws a violent arc of white-hot sparks that
scatter and trail off to the right edge. Volumetric dust hangs in the light beams.
Moody, high contrast, mostly darkness with a few brutal highlights. Colour palette
strictly cold steel: highlights #C7CEDA, mid steel #9AA3B2, deep charcoal base
#0E1014, no other hues. Photoreal 3D render, cinematic lighting, film grain.
The LEFT 30% of the frame must be near-black, empty, no detail. The CENTRE of the
frame must be a smooth dark gradient with no busy detail. All visual interest in
the RIGHT 38%. Keep the top and bottom 8% dark and quiet.
No text, no letters, no logos, no watermark, no people.
```

## 2. CONTENDER — "The Forge"

Palette: ring `#E08A3C`, name `#FFC489` to `#C46A22`

```
Ultra-wide 4:1 cinematic banner background. The inside of a blacksmith's forge at
night. On the right third, a stream of molten bronze pours from a crucible into
darkness, splashing incandescent orange light, while a heavy hammer strikes an
anvil and blasts a spray of glowing embers up and to the right. A bronze gauntlet
sits half-lit in the heat haze. Thick smoke curls through the light. The metal
glows from within, everything else falls to blackness. Colour palette strictly
bronze and fire: hot highlight #FFC489, bronze core #E08A3C, deep burnt copper
#C46A22, near-black base #100A06, no blues, no greens. Photoreal 3D render,
dramatic rim lighting, floating ember particles, film grain.
The LEFT 30% of the frame must be near-black, empty, no detail. The CENTRE must be
a smooth dark gradient with no busy detail. All visual interest in the RIGHT 38%.
Keep the top and bottom 8% dark and quiet.
No text, no letters, no logos, no watermark, no people.
```

## 3. RIVAL — "Shatterpoint"

Palette: ring `#D7DEE8`, name `#FFFFFF` to `#A9B4C4`

```
Ultra-wide 4:1 cinematic banner background. The frozen instant of two blades
clashing. In the right third, a razor-sharp silver blade edge catches a blinding
specular flare at the point of impact, and a burst of shattered mirror and chrome
shards explodes outward and to the right, each shard catching cold light and
throwing reflections. Fine metal filings drift in the air. Sharp, aggressive,
weaponised elegance. Colour palette strictly monochrome silver: pure white
specular #FFFFFF, bright silver #D7DEE8, cool shadow #A9B4C4, near-black gunmetal
base #0C0E12, no warm tones at all. Photoreal 3D render, hard directional key
light, motion-frozen debris, subtle chromatic aberration on the shards.
The LEFT 30% of the frame must be near-black, empty, no detail. The CENTRE must be
a smooth dark gradient with no busy detail. All visual interest in the RIGHT 38%.
Keep the top and bottom 8% dark and quiet.
No text, no letters, no logos, no watermark, no people.
```

## 4. CHALLENGER — "Coronation"

Palette: ring `#F5C542`, name `#FFE9A3` to `#DFA51C`

```
Ultra-wide 4:1 cinematic banner background. A royal coronation in a dark vault. In
the right third, an ornate golden crown hovers and glows, jewelled and heavy,
catching a hard golden key light, with god-rays fanning down behind it through
darkness. A storm of golden dust and glinting particles swirls around it and
streams to the right edge. Rich, opulent, expensive. Colour palette strictly gold:
pale gold highlight #FFE9A3, core gold #F5C542, deep antique gold #DFA51C, and a
near-black base #0B0803, no silver, no other hues. Photoreal 3D render, volumetric
god rays, bokeh dust particles, luxurious cinematic lighting, film grain.
The LEFT 30% of the frame must be near-black, empty, no detail. The CENTRE must be
a smooth dark gradient with no busy detail. All visual interest in the RIGHT 38%.
Keep the top and bottom 8% dark and quiet.
No text, no letters, no logos, no watermark, no people.
```

## 5. ELITE — "Cryo Vault"

Palette: ring `#4DFFD4`, name `#B9FFEE` to `#23D6AE`
⚠ See conflict C3 in the art spec: this teal may be reassigned before art is final.

```
Ultra-wide 4:1 cinematic banner background. Deep inside a frozen crystal vault. In
the right third, a huge faceted ice-teal crystal shard erupts from the floor,
glowing from within with a cold luminous core, refracting light through its
facets. Splinters of ice hang suspended around it, frost creeps across the dark
surfaces, and a low freezing mist rolls to the right. Cold, clean, expensive,
alien. Colour palette strictly icy teal: pale mint highlight #B9FFEE, luminous
teal core #4DFFD4, deep aqua shadow #23D6AE, near-black base #04120F, no warm
tones. Photoreal 3D render, subsurface scattering in the crystal, volumetric mist,
sharp specular glints, film grain.
The LEFT 30% of the frame must be near-black, empty, no detail. The CENTRE must be
a smooth dark gradient with no busy detail. All visual interest in the RIGHT 38%.
Keep the top and bottom 8% dark and quiet.
No text, no letters, no logos, no watermark, no people.
```

## 6. CHAMPION — "Prism Hall"

Palette: ring `#7B6FFF`, name `#B9B3FF` to `#5A4DEB`

```
Ultra-wide 4:1 cinematic banner background. A darkened hall of light. In the right
third, an enormous cut diamond floats and spins, splitting a hard white beam into
sharp violet-blue refracted light shafts that fan out across the frame to the
right. Prismatic caustics dance on the dark floor beneath it. Faceted, brilliant,
victorious. Colour palette strictly violet-blue diamond: pale periwinkle highlight
#B9B3FF, electric indigo core #7B6FFF, deep violet shadow #5A4DEB, near-black base
#070518, minimal other hues, a few thin prismatic rainbow slivers allowed only
inside the caustics. Photoreal 3D render, volumetric light shafts, caustic
refraction, high gloss, cinematic contrast.
The LEFT 30% of the frame must be near-black, empty, no detail. The CENTRE must be
a smooth dark gradient with no busy detail. All visual interest in the RIGHT 38%.
Keep the top and bottom 8% dark and quiet.
No text, no letters, no logos, no watermark, no people.
```

## 7. VETERAN — "Black Chrome"

Palette: ring `#C9CDD4`, name `#EDEFF2` to `#9AA0AA`
⚠ See conflict C2 in the art spec: onyx `#2A2A2A` is invisible as a ring, so this
rank renders as platinum-on-obsidian.

```
Ultra-wide 4:1 cinematic banner background. Pure predatory black on black. In the
right third, an obsidian blade and a slab of woven carbon fibre catch a single
razor-thin platinum edge light along their contours, so the shapes are read almost
entirely by their rim highlight rather than by fill. Black smoke drifts low across
the frame. A faint hexagonal carbon weave texture is barely visible in the
darkness. Restrained, lethal, expensive, understated. Colour palette strictly
monochrome: platinum rim light #EDEFF2, steel highlight #C9CDD4, grey shadow
#9AA0AA, pure black base #050505, absolutely no colour hue anywhere. Photoreal 3D
render, extreme low-key lighting, single hard rim light, glossy black surfaces,
subtle smoke, film grain.
The LEFT 30% of the frame must be near-black, empty, no detail. The CENTRE must be
a smooth dark gradient with no busy detail. All visual interest in the RIGHT 38%.
Keep the top and bottom 8% dark and quiet.
No text, no letters, no logos, no watermark, no people.
```

## 8. LEGEND — "Ember Throne"

Palette: ring `#E0115F`, name `#FF6B9D` to `#B00A45`

```
Ultra-wide 4:1 cinematic banner background. A volcanic crimson underworld. In the
right third, a great phoenix wing of living fire sweeps upward, its feathers
breaking apart into streaming embers, and behind it molten ruby lava cracks glow
through fractured black rock. Superheated air distorts the darkness. Smoke and
sparks stream to the right edge. Furious, legendary, mythic heat. Colour palette
strictly ruby and crimson: hot rose highlight #FF6B9D, ruby core #E0115F, deep
blood shadow #B00A45, near-black volcanic rock #100005, no orange, no yellow, no
blue. Photoreal 3D render, glowing emissive lava, heat haze distortion, ember
particle storm, dramatic cinematic contrast, film grain.
The LEFT 30% of the frame must be near-black, empty, no detail. The CENTRE must be
a smooth dark gradient with no busy detail. All visual interest in the RIGHT 38%.
Keep the top and bottom 8% dark and quiet.
No text, no letters, no logos, no watermark, no people.
```

## 9. MYTHIC — "Nebula Gate"

Palette: ring `#C87FFF`, name `#E9C4FF` to `#A24FF0`

```
Ultra-wide 4:1 cinematic banner background. A gateway torn open into deep space. In
the right third, the silhouette of a coiling cosmic dragon made of stars and
violet nebula gas curls through a ring of glowing arcane runes, its form dissolving
into stardust at the edges. Behind it, a dense violet nebula churns with distant
starfields and a scattering of bright pinpoint stars trailing to the right. Arcane,
otherworldly, vast. Colour palette strictly violet and orchid: pale lilac highlight
#E9C4FF, orchid core #C87FFF, deep royal violet #A24FF0, near-black void #08021A,
with tiny white star sparkles allowed. Digital painting meets 3D render, volumetric
nebula, glowing emissive runes, bloom, cosmic scale, cinematic.
The LEFT 30% of the frame must be near-black, empty, no detail. The CENTRE must be
a smooth dark gradient with no busy detail. All visual interest in the RIGHT 38%.
Keep the top and bottom 8% dark and quiet.
No text, no letters, no logos, no watermark, no people.
```

## 10. ASCENDANT — "Aurora Ascent"

Palette: ring `#FFB347`, name tri-stop `#FFD9A0` to `#FF7AB8` to `#B76BFF`
⚠ See conflict C4: the tri-stop exists so this does not read as a second gold.

```
Ultra-wide 4:1 cinematic banner background. The moment of ascension above the
clouds. In the right third, colossal pillars of aurora light rise from a sea of
dark cloud into a night sky, shifting through warm amber into rose and then into
violet as they climb. Broken shards of celestial rock float weightlessly, catching
the aurora glow on their edges, and fine motes of light drift upward through the
frame. Ethereal, weightless, transcendent. Colour palette an aurora ramp: warm
amber #FFD9A0 low, rose pink #FF7AB8 mid, violet #B76BFF high, over a near-black
sky #070316. The colour must visibly travel from amber to violet across the
pillars, not sit as flat gold. Digital matte painting, volumetric aurora, soft
bloom, floating particles, vast scale, cinematic.
The LEFT 30% of the frame must be near-black, empty, no detail. The CENTRE must be
a smooth dark gradient with no busy detail. All visual interest in the RIGHT 38%.
Keep the top and bottom 8% dark and quiet.
No text, no letters, no logos, no watermark, no people.
```

## 11. IMMORTAL — "Supernova"

Palette: ring `#FFFFFF`, name `#FFFFFF` to `#DCE6FF`, spectral halo

```
Ultra-wide 4:1 cinematic banner background. The instant a star detonates in an
empty void. In the right third, a blinding white supernova core erupts, throwing
searing white light lances outward, and the shockwave ring around it refracts into
a thin full-spectrum halo so that faint rainbow fringing appears only at the very
edges of the blast. Everything else is absolute black void with a scatter of cold
distant stars. Overwhelming, final, divine, colourless by dominance rather than by
absence. Colour palette almost entirely achromatic: pure white core #FFFFFF, cool
white #DCE6FF, pure black void #000000, with a thin prismatic rainbow fringe
permitted ONLY on the shockwave edge. Photoreal 3D render, extreme dynamic range,
lens flare, anamorphic streaks, heavy bloom, chromatic aberration on the shock
ring, cinematic.
The LEFT 30% of the frame must be near-black, empty, no detail. The CENTRE must be
a smooth dark gradient with no busy detail. All visual interest in the RIGHT 38%.
Keep the top and bottom 8% dark and quiet.
No text, no letters, no logos, no watermark, no people.
```

---

## After generating

1. **Check each at 280x70 before accepting it.** Downscale and look at it small.
   If the hero shape stops reading, ask for a bolder, simpler silhouette while
   keeping the same world and lighting. Richness is good, fussiness is not.
2. **Check the left 30% is genuinely dark.** Drop a white circle on it; if the
   circle does not pop, the background is too busy there.
3. Export `public/brand/entry/{rank}.webp` at 280x70 and `{rank}@2x.webp` at
   560x140, WebP quality ~82, under 30KB and 70KB.
4. Rank ids: `rookie, contender, rival, challenger, elite, champion, veteran,
   legend, mythic, ascendant, immortal`.

If a generation comes back close but wrong in one respect, the usual fixes are
"push everything further right", "make the left third pure black", and "increase
contrast between the hero object and its background".
