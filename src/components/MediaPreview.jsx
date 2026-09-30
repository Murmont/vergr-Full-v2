import { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import Icon from './Icon';
import { CLIP_LIMITS } from '../utils/mediaCompression';
import { buildQualityOptions, optsForQuality, formatBytes, formatDuration } from '../utils/videoQuality';

/**
 * MediaPreview — the screen between picking a file and sending it.
 *
 * This is the last thing a sender sees before their video leaves the phone, so
 * it has to behave like a finished product: the frame visible immediately, our
 * own controls, and real editing rather than a size dropdown.
 *
 * THREE THINGS THIS FILE EXISTS TO GET RIGHT, all of them previously wrong:
 *
 * 1. THE OBJECT URL IS CREATED ONCE. It used to be built in the render body, so
 *    every keystroke in the caption field minted a new blob URL, swapped the
 *    video's `src`, and made the WebView tear the element down and start over.
 *    That is what the constant flicker was, and it is also why no frame ever
 *    appeared: the element never survived long enough to decode one. None of
 *    those URLs were revoked either.
 *
 * 2. NO NATIVE `controls`. The Android System WebView draws that bar on a
 *    separate compositor surface which never receives touch inside the Tauri
 *    shell, so it is decorative at best — and it is what put a grey box and a
 *    giant blurred play glyph over the video. Ours is plain HTML.
 *
 * 3. IT INSETS ITSELF. A fixed, full-screen layer sits under the status bar and
 *    the navigation bar unless it says otherwise, which had the filename tangled
 *    up in the clock and the send hint behind the home pill.
 *
 * EDITING. Trim and mute are cuts, not compression: they change no pixels, so on
 * the native path they are a sample copy into a new container — instant and
 * lossless — and they usually save far more than any bitrate choice. The quality
 * picker sits alongside them rather than being the only control.
 */
export default function MediaPreview({ file, onSend, onSchedule, scheduling = false, onCancel, tier = 'free' }) {
  const [caption, setCaption] = useState('');

  const isImage = !!file?.type?.startsWith('image/');
  const isVideo = !!file?.type?.startsWith('video/');

  // ONE url for the life of this file. See note 1 above — this single line is
  // the difference between a still preview and a strobing one.
  const [url, setUrl] = useState(null);
  useEffect(() => {
    if (!file || !(isImage || isVideo)) { setUrl(null); return; }
    const u = URL.createObjectURL(file);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [file, isImage, isVideo]);

  // ── video state ──────────────────────────────────────────────────────────
  const videoRef = useRef(null);
  const [meta, setMeta] = useState(null);        // { width, height, duration }
  const [playing, setPlaying] = useState(false);
  const [cur, setCur] = useState(0);
  const [firstFrame, setFirstFrame] = useState(false);
  // A codec the WebView cannot decode (HEVC is the common one) would otherwise
  // spin forever. The file is still perfectly sendable — only our preview of it
  // is missing — so say that plainly instead of implying the send failed.
  const [previewFailed, setPreviewFailed] = useState(false);
  const [trim, setTrim] = useState({ start: 0, end: 0 });   // end 0 = "to the end"
  const [mute, setMute] = useState(false);
  const [qualityId, setQualityId] = useState(null);
  const [qualityOpen, setQualityOpen] = useState(false);
  const [rotate, setRotate] = useState(0);       // images only

  const duration = Number(meta?.duration) > 0 ? meta.duration : 0;
  const trimEnd = trim.end > 0 ? trim.end : duration;
  const cutLength = Math.max(0, trimEnd - trim.start);
  const trimmed = duration > 0 && (trim.start > 0.08 || trimEnd < duration - 0.08);

  // Reset everything when a different file arrives.
  useEffect(() => {
    setMeta(null); setPlaying(false); setCur(0); setFirstFrame(false);
    setPreviewFailed(false);
    setTrim({ start: 0, end: 0 }); setMute(false);
    setQualityId(null); setQualityOpen(false); setRotate(0); setCaption('');
  }, [file]);

  // Estimates describe what will ACTUALLY be sent, so they follow the cut and
  // the mute. Quoting the whole file's size next to a ten-second excerpt of it
  // would be worse than showing nothing.
  const quality = useMemo(() => {
    if (!isVideo || !meta || !file) return null;
    const limits = CLIP_LIMITS[tier] || CLIP_LIMITS.free;
    return buildQualityOptions(meta, file.size, limits, { duration: cutLength, mute });
  }, [isVideo, meta, file, tier, cutLength, mute]);

  // The SELECTION is held as an id, not as the option object: the objects are
  // rebuilt whenever the cut changes, and holding one would pin a stale estimate
  // on screen.
  useEffect(() => {
    if (quality && qualityId == null) setQualityId(quality.defaultId);
  }, [quality, qualityId]);
  const chosen = quality?.options.find(o => o.id === qualityId) || quality?.options[0] || null;

  const filmstrip = useFilmstrip(isVideo ? url : null, duration);

  // ── playback, bounded by the trim window ─────────────────────────────────
  const seek = useCallback((t) => {
    const v = videoRef.current;
    if (!v) return;
    try { v.currentTime = Math.max(0, t); } catch { /* not seekable yet */ }
    setCur(Math.max(0, t));
  }, []);

  const togglePlay = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) {
      // Restart from the in-point when the playhead is outside the selection,
      // so pressing play always previews the cut rather than the source.
      if (v.currentTime < trim.start - 0.05 || v.currentTime >= trimEnd - 0.05) {
        try { v.currentTime = trim.start; } catch { /* ignore */ }
      }
      const p = v.play();
      if (p?.catch) p.catch(() => {});
    } else {
      v.pause();
    }
  }, [trim.start, trimEnd]);

  const onTimeUpdate = () => {
    const v = videoRef.current;
    if (!v) return;
    // Loop inside the selection. Telegram does the same, and it is the only way
    // to judge a cut without repeatedly dragging the playhead back.
    if (trimEnd > 0 && v.currentTime >= trimEnd - 0.03) {
      try { v.currentTime = trim.start; } catch { /* ignore */ }
      setCur(trim.start);
      return;
    }
    setCur(v.currentTime || 0);
  };

  const onLoadedMetadata = () => {
    const v = videoRef.current;
    if (!v) return;
    setMeta({
      width: v.videoWidth,
      height: v.videoHeight,
      duration: Number.isFinite(v.duration) && v.duration > 0 ? v.duration : 0,
    });
    // FORCE A FRAME. The WebView will happily hold a metadata-only video showing
    // nothing at all; a hair of a seek makes it decode and paint one.
    if (v.currentTime < 0.01) { try { v.currentTime = 0.05; } catch { /* ignore */ } }
  };

  // ── send ─────────────────────────────────────────────────────────────────
  //
  // NOTHING IS PROCESSED HERE. This screen decides and hands the decision over;
  // the trim, the re-encode and the upload all happen in the thread, behind a
  // bubble that is already on screen. Tapping send has to return you to the
  // conversation immediately — the alternative is standing at a progress bar
  // while your other chats wait, which is the whole thing this avoids.
  const buildOpts = () => {
    if (isVideo) return optsForQuality(chosen, { trimStart: trim.start, trimEnd, duration, mute });
    if (isImage && rotate) return { rotate };
    return null;
  };

  const doSend = (schedule) => {
    if (scheduling) return;
    const handler = schedule ? onSchedule : onSend;
    if (!handler) return;
    videoRef.current?.pause();
    handler(file, caption, buildOpts());
  };

  // A long-press fires a synthesised click on release; swallow that one click
  // so scheduling doesn't ALSO send the file immediately.
  const holdRef = useRef({ timer: null, long: false });
  useEffect(() => () => clearTimeout(holdRef.current.timer), []);
  const startHold = () => {
    if (!onSchedule) return;
    holdRef.current.long = false;
    clearTimeout(holdRef.current.timer);
    holdRef.current.timer = setTimeout(() => {
      holdRef.current.long = true;
      doSend(true);
    }, 500);
  };
  const endHold = () => clearTimeout(holdRef.current.timer);
  const handleSendClick = () => {
    if (holdRef.current.long) { holdRef.current.long = false; return; }
    doSend(false);
  };

  if (!file) return null;

  const rotated = rotate === 90 || rotate === 270;
  const sizeLabel = formatBytes(file.size);

  return (
    <div className="fixed inset-0 z-[100] flex flex-col animate-fade-in" style={{ background: '#07080D' }}>
      {/* Header. Opaque and inset — a translucent bar over a chat thread reads as
          an unfinished overlay, and an un-inset one lands under the clock. */}
      <header
        className="flex items-center gap-2 px-3 shrink-0"
        style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 10px)', paddingBottom: 10 }}
      >
        <button
          onClick={onCancel}
          aria-label="Cancel"
          className="w-10 h-10 rounded-full bg-white/10 flex items-center justify-center active:scale-90 transition-transform"
        >
          <Icon name="close" size={22} className="text-white" />
        </button>

        <div className="flex-1 min-w-0 text-center px-1">
          <p className="text-white text-[13px] font-bold truncate">{file.name}</p>
          <p className="text-text-muted text-[11px] font-dmmono tabular-nums">
            {sizeLabel}{isVideo && duration ? ` · ${formatDuration(duration)}` : ''}
          </p>
        </div>

        {isImage ? (
          <button
            onClick={() => setRotate((r) => (r + 90) % 360)}
            aria-label="Rotate"
            className="w-10 h-10 rounded-full bg-white/10 flex items-center justify-center active:scale-90 transition-transform"
          >
            <Icon name="rotate_90_degrees_ccw" size={20} className="text-white" />
          </button>
        ) : <div className="w-10" />}
      </header>

      {/* Stage */}
      <main className="flex-1 min-h-0 relative flex items-center justify-center px-3">
        {isImage && url && (
          <RotatableImage src={url} rotate={rotate} rotated={rotated} />
        )}

        {isVideo && url && (
          <div className="relative w-full h-full flex items-center justify-center">
            <video
              ref={videoRef}
              src={url}
              playsInline
              preload="auto"
              muted={mute}
              onClick={togglePlay}
              onPlay={() => setPlaying(true)}
              onPause={() => setPlaying(false)}
              onLoadedMetadata={onLoadedMetadata}
              onLoadedData={() => setFirstFrame(true)}
              onSeeked={() => setFirstFrame(true)}
              onError={() => setPreviewFailed(true)}
              onTimeUpdate={onTimeUpdate}
              className={`max-w-full max-h-full rounded-xl ${previewFailed ? 'hidden' : ''}`}
            />

            {/* Until a frame is decoded there is nothing to look at. A quiet
                spinner is honest about that; the WebView's own grey placeholder
                looked like the file had failed to load. */}
            {!firstFrame && !previewFailed && (
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <span className="w-9 h-9 rounded-full border-2 border-white/20 border-t-white/80 animate-spin" />
              </div>
            )}

            {previewFailed && (
              <div className="text-center px-8">
                <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-surface-2 flex items-center justify-center">
                  <Icon name="movie" size={32} className="text-brand-violet-light" />
                </div>
                <p className="text-white text-sm font-bold mb-1">Can't preview this video</p>
                <p className="text-text-muted text-xs">
                  Your device can't play this format here, but it will still send.
                </p>
              </div>
            )}

            {!playing && firstFrame && !previewFailed && (
              <button
                onClick={togglePlay}
                aria-label="Play"
                className="absolute inset-0 flex items-center justify-center"
              >
                <span className="w-16 h-16 rounded-full bg-black/45 backdrop-blur-sm flex items-center justify-center">
                  <Icon name="play_arrow" size={38} className="text-white relative left-[2px]" />
                </span>
              </button>
            )}

            {firstFrame && !previewFailed && duration > 0 && (
              <span className="absolute left-3 top-3 px-2 py-1 rounded-lg bg-black/55 backdrop-blur-sm text-white text-[11px] font-dmmono tabular-nums pointer-events-none">
                {formatDuration(Math.max(0, cur - trim.start))} / {formatDuration(cutLength)}
              </span>
            )}
          </div>
        )}

        {!isImage && !isVideo && (
          <div className="bg-surface-2 rounded-2xl p-8 text-center border border-white/[0.06]">
            <div className="w-16 h-16 mx-auto mb-4 rounded-xl bg-surface-3 flex items-center justify-center">
              <Icon name="description" size={32} className="text-brand-violet-light" />
            </div>
            <p className="text-white font-bold text-sm mb-1">{file.name}</p>
            <p className="text-text-muted text-xs">{sizeLabel} · {file.type || 'Unknown type'}</p>
          </div>
        )}
      </main>

      {/* Footer */}
      <footer
        className="shrink-0 px-3 pt-3"
        style={{ paddingBottom: 'calc(var(--vg-safe-b, 0px) + 12px)' }}
      >
        <div className="max-w-2xl mx-auto">
          {isVideo && duration > 1.2 && (
            <TrimStrip
              duration={duration}
              frames={filmstrip}
              start={trim.start}
              end={trimEnd}
              playhead={cur}
              onChange={(next) => {
                setTrim({ start: next.start, end: next.end });
                // Show the sender the frame they are cutting to, the moment they
                // drag to it — a handle with no picture attached is guesswork.
                seek(next.moved === 'end' ? Math.max(next.start, next.end - 0.1) : next.start);
                videoRef.current?.pause();
              }}
              onSeek={seek}
            />
          )}

          {isVideo && (
            <div className="flex items-center gap-2 mb-3 overflow-x-auto no-scrollbar">
              {quality?.options?.length > 1 && chosen && (
                <button
                  onClick={() => setQualityOpen(v => !v)}
                  className="shrink-0 flex items-center gap-2 px-3 py-2 rounded-2xl bg-surface-1 border border-white/[0.08] active:scale-95 transition-transform"
                >
                  <Icon name="tune" size={16} className="text-brand-violet-light" />
                  <span className="text-[12px] text-white font-medium">{chosen.label}</span>
                  <span className="text-[11px] text-text-muted font-dmmono tabular-nums">
                    {chosen.passthrough ? '' : '~'}{formatBytes(chosen.estBytes)}
                  </span>
                  <Icon name={qualityOpen ? 'expand_more' : 'expand_less'} size={16} className="text-text-muted" />
                </button>
              )}

              <button
                onClick={() => setMute(m => !m)}
                aria-pressed={mute}
                className={`shrink-0 flex items-center gap-2 px-3 py-2 rounded-2xl border active:scale-95 transition-transform ${
                  mute
                    ? 'bg-brand-violet/20 border-brand-violet/50 text-white'
                    : 'bg-surface-1 border-white/[0.08] text-text-secondary'
                }`}
              >
                <Icon name={mute ? 'volume_off' : 'volume_up'} size={16} className={mute ? 'text-brand-violet-light' : 'text-text-muted'} />
                <span className="text-[12px] font-medium">{mute ? 'Muted' : 'Sound'}</span>
              </button>

              {trimmed && (
                <button
                  onClick={() => { setTrim({ start: 0, end: 0 }); seek(0); }}
                  className="shrink-0 flex items-center gap-1.5 px-3 py-2 rounded-2xl bg-surface-1 border border-white/[0.08] text-text-secondary active:scale-95 transition-transform"
                >
                  <Icon name="restart_alt" size={16} className="text-text-muted" />
                  <span className="text-[12px] font-medium">Reset cut</span>
                </button>
              )}
            </div>
          )}

          {qualityOpen && quality && chosen && (
            <div className="mb-3 rounded-2xl bg-surface-1 border border-white/[0.08] overflow-hidden max-h-[40vh] overflow-y-auto">
              {quality.options.map((o) => (
                <button
                  key={o.id}
                  onClick={() => { setQualityId(o.id); setQualityOpen(false); }}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 text-left transition-colors ${
                    o.id === chosen.id ? 'bg-brand-violet/15' : 'active:bg-surface-2'
                  }`}
                >
                  <Icon
                    name={o.id === chosen.id ? 'radio_button_checked' : 'radio_button_unchecked'}
                    size={17}
                    className={o.id === chosen.id ? 'text-brand-violet-light' : 'text-text-muted'}
                  />
                  <span className="text-[13px] text-white font-medium flex-1">
                    {o.label}
                    {o.detail ? <span className="text-text-muted font-normal"> · {o.detail}</span> : null}
                  </span>
                  <span className="text-[12px] text-text-muted font-dmmono tabular-nums">
                    {o.passthrough ? '' : '~'}{formatBytes(o.estBytes)}
                  </span>
                </button>
              ))}
              <p className="px-3 py-2 text-[10px] text-text-muted/70 border-t border-white/[0.06]">
                Sizes are estimates. Lower quality uses less of your data and sends faster.
              </p>
            </div>
          )}

          <div className="flex items-center gap-3">
            <div className="flex-1 flex items-center bg-surface-1 rounded-3xl px-4 border border-white/[0.06] focus-within:border-brand-violet/40 transition-all">
              <input
                value={caption}
                onChange={e => setCaption(e.target.value)}
                placeholder="Add a caption..."
                className="flex-1 bg-transparent py-3 text-sm text-white outline-none"
                onKeyDown={e => { if (e.key === 'Enter') doSend(false); }}
              />
            </div>
            <button
              onClick={handleSendClick}
              onPointerDown={startHold}
              onPointerUp={endHold}
              onPointerLeave={endHold}
              onContextMenu={(e) => {
                if (!onSchedule) return;
                e.preventDefault();
                holdRef.current.long = true;
                doSend(true);
              }}
              disabled={scheduling}
              aria-label="Send"
              className="w-12 h-12 rounded-full bg-brand-violet text-white flex items-center justify-center active:scale-90 transition-transform disabled:opacity-60"
            >
              {scheduling
                ? <span className="w-5 h-5 rounded-full border-2 border-white/30 border-t-white animate-spin" />
                : <Icon name="send" size={22} />}
            </button>
          </div>

          {onSchedule && (
            <p className="mt-2 text-center text-[11px] text-text-muted">
              {scheduling ? 'Preparing your file…' : 'Hold Send to schedule for later'}
            </p>
          )}
        </div>
      </footer>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────────── */

/**
 * The cut, drawn on the video's own frames.
 *
 * A trim control without pictures is a pair of numbers, and nobody knows where
 * second 14 is in their own video. The strip doubles as the scrubber, which is
 * why there is no second seek bar anywhere on this screen.
 */
function TrimStrip({ duration, frames, start, end, playhead, onChange, onSeek }) {
  const trackRef = useRef(null);
  const dragRef = useRef(null);
  // Never let the window collapse to nothing; a zero-length cut is not a cut.
  const MIN = Math.min(0.6, duration * 0.04);
  const GRAB_PX = 26;

  const pct = (t) => (duration > 0 ? Math.max(0, Math.min(100, (t / duration) * 100)) : 0);

  const timeAt = (clientX) => {
    const r = trackRef.current?.getBoundingClientRect();
    if (!r?.width) return 0;
    return Math.max(0, Math.min(duration, ((clientX - r.left) / r.width) * duration));
  };

  const apply = (clientX) => {
    const t = timeAt(clientX);
    const which = dragRef.current;
    if (which === 'start') onChange({ start: Math.min(t, end - MIN), end, moved: 'start' });
    else if (which === 'end') onChange({ start, end: Math.max(t, start + MIN), moved: 'end' });
    else onSeek(Math.max(start, Math.min(end, t)));
  };

  // Hit-test on the way down instead of putting capture on each handle: one
  // element owns the gesture, so a finger that slides off a 12px grip keeps
  // dragging it rather than silently switching to a seek.
  const onDown = (e) => {
    const r = trackRef.current?.getBoundingClientRect();
    if (!r?.width) return;
    const grab = (GRAB_PX / r.width) * duration;
    const t = timeAt(e.clientX);
    const dS = Math.abs(t - start);
    const dE = Math.abs(t - end);
    dragRef.current = (dS <= grab && dS <= dE) ? 'start' : (dE <= grab ? 'end' : 'seek');
    try { trackRef.current.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    apply(e.clientX);
  };
  const onMove = (e) => { if (dragRef.current) apply(e.clientX); };
  const onUp = (e) => {
    if (!dragRef.current) return;
    dragRef.current = null;
    try { trackRef.current.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
  };

  return (
    <div className="mb-3">
      <div
        ref={trackRef}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        className="relative h-14 rounded-xl overflow-hidden bg-surface-2 select-none"
        style={{ touchAction: 'none' }}
      >
        {/* Frames. Absent (still decoding, or a codec we cannot sample) the
            control still works — it just looks like a plain bar. */}
        <div className="absolute inset-0 flex">
          {frames.length > 0
            ? frames.map((f, i) => (
                <img key={i} src={f} alt="" draggable={false}
                  className="flex-1 h-full object-cover pointer-events-none" />
              ))
            : <div className="flex-1 h-full bg-gradient-to-r from-surface-2 to-surface-3" />}
        </div>

        {/* Everything outside the selection is dimmed, so the kept section is
            what the eye lands on. */}
        <div className="absolute inset-y-0 left-0 bg-black/65 pointer-events-none" style={{ width: `${pct(start)}%` }} />
        <div className="absolute inset-y-0 right-0 bg-black/65 pointer-events-none" style={{ width: `${100 - pct(end)}%` }} />

        <div
          className="absolute inset-y-0 border-y-2 border-brand-violet-light pointer-events-none"
          style={{ left: `${pct(start)}%`, right: `${100 - pct(end)}%` }}
        />

        <Handle side="left" left={`${pct(start)}%`} />
        <Handle side="right" left={`${pct(end)}%`} />

        <div
          className="absolute top-0 bottom-0 w-[2px] bg-white/90 pointer-events-none shadow-[0_0_6px_rgba(0,0,0,0.8)]"
          style={{ left: `${pct(playhead)}%` }}
        />
      </div>

      <div className="flex items-center justify-between mt-1.5 px-0.5">
        <span className="text-[11px] text-text-muted font-dmmono tabular-nums">
          {formatDuration(start)} – {formatDuration(end)}
        </span>
        <span className="text-[11px] text-brand-violet-light font-dmmono tabular-nums font-bold">
          {formatDuration(Math.max(0, end - start))}
        </span>
      </div>
    </div>
  );
}

function Handle({ side, left }) {
  return (
    <div
      className="absolute top-0 bottom-0 w-3 bg-brand-violet-light flex items-center justify-center pointer-events-none"
      style={{
        left,
        transform: side === 'left' ? 'translateX(-100%)' : 'none',
        borderTopLeftRadius: side === 'left' ? 6 : 0,
        borderBottomLeftRadius: side === 'left' ? 6 : 0,
        borderTopRightRadius: side === 'right' ? 6 : 0,
        borderBottomRightRadius: side === 'right' ? 6 : 0,
      }}
    >
      <span className="w-[2px] h-4 rounded-full bg-black/40" />
    </div>
  );
}

/**
 * Images, with rotation applied as a preview.
 *
 * At 90 and 270 degrees the box the picture needs is the container's other way
 * round, so the fit constraints swap with it — otherwise a wide photo turned
 * upright runs straight off the top and bottom of the screen.
 */
function RotatableImage({ src, rotate, rotated }) {
  const boxRef = useRef(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);

  useEffect(() => {
    const el = boxRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => setBox({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setBox({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  return (
    <div ref={boxRef} className="w-full h-full flex items-center justify-center overflow-hidden">
      {failed && (
        <div className="text-center px-8">
          <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-surface-2 flex items-center justify-center">
            <Icon name="image" size={32} className="text-brand-violet-light" />
          </div>
          <p className="text-white text-sm font-bold mb-1">Can't preview this photo</p>
          <p className="text-text-muted text-xs">It will still send.</p>
        </div>
      )}
      <img
        src={src}
        alt="Preview"
        draggable={false}
        onError={() => setFailed(true)}
        className={`object-contain rounded-xl ${failed ? 'hidden' : ''}`}
        style={{
          transform: `rotate(${rotate}deg)`,
          transition: 'transform 180ms ease',
          maxWidth: rotated && box.h ? `${box.h}px` : '100%',
          maxHeight: rotated && box.w ? `${box.w}px` : '100%',
        }}
      />
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────────── */

/**
 * Sample frames across the video for the trim strip.
 *
 * Runs on its own detached element so seeking never yanks the playhead out from
 * under whoever is watching the preview, starts a beat late so it cannot delay
 * first paint, and gives up quietly. Frames appear as they are captured, so the
 * strip fills in rather than arriving all at once.
 */
function useFilmstrip(url, duration) {
  const [frames, setFrames] = useState([]);

  useEffect(() => {
    setFrames([]);
    if (!url || !(duration > 0)) return;

    let dead = false;
    const v = document.createElement('video');
    v.src = url;
    v.muted = true;
    v.playsInline = true;
    v.preload = 'auto';

    const once = (evts, ms) => new Promise((res) => {
      let settled = false;
      const done = (ok) => {
        if (settled) return;
        settled = true;
        evts.forEach(e => v.removeEventListener(e, hit));
        v.removeEventListener('error', miss);
        clearTimeout(timer);
        res(ok);
      };
      const hit = () => done(true);
      const miss = () => done(false);
      const timer = setTimeout(() => done(false), ms);
      evts.forEach(e => v.addEventListener(e, hit));
      v.addEventListener('error', miss);
    });

    const go = async () => {
      if (!(await once(['loadeddata'], 8000)) || dead || !v.videoWidth) return;

      const h = 88;
      const w = Math.max(1, Math.round((v.videoWidth / v.videoHeight) * h));
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      const shots = [];

      for (let i = 0; i < FRAME_COUNT; i++) {
        if (dead) return;
        const t = Math.min(duration - 0.05, (duration * (i + 0.5)) / FRAME_COUNT);
        const seeked = once(['seeked'], 4000);
        try { v.currentTime = Math.max(0, t); } catch { return; }
        // eslint-disable-next-line no-await-in-loop
        if (!(await seeked) || dead) return;
        try {
          ctx.drawImage(v, 0, 0, w, h);
          shots.push(canvas.toDataURL('image/jpeg', 0.6));
        } catch { return; }
        if (!dead) setFrames([...shots]);
      }
    };

    // Let the preview itself paint before a second decoder starts competing for
    // the same file.
    const kick = setTimeout(go, 150);

    return () => {
      dead = true;
      clearTimeout(kick);
      try { v.removeAttribute('src'); v.load(); } catch { /* ignore */ }
    };
  }, [url, duration]);

  return frames;
}

const FRAME_COUNT = 8;
