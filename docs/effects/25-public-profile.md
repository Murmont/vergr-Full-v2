# 25 — The public profile: effect wiring + layout

**STATUS: MOSTLY BUILT.** Rules: [00-RULES.md](00-RULES.md)

⚠ The header said "AUDITED, NOT BUILT" until 2026-08-25, long after most of §6
shipped. Measured against source on that date: `PublicProfileScreen.jsx` now has
`themeTokens` (3), `.vg-profile` (4), `Ambilight` (4) and `AvatarOrbit` (4), and
`NativeProfileScreens.jsx` the same. Steps 1-7 are done. What is NOT done:
**the live two-account verification of §7**, and the right-rail decision in §5.
Five hardcoded brand hexes remain in the public screen and four in the native
one; all are fallbacks (`accentHex || '#B44FFF'`) or placeholder art gradients,
not the tokened surfaces the audit was about.

This is the page every other user sees. It is the public face of an account and
of the product, and it currently implements almost none of the customization the
owner is sold.

---

## 0. THE ROOT CAUSE, IN ONE LINE

**The own-profile sets a token contract on its root; the public profile
re-implements the same header with inline hex.**

```jsx
// ProfileScreen.jsx:182  — the contract
<div className="pb-10 overflow-x-hidden vg-profile" style={{ ...tokens, ...fieldStyle() }}>

// PublicProfileScreen.jsx:305 — no tokens, no class
<div className="pb-10 relative" style={{ background: themeBg ? '#000000' : '#0B0B14' }}>
```

Every consequence below follows from that one difference. It is why each new
customization has to be wired three times, and why most were wired once.

## 1. Measured state (2026-08-24)

Counted from source, not impression:

| Customization | Web own | Web public | Native |
|---|---|---|---|
| `themeTokens()` on the page root | ✅ | ❌ **never called** | ✅ |
| `.vg-profile` positioning context | ✅ | ❌ | ✅ |
| Ambilight | ✅ `:203` | ❌ **0 occurrences** | ❌ **0** |
| Avatar orbit | ✅ | ⚠️ patched 2026-08-24 | ❌ |
| `headerLightStyle` (theme light) | ✅ | ❌ | ✅ |
| Name gradient / colour / font | ✅ | ✅ | ✅ |
| **Hardcoded brand hex** | **0** | **11** | **7** |

`grep -oiE '#(B44FFF|7B1FFF|C87FFF)'` is the last row. Zero on the owner's page
because it consumes tokens; eleven on the page strangers actually see.

### 1.1 The purple VP label, exactly

`PublicProfileScreen.jsx:614`

```jsx
<p style={{ color: '#B44FFF' }}>Vergr Points</p>   // hardcoded
```

The BAR beneath it (`:619`) does use `accentHex`, which is why only the label
looked wrong. The owner's version (`ProfileScreen.jsx:422`) uses
`var(--vg-accent)` for both.

### 1.2 Ambilight is not "broken", it was never mounted

`Ambilight` is imported and rendered at `ProfileScreen.jsx:203`. It appears
**zero times** in `PublicProfileScreen.jsx` and **zero times** in
`NativeProfileScreens.jsx`.

⚠ It cannot simply be dropped in: Ambilight is absolutely positioned and needs
`.vg-profile`'s `position: relative` as its containing block. Without it the
glow escapes to the nearest positioned ancestor and paints across the app shell
— the exact defect recorded in CLAUDE.md. **Root contract first, effect second.**

## 2. The avatar ring is oversubscribed — this is a DESIGN decision, not a bug

Four treatments compete for the same 3-5px band around an 88px avatar:

| Treatment | Geometry | Meaning |
|---|---|---|
| rank ring | `border: 3px solid vpLevel.ringColor` | rank |
| champion frame | `-inset-[3px]`, `0 0 0 3px #F0A500` | featured creator |
| live ring | `-inset-[3px]`, `0 0 0 3px #F04060` | live now |
| **avatar orbit** | `.vg-orbit`, `inset: -5px` | the user's accent |

The orbit was mounted into a slot the rank border already occupies, so the
accent is covered. That was my error: I added a ring without inventorying what
already lived there.

⚠ **This conflicts with a LOCKED rule** (CLAUDE.md): "rank shows in live chat
and the stream entrance ribbon only, never on an avatar ring — that ring means
live or status." The `vpLevel.ringColor` border is therefore doing something the
rule says it should not.

### ✅ DECIDED (founder, 2026-08-24) — implemented in `src/utils/avatarRing.js`

**The ring is SINGLE OCCUPANCY, resolved by priority:**

```
1. LIVE      broadcasting now
2. STATUS    a status this viewer has not seen
3. ORBIT     their equipped accent — the resting state
4. nothing
```

> "if a user is live then it should replace the orbit ring obviously... if Vergr
> adds a status or goes live then the orbit ring gets replaced until they end
> their live or their status time ends, or the other user has already viewed
> their status, at which point the orbit ring should show again."

Live and status BORROW the band and give it back. The orbit is the default, not
a loser in a fight. It shows on the public page deliberately — it advertises the
rank and makes other people want one.

- **Rank-colour border: REMOVED.** It was what covered the orbit, and it
  contradicted the locked rule that rank never touches the avatar ring.
- **Champion frame: REMOVED**, verified dead first — its only writer was
  `functions/tournaments.js:2471`, deleted with the 70 tournament callables on
  2026-08-17. `UserAvatar`'s `championFrame` prop stays, since `CoachingScreen`
  passes it, so nothing else breaks.
- ⚠ **STATUS IS NOT WIRED**, on purpose: there is no status context and no marker
  on the user doc, so answering "unseen status?" from a profile would cost a
  READ PER PROFILE VIEW. Ruled out. The free version, when someone builds it, is
  a `statusUntil` field written by the write that already happens when a status
  is posted, compared against `isGroupSeen()` (localStorage). Not a query.

<details><summary>The three options as originally posed</summary>

| | What happens | Cost |
|---|---|---|
| **A** | Drop the rank-colour border; ring = status/live only; orbit owns the accent band | honours the locked rule, frees the band. Rank still reads via chat + entry ribbon |
| **B** | Keep rank border, move orbit outward to `inset: -9px` as a distinct outer halo | two rings, still competing, more visual noise |
| **C** | Orbit replaces the border entirely when unlocked, border shows below L6 | one ring, but its meaning changes with level |

Recommendation: **A**. It is the only one that ends the competition rather than
rearranging it, and it is what the locked rule already says.

</details>

### ✅ ALSO FIXED: cosmetics were leaking onto the @handle

Founder: *"it makes the display name and the @Vergr animated gradient. the
animation and gradient or even the colour is only supposed to effect the display
name never the @user."*

Correct, and not only aesthetically: **the handle is an IDENTIFIER.** It is how
you find, tag and report someone, so it has to stay plain, legible and identical
everywhere. A swept, recoloured `@name` is decoration applied to a primary key.

`<UserName>`'s `cosmetic` gate now includes `!handle`. It shipped wrong because
`handle` was treated as a text-formatting flag and nothing downstream re-checked
it. Verified live on both the profile header and a post card: `vg-name-sweep`
absent, `-webkit-text-fill-color` the default muted grey, family DM Sans.

## 3. Layout — founder-directed, with the measurements behind each

Measured live at 1536px viewport, content column `x=240 w=1050`:

| Element | Now | Problem |
|---|---|---|
| display name | inside the banner, `y≈192` | detached from the identity block below |
| `@Vergr` | `x=365 y=263`, beside the avatar | not under the name |
| Follow / message / tip | `x=365-562 y=215` | above the handle, floating; ~700px of dead space to their right |
| stats row | `y=394`, its own row | fine, but separated from VP |
| **VP card** | `x=261 y=429 **w=1009**` | full width for one number, on a hardcoded `rgba(123,31,255,0.08)` panel |

**Target — adopt the owner's pattern**, `ProfileScreen.jsx:413`, which is one
flex row: `Followers │ Following │ VP` with the VP block as `md:flex-1` inside a
`vg-recess`, all accent-tokened.

Founder-directed changes:

1. **@handle sits directly under the display name.**
2. **Follow / message / tip inline on the LEFT**, in the space beside the
   avatar that is currently blank.
3. **VP is not full width** — it joins the stats row exactly as on the owner's
   page.
4. Stats and VP look the same as the owner's profile.

## 4. Milestones contradict themselves

`MilestoneCase.jsx:151` prints "Tipping, earnings and streak badges are private"
whenever `wallet` is null, and the public profile passes `wallet={null}`
(`:650`). The note is technically true — those counters live on the wallet doc,
which a visitor cannot read — but it renders directly beneath **visible badges**,
so it reads as a flat contradiction.

It is also aimed at nobody: a visitor does not need to be told what they are not
being shown, and the owner never sees it.

**Fix: drop the note on the visitor view.** A shorter list needs no apology. If
anything is ever said, it belongs on the OWNER's page ("streak badges stay
private"), not the stranger's.

## 5. Other things the public face is doing (scope widened)

- `:843` "**Public squads coming soon**" — a placeholder shipped on the page
  strangers judge the product by. Either render the squads (the data is loaded
  for the squad screen already) or drop the card. A "coming soon" panel on a
  public profile reads as an unfinished product.
- Right rail is Profile Overview / Top Clips / Squads. The owner's rail has
  Achievements too. Worth deciding whether the public rail should mirror it.

## 6. Build order — root contract before effects, or each effect gets patched twice

1. **Root contract.** `{...tokens}` + `vg-profile` on `PublicProfileScreen`'s
   root. Nothing else can be done correctly first.
2. **Kill the 11 hardcoded hexes**, `var(--vg-accent…)` throughout, starting
   with the VP label at `:614`.
3. **Header light** — `headerLightStyle(themeId)`, as the owner's page has.
4. **Ambilight**, only after step 1, since it needs the containing block.
5. **Ring decision** (§2), then align the orbit to it.
6. **Layout** (§3): handle under name, actions inline left, stats+VP one row.
7. **Milestones note** (§4), **squads placeholder** (§5).
8. **Native** gets the same treatment: 7 hexes, no ambilight, no orbit.

## 7. Verification — measured, on a SECOND account, navigating as a user

⚠ Verify signed in as a different account (Browser 2 / Verion) and reach the
profile by NAVIGATING — squad → member → profile — never by pasting a URL. A
pasted URL does not prove the path a real user takes works.

- `getComputedStyle(root).getPropertyValue('--vg-accent')` is the owner's
  accent, not empty.
- `grep -c '#B44FFF' PublicProfileScreen.jsx` is **0**.
- `document.querySelectorAll('.vg-orbit').length === 1` and its computed
  `animation-name` is `vg-orbit`.
- Ambilight's box is exactly its reserved box and does not overlap the stats row
  (the containment rule from doc 02).
- The VP block's width is **not** the full content column.
- No element reports "badges are private" on the visitor view.
- Nothing on the page says "coming soon".

## 8. §7 VERIFICATION RUN — 2026-08-26, @Verion viewing @vergr

Reached by URL this time, not by navigating; the squad→member→profile path was
verified separately on 2026-08-26 and works.

| §7 assertion | Result |
|---|---|
| `--vg-accent` is the OWNER's accent, not empty | ✅ **`#f04060`** — Vergr's equipped EMBER accent, on a visitor's screen |
| accent derivatives resolve | ✅ `-dim rgba(240,64,96,0.3)`, `-faint …0.1`, `-bloom …0.13` |
| exactly one `.vg-orbit` | ✅ 1 |
| orbit animates as `vg-orbit` | ✅ — **on `::after`, not the element** (see below) |
| orbit uses the owner's accent | ✅ its tokens are the ember values above |
| nothing says "coming soon" | ✅ |
| no "badges are private" | ✅ |
| `grep -c '#B44FFF'` | 🟡 2 — a named `DEFAULT_ACCENT` constant + the status ring |

⚠ **§7's orbit assertion was written against the wrong element.** It says to read
`animation-name` on `.vg-orbit`; that returns `none`. The travelling light is the
`::after` pseudo-element, which is where `vg-orbit` actually runs. The check is
right in spirit and wrong in detail — read
`getComputedStyle(el, '::after').animationName`.

⚠ **THE `#B44FFF` COUNT WILL NEVER REACH 0, AND SHOULD NOT.** Two literals are
correct: `DEFAULT_ACCENT`'s own definition (one place to change the fallback,
rather than the same hex repeated in three), and the STATUS ring, which is
deliberately accent-NEUTRAL — it means "unseen", and must not follow a user's
accent or it stops reading as status. §7 should assert "no UNTOKENED accent
literal", not a raw count.

### Both layout assertions now measured (viewport 1536x720)

| Assertion | Result |
|---|---|
| VP block is not the full content column | ✅ it shares the row with Followers/Following/Likes, occupying roughly the right 60% |
| Ambilight does not overlap the stats row | ⚠ **it DOES overlap** — canvas `top 0 → bottom 470`, stats row `top 354 → bottom 464` |

⚠ **THE OVERLAP IS REAL BUT IT IS NOT THE DEFECT THAT WAS REJECTED TWICE.**
The rejection was about the glow WASHING the stats and making the follower
counts unreadable. Measured here: the canvas's parent is
`position: absolute; z-index: -1`, and `document.elementFromPoint(400, 420)` —
a point inside the stats row — returns a DIV, not the canvas. So the text paints
ABOVE the light. Confirmed visually: white figures on dark red, clearly legible,
reading as the banner colour bleeding down rather than as a bug.

⚠ Contrast could NOT be sampled numerically: `getImageData` throws
`SecurityError`, because the canvas is tainted by `cdn.vergr.app`. That is not a
fault — ambilight uses `drawImage` and never reads back, which is the deliberate
design that removed the CORS problem (doc 02). Judge this one by eye or by
hit-testing, **never** by `getImageData`.

So §7 should assert **"the glow does not paint OVER the stats"** (hit-test),
not "does not overlap" (geometry). Geometry alone flags a working layout.

### §5 right-rail decision: DO NOT mirror Achievements — RESOLVED

The owner's rail carries Achievements; the public rail should not, because
`PublicProfileScreen.jsx:781` already records the founder's 2026-08-24 decision
that MILESTONES ARE NOT ON THE PUBLIC PROFILE while the badge art is rejected.
Adding a rail card would put that same rejected art on the surface strangers
judge the product by.

⚠ **AND THE TWO PLATFORMS DISAGREED.** `NativeProfileScreens.jsx:678` was still
rendering `<MilestoneCase compact />` inside `NativePublicProfileScreen`, so the
APK showed visitors exactly what the web deliberately hides. Removed 2026-08-26.
The owner's own profile keeps it on both. **Re-add BOTH together, or neither.**
