import { useNavigate } from 'react-router-dom';
import Icon from './Icon';

export default function SquadsList({ squads, loading, emptyMessage, onSquadClick }) {
  const navigate = useNavigate();

  if (loading) {
    return (
      <div className="flex flex-col items-center py-20">
        <div className="w-6 h-6 border-2 border-brand-violet border-t-transparent rounded-full animate-spin mb-4" />
        <p className="text-text-muted text-[10px] font-dmmono uppercase tracking-widest">Loading squads</p>
      </div>
    );
  }

  if (squads.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <div className="w-20 h-20 rounded-3xl bg-surface-2 border border-white/[0.06] flex items-center justify-center mb-6">
          <Icon name="groups" size={40} className="text-brand-violet-light" />
        </div>
        <h2 className="text-xl font-syne font-bold text-text-primary mb-2">No squads yet</h2>
        <p className="text-text-muted text-sm max-w-[240px] mb-8">{emptyMessage}</p>
        <div className="flex flex-col w-full gap-3 max-w-xs">
          <button
            onClick={() => navigate('/squads/discover')}
            className="w-full py-4 rounded-2xl bg-brand-violet text-white font-bold text-sm hover:brightness-110 transition-all shadow-sm shadow-black/10"
          >
            Discover Squads
          </button>
          <button
            onClick={() => navigate('/squads/create')}
            className="w-full py-4 rounded-2xl bg-surface-2 text-white border border-white/[0.06] font-bold text-sm hover:bg-surface-3 transition-all"
          >
            Create New Squad
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {squads.map(squad => (
        <button
          key={squad.id}
          onClick={() => {
            // If onSquadClick is provided, use it; otherwise fallback to default navigation
            if (onSquadClick) {
              onSquadClick(squad.id);
            } else {
              navigate(`/squads/${squad.id}`);
            }
          }}
          className="w-full flex items-center gap-4 p-4 rounded-2xl border border-white/[0.06] bg-surface-1 hover:border-white/[0.12] transition-all text-left group"
        >
          <div className="w-14 h-14 rounded-2xl bg-surface-3 flex items-center justify-center text-2xl overflow-hidden border border-white/[0.04] group-hover:border-white/[0.12]">
            {squad.image ? <img src={squad.image} className="w-full h-full object-cover" alt="" /> : squad.icon || '🎮'}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="font-bold text-text-primary truncate">{squad.name}</span>
              {!squad.isPublic && <Icon name="lock" size={14} className="text-text-muted" />}
            </div>
            <p className="text-text-muted text-[11px] font-dmmono uppercase tracking-tight">
              {squad.game} · {squad.memberCount || 0} Members
            </p>
          </div>
          <Icon name="chevron_right" size={20} className="text-text-muted group-hover:text-brand-violet-light transition-colors" />
        </button>
      ))}
    </div>
  );
}