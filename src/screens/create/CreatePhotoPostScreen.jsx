import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { useUser } from '../../context/UserContext';
import { useUI } from '../../context/UIContext';
import { auth } from '../../firebase/config';
import { createPost, uploadPostMedia } from '../../firebase/firestore';
import { useLayout } from '../../context/LayoutContext';
import useResponsive from '../../hooks/useResponsive';
import { getTierConfig, checkFileSizeAccess, resolveTier } from '../../utils/tierSystem';
import UserAvatar from '../../components/UserAvatar';
import Icon from '../../components/Icon';

const MAX_PHOTOS = 10;

export default function CreatePhotoPostScreen() {
  const [content, setContent] = useState('');
  const [mediaFiles, setMediaFiles] = useState([]);
  const [loading, setLoading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const dragCounter = useRef(0);
  const fileInputRef = useRef(null);
  const { profile } = useUser();
  const { showToast } = useUI();
  const navigate = useNavigate();
  const { setRightPanel, setContentAlign } = useLayout();
  const { isDesktop } = useResponsive();
  const userTier = resolveTier(profile);
  const tierConfig = getTierConfig(userTier);

  useEffect(() => { setRightPanel(null); setContentAlign(isDesktop ? 'left' : 'center'); return () => { setRightPanel(null); setContentAlign('center'); }; }, [setRightPanel, setContentAlign, isDesktop]);

  const addFiles = useCallback((fileList) => {
    const files = Array.from(fileList).filter(f => f.type.startsWith('image/'));
    if (files.length === 0) return;
    setMediaFiles(prev => {
      const remaining = MAX_PHOTOS - prev.length;
      if (remaining <= 0) { showToast(`Maximum ${MAX_PHOTOS} photos`, 'error'); return prev; }
      const newMedia = [];
      for (const file of files.slice(0, remaining)) {
        const sizeCheck = checkFileSizeAccess(userTier, file.size);
        if (!sizeCheck.allowed) { showToast(sizeCheck.message, 'error'); continue; }
        newMedia.push({ file, preview: URL.createObjectURL(file), id: Math.random().toString(36).slice(2, 10) });
      }
      if (files.length > remaining) showToast(`Only added ${remaining} more, max ${MAX_PHOTOS} photos`, 'error');
      return [...prev, ...newMedia];
    });
  }, [userTier, showToast]);

  const handleFileSelect = (e) => {
    addFiles(e.target.files);
    e.target.value = '';
  };

  const removePhoto = (id) => {
    setMediaFiles(prev => {
      const item = prev.find(m => m.id === id);
      if (item) URL.revokeObjectURL(item.preview);
      return prev.filter(m => m.id !== id);
    });
  };

  const handleDragEnter = (e) => {
    e.preventDefault(); e.stopPropagation();
    if (!e.dataTransfer?.types?.includes('Files')) return;
    dragCounter.current += 1;
    setIsDraggingOver(true);
  };
  const handleDragOver = (e) => { e.preventDefault(); e.stopPropagation(); };
  const handleDragLeave = (e) => {
    e.preventDefault(); e.stopPropagation();
    dragCounter.current -= 1;
    if (dragCounter.current <= 0) { dragCounter.current = 0; setIsDraggingOver(false); }
  };
  // Single drop handler for the whole photos area — a drop can land on empty
  // space, on an existing tile (reorder target), or carry real OS files (add
  // photos). Tiles don't own their own onDrop, so a file dropped directly on
  // top of an existing tile still gets added instead of being swallowed by
  // that tile's reorder logic.
  const handleDrop = (e) => {
    e.preventDefault(); e.stopPropagation();
    dragCounter.current = 0;
    setIsDraggingOver(false);
    if (dragIndex !== null) {
      const to = dragOverIndex !== null ? dragOverIndex : dragIndex;
      setMediaFiles(prev => {
        if (dragIndex === to || dragIndex >= prev.length) return prev;
        const next = [...prev];
        const [moved] = next.splice(dragIndex, 1);
        next.splice(to, 0, moved);
        return next;
      });
      setDragIndex(null); setDragOverIndex(null);
      return;
    }
    if (e.dataTransfer?.files?.length) addFiles(e.dataTransfer.files);
  };

  const handlePost = async () => {
    if (mediaFiles.length === 0 || loading) return;
    setLoading(true);
    setUploadProgress(0);
    try {
      const postId = await createPost(auth.currentUser.uid, {
        content: content.trim(),
        type: mediaFiles.length > 1 ? 'carousel' : 'photo',
        hashtags: (content.match(/#\w+/g) || []).map(t => t.slice(1).toLowerCase()),
      });
      for (let i = 0; i < mediaFiles.length; i++) {
        await uploadPostMedia(postId, mediaFiles[i].file);
        setUploadProgress(Math.round(((i + 1) / mediaFiles.length) * 100));
      }
      showToast('Posted!', 'success');
      navigate(-1);
    } catch (err) {
      console.error(err);
      showToast('Failed to publish', 'error');
    }
    setLoading(false);
    mediaFiles.forEach(m => URL.revokeObjectURL(m.preview));
  };

  const getGridClass = () => {
    const c = mediaFiles.length;
    if (c <= 1) return 'grid-cols-1 max-w-md';
    if (c <= 4) return 'grid-cols-2';
    return 'grid-cols-3';
  };

  // Drag-to-reorder (native HTML5 DnD so it plays nicely inside the CSS grid)
  const [dragIndex, setDragIndex] = useState(null);
  const [dragOverIndex, setDragOverIndex] = useState(null);

  const handleTileDragStart = (idx) => (e) => {
    setDragIndex(idx);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(idx));
  };
  const handleTileDragEnter = (idx) => (e) => {
    e.preventDefault(); e.stopPropagation();
    if (dragIndex === null || dragIndex === idx) return;
    setDragOverIndex(idx);
  };
  const handleTileDragOver = (e) => { e.preventDefault(); e.stopPropagation(); };
  const handleTileDragEnd = () => { setDragIndex(null); setDragOverIndex(null); };

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
              <h1 className="font-syne font-bold text-base text-white">Photo Post</h1>
              <p className="text-text-muted text-[10px] font-dmmono">{mediaFiles.length}/{MAX_PHOTOS} photos</p>
            </div>
          </div>
          <button
            onClick={handlePost}
            disabled={loading || mediaFiles.length === 0}
            className="bg-brand-violet text-white px-6 py-2 rounded-full font-bold text-sm disabled:opacity-30 hover:brightness-110 active:scale-[0.97] transition-all"
          >
            {loading ? (
              <span className="flex items-center gap-2">
                <div className="w-4 h-4 border-2 border-bg-dark/30 border-t-bg-dark rounded-full animate-spin" />
                {uploadProgress}%
              </span>
            ) : 'Post'}
          </button>
        </div>
        {loading && (
          <div className="h-1 bg-surface-3">
            <div className="h-full bg-brand-violet transition-all duration-300" style={{ width: `${uploadProgress}%` }} />
          </div>
        )}
      </header>

      <div className={`flex-1 overflow-y-auto ${isDesktop ? 'flex gap-6 px-6 py-5' : 'px-4 py-4'}`}>
        {/* Sidebar */}
        <div className={isDesktop ? 'w-[340px] shrink-0' : ''}>
          <div className="flex gap-3 mb-4">
            <UserAvatar src={profile?.avatar || profile?.photoURL} size={40} />
            <div className="flex-1">
              <p className="text-brand-violet-light text-xs font-dmmono mb-1">@{profile?.username || 'you'}</p>
              <textarea
                value={content}
                onChange={e => setContent(e.target.value)}
                placeholder="Write a caption..."
                className="w-full bg-transparent text-text-primary text-sm leading-relaxed placeholder:text-text-muted/40 outline-none resize-none min-h-[80px]"
                maxLength={2000}
              />
            </div>
          </div>
          <div className="p-3.5 rounded-xl bg-surface-1 border border-white/[0.06] mb-4">
            <div className="flex items-center justify-between">
              <span className="text-text-muted text-[10px] uppercase tracking-wider font-bold">Quality</span>
              <span className="text-brand-violet-light text-[11px] font-dmmono font-bold">{tierConfig.imageMaxDim === Infinity ? 'Original 4K' : `${tierConfig.imageMaxDim}p`}</span>
            </div>
            <div className="flex items-center justify-between mt-1.5">
              <span className="text-text-muted text-[10px] uppercase tracking-wider font-bold">Max upload</span>
              <span className="text-text-secondary text-[11px] font-dmmono">{tierConfig.maxFileUploadMB}MB</span>
            </div>
          </div>
        </div>

        {/* Photos area — also the OS file drop target */}
        <div
          className="flex-1 relative"
          onDragEnter={handleDragEnter}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          <AnimatePresence>
            {isDraggingOver && (
              <motion.div
                initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }}
                className="absolute -inset-2 z-20 rounded-2xl border-2 border-dashed border-brand-violet bg-brand-violet/10 backdrop-blur-md flex flex-col items-center justify-center gap-3 pointer-events-none"
              >
                <div className="w-14 h-14 rounded-2xl bg-brand-violet/20 border border-brand-violet/40 flex items-center justify-center">
                  <Icon name="file_download" size={28} className="text-brand-violet" />
                </div>
                <p className="text-white font-syne font-bold text-sm">Drop to add photos</p>
              </motion.div>
            )}
          </AnimatePresence>

          {mediaFiles.length > 0 ? (
            <>
              <div className={`grid ${getGridClass()} gap-2`}>
                <AnimatePresence initial={false}>
                  {mediaFiles.map((media, idx) => (
                    <PhotoTile
                      key={media.id}
                      media={media}
                      idx={idx}
                      total={mediaFiles.length}
                      isDragging={dragIndex === idx}
                      isDragOver={dragOverIndex === idx && dragIndex !== idx}
                      onRemove={() => removePhoto(media.id)}
                      onDragStart={handleTileDragStart(idx)}
                      onDragEnter={handleTileDragEnter(idx)}
                      onDragOverTile={handleTileDragOver}
                      onDragEnd={handleTileDragEnd}
                    />
                  ))}
                </AnimatePresence>
                {mediaFiles.length < MAX_PHOTOS && (
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    className="aspect-square rounded-2xl border-2 border-dashed border-white/[0.08] bg-gradient-to-br from-surface-1/30 to-transparent flex flex-col items-center justify-center gap-2 hover:border-brand-violet/30 hover:from-brand-violet/5 transition-all group"
                  >
                    <Icon name="add" size={22} className="text-text-muted group-hover:text-brand-violet transition-colors" />
                    <span className="text-text-muted text-[10px] font-dmmono group-hover:text-brand-violet transition-colors">Add Photo</span>
                  </button>
                )}
              </div>
              {mediaFiles.length > 1 && (
                <p className="flex items-center gap-1.5 text-text-muted/70 text-[11px] mt-3">
                  <Icon name="drag_indicator" size={14} />
                  Drag a photo to reorder the carousel &middot; first photo is the cover
                </p>
              )}
            </>
          ) : (
            <button
              onClick={() => fileInputRef.current?.click()}
              className="w-full aspect-video max-h-[400px] rounded-2xl border-2 border-dashed border-white/[0.08] bg-gradient-to-b from-surface-1/30 to-surface-1/10 flex flex-col items-center justify-center gap-4 hover:border-brand-violet/30 hover:from-brand-violet/5 hover:to-transparent transition-all group cursor-pointer"
            >
              <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-brand-violet/15 to-brand-pink/15 border border-white/[0.08] flex items-center justify-center group-hover:scale-105 transition-transform">
                <Icon name="add_photo_alternate" size={32} className="text-brand-violet" />
              </div>
              <div className="text-center">
                <p className="text-text-primary font-syne font-bold text-sm">Add Photos</p>
                <p className="text-text-muted text-xs mt-1">Up to {MAX_PHOTOS} photos &middot; {tierConfig.maxFileUploadMB}MB each</p>
                <p className="text-text-muted/60 text-[11px] mt-2">or drag and drop images here</p>
              </div>
            </button>
          )}
        </div>
      </div>
      <input type="file" ref={fileInputRef} onChange={handleFileSelect} className="hidden" accept="image/*" multiple />
    </div>
  );
}

function PhotoTile({ media, idx, total, isDragging, isDragOver, onRemove, onDragStart, onDragEnter, onDragOverTile, onDragEnd }) {
  return (
    <motion.div
      layout
      initial={{ opacity: 0, scale: 0.92 }}
      animate={{ opacity: isDragging ? 0.35 : 1, scale: isDragOver ? 1.03 : 1 }}
      exit={{ opacity: 0, scale: 0.9 }}
      transition={{ type: 'spring', stiffness: 400, damping: 32 }}
      draggable
      onDragStart={onDragStart}
      onDragEnter={onDragEnter}
      onDragOver={onDragOverTile}
      onDragEnd={onDragEnd}
      className={`relative group rounded-2xl overflow-hidden border bg-surface-1 aspect-square max-h-[280px] cursor-grab active:cursor-grabbing select-none ${isDragOver ? 'border-brand-violet ring-2 ring-brand-violet/50' : 'border-white/[0.06]'}`}
    >
      <img src={media.preview} alt="" draggable={false} className="w-full h-full object-cover pointer-events-none" />
      <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors">
        <div className="absolute top-2 left-2 w-6 h-6 rounded-lg bg-black/50 backdrop-blur-sm flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
          <Icon name="drag_indicator" size={14} className="text-white/90" />
        </div>
        <button
          onClick={onRemove}
          onPointerDown={(e) => e.stopPropagation()}
          className="absolute top-2 right-2 w-7 h-7 rounded-lg bg-brand-ember/80 backdrop-blur-sm flex items-center justify-center text-white opacity-0 group-hover:opacity-100 transition-opacity"
        >
          <Icon name="close" size={14} />
        </button>
        {idx === 0 && total > 1 && (
          <span className="absolute top-2 left-1/2 -translate-x-1/2 px-2 py-0.5 rounded-md bg-brand-violet/90 backdrop-blur-sm text-white text-[9px] font-dmmono font-bold uppercase tracking-wider opacity-0 group-hover:opacity-100 transition-opacity">
            Cover
          </span>
        )}
        <div className="absolute bottom-2 left-2 opacity-0 group-hover:opacity-100 transition-opacity">
          <span className="px-2 py-0.5 rounded-md bg-black/60 backdrop-blur-sm text-white text-[10px] font-dmmono font-bold">{idx + 1}/{total}</span>
        </div>
      </div>
    </motion.div>
  );
}
