// NATIVE-APP create/compose screens (Android/iOS Tauri shell ONLY).
//
// Dedicated mobile-first variants of the Batch 8 create screens. Routed
// `IS_NATIVE_BUILD ? <Native> : <existing>`; never render on web. The existing
// src/screens/create/* + src/screens/home/CreatePollScreen are UNTOUCHED.
//
// Each reuses the EXACT same callables/payloads (createPost, uploadPostMedia,
// createPoll, createQuotePost) + media compression as its web twin — only the
// layout is rebuilt for a phone: a shared safe-area header shell (status-bar
// breathing room, single concise title, big tap targets), full-width single
// column, sticky footer/CTA where it helps. No width media queries / useResponsive.

import { useState, useRef, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import { useUser } from '../../../context/UserContext';
import { useUI } from '../../../context/UIContext';
import { useAuth } from '../../../context/AuthContext';
import { auth } from '../../../firebase/config';
import { createPost, uploadPostMedia, createPoll, createQuotePost, getPostWithAuthor } from '../../../firebase/firestore';
import { getTierConfig, checkFileSizeAccess, resolveTier } from '../../../utils/tierSystem';
import { compressVideo, SHORTS_LIMITS, getMediaDimensions } from '../../../utils/mediaCompression';
import { compressForTier, formatMB } from '../../../utils/videoCompress';
import EmbedVideoPlayer, { parseVideoUrl, getThumbnailUrl } from '../../../components/EmbedVideoPlayer';
import { timeAgo } from '../../../utils/helpers';
import UserAvatar from '../../../components/UserAvatar';
import Icon from '../../../components/Icon';
import InlineVideoPlayer from '../../../components/media/InlineVideoPlayer';
import UserName from '../../../components/UserName';

// ───────────────────────────── shared native scaffold
function Spinner() {
  return <span className="w-4 h-4 border-2 border-bg-dark/30 border-t-bg-dark rounded-full animate-spin inline-block align-middle" />;
}
function PostBtn({ onClick, disabled, children }) {
  return (
    <button onClick={onClick} disabled={disabled} className="bg-brand-violet text-white px-6 py-2.5 rounded-full font-bold text-sm disabled:opacity-30 active:scale-[0.97] transition-all shrink-0">
      {children}
    </button>
  );
}
// Sticky safe-area header (founder top-bar rule: status-bar breathing room +
// single concise title line, no breadcrumb/ellipsis). `progress` renders a thin
// bar under the header (uploads/compression). `footer` pins a bottom bar.
function NativeCreateShell({ title, subtitle, action, onBack, backIcon = 'arrow_back', progress, footer, children }) {
  return (
    <div className="min-h-screen flex flex-col bg-bg-dark">
      <header className="sticky top-0 z-40 bg-bg-dark/90 backdrop-blur-xl border-b border-white/[0.04]" style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 8px)' }}>
        <div className="flex items-center justify-between gap-3 px-4 pb-3">
          <div className="flex items-center gap-3 min-w-0">
            <button onClick={onBack} aria-label="Back" className="w-10 h-10 rounded-xl bg-surface-2 border border-white/[0.06] flex items-center justify-center text-text-secondary shrink-0">
              <Icon name={backIcon} size={20} />
            </button>
            <div className="min-w-0">
              <h1 className="font-syne font-bold text-base text-white leading-tight">{title}</h1>
              {subtitle && <p className="text-text-muted text-[10px] font-dmmono">{subtitle}</p>}
            </div>
          </div>
          {action}
        </div>
        {progress != null && (
          <div className="h-1 bg-surface-3">
            <div className="h-full bg-brand-violet transition-all duration-300" style={{ width: `${progress}%` }} />
          </div>
        )}
      </header>
      <div className="flex-1 overflow-y-auto px-4 py-5" style={footer ? undefined : { paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 28px)' }}>
        {children}
      </div>
      {footer && (
        <footer className="sticky bottom-0 bg-bg-dark/90 backdrop-blur-xl border-t border-white/[0.04] px-4 py-3" style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 10px)' }}>
          {footer}
        </footer>
      )}
    </div>
  );
}
const LABEL = 'text-text-secondary text-[10px] uppercase tracking-widest font-bold mb-2.5 block';
const INPUT = 'w-full bg-surface-2 border border-white/[0.06] rounded-xl p-3.5 text-text-primary text-[15px] placeholder:text-text-muted focus:border-brand-violet focus:outline-none';

// ═══════════════════════════════════════ SELECTOR

const POST_TYPES = [
  { id: 'text', title: 'Text', desc: 'Quick thoughts', icon: 'edit_note', route: '/create/text', color: '#B44FFF' },
  { id: 'photo', title: 'Photo', desc: 'Screenshots & carousel', icon: 'photo_library', route: '/create/photo', color: '#B44FFF' },
  { id: 'clip', title: 'Clip', desc: 'Longer video', icon: 'play_circle', route: '/create/clip', color: '#F04060' },
  { id: 'article', title: 'Article', desc: 'Guides & deep dives', icon: 'article', route: '/create/article', color: '#C87FFF' },
  { id: 'lfg', title: 'LFG', desc: 'Find players', icon: 'group_add', route: '/create/lfg', color: '#F0A500' },
  { id: 'tierlist', title: 'Tier List', desc: 'Rank & compare', icon: 'format_list_numbered', route: '/create/tierlist', color: '#B44FFF' },
  { id: 'achievement', title: 'Achievement', desc: 'Showcase wins', icon: 'emoji_events', route: '/create/achievement', color: '#F0A500' },
  { id: 'poll', title: 'Poll', desc: 'Ask the community', icon: 'bar_chart', route: '/create-poll', color: '#C87FFF' },
];

export function NativeCreatePostSelectorScreen() {
  const navigate = useNavigate();
  return (
    <NativeCreateShell title="Create" subtitle="What are you sharing?" onBack={() => navigate(-1)}>
      <motion.button
        onClick={() => navigate('/create/short')}
        initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }} whileTap={{ scale: 0.98 }}
        className="w-full relative overflow-hidden rounded-2xl border border-brand-violet/20 bg-gradient-to-r from-brand-violet/[0.08] via-brand-violet/[0.06] to-brand-violet/[0.04] p-5 text-left mb-4"
      >
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-brand-violet/20 to-brand-violet/20 border border-white/[0.08] flex items-center justify-center shrink-0">
            <Icon name="slow_motion_video" size={28} className="text-brand-violet-light" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-0.5">
              <h3 className="font-syne font-bold text-white text-base">Create a Short</h3>
              <span className="px-1.5 py-0.5 rounded-md bg-brand-violet/15 text-brand-violet-light text-[9px] font-black uppercase tracking-wider">New</span>
            </div>
            <p className="text-text-muted text-xs">Record or upload a vertical video · auto-compressed</p>
          </div>
          <Icon name="arrow_forward" size={20} className="text-text-muted shrink-0" />
        </div>
      </motion.button>

      <div className="grid grid-cols-2 gap-2.5">
        {POST_TYPES.map((type, i) => (
          <motion.button
            key={type.id} onClick={() => navigate(type.route)}
            initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 + i * 0.04, duration: 0.25 }} whileTap={{ scale: 0.96 }}
            className="group relative overflow-hidden rounded-2xl border border-white/[0.06] bg-surface-1/60 p-4 text-left active:bg-surface-2/60 transition-colors"
          >
            <div className="w-11 h-11 rounded-xl flex items-center justify-center mb-3" style={{ background: `${type.color}1f`, color: type.color }}>
              <Icon name={type.icon} size={22} />
            </div>
            <h3 className="font-semibold text-text-primary text-sm tracking-tight mb-0.5">{type.title}</h3>
            <p className="text-text-muted text-[11px] leading-relaxed">{type.desc}</p>
          </motion.button>
        ))}
      </div>
    </NativeCreateShell>
  );
}

// ═══════════════════════════════════════ TEXT

export function NativeCreateTextPostScreen() {
  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(false);
  const [tags, setTags] = useState([]);
  const textRef = useRef(null);
  const { profile } = useUser();
  const { showToast } = useUI();
  const navigate = useNavigate();
  const MAX = 2000;

  useEffect(() => { textRef.current?.focus(); }, []);
  useEffect(() => { setTags([...new Set((content.match(/#\w+/g) || []).map(t => t.slice(1).toLowerCase()))]); }, [content]);

  const handlePost = async () => {
    if (!content.trim() || loading) return;
    setLoading(true);
    try {
      await createPost(auth.currentUser.uid, { content: content.trim(), type: 'text', hashtags: tags });
      showToast('Posted!', 'success'); navigate(-1);
    } catch (err) { console.error(err); showToast('Failed to publish', 'error'); }
    setLoading(false);
  };
  const remaining = MAX - content.length;

  return (
    <NativeCreateShell
      title="New Post" backIcon="close" onBack={() => navigate(-1)}
      action={<PostBtn onClick={handlePost} disabled={loading || !content.trim() || remaining < 0}>{loading ? <Spinner /> : 'Post'}</PostBtn>}
      footer={
        <div className="flex items-center gap-1">
          <FooterIcon icon="image" onClick={() => navigate('/create/photo')} />
          <FooterIcon icon="slow_motion_video" onClick={() => navigate('/create/short')} />
          <FooterIcon icon="videocam" onClick={() => navigate('/create/clip')} />
          <FooterIcon icon="bar_chart" onClick={() => navigate('/create-poll')} />
          <div className="flex-1" />
          <span className={`text-[11px] font-dmmono ${remaining < 0 ? 'text-brand-ember' : remaining < 100 ? 'text-brand-gold' : 'text-text-muted/50'}`}>{content.length} / {MAX}</span>
        </div>
      }
    >
      <div className="flex gap-3.5">
        <UserAvatar src={profile?.avatar || profile?.photoURL} size={44} />
        <div className="flex-1 min-w-0">
          <p className="text-brand-violet-light text-xs font-dmmono mb-2"><UserName user={profile} masked handle fallback={'you'} /></p>
          <textarea ref={textRef} value={content} onChange={e => setContent(e.target.value)} placeholder="What's on your mind?"
            className="w-full bg-transparent text-text-primary text-[17px] leading-relaxed placeholder:text-text-muted/40 outline-none resize-none min-h-[220px]" maxLength={MAX + 50} />
          {tags.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-3 pt-3 border-t border-white/[0.04]">
              {tags.map(tag => <span key={tag} className="px-2.5 py-1 rounded-lg bg-brand-violet/8 border border-brand-violet/15 text-brand-violet-light text-[11px] font-semibold">#{tag}</span>)}
            </div>
          )}
        </div>
      </div>
    </NativeCreateShell>
  );
}
function FooterIcon({ icon, onClick }) {
  return <button onClick={onClick} className="w-11 h-11 rounded-xl flex items-center justify-center text-text-muted active:bg-white/5 transition-all"><Icon name={icon} size={22} /></button>;
}

// ═══════════════════════════════════════ PHOTO

const MAX_PHOTOS = 10;
export function NativeCreatePhotoPostScreen() {
  const [content, setContent] = useState('');
  const [mediaFiles, setMediaFiles] = useState([]);
  const [loading, setLoading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const fileInputRef = useRef(null);
  const { profile } = useUser();
  const { showToast } = useUI();
  const navigate = useNavigate();
  const userTier = resolveTier(profile);
  const tierConfig = getTierConfig(userTier);

  const handleFileSelect = (e) => {
    const files = Array.from(e.target.files);
    const remaining = MAX_PHOTOS - mediaFiles.length;
    if (remaining <= 0) { showToast(`Maximum ${MAX_PHOTOS} photos`, 'error'); return; }
    const newMedia = [];
    for (const file of files.slice(0, remaining)) {
      const sizeCheck = checkFileSizeAccess(userTier, file.size);
      if (!sizeCheck.allowed) { showToast(sizeCheck.message, 'error'); continue; }
      newMedia.push({ file, preview: URL.createObjectURL(file), id: Math.random().toString(36).slice(2, 10) });
    }
    setMediaFiles(prev => [...prev, ...newMedia]);
    e.target.value = '';
  };
  const removePhoto = (id) => setMediaFiles(prev => { const item = prev.find(m => m.id === id); if (item) URL.revokeObjectURL(item.preview); return prev.filter(m => m.id !== id); });

  const handlePost = async () => {
    if (mediaFiles.length === 0 || loading) return;
    setLoading(true); setUploadProgress(0);
    try {
      const postId = await createPost(auth.currentUser.uid, { content: content.trim(), type: mediaFiles.length > 1 ? 'carousel' : 'photo', hashtags: (content.match(/#\w+/g) || []).map(t => t.slice(1).toLowerCase()) });
      for (let i = 0; i < mediaFiles.length; i++) { await uploadPostMedia(postId, mediaFiles[i].file); setUploadProgress(Math.round(((i + 1) / mediaFiles.length) * 100)); }
      showToast('Posted!', 'success'); navigate(-1);
    } catch (err) { console.error(err); showToast('Failed to publish', 'error'); }
    setLoading(false); mediaFiles.forEach(m => URL.revokeObjectURL(m.preview));
  };

  return (
    <NativeCreateShell
      title="Photo Post" subtitle={`${mediaFiles.length}/${MAX_PHOTOS} photos`} onBack={() => navigate(-1)}
      progress={loading ? uploadProgress : null}
      action={<PostBtn onClick={handlePost} disabled={loading || mediaFiles.length === 0}>{loading ? <span className="flex items-center gap-2"><Spinner />{uploadProgress}%</span> : 'Post'}</PostBtn>}
    >
      <div className="flex gap-3 mb-4">
        <UserAvatar src={profile?.avatar || profile?.photoURL} size={40} />
        <textarea value={content} onChange={e => setContent(e.target.value)} placeholder="Write a caption..." className="flex-1 bg-transparent text-text-primary text-sm leading-relaxed placeholder:text-text-muted/40 outline-none resize-none min-h-[64px]" maxLength={2000} />
      </div>
      {mediaFiles.length > 0 ? (
        <div className="grid grid-cols-2 gap-2">
          {mediaFiles.map((media, idx) => (
            <div key={media.id} className="relative rounded-2xl overflow-hidden border border-white/[0.06] bg-surface-1 aspect-square">
              <img src={media.preview} alt="" className="w-full h-full object-cover" />
              <button onClick={() => removePhoto(media.id)} className="absolute top-2 right-2 w-8 h-8 rounded-lg bg-black/60 backdrop-blur-sm flex items-center justify-center text-white"><Icon name="close" size={16} /></button>
              <span className="absolute bottom-2 left-2 px-2 py-0.5 rounded-md bg-black/60 text-white text-[10px] font-dmmono font-bold">{idx + 1}/{mediaFiles.length}</span>
            </div>
          ))}
          {mediaFiles.length < MAX_PHOTOS && (
            <button onClick={() => fileInputRef.current?.click()} className="aspect-square rounded-2xl border-2 border-dashed border-white/[0.08] flex flex-col items-center justify-center gap-2 active:bg-white/5">
              <Icon name="add" size={24} className="text-text-muted" /><span className="text-text-muted text-[11px] font-dmmono">Add</span>
            </button>
          )}
        </div>
      ) : (
        <button onClick={() => fileInputRef.current?.click()} className="w-full aspect-video rounded-2xl border-2 border-dashed border-white/[0.08] flex flex-col items-center justify-center gap-4 active:bg-white/5">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-brand-violet/15 to-brand-pink/15 border border-white/[0.08] flex items-center justify-center"><Icon name="add_photo_alternate" size={32} className="text-brand-violet" /></div>
          <div className="text-center"><p className="text-text-primary font-syne font-bold text-sm">Add Photos</p><p className="text-text-muted text-xs mt-1">Up to {MAX_PHOTOS} · {tierConfig.maxFileUploadMB}MB each</p></div>
        </button>
      )}
      <input type="file" ref={fileInputRef} onChange={handleFileSelect} className="hidden" accept="image/*" multiple />
    </NativeCreateShell>
  );
}

// ═══════════════════════════════════════ CLIP

export function NativeCreateClipPostScreen() {
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
  const userTier = resolveTier(profile);
  const tierConfig = getTierConfig(userTier);
  const nextTier = userTier === 'free' ? 'lite' : userTier === 'lite' ? 'pro' : null;
  const fmt = (s) => `${Math.floor(s / 60)}:${Math.floor(s % 60).toString().padStart(2, '0')}`;

  const handleFileSelect = (e) => {
    const file = e.target.files?.[0]; if (!file) return;
    const sizeCheck = checkFileSizeAccess(userTier, file.size);
    if (!sizeCheck.allowed) { showToast(sizeCheck.message, 'error'); return; }
    const url = URL.createObjectURL(file);
    const v = document.createElement('video'); v.preload = 'metadata';
    v.onloadedmetadata = () => {
      // No length limit — the size cap checked above is the only ceiling.
      setVideoDuration(v.duration); setVideoFile({ file, preview: url });
    };
    v.src = url; e.target.value = '';
  };
  const handleEmbedUrlChange = (url) => { setEmbedUrl(url); setParsedEmbed(parseVideoUrl(url)); };

  const handlePost = async () => {
    if (mode === 'embed') {
      if (!parsedEmbed || loading) return;
      setLoading(true);
      try {
        await createPost(auth.currentUser.uid, { content: content.trim(), type: 'video', hashtags: (content.match(/#\w+/g) || []).map(t => t.slice(1).toLowerCase()), embedVideoUrl: embedUrl.trim(), youtubeVideoId: parsedEmbed.platform === 'youtube' ? parsedEmbed.videoId : null, thumbnailUrl: getThumbnailUrl(parsedEmbed) });
        showToast('Video posted!', 'success'); navigate(-1);
      } catch (err) { console.error(err); showToast('Failed to create post', 'error'); }
      setLoading(false); return;
    }
    if (!videoFile || loading) return;
    setLoading(true); setUploadProgress(0); setCompressProgress(0);
    try {
      setCompressing(true);
      const compressed = await compressForTier(videoFile.file, userTier, (p) => setCompressProgress(Math.round(p * 100)));
      setCompressing(false);
      const finalFile = new File([compressed], (videoFile.file.name || 'clip').replace(/\.\w+$/, '.mp4'), { type: 'video/mp4' });
      const postId = await createPost(auth.currentUser.uid, { content: content.trim(), type: videoDuration <= 60 ? 'clip' : 'video', hashtags: (content.match(/#\w+/g) || []).map(t => t.slice(1).toLowerCase()) });
      const iv = setInterval(() => setUploadProgress(p => Math.min(p + 3, 90)), 200);
      await uploadPostMedia(postId, finalFile); clearInterval(iv); setUploadProgress(100);
      showToast(`Clip posted! (${formatMB(videoFile.file.size)} → ${formatMB(finalFile.size)})`, 'success'); navigate(-1);
    } catch (err) { console.error(err); showToast('Failed to upload', 'error'); }
    setCompressing(false); setLoading(false); if (videoFile) URL.revokeObjectURL(videoFile.preview);
  };
  const canPost = mode === 'embed' ? !!parsedEmbed : !!videoFile;

  return (
    <NativeCreateShell
      title="Video Clip" subtitle={mode === 'embed' ? 'Paste a video URL' : `Any length · up to ${tierConfig.maxFileUploadMB}MB`} onBack={() => navigate(-1)}
      progress={loading && mode === 'upload' ? (compressing ? compressProgress : uploadProgress) : null}
      action={<PostBtn onClick={handlePost} disabled={loading || !canPost}>{loading ? <span className="flex items-center gap-2"><Spinner />{mode === 'upload' ? (compressing ? `${compressProgress}%` : `${uploadProgress}%`) : '...'}</span> : 'Post'}</PostBtn>}
    >
      <div className="flex gap-3 mb-4">
        <UserAvatar src={profile?.avatar} size={40} />
        <textarea value={content} onChange={e => setContent(e.target.value)} placeholder="Describe your clip..." className="flex-1 bg-transparent text-text-primary text-sm leading-relaxed placeholder:text-text-muted/40 outline-none resize-none min-h-[64px]" maxLength={500} />
      </div>
      <div className="flex rounded-xl overflow-hidden border border-white/[0.06] mb-4">
        <button onClick={() => setMode('upload')} className={`flex-1 py-3 text-xs font-bold flex items-center justify-center gap-1.5 border-r border-white/[0.06] ${mode === 'upload' ? 'bg-brand-ember/10 text-brand-ember' : 'bg-surface-1 text-text-muted'}`}><Icon name="cloud_upload" size={14} /> Upload</button>
        <button onClick={() => setMode('embed')} className={`flex-1 py-3 text-xs font-bold flex items-center justify-center gap-1.5 ${mode === 'embed' ? 'bg-brand-violet/10 text-brand-violet' : 'bg-surface-1 text-text-muted'}`}><Icon name="link" size={14} /> Paste URL</button>
      </div>
      {mode === 'upload' ? (
        videoFile ? (
          <div className="relative rounded-2xl overflow-hidden border border-white/[0.06] bg-black">
            <InlineVideoPlayer src={videoFile.preview} maxHeightClass="max-h-[440px]" rounded={false} objectFit="contain" />
            <span className="absolute top-3 left-3 px-2.5 py-1 rounded-lg bg-black/70 text-white text-xs font-dmmono font-bold">{fmt(videoDuration)}</span>
            <button onClick={() => { URL.revokeObjectURL(videoFile.preview); setVideoFile(null); setVideoDuration(0); }} className="absolute top-3 right-3 w-9 h-9 rounded-lg bg-black/60 flex items-center justify-center text-white"><Icon name="close" size={16} /></button>
          </div>
        ) : (
          <button onClick={() => fileInputRef.current?.click()} className="w-full aspect-[9/16] max-h-[460px] rounded-2xl border-2 border-dashed border-white/[0.08] flex flex-col items-center justify-center gap-4 active:bg-white/5">
            <div className="w-20 h-20 rounded-3xl bg-gradient-to-br from-brand-ember/15 to-brand-gold/15 border border-white/[0.08] flex items-center justify-center"><Icon name="videocam" size={36} className="text-brand-ember" /></div>
            <div className="text-center"><p className="text-text-primary font-syne font-bold">Upload a Clip</p><p className="text-text-muted text-xs mt-1">Any length · up to {tierConfig.maxFileUploadMB}MB</p></div>
          </button>
        )
      ) : (
        <div className="flex flex-col gap-4">
          <input type="url" value={embedUrl} onChange={e => handleEmbedUrlChange(e.target.value)} placeholder="Paste YouTube or Twitch URL..." className={INPUT} />
          {parsedEmbed ? (
            <div className="relative rounded-2xl overflow-hidden border border-white/[0.06] bg-black">
              <EmbedVideoPlayer videoId={parsedEmbed.videoId} platform={parsedEmbed.platform} autoplayOnView={false} />
              <button onClick={() => { setEmbedUrl(''); setParsedEmbed(null); }} className="absolute top-3 right-3 w-9 h-9 rounded-lg bg-black/60 flex items-center justify-center text-white z-10"><Icon name="close" size={16} /></button>
            </div>
          ) : (
            <div className="w-full aspect-video rounded-2xl border-2 border-dashed border-white/[0.08] flex flex-col items-center justify-center gap-3">
              <Icon name="link" size={32} className="text-brand-violet" /><p className="text-text-muted text-xs">YouTube or Twitch · no storage needed</p>
            </div>
          )}
        </div>
      )}
      <input type="file" ref={fileInputRef} onChange={handleFileSelect} className="hidden" accept="video/*" />
    </NativeCreateShell>
  );
}

// ═══════════════════════════════════════ SHORT

export function NativeCreateShortScreen() {
  const [content, setContent] = useState('');
  const [videoFile, setVideoFile] = useState(null);
  const [compressedFile, setCompressedFile] = useState(null);
  const [compressing, setCompressing] = useState(false);
  const [compressProgress, setCompressProgress] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const fileInputRef = useRef(null);
  const { profile } = useUser();
  const { showToast } = useUI();
  const navigate = useNavigate();
  const userTier = resolveTier(profile);
  const limits = SHORTS_LIMITS[userTier] || SHORTS_LIMITS.free;
  const fmt = (s) => `${Math.floor(s / 60)}:${Math.floor(s % 60).toString().padStart(2, '0')}`;

  const handleFileSelect = async (e) => {
    const file = e.target.files?.[0]; if (!file) return; e.target.value = '';
    const dims = await getMediaDimensions(file);
    const preview = URL.createObjectURL(file);
    setVideoFile({ file, preview, duration: dims.duration, width: dims.width, height: dims.height });
    setCompressedFile(null); setCompressing(true); setCompressProgress(0);
    try {
      const result = await compressVideo(file, userTier, (p) => setCompressProgress(p));
      setCompressedFile(result);
      if (result !== file) { const savings = ((1 - result.size / file.size) * 100).toFixed(0); showToast(`Compressed to ${(result.size / (1024 * 1024)).toFixed(1)}MB (${savings}% smaller)`, 'success'); }
    } catch (err) { showToast(err.message || 'Compression failed', 'error'); setCompressedFile(file); }
    setCompressing(false);
  };
  const handlePost = async () => {
    const uploadFile = compressedFile || videoFile?.file;
    if (!uploadFile || uploading) return;
    setUploading(true); setUploadProgress(0);
    try {
      const postId = await createPost(auth.currentUser.uid, { content: content.trim(), type: 'short', hashtags: (content.match(/#\w+/g) || []).map(t => t.slice(1).toLowerCase()) });
      const iv = setInterval(() => setUploadProgress(p => Math.min(p + 3, 90)), 200);
      await uploadPostMedia(postId, uploadFile); clearInterval(iv); setUploadProgress(100);
      showToast('Short posted!', 'success'); navigate('/shorts');
    } catch (err) { console.error(err); showToast('Failed to upload', 'error'); }
    setUploading(false); if (videoFile) URL.revokeObjectURL(videoFile.preview);
  };
  const clearVideo = () => { if (videoFile) URL.revokeObjectURL(videoFile.preview); setVideoFile(null); setCompressedFile(null); setCompressing(false); setCompressProgress(0); };
  const canPost = !!compressedFile && !compressing && !uploading;
  const isWorking = compressing || uploading;

  return (
    <NativeCreateShell
      title="Create Short" subtitle={`${limits.maxShortSide}p · any length`} onBack={() => navigate(-1)}
      progress={compressing ? compressProgress * 100 : uploading ? uploadProgress : null}
      action={<PostBtn onClick={handlePost} disabled={!canPost}>{uploading ? <span className="flex items-center gap-2"><Spinner />{uploadProgress}%</span> : 'Post'}</PostBtn>}
    >
      <div className="flex gap-3 mb-4">
        <UserAvatar src={profile?.avatar} size={40} />
        <textarea value={content} onChange={e => setContent(e.target.value)} placeholder="Describe your short..." className="flex-1 bg-transparent text-text-primary text-sm leading-relaxed placeholder:text-text-muted/50 outline-none resize-none min-h-[64px]" maxLength={300} />
      </div>
      {compressing && <div className="p-4 rounded-2xl bg-brand-violet/5 border border-brand-violet/20 mb-4 flex items-center gap-3"><span className="w-4 h-4 border-2 border-brand-violet/30 border-t-brand-violet rounded-full animate-spin" /><p className="text-brand-violet text-xs font-bold">Compressing to {limits.maxShortSide}p… {Math.round(compressProgress * 100)}%</p></div>}
      <div className="flex items-start justify-center">
        {videoFile ? (
          <div className="relative w-full max-w-sm rounded-2xl overflow-hidden border border-white/[0.06] bg-black aspect-[9/16]">
            <InlineVideoPlayer src={videoFile.preview} maxHeightClass="h-full" rounded={false} objectFit="contain" />
            <span className="absolute top-3 left-3 px-2.5 py-1 rounded-lg bg-black/70 text-white text-xs font-dmmono font-bold">{fmt(videoFile.duration)}</span>
            {!isWorking && <button onClick={clearVideo} className="absolute top-3 right-3 w-9 h-9 rounded-lg bg-black/60 flex items-center justify-center text-white"><Icon name="close" size={16} /></button>}
          </div>
        ) : (
          <button onClick={() => fileInputRef.current?.click()} className="w-full max-w-sm aspect-[9/16] rounded-2xl border-2 border-dashed border-white/[0.08] flex flex-col items-center justify-center gap-5 active:bg-white/5">
            <div className="w-20 h-20 rounded-3xl bg-gradient-to-br from-brand-violet/15 to-brand-violet/15 border border-white/[0.08] flex items-center justify-center"><Icon name="slow_motion_video" size={38} className="text-brand-violet-light" /></div>
            <div className="text-center px-6"><p className="text-text-primary font-syne font-bold text-lg">Upload a Short</p><p className="text-text-muted text-xs mt-2">Any length · auto-compressed to {limits.maxShortSide}p</p></div>
          </button>
        )}
      </div>
      <input type="file" ref={fileInputRef} onChange={handleFileSelect} className="hidden" accept="video/*" />
    </NativeCreateShell>
  );
}

// ═══════════════════════════════════════ ARTICLE

export function NativeCreateArticleScreen() {
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [coverImage, setCoverImage] = useState(null);
  const [loading, setLoading] = useState(false);
  const fileInputRef = useRef(null);
  const { profile } = useUser();
  const { showToast } = useUI();
  const navigate = useNavigate();
  const canPost = title.trim().length >= 5 && body.trim().length >= 50;
  const readTime = Math.max(1, Math.ceil(body.split(/\s+/).length / 200));

  const handlePost = async () => {
    if (!canPost || loading) return;
    setLoading(true);
    try {
      const postId = await createPost(auth.currentUser.uid, { content: title.trim(), type: 'article', articleData: { title: title.trim(), body: body.trim(), readTime, wordCount: body.split(/\s+/).length }, hashtags: (body.match(/#\w+/g) || []).map(t => t.slice(1).toLowerCase()) });
      if (coverImage) await uploadPostMedia(postId, coverImage.file);
      showToast('Article published!', 'success'); navigate(-1);
    } catch (err) { console.error(err); showToast('Failed to publish', 'error'); }
    setLoading(false); if (coverImage) URL.revokeObjectURL(coverImage.preview);
  };

  return (
    <NativeCreateShell
      title="Write Article" subtitle={`${body.split(/\s+/).filter(Boolean).length} words · ${readTime} min read`} onBack={() => navigate(-1)}
      action={<PostBtn onClick={handlePost} disabled={loading || !canPost}>{loading ? <Spinner /> : 'Publish'}</PostBtn>}
    >
      {coverImage ? (
        <div className="relative rounded-2xl overflow-hidden mb-6 border border-white/[0.06]"><img src={coverImage.preview} alt="" className="w-full aspect-[21/9] object-cover" /><button onClick={() => { URL.revokeObjectURL(coverImage.preview); setCoverImage(null); }} className="absolute top-3 right-3 w-9 h-9 rounded-lg bg-black/60 flex items-center justify-center text-white"><Icon name="close" size={16} /></button></div>
      ) : (
        <button onClick={() => fileInputRef.current?.click()} className="w-full aspect-[21/9] rounded-2xl border-2 border-dashed border-white/[0.06] flex items-center justify-center gap-3 mb-6 active:bg-white/5"><Icon name="add_photo_alternate" size={24} className="text-text-muted" /><span className="text-text-muted text-sm">Add cover image</span></button>
      )}
      <p className="text-brand-pink text-[10px] font-dmmono uppercase tracking-widest mb-3">Article by <UserName user={profile} masked handle fallback={'you'} /></p>
      <input type="text" value={title} onChange={e => setTitle(e.target.value)} placeholder="Article title" className="w-full bg-transparent text-white text-2xl font-syne font-extrabold placeholder:text-text-muted/30 outline-none mb-4 leading-tight" maxLength={200} />
      <textarea value={body} onChange={e => setBody(e.target.value)} placeholder="Start writing... (minimum 50 characters)" className="w-full bg-transparent text-text-primary text-[15px] leading-[1.8] placeholder:text-text-muted/30 outline-none resize-none min-h-[360px]" />
      {!canPost && title.trim().length > 0 && <div className="mt-4 px-3 py-2 rounded-xl bg-brand-gold/10 border border-brand-gold/20 text-brand-gold text-xs">{title.trim().length < 5 ? 'Title needs at least 5 characters' : `${Math.max(0, 50 - body.trim().length)} more characters needed`}</div>}
      <input type="file" ref={fileInputRef} onChange={(e) => { const f = e.target.files?.[0]; if (f) setCoverImage({ file: f, preview: URL.createObjectURL(f) }); e.target.value = ''; }} className="hidden" accept="image/*" />
    </NativeCreateShell>
  );
}

// ═══════════════════════════════════════ ACHIEVEMENT

const ACH_TYPES = [
  { id: 'win', label: 'Victory / Win', icon: 'emoji_events', color: '#F5C542' },
  { id: 'rank', label: 'Rank Up', icon: 'military_tech', color: '#B44FFF' },
  { id: 'milestone', label: 'Milestone', icon: 'flag', color: '#7B6FFF' },
  { id: 'record', label: 'Personal Record', icon: 'speed', color: '#FF4D6A' },
  { id: 'unlock', label: 'Unlock / Trophy', icon: 'lock_open', color: '#C87FFF' },
  { id: 'other', label: 'Other', icon: 'star', color: '#F5C542' },
];
export function NativeCreateAchievementScreen() {
  const [achievementType, setAchievementType] = useState('');
  const [game, setGame] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [screenshot, setScreenshot] = useState(null);
  const [loading, setLoading] = useState(false);
  const fileInputRef = useRef(null);
  const { showToast } = useUI();
  const navigate = useNavigate();
  const canPost = achievementType && title.trim();

  const handlePost = async () => {
    if (!canPost || loading) return;
    setLoading(true);
    try {
      const postId = await createPost(auth.currentUser.uid, { content: `${title.trim()}${game ? ` in ${game}` : ''}`, type: 'achievement', achievementData: { achievementType, game: game.trim() || null, title: title.trim(), description: description.trim() || null }, hashtags: ['achievement', ...(game ? [game.toLowerCase().replace(/\s+/g, '')] : [])] });
      if (screenshot) await uploadPostMedia(postId, screenshot.file);
      showToast('Achievement shared!', 'success'); navigate(-1);
    } catch (err) { console.error(err); showToast('Failed to post', 'error'); }
    setLoading(false); if (screenshot) URL.revokeObjectURL(screenshot.preview);
  };

  return (
    <NativeCreateShell title="Achievement" onBack={() => navigate(-1)} action={<PostBtn onClick={handlePost} disabled={loading || !canPost}>{loading ? <Spinner /> : 'Share'}</PostBtn>}>
      <div className="space-y-6">
        <div>
          <label className={LABEL}>What did you achieve? *</label>
          <div className="grid grid-cols-3 gap-2">
            {ACH_TYPES.map(type => {
              const sel = achievementType === type.id;
              return (
                <button key={type.id} onClick={() => setAchievementType(type.id)} className="flex flex-col items-center gap-1.5 p-3 rounded-xl text-xs font-bold transition-all border"
                  style={sel ? { background: `${type.color}15`, borderColor: `${type.color}60`, color: type.color } : { background: 'var(--surface-2, #1A1A2A)', borderColor: 'rgba(255,255,255,0.06)', color: '#6B7280' }}>
                  <Icon name={type.icon} size={22} /><span className="text-[10px] text-center leading-tight">{type.label}</span>
                </button>
              );
            })}
          </div>
        </div>
        <div><label className={LABEL}>Game (optional)</label><input type="text" value={game} onChange={e => setGame(e.target.value)} placeholder="Which game?" className={INPUT} /></div>
        <div><label className={LABEL}>Achievement title *</label><input type="text" value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. Hit Diamond for the first time" className={INPUT} maxLength={100} /></div>
        <div><label className={LABEL}>Tell the story (optional)</label><textarea value={description} onChange={e => setDescription(e.target.value)} placeholder="How did it happen?" className={`${INPUT} resize-none min-h-[100px]`} maxLength={500} /></div>
        <div>
          <label className={LABEL}>Proof (optional)</label>
          {screenshot ? (
            <div className="relative rounded-2xl overflow-hidden border border-white/[0.06]"><img src={screenshot.preview} alt="" className="w-full max-h-[300px] object-cover" /><button onClick={() => { URL.revokeObjectURL(screenshot.preview); setScreenshot(null); }} className="absolute top-2 right-2 w-9 h-9 rounded-lg bg-black/60 flex items-center justify-center text-white"><Icon name="close" size={16} /></button></div>
          ) : (
            <button onClick={() => fileInputRef.current?.click()} className="w-full py-8 rounded-xl border-2 border-dashed border-white/[0.06] flex flex-col items-center gap-2 active:bg-white/5"><Icon name="add_photo_alternate" size={28} className="text-text-muted" /><span className="text-text-muted text-xs">Add screenshot</span></button>
          )}
        </div>
      </div>
      <input type="file" ref={fileInputRef} onChange={(e) => { const f = e.target.files?.[0]; if (f) setScreenshot({ file: f, preview: URL.createObjectURL(f) }); e.target.value = ''; }} className="hidden" accept="image/*" />
    </NativeCreateShell>
  );
}

// ═══════════════════════════════════════ LFG

const PLATFORMS = ['PC', 'PlayStation', 'Xbox', 'Nintendo', 'Mobile', 'Any'];
const REGIONS = ['NA East', 'NA West', 'EU West', 'EU East', 'Asia', 'Oceania', 'South America', 'Any'];
const LFG_GAMES = ['Valorant', 'Fortnite', 'Apex Legends', 'League of Legends', 'CS2', 'Overwatch 2', 'Rocket League', 'Call of Duty', 'Minecraft', 'Other'];
export function NativeCreateLFGScreen() {
  const [game, setGame] = useState('');
  const [customGame, setCustomGame] = useState('');
  const [platform, setPlatform] = useState('');
  const [region, setRegion] = useState('');
  const [rank, setRank] = useState('');
  const [mic, setMic] = useState(null);
  const [playersNeeded, setPlayersNeeded] = useState('');
  const [note, setNote] = useState('');
  const [loading, setLoading] = useState(false);
  const { showToast } = useUI();
  const navigate = useNavigate();
  const finalGame = game === 'Other' ? customGame.trim() : game;
  const canPost = finalGame && platform && region;

  const handlePost = async () => {
    if (!canPost || loading) return;
    setLoading(true);
    try { await createPost(auth.currentUser.uid, { content: note.trim() || `LFG — ${finalGame} on ${platform}`, type: 'lfg', lfgData: { game: finalGame, platform, region, rank: rank.trim() || null, mic, playersNeeded: parseInt(playersNeeded) || null }, hashtags: ['lfg', finalGame.toLowerCase().replace(/\s+/g, '')] }); showToast('LFG posted!', 'success'); navigate(-1); }
    catch (err) { console.error(err); showToast('Failed to post', 'error'); }
    setLoading(false);
  };
  const Chip = ({ label, selected, onClick, color = '#B44FFF' }) => (
    <button onClick={onClick} className="px-3.5 py-2.5 rounded-xl text-xs font-bold transition-all border"
      style={selected ? { background: `${color}26`, borderColor: `${color}66`, color } : { background: 'var(--surface-2,#1A1A2A)', borderColor: 'rgba(255,255,255,0.06)', color: '#6B7280' }}>{label}</button>
  );

  return (
    <NativeCreateShell title="Looking for Group" onBack={() => navigate(-1)} action={<PostBtn onClick={handlePost} disabled={loading || !canPost}>{loading ? <Spinner /> : 'Post'}</PostBtn>}>
      <div className="space-y-6">
        <div><label className={LABEL}>Game *</label><div className="flex flex-wrap gap-2">{LFG_GAMES.map(g => <Chip key={g} label={g} selected={game === g} onClick={() => setGame(g)} />)}</div>{game === 'Other' && <input type="text" value={customGame} onChange={e => setCustomGame(e.target.value)} placeholder="Enter game name..." className={`${INPUT} mt-3`} />}</div>
        <div><label className={LABEL}>Platform *</label><div className="flex flex-wrap gap-2">{PLATFORMS.map(p => <Chip key={p} label={p} selected={platform === p} onClick={() => setPlatform(p)} color="#B44FFF" />)}</div></div>
        <div><label className={LABEL}>Region *</label><div className="flex flex-wrap gap-2">{REGIONS.map(r => <Chip key={r} label={r} selected={region === r} onClick={() => setRegion(r)} color="#F0A500" />)}</div></div>
        <div><label className={LABEL}>Rank (optional)</label><input type="text" value={rank} onChange={e => setRank(e.target.value)} placeholder="e.g. Diamond, Gold III..." className={INPUT} /></div>
        <div><label className={LABEL}>Players needed</label><input type="number" min="1" max="99" value={playersNeeded} onChange={e => setPlayersNeeded(e.target.value)} placeholder="e.g. 2" className={INPUT} /></div>
        <div><label className={LABEL}>Mic required?</label><div className="flex gap-2">{[{ val: true, label: 'Mic required', icon: 'mic' }, { val: false, label: 'No mic needed', icon: 'mic_off' }].map(opt => (<button key={String(opt.val)} onClick={() => setMic(opt.val)} className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-xl text-xs font-bold transition-all border ${mic === opt.val ? 'bg-brand-violet/15 border-brand-violet/40 text-brand-violet-light' : 'bg-surface-2 border-white/[0.06] text-text-muted'}`}><Icon name={opt.icon} size={16} />{opt.label}</button>))}</div></div>
        <div><label className={LABEL}>Note (optional)</label><textarea value={note} onChange={e => setNote(e.target.value)} placeholder="Any extra info..." className={`${INPUT} resize-none min-h-[80px]`} maxLength={300} /></div>
      </div>
    </NativeCreateShell>
  );
}

// ═══════════════════════════════════════ TIER LIST

const TL_TIERS = [
  { id: 's', label: 'S', color: '#FF4D6A' }, { id: 'a', label: 'A', color: '#F5C542' },
  { id: 'b', label: 'B', color: '#B44FFF' }, { id: 'c', label: 'C', color: '#7B6FFF' }, { id: 'd', label: 'D', color: '#3D4260' },
];
export function NativeCreateTierListScreen() {
  const [title, setTitle] = useState('');
  const [tiers, setTiers] = useState(TL_TIERS.map(t => ({ ...t, items: [] })));
  const [newItem, setNewItem] = useState('');
  const [unranked, setUnranked] = useState([]);
  const [loading, setLoading] = useState(false);
  const { showToast } = useUI();
  const navigate = useNavigate();

  const addItem = () => { const v = newItem.trim(); if (!v) return; setUnranked(prev => [...prev, { id: Math.random().toString(36).slice(2, 8), label: v }]); setNewItem(''); };
  const moveToTier = (item, tierId) => { setUnranked(p => p.filter(i => i.id !== item.id)); setTiers(p => p.map(t => ({ ...t, items: t.items.filter(i => i.id !== item.id) })).map(t => t.id === tierId ? { ...t, items: [...t.items, item] } : t)); };
  const moveToUnranked = (item) => { setTiers(p => p.map(t => ({ ...t, items: t.items.filter(i => i.id !== item.id) }))); setUnranked(p => [...p, item]); };
  const removeItem = (item) => { setUnranked(p => p.filter(i => i.id !== item.id)); setTiers(p => p.map(t => ({ ...t, items: t.items.filter(i => i.id !== item.id) }))); };
  const rankedItems = tiers.reduce((s, t) => s + t.items.length, 0);
  const canPost = title.trim() && rankedItems >= 3;

  const handlePost = async () => {
    if (!canPost || loading) return;
    setLoading(true);
    try { await createPost(auth.currentUser.uid, { content: title.trim(), type: 'tierlist', tierListData: { title: title.trim(), tiers: tiers.map(t => ({ label: t.label, color: t.color, items: t.items.map(i => i.label) })) }, hashtags: ['tierlist'] }); showToast('Tier list posted!', 'success'); navigate(-1); }
    catch (err) { console.error(err); showToast('Failed to post', 'error'); }
    setLoading(false);
  };
  const ItemChip = ({ item, onRemove, onMove, tierOptions }) => {
    const [open, setOpen] = useState(false);
    return (
      <div className="relative">
        <button onClick={() => setOpen(!open)} className="px-3 py-2 rounded-lg bg-surface-2 border border-white/[0.06] text-text-primary text-xs font-semibold">{item.label}</button>
        {open && (
          <div className="absolute top-full left-0 mt-1 z-50 bg-surface-1 border border-white/[0.06] rounded-xl shadow-xl overflow-hidden min-w-[130px]">
            {tierOptions?.map(t => (<button key={t.id} onClick={() => { onMove(item, t.id); setOpen(false); }} className="w-full px-3 py-2.5 text-left text-xs font-bold active:bg-surface-2 flex items-center gap-2"><span className="w-3 h-3 rounded-sm inline-block" style={{ background: t.color }} />{t.label} Tier</button>))}
            {onRemove && <button onClick={() => { onRemove(item); setOpen(false); }} className="w-full px-3 py-2.5 text-left text-xs text-brand-ember active:bg-brand-ember/10">Remove</button>}
          </div>
        )}
      </div>
    );
  };

  return (
    <NativeCreateShell title="Tier List" onBack={() => navigate(-1)} action={<PostBtn onClick={handlePost} disabled={loading || !canPost}>{loading ? <Spinner /> : 'Post'}</PostBtn>}>
      <input type="text" value={title} onChange={e => setTitle(e.target.value)} placeholder="What are you ranking?" className="w-full bg-transparent text-white text-xl font-syne font-bold placeholder:text-text-muted/30 outline-none mb-6" maxLength={100} />
      <div className="flex gap-2 mb-6">
        <input type="text" value={newItem} onChange={e => setNewItem(e.target.value)} onKeyDown={e => e.key === 'Enter' && addItem()} placeholder="Add an item to rank..." className="flex-1 bg-surface-2 border border-white/[0.06] rounded-xl px-4 py-3 text-text-primary text-sm placeholder:text-text-muted focus:border-brand-violet focus:outline-none" />
        <button onClick={addItem} disabled={!newItem.trim()} className="px-5 py-3 rounded-xl bg-brand-violet/15 border border-brand-violet/30 text-brand-violet font-bold text-sm disabled:opacity-30">Add</button>
      </div>
      {unranked.length > 0 && <div className="mb-6"><p className="text-text-muted text-[10px] uppercase tracking-widest font-bold mb-2">Unranked ({unranked.length})</p><div className="flex flex-wrap gap-2 p-3 rounded-xl bg-surface-1/50 border border-white/[0.04] min-h-[48px]">{unranked.map(item => <ItemChip key={item.id} item={item} onRemove={removeItem} onMove={moveToTier} tierOptions={tiers} />)}</div></div>}
      <div className="space-y-2">
        {tiers.map(tier => (
          <div key={tier.id} className="flex items-stretch gap-2 min-h-[56px]">
            <div className="w-14 shrink-0 rounded-xl flex items-center justify-center font-syne font-black text-lg text-white" style={{ background: `${tier.color}25`, borderLeft: `3px solid ${tier.color}` }}>{tier.label}</div>
            <div className="flex-1 flex flex-wrap gap-1.5 items-center p-2.5 rounded-xl bg-surface-1/30 border border-white/[0.04] min-h-[48px]">
              {tier.items.length === 0 ? <span className="text-text-muted/30 text-xs px-2">Tap items above to place here</span> : tier.items.map(item => (
                <button key={item.id} onClick={() => moveToUnranked(item)} className="px-3 py-2 rounded-lg text-xs font-semibold text-white" style={{ background: `${tier.color}30`, border: `1px solid ${tier.color}50` }}>{item.label}</button>
              ))}
            </div>
          </div>
        ))}
      </div>
      {!canPost && (unranked.length + rankedItems) > 0 && <p className="text-text-muted text-xs mt-4 text-center">Rank at least 3 items to post</p>}
    </NativeCreateShell>
  );
}

// ═══════════════════════════════════════ QUOTE

export function NativeQuotePostScreen() {
  const [searchParams] = useSearchParams();
  const originalPostId = searchParams.get('post');
  const [content, setContent] = useState('');
  const [originalPost, setOriginalPost] = useState(null);
  const [loading, setLoading] = useState(false);
  const [loadingPost, setLoadingPost] = useState(true);
  const { profile } = useUser();
  const { showToast } = useUI();
  const navigate = useNavigate();
  const MAX = 500;

  useEffect(() => {
    if (!originalPostId) { setLoadingPost(false); return; }
    getPostWithAuthor(originalPostId).then(setOriginalPost).catch(err => console.error('Failed to load post:', err)).finally(() => setLoadingPost(false));
  }, [originalPostId]);

  const handlePost = async () => {
    if (!content.trim() || loading || !originalPostId) return;
    setLoading(true);
    try {
      const hashtags = (content.match(/#\w+/g) || []).map(t => t.slice(1).toLowerCase());
      await createQuotePost(auth.currentUser.uid, originalPostId, { content: content.trim(), hashtags });
      showToast('Quote posted!', 'success'); navigate(-1);
    } catch (err) { console.error(err); showToast('Failed to post', 'error'); }
    setLoading(false);
  };
  const remaining = MAX - content.length;

  return (
    <NativeCreateShell title="Quote Post" backIcon="close" onBack={() => navigate(-1)} action={<PostBtn onClick={handlePost} disabled={loading || !content.trim() || remaining < 0}>{loading ? <Spinner /> : 'Post'}</PostBtn>}>
      <div className="flex gap-3.5 mb-4">
        <UserAvatar src={profile?.avatar || profile?.photoURL} size={44} />
        <div className="flex-1 min-w-0">
          <p className="text-brand-violet-light text-xs font-dmmono mb-2"><UserName user={profile} masked handle fallback={'you'} /></p>
          <textarea autoFocus value={content} onChange={e => setContent(e.target.value)} placeholder="Add your thoughts..." className="w-full bg-transparent text-text-primary text-[16px] leading-relaxed placeholder:text-text-muted/60 outline-none resize-none min-h-[100px]" maxLength={MAX + 20} />
        </div>
      </div>
      {loadingPost ? (
        <div className="rounded-2xl border border-white/[0.06] bg-surface-1/50 p-6 flex justify-center"><div className="w-5 h-5 border-2 border-surface-3 border-t-brand-violet rounded-full animate-spin" /></div>
      ) : originalPost ? (
        <div className="rounded-2xl border border-white/[0.06] bg-surface-1/30 p-4">
          <div className="flex items-center gap-2 mb-2 flex-wrap">
            <UserAvatar src={originalPost.author?.avatar} size={20} />
            <span className="text-text-primary text-xs font-semibold"><UserName user={originalPost.author} masked /></span>
            <span className="text-text-muted text-xs"><UserName user={originalPost.author} masked handle /></span>
            <span className="text-text-muted text-xs">· {timeAgo(originalPost.createdAt)}</span>
          </div>
          {originalPost.content && <p className="text-text-secondary text-sm leading-relaxed line-clamp-4">{originalPost.content}</p>}
          {originalPost.mediaUrls?.length > 0 && <div className="mt-2 rounded-xl overflow-hidden border border-white/[0.04] max-h-[160px]"><img src={originalPost.mediaUrls[0]} alt="" className="w-full h-full object-cover" /></div>}
        </div>
      ) : (
        <div className="rounded-2xl border border-white/[0.06] bg-surface-1/30 p-6 text-center"><p className="text-text-muted text-sm">Original post unavailable</p></div>
      )}
    </NativeCreateShell>
  );
}

// ═══════════════════════════════════════ POLL

export function NativeCreatePollScreen() {
  const navigate = useNavigate();
  const { showToast } = useUI();
  const { currentUser } = useAuth();
  const [question, setQuestion] = useState('');
  const [options, setOptions] = useState(['', '']);
  const [duration, setDuration] = useState('24h');
  const [loading, setLoading] = useState(false);

  const addOption = () => options.length < 6 && setOptions(prev => [...prev, '']);
  const updateOption = (index, value) => setOptions(prev => prev.map((o, i) => i === index ? value : o));
  const removeOption = (index) => setOptions(prev => prev.filter((_, i) => i !== index));

  const handlePost = async () => {
    if (!question.trim() || options.some(o => !o.trim())) { showToast('Please fill in the question and all options', 'error'); return; }
    setLoading(true);
    try {
      await createPoll(currentUser.uid, { question: question.trim(), options: options.filter(o => o.trim() !== ''), duration });
      showToast('Poll created successfully!', 'success'); navigate(-1);
    } catch (err) { console.error(err); showToast('Failed to create poll', 'error'); }
    finally { setLoading(false); }
  };
  const canPost = question.trim() && options.every(o => o.trim());

  return (
    <NativeCreateShell title="Create Poll" backIcon="close" onBack={() => navigate(-1)} action={<PostBtn onClick={handlePost} disabled={loading || !canPost}>{loading ? <Spinner /> : 'Post'}</PostBtn>}>
      <div className="space-y-6">
        <div>
          <label className={LABEL}>Question</label>
          <textarea value={question} onChange={e => setQuestion(e.target.value)} rows={2} placeholder="Ask a question..." className={`${INPUT} resize-none text-lg`} />
        </div>
        <div>
          <label className={LABEL}>Options</label>
          <div className="space-y-2">
            {options.map((opt, idx) => (
              <div key={idx} className="flex items-center gap-2">
                <div className="flex-1 bg-surface-2 border border-white/[0.06] rounded-xl px-4 py-3 flex items-center">
                  <span className="text-text-muted mr-2">{idx + 1}.</span>
                  <input value={opt} onChange={e => updateOption(idx, e.target.value)} placeholder={`Option ${idx + 1}`} className="flex-1 bg-transparent text-white outline-none text-sm" />
                </div>
                {options.length > 2 && <button onClick={() => removeOption(idx)} className="w-10 h-10 flex items-center justify-center text-text-muted"><Icon name="close" size={18} /></button>}
              </div>
            ))}
          </div>
          {options.length < 6 && <button onClick={addOption} className="flex items-center gap-2 text-brand-violet-light text-sm font-semibold mt-3"><Icon name="add" size={16} /> Add Option</button>}
        </div>
        <div>
          <label className={LABEL}>Poll Duration</label>
          <div className="flex gap-2 flex-wrap">
            {['6h', '12h', '24h', '48h'].map(d => (
              <button key={d} onClick={() => setDuration(d)} className={`px-4 py-2.5 rounded-xl border text-sm font-bold transition ${duration === d ? 'border-brand-violet bg-brand-violet/10 text-brand-violet-light' : 'border-white/[0.06] text-text-muted'}`}>{d}</button>
            ))}
          </div>
        </div>
      </div>
    </NativeCreateShell>
  );
}
