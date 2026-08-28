import React, { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useUser } from '../../context/UserContext';
import { useUI } from '../../context/UIContext';
import { auth } from '../../firebase/config';
import { createPost } from '../../firebase/firestore';
import UserAvatar from '../../components/UserAvatar';
import Icon from '../../components/Icon';
import { useLayout } from '../../context/LayoutContext';
import useResponsive from '../../hooks/useResponsive';
import UserName from '../../components/UserName';

const MAX_CHARS = 2000;

export default function CreateTextPostScreen() {
  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(false);
  const [tags, setTags] = useState([]);
  const textRef = useRef(null);
  const { profile } = useUser();
  const { showToast } = useUI();
  const navigate = useNavigate();
  const { setRightPanel, setContentAlign } = useLayout();
  const { isDesktop } = useResponsive();

  useEffect(() => { setRightPanel(null); setContentAlign(isDesktop ? 'left' : 'center'); return () => { setRightPanel(null); setContentAlign('center'); }; }, [setRightPanel, setContentAlign, isDesktop]);
  useEffect(() => { textRef.current?.focus(); }, []);
  useEffect(() => { setTags([...new Set((content.match(/#\w+/g) || []).map(t => t.slice(1).toLowerCase()))]); }, [content]);

  const handlePost = async () => {
    if (!content.trim() || loading) return;
    setLoading(true);
    try {
      await createPost(auth.currentUser.uid, { content: content.trim(), type: 'text', hashtags: tags });
      showToast('Posted!', 'success');
      navigate(-1);
    } catch (err) {
      console.error(err);
      showToast('Failed to publish', 'error');
    }
    setLoading(false);
  };

  const remaining = MAX_CHARS - content.length;
  const pct = (content.length / MAX_CHARS) * 100;
  const ringColor = remaining < 0 ? 'text-brand-ember' : remaining < 100 ? 'text-brand-gold' : 'text-brand-violet-light';

  return (
    <div className="min-h-screen flex flex-col bg-bg-dark">
      {/* Header */}
      <header className="sticky top-0 z-40 bg-bg-dark/90 backdrop-blur-xl border-b border-white/[0.04]">
        <div className="flex items-center justify-between px-4 py-3">
          <div className="flex items-center gap-3">
            <button onClick={() => navigate(-1)} className="w-9 h-9 rounded-xl bg-surface-2 border border-white/[0.06] flex items-center justify-center text-text-secondary hover:text-white transition-colors">
              <Icon name="close" size={20} />
            </button>
            <h1 className="font-syne font-bold text-base text-white">New Post</h1>
          </div>
          <div className="flex items-center gap-3">
            {/* Character ring */}
            <div className="relative w-8 h-8">
              <svg className="w-full h-full -rotate-90" viewBox="0 0 36 36">
                <circle cx="18" cy="18" r="15" fill="none" stroke="currentColor" strokeWidth="2" className="text-surface-3" />
                <circle cx="18" cy="18" r="15" fill="none" stroke="currentColor" strokeWidth="2.5" className={ringColor} strokeDasharray={`${Math.min(pct, 100) * 0.942} 94.2`} strokeLinecap="round" />
              </svg>
              {remaining < 100 && (
                <span className={`absolute inset-0 flex items-center justify-center text-[8px] font-dmmono font-bold ${ringColor}`}>{remaining}</span>
              )}
            </div>
            <button
              onClick={handlePost}
              disabled={loading || !content.trim() || remaining < 0}
              className="bg-brand-violet text-white px-6 py-2 rounded-full font-bold text-sm disabled:opacity-30 hover:brightness-110 active:scale-[0.97] transition-all"
            >
              {loading ? <div className="w-4 h-4 border-2 border-bg-dark/30 border-t-bg-dark rounded-full animate-spin" /> : 'Post'}
            </button>
          </div>
        </div>
      </header>

      {/* Content area */}
      <div className={`flex-1 px-4 py-5 ${isDesktop ? 'max-w-2xl' : ''}`}>
        <div className="flex gap-3.5">
          <div className="shrink-0 pt-1">
            <UserAvatar src={profile?.avatar || profile?.photoURL} size={44} />
            <div className="w-0.5 mx-auto mt-2 flex-1 bg-gradient-to-b from-brand-violet/30 to-transparent min-h-[40px] rounded-full" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-brand-violet-light text-xs font-dmmono mb-2"><UserName user={profile} masked handle fallback={'you'} /></p>
            <textarea
              ref={textRef}
              value={content}
              onChange={e => setContent(e.target.value)}
              placeholder="What's on your mind?"
              className="w-full bg-transparent text-text-primary text-[17px] leading-relaxed placeholder:text-text-muted/40 outline-none resize-none min-h-[200px]"
              maxLength={MAX_CHARS + 50}
            />
            {tags.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-3 pt-3 border-t border-white/[0.04]">
                {tags.map(tag => (
                  <span key={tag} className="px-2.5 py-1 rounded-lg bg-brand-violet/8 border border-brand-violet/15 text-brand-violet-light text-[11px] font-semibold">#{tag}</span>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Footer */}
      <footer className="sticky bottom-0 bg-bg-dark/90 backdrop-blur-xl border-t border-white/[0.04] px-4 py-3">
        <div className="flex items-center gap-1">
          <button onClick={() => navigate('/create/photo')} className="w-10 h-10 rounded-xl flex items-center justify-center text-text-muted hover:text-brand-violet hover:bg-brand-violet/10 transition-all" title="Add photos">
            <Icon name="image" size={20} />
          </button>
          <button onClick={() => navigate('/create/short')} className="w-10 h-10 rounded-xl flex items-center justify-center text-text-muted hover:text-brand-violet-light hover:bg-brand-violet/10 transition-all" title="Create short">
            <Icon name="slow_motion_video" size={20} />
          </button>
          <button onClick={() => navigate('/create/clip')} className="w-10 h-10 rounded-xl flex items-center justify-center text-text-muted hover:text-brand-ember hover:bg-brand-ember/10 transition-all" title="Upload clip">
            <Icon name="videocam" size={20} />
          </button>
          <button onClick={() => navigate('/create-poll')} className="w-10 h-10 rounded-xl flex items-center justify-center text-text-muted hover:text-brand-gold hover:bg-brand-gold/10 transition-all" title="Create poll">
            <Icon name="bar_chart" size={20} />
          </button>
          <div className="flex-1" />
          <span className="text-text-muted/40 text-[10px] font-dmmono">{content.length.toLocaleString()} / {MAX_CHARS.toLocaleString()}</span>
        </div>
      </footer>
    </div>
  );
}
