// Browser fMP4 chunked ingest client — talks to vergr-ingest (infra/ingest/main.go).
//
// Use case: free-tier broadcasters (and any browser-based broadcaster). Captures
// from a MediaStream via MediaRecorder, produces fragmented MP4 chunks every 2s,
// POSTs them to the ingest service which writes them as HLS segments.
//
// The chosen MediaRecorder mimeType (`video/mp4; codecs="avc1...,mp4a.40.2"`)
// requires Chrome 88+ or Safari 18.4+. Older browsers throw at recorder
// construction — the caller should catch and tell the user to update or use OBS.
//
// Usage:
//   import { startBrowserIngest } from '@/utils/streamIngest';
//   const ingest = await startBrowserIngest({
//     streamKey,            // from createStreamSession() callable
//     mediaStream,          // composed canvas.captureStream() with mic mixed in
//     plan: 'free',         // 'free' | 'lite' | 'pro' — sets target bitrate
//     onChunkSent: (seq, ms) => { ... },
//     onError: (err) => { ... },
//     onEnded: (reason) => { ... },
//   });
//   // later:
//   await ingest.stop();

const INGEST_BASE_URL =
  import.meta.env.VITE_INGEST_BASE_URL || 'https://sfu.vergr.app/ingest';

// Per-plan locked bitrate targets (CLAUDE.md "Streaming routing rule").
const BITRATE_TABLE = {
  free: { video: 3_000_000, audio: 96_000 },
  lite: { video: 4_500_000, audio: 128_000 },
  pro:  { video: 6_500_000, audio: 128_000 },
};

const PREFERRED_MIME_TYPES = [
  // H.264 High profile + AAC-LC — best quality, widely supported on modern Chrome/Edge/Safari.
  'video/mp4; codecs="avc1.640020,mp4a.40.2"',
  // H.264 Baseline — wider compat, lower compression efficiency.
  'video/mp4; codecs="avc1.42E01E,mp4a.40.2"',
  // Last-ditch: any video/mp4. Lets the browser pick.
  'video/mp4',
];

function pickMimeType() {
  if (typeof MediaRecorder === 'undefined') {
    throw new Error('MediaRecorder not available in this browser');
  }
  for (const mime of PREFERRED_MIME_TYPES) {
    if (MediaRecorder.isTypeSupported(mime)) return mime;
  }
  throw new Error(
    'Browser does not support fMP4 MediaRecorder. ' +
    'Update your browser (Chrome 88+, Safari 18.4+) or use OBS to stream.'
  );
}

/**
 * Pre-flight uplink probe. POSTs a fixed payload to the assigned ingest box and
 * measures real upload throughput, so the broadcaster can pick a starting
 * bitrate the network can actually sustain (a 10 Mbps / mobile uplink should not
 * start a 6.5 Mbps encode). Returns estimated uplink in kbps, or null on failure
 * (caller should fall back to the plan default).
 */
export async function probeUplink({ streamKey, ingestBase, bytes = 1_500_000 } = {}) {
  if (!streamKey) return null;
  const base = (ingestBase || INGEST_BASE_URL).replace(/\/+$/, '');
  try {
    const payload = new Blob([new Uint8Array(bytes)]); // zero-filled; size is what matters
    const t0 = performance.now();
    const resp = await fetch(`${base}/probe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream', Authorization: `Bearer ${streamKey}` },
      body: payload,
    });
    if (!resp.ok) return null;
    const ms = performance.now() - t0;
    if (ms <= 0) return null;
    return Math.round((bytes * 8) / ms); // bytes*8 / ms = kbps
  } catch {
    return null;
  }
}

export async function startBrowserIngest({
  streamKey,
  mediaStream,
  plan = 'free',
  videoBitrate,               // optional override (bps) chosen by the pre-flight probe; falls back to the plan target
  chunkIntervalMs = 1000, // 1s chunks -> 1s HLS segments -> ~4-6s glass-to-glass (was 2000/~8-15s). MUST match ingest segmentDurationSec.
  ingestBase,                 // per-stream ingest base from createStreamSession (stream.ingestUrl). Distributes browser ingest across boxes; falls back to the static box.
  onChunkSent = () => {},
  onBackpressure = () => {},   // (queueDepth) — fires when uploads can't keep up; drives real-time quality adaptation
  onError = () => {},
  onEnded = () => {},
}) {
  if (!streamKey) throw new Error('startBrowserIngest: streamKey required');
  if (!mediaStream) throw new Error('startBrowserIngest: mediaStream required');

  // The box this stream was assigned to (createStreamSession picks the
  // least-loaded ingest node). Falls back to the single static box.
  const base = (ingestBase || INGEST_BASE_URL).replace(/\/+$/, '');

  const bitrates = BITRATE_TABLE[plan] || BITRATE_TABLE.free;
  const videoBps = Math.max(400_000, Math.round(videoBitrate || bitrates.video));
  const mimeType = pickMimeType();

  const recorder = new MediaRecorder(mediaStream, {
    mimeType,
    videoBitsPerSecond: videoBps,
    audioBitsPerSecond: bitrates.audio,
  });

  // We POST chunks sequentially. Each `ondataavailable` event enqueues a chunk;
  // a single worker drains the queue so chunks reach the server in order.
  const queue = [];
  let nextSeq = 0;        // 0 = init; 1, 2, 3... = media segments
  let isFirstChunk = true;
  let stopped = false;
  let stopResolve;
  const stopped$ = new Promise((res) => { stopResolve = res; });

  async function postChunk(blob, seq) {
    const isInit = seq === 0;
    const url = isInit
      ? `${base}/init`
      : `${base}/seg/${seq}`;

    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/octet-stream',
        Authorization: `Bearer ${streamKey}`,
      },
      body: blob,
      keepalive: false, // chunks can be >12MB; keepalive caps at 64KB
    });
    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      throw new Error(`ingest ${seq} → HTTP ${resp.status}: ${text}`);
    }
    return resp.json().catch(() => ({}));
  }

  async function drain() {
    while (!stopped || queue.length > 0) {
      if (queue.length === 0) {
        // Wait briefly for the next chunk; the recorder fires every chunkIntervalMs.
        await new Promise((r) => setTimeout(r, 50));
        continue;
      }
      const { blob, seq } = queue.shift();
      const t0 = performance.now();
      try {
        // Retry once on network blip — chunks are independently uploadable.
        let attempt = 0;
        while (true) {
          try {
            await postChunk(blob, seq);
            break;
          } catch (e) {
            attempt++;
            if (attempt >= 2) throw e;
            await new Promise((r) => setTimeout(r, 250));
          }
        }
        onChunkSent(seq, Math.round(performance.now() - t0), blob.size);
      } catch (e) {
        onError(e);
        // A failed chunk means the playlist will have a gap — fatal for the stream.
        // Stop the recorder; finalize will run on the catch path.
        try { recorder.stop(); } catch {}
        break;
      }
    }
    stopResolve();
  }

  recorder.ondataavailable = (ev) => {
    if (!ev.data || ev.data.size === 0) return;
    const seq = nextSeq++;
    if (isFirstChunk) {
      isFirstChunk = false;
      // First chunk = init+seg0 combo; server splits it server-side.
      queue.push({ blob: ev.data, seq: 0 });
    } else {
      queue.push({ blob: ev.data, seq });
    }
    // Backpressure signal: in steady state the drainer keeps the queue near 0
    // (one ~1s chunk uploads in well under 1s). A growing queue means the uplink
    // can't keep up -> tell the controller to shed quality before latency blows
    // up and viewers stall. Each chunk is ~1s of video, so depth ≈ seconds behind.
    if (queue.length >= 2) onBackpressure(queue.length);
  };

  recorder.onerror = (ev) => {
    onError(ev.error || new Error('MediaRecorder error'));
    stopped = true;
  };

  recorder.onstop = async () => {
    stopped = true;
    // Wait for the queue to drain.
    await stopped$;
    // Tell the server we're done so it writes #EXT-X-ENDLIST.
    try {
      await fetch(`${base}/end`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${streamKey}` },
      });
    } catch (e) {
      // Server's idle sweeper will finalize after 5 minutes anyway — non-fatal.
      console.warn('ingest /end failed:', e);
    }
    onEnded('client-stopped');
  };

  // Kick off the recorder + drainer.
  recorder.start(chunkIntervalMs);
  drain();

  return {
    /** Stop recording, drain pending chunks, send /ingest/end. */
    async stop() {
      if (recorder.state === 'recording' || recorder.state === 'paused') {
        recorder.stop();
      }
      await stopped$;
    },

    /** Snapshot of current state — useful for debug overlays. */
    state() {
      return {
        recorderState: recorder.state,
        queuedChunks: queue.length,
        nextSeq,
        mimeType,
        videoBps: bitrates.video,
        audioBps: bitrates.audio,
      };
    },

    recorder,
    mediaStream,
  };
}

/**
 * Helper: probe whether the current browser can do fMP4 MediaRecorder.
 * Use it to gate the "Go Live (browser)" button.
 */
export function browserCanIngest() {
  if (typeof MediaRecorder === 'undefined') return false;
  return PREFERRED_MIME_TYPES.some((m) => MediaRecorder.isTypeSupported(m));
}
