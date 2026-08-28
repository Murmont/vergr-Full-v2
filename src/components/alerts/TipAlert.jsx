import Icon from '../Icon';
import UserAvatar from '../UserAvatar';

export default function TipAlert({ username = 'PixelQueen', tier = 'Diamond', amount = 100, message = '', variant = 'compact', onClose }) {
  if (variant === 'legendary') {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
        <div className="bg-surface border border-primary/30 rounded-2xl p-6 max-w-[340px] w-full text-center relative overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-b from-primary/5 to-transparent pointer-events-none" />
          <button onClick={onClose} className="absolute top-4 right-4 text-text-secondary z-10"><Icon name="close" size={18} /></button>
          <div className="relative z-10">
            <div className="text-4xl mb-3">🔥</div>
            <p className="text-primary text-xs font-bold uppercase tracking-widest mb-2">Legendary Tip</p>
            <UserAvatar username={username} tier={tier} size={56} />
            <p className="text-white font-bold text-lg mt-3">@{username}</p>
            <div className="flex items-center justify-center gap-2 my-4">
              <Icon name="paid" size={24} className="text-yellow-400" />
              <span className="text-yellow-400 text-4xl font-bold font-mono">{amount.toLocaleString()}</span>
            </div>
            {message && <p className="text-white/80 text-sm bg-surface-border/50 rounded-xl p-3 italic">"{message}"</p>}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed top-16 left-1/2 -translate-x-1/2 z-50 animate-slide-down">
      <div className="bg-surface border border-primary/20 rounded-2xl px-4 py-3 flex items-center gap-3 shadow-xl shadow-black/40 min-w-[300px]">
        <UserAvatar username={username} tier={tier} size={36} />
        <div className="flex-1">
          <p className="text-white text-sm font-semibold">@{username}</p>
          <p className="text-primary text-xs font-bold flex items-center gap-1"><Icon name="paid" size={12} /> Tipped {amount} coins</p>
        </div>
        <button onClick={onClose} className="text-text-secondary"><Icon name="close" size={16} /></button>
      </div>
    </div>
  );
}
