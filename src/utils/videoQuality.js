// Send-time video options — the Telegram-style controls on the preview screen.
//
// WHY THIS EXISTS. We cap SIZE, not length: storage is billed per byte and R2
// delivery is free, so a 45-minute video and a 45-second video of equal size
// cost us exactly the same. Length was never the thing worth restricting.
//
// But size still matters to the SENDER — it is their mobile data and their
// waiting. So instead of the app silently deciding, the sender picks, the same
// way Telegram lets you choose a quality before you hit send. They can also cut
// the video down and drop its audio, which are usually a far bigger saving than
// any bitrate choice.
//
// The estimates here are honest approximations, not promises. Real output
// depends on the content (a static screen recording lands far under; fast
// motion lands over). Every figure is rendered with a "~" for that reason.

import { SKIP_REENCODE_BYTES } from './mediaCompression';

// Audio rides alongside the video bitrate and has to be in the estimate or
// short clips read as much smaller than they arrive.
const AUDIO_BITRATE = 96_000;

// Rungs offered below the source resolution. Bitrates are chosen to look good
// on a phone screen rather than to hit a number — 720p at 2 Mbps is the point
// where re-encoding stops being visible for most content.
const RUNGS = [
  { shortSide: 1080, bitrate: 3_500_000 },
  { shortSide: 720,  bitrate: 2_000_000 },
  { shortSide: 480,  bitrate: 1_000_000 },
  { shortSide: 360,  bitrate: 600_000   },
];

// Below this the cut is treated as "they did not really trim it", so a stray
// pixel of handle drag does not force a full re-encode of an untouched video.
const TRIM_EPSILON = 0.08;

export function formatBytes(n) {
  if (!Number.isFinite(n) || n <= 0) return '—';
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(n < 10 * 1024 * 1024 ? 1 : 0)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

/**
 * mm:ss for a duration.
 *
 * FLOOR, not round. The video element's own clock floors, so rounding here made
 * the picker say 0:25 while the player right above it said 0:24 — two numbers
 * for one video, on the same screen.
 */
export function formatDuration(sec) {
  if (!Number.isFinite(sec) || sec <= 0) return '0:00';
  const s = Math.floor(sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  if (h) return `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`;
  return `${m}:${String(r).padStart(2, '0')}`;
}

function estimateBytes(bitrate, duration, withAudio = true) {
  if (!Number.isFinite(duration) || duration <= 0) return 0;
  return Math.round(((bitrate + (withAudio ? AUDIO_BITRATE : 0)) * duration) / 8);
}

/**
 * Build the quality choices for one video.
 *
 * @param {object} meta   { width, height, duration } from getMediaDimensions
 * @param {number} size   source file size in bytes
 * @param {object} tierLimits  the plan's own { maxShortSide, videoBitrate }
 * @param {object} [edits]  { duration, mute } — the CURRENT trim length and
 *                          whether audio is being dropped, so every estimate
 *                          describes what will actually be sent rather than
 *                          what the untouched file would have been.
 * @returns {{options: Array, defaultId: string}}
 *
 * Each option carries everything compressVideo needs:
 *   { id, label, detail, estBytes, passthrough?, maxShortSide?, videoBitrate? }
 * `passthrough` means send the file at its own quality — no re-encode.
 */
export function buildQualityOptions(meta, size, tierLimits, edits = {}) {
  const fullDuration = Number(meta?.duration) || 0;
  const cutDuration = Number(edits.duration) > 0 ? Number(edits.duration) : fullDuration;
  const withAudio = !edits.mute;
  const w = Number(meta?.width) || 0;
  const h = Number(meta?.height) || 0;
  const sourceShort = w && h ? Math.min(w, h) : 0;

  // A cut file is smaller in proportion to what was kept. Crude, but far closer
  // than quoting the whole file's size for a ten-second excerpt of it.
  const keptFraction = fullDuration > 0 ? Math.min(1, cutDuration / fullDuration) : 1;

  const options = [{
    id: 'original',
    label: 'Original',
    detail: sourceShort ? `${sourceShort}p` : '',
    estBytes: Math.round(size * keptFraction),
    passthrough: true,
  }];

  // Build the rungs keyed on resolution so the plan's own setting and a fixed
  // rung at the same height can never both appear as separate rows.
  const byShortSide = new Map();

  // THE PLAN'S OWN NUMBERS, at the source resolution when no rung sits below it.
  //
  // Without this, a Pro account sending a 1080p file saw only "Original": every
  // fixed rung is skipped as not-smaller-than-source, so the default fell back
  // to Original and a 43 MB video was quietly offered as a 43 MB send. The plan
  // would still have re-encoded it — the picker just had no row that said so.
  const planShort = tierLimits?.maxShortSide
    ? (sourceShort ? Math.min(sourceShort, tierLimits.maxShortSide) : tierLimits.maxShortSide)
    : 0;
  if (planShort && tierLimits?.videoBitrate) {
    const est = estimateBytes(tierLimits.videoBitrate, cutDuration, withAudio);
    // Only if it is genuinely smaller. Re-encoding upward is not a quality
    // option, it is a bigger file for worse pixels.
    if (est > 0 && est < size * keptFraction * 0.95) {
      byShortSide.set(planShort, {
        shortSide: planShort,
        bitrate: tierLimits.videoBitrate,
        recommended: true,
      });
    }
  }

  for (const r of RUNGS) {
    if (sourceShort && r.shortSide >= sourceShort) continue;
    if (byShortSide.has(r.shortSide)) continue;
    byShortSide.set(r.shortSide, r);
  }

  for (const r of [...byShortSide.values()].sort((a, b) => b.shortSide - a.shortSide)) {
    options.push({
      id: `r${r.shortSide}`,
      label: `${r.shortSide}p`,
      detail: r.recommended ? 'Recommended' : '',
      estBytes: estimateBytes(r.bitrate, cutDuration, withAudio),
      maxShortSide: r.shortSide,
      videoBitrate: r.bitrate,
      recommended: !!r.recommended,
    });
  }

  // WHAT IS SELECTED WHEN THE SHEET OPENS.
  //
  // Under the skip line the file is already small and gets sent untouched, so
  // Original is both the default and what actually happens. Above it the app
  // would re-encode to the plan's own numbers anyway — so that is what the
  // default has to say, or the picker would be describing something other than
  // the behaviour it is attached to.
  let defaultId = 'original';
  if (size > SKIP_REENCODE_BYTES) {
    const rec = options.find(o => o.recommended);
    if (rec) defaultId = rec.id;
  }

  return { options, defaultId };
}

/**
 * Turn the chosen quality plus any edits into the opts bag compressVideo wants.
 *
 * Returns null when there is genuinely nothing to do, which is what tells the
 * caller to send the file as it is.
 *
 * @param {object} option  the selected quality option
 * @param {object} edits   { trimStart, trimEnd, duration, mute }
 */
export function optsForQuality(option, edits = {}) {
  const duration = Number(edits.duration) || 0;
  const trimStart = Math.max(0, Number(edits.trimStart) || 0);
  const rawEnd = Number(edits.trimEnd);
  const trimEnd = Number.isFinite(rawEnd) && rawEnd > 0 ? rawEnd : null;
  const mute = !!edits.mute;

  const cutHead = trimStart > TRIM_EPSILON;
  const cutTail = trimEnd != null && duration > 0 && trimEnd < duration - TRIM_EPSILON;
  const trimmed = cutHead || cutTail;

  const passthrough = !option || !!option.passthrough;
  if (passthrough && !trimmed && !mute) return null;

  return {
    ...(passthrough ? {} : {
      maxShortSide: option.maxShortSide,
      videoBitrate: option.videoBitrate,
    }),
    ...(trimmed ? { trimStart, trimEnd: trimEnd ?? duration } : {}),
    ...(mute ? { mute: true } : {}),
    // The user asked for this explicitly, so it overrides the "already small
    // enough, don't bother" shortcut. Their choice beats our default.
    force: true,
    // A pure cut or mute changes no pixels, so it can be done by copying samples
    // into a new container instead of decoding and re-encoding them. Orders of
    // magnitude faster, and lossless. The flag is what lets the transcoder take
    // that route rather than assuming every edit means a full encode.
    remuxOnly: passthrough,
  };
}
