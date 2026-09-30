// Squads panel for the Messages "communication hub". Renders inside the
// MessagesMasterDetail content region (the hub rail stays pinned on the left).
// Founder spec: a squad NAV occupies the chat-list column; opening a squad
// launches the full Squads section (SquadShell) via /squads/:id.
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useUser } from '../../../context/UserContext';
import { getUserSquads } from '../../../firebase/firestore';
import { setNavOrigin } from '../../../utils/navOrigin';
import Icon from '../../../components/Icon';
import TopBar from '../../../components/TopBar';
import useResponsive from '../../../hooks/useResponsive';
import { ListSkeleton } from '../../../components/skeletons/GlassSkeletons';

const SQUAD_GRADIENTS = [
  'from-brand-ember to-red-900',
  'from-orange-500 to-orange-900',
  'from-slate-400 to-slate-800',
  'from-emerald-500 to-emerald-900',
  'from-brand-violet to-brand-pink',
  'from-brand-violet-light to-blue-900',
  'from-brand-gold to-amber-900',
  'from-fuchsia-500 to-purple-900',
];
function gradientFor(id) {
  if (!id) return SQUAD_GRADIENTS[0];
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return SQUAD_GRADIENTS[hash % SQUAD_GRADIENTS.length];
}

const NAV_ACTIONS = [
  { icon: 'search', label: 'Browse Squads', sub: 'Find a crew to join', path: '/squads' },
  { icon: 'mail', label: 'Invitations', sub: 'Pending squad invites', path: '/squads/invitations' },
  { icon: 'person_search', label: 'Find Players', sub: 'Recruit for your squad', path: '/squads/players' },
];

export default function SquadsHub() {
  const { profile } = useUser();
  const navigate = useNavigate();
  const { isDesktop } = useResponsive();
  // The squads section swaps the community rail for its own chrome, so leave a
  // breadcrumb: its "Back" button returns here instead of the home feed.
  const openSquads = (path) => {
    setNavOrigin('/squads', '/messages/hub/squads', 'Back to Community');
    navigate(path);
  };
  const [squads, setSquads] = useState([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const uid = profile?.uid;
    if (!uid) return;
    let cancelled = false;
    (async () => {
      try {
        const list = await getUserSquads(uid);
        if (!cancelled) { setSquads(list); setLoaded(true); }
      } catch {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => { cancelled = true; };
  }, [profile?.uid]);

  const listCol = (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="px-4 pt-4 pb-3 flex items-center justify-between">
        <h2 className="font-syne text-lg font-extrabold tracking-tight text-text-primary">Squads</h2>
        <button
          onClick={() => openSquads('/squads/create')}
          className="w-8 h-8 rounded-lg bg-brand-violet/15 hover:bg-brand-violet/25 text-brand-violet flex items-center justify-center"
          title="Create squad"
        >
          <Icon name="add" size={18} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto no-scrollbar px-2 pb-4">
        {/* Actions */}
        <div className="space-y-0.5 mb-4">
          {NAV_ACTIONS.map((a) => (
            <button
              key={a.path}
              onClick={() => openSquads(a.path)}
              className="w-full flex items-center gap-3 px-3 py-2 rounded-xl text-left text-text-secondary hover:bg-white/[0.04] hover:text-text-primary transition-colors"
            >
              <div className="w-[34px] h-[34px] rounded-lg bg-white/[0.05] flex items-center justify-center shrink-0">
                <Icon name={a.icon} size={17} className="text-brand-violet" />
              </div>
              <div className="min-w-0">
                <div className="text-[13px] font-semibold truncate">{a.label}</div>
                <div className="text-[10px] text-text-muted truncate">{a.sub}</div>
              </div>
            </button>
          ))}
        </div>

        {/* Your squads */}
        <div className="px-3 pb-1.5">
          <span className="text-[9px] font-dmmono uppercase tracking-[0.18em] text-text-muted">Your Squads</span>
        </div>
        {!loaded ? (
          <ListSkeleton rows={3} />
        ) : squads.length === 0 ? (
          <div className="mx-2 p-3 rounded-xl bg-white/[0.03] border border-white/[0.06]">
            <p className="text-[12px] text-text-secondary font-medium mb-1">Not in a squad yet</p>
            <p className="text-[11px] text-text-muted leading-snug mb-2.5">Team up, stream together, and share clips with your crew.</p>
            <div className="flex gap-2">
              <button onClick={() => openSquads('/squads')} className="flex-1 py-1.5 rounded-lg bg-white/[0.06] hover:bg-white/[0.1] text-text-primary text-[11px] font-bold">Browse</button>
              <button onClick={() => openSquads('/squads/create')} className="flex-1 py-1.5 rounded-lg bg-gradient-to-r from-brand-violet to-brand-pink text-white text-[11px] font-bold">Create</button>
            </div>
          </div>
        ) : (
          <div className="space-y-0.5">
            {squads.map((s) => (
              <button
                key={s.id}
                onClick={() => openSquads(`/squads/${s.id}`)}
                className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl hover:bg-white/[0.04] text-left transition-colors group"
              >
                {s.avatar ? (
                  <img src={s.avatar} alt="" className="w-[38px] h-[38px] rounded-xl object-cover shrink-0" />
                ) : (
                  <div className={`w-[38px] h-[38px] rounded-xl bg-gradient-to-br ${gradientFor(s.id)} flex items-center justify-center text-[15px] font-syne font-extrabold text-white shrink-0`}>
                    {(s.name || '?').charAt(0).toUpperCase()}
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <div className="text-[13px] font-semibold text-text-primary truncate">{s.name}</div>
                  <div className="text-[10px] font-dmmono text-text-muted">{s.memberCount || (s.memberIds?.length || 0)} members</div>
                </div>
                <Icon name="chevron_right" size={16} className="text-text-muted/50 group-hover:text-text-secondary shrink-0" />
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );

  // Mobile: the list IS the screen. This was missing entirely, so the phone got
  // the desktop two-pane layout — a 300px column squeezed against a "Pick a
  // squad" placeholder for a pane that does not exist on mobile, with dead
  // space underneath. Both sibling hub screens (CallsScreen, StatusScreen)
  // already branch this way; SquadsHub was the only one that did not.
  if (!isDesktop) {
    return (
      <div className="min-h-screen pb-20">
        <TopBar title="Squads" showBack />
        {listCol}
      </div>
    );
  }

  return (
    <div className="h-full flex">
      {/* Squad nav — sits where the chat list normally is */}
      <div className="w-[300px] h-full border-r border-white/[0.06] flex flex-col bg-[#0B0E1A] shrink-0">
        {listCol}
      </div>
      {/* Main placeholder */}
      <div className="flex-1 h-full flex flex-col items-center justify-center text-center px-8">
        <div className="w-20 h-20 rounded-3xl bg-brand-violet/10 flex items-center justify-center mb-6">
          <Icon name="groups" size={40} className="text-brand-violet" />
        </div>
        <h1 className="font-syne text-3xl font-extrabold tracking-tight text-text-primary mb-2">SQUADS</h1>
        <p className="text-text-muted text-sm max-w-xs">
          {squads.length ? 'Pick a squad to open its hub, chat, and roster.' : 'Join or create a squad to team up and hang out together.'}
        </p>
      </div>
    </div>
  );
}
