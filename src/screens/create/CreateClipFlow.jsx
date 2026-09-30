// /create/clip: the ONE way a clip is made, on the web and in the phone app
// (founder, 2026-09-13: "where do i even go to create a clip"). Every entry that
// makes a video lands here: the composer's Share Clip card and any video added in
// the composer, the Shorts camera button, the empty Shorts screen, a sound's "Use
// this sound", and the phone's Create hub. /create/short redirects here.
//
// Three steps, the way TikTok makes a video:
//   record (phone) or upload (desktop)  ->  edit  ->  post
//
// Founder decisions, 2026-09-13: trim and a silenced original are cut into the
// file at post time (compressVideo); text, stickers, speed and the sound mix are
// stored on the post and drawn by the player (utils/clipEdits.js). Every new post
// from here is type 'clip'.
import { blockUnverified } from '../../utils/emailGate';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useUser } from '../../context/UserContext';
import { useUI } from '../../context/UIContext';
import { useLayout } from '../../context/LayoutContext';
import useResponsive from '../../hooks/useResponsive';
import { auth } from '../../firebase/config';
import { createPost } from '../../firebase/firestore';
import { uploadToR2 } from '../../utils/r2Storage';
import { compressVideo, CLIP_LIMITS, getMediaDimensions, posterFromVideo } from '../../utils/mediaCompression';
import { resolveTier, getTierConfig, checkFileSizeAccess } from '../../utils/tierSystem';
import { IS_NATIVE_BUILD } from '../../utils/platform';
import { soundFieldsFor } from '../../utils/sounds';
import { defaultEdits, editsForPost, composeCover, fixWebmDuration } from '../../utils/clipEdits';
import { takeClipDraft } from '../../utils/clipDraft';
import { useSoundChoice } from '../../components/clips/SoundPicker';
import ClipRecorder from '../../components/create/ClipRecorder';
import ClipEditor from '../../components/create/ClipEditor';
import ClipPostForm from '../../components/create/ClipPostForm';
import NativeVideoPicker from '../../components/media/NativeVideoPicker';
import Icon from '../../components/Icon';

const C = {
  page: '#0B0B14',
  card: '#14141F',
  raised: '#1E1E2C',
  violet: '#7B1FFF',
  dropOver: '#221A3A',
  ember: '#F04060',
  muted: '#9CA3AF',
};

const fmtSize = (mb) => (mb >= 1024 ? `${Math.round((mb / 1024) * 10) / 10} GB` : `${mb} MB`);
const hashtagsOf = (s) => [...new Set((String(s || '').match(/#\w+/g) || []).map((t) => t.slice(1).toLowerCase()))];

export default function CreateClipFlow() {
  const navigate = useNavigate();
  const location = useLocation();
  const { profile } = useUser();
  const { showToast } = useUI();
  const { setRightPanel, setContentAlign } = useLayout();
  const { isDesktop } = useResponsive();
  const soundChoice = useSoundChoice();

  const tier = resolveTier(profile);
  const limits = CLIP_LIMITS[tier] || CLIP_LIMITS.free;
  const nextTier = tier === 'free' ? 'lite' : tier === 'lite' ? 'pro' : null;
  const maxMB = getTierConfig(tier)?.maxFileUploadMB;

  const [draft] = useState(() => takeClipDraft());
  const [step, setStep] = useState(() => (draft ? 'loading' : isDesktop ? 'pick' : 'record'));
  const [video, setVideo] = useState(null);           // { file, preview, duration, width, height }
  const [trim, setTrim] = useState({ start: 0, end: 0 });
  const [edits, setEdits] = useState(defaultEdits);
  const [coverAt, setCoverAt] = useState(0);
  const [caption, setCaption] = useState(draft?.caption || '');
  // Instagram's "Also share to feed", on by default as it is there.
  const [shareToFeed, setShareToFeed] = useState(true);
  const [editorTool, setEditorTool] = useState(null);
  const [coverUrl, setCoverUrl] = useState(null);
  const [prep, setPrep] = useState(null);             // { pct } while cutting and optimizing
  const [posting, setPosting] = useState(null);       // { label, pct }
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const inputRef = useRef(null);
  const jobRef = useRef(null);
  const videoRef = useRef(null);
  const coverRef = useRef(null);
  videoRef.current = video;

  const home = isDesktop ? 'pick' : 'record';

  // Desktop takes the full content width (TikTok Studio); the phone steps are
  // full screen of their own.
  useEffect(() => {
    setRightPanel(null);
    setContentAlign(isDesktop ? 'left' : 'center');
    return () => { setRightPanel(null); setContentAlign('center'); };
  }, [setRightPanel, setContentAlign, isDesktop]);

  useEffect(() => () => {
    if (videoRef.current?.preview) URL.revokeObjectURL(videoRef.current.preview);
    if (coverRef.current) URL.revokeObjectURL(coverRef.current);
  }, []);

  const leave = () => {
    if (location.key === 'default') navigate('/', { replace: true });
    else navigate(-1);
  };

  const acceptFile = useCallback(async (file) => {
    if (!file) return;
    if (!file.type?.startsWith('video/')) { showToast('Choose a video file', 'error'); return; }
    const size = checkFileSizeAccess(tier, file.size);
    if (!size.allowed) { showToast(size.message, 'error'); return; }
    setStep('loading');

    // A recording carries its real length (ClipRecorder stamps it) and no duration
    // in the file; write it in before anything tries to read one.
    let f = file;
    let duration = Number(file._durationSec) || 0;
    if (duration) f = await fixWebmDuration(file, duration);
    const dims = await getMediaDimensions(f);
    if (!duration && Number.isFinite(dims.duration) && dims.duration > 0) duration = dims.duration;
    if (!dims.width && !duration) {
      showToast('That video could not be read on this device. Try an MP4.', 'error');
      setStep(home);
      return;
    }

    if (videoRef.current?.preview) URL.revokeObjectURL(videoRef.current.preview);
    jobRef.current = null;
    setPrep(null);
    setVideo({ file: f, preview: URL.createObjectURL(f), duration, width: dims.width || 0, height: dims.height || 0 });
    setTrim({ start: 0, end: duration });
    setEdits(defaultEdits());
    setCoverAt(Math.min(0.15, duration || 0));
    setEditorTool(null);
    setStep('edit');
  }, [tier, showToast, home]);

  // A video handed over by the composer opens straight in the editor.
  useEffect(() => {
    if (draft?.file) acceptFile(draft.file);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const openPicker = () => {
    if (IS_NATIVE_BUILD) setPickerOpen(true);
    else inputRef.current?.click();
  };

  // The cover always sits inside the part that is kept.
  useEffect(() => {
    setCoverAt((c) => Math.min(Math.max(c, trim.start), Math.max(trim.start, trim.end - 0.05)));
  }, [trim.start, trim.end]);

  // ── the cut: one encode at a time, keyed by exactly what changes the file ──
  const startSec = trim.start > 0.05 ? trim.start : 0;
  const endSec = video?.duration && trim.end < video.duration - 0.05 ? trim.end : null;
  const mute = edits.originalVolume === 0;
  const cutKey = video ? `${video.preview}|${startSec.toFixed(2)}|${endSec == null ? '-' : endSec.toFixed(2)}|${mute}` : '';

  const prepare = useCallback(() => {
    if (!video) return Promise.reject(new Error('Choose a video first'));
    if (jobRef.current?.key === cutKey) return jobRef.current.promise;
    const prev = jobRef.current;
    const job = { key: cutKey };
    const mine = () => jobRef.current === job;
    jobRef.current = job;
    job.promise = (async () => {
      if (prev) await prev.promise.catch(() => {});
      if (!mine()) throw new Error('superseded');
      setPrep({ pct: 0 });
      const out = await compressVideo(
        video.file,
        tier,
        (p) => { if (mine()) setPrep({ pct: Math.round(Math.max(0, Math.min(1, p || 0)) * 100) }); },
        'clip',
        { trimStart: startSec, trimEnd: endSec, mute },
      );
      let file = out instanceof File ? out : new File([out], 'clip.webm', { type: out?.type || 'video/webm' });
      const span = (endSec ?? video.duration) - startSec;
      if (span > 0) file = await fixWebmDuration(file, span);
      return file;
    })();
    job.promise.then(
      () => { if (mine()) setPrep(null); },
      () => { if (mine()) { setPrep(null); jobRef.current = null; } },
    );
    return job.promise;
  }, [video, cutKey, tier, startSec, endSec, mute]);

  // Start the cut as the post screen opens, so Post is usually instant. A failure
  // here says nothing: a failed job clears itself, Post runs it again from the
  // user's own tap and reports any error then. (A browser can refuse to play the
  // hidden copy with sound until the page has had a real tap, and a toast about
  // that would tell the user their clip is broken when Post will work.)
  useEffect(() => {
    if (step !== 'post' || !video) return;
    prepare().catch(() => {});
  }, [step, video, prepare]);

  // The cover tile: the chosen frame with the text and stickers drawn on.
  useEffect(() => {
    if (step !== 'post' || !video) return undefined;
    let alive = true;
    (async () => {
      let img = await posterFromVideo(video.file, { at: coverAt, maxWidth: 360 });
      if (img && edits.overlays.length) img = await composeCover(img, edits.overlays);
      if (!alive || !img) return;
      if (coverRef.current) URL.revokeObjectURL(coverRef.current);
      coverRef.current = URL.createObjectURL(img);
      setCoverUrl(coverRef.current);
    })();
    return () => { alive = false; };
  }, [step, video, coverAt, edits.overlays]);

  const handlePost = async () => {
    if (!video || posting) return;
    const uid = auth.currentUser?.uid;
    if (!uid) { showToast('Sign in to post a clip', 'error'); return; }
    if (blockUnverified('post')) return;
    setPosting({ label: 'Preparing' });
    try {
      const file = await prepare();
      setPosting({ label: 'Posting', pct: 0 });
      // Upload first, then create the post once with the URL on it.
      const { url } = await uploadToR2(file, 'clip', (pct) => setPosting({ label: 'Posting', pct: Math.max(0, Math.min(100, Math.round(pct))) }));
      let poster = await posterFromVideo(video.file, { at: coverAt });
      if (poster && edits.overlays.length) poster = await composeCover(poster, edits.overlays);
      const thumbnailUrl = poster ? (await uploadToR2(poster, 'post')).url : null;
      const sound = soundChoice.sound;
      const postId = await createPost(uid, {
        type: 'clip',
        content: caption.trim(),
        hashtags: hashtagsOf(caption),
        mediaUrls: [url],
        thumbnailUrl,
        ...soundFieldsFor(sound, edits.originalVolume > 0),
        edits: editsForPost({ ...edits, soundVolume: sound ? edits.soundVolume : 1 }),
        shareToFeed,
      });
      showToast('Clip posted', 'success');
      navigate(`/clip/${postId}`, { replace: true });
    } catch (err) {
      console.error(err);
      showToast(err?.message && err.message !== 'superseded' ? err.message : 'Could not post your clip. Please try again.', 'error');
      setPosting(null);
    }
  };

  const discard = () => {
    setConfirmDiscard(false);
    if (videoRef.current?.preview) URL.revokeObjectURL(videoRef.current.preview);
    jobRef.current = null;
    setPrep(null);
    setVideo(null);
    setCoverUrl(null);
    setEdits(defaultEdits());
    setStep(home);
  };

  const busy = posting
    ? (posting.label === 'Preparing' ? { label: 'Preparing', pct: prep?.pct ?? 0 } : posting)
    : null;

  let body = null;
  if (step === 'record') {
    body = (
      <ClipRecorder
        tier={tier}
        wide={isDesktop}
        onRecorded={acceptFile}
        onUpload={openPicker}
        onClose={isDesktop ? () => setStep('pick') : leave}
      />
    );
  } else if (step === 'pick') {
    body = (
      <UploadStep
        onBack={leave}
        onChoose={openPicker}
        onRecord={() => setStep('record')}
        onDropFile={acceptFile}
        maxMB={maxMB}
        quality={limits.maxShortSide}
        upgrade={nextTier ? { label: `Get ${CLIP_LIMITS[nextTier].maxShortSide}p`, onClick: () => navigate('/settings/subscription') } : null}
      />
    );
  } else if (step === 'edit' && video) {
    body = (
      <ClipEditor
        key={video.preview}
        video={video}
        trim={trim}
        onTrim={setTrim}
        edits={edits}
        onEdits={setEdits}
        coverAt={coverAt}
        onCoverAt={setCoverAt}
        soundChoice={soundChoice}
        wide={isDesktop}
        initialTool={editorTool}
        onBack={() => setConfirmDiscard(true)}
        onNext={() => { setEditorTool(null); setStep('post'); }}
      />
    );
  } else if (step === 'post' && video) {
    body = (
      <ClipPostForm
        wide={isDesktop}
        onBack={() => setStep('edit')}
        onEdit={() => setStep('edit')}
        onEditCover={() => { setEditorTool('cover'); setStep('edit'); }}
        video={video}
        trim={trim}
        edits={edits}
        coverUrl={coverUrl}
        caption={caption}
        onCaption={setCaption}
        maxLength={500}
        soundChoice={soundChoice}
        quality={{
          value: `${limits.maxShortSide}p`,
          upgrade: nextTier ? `Get ${CLIP_LIMITS[nextTier].maxShortSide}p` : null,
          onUpgrade: () => navigate('/settings/subscription'),
        }}
        preparing={prep}
        busy={busy}
        canPost={!posting}
        onPost={handlePost}
        shareToFeed={shareToFeed}
        onShareToFeed={setShareToFeed}
      />
    );
  } else {
    body = <Loading wide={isDesktop} />;
  }

  return (
    <>
      {body}
      <input
        ref={inputRef}
        type="file"
        accept="video/*"
        className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; acceptFile(f); }}
      />
      {IS_NATIVE_BUILD && (
        <NativeVideoPicker
          open={pickerOpen}
          onClose={() => setPickerOpen(false)}
          onPicked={(f) => { setPickerOpen(false); acceptFile(f); }}
          onUseSystemPicker={() => inputRef.current?.click()}
        />
      )}
      {confirmDiscard && <DiscardDialog onDiscard={discard} onCancel={() => setConfirmDiscard(false)} />}
    </>
  );
}

// Desktop: TikTok Studio's upload page. A large drop zone, then what will be
// accepted, stated plainly.
function UploadStep({ onBack, onChoose, onRecord, onDropFile, maxMB, quality, upgrade }) {
  const [over, setOver] = useState(false);
  return (
    <div className="min-h-screen" style={{ background: C.page }}>
      <header className="sticky top-0 z-30 px-4" style={{ background: C.page, paddingTop: 'calc(env(safe-area-inset-top, 0px) + 6px)', paddingBottom: 6 }}>
        <div className="w-full max-w-[1120px] mx-auto flex items-center gap-1">
          <button type="button" onClick={onBack} aria-label="Back" className="w-11 h-11 grid place-items-center rounded-full text-white hover:bg-[#1E1E2C]">
            <Icon name="arrow_back" size={24} />
          </button>
          <h1 className="font-syne font-bold text-white text-[20px]">Upload clip</h1>
        </div>
      </header>
      <main className="w-full max-w-[1120px] mx-auto px-6 pb-12 pt-2">
        <div
          onDragOver={(e) => { e.preventDefault(); setOver(true); }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setOver(false);
            const file = [...(e.dataTransfer?.files || [])].find((f) => f.type?.startsWith('video/'));
            if (file) onDropFile(file);
          }}
          className="rounded-[20px] min-h-[440px] flex flex-col items-center justify-center text-center px-8 transition-colors"
          style={{ background: over ? C.dropOver : C.card }}
        >
          <span className="w-[72px] h-[72px] rounded-full grid place-items-center" style={{ background: C.violet }}>
            <Icon name="upload" size={34} className="text-white" />
          </span>
          <p className="mt-5 font-syne font-bold text-white text-[24px]">{over ? 'Drop it to start editing' : 'Select a video to upload'}</p>
          <p className="mt-2 text-[15px]" style={{ color: C.muted }}>Or drag and drop it here</p>
          <div className="mt-7 flex items-center gap-3">
            <button type="button" onClick={onChoose} className="h-12 px-9 rounded-full text-white font-bold text-[15px] active:scale-[0.98] transition-transform" style={{ background: C.violet }}>
              Select video
            </button>
            <button type="button" onClick={onRecord} className="h-12 px-6 rounded-full text-white font-semibold text-[15px] flex items-center gap-2 hover:bg-[#262636]" style={{ background: C.raised }}>
              <Icon name="videocam" size={20} /> Record
            </button>
          </div>
        </div>
        <div className="mt-4 grid grid-cols-4 gap-3">
          <Info icon="sd_storage" title="Size" text={maxMB ? `Up to ${fmtSize(maxMB)} per video` : 'Your plan’s upload limit'} />
          <Info icon="movie" title="Formats" text="MP4, MOV or WebM" />
          <Info icon="hd" title="Quality" text={`Posts at ${quality}p`} action={upgrade} />
          <Info icon="crop_portrait" title="Aspect ratio" text="9:16 portrait fills the screen" />
        </div>
      </main>
    </div>
  );
}

function Info({ icon, title, text, action }) {
  return (
    <div className="rounded-2xl p-4 flex gap-3" style={{ background: C.card }}>
      <Icon name={icon} size={22} className="text-text-secondary shrink-0" />
      <div className="min-w-0">
        <p className="text-white text-[14px] font-semibold">{title}</p>
        <p className="mt-0.5 text-[13px] leading-[18px]" style={{ color: C.muted }}>{text}</p>
        {action && (
          <button type="button" onClick={action.onClick} className="mt-1.5 text-[13px] font-semibold text-brand-violet-light">
            {action.label}
          </button>
        )}
      </div>
    </div>
  );
}

function Loading({ wide }) {
  return (
    <div
      className={wide ? 'min-h-[70vh] grid place-items-center' : 'fixed inset-0 z-[60] grid place-items-center bg-black'}
      style={wide ? { background: C.page } : undefined}
    >
      <div className="flex flex-col items-center gap-3">
        <span className="w-9 h-9 rounded-full animate-spin" style={{ border: '3px solid #2E2E40', borderTopColor: '#FFFFFF' }} />
        <p className="text-[14px] text-white">Opening your video</p>
      </div>
    </div>
  );
}

function DiscardDialog({ onDiscard, onCancel }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); onCancel(); } };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onCancel]);
  return (
    <div
      data-scrim
      className="fixed inset-0 z-[210] grid place-items-center px-6"
      style={{ background: 'rgba(0,0,0,0.6)' }}
      onClick={onCancel}
      role="dialog"
      aria-modal="true"
      aria-label="Discard this clip?"
    >
      <div className="w-full max-w-[340px] rounded-2xl p-5 text-center" style={{ background: C.card }} onClick={(e) => e.stopPropagation()}>
        <p className="font-syne font-bold text-white text-[19px]">Discard this clip?</p>
        <p className="mt-2 text-[14px] leading-[20px]" style={{ color: C.muted }}>Your video and edits will be lost.</p>
        <button type="button" onClick={onDiscard} className="mt-5 w-full h-12 rounded-[12px] text-white font-bold text-[15px]" style={{ background: C.ember }}>
          Discard
        </button>
        <button type="button" onClick={onCancel} className="mt-2 w-full h-12 rounded-[12px] text-white font-semibold text-[15px]" style={{ background: C.raised }}>
          Keep editing
        </button>
      </div>
    </div>
  );
}
