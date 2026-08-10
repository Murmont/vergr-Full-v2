import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useUser } from '../context/UserContext';
import { useUI } from '../context/UIContext';
import { auth } from '../firebase/config';
import { createPost, uploadPostMedia, updatePostMediaUrl } from '../firebase/firestore';
import UserAvatar from './UserAvatar';
import Icon from './Icon';
import MediaPanel from './MediaPanel';
import EmojiPicker from './EmojiPicker';
import { getLinkPreview } from '../utils/linkPreview';

export default function CreatePostModal({ onClose }) {
  const { profile } = useUser();
  const { showToast } = useUI();
  const navigate = useNavigate();
  const [content, setContent] = useState('');
  const [mediaFiles, setMediaFiles] = useState([]);
  const [loading, setLoading] = useState(false);
  const [linkPreview, setLinkPreview] = useState(null);
  const [showMediaPanel, setShowMediaPanel] = useState(null);
  const [showEmoji, setShowEmoji] = useState(false);
  const fileInputRef = useRef(null);
  const textareaRef = useRef(null);

  useEffect(() => {
    setTimeout(() => textareaRef.current?.focus(), 100);
  }, []);

  useEffect(() => {
    const urlRegex = /(https?:\/\/[^\s]+)/g;
    const matches = content.match(urlRegex);
    if (matches && matches.length > 0) {
      getLinkPreview(matches[0]).then(setLinkPreview).catch(() => setLinkPreview(null));
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
    URL.revokeObjectURL(mediaFiles[index].preview);
    setMediaFiles(prev => prev.filter((_, i) => i !== index));
  };

  const handleMediaSelect = (type, url, item) => {
    if (type === 'gifs' || type === 'stickers') {
      setMediaFiles(prev => [...prev, { file: null, preview: url, type: 'image', isGif: true, url }]);
    } else if (type === 'clips') {
      const videoUrl = item.videoUrl || url;
      setMediaFiles(prev => [...prev, { file: null, preview: videoUrl, type: 'video', url: videoUrl, isClip: true }]);
    }
    setShowMediaPanel(null);
  };

  const handlePost = async () => {
    if (!content.trim() && mediaFiles.length === 0 && !linkPreview) return;
    setLoading(true);
    try {
      const postData = {
        content: content.trim(),
        type: mediaFiles.length > 0 ? (mediaFiles[0].type === 'video' ? 'clip' : 'media') : (linkPreview ? 'link' : 'text'),
        linkPreview: linkPreview || null,
      };
      const postId = await createPost(auth.currentUser.uid, postData);
      
      for (const media of mediaFiles) {
        if (media.file) {
          const downloadURL = await uploadPostMedia(postId, media.file);
          await updatePostMediaUrl(postId, downloadURL);
          break;
        } else if (media.url) {
          await updatePostMediaUrl(postId, media.url);
          break;
        }
      }
      
      showToast('Post published!', 'success');
      onClose();
      navigate(0);
    } catch (err) {
      console.error(err);
      showToast('Failed to publish post', 'error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80" onClick={onClose}>
      <div className="bg-surface-1 rounded-2xl w-full max-w-lg mx-4 border border-white/[0.06] overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-white/[0.04]">
          <button onClick={onClose} className="text-text-muted hover:text-white"><Icon name="close" size={24} /></button>
          <span className="text-white font-semibold">Create post</span>
          <button onClick={handlePost} disabled={loading || (!content.trim() && mediaFiles.length === 0 && !linkPreview)} className="bg-brand-violet text-white px-4 py-1.5 rounded-full text-xs font-black uppercase disabled:opacity-50">
            {loading ? 'Posting...' : 'Post'}
          </button>
        </div>
        <div className="p-4 flex gap-3">
          <UserAvatar src={profile?.avatar} size={40} />
          <div className="flex-1">
            <textarea
              ref={textareaRef}
              value={content}
              onChange={e => setContent(e.target.value)}
              placeholder="What's happening?"
              className="w-full bg-transparent text-white text-base placeholder:text-text-muted outline-none resize-none min-h-[100px]"
            />
            <div className="mt-2 grid grid-cols-2 gap-2">
              {mediaFiles.map((media, idx) => (
                <div key={idx} className="relative rounded-xl overflow-hidden border border-white/[0.06]">
                  {media.type === 'image' ? (
                    <img src={media.preview} alt="" className="w-full h-32 object-cover" />
                  ) : (
                    <video src={media.preview} controls className="w-full h-32 object-cover" />
                  )}
                  <button onClick={() => removeMedia(idx)} className="absolute top-1 right-1 p-1 bg-black/60 rounded-full"><Icon name="close" size={14} className="text-white" /></button>
                </div>
              ))}
            </div>
            {linkPreview && (
              <div className="mt-3 p-2 rounded-xl bg-surface-2 border border-white/[0.06] flex gap-2">
                {linkPreview.image && <img src={linkPreview.image} alt="" className="w-16 h-16 object-cover rounded-lg" />}
                <div className="flex-1">
                  <p className="text-white text-xs font-semibold">{linkPreview.title}</p>
                  <p className="text-text-muted text-[10px] line-clamp-2">{linkPreview.description}</p>
                </div>
                <button onClick={() => setLinkPreview(null)}><Icon name="close" size={14} className="text-text-muted" /></button>
              </div>
            )}
          </div>
        </div>
        <div className="border-t border-white/[0.04] p-2 flex gap-3">
          <button onClick={() => fileInputRef.current.click()} className="p-2 text-brand-violet-light hover:bg-surface-2 rounded-full"><Icon name="image" size={22} /></button>
          <button onClick={() => { setShowMediaPanel('gifs'); setShowEmoji(false); }} className="p-2 text-brand-violet hover:bg-surface-2 rounded-full"><Icon name="gif_box" size={22} /></button>
          <button onClick={() => { setShowMediaPanel('stickers'); setShowEmoji(false); }} className="p-2 text-brand-pink hover:bg-surface-2 rounded-full"><Icon name="sticky_note_2" size={22} /></button>
          <button onClick={() => { setShowMediaPanel('clips'); setShowEmoji(false); }} className="p-2 text-brand-gold hover:bg-surface-2 rounded-full"><Icon name="movie" size={22} /></button>
          <button onClick={() => { setShowEmoji(!showEmoji); setShowMediaPanel(null); }} className="p-2 text-text-muted hover:bg-surface-2 rounded-full"><Icon name="sentiment_satisfied" size={22} /></button>
          <button onClick={() => navigate('/create-poll')} className="p-2 text-brand-gold hover:bg-surface-2 rounded-full"><Icon name="poll" size={22} /></button>
        </div>
        {showMediaPanel && (
          <MediaPanel defaultTab={showMediaPanel} onSelect={handleMediaSelect} onClose={() => setShowMediaPanel(null)} />
        )}
        {showEmoji && (
          <EmojiPicker onSelect={(emoji) => setContent(prev => prev + emoji)} onClose={() => setShowEmoji(false)} />
        )}
        <input type="file" ref={fileInputRef} onChange={handleFileChange} className="hidden" accept="image/*,video/*" multiple />
      </div>
    </div>
  );
}