import React, { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useUser } from '../../context/UserContext';
import { useUI } from '../../context/UIContext';
import { auth } from '../../firebase/config';
import { createPost, uploadPostMedia } from '../../firebase/firestore';
import { useLayout } from '../../context/LayoutContext';
import useResponsive from '../../hooks/useResponsive';
import { getTierConfig, checkFileSizeAccess, resolveTier } from '../../utils/tierSystem';
import { compressForTier, formatMB } from '../../utils/videoCompress';
import UserAvatar from '../../components/UserAvatar';
import Icon from '../../components/Icon';
import EmbedVideoPlayer, { parseVideoUrl, getThumbnailUrl } from '../../components/EmbedVideoPlayer';


export default function CreateClipPostScreen() {
  const [content, setContent] = useState('');
  const [videoFile, setVideoFile] = useState(null);
  const [videoDuration, setVideoDuration] = useState(0);
  const [loading, setLoading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [compressProgress, setCompressProgress] = useState(0);
  const [compressing, setCompressing] = useState(false);
  const [embedUrl, setEmbedUrl] = useState('');
  const [parsedEmbed, setParsedEmbed] = useState(null);
  const [mode, setMode] = useState('upload');
  const fileInputRef = useRef(null);
  const { profile } = useUser();
  const { showToast } = useUI();
  const navigate = useNavigate();
  const { setRightPanel, setContentAlign } = useLayout();
  const { isDesktop } = useResponsive();
  const userTier = resolveTier(profile);
  const tierConfig = getTierConfig(userTier);
  // Length is deliberately unlimited — see SHORTS_LIMITS in mediaCompression.js.
  const nextTier = userTier === 'free' ? 'lite' : userTier === 'lite' ? 'pro' : null;

  useEffect(() => { setRightPanel(null); setContentAlign(isDesktop ? 'left' : 'center'); return () => { setRightPanel(null); setContentAlign('center'); }; }, [setRightPanel, setContentAlign, isDesktop]);

  const fmt = (s) => `${Math.floor(s / 60)}:${Math.floor(s % 60).toString().padStart(2, '0')}`;

  const handleFileSelect = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const sizeCheck = checkFileSizeAccess(userTier, file.size);
    if (!sizeCheck.allowed) { showToast(sizeCheck.message, 'error'); return; }
    const url = URL.createObjectURL(file);
    const v = document.createElement('video');
    v.preload = 'metadata';
    v.onloadedmetadata = () => {
      // No length limit — the plan's size cap above is the only ceiling.
      setVideoDuration(v.duration);
      setVideoFile({ file, preview: url });
    };
    v.src = url;
    e.target.value = '';
  };

  const handleEmbedUrlChange = (url) => {
    setEmbedUrl(url);
    setParsedEmbed(parseVideoUrl(url));
  };

  const handlePost = async () => {
    if (mode === 'embed') {
      if (!parsedEmbed || loading) return;
      setLoading(true);
      try {
        await createPost(auth.currentUser.uid, {
          content: content.trim(),
          type: 'video',
          hashtags: (content.match(/#\w+/g) || []).map(t => t.slice(1).toLowerCase()),
          embedVideoUrl: embedUrl.trim(),
          youtubeVideoId: parsedEmbed.platform === 'youtube' ? parsedEmbed.videoId : null,
          thumbnailUrl: getThumbnailUrl(parsedEmbed),
        });
        showToast('Video posted!', 'success');
        navigate(-1);
      } catch (err) {
        console.error(err);
        showToast('Failed to create post', 'error');
      }
      setLoading(false);
      return;
    }

    if (!videoFile || loading) return;
    setLoading(true);
    setUploadProgress(0);
    setCompressProgress(0);
    try {
      // Compress before upload — cuts storage + bandwidth by 70-95%.
      setCompressing(true);
      const compressed = await compressForTier(videoFile.file, userTier, (p) => {
        setCompressProgress(Math.round(p * 100));
      });
      setCompressing(false);
      // Wrap Blob as File so downstream uploader keeps a name/type.
      const finalFile = new File([compressed], (videoFile.file.name || 'clip').replace(/\.\w+$/, '.mp4'), { type: 'video/mp4' });

      const postId = await createPost(auth.currentUser.uid, {
        content: content.trim(),
        type: videoDuration <= 60 ? 'clip' : 'video',
        hashtags: (content.match(/#\w+/g) || []).map(t => t.slice(1).toLowerCase()),
      });
      const iv = setInterval(() => setUploadProgress(p => Math.min(p + 3, 90)), 200);
      await uploadPostMedia(postId, finalFile);
      clearInterval(iv);
      setUploadProgress(100);
      showToast(`Clip posted! (${formatMB(videoFile.file.size)} → ${formatMB(finalFile.size)})`, 'success');
      navigate(-1);
    } catch (err) {
      console.error(err);
      showToast('Failed to upload', 'error');
    }
    setCompressing(false);
    setLoading(false);
    if (videoFile) URL.revokeObjectURL(videoFile.preview);
  };

  const canPost = mode === 'embed' ? !!parsedEmbed : !!videoFile;

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
              <h1 className="font-syne font-bold text-base text-white">Video Clip</h1>
              <p className="text-text-muted text-[10px] font-dmmono">
                {mode === 'embed' ? 'Paste a video URL' : `Any length · ${tierConfig.videoMaxHeight === Infinity ? '4K' : `${tierConfig.videoMaxHeight}p`}`}
              </p>
            </div>
          </div>
          <button
            onClick={handlePost}
            disabled={loading || !canPost}
            className="bg-brand-violet text-white px-6 py-2 rounded-full font-bold text-sm disabled:opacity-30 hover:brightness-110 active:scale-[0.97] transition-all"
          >
            {loading ? (
              <span className="flex items-center gap-2">
                <div className="w-4 h-4 border-2 border-bg-dark/30 border-t-bg-dark rounded-full animate-spin" />
                {mode === 'upload' ? (compressing ? `Compress ${compressProgress}%` : `${uploadProgress}%`) : '...'}
              </span>
            ) : 'Post'}
          </button>
        </div>
        {loading && mode === 'upload' && (
          <div className="h-1 bg-surface-3">
            <div className="h-full bg-brand-ember transition-all duration-300"
              style={{ width: `${compressing ? compressProgress : uploadProgress}%` }} />
          </div>
        )}
      </header>

      <div className={`flex-1 overflow-y-auto ${isDesktop ? 'flex gap-6 px-6 py-5' : 'px-4 py-4'}`}>
        {/* Sidebar */}
        <div className={isDesktop ? 'w-[340px] shrink-0 flex flex-col gap-4' : 'mb-4'}>
          <div className="flex gap-3">
            <UserAvatar src={profile?.avatar} size={40} />
            <div className="flex-1">
              <p className="text-brand-violet-light text-xs font-dmmono mb-1">@{profile?.username || 'you'}</p>
              <textarea
                value={content}
                onChange={e => setContent(e.target.value)}
                placeholder="Describe your clip..."
                className="w-full bg-transparent text-text-primary text-sm leading-relaxed placeholder:text-text-muted/40 outline-none resize-none min-h-[80px]"
                maxLength={500}
              />
            </div>
          </div>

          {/* Mode toggle */}
          <div className="flex rounded-xl overflow-hidden border border-white/[0.06]">
            <button
              onClick={() => setMode('upload')}
              className={`flex-1 py-2.5 text-xs font-bold flex items-center justify-center gap-1.5 transition-colors border-r border-white/[0.06] ${
                mode === 'upload' ? 'bg-brand-ember/10 text-brand-ember' : 'bg-surface-1 text-text-muted hover:text-text-secondary'
              }`}
            >
              <Icon name="cloud_upload" size={14} /> Upload
            </button>
            <button
              onClick={() => setMode('embed')}
              className={`flex-1 py-2.5 text-xs font-bold flex items-center justify-center gap-1.5 transition-colors ${
                mode === 'embed' ? 'bg-brand-violet/10 text-brand-violet' : 'bg-surface-1 text-text-muted hover:text-text-secondary'
              }`}
            >
              <Icon name="link" size={14} /> Paste URL
            </button>
          </div>

          {mode === 'upload' ? (
            <div className="p-4 rounded-2xl bg-surface-1 border border-white/[0.06]">
              <p className="text-text-muted text-[10px] uppercase tracking-wider font-bold mb-3">Your limits</p>
              <div className="space-y-2.5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2"><Icon name="timer" size={14} className="text-text-muted" /><span className="text-text-secondary text-xs">Length</span></div>
                  <span className="text-brand-violet-light text-xs font-dmmono font-bold">Unlimited</span>
                </div>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2"><Icon name="hd" size={14} className="text-text-muted" /><span className="text-text-secondary text-xs">Quality</span></div>
                  <span className="text-brand-violet-light text-xs font-dmmono font-bold">{tierConfig.videoMaxHeight === Infinity ? '4K' : `${tierConfig.videoMaxHeight}p`}</span>
                </div>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2"><Icon name="cloud_upload" size={14} className="text-text-muted" /><span className="text-text-secondary text-xs">Max size</span></div>
                  <span className="text-text-secondary text-xs font-dmmono">{tierConfig.maxFileUploadMB}MB</span>
                </div>
              </div>
              {nextTier && (
                <button onClick={() => navigate('/settings/subscription')} className="w-full mt-3 py-2 rounded-xl bg-brand-violet/[0.06] border border-brand-violet/20 text-brand-violet-light text-[11px] font-bold hover:bg-brand-violet/10 transition-colors">
                  Upgrade for more
                </button>
              )}
            </div>
          ) : (
            <div className="p-4 rounded-2xl bg-surface-1 border border-white/[0.06]">
              <p className="text-text-muted text-[10px] uppercase tracking-wider font-bold mb-3">Embed video</p>
              <p className="text-text-secondary text-xs mb-3">Paste a YouTube or Twitch URL. No storage needed — the video streams from the original source.</p>
              <div className="flex items-center gap-2 text-text-muted text-[10px]">
                <Icon name="smart_display" size={12} /> YouTube
                <span className="mx-1">·</span>
                <Icon name="live_tv" size={12} /> Twitch
              </div>
            </div>
          )}
        </div>

        {/* Preview area */}
        <div className="flex-1">
          {mode === 'upload' ? (
            videoFile ? (
              <div className="relative rounded-2xl overflow-hidden border border-white/[0.06] bg-black">
                <video src={videoFile.preview} controls playsInline className="w-full max-h-[500px] object-contain" />
                <div className="absolute top-3 left-3 px-2.5 py-1 rounded-lg bg-black/70 backdrop-blur-sm">
                  <span className="text-white text-xs font-dmmono font-bold">{fmt(videoDuration)}</span>
                </div>
                <button
                  onClick={() => { URL.revokeObjectURL(videoFile.preview); setVideoFile(null); setVideoDuration(0); }}
                  className="absolute top-3 right-3 w-8 h-8 rounded-lg bg-brand-ember/80 backdrop-blur-sm flex items-center justify-center text-white"
                >
                  <Icon name="close" size={16} />
                </button>
                <div className="absolute bottom-3 right-3 px-2.5 py-1 rounded-lg bg-black/70 backdrop-blur-sm">
                  <span className="text-text-muted text-[10px] font-dmmono">{(videoFile.file.size / (1024 * 1024)).toFixed(1)}MB</span>
                </div>
              </div>
            ) : (
              <button
                onClick={() => fileInputRef.current?.click()}
                className="w-full aspect-[9/16] max-h-[500px] rounded-2xl border-2 border-dashed border-white/[0.08] bg-gradient-to-b from-surface-1/30 to-surface-1/10 flex flex-col items-center justify-center gap-4 hover:border-brand-ember/30 hover:from-brand-ember/5 hover:to-transparent transition-all group cursor-pointer"
              >
                <div className="w-20 h-20 rounded-3xl bg-gradient-to-br from-brand-ember/15 to-brand-gold/15 border border-white/[0.08] flex items-center justify-center group-hover:scale-105 transition-transform">
                  <Icon name="videocam" size={36} className="text-brand-ember" />
                </div>
                <div className="text-center">
                  <p className="text-text-primary font-syne font-bold">Upload a Clip</p>
                  <p className="text-text-muted text-xs mt-1">Any length · {tierConfig.videoMaxHeight === Infinity ? '4K' : `${tierConfig.videoMaxHeight}p`} · {tierConfig.maxFileUploadMB}MB max</p>
                </div>
              </button>
            )
          ) : (
            <div className="flex flex-col gap-4">
              <div className="relative">
                <input
                  type="url"
                  value={embedUrl}
                  onChange={e => handleEmbedUrlChange(e.target.value)}
                  placeholder="Paste YouTube or Twitch URL..."
                  className="w-full px-4 py-3 rounded-2xl bg-surface-1 border border-white/[0.06] text-text-primary text-sm placeholder:text-text-muted/40 outline-none focus:border-brand-violet/40 transition-colors"
                />
                {parsedEmbed && (
                  <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-1.5 px-2 py-0.5 rounded-lg bg-brand-violet/10 text-brand-violet text-[10px] font-bold uppercase">
                    <Icon name="check_circle" size={12} />
                    {parsedEmbed.platform === 'youtube' ? 'YouTube' : 'Twitch'}
                  </div>
                )}
              </div>

              {parsedEmbed ? (
                <div className="relative rounded-2xl overflow-hidden border border-white/[0.06] bg-black">
                  <EmbedVideoPlayer videoId={parsedEmbed.videoId} platform={parsedEmbed.platform} autoplayOnView={false} />
                  <button
                    onClick={() => { setEmbedUrl(''); setParsedEmbed(null); }}
                    className="absolute top-3 right-3 w-8 h-8 rounded-lg bg-brand-ember/80 backdrop-blur-sm flex items-center justify-center text-white z-10"
                  >
                    <Icon name="close" size={16} />
                  </button>
                </div>
              ) : (
                <div className="w-full aspect-video rounded-2xl border-2 border-dashed border-white/[0.08] bg-gradient-to-b from-surface-1/30 to-surface-1/10 flex flex-col items-center justify-center gap-4">
                  <div className="w-20 h-20 rounded-3xl bg-gradient-to-br from-brand-violet/15 to-brand-pink/15 border border-white/[0.08] flex items-center justify-center">
                    <Icon name="link" size={36} className="text-brand-violet" />
                  </div>
                  <div className="text-center">
                    <p className="text-text-primary font-syne font-bold">Paste a Video URL</p>
                    <p className="text-text-muted text-xs mt-1">YouTube or Twitch · No storage needed</p>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
      <input type="file" ref={fileInputRef} onChange={handleFileSelect} className="hidden" accept="video/*" />
    </div>
  );
}
