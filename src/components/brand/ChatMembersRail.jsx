// Right rail for group chats / DMs. Groups members by role
// (OWNER / ADMIN / MOD / MEMBERS) with status dots. Matches the design mock.
import Icon from '../Icon';
import UserAvatar from '../UserAvatar';

const ROLE_ORDER = ['Owner', 'Admin', 'Mod', 'Member'];
const ROLE_LABELS = { Owner: 'OWNER', Admin: 'ADMIN', Mod: 'MOD', Member: 'MEMBERS' };
const ROLE_COLORS = {
  Owner: 'text-brand-gold',
  Admin: 'text-brand-ember',
  Mod:   'text-brand-violet-light',
  Member: 'text-text-muted',
};

export default function ChatMembersRail({ members, onInvite, width = 260 }) {
  const list = members && members.length > 0 ? members : [];

  const byRole = {};
  for (const role of ROLE_ORDER) byRole[role] = [];
  for (const m of list) {
    const role = ROLE_ORDER.includes(m.role) ? m.role : 'Member';
    byRole[role].push(m);
  }
  const online = list.filter(m => m.online).length;

  return (
    <aside
      style={{ width: `${width}px` }}
      className="hidden lg:flex shrink-0 flex-col border-l border-white/[0.06] bg-[#0B0E1A] h-full"
    >
      <div className="px-4 pt-4 pb-3 border-b border-white/[0.04]">
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-dmmono uppercase tracking-[0.18em] text-text-muted">Members</span>
          <span className="text-[10px] font-dmmono text-brand-violet-light">{online} online</span>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto no-scrollbar px-3 py-3 space-y-4">
        {list.length === 0 ? (
          <div className="px-2 pt-6 text-center text-text-muted text-[12px]">
            <Icon name="group" size={28} className="text-text-muted/30 mx-auto mb-2" />
            No members loaded yet.
          </div>
        ) : (
          ROLE_ORDER.map(role => {
            const bucket = byRole[role];
            if (!bucket.length) return null;
            return (
              <div key={role}>
                <div className="px-2 pb-1.5 flex items-center justify-between">
                  <span className={`text-[9px] font-dmmono uppercase tracking-[0.18em] ${ROLE_COLORS[role]}`}>
                    {ROLE_LABELS[role]} — {bucket.length}
                  </span>
                </div>
                <div className="space-y-0.5">
                  {bucket.map(m => <MemberRow key={m.id} member={m} />)}
                </div>
              </div>
            );
          })
        )}
      </div>

      <div className="p-3 border-t border-white/[0.04]">
        <button
          onClick={onInvite}
          className="w-full flex items-center justify-center gap-1.5 py-2 rounded-lg bg-gradient-to-r from-brand-violet to-brand-pink text-white font-bold text-xs hover:brightness-110 shadow-lg shadow-brand-violet/30"
        >
          <Icon name="person_add" size={14} />
          Invite Members
        </button>
      </div>
    </aside>
  );
}

function MemberRow({ member }) {
  return (
    <div className="flex items-center gap-2.5 px-2 py-1.5 rounded-lg hover:bg-white/[0.04] cursor-pointer transition-colors">
      <div className="relative">
        {member.avatar
          ? <UserAvatar src={member.avatar} size={28} showTierRing={false} />
          : <div className="w-7 h-7 rounded-full bg-gradient-to-br from-brand-violet/40 to-brand-pink/20 flex items-center justify-center">
              <span className="text-[11px] font-dmmono font-bold text-white/90">{member.name[0]}</span>
            </div>
        }
        <span className={`absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full border-2 border-[#0B0E1A] ${member.online ? 'bg-green-500' : 'bg-gray-600'}`} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-[12px] font-medium text-text-primary truncate leading-tight">{member.name}</div>
        <div className="text-[10px] text-text-muted truncate">{member.status || (member.online ? 'Online' : 'Offline')}</div>
      </div>
    </div>
  );
}
