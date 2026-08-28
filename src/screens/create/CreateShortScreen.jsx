import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useUser } from '../../context/UserContext';
import { useUI } from '../../context/UIContext';
import { auth } from '../../firebase/config';
import { createPost, uploadPostMedia } from '../../firebase/firestore';
import { useLayout } from '../../context/LayoutContext';
import useResponsive from '../../hooks/useResponsive';
import { compressVideo, SHORTS_LIMITS, getMediaDimensions } from '../../utils/mediaCompression';
import { resolveTier } from '../../utils/tierSystem';
import UserAvatar from '../../components/UserAvatar';
import Icon from '../../components/Icon';
import UserName from '../../components/UserName';

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

  const userTier = resolveTier(profile);
  const limits = SHORTS_LIMITS[userTier] || SHORTS_LIMITS.free;
  const nextTier = userTier === 'free' ? 'lite' : userTier === 'lite' ? 'pro' : null;

  useEffect(() => {
    setRightPanel(null);
    setContentAlign(isDesktop ? 'left' : 'center');
    return () => { setRightPanel(null); setContentAlign('center'); };
  }, [setRightPanel, setContentAlign, isDesktop]);

  const fmt = (s) => `${Math.floor(s / 60)}:${Math.floor(s % 60).toString().padStart(2, '0')}`;

  const handleFileSelect = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';

    // Length is not restricted — only size, which the plan's byte cap already
    // enforces before we get here. Dimensions are still read for the preview.
    const dims = await getMediaDimensions(file);

    const preview = URL.createObjectURL(file);
    setVideoFile({ file, preview, duration: dims.duration, width: dims.width, height: dims.height });
    setCompressedFile(null);

    // Auto-compress
    setCompressing(true);
    setCompressProgress(0);
    try {
      const result = await compressVideo(file, userTier, (p) => setCompressProgress(p));
      setCompressedFile(result);
      const savings = ((1 - result.size / file.size) * 100).toFixed(0);
      if (result !== file) {
        showToast(`Compressed to ${(result.size / (1024 * 1024)).toFixed(1)}MB (${savings}% smaller)`, 'success');
      }
    } catch (err) {
      showToast(err.message || 'Compression failed', 'error');
      // Fall back to original file
      setCompressedFile(file);
    }
    setCompressing(false);
  };

  const handlePost = async () => {
    const uploadFile = compressedFile || videoFile?.file;
    if (!uploadFile || uploading) return;
    setUploading(true);
    setUploadProgress(0);
    try {
      const postId = await createPost(auth.currentUser.uid, {
        content: content.trim(),
        type: 'short',
        hashtags: (content.match(/#\w+/g) || []).map(t => t.slice(1).toLowerCase()),
      });
      const iv = setInterval(() => setUploadProgress(p => Math.min(p + 3, 90)), 200);
      await uploadPostMedia(postId, uploadFile);
      clearInterval(iv);
      setUploadProgress(100);
      showToast('Short posted!', 'success');
      navigate('/shorts');
    } catch (err) {
      console.error(err);
      showToast('Failed to upload', 'error');
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

  const canPost = !!compressedFile && !compressing && !uploading;
  const isWorking = compressing || uploading;

  return (
    <div className="min-h-screen flex flex-col bg-bg-dark">
      {/* Header */}
      <header className="sticky top-0 z-40 bg-bg-dark/90 backdrop-blur-xl border-b border-white/[0.04]">
        <div className="flex items-center justify-between px-4 py-3">
          <div className="flex items-center gap-3">
            <button onClick={() => navigate(-1)} className="w-9 h-9 rounded-xl bg-surface-2 border border-white/[0.06] flex items-center justify-center text-text-secondary hover:text-white transition-colors">
              <Icon name="arrow_back" size={20} />
            </button>
            <div>
              <h1 className="font-syne font-bold text-base text-white">Create Short</h1>
              <p className="text-text-muted text-[10px] font-dmmono">
                {limits.maxShortSide}p · any length
              </p>
            </div>
          </div>
          <button
            onClick={handlePost}
            disabled={!canPost}
            className="bg-brand-violet text-white px-6 py-2 rounded-full font-bold text-sm disabled:opacity-30 hover:brightness-110 active:scale-[0.97] transition-all"
          >
            {uploading ? (
              <span className="flex items-center gap-2">
                <div className="w-4 h-4 border-2 border-bg-dark/30 border-t-bg-dark rounded-full animate-spin" />
                {uploadProgress}%
              </span>
            ) : 'Post'}
          </button>
        </div>
        {/* Progress bars */}
        {compressing && (
          <div className="h-1 bg-surface-3">
            <div className="h-full bg-brand-violet transition-all duration-200" style={{ width: `${compressProgress * 100}%` }} />
          </div>
        )}
        {uploading && (
          <div className="h-1 bg-surface-3">
            <div className="h-full bg-brand-violet transition-all duration-300" style={{ width: `${uploadProgress}%` }} />
          </div>
        )}
      </header>

      <div className={`flex-1 overflow-y-auto ${isDesktop ? 'flex gap-6 px-6 py-5' : 'px-4 py-4'}`}>
        {/* Sidebar info */}
        <div className={isDesktop ? 'w-[340px] shrink-0 flex flex-col gap-4' : 'mb-4'}>
          {/* Caption */}
          <div className="flex gap-3">
            <UserAvatar src={profile?.avatar} size={40} />
            <div className="flex-1">
              <p className="text-brand-violet-light text-xs font-dmmono mb-1"><UserName user={profile} masked handle fallback={'you'} /></p>
              <textarea
                value={content}
                onChange={e => setContent(e.target.value)}
                placeholder="Describe your short..."
                className="w-full bg-transparent text-text-primary text-sm leading-relaxed placeholder:text-text-muted/50 outline-none resize-none min-h-[80px]"
                maxLength={300}
              />
            </div>
          </div>

          {/* Limits card */}
          <div className="p-4 rounded-2xl bg-surface-1 border border-white/[0.06]">
            <p className="text-text-muted text-[10px] uppercase tracking-wider font-bold mb-3 flex items-center gap-2">
              <Icon name="tune" size={12} /> Your limits
            </p>
            <div className="space-y-2.5">
              <LimitRow icon="timer" label="Length" value="Unlimited" />
              <LimitRow icon="hd" label="Resolution" value={`${limits.maxShortSide}p`} />
              <LimitRow icon="compress" label="Auto-compress" value="On" highlight />
            </div>
            {nextTier && (
              <button
                onClick={() => navigate('/settings/subscription')}
                className="w-full mt-3 py-2 rounded-xl bg-brand-violet/[0.06] border border-brand-violet/20 text-brand-violet-light text-[11px] font-bold hover:bg-brand-violet/10 transition-colors"
              >
                Upgrade to {nextTier} for {SHORTS_LIMITS[nextTier].maxShortSide}p
              </button>
            )}
          </div>

          {/* Compression status */}
          {compressing && (
            <div className="p-4 rounded-2xl bg-brand-violet/5 border border-brand-violet/20">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-brand-violet/10 flex items-center justify-center">
                  <div className="w-4 h-4 border-2 border-brand-violet/30 border-t-brand-violet rounded-full animate-spin" />
                </div>
                <div className="flex-1">
                  <p className="text-brand-violet text-xs font-bold">Compressing to {limits.maxShortSide}p...</p>
                  <p className="text-text-muted text-[10px] font-dmmono mt-0.5">{Math.round(compressProgress * 100)}%</p>
                </div>
              </div>
            </div>
          )}

          {compressedFile && !compressing && compressedFile !== videoFile?.file && (
            <div className="p-4 rounded-2xl bg-brand-violet/5 border border-brand-violet/20">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-brand-violet/10 flex items-center justify-center">
                  <Icon name="check_circle" size={18} className="text-brand-violet-light" />
                </div>
                <div className="flex-1">
                  <p className="text-brand-violet-light text-xs font-bold">Compressed</p>
                  <p className="text-text-muted text-[10px] font-dmmono mt-0.5">
                    {(videoFile.file.size / (1024 * 1024)).toFixed(1)}MB → {(compressedFile.size / (1024 * 1024)).toFixed(1)}MB
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Video preview area */}
        <div className="flex-1 flex items-start justify-center">
          {videoFile ? (
            <div className="relative w-full max-w-sm rounded-2xl overflow-hidden border border-white/[0.06] bg-black aspect-[9/16]">
              <video
                src={videoFile.preview}
                controls
                playsInline
                className="w-full h-full object-contain"
              />
              {/* Duration badge */}
              <div className="absolute top-3 left-3 px-2.5 py-1 rounded-lg bg-black/70 backdrop-blur-sm">
                <span className="text-white text-xs font-dmmono font-bold">{fmt(videoFile.duration)}</span>
              </div>
              {/* Size badge */}
              <div className="absolute bottom-3 right-3 px-2.5 py-1 rounded-lg bg-black/70 backdrop-blur-sm">
                <span className="text-text-muted text-[10px] font-dmmono">
                  {((compressedFile || videoFile.file).size / (1024 * 1024)).toFixed(1)}MB
                </span>
              </div>
              {/* Remove button */}
              {!isWorking && (
                <button
                  onClick={clearVideo}
                  className="absolute top-3 right-3 w-8 h-8 rounded-lg bg-brand-ember/80 backdrop-blur-sm flex items-center justify-center text-white"
                >
                  <Icon name="close" size={16} />
                </button>
              )}
            </div>
          ) : (
            <button
              onClick={() => fileInputRef.current?.click()}
              className="w-full max-w-sm aspect-[9/16] rounded-2xl border-2 border-dashed border-white/[0.08] bg-gradient-to-b from-surface-1/30 to-surface-1/10 flex flex-col items-center justify-center gap-5 hover:border-brand-violet/30 hover:from-brand-violet/5 hover:to-transparent transition-all group cursor-pointer"
            >
              <div className="w-20 h-20 rounded-3xl bg-gradient-to-br from-brand-violet/15 to-brand-violet/15 border border-white/[0.08] flex items-center justify-center group-hover:scale-110 transition-transform">
                <Icon name="slow_motion_video" size={38} className="text-brand-violet-light" />
              </div>
              <div className="text-center px-6">
                <p className="text-text-primary font-syne font-bold text-lg">Upload a Short</p>
                <p className="text-text-muted text-xs mt-2 leading-relaxed">
                  Any length · auto-compressed to {limits.maxShortSide}p
                </p>
                <p className="text-text-muted/50 text-[10px] mt-1">
                  MP4, WebM, MOV
                </p>
              </div>
            </button>
          )}
        </div>
      </div>

      <input type="file" ref={fileInputRef} onChange={handleFileSelect} className="hidden" accept="video/*" />
    </div>
  );
}

function LimitRow({ icon, label, value, highlight }) {
  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-2">
        <Icon name={icon} size={14} className="text-text-muted" />
        <span className="text-text-secondary text-xs">{label}</span>
      </div>
      <span className={`text-xs font-dmmono font-bold ${highlight ? 'text-brand-violet' : 'text-brand-violet-light'}`}>{value}</span>
    </div>
  );
}
