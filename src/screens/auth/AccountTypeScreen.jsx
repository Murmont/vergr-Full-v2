import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Icon from '../../components/Icon';

export default function AccountTypeScreen() {
  const [type, setType] = useState(null);
  const navigate = useNavigate();
  const types = [
    { id: 'gamer', icon: 'gamepad-2', label: 'Gamer', desc: 'Join squads, go live, earn coins, and connect with gamers worldwide.' },
    { id: 'creator', icon: 'video', label: 'Creator', desc: 'Stream, grow your audience, monetize your content, and access creator tools.' },
  ];
  return (
    <div className="screen-container min-h-screen flex flex-col">
      <header className="flex items-center px-5 pt-12 pb-4">
        <button onClick={() => navigate(-1)} className="w-10 h-10 flex items-center justify-center text-white/80"><Icon name="arrow_back" size={24} /></button>
      </header>
      <main className="flex-1 flex flex-col px-6 pt-4 pb-8">
        <h1 className="font-syne text-text-primary text-2xl font-bold leading-tight mb-3">Choose Your<br/>Account Type</h1>
        <p className="text-text-secondary text-base mb-8">You can always change this later in settings.</p>
        <div className="flex flex-col gap-4 mb-8">
          {types.map(t => (
            <button key={t.id} onClick={() => setType(t.id)}
              className={`rounded-2xl p-5 flex items-start gap-4 text-left transition-all ${type === t.id ? 'bg-surface ring-2 ring-primary/60' : 'bg-surface/60 ring-1 ring-surface-border'}`}>
              <div className={`w-14 h-14 rounded-2xl flex items-center justify-center ${type === t.id ? 'bg-primary/10 text-primary' : 'bg-white/5 text-text-secondary'}`}>
                <Icon name={t.icon} size={26} />
              </div>
              <div className="flex-1">
                <h3 className="text-white text-lg font-bold mb-1">{t.label}</h3>
                <p className="text-text-secondary text-sm leading-relaxed">{t.desc}</p>
              </div>
              {type === t.id && <div className="shrink-0 self-center w-6 h-6 rounded-full bg-primary flex items-center justify-center"><Icon name="check" size={14} className="text-black" /></div>}
            </button>
          ))}
        </div>
        <button onClick={() => type && navigate('/setup/interests')} disabled={!type}
          className={`w-full py-4 rounded-2xl text-lg font-bold mt-auto ${type ? 'btn-primary' : 'bg-surface text-text-secondary'}`}>Continue</button>
      </main>
    </div>
  );
}
