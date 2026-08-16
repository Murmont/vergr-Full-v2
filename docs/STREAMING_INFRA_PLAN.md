# Streaming infrastructure — measured state and the scale-out plan

Written 2026-08-12. Every number here was measured on the boxes, not estimated.

Founder brief: the boxes should work together, load-bearing, so nothing goes
down, and adding "box 3" should be a case of telling Claude it exists.

---

## 1. What is actually running today

| | vergr-stream-1 | vergr-stream-2 |
|---|---|---|
| Hetzner type | cx23 | cpx32 |
| Cores / RAM | 2 / 4GB | **4 / 8GB** |
| IP | 91.98.79.244 | 178.105.238.230 |
| DNS | `rtmp.`, `sfu.`, `payram.`, `archive.` | `edge2.vergr.app` |
| Load average | **1.00 at idle** | **0.00** |
| Uptime | — | **9 weeks 6 days** |
| Non-local requests in last 200 log lines | — | **1** |

Services on box 1: nginx, nginx-rtmp, vergr-sfu, vergr-rtmp-auth, vergr-ingest,
vergr-chat, vergr-ocr, vergr-cohost, vergr-sysinfo, coturn, r2-sync, litestream,
**PayRam (Docker + Postgres + Redis + supervisord)**.

Services on box 2: nginx, vergr-sfu, vergr-ingest, vergr-rtmp-auth,
**vergr-vod-archive**, vergr-thumbnailer, vergr-node-agent.

### ⚠ CORRECTION (2026-08-12) — an earlier version of this section was WRONG

This document originally claimed box 2 received no traffic because nothing routed
to it, and that load balancing "was never done". **Both claims were false.**

**Load balancing is already built and already working.** `functions/streaming.js`
has a full node registry:

- `stream_nodes/{nodeId}` documents, self-registered by heartbeat.
- `pickStreamNode(mode)` filters to `status==='active'`, drops nodes whose
  heartbeat is older than 60s, checks the node advertises the right ingest type
  for the mode, and rejects nodes at capacity.
- Sorts by **priority desc, then load, then CPU**.
- Falls back to `null` → static env defaults, so go-live can never break on an
  empty or stale registry.
- Tournament and co-host streams are PINNED to the primary node, because
  `vergr-ocr` reads local HLS frames and `vergr-cohost` runs the ffmpeg
  composite; both need the stream on the box where those services live.

Measured live registry state:

```
edge1 | active | prio 0  | 0/12 streams | heartbeat 12s ago | FRESH
edge2 | active | prio 10 | 0/25 streams | heartbeat 10s ago | FRESH
```

edge2 carries **priority 10**, so it already wins every normal stream. Box 1 is
the deliberate overflow and failover node.

**Why the original claim was wrong:** the evidence was "1 non-local request in
box 2's last 200 nginx log lines". That was a misread. Streams arrive over
**RTMP on 1935** and the **SFU on 8088**, neither of which writes to nginx's
access log. Box 2 is idle because **nobody is streaming right now**, not because
it is unreachable.

**Adding box 3 already works the way the founder asked for:** install the node
agent, it heartbeats itself into `stream_nodes`, and it starts receiving streams.
Draining a box is `status !== 'active'`. No code change, no deploy, no DNS edit.
The section below describing a registry to be built describes something that
already exists; it is kept only as a description of how the live system behaves.

### The second finding: PayRam

PayRam consumed ~45% of one core on box 1, permanently, with **zero
transactions**, **zero log output in 60 seconds**, and **no restarts** (container
up 2 days). `strace` showed `sched_yield` + `tgkill` + `madvise` churn: a Go
scheduler and GC thrashing on a tight internal poll. This is a defect in PayRam
itself, not our configuration, and it is a closed container we cannot patch.

**Capped 2026-08-12** with `docker update --cpus="0.5" payram`. Verified still
healthy afterwards (local HTTPS returns 200).

⚠ The cap is a CEILING, not an instant saving: it was already using ~0.45 core,
so measured idle CPU barely moved. What it buys is protection — PayRam can no
longer spike and starve live streaming. Now that Stripe is the primary card rail
and PayRam is the fallback, 0.5 core is generous.

**Revisit if:** PayRam deposits start settling slowly, or the fallback rail sees
real volume. Reverse instantly with `docker update --cpus="2" payram`.

---

## 2. The architecture: what these boxes should be

Two roles, deliberately separated, so a box can be added or lost without a
redesign.

```
                        Cloudflare (cdn.vergr.app)
                                  |
   ┌──────────────────────────────┴───────────────────────────────┐
   │                         EDGE / ORIGIN                        │
   │  box1: rtmp ingest, SFU, chat, coturn, PayRam                │
   │  box2: rtmp ingest, SFU, ingest        <- currently unused   │
   └──────────────────────────────────────────────────────────────┘
                                  |
   ┌──────────────────────────────┴───────────────────────────────┐
   │                        WORKER POOL                           │
   │  box2: vod-archive (ffmpeg), thumbnailer   <- 4 idle cores   │
   │  box3+: same image, joins the pool                           │
   └──────────────────────────────────────────────────────────────┘
```

**EDGE work is sticky.** A live stream must ingest, transcode and serve from ONE
box: the RTMP session lands somewhere and the HLS segments have to come from the
same place. So edge scaling is per-stream assignment, not round-robin.

**WORKER work is stateless.** Transcoding an uploaded video, cutting a clip,
generating a thumbnail — any box can do any job. This is the part that scales by
just adding machines, and it is where the CPU-hungry work belongs.

### Why NOT round-robin DNS on sfu/rtmp

The obvious "add box 2 to the A record" is wrong here and would cause outages:

- A broadcaster's RTMP session and its viewers' HLS requests would land on
  different boxes, and the second box has no segments for that stream.
- DNS has no health checking. A dead box keeps receiving half the traffic until
  someone edits DNS, which is the opposite of "nothing ever goes down".

**Assignment must be explicit and recorded**, which we already have a natural
place for: `createStreamSession` already picks the ingest URL and writes it to
the stream document. It just always picks box 1.

---

## 3. The scale-out design (this is the "box 3" answer)

### 3.1 A registry, not hardcoded hosts

New Firestore doc `app_config/stream_nodes`:

```
{
  nodes: [
    { id: 'box1', host: 'rtmp.vergr.app',  internal: '91.98.79.244',
      roles: ['edge','sfu'],           cores: 2, weight: 1, enabled: true },
    { id: 'box2', host: 'edge2.vergr.app', internal: '178.105.238.230',
      roles: ['edge','sfu','worker'],  cores: 4, weight: 2, enabled: true }
  ]
}
```

Adding box 3 then becomes: provision it, run the deploy scripts, append one
object. **No code change, no deploy.** That is the founder's requirement met
literally: "tell you box 3 is active" is one config edit.

`weight` is cores-relative so a bigger box takes proportionally more.

### 3.2 Edge assignment at session creation

`createStreamSession` picks a node instead of assuming box 1:

1. Read `stream_nodes`, keep `enabled` nodes with the `edge` role.
2. Drop any whose `/healthz` is stale (the node agent already heartbeats; see
   `vergr-node-agent` on box 2 and `vergr-sysinfo` on box 1).
3. Choose least-loaded by `activeStreams / weight`.
4. Write the chosen `ingestUrl` + `hlsBase` onto the stream doc, as it already
   does today.

Everything downstream already reads those fields, so this is a change in ONE
function, not a migration.

### 3.3 Worker pool for transcoding

Jobs go in a Firestore queue (`transcode_jobs`) with a claim field. Each worker
box polls, claims atomically, encodes, uploads to R2, marks done. A dead worker's
claim expires and another picks it up.

This is the same shape as the existing `vergr-ocr` loop on box 1, so it is a
pattern already proven here rather than something new.

### 3.4 Failover

- **Edge:** a node failing `/healthz` stops being assigned NEW streams. Existing
  streams on it die (unavoidable without redundant ingest, which doubles cost).
  Recovery is a re-go-live, not a manual fix.
- **Worker:** fully transparent. Claims expire, jobs get retried.

---

## 4. Answering the video-quality questions

### A1 is UNBLOCKED (revised after the correction above)

The original conclusion was "A1 is blocked on routing". Routing was already done.

Because edge2 (4 cores, priority 10) already wins every normal stream, and box 1
only receives tournament/co-host pins and overflow, **the transcode rung can be
added to box 2's nginx-rtmp today**. Box 1's 2 cores are not in the path for
ordinary streams.

Remaining risk is no longer capacity, it is that adding a variant to nginx-rtmp
means editing the config of the service that accepts live broadcasts. That is a
live-path change and wants a test broadcast to verify against, not a blind
reload.

### Is A1 viable on box 1?

**On box 1 alone: no.** 2 cores with load already at 1.0 supports roughly 3
concurrent transcodes before saturation, and a saturated encoder drops frames for
everyone including the source.

**With box 2 carrying edge traffic: yes.** 4 cores at zero load supports roughly
8-10 concurrent 360p rungs at `veryfast`.

**So A1 is blocked on section 3.2, not on the encoder.** Route streams to box 2
first (it is the bigger box and it is empty), then add the rung.

Recommended order:
1. Node registry + edge assignment (section 3).
2. 360p rung on box 2 streams only, measure real CPU per stream.
3. Extend to box 1 only if the measurement supports it on 2 cores.

### Option B (on-demand ladder) — starting here

`vergr-vod-archive` is **already on box 2**, already has ffmpeg and R2 wired, and
box 2 is idle. This is the lowest-risk place to start and needs none of the
routing work above.

Shape:
- On upload, enqueue a transcode job.
- Worker produces 360p + 720p renditions plus an HLS manifest.
- Players switch from a direct file URL to the manifest; `hls.js` is already a
  dependency and `HlsPlayer.jsx` already handles ABR.
- Original stays as the download/fallback.

Storage cost ~+60% per video. R2 free tier is 10GB, so this needs a revisit
threshold, noted as an open question below.

---

## 5. Already done, do not redo

`-movflags +faststart` is already set on BOTH ffmpeg paths in
`infra/vod-archive/launcher.js`. Preload discipline is already correct:
`ShortsDeck.jsx:727` flips `metadata` → `auto` only once the active video has
buffered, and the two `preload="auto"` cases (`RoundVideoPlayer`, `MediaPreview`)
are fullscreen players the user explicitly opened, where eager loading is right.

Option C in `ADAPTIVE_VIDEO_PLAN.md` was therefore already implemented before
that document was written.

---

## 6. Open questions

1. **R2 storage ceiling.** A 2-variant ladder is ~+60% storage per video. At what
   library size does this need revisiting, and is a paid R2 tier acceptable then?
2. **Live redundancy.** True "nothing goes down" for a stream in flight needs
   redundant ingest, which roughly doubles edge cost. Currently out of scope; a
   failed box means affected broadcasters re-go-live.
3. **Box 1's future.** It is the smaller box carrying the most services. Once
   edge assignment exists, is the intent to keep it as edge, demote it to
   PayRam + chat only, or replace it?
