# Media capture list: what to shoot for the public pages

Written 2026-09-04. Every slot below was measured on the live site, not assumed.
Every capture names the exact `/admin/stream-preview` configuration that produces
it, so a capture session is mechanical rather than a hunt.

**Why this exists:** the public pages currently carry illustrations and one
duplicate. Real product frames are the single biggest lever on "looks indie",
because an illustration says "we drew what it might look like" and a screenshot
says "this is the product".

---

## 1. The slots that exist today, measured

| Slot | File | Natural size | Rendered | Ratio | What it is now |
|---|---|---|---|---|---|
| Landing hero, desktop | `/brand/platform-hero-desktop.webp` | **2000 x 1196** | 884 x 528 | 1.67 | laptop mock, transparent webp |
| Landing hero, phone | `/brand/platform-hero-mobile.webp` | **2505 x 2116** | 380 x 321 | 1.18 | angled phone, transparent webp |
| Slide: Live Streaming | `/brand/slide-live.webp` | **2000 x 2000** | 676 x 676 | 1:1 | square |
| Slide: Connect | `/brand/slide-connect.webp` | 2000 x 2000 | 676 x 676 | 1:1 | square |
| Slide: Find Squads | `/brand/slide-squads.webp` | 2000 x 2000 | 676 x 676 | 1:1 | square |
| Slide: Payments | `/brand/slide-payments.webp` | 2000 x 2000 | 676 x 676 | 1:1 | square |
| Slide: Co-streaming | **reuses `slide-live.webp`** | | | | ⚠ see below |
| Learn Live art | `/brand/live/viewer.webp` + `@2x` | 447w / 894w | | | alpha |
| Social share video | `/og/share.mp4` (1.7 MB) + `share-poster.jpg` | | | | opengraph |

⚠⚠ **THE CO-STREAMING SLIDE SHOWS THE SOLO STREAMING PICTURE.** Five slides, four
images: `slide-live.webp` is used for both "Live Streaming" and "Co-streaming"
(`PublicMarketingScreens.jsx`, SLIDE_DATA). Two different features illustrated by
one image is exactly the tell you are trying to remove, and it is also the slide
where the product has something genuinely distinctive to show. **Highest-value
single capture on this list.**

⚠ Slides are **SQUARE**. A 16:9 stream frame does not fill a 1:1 slot, so each
slide is a composition (device frame plus surrounding scene), not a raw grab.

---

## 2. The stream captures, enumerated

Every row is a `/admin/stream-preview` configuration. Columns are the controls in
the right-hand rail, in the order you set them.

### 2a. Viewer, the ones that sell watching

| # | Phase | Role | Device | Layout | State to set | Why it earns a slot |
|---|---|---|---|---|---|---|
| V1 | Live | Plain viewer | Desktop | Solo | default, chat busy | The desktop watch experience. Landing hero, desktop. |
| V2 | Live | Plain viewer | Mobile / iPhone 15 Pro | Solo · Immersive | default | The phone watch experience. Landing hero, phone. |
| V3 | Live | Plain viewer | Mobile | Solo · **Split** | default | Shows video plus chat as two surfaces. Good for "chat rolling in". |
| V4 | Live | Plain viewer | Mobile | Solo · **Landscape** | default | Landscape source, chat overlaid, PiP box. |
| V5 | Live | Plain viewer | Desktop | **Co-host** | default | ⚠ **The co-streaming slide.** Two publishers, one chat. |
| V6 | Live | Plain viewer | Mobile | Co-host | default | Phone co-host column. |
| V7 | Live | Plain viewer | Mobile | Solo | fire **Tip** | Gold alert plus the goal bar moving. Sells the economy. |
| V8 | Live | Plain viewer | Mobile | Solo | fire **Subscribe** | The sub ribbon. |
| V9 | Live | Plain viewer | Mobile | Solo | fire **Entrance** | Rank ribbon, the thing nothing else has. |
| V10 | Live | Plain viewer | Mobile | Solo | fire **Poll** | Live poll card with a countdown. |
| V11 | Live | Plain viewer | Mobile | Solo | **Audio only** | A whole format competitors do not show. |

### 2b. Broadcaster, the ones that sell creating

| # | Phase | Role | Device | Layout | State to set | Why |
|---|---|---|---|---|---|---|
| B1 | Live | Broadcaster | Desktop | Solo | default | The studio. The "I could run my channel here" frame. |
| B2 | Live | Broadcaster | Mobile | Solo | default | Going live from a phone, which is the real onboarding story. |
| B3 | Live | Broadcaster | Desktop | **Co-host** | default | Two-up studio with tile labels. |
| B4 | Live | Broadcaster | Mobile | Solo | **Viewers slider to 0** | The zero-viewer state: "You are live and early" with three real actions. Honest, and no competitor screenshots this. |
| B5 | Live | Broadcaster | Mobile | Solo | More menu open | Shows clip, poll, moderation, settings in one frame. |
| B6 | Live | Broadcaster | Mobile | Solo | **Chat moderation** panel | Ten real controls, four switches. Sells safety. |
| B7 | Go Live | Broadcaster | Mobile | n/a | default | ⚠ Capture from the **REAL** `/go-live`, not the preview: the preview's Go Live is a design sketch and the real screen has 37 pieces of state (cover, devices, schedule, OBS mode, Twitch mirror, ticketed events). See the port plan section 5. |
| B8 | Ended | Broadcaster | Mobile | n/a | Replay ready | Recap with watch time, peak viewers, replay and up-next. |

### 2c. The money and safety frames

| # | Config | Why |
|---|---|---|
| M1 | Viewer · Mobile · **Tip sheet**, 100c selected | Coins, amounts, the honest moderation line. |
| M2 | Viewer · Mobile · **Subscribe sheet** | Three creator tiers with real perks. |
| M3 | Viewer · Mobile · **Gift a sub**, qty 5 | "You pay, they get the perks". Nothing else on the market shows this cleanly. |
| M4 | Viewer · Mobile · **Top supporters** | Leaderboard, sells competition. |
| M5 | Broadcaster · Mobile · **Tip goal** mid-progress | The bar at ~60% reads better than 0% or 100%. |
| M6 | Viewer · Mobile · chat state **Slow mode** or **Followers-only** | Proof that moderation is real, for a store reviewer as much as a user. |

### 2d. What NOT to shoot

- Anything with **Now playing**: the field has no writer, so it is not a real
  feature yet (port plan O4).
- The **viewer VP chip**: removed 2026-09-04 because nothing awards
  `watch_stream_hour`. Do not reintroduce it in a marketing frame.
- Any **health warning or failure state** on a marketing page. They are correct
  and honest inside the product; on a landing page they advertise breakage.

---

## 3. Screen recordings

Motion is where "indie" is hardest to hide, and it is also where you currently
have the least. Keep each one short and loop-safe.

| # | Recording | Length | Config | What must happen on screen |
|---|---|---|---|---|
| R1 | **Tips landing** | 6-8s, loop | Viewer · Mobile · Solo | Fire Tip twice: alert rides in, combo counter climbs, goal bar advances. One continuous take. |
| R2 | **Entrance ribbon** | 4-5s, loop | Viewer · Mobile · Solo | Fire Entrance on a high rank. The ribbon is the most distinctive thing in the product. |
| R3 | **Co-host join** | 6-8s | Viewer · Desktop · Solo to Co-host | Solo frame, then the second tile appears. Sells co-streaming in one gesture. |
| R4 | **Reactions floor** | 4s, loop | Viewer · Mobile · Solo | Hearts floating on a busy chat. |
| R5 | **Poll** | 8s | Viewer · Mobile · Solo | Poll appears, countdown runs, results fill. |
| R6 | **Goal completion** | 6s | Viewer · Mobile | Goal crosses 100 percent. Set Raised near Target first. |
| R7 | **OG share video** replacement | 10-15s | montage of R1-R3 | Replaces `/og/share.mp4` (currently 1.7 MB). This is the frame that appears in every link preview, so it is the most-seen asset you own. |

⚠ **Record with the window foregrounded.** Chrome freezes animation timelines when
`visibilityState` is `hidden` and throttles timers in a background tab, so a
minimised capture records a still or a stutter. Same reason the post-view counter
could not be tested through a hidden tab.

⚠ **Reduced motion has two switches.** If Settings, Appearance, Reduced motion is
on, `index.css` fast-forwards animations to their final keyframe, so a recording
captures the resting pose and nothing moves. Confirm it is off before recording.

---

## 4. Play Console store listing

Separate from the website, and currently the weakest surface because the listing
is what a new user judges you on before installing.

| Asset | Spec | Count | Source |
|---|---|---|---|
| Phone screenshots | 9:16 portrait, each side 320-3840px | 2 minimum, **8 recommended** | V2, V7, V9, V11, B2, B4, M2, M3 |
| 7-inch tablet | same rules | up to 8 | iPad mini 744x1133 preset |
| 10-inch tablet | same rules | up to 8 | iPad mini preset, or desktop at a tablet width |
| Feature graphic | **1024 x 500**, no transparency | 1, required | composition, not a raw grab |
| App icon | 512 x 512 | 1 | exists |
| Promo video | YouTube URL | optional | R7 |

⚠ **Confirm the exact pixel rules in Console at upload time.** Google changes
them, and the checklist in `docs/play/PLAY_SUBMISSION_CHECKLIST.md` does not
currently cover listing media at all. Do not take the table above as final.

⚠ **The store listing shows 3 screenshots before a user scrolls.** Order matters
more than count: lead with V9 (entrance ribbon), V7 (tip) and B4 (zero viewers),
because those three are the ones nothing else on the store has.

---

## 5. Method

1. Open `/admin/stream-preview` and set the device from the dropdown. Presets:
   iPhone 15 Pro 393x852, 15 Pro Max 430x932, iPhone SE 375x667, Pixel 8 412x915,
   Galaxy S24 360x780, iPad mini 744x1133.
2. Backdrop: **Gameplay scene** or **Streamer room**. Use Gameplay for anything
   about playing and Streamer room for anything about creators, and keep it
   consistent within one page so the set reads as one product.
3. Set the phase, role, device, layout and state from the rail.
4. For a transient (tip, sub, entrance, poll, boost), fire it and let the entry
   animation settle before the shutter. A frame caught mid-animation is the most
   common reason a capture looks cheap.
5. **Reset between captures.** An undismissed poll or level-up bleeds into the
   next frame; that contaminated four separate measurements during the audit.
6. Capture at **2x device pixel ratio** so a 393x852 phone yields 786x1704, which
   clears the Play minimum with room to crop.

---

## 6. Priority, if the whole list is too much

1. **V5 co-host** removes the duplicate image, which is the clearest tell.
2. **R7 share video** is the most-seen asset you own.
3. **V2 and B2** replace the two landing heroes with real frames.
4. **The 8 Play phone screenshots**, ordered V9, V7, B4 first.
5. Everything else.
