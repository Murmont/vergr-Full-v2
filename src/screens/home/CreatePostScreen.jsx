import React, { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useUser } from '../../context/UserContext';
import { useUI } from '../../context/UIContext';
import { auth } from '../../firebase/config';
import { createPost, uploadPostMedia, updatePostMediaUrl } from '../../firebase/firestore';
import UserAvatar from '../../components/UserAvatar';
import Icon from '../../components/Icon';
import { useLayout } from '../../context/LayoutContext';
import useResponsive from '../../hooks/useResponsive';
import { getLinkPreview } from '../../utils/linkPreview'; // we'll create this

export default function CreatePostScreen() {
  const [content, setContent] = useState('');
  const [mediaFiles, setMediaFiles] = useState([]); // array of { file, preview, type }
  const [loading, setLoading] = useState(false);
  const [linkPreview, setLinkPreview] = useState(null);
  const [showGiphy, setShowGiphy] = useState(false);
  const fileInputRef = useRef(null);
  
  const { profile } = useUser();
  const { showToast } = useUI();
  const navigate = useNavigate();
  const { setRightPanel, setContentAlign } = useLayout();
  const { isMobile } = useResponsive();

  // Full‑width layout
  useEffect(() => {
    setRightPanel(null);
    setContentAlign('left');
    return () => {
      setRightPanel(null);
      setContentAlign('center');
    };
  }, [setRightPanel, setContentAlign]);

  // Detect URLs in content and fetch preview
  useEffect(() => {
    const urlRegex = /(https?:\/\/[^\s]+)/g;
    const matches = content.match(urlRegex);
    if (matches && matches.length > 0) {
      // Take the first URL
      getLinkPreview(matches[0]).then(data => setLinkPreview(data)).catch(() => setLinkPreview(null));
    } else {
      setLinkPreview(null);
    }
  }, [content]);

  const handleFileChange = (e) => {
    const files = Array.from(e.target.files);
    const newMedia = files.map(file => ({
      file,
      preview: URL.createObjectURL(file),
      type: file.type.startsWith('video/') ? 'video' : 'image',
    }));
    setMediaFiles(prev => [...prev, ...newMedia]);
  };

  const removeMedia = (index) => {
    const media = mediaFiles[index];
    URL.revokeObjectURL(media.preview);
    setMediaFiles(prev => prev.filter((_, i) => i !== index));
  };

  const clearAllMedia = () => {
    mediaFiles.forEach(m => URL.revokeObjectURL(m.preview));
    setMediaFiles([]);
  };

  const handlePost = async () => {
    if (!content.trim() && mediaFiles.length === 0 && !linkPreview) return;
    setLoading(true);
    try {
      const postData = {
        content: content.trim(),
        type: mediaFiles.length > 0 ? 'media' : (linkPreview ? 'link' : 'text'),
        linkPreview: linkPreview || null,
      };
      const postId = await createPost(auth.currentUser.uid, postData);
      
      // Upload media if any
      if (mediaFiles.length > 0) {
        // For simplicity, upload first media only; in real app, handle multiple
        const downloadURL = await uploadPostMedia(postId, mediaFiles[0].file);
        await updatePostMediaUrl(postId, downloadURL);
      }
      
      showToast('Post published!', 'success');
      navigate(-1);
    } catch (err) {
      console.error("Post creation error:", err);
      showToast("Failed to publish post", "error");
    } finally {
      setLoading(false);
      clearAllMedia();
    }
  };

  return (
    <div className="min-h-full bg-bg-dark flex flex-col">
      {/* Mobile header */}
      {isMobile && (
        <header className="sticky top-0 z-40 glass-header flex items-center justify-between px-4 py-4 border-b border-white/[0.04]">
          <button onClick={() => navigate(-1)} className="text-text-muted hover:text-white">Cancel</button>
          <button 
            onClick={handlePost}
            disabled={loading || (!content.trim() && mediaFiles.length === 0 && !linkPreview)}
            className="bg-brand-violet text-white px-6 py-1.5 rounded-full font-black text-xs uppercase tracking-widest disabled:opacity-50"
          >
            {loading ? 'Posting...' : 'Post'}
          </button>
        </header>
      )}

      {/* Desktop header */}
      {!isMobile && (
        <div className="flex items-center justify-between px-4 lg:px-6 pt-4 pr-12 lg:pr-16">
          <button onClick={() => navigate(-1)} className="text-white/80 hover:text-white transition-colors">
            <Icon name="arrow_back" size={24} />
          </button>
          <button
            onClick={handlePost}
            disabled={loading || (!content.trim() && mediaFiles.length === 0 && !linkPreview)}
            className="bg-brand-violet text-white px-8 py-2 rounded-full font-black text-sm uppercase tracking-widest disabled:opacity-50"
          >
            {loading ? 'Posting...' : 'Post'}
          </button>
        </div>
      )}

      {/* Main content */}
      <main className="flex-1 p-4 lg:px-6">
        <div className="flex gap-4">
          <UserAvatar src={profile?.avatar} size={48} />
          <div className="flex-1">
            <textarea
              autoFocus
              value={content}
              onChange={e => setContent(e.target.value)}
              placeholder="What's happening?"
              className="w-full bg-transparent text-white text-lg placeholder:text-text-muted outline-none min-h-[120px] resize-none"
            />

            {/* Media preview grid */}
            {mediaFiles.length > 0 && (
              <div className="mt-4 grid grid-cols-2 gap-2">
                {mediaFiles.map((media, idx) => (
                  <div key={idx} className="relative rounded-xl overflow-hidden border border-white/[0.06] group">
                    {media.type === 'image' ? (
                      <img src={media.preview} alt="" className="w-full h-32 object-cover" />
                    ) : (
                      <video src={media.preview} className="w-full h-32 object-cover" />
                    )}
                    <button
                      onClick={() => removeMedia(idx)}
                      className="absolute top-1 right-1 p-1 bg-black/60 rounded-full opacity-0 group-hover:opacity-100 transition"
                    >
                      <Icon name="close" size={14} className="text-white" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Link preview */}
            {linkPreview && (
              <div className="mt-4 p-3 rounded-xl border border-white/[0.06] bg-surface-1 flex gap-3">
                {linkPreview.image && (
                  <img src={linkPreview.image} alt="" className="w-20 h-20 object-cover rounded-lg" />
                )}
                <div className="flex-1 min-w-0">
                  <h4 className="text-white font-semibold text-sm truncate">{linkPreview.title}</h4>
                  <p className="text-text-muted text-xs mt-1 line-clamp-2">{linkPreview.description}</p>
                  <span className="text-xs text-brand-violet-light mt-1 block">{linkPreview.url}</span>
                </div>
                <button onClick={() => setLinkPreview(null)} className="text-text-muted hover:text-white">
                  <Icon name="close" size={16} />
                </button>
              </div>
            )}
          </div>
        </div>
      </main>

      {/* Hidden file input */}
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleFileChange}
        className="hidden"
        accept="image/*,video/*"
        multiple
      />

      {/* Footer actions */}
      <footer className="p-4 lg:px-6 border-t border-white/[0.04] flex gap-4 items-center">
        <button onClick={() => fileInputRef.current?.click()} className="text-brand-violet-light hover:text-white transition-colors">
          <Icon name="image" size={24} />
        </button>
        <button onClick={() => navigate('/create-poll')} className="text-brand-gold hover:text-white transition-colors">
          <Icon name="poll" size={24} />
        </button>
        <button onClick={() => setShowGiphy(!showGiphy)} className="text-brand-violet hover:text-white transition-colors">
          <Icon name="gif" size={24} />
        </button>
        <div className="flex-1 text-right text-text-muted text-xs">
          {content.length}/500
        </div>
      </footer>

      {/* Giphy picker (simplified) */}
      {showGiphy && (
        <div className="h-64 border-t border-white/10 bg-surface-1">
          <div className="p-2 text-center text-text-muted">GIPHY integration coming soon</div>
        </div>
      )}
    </div>
  );
}