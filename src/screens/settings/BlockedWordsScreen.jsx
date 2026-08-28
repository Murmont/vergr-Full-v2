import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import Icon from '../../components/Icon';
import { useLayout } from '../../context/LayoutContext';
import useResponsive from '../../hooks/useResponsive';
export default function BlockedWordsScreen() {
  const { isDesktop } = useResponsive();
  const { setRightPanel, setContentAlign } = useLayout();

  useEffect(() => {
    setRightPanel(null);
    if (isDesktop) setContentAlign('left');
    return () => { setRightPanel(null); setContentAlign('center'); };
  }, [setRightPanel, setContentAlign, isDesktop]);
  const navigate = useNavigate();
  const [words, setWords] = useState(['toxic','spam','hate']);
  const [newWord, setNewWord] = useState('');
  const add = () => {if(newWord.trim()){setWords(p=>[...p,newWord.trim()]);setNewWord('');}};
  return (
    <div className={isDesktop ? "min-h-screen flex flex-col" : "screen-container min-h-screen flex flex-col"}>
      <header className="flex items-center gap-3 px-5 pt-12 pb-4"><button onClick={()=>navigate(-1)} className="text-white/80"><Icon name="arrow_back" size={24}/></button><h1 className="text-white font-syne font-bold text-lg">Blocked Words</h1></header>
      <main className="flex-1 px-5 pb-8">
        <p className="text-text-secondary text-sm mb-4">Messages containing these words will be hidden from your chats and comments.</p>
        <div className="flex gap-2 mb-6">
          <input value={newWord} onChange={e=>setNewWord(e.target.value)} onKeyDown={e=>e.key==='Enter'&&add()} placeholder="Add a word..." className="flex-1 bg-surface border border-surface-border rounded-xl px-4 py-3 text-white text-sm outline-none focus:border-primary"/>
          <button onClick={add} className="px-4 py-3 bg-primary text-black font-bold rounded-xl"><Icon name="add" size={18}/></button>
        </div>
        <div className="flex flex-wrap gap-2">{words.map(w=>(
          <div key={w} className="flex items-center gap-2 bg-surface px-3 py-2 rounded-full border border-surface-border">
            <span className="text-white text-sm">{w}</span>
            <button onClick={()=>setWords(p=>p.filter(x=>x!==w))}><Icon name="close" size={14} className="text-text-secondary"/></button>
          </div>))}</div>
      </main>
    </div>);
}
