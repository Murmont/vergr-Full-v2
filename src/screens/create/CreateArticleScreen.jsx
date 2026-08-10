import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useUI } from '../../context/UIContext';
import { auth } from '../../firebase/config';
import { createPost, uploadPostMedia } from '../../firebase/firestore';
import { useLayout } from '../../context/LayoutContext';
import useResponsive from '../../hooks/useResponsive';
import { useUser } from '../../context/UserContext';
import UserAvatar from '../../components/UserAvatar';
import Icon from '../../components/Icon';

export default function CreateArticleScreen() {
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [coverImage, setCoverImage] = useState(null);
  const [loading, setLoading] = useState(false);
  const fileInputRef = useRef(null);
  const { profile } = useUser();
  const { showToast } = useUI();
  const navigate = useNavigate();
  const { setRightPanel, setContentAlign } = useLayout();
  const { isDesktop } = useResponsive();

  useEffect(() => { setRightPanel(null); setContentAlign(isDesktop ? 'left' : 'center'); return () => { setRightPanel(null); setContentAlign('center'); }; }, [setRightPanel, setContentAlign, isDesktop]);

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
    <div className="min-h-screen flex flex-col bg-bg-dark">
      <header className="sticky top-0 z-40 bg-bg-dark/90 backdrop-blur-xl border-b border-white/[0.04]">
        <div className="flex items-center justify-between px-4 py-3">
          <div className="flex items-center gap-3">
            <button onClick={() => navigate(-1)} className="w-9 h-9 rounded-xl bg-surface-2 border border-white/[0.06] flex items-center justify-center text-text-secondary hover:text-white transition-colors"><Icon name="arrow_back" size={20} /></button>
            <div><h1 className="font-syne font-bold text-base text-white">Write Article</h1><p className="text-text-muted text-[10px] font-dmmono">{body.split(/\s+/).filter(Boolean).length} words · {readTime} min read</p></div>
          </div>
          <button onClick={handlePost} disabled={loading || !canPost} className="bg-brand-violet text-white px-6 py-2 rounded-full font-bold text-sm disabled:opacity-30 hover:brightness-110 active:scale-[0.97] transition-all">{loading ? <div className="w-4 h-4 border-2 border-bg-dark/30 border-t-bg-dark rounded-full animate-spin" /> : 'Publish'}</button>
        </div>
      </header>
      <div className={`flex-1 overflow-y-auto ${isDesktop ? 'max-w-3xl mx-auto w-full px-6' : 'px-4'} py-5`}>
        {coverImage ? (
          <div className="relative rounded-2xl overflow-hidden mb-6 border border-white/[0.06]"><img src={coverImage.preview} alt="" className="w-full aspect-[21/9] object-cover" /><button onClick={() => { URL.revokeObjectURL(coverImage.preview); setCoverImage(null); }} className="absolute top-3 right-3 w-8 h-8 rounded-lg bg-black/60 flex items-center justify-center text-white hover:bg-brand-ember/80 transition-colors"><Icon name="close" size={16} /></button></div>
        ) : (
          <button onClick={() => fileInputRef.current?.click()} className="w-full aspect-[21/9] rounded-2xl border-2 border-dashed border-white/[0.04] bg-surface-1/20 flex items-center justify-center gap-3 mb-6 hover:border-brand-pink/30 hover:bg-brand-pink/5 transition-all group cursor-pointer"><Icon name="add_photo_alternate" size={24} className="text-text-muted group-hover:text-brand-pink transition-colors" /><span className="text-text-muted text-sm group-hover:text-brand-pink transition-colors">Add cover image</span></button>
        )}
        <div className="flex items-start gap-3 mb-2"><UserAvatar src={profile?.avatar} size={36} className="mt-1 shrink-0" /><p className="text-brand-pink text-[10px] font-dmmono uppercase tracking-widest mt-2">Article by @{profile?.username || 'you'}</p></div>
        <input type="text" value={title} onChange={e => setTitle(e.target.value)} placeholder="Article title" className="w-full bg-transparent text-white text-2xl lg:text-3xl font-syne font-extrabold placeholder:text-text-muted/30 outline-none mb-4 leading-tight" maxLength={200} />
        <textarea value={body} onChange={e => setBody(e.target.value)} placeholder="Start writing your article... (minimum 50 characters)" className="w-full bg-transparent text-text-primary text-[15px] leading-[1.8] placeholder:text-text-muted/30 outline-none resize-none min-h-[400px]" />
        {!canPost && title.trim().length > 0 && <div className="mt-4 px-3 py-2 rounded-xl bg-brand-gold/10 border border-brand-gold/20 text-brand-gold text-xs">{title.trim().length < 5 ? 'Title needs at least 5 characters' : `${Math.max(0, 50 - body.trim().length)} more characters needed`}</div>}
      </div>
      <input type="file" ref={fileInputRef} onChange={(e) => { const f = e.target.files?.[0]; if (f) setCoverImage({ file: f, preview: URL.createObjectURL(f) }); e.target.value = ''; }} className="hidden" accept="image/*" />
    </div>
  );
}
