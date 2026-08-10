// Right rail for squad chat threads — squad info card (avatar, tier, level
// bar), members list, and squad treasury. Matches the Squad Chat mock.
import Icon from '../Icon';
import UserAvatar from '../UserAvatar';

const PLACEHOLDER_MEMBERS = [
  { id: 'm1', name: 'Luna_Tc',   role: 'Owner',  online: true },
  { id: 'm2', name: 'Thunder42', role: 'Admin',  online: true },
  { id: 'm3', name: 'Raze',      role: 'Member', online: false },
  { id: 'm4', name: 'GhostRider', role: 'Member', online: true },
  { id: 'm5', name: 'Vixen',     role: 'Member', online: false },
];

export default function SquadInfoRail({
  squad = { name: 'Night Raiders', tier: 'Competitive', level: 24, xp: 62 },
  members,
  treasury = { vc: 12450, vp: 980 },
  onInvite,
  onOpenTreasury,
  width = 280,
}) {
  const memberList = members?.length ? members : PLACEHOLDER_MEMBERS;
  const online = memberList.filter(m => m.online).length;

  return (
    <aside
      style={{ width: `${width}px` }}
      className="hidden lg:flex shrink-0 flex-col gap-3 p-4 border-l border-white/[0.06] bg-[#0B0E1A] h-full overflow-y-auto no-scrollbar"
    >
      {/* Squad Info */}
      <div className="rounded-2xl bg-white/[0.03] border border-white/[0.05] p-4 text-center">
        <div className="text-[9px] font-dmmono uppercase tracking-[0.18em] text-text-muted mb-3">Squad Info</div>
        <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-brand-violet/50 to-brand-pink/30 mx-auto flex items-center justify-center mb-2">
          <span className="font-syne font-extrabold text-xl text-white/90">{squad.name[0]}</span>
        </div>
        <div className="font-syne font-extrabold text-text-primary text-base">{squad.name}</div>
        <div className="inline-block mt-1.5 px-2.5 py-0.5 rounded-full bg-brand-ember/20 text-brand-ember text-[9px] font-dmmono uppercase tracking-[0.12em]">
          {squad.tier}
        </div>
        <div className="mt-4">
          <div className="flex items-center justify-between text-[10px] font-dmmono uppercase tracking-[0.12em] text-text-muted mb-1">
            <span>Level {squad.level}</span>
            <span>{squad.xp}%</span>
          </div>
          <div className="h-1.5 rounded-full bg-white/[0.06] overflow-hidden">
            <div className="h-full bg-gradient-to-r from-brand-violet to-brand-pink" style={{ width: `${squad.xp}%` }} />
          </div>
        </div>
      </div>

      {/* Members */}
      <div className="rounded-2xl bg-white/[0.03] border border-white/[0.05] p-3">
        <div className="flex items-center justify-between px-1 pb-2">
          <span className="text-[9px] font-dmmono uppercase tracking-[0.18em] text-text-muted">Members — {memberList.length}</span>
          <span className="text-[9px] font-dmmono text-brand-violet-light">{online} online</span>
        </div>
        <div className="space-y-0.5">
          {memberList.map(m => (
            <div key={m.id} className="flex items-center gap-2.5 px-1.5 py-1.5 rounded-lg hover:bg-white/[0.04] cursor-pointer">
              <div className="relative">
                <div className="w-7 h-7 rounded-full bg-gradient-to-br from-brand-violet/40 to-brand-pink/20 flex items-center justify-center">
                  <span className="text-[11px] font-dmmono font-bold text-white/90">{m.name[0]}</span>
                </div>
                <span className={`absolute bottom-0 right-0 w-2 h-2 rounded-full border-2 border-[#0B0E1A] ${m.online ? 'bg-green-500' : 'bg-gray-600'}`} />
              </div>
              <span className="flex-1 text-[12px] text-text-primary truncate">{m.name}</span>
              {m.role !== 'Member' && (
                <span className={`text-[9px] font-dmmono uppercase ${m.role === 'Owner' ? 'text-brand-gold' : 'text-brand-ember'}`}>
                  {m.role}
                </span>
              )}
            </div>
          ))}
        </div>
        <button
          onClick={onInvite}
          className="w-full mt-2 py-1.5 rounded-lg bg-white/[0.04] hover:bg-white/[0.08] text-text-primary text-[11px] font-semibold flex items-center justify-center gap-1"
        >
          <Icon name="person_add" size={13} /> Invite Members
        </button>
      </div>

      {/* Treasury */}
      <div className="rounded-2xl bg-[#12132099] border border-white/[0.06] p-4">
        <div className="flex items-center justify-between mb-3">
          <span className="text-[10px] font-dmmono uppercase tracking-[0.14em] text-text-muted">Squad Treasury</span>
        </div>
        <div className="flex items-center gap-3 mb-3">
          <div className="flex items-center gap-1.5">
            <img src="/brand/vc-coin.webp" alt="VC" className="w-6 h-6" />
            <span className="font-dmmono font-bold text-brand-gold tabular-nums text-base">{treasury.vc.toLocaleString()}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <img src="/brand/vp-gem.webp" alt="VP" className="w-6 h-6" />
            <span className="font-dmmono font-bold text-brand-violet tabular-nums text-base">{treasury.vp.toLocaleString()}</span>
          </div>
        </div>
        <button
          onClick={onOpenTreasury}
          className="w-full py-1.5 rounded-lg bg-gradient-to-r from-brand-violet to-brand-pink text-white text-[11px] font-bold hover:brightness-110 shadow-lg shadow-brand-violet/30"
        >
          View Treasury
        </button>
      </div>
    </aside>
  );
}
