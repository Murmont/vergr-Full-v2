# Effect 22 — accent presence

**Ladder slot on the scope table:** Ascendant L3.
**Status: DOCUMENTED, NOT BUILT. Needs a founder decision on scope before any
code, because the honest version is narrower than the line on the scope table.**

The scope table says "Accent tints presence app-wide" and notes "widest surface
list after 01". This document exists to say plainly that **the app-wide reading
is the effect that was already deleted once**, and to propose the version that
survives the founder's own arguments.

---

## 1. The problem with the line as written

Two rulings already on the record kill "app-wide" between them.

**The theme system, deleted 2026-08-24.** From CLAUDE.md: a theme "has to restyle
EVERY surface (left nav, right rail, post cards, and hundreds of inline
colours), and every surface missed looked like a bug rather than a theme. That
is a whole-app design system, not a background picker. Do not attempt it again
without that being the explicit scope." An accent tint applied app-wide is the
same build with a smaller palette. It fails the same way and for the same
reason: partial coverage reads as breakage, not as identity.

**Effect 17, cut 2026-08-27.** The founder cut the post-card accent because
"Post authors already carry their name colour, gradient and typeface via
`<UserName>`; a second accent on the same card would give a rainbow feed."

⚠ **That second argument generalises, and generalising it is the main finding of
this document.** If one accent per post card gives a rainbow feed, then accent
tinting a user's presence across shared surfaces gives a rainbow app. The feed,
the DM list, search results, follower lists, the viewer list on a stream, squad
rosters: every one of them shows many users at once. Tinting each one's row in
their own colour is exactly what was rejected, applied more widely.

So the surfaces where an accent can go are not "everywhere". They are the
surfaces where **exactly one user is present at a time**.

---

## 2. What other platforms actually do (checked, not assumed)

| Platform | Per-user colour? | Where it applies |
|---|---|---|
| Discord | yes, role colour | **the NAME only** — member list, message author, mention chip. Never a surface, never a panel, never chrome. |
| Twitch | yes, channel brand colour | **the channel page only.** It does not follow the streamer into the directory, the sidebar, or anyone else's page. |
| YouTube | banner + branding | **the channel page only.** |
| TikTok | none | no per-user accent exists |

Two patterns, and both are already half-built here:

- **Discord's pattern is text-only, and Vergr already ships it.** `<UserName>`
  resolves name colour (L12), typeface (L3), gradient (L63) and the L100 glow.
  There is no gap to fill and no room to add to it without the rainbow the
  founder cut 17 over.
- **Twitch's pattern is one-owner-surface, and Vergr ships exactly one of them.**
  The profile carries accent, gradient, orbit, ambilight, banner and music. The
  other one-owner surface in the product carries none of it.

**That other surface is the live stream.** When you are watching someone
broadcast, the whole screen belongs to that one person. It is the single largest
one-owner surface in the app and it is entirely un-personalised.

---

## 3. Proposed scope

> **A creator's accent colours the live stream that belongs to them.** Nothing
> else changes. No shared surface is touched.

That is the whole effect. It is Twitch's channel-colour, on the surface where
Vergr already has the audience.

**Explicitly OUT, and each for a stated reason:**

| Surface | Why not |
|---|---|
| Feed / post cards | effect 17, cut by the founder. Rainbow feed. |
| DM threads, squad chat | two or more people; whose accent wins is unanswerable, and bubble themes (12) already own that surface |
| Search, follower lists, browse | many users per screen; same rainbow argument |
| Stream chat messages | many users; `<UserName>` already carries the name colour, which is Discord's pattern and is enough |
| App chrome (nav, rails) | this is the deleted theme system |
| Notifications drawer | many senders |

---

## 4. Surface inventory — exhaustive

The rule that produced this section: the avatar orbit shipped visible to nobody
but its owner because the mount points were never inventoried. Every place the
proposed effect must appear, and every place it must not.

### Must render

| # | File | What | Notes |
|---|---|---|---|
| 1 | `src/screens/streams/ViewerStreamScreen.jsx` | desktop web viewer | `hostInfo` already holds the full user doc |
| 2 | `src/components/streams/MobileLiveViewer.jsx` | mobile web viewer AND native | `hostInfo` already holds the full user doc |
| 3 | `src/screens/streams/native/NativeViewerStreamScreen.jsx` | native | re-exports #2, so it is covered by #2 — verified, not assumed |

⚠ `ViewerStreamScreen` delegates to `MobileLiveViewer` when `isTouchPhone`
(`ViewerStreamScreen.jsx:86`), so #1 and #2 are two real components, not one.
Both need the change. Two files, three routes.

### Must NOT render

`BroadcasterScreen` and `NativeBroadcasterScreen`. The broadcaster is looking at
their own controls, not at their channel; tinting a control surface in the
operator's own colour makes state colours (live, muted, dropped) harder to read.
Same reason profile music is silent on the owner's own profile.

### Zero-cost claim, checked

Both viewers already do `getDoc(doc(db,'users', streamDoc.hostUid))` and store
`{ id, ...snap.data() }` — `ViewerStreamScreen.jsx:221` and
`MobileLiveViewer.jsx:377`. `cosmetics` and `vpLevel` are already in hand. **The
effect adds no read.** Same argument that made the chat crest free.

---

## 5. What "colours the stream" means, concretely

Not a wash over the video, and not a re-skin of the chrome. Three things, all of
which currently use a hardcoded violet:

1. **The tip / gift call-to-action** takes the host's accent instead of
   `linear-gradient(135deg, #7B1FFF, #B44FFF)`.
2. **The live pill and the boost timer** take the accent.
3. **A single accent hairline** under the stream title block.

⚠ **The video is never tinted and the background is never tinted.** Ambilight
already owns the light coming off the video, and two colour systems on one
surface is the `rankCollections.js` failure: two sources disagreeing, neither
file showing the disagreement.

⚠ **Contrast is enforced in code, not trusted to the palette.** The accent is
free hex (`cosmetics.accentHex`), so it must go through `ensureContrast()` from
`utils/color.js` before it is painted behind white text — the same guard
`chatBubbleColors()` uses. `inkFor()` from `profileThemes.js` must NOT be used:
it only darkens, which is catastrophic on Vergr's near-black surfaces.

⚠ **The Vanguard mask beats it.** A masked persona shows no accent, exactly as
`PublicProfileScreen.jsx:295` already does.

---

## 6. Ladder placement

Ascendant is levels 91-99 (`RANK_TIERS`, `vpSystem.js`). "Ascendant L3" = **L93**,
which already carries a boost token. The hollow run is **94-99**.

Proposal: place this at **L94**, the first hollow level, so it opens the dead
stretch rather than landing in the middle of it. That fills one of six.

⚠ **It does not solve L94-99.** Five levels and roughly 55,000 VP remain hollow
after this ships. `docs/effects/26-LADDER-COVERAGE.md` lists the options; the
only one with real weight at that height is more boost tokens, and that is an
economy change and therefore a founder decision, not a session decision. This
document does not pretend otherwise.

---

## 7. Verification, and it must be by measurement

The standard set by effects 21 and 06: numeric assertions plus a render, with
every probe carrying a control run that proves it can see the fault it exists to
catch.

`scripts/boost-accent-preview.mjs --measure` (to be written alongside the build):

| # | Assertion | Control that proves the probe works |
|---|---|---|
| 1 | the tip CTA's computed background contains the host's accent, not `#7B1FFF` | run with a host who has no accent; must read the violet |
| 2 | contrast of CTA label against CTA background >= 4.5:1 for all 12 preset accents AND for a deliberately awful free hex (`#FFFF00`, `#111111`) | remove the `ensureContrast` call; the run must fail |
| 3 | the accent painted is the HOST's, never the VIEWER's | give viewer and host different accents; assert the host's |
| 4 | a Vanguard-masked host paints no accent | unmask; the accent must appear |
| 5 | the broadcaster screens paint no accent | — |
| 6 | below L94 the host paints no accent | set the host to L94; it must appear |

Plus a real render at 390px and at desktop width, because "a defect can pass
every numeric assertion" — `comet` shipped as a solid bar through a full
measurement round.

---

## 8. Open question for the founder

**Is this what effect 22 was meant to be?**

The scope table says "app-wide". This document argues app-wide is the deleted
theme system and that the effect-17 cut extends to it, and proposes
one-owner-surfaces instead, which in practice means the live stream.

Three ways to go:

1. **Build as scoped above** (live stream only, L94). Small, safe, fills one
   hollow level, gives creators a real channel identity.
2. **Cut 22 entirely.** Defensible: `<UserName>` already delivers Discord's
   pattern, and the profile already delivers Twitch's. The remaining gap is one
   surface, and it may not be worth an Ascendant slot.
3. **Something else was meant by it** — in which case this document is wrong
   about the intent and should be rewritten before any code is cut.

**Nothing gets built until that is answered.** Starting an effect without its
document being settled is what got ambilight rejected three times.
