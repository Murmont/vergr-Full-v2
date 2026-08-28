# HANDOVER — profile cosmetics + the unlockable effects system

**Written 2026-08-24 by the outgoing session. Read this whole file before you
touch anything, then read the docs in §2 in the order listed.**

You are picking up mid-project. The work is well-defined and the hard
architectural decisions are already made and shipped. What follows is the state,
the process the founder requires, and — most importantly — **every mistake the
previous session made**, so you do not repeat them. Several of them shipped to a
live site. Read §4 twice.

---

## 1. WHAT THIS PROJECT IS

Vergr's VP ladder gives users unlockable **cosmetics** as they level up. The
current phase is building those effects and making them work everywhere a user
is seen.

Three architectural pieces are now in place and are the foundation for
everything else. Do not work around them; work through them.

| Piece | File | What it owns |
|---|---|---|
| `<UserName>` | `src/components/UserName.jsx` | THE only place a person's name renders. All name cosmetics live here. |
| `accentFor()` | `src/utils/rankUnlocks.js` | THE only accent resolver. Free hex + 12 presets. |
| `avatarRing()` | `src/utils/avatarRing.js` | Single-occupancy avatar ring: LIVE > STATUS > ORBIT > none. |

### The two rules that govern every effect

1. **ZERO RUNTIME COST.** Every unlock resolves from `users/{uid}.vpLevel`,
   which is already on the user doc every surface has loaded, and which the chat
   relay already stamps on every message. **If you find yourself adding a
   Firestore read to answer "what has this user unlocked", you have taken a
   wrong turn.** When a signal genuinely is not available for free, denormalise
   it onto the user doc on a write that already happens — see
   `markStatusPosted()` in `src/firebase/firestore.js` for the pattern.

2. **AN UNLOCK MUST BE VISIBLE TO OTHER PEOPLE.** A cosmetic only the owner can
   see is not a reward. The avatar orbit shipped and was mounted ONLY on the
   owner's own profile for its entire life — nobody else ever saw it. That is
   the single most instructive bug in this project.

---

## 2. READ THESE, IN THIS ORDER

1. `CLAUDE.md` — the project bible. **Its own header tells you it has been found
   stale five times. When it and the source disagree, THE SOURCE WINS. Grep
   before you assert.**
2. `docs/effects/00-RULES.md` — nine rules, the full 24-effect index, build order.
3. `docs/effects/01-username-component.md` — especially §3.3, the codemod
   corruption post-mortem.
4. `docs/effects/25-public-profile.md` — the audit and decisions for the page you
   will be working on next.
5. `src/components/effects/README.md` — the level/appearance split contract.
6. `docs/effects/02-ambilight.md`, `03-name-gradient.md`, `04-name-colour-font.md`,
   `15-avatar-orbit.md` — shipped effects, each with what went wrong.

---

## 3. THE PROCESS THE FOUNDER REQUIRES

He has stated this repeatedly and enforced it. **It is not optional and it is
not a formality.** For every effect, in this order:

### Step 1 — RESEARCH the real technique, online, with sources

Do not implement from intuition. Find how the thing is actually done, cite it in
the doc. The ambilight was rejected three times for being "a gradient blur"
until the session actually read how YouTube's ambient mode works (10×6 canvas,
blur at SOURCE scale, content inset inside a larger canvas). The founder's
words: *"how about you go look online how to do it correctly and dont waste my
tokens then gasslight me saying its good as it is."*

**"Good enough" is explicitly not acceptable. He has said nothing below perfect
is acceptable.**

### Step 2 — INVENTORY EVERY FILE IT TOUCHES, EXHAUSTIVELY

⚠ **THIS IS THE STEP THE PREVIOUS SESSION SKIPPED, AND IT IS WHY THE FOUNDER IS
ANNOYED.** He said: *"the entire fucking point of you planning and looking into
the code base before starting was to avoid breaking things."*

**There are FOUR profile views, not one.** Forgetting this is the single most
repeated error:

| View | File |
|---|---|
| Web, own profile | `src/screens/profile/ProfileScreen.jsx` |
| Web, someone else's | `src/screens/profile/PublicProfileScreen.jsx` |
| Native, own | `src/screens/profile/native/NativeProfileScreens.jsx` |
| Native, someone else's | same file, `NativePublicProfileScreen` |

Chat has four surfaces too (`ChatPanel`, `ChatThreadScreen`,
`ChatDetailScreen`, `SquadChatThreadScreen`) plus native mirrors.

Run the greps. Write the list into the doc. `grep -rn '<Thing' src` and confirm
the visitor-facing screen is in the results, not just the owner's.

### Step 3 — WRITE THE DOC BEFORE THE CODE

One document per effect in `docs/effects/`. It must contain: researched
technique with cited sources, the exhaustive surface inventory, an
implementation plan, and a **measurable** verification step. The founder rejected
a doc that had "NOT RESEARCHED" sections in it.

### Step 4 — BUILD

### Step 5 — VERIFY IN CHROME BY MEASUREMENT

*"pixel perfection no Bullshit."* A screenshot plus "looks good" is not
verification. Read computed styles, bounding boxes, contrast ratios. See §6.

---

## 4. ⚠ EVERY MISTAKE THE PREVIOUS SESSION MADE

Read all of these. Most of them shipped.

### 4.1 A GREEN BUILD PROVES NOTHING

**36 sites were corrupted and `npm run build` passed every time.** A codemod
replaced `{a.displayName}` without checking the character before the `{`:

- `` `Invited ${u.displayName}` `` → the `$` was stranded and the element text
  landed **inside the string**; a toast literally read
  ``Invited $<UserName user={user} ... />``
- `alt={u.displayName}` → **JSX legally accepts an element as an attribute
  value, so it compiles.** `alt` became `[object Object]`; `value=<UserName/>`
  broke the display-name input; `CoinCard`'s `otherName` calls `.toUpperCase()`
  on it and **crashed the DM thread**; 13 sites put raw JSX into `<title>` and
  `og:title` on indexed SEO pages.

**Rules this leaves:**
- After any codemod: `grep -rn '[$=]<Component' src` — must be zero.
- `scripts/username-repair.mjs` exists and reverses this exact damage by
  replaying patterns against HEAD.
- The codemod now carries `CTX = (?<![$=])` on every pattern. Do not remove it.

### 4.2 NEVER PIPE A BUILD THROUGH `grep` BEFORE A DEPLOY

```bash
npm run build 2>&1 | grep -iE 'error|built' && firebase deploy ...   # WRONG
```
The grep succeeded (it found the word "error"), so `&&` proceeded and **a stale
`dist/` was deployed**. Use:
```bash
npm run build 2>&1 | tail -5; echo "EXIT=${PIPESTATUS[0]}"
```
and only deploy on `EXIT=0`.

### 4.3 DO NOT WRITE JSX THROUGH SHELL HEREDOCS OR `node -e`

The shell silently mangles backticks, `${}`, `<>` and backslashes. Two real
failures:
- A replacement string produced `from '\rankUnlocks'` — a literal carriage
  return in an import path.
- A comment-stripping script left orphaned comment prose **rendering as visible
  page text**. It compiled.

**Use the Read/Edit/Write tools for JSX.** Bash is fine for greps and builds.

### 4.4 HOOKS MUST BE ABOVE EVERY EARLY RETURN

`useEffectEnabled` calls `useMemo`. Placing it lower in the file (where it read
better) put it after `if (loading) return <ProfileSkeleton/>`. The hook count
changed between renders, React threw **#310**, and the whole screen went to
ErrorBoundary. A mask or any other condition must be applied at the USE site as
a plain boolean — **never gate a hook**.

### 4.5 DO NOT COPY A MAGIC NUMBER — COPY THE RELATIONSHIP

The ambilight box is `h-[400px]` on the owner's profile. Copying that verbatim
to the public profile left the stats row **64px below the light**, sitting in
unlit black, and the founder correctly said it looked nothing like his page.
The public page is taller (it carries an action row the owner's does not). The
rule is *glow bottom ≥ stats bar bottom*, now written in the code.

### 4.6 READ A HELPER BEFORE REUSING IT

`docs/effects/04` said to reuse `inkFor()` from `profileThemes.js` for name
contrast. It **only ever DARKENS** (`c * 0.95`, 40×) — correct for dark ink on
light paper, catastrophic on Vergr's near-black surfaces, where it drives a dim
colour to invisible. It is also not exported. Replaced by `ensureContrast()` in
`src/utils/color.js`, which picks direction from background luminance.

### 4.7 MEASURE — DO NOT PREDICT

The same doc predicted three accents would fail WCAG contrast. Measured:
`violet` 3.25:1 and `ruby` 4.12:1 did fail, but `onyx` — flagged as the likeliest
failure — measures **6.03:1** and was always fine. `scripts/name-contrast-check.mjs`
now proves all 34 combinations on every build.

### 4.8 COSMETICS NEVER TOUCH THE @HANDLE

The handle is an **identifier** — how you find, tag and report someone. It must
stay plain and identical everywhere. The gradient leaked onto it because
`handle` was treated as a formatting flag and nothing re-checked it. The
`cosmetic` gate in `UserName.jsx` now includes `!handle`.

### 4.9 A CONTROL THAT DOES NOTHING IS WORSE THAN NO CONTROL

`cosmetics.nameEffect` was a toggle on `/prestige` that **nothing read**, ever.
CLAUDE.md documents three other kill switches with the same disease. When you
find a toggle, grep for a reader before trusting it.

### 4.10 BEHAVIOURAL — HOW TO WORK WITH THIS FOUNDER

These are direct quotes. They are not style preferences.

- **Do as you are told. Do not argue.** *"no you will do as you were fucking
  told! ... dont you ever fucking tell me no again."* If you think an
  instruction is wrong, do it, then say why afterwards — briefly.
- **Finish before reporting.** Do not list remaining work while the current
  instruction is incomplete. *"you have the ordacitity to tell me the remaining
  things to do when you havent finished what i have told you to do."*
- **Check your own work in Chrome before claiming done.** He has two browser
  windows open for you. The previous session reported "done" without diffing
  them and was rightly called out.
- **Do not use cost as an excuse to ship something boring.** The typeface list
  was 3 fonts "because webfonts cost bandwidth". The right answer was 18 fonts
  with demand loading. *"do not try to make a task smaller so that it is easy
  for yourself."*
- **No em dashes** in any output. Use commas, periods, parentheses, colons.
- **Never remove a feature/route/button without explicit permission.**
- **Zero out-of-pocket cost.** No new paid services, Firebase Spark-compatible.

---

## 5. WHAT IS ALREADY SHIPPED AND DEPLOYED

All of this is live on `vergr.app`. Do not rebuild it.

### 5.1 `<UserName>` migration — DONE
167 instances, every mechanical site migrated. `scripts/username-render-check.mjs`
(31 assertions, negative-tested both ways) is wired into `prebuild` so a build
fails if a name is rendered outside the component.

### 5.2 Name cosmetics — DONE
| Effect | Unlock | Storage |
|---|---|---|
| Typeface, 18 faces demand-loaded | L3 `name_font` | `cosmetics.nameFont` (enum, mirrored in firestore.rules) |
| Name colour, free hex, contrast-corrected | L12 `name_color` | `cosmetics.nameColor` |
| Animated gradient, 2-6 user-chosen colours | L63 `name_effect` | `cosmetics.nameGradient.stops[]` |

⚠ The gradient loop is **seamless by arithmetic**: a 200%-wide image holding two
identical cycles, animated `0% → 100%` = exactly one period, `90deg` so there is
no vertical component. Do not "improve" those numbers — read
`docs/effects/03-name-gradient.md` §0.1 first.

### 5.3 The Appearance panel — REBUILT
`src/components/prestige/CosmeticEquip.jsx` is three tabs: **Name / Profile /
Effects**. A new unlock joins a tab; it must not lengthen the page.
⚠ **No outline-only selected states.** Selection is a solid accent fill.
The picker is `GradientEditor` + `ColorField` + `ColorPopover`, with a screen
**eyedropper** (EyeDropper API, feature-detected).

### 5.4 Public profile — MOSTLY DONE
Root token contract, ambilight, header light, single ring, stats matching the
owner's, actions on the right under the banner, handle under the name,
milestones removed, placeholder copy removed. See `docs/effects/25-public-profile.md`.

### 5.5 Two live bugs fixed in passing
- **Every deploy broke the whole SEO surface for 10 minutes.** `ugcRenderer.js`
  cached the SPA shell for 10 min while Vite deletes old chunks on deploy. Fixed
  with a conditional GET (ETag → 304).
- **Tournament copy** removed from the SSR signup CTA and the UGC card. It
  contradicted the compliance pages on indexed pages.

---

## 6. HOW TO VERIFY (the founder watches this)

### Two Chrome windows, two accounts

```
mcp__claude-in-chrome__list_connected_browsers
```
- One is signed in as **@vergr** (the brand/admin account) — use for own-profile
  and the `/prestige` equip panel. Admin resolves to level 100 so every cosmetic
  is visible without grinding.
- One is signed in as **Verion** — use to see what a NORMAL VISITOR sees.

⚠ **Navigate like a user.** The founder: *"you are pasting URLs and not
navigating like a user, no one is going to paste a url to get to a page."*
Go squad → member → profile.

⚠ Chrome may need ~10s after load; the app shows a splash first. Measure after
a real wait, not 2s.

### Measure, do not eyeball
```js
getComputedStyle(el).getPropertyValue('--vg-accent')
el.getBoundingClientRect()
el.getAnimations()[0]            // pause, set currentTime, compare frames
document.fonts                    // prove no new family loaded
```

### The build guards
```bash
npm run check     # vp-mirror (91) + username-render (31) + name-contrast (34)
```
Runs automatically as `prebuild`. If you add a guard, **negative-test it** —
deliberately break the thing and confirm it fails. A check that cannot fail is
worse than none.

### Deploy
```bash
npm run build 2>&1 | tail -5; echo "EXIT=${PIPESTATUS[0]}"
firebase deploy --only hosting
firebase deploy --only firestore:rules
FUNCTIONS_DISCOVERY_TIMEOUT=180 firebase deploy --only functions:<name>
```
The founder checks the LIVE site. A green build is not a deploy.

---

## 7. CHECKLIST — WHAT IS LEFT

### 7.1 Immediate (public profile, `docs/effects/25-public-profile.md` §6)
- [ ] Native profile screens: verify the ring, ambilight and token contract
      render correctly. **Source-only until an APK is built** — the founder
      batches native work into ONE build and will say when.
- [ ] Right rail on the public profile still differs from the owner's
      (Achievements missing). Decide with the founder whether it should mirror.

### 7.2 Effects still needing docs, then builds
`docs/effects/00-RULES.md` holds the full table. Not yet documented:

| # | Effect | Note |
|---|---|---|
| 14 | Profile accent + gradient | BUILT, never documented |
| 16 | Animated profile banner | `uploadBanner` already passes video through |
| 17 | Post-card accent | |
| 18 | **Milestone badge ART** | System is sound; **art rejected** — "those look like shit". Redesign the FACE, do not rebuild the data layer. |
| 19 | Profile signature flourish | |
| 20 | Animated avatar | founder overruled the Pro-only gate; needs a ladder slot |
| 21 | Animated crest in chat | |
| 22 | Accent tints presence app-wide | widest surface list after 01 |
| 23 | Animated entry ribbon | needs art |
| 24 | Top Supporter display | not an unlock; creator-toggled, shows tips GIVEN |

### 7.3 Known open items
- [ ] **Status ring** is wired and free, but only the two profile screens
      consume `avatarRing()`. Other avatar surfaces (feed, chat, lists) still
      draw their own rings. Unifying them is a real piece of work.
- [ ] `PUBLIC_LAUNCH_MS` in `src/utils/milestones.js` is a PLACEHOLDER
      (2026-09-01). Set once to the real launch instant; moving it retroactively
      grants or revokes badges on live accounts.
- [ ] `docs/effects/00-RULES.md` "Awaiting a founder decision" section lists
      effects proposed for cutting. Not confirmed.

---

## 8. QUICK REFERENCE

```
src/components/UserName.jsx              every name, every cosmetic
src/components/effects/                  effect components + README contract
src/components/prestige/                 the equip UI (3 tabs) + pickers
src/utils/rankUnlocks.js                 EFFECTS, RANK_UNLOCKS, accentFor, resolvers
src/utils/avatarRing.js                  single-occupancy ring priority
src/utils/nameFonts.js                   18 faces + demand loader
src/utils/color.js                       hsv/hex, ensureContrast, isHexColor
src/styles/surface.css                   .vg-orbit .vg-name-sweep .vg-recess .vg-profile
firestore.rules  cosmeticsAllowed()      server-side gate — mirrors the enums
scripts/username-*.mjs                   sites / codemod / repair / render-check
scripts/name-contrast-check.mjs          34 WCAG assertions
```

**Where a cosmetic lives:** `users/{uid}.cosmetics.*`. Opt-outs only in
`cosmetics.fx` (writing `true` for something unearned buys nothing, because
`isEffectOn()` ANDs it against server-written `vpLevel`).

**Adding a font or an enum value?** Add it to `NAME_FONTS` **and** to
`firestore.rules` in the same commit, or the picker offers something the server
refuses to store.
