// Step three of /create/clip: the post screen, after the editor (founder,
// 2026-09-13: the first version "does not look professional and in no way looks
// like tiktok would do it").
//
// PHONE: TikTok's post screen. The description with the cover beside it, a
// hashtag chip, a plain list of settings, and Edit beside a large Post button at
// the bottom. The cover opens the clip exactly as it will play: trimmed, at its
// speed, with its text, stickers and sound.
//
// DESKTOP (`wide`): TikTok Studio's details page. Details and settings on the
// left, a phone-shaped preview on the right, Post and Back to edit under the form.
//
// Presentational only; CreateClipFlow owns the file, the edits and the upload.
// House rules: solid values only (scrims excepted, and marked), no hairline
// borders, no dashed boxes, no blur, and the clip is never cropped.
import { useEffect, useRef, useState } from 'react';
import Icon from '../Icon';
import { SoundSheet } from '../clips/SoundPicker';
import EditOverlays, { useContentRect, useTrimLoop } from '../clips/EditOverlays';
import { useLayeredSound } from '../../screens/shorts/playerParts';
import { fmtTime } from '../../utils/clipEdits';

const C = {
  page: '#0B0B14',
  card: '#14141F',
  raised: '#1E1E2C',
  chip: '#15151F',
  band: '#101019',
  violet: '#7B1FFF',
  violetDeep: '#4A148F',
  disabled: '#211D30',
  muted: '#9CA3AF',
  faint: '#6B7280',
};
const SHADOW = { filter: 'drop-shadow(0 1px 3px rgba(0,0,0,0.6))' };

export default function ClipPostForm({
  wide = false,
  onBack,
  onEdit,
  onEditCover,
  video,              // { file, preview, duration }
  trim,               // { start, end }
  edits,              // utils/clipEdits.js
  coverUrl = null,    // the chosen cover frame, overlays drawn on
  caption,
  onCaption,
  maxLength = 500,
  soundChoice = null, // useSoundChoice()
  quality = null,     // { value, upgrade, onUpgrade }
  preparing = null,   // { pct } while the file is being cut and optimized
  busy = null,        // { label, pct } while posting
  canPost = true,
  onPost,
  shareToFeed = true,      // Instagram's "Also share to feed"
  onShareToFeed = null,
}) {
  const [previewOpen, setPreviewOpen] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const captionRef = useRef(null);
  const sound = soundChoice?.sound || null;
  const duration = video.duration > 0 && Number.isFinite(video.duration) ? video.duration : 0;
  const end = duration && trim.end < duration - 0.05 ? trim.end : duration;
  const playLength = Math.max(0, (end - trim.start) / (edits.speed || 1));
  const texts = edits.overlays.filter((o) => o.kind === 'text').length;
  const stickers = edits.overlays.length - texts;
  const editSummary = [
    fmtTime(playLength),
    edits.speed !== 1 ? `${edits.speed}x` : null,
    texts ? `${texts} text${texts === 1 ? '' : 's'}` : null,
    stickers ? `${stickers} sticker${stickers === 1 ? '' : 's'}` : null,
  ].filter(Boolean).join(' · ');
  const soundValue = sound ? sound.title : edits.originalVolume === 0 ? 'No sound' : 'Original sound';

  const addHashtag = () => {
    const base = caption || '';
    const next = base && !/\s$/.test(base) ? `${base} #` : `${base}#`;
    if (next.length <= maxLength) onCaption(next);
    requestAnimationFrame(() => {
      const el = captionRef.current;
      if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); }
    });
  };

  const captionField = (
    <textarea
      id="clip-caption"
      ref={captionRef}
      value={caption}
      onChange={(e) => onCaption(e.target.value.slice(0, maxLength))}
      placeholder="Describe your clip"
      maxLength={maxLength}
      className={`w-full bg-transparent text-white outline-none resize-none placeholder:text-[#6B7280] ${wide ? 'min-h-[120px] text-[15px] leading-[22px]' : 'flex-1 min-w-0 min-h-[150px] text-[16px] leading-[22px]'}`}
    />
  );

  const hashtagRow = (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={addHashtag}
        className="h-8 px-3 rounded-[10px] flex items-center gap-1 text-[13px] font-semibold text-white"
        style={{ background: C.raised }}
      >
        <span className="font-bold">#</span> Hashtags
      </button>
      <span className="ml-auto text-[12px] tabular-nums" style={{ color: C.faint }}>{(caption || '').length}/{maxLength}</span>
    </div>
  );

  const rows = (
    <>
      <Row icon="music_note" label="Sound" value={soundValue} onClick={soundChoice ? () => setSheetOpen(true) : null} wide={wide} />
      <Row icon="movie_edit" label="Edit clip" value={editSummary} onClick={onEdit} wide={wide} />
      {!wide && <Row icon="image" label="Cover" value="Change" onClick={onEditCover} />}
      {onShareToFeed && (
        <Row
          icon="dynamic_feed"
          label="Also share to feed"
          sub={shareToFeed ? 'On your profile and in followers’ home feeds' : 'Only in Clips'}
          wide={wide}
        >
          <Switch on={shareToFeed} onChange={onShareToFeed} label="Also share to feed" />
        </Row>
      )}
      {quality && (
        <Row icon="hd" label="Quality" value={quality.value} wide={wide}>
          {quality.upgrade && (
            <button type="button" onClick={quality.onUpgrade} className="h-8 px-3 rounded-full text-[13px] font-bold text-white" style={{ background: C.violet }}>
              {quality.upgrade}
            </button>
          )}
        </Row>
      )}
    </>
  );

  const status = preparing && !busy ? (
    <p className="mb-2 text-[12px] tabular-nums text-center" style={{ color: C.muted }} aria-live="polite">
      Getting your clip ready · {Math.round(preparing.pct || 0)}%
    </p>
  ) : null;

  const soundSheet = sheetOpen && soundChoice ? (
    <SoundSheet
      selectedId={sound?.id}
      onClose={() => setSheetOpen(false)}
      onPick={(s) => { soundChoice.picker.onChange(s); setSheetOpen(false); }}
    />
  ) : null;

  // ── DESKTOP ──
  if (wide) {
    return (
      <div className="min-h-screen" style={{ background: C.page }}>
        <Header title="Post clip" onBack={onBack} wide />
        <main className="w-full max-w-[1120px] mx-auto px-6 pb-12 pt-2 grid gap-8 items-start" style={{ gridTemplateColumns: 'minmax(0,1fr) 340px' }}>
          <section className="min-w-0 space-y-4">
            <div className="rounded-2xl p-6" style={{ background: C.card }}>
              <h2 className="text-white text-[17px] font-bold">Details</h2>
              <label htmlFor="clip-caption" className="mt-5 mb-2 block text-[13px] font-semibold" style={{ color: C.muted }}>Description</label>
              <div className="rounded-[12px] p-4" style={{ background: C.page }}>
                {captionField}
                <div className="mt-2">{hashtagRow}</div>
              </div>
              <p className="mt-6 mb-2 text-[13px] font-semibold" style={{ color: C.muted }}>Cover</p>
              <div className="flex items-end gap-4">
                <div className="relative w-[96px] rounded-[10px] overflow-hidden bg-black" style={{ aspectRatio: '9 / 16' }}>
                  {coverUrl ? <img src={coverUrl} alt="" className="absolute inset-0 w-full h-full object-contain" /> : <Spinner />}
                </div>
                <button type="button" onClick={onEditCover} className="h-10 px-4 rounded-full text-white text-[14px] font-semibold hover:bg-[#262636]" style={{ background: C.raised }}>
                  Edit cover
                </button>
              </div>
            </div>

            <div className="rounded-2xl px-6 py-5" style={{ background: C.card }}>
              <h2 className="mb-2 text-white text-[17px] font-bold">Settings</h2>
              {rows}
            </div>

            {status && <div className="text-left">{status}</div>}
            <div className="flex items-center gap-3">
              <PostButton busy={busy} canPost={canPost} onPost={onPost} className="h-12 min-w-[200px] px-10 rounded-full text-[15px]" />
              <button type="button" onClick={onEdit} disabled={!!busy} className="h-12 px-6 rounded-full text-white font-semibold text-[15px] disabled:opacity-50" style={{ background: C.raised }}>
                Back to edit
              </button>
            </div>
          </section>

          <aside className="sticky top-20">
            <EditedPreview
              video={video}
              trim={trim}
              edits={edits}
              sound={sound}
              caption={caption}
              onSound={soundChoice ? () => setSheetOpen(true) : null}
            />
          </aside>
        </main>
        {soundSheet}
      </div>
    );
  }

  // ── PHONE ──
  return (
    <div className="min-h-screen flex flex-col" style={{ background: C.page }}>
      <Header title="Post" onBack={onBack} />

      <main className="flex-1 w-full max-w-[560px] mx-auto px-4 pt-1 pb-6">
        <div className="flex gap-3">
          {captionField}
          <button
            type="button"
            onClick={() => setPreviewOpen(true)}
            aria-label="Preview your clip"
            className="relative shrink-0 w-[104px] self-start rounded-[12px] overflow-hidden bg-black"
            style={{ aspectRatio: '9 / 16' }}
          >
            {coverUrl ? <img src={coverUrl} alt="" className="absolute inset-0 w-full h-full object-contain" /> : <Spinner />}
            <span className="absolute inset-x-0 bottom-0 h-8 flex items-center justify-center gap-1 text-white text-[12px] font-semibold" style={{ background: C.chip }}>
              <Icon name="play_arrow" filled size={16} /> Preview
            </span>
          </button>
        </div>
        <div className="mt-2">{hashtagRow}</div>
        <div className="mt-5 -mx-4 h-2" style={{ background: C.band }} />
        <div className="mt-1 -mx-4">{rows}</div>
      </main>

      <footer className="sticky bottom-0 z-30 px-4 pt-3" style={{ background: C.page, paddingBottom: 'calc(var(--vg-safe-b, 0px) + 12px)' }}>
        <div className="max-w-[560px] mx-auto">
          {status}
          <div className="flex gap-3">
            <button
              type="button"
              onClick={onEdit}
              disabled={!!busy}
              className="flex-1 h-[52px] rounded-[14px] flex items-center justify-center gap-1.5 text-white text-[16px] font-semibold disabled:opacity-50"
              style={{ background: C.raised }}
            >
              <Icon name="movie_edit" size={20} /> Edit
            </button>
            <PostButton busy={busy} canPost={canPost} onPost={onPost} className="flex-[2] h-[52px] rounded-[14px] text-[16px]" />
          </div>
        </div>
      </footer>

      {previewOpen && (
        <EditedPreview
          fullscreen
          video={video}
          trim={trim}
          edits={edits}
          sound={sound}
          onClose={() => setPreviewOpen(false)}
          onSound={soundChoice ? () => setSheetOpen(true) : null}
        />
      )}
      {soundSheet}
    </div>
  );
}

function Header({ title, onBack, wide = false }) {
  return (
    <header
      className={`sticky top-0 z-30 ${wide ? 'px-4' : 'px-2'}`}
      style={{ background: C.page, paddingTop: 'calc(env(safe-area-inset-top, 0px) + 6px)', paddingBottom: 6 }}
    >
      <div className={`flex items-center gap-1 w-full ${wide ? 'max-w-[1120px] mx-auto' : ''}`}>
        <button type="button" onClick={onBack} aria-label="Back" className="w-11 h-11 grid place-items-center rounded-full text-white active:scale-95 transition-transform hover:bg-[#1E1E2C]">
          <Icon name="arrow_back" size={24} />
        </button>
        <h1 className={`font-syne font-bold text-white ${wide ? 'text-[20px]' : 'text-[17px]'}`}>{title}</h1>
      </div>
    </header>
  );
}

function Spinner() {
  return (
    <span className="absolute inset-0 grid place-items-center">
      <span className="w-6 h-6 rounded-full animate-spin" style={{ border: '2px solid #2E2E40', borderTopColor: '#FFFFFF' }} />
    </span>
  );
}

function PostButton({ busy, canPost, onPost, className = '' }) {
  const on = canPost && !busy;
  const pct = busy && Number.isFinite(busy.pct) ? Math.max(0, Math.min(100, busy.pct)) : null;
  return (
    <button
      type="button"
      onClick={onPost}
      disabled={!on}
      aria-busy={!!busy}
      className={`relative overflow-hidden font-bold transition-transform active:scale-[0.99] ${className}`}
      style={{ background: busy ? C.violetDeep : on ? C.violet : C.disabled, color: busy || on ? '#FFFFFF' : C.faint }}
    >
      {pct != null && (
        <span aria-hidden className="absolute inset-y-0 left-0" style={{ width: `${pct}%`, background: C.violet, transition: 'width 200ms ease-out' }} />
      )}
      <span className="relative tabular-nums">{busy ? `${busy.label}${pct != null ? ` ${Math.round(pct)}%` : '…'}` : 'Post'}</span>
    </button>
  );
}

// A real switch: a track with a sliding knob, solid values only.
function Switch({ on, onChange, label }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={() => onChange?.(!on)}
      className="relative shrink-0 w-[46px] h-[28px] rounded-full transition-colors"
      style={{ background: on ? C.violet : '#2A2A3A' }}
    >
      <span
        aria-hidden
        className="absolute top-[3px] w-[22px] h-[22px] rounded-full transition-transform"
        style={{ left: 3, background: on ? '#FFFFFF' : '#9CA3AF', transform: `translateX(${on ? 18 : 0}px)` }}
      />
    </button>
  );
}

function Row({ icon, label, sub = null, value, onClick, wide = false, children }) {
  const body = (
    <>
      <Icon name={icon} size={22} className="text-white shrink-0" />
      <span className="flex-1 min-w-0 text-left">
        <span className="block text-[15px] text-white">{label}</span>
        {sub && <span className="block text-[12px] mt-0.5 truncate" style={{ color: C.muted }}>{sub}</span>}
      </span>
      {value && <span className="max-w-[55%] truncate text-[14px]" style={{ color: C.muted }}>{value}</span>}
      {children}
      {onClick && !children && <Icon name="chevron_right" size={20} className="text-text-muted shrink-0" />}
    </>
  );
  const cls = `w-full min-h-[56px] flex items-center gap-3 ${wide ? '-mx-3 px-3 rounded-xl' : 'px-4'}`;
  return onClick
    ? <button type="button" onClick={onClick} className={`${cls} ${wide ? 'w-[calc(100%+24px)] hover:bg-[#1A1A26]' : 'active:bg-[#14141F]'}`}>{body}</button>
    : <div className={`${cls} ${wide ? 'w-[calc(100%+24px)]' : ''}`}>{body}</div>;
}

/**
 * The clip as it will play once posted, from the local file: only the trimmed
 * part, at its edited speed, with its text, stickers, sound and mix. Inline on
 * desktop (starts paused, because a browser only lets sound start from a click),
 * or full screen on the phone.
 */
export function EditedPreview({ video, trim, edits, sound, caption = '', fullscreen = false, onClose, onSound }) {
  const boxRef = useRef(null);
  const ref = useRef(null);
  const [playing, setPlaying] = useState(false);
  const duration = video.duration > 0 && Number.isFinite(video.duration) ? video.duration : 0;
  const end = duration && trim.end < duration - 0.05 ? trim.end : null;
  const rect = useContentRect(boxRef, ref, false, edits.overlays.length > 0);
  useTrimLoop(ref, trim.start, end);
  useLayeredSound({
    ref,
    active: true,
    muted: false,
    sound: sound?.url ? { url: sound.url, keepOriginal: true } : null,
    volume: edits.soundVolume,
    timeScale: edits.speed,
    offset: trim.start,
  });

  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    v.defaultPlaybackRate = edits.speed;
    v.playbackRate = edits.speed;
  }, [edits.speed]);

  useEffect(() => {
    const v = ref.current;
    if (v) v.volume = Math.max(0, Math.min(1, edits.originalVolume));
  }, [edits.originalVolume]);

  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    try { v.currentTime = trim.start; } catch { /* not seekable yet */ }
    if (fullscreen) v.play().catch(() => { v.muted = true; v.play().catch(() => {}); });
  }, [fullscreen, trim.start]);

  useEffect(() => {
    if (!fullscreen) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [fullscreen, onClose]);

  const toggle = () => {
    const v = ref.current;
    if (!v) return;
    if (v.muted && !v.paused && edits.originalVolume > 0) { v.muted = false; return; }
    if (v.paused) v.play().catch(() => {});
    else v.pause();
  };

  return (
    <div
      ref={boxRef}
      className={fullscreen ? 'fixed inset-0 z-[150] bg-black' : 'relative w-full rounded-[24px] overflow-hidden bg-black'}
      style={fullscreen ? undefined : { aspectRatio: '9 / 16' }}
      role={fullscreen ? 'dialog' : undefined}
      aria-modal={fullscreen || undefined}
      aria-label={fullscreen ? 'Preview' : undefined}
    >
      <video
        ref={ref}
        src={video.preview}
        playsInline
        preload="auto"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onLoadedMetadata={(e) => { e.currentTarget.playbackRate = edits.speed; }}
        className="absolute inset-0 w-full h-full object-contain"
      />
      <EditOverlays overlays={edits.overlays} rect={rect} />
      <button type="button" onClick={toggle} aria-label={playing ? 'Pause preview' : 'Play preview'} className="absolute inset-0 z-[3] grid place-items-center">
        {!playing && (
          <Icon name="play_arrow" filled size={76} className="text-white" style={{ filter: 'drop-shadow(0 2px 10px rgba(0,0,0,0.55))' }} />
        )}
      </button>

      {!fullscreen && (
        <div
          data-scrim
          className="absolute inset-x-0 bottom-0 z-[4] px-4 pb-4 pt-16 pointer-events-none"
          style={{ background: 'linear-gradient(to top, rgba(0,0,0,0.62), rgba(0,0,0,0))' }}
        >
          {caption && (
            <p
              className="text-white text-[14px] leading-[19px] break-words"
              style={{ textShadow: '0 1px 3px rgba(0,0,0,0.7)', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}
            >
              {caption}
            </p>
          )}
          <p className="mt-1.5 flex items-center gap-1.5 text-[13px] font-medium" style={{ color: '#E5E5E5', textShadow: '0 1px 3px rgba(0,0,0,0.7)' }}>
            <Icon name="music_note" size={14} className="shrink-0" />
            <span className="truncate">{sound ? `${sound.title} – ${sound.authorName}` : 'original sound'}</span>
          </p>
        </div>
      )}

      {(fullscreen || onSound) && (
        <div
          className="absolute inset-x-0 top-0 z-[5] flex items-center justify-between px-2 pointer-events-none"
          style={{ paddingTop: fullscreen ? 'calc(env(safe-area-inset-top, 0px) + 6px)' : 10 }}
        >
          {fullscreen ? (
            <button type="button" onClick={onClose} aria-label="Close preview" className="pointer-events-auto w-11 h-11 grid place-items-center text-white" style={SHADOW}>
              <Icon name="close" size={26} />
            </button>
          ) : <span className="w-11" aria-hidden />}
          {onSound && (
            <button
              type="button"
              onClick={onSound}
              className="pointer-events-auto h-9 max-w-[60%] px-4 rounded-full flex items-center gap-1.5 text-white text-[14px] font-semibold"
              style={{ background: C.chip }}
            >
              <Icon name="music_note" size={16} />
              <span className="truncate">{sound ? sound.title : 'Add sound'}</span>
            </button>
          )}
          <span className="w-11" aria-hidden />
        </div>
      )}
    </div>
  );
}
