# 06 — Custom typing indicator

**STATUS: SHIPPED + DEPLOYED + VERIFIED LIVE ON TWO ACCOUNTS (§8.2).**
One item is a founder decision, not a gap: squad chat, §8.2.3.
Challenger L2 = **level 32**. Rules: [00-RULES.md](00-RULES.md)

The band mapping, since the index writes slots as "band Lx": `RANK_TIERS`
(`src/utils/vpSystem.js:12`) puts Challenger at 31-40, so the second level of
that band is **32**. That number lives in `EFFECTS` and nowhere else.

---

## 0. WHAT THE PREVIOUS VERSION OF THIS DOC GOT WRONG

Both errors are recorded because they are the two failure modes this directory
exists to prevent, and both were caught by running the greps rather than
trusting the file.

### 0.1 The inventory was wrong: 6 surfaces, not 2

The doc claimed `grep -rl 'TypingIndicator' src --include=*.jsx` → 2 files and
called the effect "genuinely a two-file change". That grep is true and it is
also the wrong grep: it finds the shared component's own consumers, not the
places that draw a typing indicator. **Three surfaces draw one without ever
importing the component.** The real inventory is §3.

### 0.2 The relay concern does not apply at all

The doc spent its research section on `vergr-chat`'s `Msg` struct dropping
unknown fields, and recommended deriving the style from `vpLevel` to avoid a Go
redeploy. Measured:

```
grep -rn 'typing\|Typing' infra/chat/src/*.go
  → one hit, a code comment in search.go about a user typing "100%"
```

**The relay has no typing feature.** Typing rides the Firestore conversation
doc (`conversations/{id}.typingUsers = [{ uid, name, at }]`,
`src/hooks/UseTyping.js`), so there was never a Go change to avoid and the
constraint that shaped the recommendation does not exist.

That matters, because "derive from level, do not let the user choose" was
proposed as a concession to a cost that is not real. See §4.

---

## 1. THE LIVE BUG THIS EFFECT LANDS ON TOP OF

`ChatThreadScreen.jsx:3688` (before this change):

```jsx
<TypingIndicator />
```

`TypingIndicator({ users = [] })` opens with `if (users.length === 0) return
null`. **No `users` prop was ever passed, so the DM typing bubble has never
rendered.** What a user saw was the 26px avatar in its wrapper with nothing
beside it, because the wrapper is conditioned on `typingUsers.length > 0` while
its only visible child returned null.

The header line at `:3310` ("X is typing...") does work, which is why the bubble
being dead was never obvious.

## 2. Research — the technique, with sources

There IS a technique here, and the version in the repo does not implement it.

### 2.1 The reference implementation

Source: [Design Drastic — Typing Indicator Animation](https://www.designdrastic.com/snippet/typing-indicator-animation/),
which matches the canonical [CSS iMessage Typing Indicator](https://codepen.io/fusco/pen/XbpaYv)
and the [Messenger-style CSS walkthrough](https://youthsforum.com/2025/03/creating-a-facebook-messenger-like-typing-animation-with-css/).

| Property | Reference | Why it is that value |
|---|---|---|
| Period | **1.4s** | Slow enough to read as breathing, not loading |
| Dot | **8px** | Below ~6px, sub-pixel movement stops reading as movement |
| Keyframes | `0%,80%,100% { scale(0); opacity:.5 }` · `40% { scale(1); opacity:1 }` | The dot changes SIZE and BRIGHTNESS. Position alone is the weakest of the three |
| Stagger | **negative**: `-0.32s`, `-0.16s`, `0s` | The wave is already mid-flight on the first frame |

**The negative delay is the detail that matters most and is the one everybody
skips.** A positive stagger means all three dots sit at their 0% pose when the
element mounts, and the sequence needs a full cycle to establish. A typing
indicator appears and disappears constantly, so it is nearly always being
watched during exactly that first cycle.

### 2.2 What the repo had, and the measurement that condemns it

```jsx
<span className="w-[5px] h-[5px] bg-text-muted rounded-full animate-bounce"
      style={{ animationDelay: '0ms', animationDuration: '1s' }} />
```

Three faults, all measurable:

1. **`animate-bounce` is the wrong keyframe.** Tailwind's `bounce` is
   `translateY(-25%)` → `none`, designed for a scroll-hint chevron. **25% of a
   5px dot is 1.25px of travel.** That is not an animation, it is a shimmer.
2. **5px dots**, below the threshold where the reference's own geometry works.
3. **Positive delays** (0 / 150 / 300ms), so it starts flat. See §2.1.

Nothing about opacity or scale changes at all: brightness and size, the two
strongest channels, were both unused.

### 2.3 Accessibility — currently absent

Sources: [MDN — ARIA status role](https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Reference/Roles/status_role),
[WCAG 4.1.3 Status Messages](https://aaardvarkaccessibility.com/wcag-plain-english/4-1-3-status-messages/).

"Someone is typing" is a textbook status message: informational, not urgent,
must not steal focus. The correct treatment is `role="status"` (implicit
`aria-live="polite"`), announced when the reader is idle. The old component had
no role, no live region, and the label sat in a plain `<span>`. The decorative
dots must additionally be `aria-hidden` so a reader announces the sentence once
rather than the sentence plus three anonymous elements.

### 2.4 Motion

Source: [MDN — prefers-reduced-motion](https://developer.mozilla.org/en-US/docs/Web/CSS/@media/prefers-reduced-motion).

⚠ **`animation: none` is not a safe default here.** Every style in §5 has
keyframes whose 0% pose is dim or scaled down, so switching animation off
without also declaring a resting pose leaves a nearly invisible indicator. The
user must still be told somebody is typing. Each style therefore declares an
explicit static appearance inside the media query.

## 3. Surfaces — the exhaustive inventory

Produced by `grep -rn "is typing\|typing…\|typing\.\.\.\|typingUsers" src`, not
by grepping the component name (§0.1).

| # | Surface | File | Draws | Kind |
|---|---|---|---|---|
| 1 | DM thread bubble | `src/screens/messages/ChatThreadScreen.jsx:3676` | `<TypingIndicator>` | bubble |
| 2 | DM thread header | `src/screens/messages/ChatThreadScreen.jsx:3310` | "X is typing..." | inline |
| 3 | Squad thread footer | `src/screens/squads/SquadChatThreadScreen.jsx:1286` | its OWN `.typing-dots` (`src/styles/squad.css:452`) | inline |
| 4 | Desktop inbox rows | `src/components/MessagesListPanel.jsx:709, 735` | "typing…" text | inline |
| 5 | Mobile web inbox | `src/screens/messages/MessagesInboxScreen.jsx:628` | "typing…" text | inline |
| 6 | Native inbox | `src/screens/messages/native/NativeMessageScreens.jsx:496` | "typing…" text | inline |

**Native threads inherit for free and need no edit.**
`src/screens/messages/native/NativeChatThreadScreen.jsx` (8 lines) and
`src/screens/squads/native/NativeSquadChatThreadScreen.jsx` (13 lines) are
re-export wrappers around the two web screens, verified by reading both files.
This was checked rather than assumed, because "there are four profile views, not
one" is the most repeated error in this project.

`src/screens/messages/ChatDetailScreen.jsx` has **no** typing UI (zero matches)
and is not a surface.

### 3.1 Two shapes, one component

Surface 1 is a chat bubble. Surfaces 2-6 are one line of text. They are the same
effect at two sizes, so `TypingIndicator` takes `variant="bubble" | "inline"`
and there is exactly one place a style is defined.

## 4. Level-derived or user-chosen? — user-chosen

§0.2 removes the argument for deriving it. Choice then follows the precedent
already set on this ladder: `name_font` (L3) unlocks **18** faces and the user
picks one. This is the same shape, so it is one unlock at L32 that opens a
curated set, NOT one style bolted to each level.

### 4.1 Resolution costs zero reads, and is the reason it can be a free choice

The receiving client resolves the typist's style from a user doc **it has
already loaded for another reason**:

| Surface | Where the typist's doc already is |
|---|---|
| DM 1:1 | `otherUserLive` — `getUserById(otherUserId)`, `ChatThreadScreen.jsx:1120` |
| Group DM | `memberProfiles[uid]` — `resolveChatUsers(participants)`, `:1139` |
| Squad | `userByUid[uid]` — built from the members list, `SquadChatThreadScreen.jsx:399` |
| Inbox rows | `peekChatUser(uid)` — the in-memory identity cache |

No new fetch, no listener, no per-message lookup. If a profile is genuinely
missing the indicator falls back to `dots`, which is what everyone starts with
anyway, so a miss is invisible.

⚠ **This is also why the style is NOT carried in the typing entry.** Putting it
in `typingUsers[]` would have been a client-writable cosmetic that rules cannot
practically validate per array element. Read from the user doc instead: the
value is already gated by `cosmeticsAllowed()` in `firestore.rules` against a
server-written `vpLevel`, so a crafted write cannot equip a style above the
writer's level, and there is no second integrity story to maintain.

### 4.2 One free upgrade taken while here

`slimUser()` (`src/utils/chatIdentity.js:30`) is the subset persisted to
localStorage and rehydrated at module load so `peekChatUser` can render live
identity on the first frame. It dropped `vpLevel` and `cosmetics`, so on a COLD
start every chat surface lost name colour, typeface and gradient too until the
async refetch landed. Both fields are now persisted. They are small (an accent
hex, a font id, up to six gradient stops) and they fix a first-paint flash of
uncosmeticked names that was never filed.

## 5. The styles

Six, all pure CSS on at most four elements, colourable, and legible at 4px.

| id | Level | Shape | Motion |
|---|---|---|---|
| `dots` | — | three dots | The reference: scale + opacity, 1.4s, negative stagger. The default for everyone, unlocked or not |
| `wave` | 32 | three dots | Travelling rise, `translateY(-3px)` plus brightness, sine easing |
| `bars` | 32 | three bars | `scaleY` 0.35→1, a voice waveform |
| `orbit` | 32 | ring + light | One light circles a faint track, 1.6s linear. Deliberately rhymes with the avatar orbit ([15](15-avatar-orbit.md)) |
| `pixel` | 32 | three squares | Hard `steps(1)` blink, no easing at all. Retro, and the only one with no interpolation |
| `comet` | 32 | a track | A light sweeps left to right, the same idiom as the name sweep ([03](03-name-gradient.md)) |

### 5.1 Colour

The indicator is tinted with the typist's own accent via `accentFor()` — the ONE
accent resolver ([25](25-public-profile.md) §2) — but **only when a style is
equipped**. `dots` stays `--text-muted` for everybody, so nothing changes for
the 99% of users who have not unlocked this and the unlock reads as a real
change rather than a recolour.

One custom property carries it: `--vg-typing-ink`.

### 5.2 The seamless-loop trap, avoided by construction

`comet` translates a background image, which is [03](03-name-gradient.md)'s
exact failure mode: translating by anything other than one period of a periodic
image snaps every cycle. It is built the same way 03 was fixed — a 200% image
holding two identical cycles, animated `0% → 100%`, `90deg` so there is no
vertical component.

## 6. Implementation

| File | Change |
|---|---|
| `src/components/effects/triggers/TypingStyles.jsx` | NEW. The style map. Owns the look end to end |
| `src/components/effects/triggers/TypingStyles.css` | NEW. Colocated keyframes, per the `FirstBootIntro.css` convention |
| `src/components/effects/index.js` | Export it. The only import surface |
| `src/components/TypingIndicator.jsx` | Rewritten: `users` + `variant`, resolves the style, `role="status"` |
| `src/utils/rankUnlocks.js` | `TYPING_STYLES` table, `typingStyleFor()` resolver, `typing_style` ladder row at 32 |
| `src/screens/messages/ChatThreadScreen.jsx` | Pass `users` (the §1 bug) and the typist profile; header line uses the inline variant |
| `src/screens/squads/SquadChatThreadScreen.jsx` | Replace the hand-rolled `.typing-dots` with the component |
| `src/components/MessagesListPanel.jsx` | 2 sites, inline variant |
| `src/screens/messages/MessagesInboxScreen.jsx` | inline variant |
| `src/screens/messages/native/NativeMessageScreens.jsx` | inline variant |
| `src/utils/chatIdentity.js` | `slimUser` keeps `vpLevel` + `cosmetics` (§4.2) |
| `src/components/prestige/CosmeticEquip.jsx` | Picker in the **Effects** tab, live-animated previews |
| `firestore.rules` | `cosmeticMinLevel('typingStyle')` = 32 + the id enum |
| `scripts/vp-mirror-check.mjs` | Assert every style has keyframes AND is in the rules enum |

**The ladder row is `equip: true` and the effect id is `typing_style`.** There is
no `EFFECTS` row: `EFFECTS` is the on/off registry for automatic effects, and
this is a picker with an explicit "Default dots" option, so an opt-out toggle
would be a second way to say the same thing.

## 7. Verification — measured

Every one of these is a number or a boolean read out of the live page, not a
glance. Results recorded at the bottom of this file when run.

1. **The §1 bug is fixed:** with the other account typing, the DM bubble exists
   and has a non-zero rect. Before: `null`.
2. **Motion is real:** `getAnimations()` on a dot returns a running animation
   whose `effect.getTiming().duration` is 1400, and sampling
   `getComputedStyle(dot).opacity` at two paused `currentTime` values differs by
   > 0.3. This is the numeric form of "it actually animates", and it is what the
   old 1.25px bounce would have failed.
3. **Negative stagger:** the three dots' `animation-delay` are
   `-0.32s / -0.16s / 0s`.
4. **No JS timer per indicator:** patch `setInterval`/`setTimeout` counters, mount
   a thread with a typist, assert zero new timers attributable to the indicator.
5. **Accessibility:** the container is `role="status"`, the dot wrapper is
   `aria-hidden="true"`, and the accessible name is the sentence.
6. **Reduced motion:** with the emulation on, `animation-play-state` /
   `animation-name` resolves to none AND the dot's computed opacity is >= 0.5
   (visible), proving it degrades rather than disappears.
7. **Relay untouched:** `git diff --stat infra/` is empty. This is the proof the
   free path was taken.
8. **Every surface in §3** renders it, checked one at a time on a second
   account.

## 8. RESULTS — measured 2026-08-25 (SHIPPED + DEPLOYED)

`node scripts/typing-preview.mjs --measure` → **29/29**. The harness serves the
real stylesheet and drives it in the installed Chrome; it is repeatable, so
these numbers can be re-taken rather than believed.

| Style | Animation | Period | Opacity swing | Transform swing | Stagger |
|---|---|---|---|---|---|
| dots | `vg-typing-dots` | **1400ms** | 0.577 | 17.9 | **-0.32 / -0.16 / 0** |
| wave | `vg-typing-wave` | 1300ms | 0.547 | 6.96 | -0.3 / -0.15 / 0 |
| bars | `vg-typing-bars` | 1050ms | 0.447 | 13.9 | -0.24 / -0.12 / 0 |
| orbit | `vg-typing-spin` | 1500ms | 0 (rotation) | 80 | n/a |
| pixel | `vg-typing-pixel` | 900ms | 0.8 | 0 (steps blink) | -0.6 / -0.3 / 0 |
| comet | `vg-typing-comet` | 1500ms | 0 | 0 | 20 distinct bg positions |

- **Comet loop is seamless:** the element screenshotted at `background-position:
  0%` and at `100%` is **1473 bytes vs 1473 bytes, byte-identical**.
  Negative-tested by moving one stop from 62% to 70% (breaking the periodicity):
  1798 vs 1893, fails as it should.
- **Reduced motion:** all six report 0 running animations AND a brightest
  element at 0.75-1.0 opacity, i.e. they stop and stay visible.
- **Zero JS:** patching `setInterval`/`setTimeout` around a mounted indicator
  for 1.2s counts **0** timers created.
- **Gating**, 8/8 in a node pass: no profile → dots; equipped at L32 → the
  style; the same doc at L31 → dots; admin at L1 → the style; unknown id →
  dots.
- **Guards:** `npm run check` went 91 → 114 assertions. The three new classes
  were each negative-tested by deliberately breaking them: dropping `comet` from
  the rules enum (2 failures), drifting the rules level 32 → 31 (1), renaming a
  keyframe (1).
- Live bundle confirms all six keyframes and the fix shipped:
  `curl https://vergr.app/assets/index-*.css | grep vg-typing`.

### 8.1 Three defects the measurements caught, and one they did not

Recorded because two of them are the exact traps this directory exists for.

1. **`comet` rendered as a SOLID BAR and every number said it was fine.**
   `.vg-typing i` sets `background: var(--vg-typing-ink)` — a background
   *colour* — and the comet only overrode `background-image`, so the gradient
   painted on top of a solid fill. It animated, it moved, and it looped
   *perfectly seamlessly*, because a uniform bar does. **It was only visible by
   LOOKING at it.** Fixed with `background-color: transparent`, and the harness
   gained an assertion that mid-cycle must differ from the start, which no
   uniform fill can pass.
2. **The seam probe measured the wrong thing twice.** First it compared two
   stacked clones, which differed by 123 bytes because the second sat on a
   half-pixel boundary and antialiased differently. Then it read the last frame
   as `currentTime = duration - 1`, which lands on 0.067% rather than 0% — a
   0.07px shift, still a real difference. It now sets `background-position`
   directly. A measurement that moves its subject is measuring the subject's
   position.
3. **The reduced-motion probe asserted on the DIMMEST child**, which failed
   `orbit` — whose track is a deliberate 0.26-opacity ring, the groove the light
   runs in. The probe was wrong, not the effect.

The comet's first stop distribution was also rejected on sight after rendering:
a symmetric ramp lit half the track softly at both ends and read as a filled
pill rather than a light travelling. It is now a sharp head with a long tail
behind it (§5, and the comment in the stylesheet).

### 8.2 The live two-account pass — DONE, and it found two more bugs

Run on `vergr.app` in two Chrome windows, **@vergr** typing and **@Verion**
watching, reached by navigating (profile → VP card → Appearance → Effects; then
the inbox → the DM), not by pasting URLs.

**Measured on the VISITOR's screen while the other account typed:**

```
3 indicators live, all three from the TYPIST's doc:
  inbox row     vg-typing--comet  ink #f04060  --vg-typing-d 4px  running
  thread header vg-typing--comet  ink #f04060  --vg-typing-d 4px  running
  thread bubble vg-typing--comet  ink #f04060  --vg-typing-d 7px  running  role=status
```

`#f04060` is Vergr's **Ember** accent, so the indicator resolved from the
typist's profile and not the viewer's — the thing §4.1 exists to guarantee.
`aria-hidden="true"` on every glyph; `role="status"` on the bubble only.

- The **§1 bug is fixed in the real app**: the bubble draws.
- Equipping **Comet** wrote successfully (rules accept it) and survived a full
  reload, then switching to **Levels** changed what the other account saw.
- The **level gate holds on a real non-admin account**: @Verion at L1 sees
  "Custom typing indicator unlocks at level 32" instead of the picker.

#### 8.2.1 BUG FOUND LIVE — `useTyping` died on a cold load (fixed, deployed)

Reproduced: reload a DM, have the other account type. The **inbox row said
"typing…" while the thread said "ACTIVE NOW"**.

`src/hooks/UseTyping.js` opened its subscription with
`if (!chatId || !auth.currentUser) return;` and depended on `[chatId]` alone. On
a cold load straight into `/messages/:id` — a reload, a pasted link, a push
notification, the native app's launch route — Firebase has not restored the
session yet, so the effect bailed and **nothing ever re-ran it. The thread's
typing listener was dead for that entire session.** The inbox subscribes
elsewhere, which is why it kept working and made this look like a rendering
fault rather than a dead listener.

Now tracks auth with `onAuthStateChanged` and includes the uid in the deps.
Same class as [[reference-auth-null-is-not-signed-out]]. Verified by A/B on the
same navigation: broken before the deploy, all three surfaces after.

#### 8.2.2 BUG FOUND BY READING — the app's OWN Reduced Motion switch (fixed, deployed)

There are **two** reduced-motion switches and §2.4's media query only catches
one. Settings → Appearance → Reduced Motion sets
`html[data-reduced-motion="true"]`, and `index.css` answers it with a blanket
`animation-duration: 0.001ms; animation-iteration-count: 1`. That does not stop
an animation, it **fast-forwards it to its final keyframe** — which for these
styles is the RESTING pose. Measured without a fix: `pixel` 0.20 opacity, `dots`
0.42, `wave` 0.45. A user with Vergr's own accessibility setting on would have
been told nothing at all.

The same static poses are now declared for the attribute. Verified **on the live
app** with @Verion's own setting toggled on: `animation-duration: 1e-06s`
(the fast-forward, exactly as diagnosed) and all three indicators still at
**0.75** opacity and plainly visible. Harness is now 35 assertions and the new
class was negative-tested (removing the block drops dots/wave/pixel below 0.5).

#### 8.2.3 SQUAD CHAT — the indicator is wired, the STATE never existed

Surface 3 renders nothing, and it never could. Verified in source, not guessed:

- `SquadChatThreadScreen.jsx:298` destructures `{ typingUsers, clearTyping }`
  and **never takes `setTyping`**, so squad chat has never ANNOUNCED typing.
- It calls `useTyping(squadId, 'squad')`; the hook takes one argument, so the
  second is ignored and it subscribes to `conversations/{squadId}` —
  **a document nothing in the codebase ever creates** (`grep` for it returns
  zero writers). `updateDoc` on a missing doc rejects, and both fallbacks are
  swallowed by `.catch(() => {})`.

### ❌ DECIDED (founder, 2026-08-25): squad typing is NOT being built

> "no need"

The component stays wired, so it costs nothing and renders correctly the day
squad typing ever produces state. Do not re-raise it as a gap.

So the `.typing-dots` markup replaced in §6 was dead code, which is why swapping
it changed nothing. **This is NOT a regression and not part of this effect.**
Squad chat's messages live in `squads/{id}/messages` (Firestore, not the relay),
so making typing work there is a design decision with a real cost: the obvious
home is the squad doc, and every member already holds a listener on it, so a
keystroke burst bills a read per member. **Founder decision needed.** The
component is in place, so the day squad typing produces state it renders with
the typist's style and no further work.
