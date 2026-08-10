import React, { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useUI } from '../../context/UIContext';
import { auth } from '../../firebase/config';
import { createPost, uploadPostMedia } from '../../firebase/firestore';
import { useLayout } from '../../context/LayoutContext';
import useResponsive from '../../hooks/useResponsive';
import Icon from '../../components/Icon';

const TYPES = [
  { id: 'win', label: 'Victory / Win', icon: 'emoji_events', color: '#F5C542' },
  { id: 'rank', label: 'Rank Up', icon: 'military_tech', color: '#B44FFF' },
  { id: 'milestone', label: 'Milestone', icon: 'flag', color: '#7B6FFF' },
  { id: 'record', label: 'Personal Record', icon: 'speed', color: '#FF4D6A' },
  { id: 'unlock', label: 'Unlock / Trophy', icon: 'lock_open', color: '#C87FFF' },
  { id: 'other', label: 'Other', icon: 'star', color: '#F5C542' },
];

export default function CreateAchievementScreen() {
  const [achievementType, setAchievementType] = useState('');
  const [game, setGame] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [screenshot, setScreenshot] = useState(null);
  const [loading, setLoading] = useState(false);
  const fileInputRef = useRef(null);
  const { showToast } = useUI();
  const navigate = useNavigate();
  const { setRightPanel, setContentAlign } = useLayout();
  const { isDesktop } = useResponsive();

  useEffect(() => { setRightPanel(null); setContentAlign(isDesktop ? 'left' : 'center'); return () => { setRightPanel(null); setContentAlign('center'); }; }, [setRightPanel, setContentAlign, isDesktop]);

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
    <div className="min-h-screen flex flex-col bg-bg-dark">
      <header className="sticky top-0 z-40 bg-bg-dark/90 backdrop-blur-xl border-b border-white/[0.04]">
        <div className="flex items-center justify-between px-4 py-3">
          <div className="flex items-center gap-3"><button onClick={() => navigate(-1)} className="w-9 h-9 rounded-xl bg-surface-2 border border-white/[0.06] flex items-center justify-center text-text-secondary hover:text-white transition-colors"><Icon name="arrow_back" size={20} /></button><h1 className="font-syne font-bold text-base text-white">Achievement</h1></div>
          <button onClick={handlePost} disabled={loading || !canPost} className="bg-brand-violet text-white px-6 py-2 rounded-full font-bold text-sm disabled:opacity-30 hover:brightness-110 active:scale-[0.97] transition-all">{loading ? <div className="w-4 h-4 border-2 border-bg-dark/30 border-t-bg-dark rounded-full animate-spin" /> : 'Share'}</button>
        </div>
      </header>
      <div className={`flex-1 overflow-y-auto px-4 py-5 ${isDesktop ? 'max-w-2xl' : ''}`}>
        <div className="space-y-6">
          <div><label className="text-text-secondary text-[10px] uppercase tracking-widest font-bold mb-2.5 block">What did you achieve? *</label>
            <div className="grid grid-cols-3 gap-2">{TYPES.map(type => (
              <button key={type.id} onClick={() => setAchievementType(type.id)} className={`flex flex-col items-center gap-1.5 p-3 rounded-xl text-xs font-bold transition-all ${achievementType === type.id ? 'border-2' : 'bg-surface-2 border border-white/[0.06] text-text-muted'}`}
                style={achievementType === type.id ? { background: `${type.color}15`, borderColor: `${type.color}60`, color: type.color } : {}}><Icon name={type.icon} size={22} /><span className="text-[10px]">{type.label}</span></button>
            ))}</div>
          </div>
          <div><label className="text-text-secondary text-[10px] uppercase tracking-widest font-bold mb-2.5 block">Game (optional)</label><input type="text" value={game} onChange={e => setGame(e.target.value)} placeholder="Which game?" className="w-full bg-surface-2 border border-white/[0.06] rounded-xl p-3.5 text-text-primary text-sm placeholder:text-text-muted focus:border-brand-violet focus:outline-none" /></div>
          <div><label className="text-text-secondary text-[10px] uppercase tracking-widest font-bold mb-2.5 block">Achievement title *</label><input type="text" value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. Hit Diamond for the first time" className="w-full bg-surface-2 border border-white/[0.06] rounded-xl p-3.5 text-text-primary text-sm placeholder:text-text-muted focus:border-brand-violet focus:outline-none" maxLength={100} /></div>
          <div><label className="text-text-secondary text-[10px] uppercase tracking-widest font-bold mb-2.5 block">Tell the story (optional)</label><textarea value={description} onChange={e => setDescription(e.target.value)} placeholder="How did it happen?" className="w-full bg-surface-2 border border-white/[0.06] rounded-xl p-3.5 text-text-primary text-sm placeholder:text-text-muted focus:border-brand-violet focus:outline-none resize-none min-h-[100px]" maxLength={500} /></div>
          <div><label className="text-text-secondary text-[10px] uppercase tracking-widest font-bold mb-2.5 block">Proof (optional)</label>
            {screenshot ? (
              <div className="relative rounded-2xl overflow-hidden border border-white/[0.06]"><img src={screenshot.preview} alt="" className="w-full max-h-[300px] object-cover" /><button onClick={() => { URL.revokeObjectURL(screenshot.preview); setScreenshot(null); }} className="absolute top-2 right-2 w-8 h-8 rounded-lg bg-black/60 flex items-center justify-center text-white hover:bg-brand-ember/80 transition-colors"><Icon name="close" size={16} /></button></div>
            ) : (
              <button onClick={() => fileInputRef.current?.click()} className="w-full py-8 rounded-xl border-2 border-dashed border-white/[0.04] bg-surface-1/20 flex flex-col items-center gap-2 hover:border-brand-gold/30 hover:bg-brand-gold/5 transition-all group cursor-pointer"><Icon name="add_photo_alternate" size={28} className="text-text-muted group-hover:text-brand-gold transition-colors" /><span className="text-text-muted text-xs group-hover:text-brand-gold transition-colors">Add screenshot</span></button>
            )}
          </div>
        </div>
      </div>
      <input type="file" ref={fileInputRef} onChange={(e) => { const f = e.target.files?.[0]; if (f) setScreenshot({ file: f, preview: URL.createObjectURL(f) }); e.target.value = ''; }} className="hidden" accept="image/*" />
    </div>
  );
}
