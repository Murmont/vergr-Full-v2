# Live stream — what to capture, and how

The shot list for `/admin/stream-preview`. Every row names the exact rail settings, so a
capture can be reproduced later without guessing what state it was in.

> ⚠ **THE FRAME HAS NO BEZEL ON PURPOSE.** `AdminStreamPreviewScreen` renders at true
> device pixels with no drawn phone chrome, so the capture can be composited into a frame
> afterwards without ending up nested inside a second bezel.

---

## 1. Before you capture anything

These four things change what is in the shot. Doing them after the fact means recapturing.

| # | Do this | Why |
|---|---|---|
| 1 | **Drop real footage in.** Rail → *Video* → upload to the **Stage** slot (and **PiP** for the facecam). Or drop a still at `public/brand/live/preview-scene.webp` (9:16) and `preview-scene-wide.webp` (16:9). | Without it the stage draws the measuring stand-in, which literally prints `GAMEPLAY AREA · 393 × 221 · 16:9` on itself. That is a defect only if it ships, so it must not be in a published capture. |
| 2 | **Decide about faces.** The cast avatars are deterministic identicons by design. | The rail lets you upload real photos, but these captures get published, so a real face becomes a claim about a user who does not exist. Either keep the identicons or use images you own and are happy to publish. |
| 3 | **Set the page zoom deliberately.** | The frame is always a true device size, but the *capture resolution* follows browser zoom. 100% at a 1.25 DPR screen gives a sharper PNG than 75%. Pick one and keep it for the whole set, or the images will not sit together. |
| 4 | **Pick the device and keep it.** iPhone 15 Pro (393×852) for the mobile set, Desktop for the wide set. | Mixing 393-wide and 430-wide shots in one row on `/platform` reads as sloppy even when nobody can say why. |

---

## 2. The mobile set — the core of any store or marketing page

Rail: **Mobile · Live · Viewer · Plain viewer · Solo · Immersive** unless a row says otherwise.

| # | Shot | Rail settings | What it is for |
|---|---|---|---|
| M1 | **The stream, at rest** | default, chat flowing | The one hero image. Everything else supports it. |
| M2 | **Someone arrives** | fire *Entrance* | The rank ribbon is unique to Vergr and nothing else in the category has it. Fire it per rank from *Entrance by rank* if you want a set. |
| M3 | **A tip lands** | fire *Tip* | The money moment. |
| M4 | **A new subscriber** | fire *Subscribe* | |
| M5 | **Reactions** | fire *Reactions* a few times | Motion. Better as video (V2). |
| M6 | **A live poll** | fire *Poll* | Proves interaction, not just watching. |
| M7 | **A stream boost running** | fire *Boost* | Shows the countdown, which is what makes a boost feel real. |
| M8 | **Now playing** | fire *Now playing* | |
| M9 | **Level up while watching** | *Fire a level-up* | The reward loop closing on screen. |
| M10 | **A raid landing** | *Raid landing* | The retention mechanic, with the opt-out visible. |
| M11 | **Tip sheet open** | *Open a sheet* → Tip sheet | |
| M12 | **Creator profile sheet** | → Creator profile | |
| M13 | **Top supporters** | → Top supporters | |
| M14 | **Chat put away** | *Chat* → Hide chat | The "just let me watch" state. |
| M15 | **Split view** | Split · Game + cam | |
| M16 | **Landscape** | Landscape · Game + cam | |
| M17 | **Audio only** | Format → Audio only | A podcast or a creator with no camera. |
| M18 | **Co-host, grid** | Co-host · Grid · 3 | |
| M19 | **Co-host, panel** | Co-host · Panel · 3 | The layout for an audio guest. |
| M20 | **A camera off** | *Cameras* → toggle one off | The seat stays and the avatar fills it, which is the point. |

## 3. The broadcaster set

Rail: **Mobile · Live · Broadcaster**.

| # | Shot | Rail settings |
|---|---|---|
| B1 | **Going live** | Broadcaster · Pre-live |
| B2 | **Live, solo** | Broadcaster · Live · Solo |
| B3 | **Live, co-hosting** | Co-host · Grid · 3 |
| B4 | **Studio layout open** | Pre-live → tap *Studio* |
| B5 | **Moderation to hand** | open the More sheet → Chat moderation |
| B6 | **Zero viewers** | *Stream* → Viewers slider to 0 |
| B7 | **Connection warning** | Broadcast health → the unstable state |
| B8 | **Desktop studio** | Desktop · Broadcaster · Live |

## 4. Go Live and Ended

| # | Shot | Rail settings |
|---|---|---|
| G1 | **Go Live, mobile** | Go Live · Can stream · Mobile |
| G2 | **Go Live, follower-gated** | Go Live · Follower-gated |
| G3 | **Go Live, desktop** | Go Live · Desktop |
| E1 | **Ended, replay ready** | Ended · Replay ready |
| E2 | **Ended, viewer side** | Ended · Viewer · Replay ready — has *Up next* |
| E3 | **Host picks a raid target** | Ended · Broadcaster |

## 5. Desktop

| # | Shot | Rail settings |
|---|---|---|
| D1 | **Desktop viewer** | Desktop · Viewer · Plain viewer |
| D2 | **Moderator view** | Desktop · Viewer · Moderator |
| D3 | **Mod-only channel** | Desktop · Moderator → switch chat to Mods |

## 6. The other surfaces

Rail → **Other**: co-stream setup, squad hangout, boost sheet, vergr.me banner, stream
analytics, stream moderation. One each; the boost sheet and analytics are the two most
worth having.

---

## 7. Video, not stills

Six things only read as real in motion. Screen-record the frame at 60fps.

| # | Recording | Why a still cannot do it |
|---|---|---|
| V1 | **Entrance ribbon travelling** | The ribbon moves; a still is just a badge. |
| V2 | **Reactions rising** | |
| V3 | **Tip → the goal bar filling** | Set the goal near its target, then fire tips. |
| V4 | **Level-up celebration** | |
| V5 | **A raid countdown running out** | The countdown IS the feature. |
| V6 | **Chat live for ~20s** | Set *Chat* → a message every 1s. |

---

## 8. Do not publish

- Any shot still showing the **drawn stand-in stage** (`GAMEPLAY AREA`, `CAMERA PREVIEW`,
  a pixel size, an aspect ratio). It is deliberately dim measuring scaffolding.
- Anything with a **real person's face** you do not have the right to publish.
- The **admin chrome** around the frame — sidebar, control rail, page heading. Crop to the
  device frame only.

---

## 9. Open items that could change a capture

These are founder decisions, recorded in `docs/LIVE_STREAM_AUDIT.md` §1. None of them
blocks capturing, but each would change the pixels if it is decided later.

| | What would change |
|---|---|
| **D1** | The entry ribbon's `LIVE` measures 4.14-4.41:1 against a 4.5 floor. Affects M2 and V1. |
| **D5** | The panel-border token, in four copies, on all sixteen sheets and every panel. If it is swept, **every sheet and card capture changes** — M11, M12, M13, B5, and the whole Other set. |
| **D2** | The scrub track over video. |
| **D6** | A rank crest at the chat scroll edge. Cosmetically invisible. |

⚠ **D5 is the one that matters for capture order.** If you intend to change it, decide
before shooting the sheets, not after.
