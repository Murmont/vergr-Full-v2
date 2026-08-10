import React, { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useUser } from '../../context/UserContext';
import { useUI } from '../../context/UIContext';
import { auth } from '../../firebase/config';
import { createQuotePost, getPostWithAuthor } from '../../firebase/firestore';
import UserAvatar from '../../components/UserAvatar';
import Icon from '../../components/Icon';
import { useLayout } from '../../context/LayoutContext';
import useResponsive from '../../hooks/useResponsive';
import { timeAgo } from '../../utils/helpers';

const MAX_CHARS = 500;

export default function QuotePostScreen() {
  const [searchParams] = useSearchParams();
  const originalPostId = searchParams.get('post');
  const [content, setContent] = useState('');
  const [originalPost, setOriginalPost] = useState(null);
  const [loading, setLoading] = useState(false);
  const [loadingPost, setLoadingPost] = useState(true);

  const { profile } = useUser();
  const { showToast } = useUI();
  const navigate = useNavigate();
  const { setRightPanel, setContentAlign } = useLayout();
  const { isDesktop } = useResponsive();

  useEffect(() => {
    setRightPanel(null);
    setContentAlign(isDesktop ? 'left' : 'center');
    return () => { setRightPanel(null); setContentAlign('center'); };
  }, [setRightPanel, setContentAlign, isDesktop]);

  useEffect(() => {
    if (!originalPostId) return;
    getPostWithAuthor(originalPostId)
      .then(setOriginalPost)
      .catch(err => console.error('Failed to load post:', err))
      .finally(() => setLoadingPost(false));
  }, [originalPostId]);

  const handlePost = async () => {
    if (!content.trim() || loading || !originalPostId) return;
    setLoading(true);
    try {
      const hashtags = (content.match(/#\w+/g) || []).map(t => t.slice(1).toLowerCase());
      await createQuotePost(auth.currentUser.uid, originalPostId, { content: content.trim(), hashtags });
      showToast('Quote posted!', 'success');
      navigate(-1);
    } catch (err) {
      console.error(err);
      showToast('Failed to post', 'error');
    }
    setLoading(false);
  };

  const remaining = MAX_CHARS - content.length;
  const pct = (content.length / MAX_CHARS) * 100;
  const ringColor = remaining < 0 ? 'text-brand-ember' : remaining < 50 ? 'text-brand-gold' : 'text-brand-violet-light';

  return (
    <div className="min-h-screen flex flex-col bg-bg-dark">
      {/* Header */}
      <header className="sticky top-0 z-40 bg-bg-dark/90 backdrop-blur-xl border-b border-white/[0.04]">
        <div className="flex items-center justify-between px-4 py-3">
          <button onClick={() => navigate(-1)} className="w-9 h-9 rounded-xl bg-surface-2 border border-white/[0.06] flex items-center justify-center text-text-secondary hover:text-white transition-colors">
            <Icon name="close" size={20} />
          </button>
          <div className="flex items-center gap-3">
            <div className="relative w-8 h-8">
              <svg className="w-full h-full -rotate-90" viewBox="0 0 36 36">
                <circle cx="18" cy="18" r="15" fill="none" stroke="currentColor" strokeWidth="2" className="text-surface-3" />
                <circle cx="18" cy="18" r="15" fill="none" stroke="currentColor" strokeWidth="2.5"
                  className={ringColor} strokeDasharray={`${Math.min(pct, 100) * 0.942} 94.2`} strokeLinecap="round" />
              </svg>
              {remaining < 50 && (
                <span className={`absolute inset-0 flex items-center justify-center text-[8px] font-dmmono font-bold ${ringColor}`}>{remaining}</span>
              )}
            </div>
            <button onClick={handlePost} disabled={loading || !content.trim() || remaining < 0}
              className="bg-brand-violet text-white px-6 py-2 rounded-full font-bold text-sm disabled:opacity-30 hover:brightness-110 active:scale-[0.97] transition-all ">
              {loading ? <div className="w-4 h-4 border-2 border-bg-dark/30 border-t-bg-dark rounded-full animate-spin" /> : 'Post'}
            </button>
          </div>
        </div>
      </header>

      {/* Body */}
      <div className={`flex-1 px-4 py-5 ${isDesktop ? 'max-w-2xl' : ''}`}>
        {/* User's text input */}
        <div className="flex gap-3.5 mb-4">
          <div className="shrink-0 pt-1">
            <UserAvatar src={profile?.avatar || profile?.photoURL} size={44} />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-brand-violet-light text-xs font-dmmono mb-2">@{profile?.username || 'you'}</p>
            <textarea
              autoFocus
              value={content}
              onChange={e => setContent(e.target.value)}
              placeholder="Add your thoughts..."
              className="w-full bg-transparent text-text-primary text-[16px] leading-relaxed placeholder:text-text-muted/60 outline-none resize-none min-h-[100px]"
              maxLength={MAX_CHARS + 20}
            />
          </div>
        </div>

        {/* Embedded original post preview */}
        {loadingPost ? (
          <div className="rounded-2xl border border-white/[0.06] bg-surface-1/50 p-6 flex justify-center">
            <div className="w-5 h-5 border-2 border-surface-3 border-t-brand-violet rounded-full animate-spin" />
          </div>
        ) : originalPost ? (
          <div className="rounded-2xl border border-white/[0.06] bg-surface-1/30 p-4 ml-12">
            <div className="flex items-center gap-2 mb-2">
              <UserAvatar src={originalPost.author?.avatar} size={20} />
              <span className="text-text-primary text-xs font-semibold">{originalPost.author?.displayName}</span>
              <span className="text-text-muted text-xs">@{originalPost.author?.username}</span>
              <span className="text-text-muted text-xs">· {timeAgo(originalPost.createdAt)}</span>
            </div>
            {originalPost.content && (
              <p className="text-text-secondary text-sm leading-relaxed line-clamp-4">{originalPost.content}</p>
            )}
            {originalPost.mediaUrls?.length > 0 && (
              <div className="mt-2 rounded-xl overflow-hidden border border-white/[0.04] max-h-[150px]">
                <img src={originalPost.mediaUrls[0]} alt="" className="w-full h-full object-cover" />
              </div>
            )}
          </div>
        ) : (
          <div className="rounded-2xl border border-white/[0.06] bg-surface-1/30 p-6 text-center ml-12">
            <p className="text-text-muted text-sm">Original post unavailable</p>
          </div>
        )}
      </div>
    </div>
  );
}
