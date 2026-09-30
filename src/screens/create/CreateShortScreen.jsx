// ⚠ UNROUTED DEAD CODE since 2026-09-13. /create/short redirects to /create/clip,
// which renders screens/create/CreateClipFlow (record, edit, post) on the web and
// the phone. ClipPostForm's props changed with it, so this file no longer matches.
//
// Was: web /create/short, compress on pick, then upload and create the post once.
import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useUser } from '../../context/UserContext';
import { useUI } from '../../context/UIContext';
import { auth } from '../../firebase/config';
import { createPost } from '../../firebase/firestore';
import { uploadToR2 } from '../../utils/r2Storage';
import { useLayout } from '../../context/LayoutContext';
import useResponsive from '../../hooks/useResponsive';
import { compressVideo, SHORTS_LIMITS, getMediaDimensions, posterFromVideo } from '../../utils/mediaCompression';
import { resolveTier } from '../../utils/tierSystem';
import { useSoundChoice } from '../../components/clips/SoundPicker';
import ClipPostForm from '../../components/create/ClipPostForm';
import { soundFieldsFor } from '../../utils/sounds';

export default function CreateShortScreen() {
  const [content, setContent] = useState('');
  const [videoFile, setVideoFile] = useState(null);       // { file, preview, duration }
  const [compressedFile, setCompressedFile] = useState(null);
  const [compressing, setCompressing] = useState(false);
  const [compressProgress, setCompressProgress] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const fileInputRef = useRef(null);
  const { profile } = useUser();
  const { showToast } = useUI();
  const navigate = useNavigate();
  const { setRightPanel, setContentAlign } = useLayout();
  const { isDesktop } = useResponsive();
  // "Use this sound" arrives as ?sound=<key>; choosing one here works the same.
  const soundChoice = useSoundChoice();

  const userTier = resolveTier(profile);
  const limits = SHORTS_LIMITS[userTier] || SHORTS_LIMITS.free;
  const nextTier = userTier === 'free' ? 'lite' : userTier === 'lite' ? 'pro' : null;

  // Desktop takes the full content width for its two columns (details beside
  // the preview); the phone keeps the centred single column.
  useEffect(() => {
    setRightPanel(null);
    setContentAlign(isDesktop ? 'left' : 'center');
    return () => { setRightPanel(null); setContentAlign('center'); };
  }, [setRightPanel, setContentAlign, isDesktop]);

  const acceptFile = async (file) => {
    if (!file) return;
    // Length is not restricted, only size, which the plan's byte cap enforces.
    const dims = await getMediaDimensions(file);
    const preview = URL.createObjectURL(file);
    setVideoFile({ file, preview, duration: dims.duration, width: dims.width, height: dims.height });
    setCompressedFile(null);

    // Optimize straight away, so Post is ready by the time the caption is written.
    setCompressing(true);
    setCompressProgress(0);
    try {
      const result = await compressVideo(file, userTier, (p) => setCompressProgress(p));
      setCompressedFile(result);
    } catch (err) {
      showToast(err.message || 'Could not optimize that video', 'error');
      setCompressedFile(file);
    }
    setCompressing(false);
  };

  const handleFileSelect = (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    acceptFile(file);
  };

  const handlePost = async () => {
    const uploadFile = compressedFile || videoFile?.file;
    if (!uploadFile || uploading) return;
    setUploading(true);
    setUploadProgress(0);
    try {
      // Upload FIRST, then create the post with the URL attached. The old order
      // created the post and discarded what uploadPostMedia returned, so every
      // short published with an EMPTY mediaUrls while its video sat on R2
      // unreferenced, and a failed upload left a caption-only post behind.
      const { url } = await uploadToR2(uploadFile, 'clip', (pct) => setUploadProgress(Math.min(100, Math.max(0, Math.round(pct)))));
      // Cover frame, or the feed and the deck both paint a grey placeholder.
      const poster = await posterFromVideo(uploadFile);
      const thumbnailUrl = poster ? (await uploadToR2(poster, 'post')).url : null;
      await createPost(auth.currentUser.uid, {
        thumbnailUrl,
        content: content.trim(),
        type: 'short',
        hashtags: (content.match(/#\w+/g) || []).map(t => t.slice(1).toLowerCase()),
        mediaUrls: [url],
        ...soundFieldsFor(soundChoice.sound, soundChoice.keepOriginal),
      });
      showToast('Short posted!', 'success');
      navigate('/shorts');
    } catch (err) {
      console.error(err);
      showToast(err?.message || 'Could not post your short. Please try again.', 'error');
    }
    setUploading(false);
    if (videoFile) URL.revokeObjectURL(videoFile.preview);
  };

  const clearVideo = () => {
    if (videoFile) URL.revokeObjectURL(videoFile.preview);
    setVideoFile(null);
    setCompressedFile(null);
    setCompressing(false);
    setCompressProgress(0);
  };

  const busy = compressing
    ? { label: 'Optimizing', pct: Math.round((compressProgress || 0) * 100) }
    : uploading ? { label: 'Posting', pct: uploadProgress } : null;

  return (
    <>
      <ClipPostForm
        title="New short"
        onBack={() => navigate(-1)}
        wide={isDesktop}
        video={videoFile}
        onChoose={() => fileInputRef.current?.click()}
        onDropFile={isDesktop ? acceptFile : null}
        onRemove={clearVideo}
        chooseTitle={isDesktop ? 'Select a video to post' : 'Choose a video'}
        chooseHint={`Portrait fills the screen. Posts at ${limits.maxShortSide}p.`}
        caption={content}
        onCaption={setContent}
        maxLength={300}
        placeholder="Describe your short"
        soundChoice={soundChoice}
        quality={{
          label: 'Quality',
          value: `${limits.maxShortSide}p`,
          upgrade: nextTier ? `Get ${SHORTS_LIMITS[nextTier].maxShortSide}p` : null,
          onUpgrade: () => navigate('/settings/subscription'),
        }}
        busy={busy}
        canPost={!!compressedFile && !compressing && !uploading}
        onPost={handlePost}
      />
      <input type="file" ref={fileInputRef} onChange={handleFileSelect} className="hidden" accept="video/*" />
    </>
  );
}
