import Icon from '../Icon';

export default function StreamAlert({ type = 'follow', username = 'GhostSniper', amount, message, onClose }) {
  const configs = {
    follow: { icon: 'user-plus', color: 'text-primary', bg: 'bg-primary/10', text: 'just followed!' },
    tip: { icon: 'coins', color: 'text-yellow-400', bg: 'bg-yellow-400/10', text: `tipped ${amount || 0} coins!` },
    sub: { icon: 'crown', color: 'text-purple-400', bg: 'bg-purple-400/10', text: 'just subscribed!' },
    raid: { icon: 'users', color: 'text-red-400', bg: 'bg-red-400/10', text: `is raiding with ${amount || 0} viewers!` },
  };
  const c = configs[type] || configs.follow;

  return (
    <div className="fixed top-20 left-1/2 -translate-x-1/2 z-50 animate-slide-down">
      <div className={`${c.bg} border border-surface-border rounded-2xl px-5 py-3 flex items-center gap-3 shadow-xl shadow-black/40 min-w-[300px]`}>
        <div className={`w-10 h-10 rounded-full bg-surface flex items-center justify-center ${c.color}`}>
          <Icon name={c.icon} size={20} />
        </div>
        <div className="flex-1">
          <p className="text-white text-sm font-bold">@{username}</p>
          <p className={`text-xs font-semibold ${c.color}`}>{c.text}</p>
          {message && <p className="text-white/60 text-xs mt-1 italic">"{message}"</p>}
        </div>
        {onClose && <button onClick={onClose} className="text-text-secondary"><Icon name="close" size={16} /></button>}
      </div>
    </div>
  );
}
