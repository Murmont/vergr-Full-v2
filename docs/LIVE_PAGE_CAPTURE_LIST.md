# Live page — capture list and how each one is shown

Everything below is captured from `/admin/stream-preview`. Nothing needs a real
broadcast. Target page: `/platform/learn/live`.

## Rules that apply to every capture

- **Record, do not screenshot, anything with motion in it.** The coin counter,
  the entrance ribbon and the hearts are the things that make the page feel
  alive; a still of them is a still of a pill.
- **Remove the device frame in the tool** (already done) and composite into a
  real frame afterwards, the way `/platform` does its hero.
- **One upload per tile.** A co-host capture with the same clip in two tiles
  reads as a bug, which is why there are now five slots.
- **Chat rate 3s** for stills (readable), **1s** for video (feels busy).
- **Fire the event, then wait ~400ms before you start the take** so the entrance
  animation is not clipped at the front.

---

## A. Hero — replaces the current annotated still

**Capture:** solo viewer, mobile, **video**, 8-10s loop.
**Set up:** stage video loaded, facecam loaded, tip goal at about 60%, chat at
1s. Fire one tip at ~2s and one entrance at ~5s.
**Why:** the current hero is a static screenshot with leader lines drawn to it.
The lines stay; the art behind them becomes a silent looping video, so the
numbers in the callouts are visibly moving while you read them.
**Shown as:** same diagram, `<video muted loop playsinline>` in place of the
`<img>`, poster frame = the first frame so nothing pops in.

## B. "Going live takes about a minute"

**Capture:** Go Live phase, mobile, **3 stills** — empty form, form filled,
gate meter satisfied.
**Shown as:** three frames stepping left to right on desktop, a swipe row on
mobile. No annotation; the sequence is the point.

## C. "This is what your stream looks like" — broadcaster side

**Capture:** broadcaster, desktop, **still**, layout "Screen + facecam",
PiP bottom-right.
**Second still:** the same with the layout menu open, so the four layouts are
visible.
**Shown as:** a two-up. Left = what the viewer gets, right = the controls you
had to touch to make it. This section currently has neither.

## D. "Everyone knows when you turn up"

**Capture:** solo viewer, mobile, **video**, 4s. Fire entrance by rank three
times in a row (rookie, then mid, then Ascendant) so the ribbon art changes.
**Shown as:** a short loop beside the copy, cropped tight to the ribbon — not
the whole phone. The point is the ribbon, and a full phone shrinks it to nothing.

## E. "Everyone watches what you sent" — the tip feed

**Capture:** solo viewer, mobile, **video**, 6s. Fire tip four times: the
script sends the same person twice, so the counter visibly climbs rather than
adding a row.
**Shown as:** cropped to the bottom-left corner of the phone, played at 1x on
loop. This is the single best "it feels alive" asset on the page and there is
currently nothing for it.

## F. "Nobody streams alone" — co-host

**Capture:** co-host, **2 stills and 1 video**:
- 2 publishers (stills, both mobile and desktop)
- 4 publishers (still, desktop)
- 2 publishers with chat running (video, 5s)
**Set up:** stage + guest1 + guest2 + guest3 all loaded with DIFFERENT clips.
**Shown as:** the 4-up still is the section's anchor image; the 2-up video sits
beside the copy. The section has no image at all today.

## G. "Getting paid"

**Capture:** viewer, mobile, **still**, tip sheet open on the gift-box icon.
**Second still:** the supporters sheet (tap the cluster).
**Shown as:** two phones overlapping at a slight offset. Gold is the accent on
this section already, and these are the only two money surfaces a viewer sees.

## H. "Your chat, your rules"

**Capture:** Other → Moderation, desktop, **still**.
**Shown as:** a single wide screenshot, full-bleed inside the band, dimmed at
the edges. It is a dense screen; cropping it makes it unreadable.

## I. "It does not fall apart when your wifi does"

**Capture:** nothing. This section is about behaviour, not UI, and a screenshot
of a stream that is working does not show that it recovered.
**Shown as:** leave as copy. Do not invent a "reconnecting" mock — that is a
state the simulator does not have and faking it would be a claim we cannot back.

## J. Stream ended

**Capture:** Ended phase, mobile, **still**.
**Shown as:** small, in the FAQ band. Low priority.

---

## Order to do them in

1. **A, E, F** — the three that change how the page feels. A and E are video.
2. **C, G** — the two sections that currently have no image at all.
3. **B, D** — sequences, more work per unit of payoff.
4. **H, J** — nice to have.

## What I need from you before wiring any of it

- Where the files land: `public/marketing/live/` needs its own `firebase.json`
  headers entry or the catch-all `**` rule serves them `no-store` and they
  re-download on every page load.
- Video format: WebM is right for Chrome/Android/desktop, but **Safari on iOS
  needs an MP4 fallback** or the hero is a black box on every iPhone. Two files
  per video, `<source>` both.
- A budget per file. A 10s 1080p WebM is comfortably 2-4MB; four of those in the
  hero band is a slow page. My suggestion is 720p wide for anything cropped to a
  corner, 1080p only for the hero.
