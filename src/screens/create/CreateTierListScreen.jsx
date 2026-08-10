import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useUI } from '../../context/UIContext';
import { auth } from '../../firebase/config';
import { createPost } from '../../firebase/firestore';
import { useLayout } from '../../context/LayoutContext';
import useResponsive from '../../hooks/useResponsive';
import Icon from '../../components/Icon';

const DEFAULT_TIERS = [
  { id: 's', label: 'S', color: '#FF4D6A', items: [] },
  { id: 'a', label: 'A', color: '#F5C542', items: [] },
  { id: 'b', label: 'B', color: '#B44FFF', items: [] },
  { id: 'c', label: 'C', color: '#7B6FFF', items: [] },
  { id: 'd', label: 'D', color: '#3D4260', items: [] },
];

export default function CreateTierListScreen() {
  const [title, setTitle] = useState('');
  const [tiers, setTiers] = useState(DEFAULT_TIERS.map(t => ({ ...t, items: [] })));
  const [newItem, setNewItem] = useState('');
  const [unranked, setUnranked] = useState([]);
  const [loading, setLoading] = useState(false);
  const { showToast } = useUI();
  const navigate = useNavigate();
  const { setRightPanel, setContentAlign } = useLayout();
  const { isDesktop } = useResponsive();

  useEffect(() => { setRightPanel(null); setContentAlign(isDesktop ? 'left' : 'center'); return () => { setRightPanel(null); setContentAlign('center'); }; }, [setRightPanel, setContentAlign, isDesktop]);

  const addItem = () => { const v = newItem.trim(); if (!v) return; setUnranked(prev => [...prev, { id: Math.random().toString(36).slice(2, 8), label: v }]); setNewItem(''); };
  const moveToTier = (item, tierId) => { setUnranked(p => p.filter(i => i.id !== item.id)); setTiers(p => p.map(t => ({ ...t, items: t.items.filter(i => i.id !== item.id) }))); setTiers(p => p.map(t => t.id === tierId ? { ...t, items: [...t.items, item] } : t)); };
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
    return (<div className="relative">
      <button onClick={() => setOpen(!open)} className="px-3 py-1.5 rounded-lg bg-surface-2 border border-white/[0.06] text-text-primary text-xs font-semibold hover:border-white/20 transition-all">{item.label}</button>
      {open && <div className="absolute top-full left-0 mt-1 z-50 bg-surface-1 border border-white/[0.06] rounded-xl shadow-xl overflow-hidden min-w-[120px]">
        {tierOptions?.map(t => (<button key={t.id} onClick={() => { onMove(item, t.id); setOpen(false); }} className="w-full px-3 py-2 text-left text-xs font-bold hover:bg-surface-2 transition-colors flex items-center gap-2"><div className="w-3 h-3 rounded-sm" style={{ background: t.color }} />{t.label} Tier</button>))}
        {onRemove && <button onClick={() => { onRemove(item); setOpen(false); }} className="w-full px-3 py-2 text-left text-xs text-brand-ember hover:bg-brand-ember/10 transition-colors">Remove</button>}
      </div>}
    </div>);
  };

  return (
    <div className="min-h-screen flex flex-col bg-bg-dark">
      <header className="sticky top-0 z-40 bg-bg-dark/90 backdrop-blur-xl border-b border-white/[0.04]">
        <div className="flex items-center justify-between px-4 py-3">
          <div className="flex items-center gap-3"><button onClick={() => navigate(-1)} className="w-9 h-9 rounded-xl bg-surface-2 border border-white/[0.06] flex items-center justify-center text-text-secondary hover:text-white transition-colors"><Icon name="arrow_back" size={20} /></button><h1 className="font-syne font-bold text-base text-white">Tier List</h1></div>
          <button onClick={handlePost} disabled={loading || !canPost} className="bg-brand-violet text-white px-6 py-2 rounded-full font-bold text-sm disabled:opacity-30 hover:brightness-110 active:scale-[0.97] transition-all">{loading ? <div className="w-4 h-4 border-2 border-bg-dark/30 border-t-bg-dark rounded-full animate-spin" /> : 'Post'}</button>
        </div>
      </header>
      <div className={`flex-1 overflow-y-auto px-4 py-5 ${isDesktop ? 'max-w-3xl' : ''}`}>
        <input type="text" value={title} onChange={e => setTitle(e.target.value)} placeholder="What are you ranking?" className="w-full bg-transparent text-white text-xl font-syne font-bold placeholder:text-text-muted/30 outline-none mb-6" maxLength={100} />
        <div className="flex gap-2 mb-6">
          <input type="text" value={newItem} onChange={e => setNewItem(e.target.value)} onKeyDown={e => e.key === 'Enter' && addItem()} placeholder="Add an item to rank..." className="flex-1 bg-surface-2 border border-white/[0.06] rounded-xl px-4 py-3 text-text-primary text-sm placeholder:text-text-muted focus:border-brand-violet focus:outline-none" />
          <button onClick={addItem} disabled={!newItem.trim()} className="px-4 py-3 rounded-xl bg-brand-violet/15 border border-brand-violet/30 text-brand-violet font-bold text-sm disabled:opacity-30 hover:bg-brand-violet/25 transition-colors">Add</button>
        </div>
        {unranked.length > 0 && <div className="mb-6"><p className="text-text-muted text-[10px] uppercase tracking-widest font-bold mb-2">Unranked ({unranked.length})</p><div className="flex flex-wrap gap-2 p-3 rounded-xl bg-surface-1/50 border border-white/[0.04] min-h-[48px]">{unranked.map(item => <ItemChip key={item.id} item={item} onRemove={removeItem} onMove={moveToTier} tierOptions={tiers} />)}</div></div>}
        <div className="space-y-2">
          {tiers.map(tier => (
            <div key={tier.id} className="flex items-stretch gap-2 min-h-[56px]">
              <div className="w-14 shrink-0 rounded-xl flex items-center justify-center font-syne font-black text-lg text-white" style={{ background: `${tier.color}25`, borderLeft: `3px solid ${tier.color}` }}>{tier.label}</div>
              <div className="flex-1 flex flex-wrap gap-1.5 items-center p-2.5 rounded-xl bg-surface-1/30 border border-white/[0.04] min-h-[48px]">
                {tier.items.length === 0 ? <span className="text-text-muted/30 text-xs px-2">Tap items above to place here</span> : tier.items.map(item => (
                  <button key={item.id} onClick={() => moveToUnranked(item)} className="px-3 py-1.5 rounded-lg text-xs font-semibold text-white hover:opacity-70 transition-opacity" style={{ background: `${tier.color}30`, border: `1px solid ${tier.color}50` }}>{item.label}</button>
                ))}
              </div>
            </div>
          ))}
        </div>
        {!canPost && (unranked.length + rankedItems) > 0 && <p className="text-text-muted text-xs mt-4 text-center">Rank at least 3 items to post</p>}
      </div>
    </div>
  );
}
