# Adaptive video quality — plan

Written 2026-08-12. Founder brief:

> "Creators and users pay for the quality, but that doesn't mean we prevent the
> quality dropping if it means keeping a live stream working and not buffering or
> disconnecting, or a video not being able to play just because their network is
> momentarily slow."

Scope is **every video surface**, not just live: live streams, video posts,
clips, shorts, DM video, squad chat video, VOD replays.

**Nothing here is built.** This is the decision document, because the core change
costs recurring CPU and that is a founder call.

---

## 1. The actual problem, stated precisely

**Paid tier is a CEILING, not a FLOOR.** A Pro viewer should be able to watch at
1080p when their connection allows and at 360p when it does not. Today the tier
sets one fixed quality and there is nothing to fall back to.

Two separate failures, one cause:

| Surface | What happens on a slow network | Why |
|---|---|---|
| Live stream | Buffers, then stalls or disconnects | **Only one rendition exists.** `CLAUDE.md:312`: "Single-rendition (no transcode ladder). Viewer cap matches source." |
| Video post / DM / clip | Spins until the whole file is buffered enough | Progressive MP4/WebM from R2. No bitrate variants, no manifest |

### The live side

`functions/streaming.js` sets `maxViewerRendition` from the HOST's plan:

```
Free  480p   Lite  720p   Pro  1080p
```

That is stamped on the stream at creation (`maxViewerRenditionForViewers`) and
never varies by viewer. `HlsPlayer.jsx` already uses hls.js, which performs ABR
automatically **when a manifest offers more than one variant**. Ours offers one.
So the player is capable and has nothing to choose from.

**Adding a viewer-side mobile cap does NOT fix this.** A mobile viewer capped at
480p with a bad signal still has nowhere to drop to. It reduces bandwidth waste,
which is worth doing, but it is a different benefit.

### The on-demand side

Video posts, clips, shorts and DM video are single files on R2 played by
`InlineVideoPlayer` / `MediaLightbox` / `RoundVideoPlayer`. Compression happens
ONCE at upload (`src/utils/mediaCompression.js`, `CLIP_LIMITS` / `SHORTS_LIMITS`)
and produces one file at one bitrate. A viewer on 3G downloads the same bytes as
a viewer on fibre.

---

## 2. Options, with honest costs

### Option A — Live: add a low rung to the ladder

One extra ffmpeg encode per live stream on the Hetzner box, producing a 360p
variant alongside the source, and a master playlist listing both. hls.js then
adapts with no client change.

| | |
|---|---|
| Cost | ~1 extra encode per concurrent live stream, on `vergr-stream-1` (CX23) |
| Effect | Never stalls; degrades instead |
| Risk | CPU is the box's scarce resource. This is what "single-rendition" was protecting |

Cheaper variants of the same idea:
- **A1. 360p rung on every stream.** Simplest, highest cost.
- **A2. Only above N concurrent viewers.** A solo stream stays single-rendition,
  so the streams that most need resilience (the popular ones) get it. Solo
  streams stay brittle.
- **A3. Only for paid tiers.** Backwards: the Free 480p stream is the one most
  likely to be watched on a weak connection.

**Recommendation: A1**, with the rung produced at `ultrafast`/low-CPU settings.
A 360p encode is cheap relative to the 1080p source it sits beside. Measure real
CPU on the box before committing to a viewer ceiling.

### Option B — On-demand: transcode uploads to 2-3 variants

At upload, produce 360p / 720p (/1080p) and an HLS or DASH manifest, then serve
the manifest instead of the file.

| | |
|---|---|
| Cost | One-off encode per upload, not per view. Storage ~1.6x |
| Effect | Instant start on any connection, quality climbs as it can |
| Where | The `vergr-vod-archive` box already runs ffmpeg and R2 upload |

### Option C — On-demand cheap win: faststart + preload (do this regardless)

Two changes with no encoding cost at all:

1. **`-movflags +faststart`** so the MP4 index is at the FRONT of the file.
   Without it the player must fetch the end of the file before it can start.
   See `reference-moov-faststart`: a long video slow to START is this, not the
   network.
2. **`preload="metadata"`** and correct `playsinline` on every player, so a feed
   of videos does not race to buffer all of them at once.

This does not make quality adapt, but it removes a large slice of the "spins
before playing" complaints for zero recurring cost.

### Option D — Network-aware initial selection

Use `navigator.connection.effectiveType` / `downlink` to pick the STARTING
variant rather than always starting high and stalling down.

Cheap, but only meaningful once B or A exists. On its own there is nothing to
select between.

⚠ Not available in Safari/iOS. Must degrade to "start at the middle rung".

---

## 3. Recommended sequence

| Step | What | Cost | Blocking? |
|---|---|---|---|
| 1 | **Option C** — faststart + preload audit across every player | €0 | No |
| 2 | **Option A1** — 360p live rung, measure CPU on box | CPU | **Founder call** |
| 3 | **Option B** — 2-variant on-demand ladder via the vod-archive box | CPU at upload, +60% storage | **Founder call** |
| 4 | **Option D** — network-aware initial rung | €0 | No |
| 5 | Mobile viewer ceiling (480p on phones) | €0, saves bandwidth | No |

Step 1 is worth doing immediately and independently: it is free and it fixes the
most common complaint.

Steps 2 and 3 are the ones that actually deliver the brief, and both spend CPU on
a box whose CPU is the reason the current design exists.

---

## 4. Files this touches

| Area | File |
|---|---|
| Live rendition policy | `functions/streaming.js` (`maxViewerRendition`, `planRules`) |
| Live player / ABR | `src/components/streams/HlsPlayer.jsx` (hls.js already ABR-capable) |
| Transcode ladder | Hetzner `vergr-stream-1`, nginx-rtmp config |
| On-demand encode | `infra/vod-archive/` (ffmpeg + R2 already wired) |
| Upload compression | `src/utils/mediaCompression.js` (`CLIP_LIMITS`, `SHORTS_LIMITS`) |
| On-demand players | `src/components/media/InlineVideoPlayer.jsx`, `RoundVideoPlayer.jsx`, `MediaLightbox.jsx`, `EmbedVideoPlayer.jsx` |
| Locked/paid media | `src/components/monetization/LockedMedia.jsx` |

---

## 5. Constraints that must not be broken

- **Source-upload bitrates are LOCKED** (`CLAUDE.md`): Free 480p30 @3Mbps, Lite
  720p60 @4.5, Pro 1080p60 @6.5. This plan does NOT change what a creator
  uploads. It changes what a VIEWER can fall back to.
- **Free tier is deliberately limited.** Adding a 360p rung is not raising free
  quality, it is preventing a stall. Do not let it become an argument for lifting
  the free ceiling.
- **Tournaments disable p2p-media-loader** for prize-money reliability. Any
  manifest change must keep that switch working.
- **Zero out-of-pocket cost.** No transcoding SaaS. Everything runs on hardware
  already paid for.

## 6. Open questions for the founder

1. **Is the CPU spend approved** for a 360p live rung on every stream (A1), or
   should it be conditional (A2)?
2. **On-demand ladder: 2 variants or 3?** Two (360p/720p) covers the brief; three
   adds 1080p for large-screen viewers at more storage.
3. **Storage:** a 2-variant ladder is roughly +60% R2 storage per video. R2 free
   tier is 10GB. At what library size does this need revisiting?
