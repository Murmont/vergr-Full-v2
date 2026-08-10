import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useUI } from '../../context/UIContext';
import { auth } from '../../firebase/config';
import { createPost } from '../../firebase/firestore';
import { useLayout } from '../../context/LayoutContext';
import useResponsive from '../../hooks/useResponsive';
import Icon from '../../components/Icon';

const PLATFORMS = ['PC', 'PlayStation', 'Xbox', 'Nintendo', 'Mobile', 'Any'];
const REGIONS = ['NA East', 'NA West', 'EU West', 'EU East', 'Asia', 'Oceania', 'South America', 'Any'];
const GAMES = ['Valorant', 'Fortnite', 'Apex Legends', 'League of Legends', 'CS2', 'Overwatch 2', 'Rocket League', 'Call of Duty', 'Minecraft', 'Other'];

export default function CreateLFGScreen() {
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
  const { setRightPanel, setContentAlign } = useLayout();
  const { isDesktop } = useResponsive();

  useEffect(() => { setRightPanel(null); setContentAlign(isDesktop ? 'left' : 'center'); return () => { setRightPanel(null); setContentAlign('center'); }; }, [setRightPanel, setContentAlign, isDesktop]);

  const finalGame = game === 'Other' ? customGame.trim() : game;
  const canPost = finalGame && platform && region;

  const handlePost = async () => {
    if (!canPost || loading) return;
    setLoading(true);
    try { await createPost(auth.currentUser.uid, { content: note.trim() || `LFG — ${finalGame} on ${platform}`, type: 'lfg', lfgData: { game: finalGame, platform, region, rank: rank.trim() || null, mic, playersNeeded: parseInt(playersNeeded) || null }, hashtags: ['lfg', finalGame.toLowerCase().replace(/\s+/g, '')] }); showToast('LFG posted!', 'success'); navigate(-1); }
    catch (err) { console.error(err); showToast('Failed to post', 'error'); }
    setLoading(false);
  };

  const Chip = ({ label, selected, onClick, color = 'brand-violet' }) => (<button onClick={onClick} className={`px-3.5 py-2 rounded-xl text-xs font-bold transition-all ${selected ? `bg-${color}/15 border border-${color}/40 text-${color}` : 'bg-surface-2 border border-white/[0.06] text-text-muted hover:text-text-secondary hover:border-white/10'}`}>{label}</button>);

  return (
    <div className="min-h-screen flex flex-col bg-bg-dark">
      <header className="sticky top-0 z-40 bg-bg-dark/90 backdrop-blur-xl border-b border-white/[0.04]">
        <div className="flex items-center justify-between px-4 py-3">
          <div className="flex items-center gap-3"><button onClick={() => navigate(-1)} className="w-9 h-9 rounded-xl bg-surface-2 border border-white/[0.06] flex items-center justify-center text-text-secondary hover:text-white transition-colors"><Icon name="arrow_back" size={20} /></button><h1 className="font-syne font-bold text-base text-white">Looking for Group</h1></div>
          <button onClick={handlePost} disabled={loading || !canPost} className="bg-brand-violet text-white px-6 py-2 rounded-full font-bold text-sm disabled:opacity-30 hover:brightness-110 active:scale-[0.97] transition-all">{loading ? <div className="w-4 h-4 border-2 border-bg-dark/30 border-t-bg-dark rounded-full animate-spin" /> : 'Post'}</button>
        </div>
      </header>
      <div className={`flex-1 overflow-y-auto px-4 py-5 ${isDesktop ? 'max-w-2xl' : ''}`}>
        <div className="space-y-6">
          <div><label className="text-text-secondary text-[10px] uppercase tracking-widest font-bold mb-2.5 block">Game *</label><div className="flex flex-wrap gap-2">{GAMES.map(g => <Chip key={g} label={g} selected={game === g} onClick={() => setGame(g)} />)}</div>{game === 'Other' && <input type="text" value={customGame} onChange={e => setCustomGame(e.target.value)} placeholder="Enter game name..." className="mt-3 w-full bg-surface-2 border border-white/[0.06] rounded-xl p-3.5 text-text-primary text-sm placeholder:text-text-muted focus:border-brand-violet focus:outline-none" />}</div>
          <div><label className="text-text-secondary text-[10px] uppercase tracking-widest font-bold mb-2.5 block">Platform *</label><div className="flex flex-wrap gap-2">{PLATFORMS.map(p => <Chip key={p} label={p} selected={platform === p} onClick={() => setPlatform(p)} color="brand-violet" />)}</div></div>
          <div><label className="text-text-secondary text-[10px] uppercase tracking-widest font-bold mb-2.5 block">Region *</label><div className="flex flex-wrap gap-2">{REGIONS.map(r => <Chip key={r} label={r} selected={region === r} onClick={() => setRegion(r)} color="brand-gold" />)}</div></div>
          <div className={isDesktop ? 'grid grid-cols-2 gap-4' : 'space-y-6'}>
            <div><label className="text-text-secondary text-[10px] uppercase tracking-widest font-bold mb-2.5 block">Rank (optional)</label><input type="text" value={rank} onChange={e => setRank(e.target.value)} placeholder="e.g. Diamond, Gold III..." className="w-full bg-surface-2 border border-white/[0.06] rounded-xl p-3.5 text-text-primary text-sm placeholder:text-text-muted focus:border-brand-violet focus:outline-none" /></div>
            <div><label className="text-text-secondary text-[10px] uppercase tracking-widest font-bold mb-2.5 block">Players needed</label><input type="number" min="1" max="99" value={playersNeeded} onChange={e => setPlayersNeeded(e.target.value)} placeholder="e.g. 2" className="w-full bg-surface-2 border border-white/[0.06] rounded-xl p-3.5 text-text-primary text-sm placeholder:text-text-muted focus:border-brand-violet focus:outline-none" /></div>
          </div>
          <div><label className="text-text-secondary text-[10px] uppercase tracking-widest font-bold mb-2.5 block">Mic required?</label><div className="flex gap-2">{[{ val: true, label: 'Mic required', icon: 'mic' }, { val: false, label: 'No mic needed', icon: 'mic_off' }].map(opt => (<button key={String(opt.val)} onClick={() => setMic(opt.val)} className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-xl text-xs font-bold transition-all ${mic === opt.val ? 'bg-brand-violet/15 border border-brand-violet/40 text-brand-violet-light' : 'bg-surface-2 border border-white/[0.06] text-text-muted'}`}><Icon name={opt.icon} size={16} />{opt.label}</button>))}</div></div>
          <div><label className="text-text-secondary text-[10px] uppercase tracking-widest font-bold mb-2.5 block">Note (optional)</label><textarea value={note} onChange={e => setNote(e.target.value)} placeholder="Any extra info..." className="w-full bg-surface-2 border border-white/[0.06] rounded-xl p-3.5 text-text-primary text-sm placeholder:text-text-muted focus:border-brand-violet focus:outline-none resize-none min-h-[80px]" maxLength={300} /></div>
        </div>
      </div>
    </div>
  );
}
