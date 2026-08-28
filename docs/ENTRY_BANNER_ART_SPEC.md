# Entry banner art spec (per rank)

Written 2026-08-23 from a pixel measurement of the founder's reference sheet
(`~/Downloads/ChatGPT Image Aug 23, 2026, 01_37_54 PM.png`, 1536x1024, 10 sample
banners). Measured with `sharp`, not eyeballed, per the rule in CLAUDE.md.

Companion to `docs/ENTRY_ANNOUNCEMENTS_SPEC.md` (behaviour, placement, security).
This doc is the **art and colour brief** for generating the 11 rank backgrounds.

---

## 1. What the reference actually is, measured

### 1.1 Geometry (consistent across all 10 samples)

| Property | Measured | Spec |
|---|---|---|
| Banner aspect | 3.97 to 4.34 : 1 (mean 4.07) | **4 : 1** |
| Avatar centre X | 15.4% to 16.6% of width (10/10 samples) | **16% of width** |
| Avatar centre Y | 50% | **vertically centred** |
| Ring + glow envelope | 104% to 118% of banner height | glow **bleeds past the top and bottom edges** |
| Crisp ring stroke | 2 to 9px at 751px wide | **~0.4% of width** (about 3px at 751px) |
| Name band | x 25% to 60% | text column starts at **~25% of width** |
| Name cap height | ~30% of banner height (detector range 22 to 40%) | **30% of height** |

The glow bleeding past the top and bottom edges is deliberate and is a lot of why
these read as "lit" rather than "printed". Do not contain the halo inside the box.

### 1.2 The colour rule, confirmed

You said the username and the avatar ring must share a colour. **That is exactly
what the reference does.** Measured ring colour vs measured name colour:

| Sample | Ring | Name (top → bottom) |
|---|---|---|
| ALEX | `#f92044` | `#fb5875` → `#fc5e7c` |
| JAYDEN | `#af5ef9` | `#be74fb` → `#b465fa` |
| SOPHIA | `#ecba30` | `#f2bc33` → `#e3aa21` |
| ETHAN | `#1ac1f7` | `#04d4fa` → `#07d4fc` |
| LILY | `#f88dab` | `#d85b8b` → `#fb92c1` |
| MASON | `#83dc02` | `#94f604` → `#94f504` |
| TYLER | `#f98c11` | `#fb8a04` → `#f88904` |
| EMMA | `#d596fa` | `#c554e9` → `#d198fb` |
| NOAH | `#f2b803` | `#fac00c` → `#f8bc07` |
| ZOE | `#34f1f8` | `#47f3fb` → `#3feffa` |

**The rule, stated precisely:** ring and name are the same hue. The **name is
slightly brighter than the ring** and carries a soft vertical gradient (lighter
top, deeper bottom, roughly 15% luminance travel). The ring sits at the darker
stop. Every palette below follows this.

"joined" and "to watch the" are pure white. **"LIVE" takes the rank colour**,
measured at or just below the ring value.

### 1.3 Type treatment

- Name: heavy **italic**, all caps, tight tracking, thin dark outline plus a soft
  drop shadow so it survives on a bright background.
- "joined": white, bold italic, roughly 65% of the name's cap height.
- Line 2 "to watch the LIVE": white bold italic, roughly 55% of the name.
- ⚠ Vergr's heading face is **Syne, which has no true italic**. Either accept a
  synthesised oblique, or pick a display italic for this surface only. Founder
  call, listed in section 6.

---

## 2. The constraint that governs the art

`JoinAnnouncer` renders at **`min(280px, 70vw)`** wide, and the founder rule in
`JoinAnnouncer.jsx:3-7` is "NEVER full-screen. TikTok-sized, not awards-show."

At 4:1, 280px wide means **280 x 70 CSS pixels**. The reference sheet is 751px
wide per banner, so everything in it will be seen at **37% of the size you are
looking at**.

**Therefore: the detailed illustrations in the reference (the full warrior on
ALEX, the game controller on ETHAN) will turn to mush.** The art has to be
designed for 280x70, which means:

- One **bold silhouette** motif on the right, not a scene.
- High contrast against its own background, no fine linework, no small text.
- Detail that survives a 2.7x downscale.

### Safe zones (critical, because the app draws on top)

The avatar and both text lines are **composited by the app at runtime**, not baked
into your art. So the background must stay calm underneath them:

```
 0%          16%              25%                        62%          100%
 ├───────────┬────────────────┬──────────────────────────┬─────────────┤
 │  AVATAR ZONE (0 to 30%)    │  TEXT ZONE (25 to 62%)   │  ART ZONE   │
 │  keep very low contrast    │  keep low contrast       │ (62 to 100%)│
 │  the avatar + glowing ring │  two lines of white and  │  the motif  │
 │  are drawn over this       │  coloured text sit here  │  lives here │
 └────────────────────────────┴──────────────────────────┴─────────────┘
```

- **0 to 30% width:** darkest part of the banner. A wash, nothing readable.
- **25 to 62% width:** still calm. Any bright shape here fights the name.
- **62 to 100% width:** this is where the motif and the energy go.
- Vertical: keep the top and bottom 8% quiet so the glow can bleed.

---

## 3. Per-rank palette and art brief

**The motif for every rank should be that rank's existing crest**
(`public/badges/*.webp`), so the banner reinforces the badge system instead of
introducing a twelfth visual language. The background is yours to generate; the
crest is composited or drawn into the art zone.

Colour columns: **Ring** is also the avatar ring and the base name colour.
**Name top / bottom** are the two gradient stops. **LIVE** is the word LIVE.
**Glow** is the halo around the ring and behind the name.

**Full paste-ready generation prompts for all 11 are in
`docs/ENTRY_BANNER_PROMPTS.md`.** The concept column below is the one-line summary
of each; the prompt file is the thing to actually generate from.

| # | Rank | Ring / name base | Name top | Name bottom | LIVE | Concept |
|---|---|---|---|---|---|---|
| 1 | **Rookie** (L1-10) | `#9AA3B2` steel | `#C7CEDA` | `#8E97A6` | `#9AA3B2` | **Proving Ground.** Scarred gunmetal bulkhead, steel shield, a grinder throwing white-hot sparks. |
| 2 | **Contender** (L11-20) | `#E08A3C` bronze | `#FFC489` | `#C46A22` | `#E08A3C` | **The Forge.** Molten bronze pour, hammer strike, ember blast, heat haze. |
| 3 | **Rival** (L21-30) | `#D7DEE8` silver | `#FFFFFF` | `#A9B4C4` | `#D7DEE8` | **Shatterpoint.** Blade clash frozen mid-impact, exploding chrome and mirror shards. |
| 4 | **Challenger** (L31-40) | `#F5C542` gold | `#FFE9A3` | `#DFA51C` | `#F5C542` | **Coronation.** Jewelled golden crown, god-rays, a storm of gold dust. |
| 5 | **Elite** (L41-50) | `#4DFFD4` teal ⚠ | `#B9FFEE` | `#23D6AE` | `#4DFFD4` | **Cryo Vault.** Erupting faceted ice crystal, luminous core, freezing mist. **C3.** |
| 6 | **Champion** (L51-60) | `#7B6FFF` diamond | `#B9B3FF` | `#5A4DEB` | `#7B6FFF` | **Prism Hall.** Spinning cut diamond splitting a beam into violet light shafts and caustics. |
| 7 | **Veteran** (L61-70) | `#C9CDD4` on onyx ⚠ | `#EDEFF2` | `#9AA0AA` | `#C9CDD4` | **Black Chrome.** Obsidian blade and carbon weave read only by a razor platinum rim light. **C2.** |
| 8 | **Legend** (L71-80) | `#E0115F` ruby | `#FF6B9D` | `#B00A45` | `#E0115F` | **Ember Throne.** Phoenix wing breaking into embers over molten ruby lava cracks. |
| 9 | **Mythic** (L81-90) | `#C87FFF` orchid | `#E9C4FF` | `#A24FF0` | `#C87FFF` | **Nebula Gate.** Star-made cosmic dragon coiling through glowing arcane runes. |
| 10 | **Ascendant** (L91-99) | `#FFB347` celestial ⚠ | `#FFD9A0` | `#FF7AB8` (→`#B76BFF`) | `#FFB347` | **Aurora Ascent.** Aurora pillars travelling amber to rose to violet, floating celestial rock. **C4.** |
| 11 | **Immortal** (L100) | `#FFFFFF` prismatic | `#FFFFFF` | `#DCE6FF` | `#FFFFFF` | **Supernova.** Detonating white star in a void, spectral halo only on the shockwave edge. |

Glow for every rank: the ring colour at **40% alpha**, blurred wide, allowed to
bleed past the top and bottom edges.

---

## 4. Colour conflicts that need your decision

These are real contradictions already in the codebase, not preferences. I am not
picking for you because they change avatar rings app-wide.

**C1. `vpSystem.js` and `badgeSystem.js` disagree on two ranks.**
`RANK_TIERS` says Veteran is onyx `#2A2A2A` and Legend is ruby `#E0115F`.
`BADGE_RANKS` says Veteran is ruby `#E0115F` and Legend is emerald `#2EC27E`.
Both files are live. **Which is canonical?** The table above follows `vpSystem`
because that is what drives the avatar ring today.

**C2. Veteran's onyx `#2A2A2A` cannot work as a neon ring or a username.** It is
darker than the banner background. On a dark UI it is invisible, and as a username
colour it would be unreadable. My proposal is "black chrome": the ring and name
render as bright platinum `#C9CDD4` with an onyx core and a black outline, so the
rank still reads as black-and-metal without disappearing. Alternative: give
Veteran a real hue and move onyx to a background treatment only.

**C3. Elite's `#4DFFD4` is cyan, and memory `project-brand-no-cyan` says cyan is
off-brand (violet, pink, gold only).** The same conflict is already flagged in
CLAUDE.md for tier 6 on the earnings ladder. Options: keep teal for Elite,
or move Elite to emerald `#2EC27E` (which `badgeSystem` already uses elsewhere),
or to a platinum-white. Your call, but it should be resolved once and applied to
rings, crests, banners and the earnings ladder together.

**C4. Ascendant `#FFB347` sits ~15 degrees of hue from Challenger `#F5C542`.** At
280px the two banners will look like the same gold. Either take the tri-stop
amber-to-rose gradient in the table, or reassign Ascendant a clearly separate hue.

**C5. Rookie `#8A8F98` and Rival `#C0C0C0` are both neutral greys** and are only
separated by lightness. Acceptable (they are 20 levels apart and rank 1 should be
dull), but worth knowing.

---

## 5. Asset delivery

Follow the `/brand/earnings/` precedent already in the repo.

| Item | Spec |
|---|---|
| Path | `public/brand/entry/{rank}.webp` and `{rank}@2x.webp` |
| Rank ids | `rookie, contender, rival, challenger, elite, champion, veteran, legend, mythic, ascendant, immortal` |
| Sizes | 1x **280x70**, 2x **560x140** |
| Generate at | **1536x384** (4:1), then downscale. Check legibility at 280x70 before accepting. |
| Format | WebP, quality ~82 |
| Budget | **under 30KB at 1x, under 70KB at 2x** (earnings art landed at 25KB / 61KB) |
| Caching | `/brand/**` already has a 7d browser / 30d CDN header in `firebase.json`. No change needed. |
| Fallback | Every banner must degrade to a flat rank-coloured gradient if the image 404s, the same way the earnings art self-hides. |

Total: 11 ranks x 2 densities = **22 files, target under 1.1MB combined.**

---

## 6. Open questions

**Q1.** Resolve C1 to C4 above (canonical rank colours).

**Q2.** Italic display face for the name, given Syne has no true italic. Options:
synthesised oblique on Syne, or add one display face for this surface.

**Q3.** Does the motif use the existing rank crest, or do you want bespoke art per
rank (a warrior, a crown, and so on, like the reference)? Crests are free and
reinforce the badge system; bespoke art is stronger but is 11 more pieces.

**Q4.** Do the top ranks get a **looping** treatment (a slow shimmer on the
background) or is every banner static? Static is cheaper and safer on low-end
Android; a loop is more impressive at L91+.

**Q5.** Do you want a matching **broadcaster OBS overlay** version at a larger
size (say 900x225), where the detail in your reference would actually survive?
That is the one surface where full illustration quality pays off.
