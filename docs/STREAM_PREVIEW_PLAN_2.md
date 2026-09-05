# Stream simulator — audit #2: roles, controls and copy

Second audit. The first one measured geometry and I then declared the screens
correct, which was wrong. This one asks three different questions of every
control on every screen:

1. **Does this belong to this ROLE?**
2. **Does it DO anything?**
3. **Is its LABEL true — does the thing it names exist?**

---

## Why audit #1 missed all six of these

Every probe I wrote measured **boxes**: overlaps, aspect ratios, sliced text,
occlusion. Mod tools on a viewer's screen have perfect geometry. A "Gift a Sub"
button for a feature that does not exist has perfect geometry. A composer with no
send button has perfect geometry.

**A geometry audit cannot fail on a permission bug**, so reporting "all 20 states
clean" was true of the only axis I checked and worthless as the claim I made.

Worse, two of my probes were *incapable* of catching what they were pointed at:

- `getBoundingClientRect` + computed style says a row is "visible" when something
  is painted over it.
- `elementFromPoint` ignores `pointer-events: none`, so a deliberately
  click-through chat overlay reports as occluded, and a genuinely buried one
  reports the same. **For "is it visible", the only ground truth is the pixels.**

---

## FINDINGS

### 1. The authority model is inverted — the single worst defect

The real product already has a precise two-tier rule, implemented server-side in
`functions/streamChatMod.js` and enforced on every callable:

| Authority | Gate | Powers |
|---|---|---|
| **Host only** | `loadStream()` | slow mode, banned words, followers-only, TTS, appoint moderators |
| **Host or moderator** | `loadStreamForMod()` — `hostUid === uid \|\| moderatorUids.includes(uid)` | mute, unmute, ban, unban, pin a message |

The preview ignores all of it:

| # | Defect | Evidence |
|---|---|---|
| 1a | **Every desktop VIEWER gets the full moderation panel** — Slow mode, Followers-only, Subscribers-only, Timeout/ban a user, Clear chat. | `PreviewDesktopViewer.jsx:201`, rendered unconditionally. |
| 1b | **The panel's own footnote says "Broadcaster / moderator only".** It documents the gate and does not implement it. | Same file, the panel body. Same class as the three inert kill switches in `CLAUDE.md`. |
| 1c | **The BROADCASTER has no moderation control at all**, on desktop or mobile. Its "More" sheet is Invite a co-host / Studio layout / Stream settings. | Enumerated every labelled control in the file. Zero moderation. |
| 1d | **The panel mixes the two tiers**, so even for a real mod it offers host-only powers (slow mode, followers-only). | Against `loadStream` vs `loadStreamForMod`. |
| 1e | **"Chat settings" mixes authorities too.** "Verified accounts only" decides who may POST (host/mod); "Show timestamps" and "Readable chat colours" are personal viewer preferences. | Same file. |

**Rule to implement:** a viewer sees moderation controls only when they are the
host, in `stream.moderatorUids`, or an active Vanguard — and then only the tier
their role grants. The simulator gets a **Role** control (Viewer / Moderator /
Vanguard) so all three states can be captured.

### 2. "Gift a Sub" names a feature that does not exist

`Subscribe` and `Gift a Sub` sit side by side and do the same nothing — both are
unwired. Grepped for `giftSub` / `giftMembership`: **no such callable anywhere.**

What DOES exist: `functions/memberships.js` → `subscribeMembership({creatorId,
tierId, paymentType:'coins'})` — the fan pays the tier's `priceCoins`, the creator
keeps 90%, the sub auto-renews.

So the two buttons should differ like this:

- **Subscribe** — you buy a membership for yourself.
- **Gift a Sub** — you pay the same price, **someone else** receives the
  membership. Creator economics identical.

### 3. "Cheer with VP" must go (founder)

`PreviewDesktopViewer.jsx:255`. It offers 50/100/500/1000 VP and says "Premium
animated gifts — price tiers pending".

It is wrong three times over: **VP is progression, not currency** (coins/VC are
the only spendable thing); **gifting is DEFERRED** in `CLAUDE.md` and has no
catalogue; and "price tiers pending" advertises an unbuilt feature on a screen
whose captures go on the Play listing.

Removing: the cheer button in the composer row and the whole cheer panel.
**Keeping** the VP crystal + balance beside it — that is the viewer's own rank
progress, a display and not a spend.

### 4. The desktop BROADCASTER cannot send a message

The chat column renders `PreviewChat` with no `composerExtras`, so the footer is
a bare "Say something…" placeholder: no send button, no emoji, nothing. The
mobile broadcaster has mic/camera/more; desktop has nothing at all.

### 5. THREE CHAT REGRESSIONS I CAUSED, ONE ROOT CAUSE

Swapping `vh` → `%` was right in principle and wrong in execution. A percentage
height is only definite **if the parent's height is**, and in three places the
parent is an absolutely-positioned box with `bottom: 10` and an AUTO height:

| Screen | Symptom | Measured |
|---|---|---|
| Viewer mobile solo immersive | **No chat at all** | `30%` box collapsed |
| Viewer mobile co-host grid 3 / 4 | Chat behind the stage | `34%` overlay collapsed |
| Viewer mobile co-host panel | One row in a sliver | same |

⚠ I hit this exact bug on the broadcaster, fixed it there by anchoring `top` as
well as `bottom`, and **never carried the fix to the viewer.** That is the fourth
time in this session that a fix landed on one of two sibling surfaces. Counting
by hand does not work; the guard has to enumerate.

⚠ And at 3–4 seats the stage is 0.667 aspect = 589px tall on a 393px frame, so
with a header, goal and composer there is **no room for a chat panel at all**.
`chatOverlays = guestCount > 2` already exists for exactly this; it is the
collapsed height that broke it, not the logic.

### 6. Dead controls (measured live via the React fibre, not by reading source)

| Screen | Unwired |
|---|---|
| Viewer desktop | Follow, Subscribe, Gift a Sub, **Chat (the send button)** |
| Viewer mobile immersive | More, Invite friends, Share |
| Viewer mobile co-host | Invite, Gift Box, Share |
| Broadcaster mobile | — (only `close`) |

`close` / `Leave` / `End Stream` are navigations and correctly inert in a
simulator. The rest are affordances the founder will want to demonstrate.

---

## THE PLAN

Order matters: regressions first, then the authority model, then features.

### Step 1 — the three chat regressions (blocking, my fault)

`PreviewMobileViewer` bottom stack and `PreviewViewerScreen`'s co-host overlay
both get a **definite** height by anchoring `top` as well as `bottom`, exactly as
the broadcaster already does. Guard rule: no `%` height whose parent is an
absolutely-positioned box without a `top`.

### Step 2 — one authority resolver, mirrored from the server

New `previewRoles.js` exporting `canModerate(role)` / `canConfigureChat(role)`,
mirroring `loadStreamForMod` vs `loadStream` byte for byte in intent:

```
host        → configure + moderate
moderator   → moderate only
vanguard    → moderate only
viewer      → neither
```

- A **Role** segmented control joins the right rail (Viewer / Moderator /
  Vanguard) so all three are capturable.
- The gavel button renders only when `canModerate`.
- The mod panel splits: host-only rows (slow mode, followers-only, banned words)
  are hidden from a mod, shown to the host.
- "Chat settings" keeps only real viewer preferences; "Verified accounts only"
  moves into the moderation panel where it belongs.
- **The broadcaster gets the moderation panel** — desktop as a chat-column
  button, mobile in the More sheet.

### Step 3 — Cheer with VP removed

Composer cheer button and panel deleted. VP balance stays.

### Step 4 — Gift a Sub becomes real, in the preview

A sheet: pick the tier, pick a recipient (a named viewer, or "gift to a random
viewer in chat"), see the price in **coins**, confirm; an on-stream alert fires
through the existing `SubAlertOverlay` reading "X gifted a sub to Y".

⚠ **THE BACKEND IS NOT IN THIS STEP AND NEEDS YOUR CALL.** The preview can show
the flow honestly today because the economics are already settled — a gift sub
reuses `subscribeMembership`'s exact price and 90% split, nothing invented. Three
things are genuinely undecided and are yours, not mine
([[feedback-no-unilateral-financial-choices]]):

1. **Must a gifter be subscribed themselves?** (Twitch: no. Recommend: no.)
2. **Does a gifted sub auto-renew, and on whose wallet?** (Recommend: it does
   NOT renew — it grants one paid period and lapses, so nobody is billed for a
   stranger indefinitely.)
3. **Bulk gifting** (5 / 10 / 20 at once) — recommend yes later, not v1.

### Step 5 — the desktop broadcaster composer

Send button + emoji picker, matching the viewer's composer row.

### Step 6 — wire the dead affordances

Follow, Subscribe, Gift a Sub, send, Invite, Share, Gift Box, More — each opens
its sheet or toggles its state, so every control in a capture is demonstrable.

### Step 7 — guard rules that would have caught this class

1. **Role gating:** no moderation control may render without a `canModerate`
   check in scope.
2. **Self-documenting gates:** a component whose copy says "only" must have a
   conditional guarding it.
3. **No unbuilt-feature copy:** "coming soon", "pending", "TBD" are build
   failures in this directory — captures go on the Play listing.
4. **Every control is wired:** a button with no `onClick` fails, with an explicit
   allowlist for navigations (`close`, `Leave`, `End Stream`).
5. **Percent heights need a definite parent.**

### Step 8 — verify by looking

Screenshot every state and read it, not just measure it. The regressions in §5
were all invisible to measurement and obvious in a screenshot.

---

## STATUS — all steps done, verified on the live site (2026-09-01)

| Step | Done |
|---|---|
| 1 | Three chat regressions fixed. `--vg-frame-h` is published by the frame and the boxes size off it. Chat measured present on all 14 live states. |
| 2 | `previewRoles.js`. Gavel gated: plain viewer **no**, moderator **yes**, vanguard **yes**, back to plain **no** — all four measured. Moderator sees only mute/ban/pin/clear + "Chat rules are set by the broadcaster"; the host sees both tiers. |
| 3 | Cheer with VP gone (button + panel). Replaced by a coin button, which is a real spend. VP balance kept — it displays progression, not a spend. |
| 4 | Gift a Sub is a real flow: recipient picker (named viewers + "Someone in chat"), the SHIPPED tiers and prices, on-screen confirmation of what the recipient gets. |
| 5 | Desktop broadcaster composer has emoji + Send. |
| 6 | Follow, Subscribe, Gift a Sub, Invite, Gift Box, Share, More all wired. |
| 7 | Guard rules 26 + 27, negative-tested. **585 assertions.** |

### Still needs YOUR decision before any of this reaches the real product

The preview shows the gift-sub flow honestly because it reuses the shipped price
and split. The BACKEND (`giftMembership`) is not built, and three things about it
are yours, not mine:

1. Must a gifter be subscribed themselves? (Recommend: no.)
2. Does a gifted sub auto-renew, and on whose wallet? (Recommend: it does NOT —
   one paid month, then it lapses. The preview copy already says this.)
3. Bulk gifting (5/10/20). (Recommend: later, not v1.)

### What I broke while fixing, and caught by measuring

- **My own new guard rule passed its negative test when it should have failed.**
  `src.includes('canModerate(')` is a substring test over a WHOLE FILE, so
  ungating the gavel still passed — the file mentions it elsewhere. It now slices
  the 260 characters before the control and asserts the gate is in THAT scope.
  Third time this exact shape has fooled a guard here.
- **My unbuilt-copy rule flagged `<input placeholder="…">`** — an HTML attribute,
  not prose. Narrowed to real copy.
- **There are TWO "More" sheets in the broadcaster file** and my moderation row
  reached one, so the SOLO broadcaster still had no way in. Rule 27 counts the
  sheets against the rows.
- **A panel outlived its permission:** opening moderation as a moderator and then
  switching to a plain viewer left it on screen. Derived at render now.
