import { useState, useEffect, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate, useLocation } from 'react-router-dom';
import { useUser } from '../context/UserContext';
import { useNotifications } from '../context/NotificationContext';
import { getUserSquads } from '../firebase/firestore';
import Icon from './Icon';
import UserAvatar from './UserAvatar';
import CreateComposer from './composer/CreateComposer';
import { VPIcon } from './CoinIcon';
import { CoinBalancePill } from './wallet/CoinQuickBuy';
import { getVPLevel, getVPProgress, getNextVPLevel } from '../utils/vpSystem';
import { resolveNavForPath, findActiveItem, MAIN_NAV } from '../config/navConfig';

// Deterministic-ish gradient per squad id so each squad keeps the same
// chip color across renders even though we don't store a color on the doc.
const SQUAD_GRADIENTS = [
  'from-brand-ember to-red-900',
  'from-orange-500 to-orange-900',
  'from-slate-400 to-slate-800',
  'from-emerald-500 to-emerald-900',
  'from-brand-violet to-brand-pink',
  'from-brand-violet to-blue-900',
  'from-brand-gold to-amber-900',
  'from-fuchsia-500 to-purple-900',
];
function gradientFor(id) {
  if (!id) return SQUAD_GRADIENTS[0];
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return SQUAD_GRADIENTS[hash % SQUAD_GRADIENTS.length];
}

// Color-coded unread badges. Each category gets its own hue so the user can
// tell them apart at a glance (founder request).
const BADGE_COLORS = {
  red:    { bg: 'bg-brand-ember',   text: 'text-white' }, // DMs + groups
  purple: { bg: 'bg-brand-violet',  text: 'text-white' }, // squad chat + notifications
  green:  { bg: 'bg-success-green', text: 'text-black' }, // missed calls
  amber:  { bg: 'bg-brand-gold',    text: 'text-black' }, // message requests
};
const BADGE_ORDER = ['red', 'purple', 'green', 'amber'];

// Numbered pill (expanded rail / flyout rows).
function CountPill({ n, color }) {
  if (!n) return null;
  const c = BADGE_COLORS[color] || BADGE_COLORS.red;
  return (
    <span className={`min-w-[16px] h-4 px-1 rounded-full flex items-center justify-center text-[9px] font-black tabular-nums leading-none ${c.bg} ${c.text}`}>
      {n > 99 ? '99+' : n}
    </span>
  );
}

// Bare colored dot (collapsed rail — no room for numbers).
function Dot({ color }) {
  const c = BADGE_COLORS[color] || BADGE_COLORS.red;
  return <span className={`w-2 h-2 rounded-full ring-2 ring-[#0F0F1A] ${c.bg}`} />;
}

// Contextual left-rail. Main nav uses standalone items + flyout categories;
// sub-rails (Tournaments/Squads/etc) fall back to flat rendering.
export default function DesktopSidebar() {
  const navigate = useNavigate();
  const location = useLocation();
  const { profile, wallet } = useUser();
  const sbVp = wallet?.vp || 0;
  const sbVpLevel = getVPLevel(sbVp);
  const sbVpProgress = getVPProgress(sbVp);
  const sbVpNext = getNextVPLevel(sbVp);
  const { unreadChatCount, unreadNotifCount, requestCount, squadUnreadCount, missedCallCount } = useNotifications();
  // Color-coded unread for the "Community" nav entry (founder): DMs+groups red,
  // squad chat+notifications purple, missed calls green, message requests amber.
  const communityCounts = {
    red: unreadChatCount || 0,
    purple: (unreadNotifCount || 0) + (squadUnreadCount || 0),
    green: missedCallCount || 0,
    amber: requestCount || 0,
  };
  // Per-item badge for the Community flyout (each sub-item's own count).
  const flyoutBadge = (path) => {
    if (path === '/messages') return communityCounts.red ? { n: communityCounts.red, color: 'red' } : null;
    if (path === '/calls' || path === '/messages/hub/calls') return communityCounts.green ? { n: communityCounts.green, color: 'green' } : null;
    if (path === '/squads' || path === '/messages/hub/squads') return squadUnreadCount ? { n: squadUnreadCount, color: 'purple' } : null;
    return null;
  };
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [flyout, setFlyout] = useState(null); // { group, top, left }
  const closeTimer = useRef(null);

  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem('vergr_sidebar_collapsed') === '1'; } catch { return false; }
  });

  // Real squads the current user is in. Empty → render a "join or create"
  // CTA instead of a hardcoded list.
  const [userSquads, setUserSquads] = useState([]);
  const [squadsLoaded, setSquadsLoaded] = useState(false);
  useEffect(() => {
    const uid = profile?.uid;
    if (!uid) return;
    let cancelled = false;
    (async () => {
      try {
        const list = await getUserSquads(uid);
        if (!cancelled) {
          setUserSquads(list);
          setSquadsLoaded(true);
        }
      } catch (err) {
        console.warn('Sidebar: failed to load user squads', err.message);
        if (!cancelled) setSquadsLoaded(true);
      }
    })();
    return () => { cancelled = true; };
  }, [profile?.uid]);

  const toggleCollapsed = () => {
    const next = !collapsed;
    setCollapsed(next);
    try { localStorage.setItem('vergr_sidebar_collapsed', next ? '1' : '0'); } catch {}
    window.dispatchEvent(new CustomEvent('sidebar-toggle', { detail: { collapsed: next } }));
  };

  useEffect(() => {
    window.dispatchEvent(new CustomEvent('sidebar-toggle', { detail: { collapsed } }));
  }, [collapsed]);

  // Founder: the left nav opens COLLAPSED on the messages page (more room for
  // the chat list + contact-info drawer). Non-destructive — we don't touch the
  // saved global preference, so leaving messages restores whatever they had.
  // The collapse toggle still works while on messages.
  const onMessages = location.pathname === '/messages' || location.pathname.startsWith('/messages/');
  useEffect(() => {
    if (onMessages) {
      setCollapsed(true);
    } else {
      try { setCollapsed(localStorage.getItem('vergr_sidebar_collapsed') === '1'); } catch {}
    }
  }, [onMessages]);

  const nav = useMemo(() => resolveNavForPath(location.pathname), [location.pathname]);
  const activeItem = useMemo(() => findActiveItem(nav, location.pathname), [nav, location.pathname]);
  const isMain = nav.id === MAIN_NAV.id;

  const openFlyout = (group, e) => {
    if (collapsed) return;
    clearTimeout(closeTimer.current);
    const rect = e.currentTarget.getBoundingClientRect();
    setFlyout({ group, top: rect.top, left: rect.right + 6 });
  };
  const closeFlyout = () => {
    closeTimer.current = setTimeout(() => setFlyout(null), 120);
  };
  const keepFlyout = () => clearTimeout(closeTimer.current);

  const W = collapsed ? 'w-[72px]' : 'w-[240px]';

  // ─── Standalone nav button (first group, no header) ─────────────
  const NavBtn = ({ item }) => {
    const active = activeItem?.path === item.path;
    const badge = item.path === '/messages' ? unreadChatCount : 0;
    // Glossy 3D img icons (Messages hub, Figma) get a glass active pill with a
    // violet glow instead of the flat fill + borderRight used elsewhere.
    const glossy = !!item.img;
    const stateCls = glossy
      ? (active ? 'text-white' : 'text-text-secondary hover:bg-white/[0.04] hover:text-text-primary')
      : (active ? 'bg-[#1E1035] text-white' : 'text-text-secondary hover:bg-[#1A1A2A] hover:text-text-primary');
    // Active = real frosted glass: neutral translucent fill + backdrop blur +
    // a light top-sheen rim, wrapped in a PURPLE GLOW (outer box-shadows). The
    // purple lives in the glow, not the fill — the fill stays glass-neutral.
    const styleObj = glossy
      ? (active
          ? {
              background: 'rgba(255,255,255,0.06)',
              boxShadow: '0 0 0 1px rgba(180,79,255,0.60), 0 0 18px 2px rgba(138,18,202,0.55), 0 0 40px rgba(123,31,255,0.30), inset 0 1px 0 rgba(255,255,255,0.12)',
            }
          : undefined)
      : (active ? { borderRight: '2px solid #B44FFF' } : undefined);
    return (
      <button
        onClick={() => navigate(item.path)}
        title={collapsed ? item.label : undefined}
        className={`w-full flex items-center rounded-xl transition-all duration-150 group relative ${
          glossy && active ? 'backdrop-blur-md' : ''
        } ${
          collapsed ? 'justify-center py-2.5 px-0' : `gap-3 px-3 ${glossy ? 'py-2.5' : 'py-2'}`
        } ${stateCls}`}
        style={styleObj}
      >
        {/* Active indicator: glossy = glass glow pill (styleObj), others = the
            static borderRight. No framer-motion layoutId (it slid on hover). */}
        <div className="relative shrink-0">
          {glossy ? (
            <img
              src={item.img}
              alt=""
              draggable={false}
              className={collapsed ? 'w-9 h-9' : 'w-8 h-8'}
              style={active ? { filter: 'drop-shadow(0 0 7px rgba(138,18,202,0.6))' } : undefined}
            />
          ) : (
            <Icon name={item.icon} filled={active} size={20} />
          )}
          {badge > 0 && (
            <span className="absolute -top-1.5 -right-1.5 min-w-[16px] h-4 bg-brand-ember rounded-full flex items-center justify-center text-[9px] font-black text-white px-1">
              {badge > 99 ? '99+' : badge}
            </span>
          )}
        </div>
        {!collapsed && (
          <span className={`${glossy ? 'text-[14px]' : 'text-[13px]'} tracking-tight ${active ? 'font-bold' : 'font-medium'}`}>
            {item.label}
          </span>
        )}
      </button>
    );
  };

  // ─── Category button (flyout parent) ────────────────────────────
  const CatBtn = ({ group }) => {
    const catActive = group.items.some(i => i.path === activeItem?.path);
    // Pick an icon per category header
    const catIcons = { Community: 'groups', Compete: 'emoji_events', You: 'person' };
    const catIcon = catIcons[group.header] || 'more_horiz';
    // Community carries the color-coded unread cluster.
    const isCommunity = group.header === 'Community';
    const activeColors = isCommunity ? BADGE_ORDER.filter(k => communityCounts[k] > 0) : [];
    return (
      <button
        onMouseEnter={(e) => openFlyout(group, e)}
        onMouseLeave={closeFlyout}
        onClick={() => navigate(group.items[0].path)}
        title={collapsed ? group.header : undefined}
        className={`w-full flex items-center rounded-lg transition-all duration-150 relative ${
          collapsed ? 'justify-center py-2.5 px-0' : 'gap-3 px-3 py-2'
        } ${
          catActive
            ? 'bg-[#1E1035] text-white'
            : 'text-text-secondary hover:bg-[#1A1A2A] hover:text-text-primary'
        }`}
        style={catActive ? { borderRight: '2px solid #B44FFF' } : undefined}
      >
        {catActive && !collapsed && (
          <div className="absolute right-0 top-0 bottom-0 w-[2px] bg-[#B44FFF]" />
        )}
        <div className="relative shrink-0">
          <Icon name={catIcon} size={20} />
          {/* Collapsed rail: colored dots stacked on the icon corner. */}
          {collapsed && activeColors.length > 0 && (
            <span className="absolute -top-1.5 -right-1.5 flex gap-0.5">
              {activeColors.slice(0, 3).map(k => <Dot key={k} color={k} />)}
            </span>
          )}
        </div>
        {!collapsed && (
          <>
            <span className={`text-[13px] tracking-tight flex-1 text-left ${catActive ? 'font-bold' : 'font-medium'}`}>
              {group.header}
            </span>
            {/* Expanded rail: numbered color-coded pills. */}
            {activeColors.length > 0 && (
              <span className="flex items-center gap-1 mr-0.5">
                {activeColors.map(k => <CountPill key={k} n={communityCounts[k]} color={k} />)}
              </span>
            )}
            <Icon name="chevron_right" size={14} className="text-text-muted/60" />
          </>
        )}
      </button>
    );
  };

  return (
    <>
      <aside className={`fixed left-0 top-0 bottom-0 ${W} bg-[#0F0F1A] border-r border-[#1E1E2E] flex flex-col z-50 transition-all duration-200`}>
        {/* Brand header */}
        <button
          onClick={() => navigate('/')}
          className={`flex items-center gap-2.5 px-4 py-4 border-b border-white/[0.04] hover:bg-white/[0.02] transition-colors ${collapsed ? 'justify-center px-0' : ''}`}
        >
          <img src="/brand/logo.png" alt="VERGR" className="w-8 h-8 rounded-lg shrink-0" />
          {!collapsed && (
            <span className="font-syne text-lg font-extrabold tracking-wide text-text-primary">VERGR</span>
          )}
          <button
            onClick={(e) => { e.stopPropagation(); toggleCollapsed(); }}
            className={`ml-auto p-1 rounded-md hover:bg-white/[0.06] text-text-muted hover:text-text-primary ${collapsed ? 'hidden' : ''}`}
            title="Collapse"
          >
            <Icon name="menu_open" size={18} />
          </button>
        </button>

        {/* Back to Main for contextual rails */}
        {!isMain && !collapsed && (
          <button
            onClick={() => navigate(nav.back?.path || '/')}
            className="flex items-center gap-2 px-4 py-2.5 text-text-muted hover:text-brand-violet-light border-b border-white/[0.03] transition-colors"
          >
            <Icon name="arrow_back" size={16} />
            <span className="text-[11px] font-dmmono uppercase tracking-[0.12em]">{nav.back?.label || 'Back'}</span>
          </button>
        )}
        {!isMain && collapsed && (
          <button
            onClick={() => navigate(nav.back?.path || '/')}
            className="flex items-center justify-center py-2.5 text-text-muted hover:text-brand-violet-light border-b border-white/[0.03]"
            title={nav.back?.label || 'Back'}
          >
            <Icon name="arrow_back" size={18} />
          </button>
        )}

        {/* Nav body */}
        <nav className="flex-1 overflow-y-auto no-scrollbar px-2 py-3">
          {isMain ? (
            <>
              {/* First group (no header) = standalone items */}
              {!collapsed && (
                <div className="px-3 pb-1.5 text-[9.5px] font-dmmono uppercase tracking-[0.18em] text-text-muted/70">Nav</div>
              )}
              <div className="space-y-0.5">
                {nav.groups[0].items.map(item => <NavBtn key={item.path} item={item} />)}
              </div>

              {/* Divider */}
              <div className="mx-2 my-3 h-px bg-white/[0.05]" />

              {/* Category buttons (Community, Compete, You) */}
              {!collapsed && (
                <div className="px-3 pb-1.5 text-[9.5px] font-dmmono uppercase tracking-[0.18em] text-text-muted/70">Navigation</div>
              )}
              <div className="space-y-0.5">
                {nav.groups.slice(1).map(g => <CatBtn key={g.header} group={g} />)}
              </div>

              {/* Divider */}
              <div className="mx-2 my-3 h-px bg-white/[0.05]" />

              {/* Your Squads — real data. Empty → CTA to join or create. */}
              {!collapsed ? (
                <>
                  <div className="flex items-center justify-between px-3 pb-1.5">
                    <span className="text-[9.5px] font-dmmono uppercase tracking-[0.18em] text-text-muted/70">Your Squads</span>
                    <button
                      onClick={() => navigate('/squads/create')}
                      className="w-4 h-4 rounded bg-brand-violet text-white text-[11px] font-black flex items-center justify-center hover:brightness-110"
                      title="Create squad"
                    >+</button>
                  </div>
                  {squadsLoaded && userSquads.length === 0 ? (
                    <div className="mx-2 p-3 rounded-lg bg-white/[0.03] border border-white/[0.06]">
                      <p className="text-[11px] text-text-secondary font-medium mb-1">Not in a squad?</p>
                      <p className="text-[10px] text-text-muted leading-snug mb-2">Team up, compete together, and share clips with your crew.</p>
                      <div className="flex gap-1.5">
                        <button onClick={() => navigate('/squads')} className="flex-1 py-1 rounded-md bg-white/[0.05] hover:bg-white/[0.08] text-text-primary text-[10px] font-bold">Join</button>
                        <button onClick={() => navigate('/squads/create')} className="flex-1 py-1 rounded-md bg-gradient-to-r from-brand-violet to-brand-pink text-white text-[10px] font-bold">Create</button>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-0.5">
                      {userSquads.map(s => (
                        <button
                          key={s.id}
                          onClick={() => navigate(`/squads/${s.id}`)}
                          className="w-full flex items-center gap-2.5 px-3 py-1.5 rounded-lg hover:bg-white/[0.03] text-left"
                        >
                          <div className="relative shrink-0">
                            {s.avatar ? (
                              <img src={s.avatar} alt="" className="w-[26px] h-[26px] rounded-full object-cover" />
                            ) : (
                              <div className={`w-[26px] h-[26px] rounded-full bg-gradient-to-br ${gradientFor(s.id)} flex items-center justify-center text-[11px] font-syne font-extrabold text-white`}>
                                {(s.name || '?').charAt(0).toUpperCase()}
                              </div>
                            )}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="text-[12px] font-semibold text-text-secondary truncate leading-tight">{s.name}</div>
                            <div className="text-[9.5px] font-dmmono text-text-muted">{s.memberCount || (s.memberIds?.length || 0)} members</div>
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </>
              ) : (
                <div className="flex flex-col items-center gap-2 pt-1">
                  {squadsLoaded && userSquads.length === 0 ? (
                    <button
                      onClick={() => navigate('/squads')}
                      title="Find or create a squad"
                      className="w-[26px] h-[26px] rounded-full bg-white/[0.05] border border-dashed border-white/[0.15] hover:border-brand-violet/40 flex items-center justify-center"
                    >
                      <Icon name="add" size={14} className="text-text-muted" />
                    </button>
                  ) : (
                    userSquads.map(s => (
                      <button
                        key={s.id}
                        onClick={() => navigate(`/squads/${s.id}`)}
                        className="relative"
                        title={s.name}
                      >
                        {s.avatar ? (
                          <img src={s.avatar} alt="" className="w-[26px] h-[26px] rounded-full object-cover" />
                        ) : (
                          <div className={`w-[26px] h-[26px] rounded-full bg-gradient-to-br ${gradientFor(s.id)} flex items-center justify-center text-[11px] font-syne font-extrabold text-white`}>
                            {(s.name || '?').charAt(0).toUpperCase()}
                          </div>
                        )}
                      </button>
                    ))
                  )}
                </div>
              )}
            </>
          ) : (
            // Contextual rails: flat rendering
            nav.groups.map((group, gi) => (
              <div key={gi} className={gi > 0 ? 'mt-4' : ''}>
                {group.header && !collapsed && (
                  <div className="px-3 pb-1.5 text-[9.5px] font-dmmono uppercase tracking-[0.18em] text-text-muted/70">
                    {group.header}
                  </div>
                )}
                <div className="space-y-0.5">
                  {group.items.map(item => <NavBtn key={item.path} item={item} />)}
                </div>
              </div>
            ))
          )}
        </nav>

        {/* Rich user card */}
        <div
          className={`border-t border-white/[0.06] ${collapsed ? 'p-2' : 'p-3'}`}
          style={{ background: 'linear-gradient(180deg, transparent, rgba(123,111,255,0.08))' }}
        >
          {!collapsed ? (
            <>
              <button onClick={() => navigate('/profile')} className="w-full flex items-center gap-2.5 mb-2 text-left">
                <UserAvatar src={profile?.avatar || profile?.photoURL} size={30} isVerified={profile?.isVerified} />
                <div className="flex-1 min-w-0">
                  <p className="text-[12px] font-extrabold text-text-primary truncate leading-tight">
                    {profile?.displayName || profile?.username || 'Gamer'}
                  </p>
                  <p className="text-[9.5px] text-brand-violet font-dmmono font-bold">{sbVpLevel?.name || 'Rookie'}</p>
                </div>
              </button>
              {/* Level + VP bar (real VP system, not XP) */}
              <div className="flex items-center gap-1.5 mb-1">
                <span className="text-[9px] font-dmmono font-bold text-text-muted">LVL</span>
                <span className="text-[11px] font-dmmono font-black text-brand-violet tabular-nums">{sbVpLevel?.level || 1}</span>
                <div className="flex-1 h-[3px] bg-white/[0.08] rounded-sm overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-brand-violet to-brand-pink rounded-sm"
                    style={{ width: `${Math.min(100, (sbVpProgress || 0))}%` }}
                  />
                </div>
              </div>
              <div className="text-[8.5px] font-dmmono text-text-muted mb-2 tabular-nums">
                {sbVpNext ? `${compact(Math.max(0, sbVpNext.vpRequired - sbVp))} VP to Lvl ${sbVpNext.level}` : 'Max level'}
              </div>
              {/* Coins + VP inline. The coin figure opens the quick-buy shelf
                  rather than navigating to the wallet: someone glancing at their
                  balance is usually about to find it insufficient, and sending
                  them to another screen loses whatever they were doing. VP is
                  rank progress, not a currency, so it still just navigates. */}
              <div className="flex items-center gap-3 mb-2.5">
                <CoinBalancePill size="compact" />
                <button onClick={() => navigate('/wallet')} className="flex items-center gap-1 hover:brightness-110">
                  <VPIcon size={14} />
                  <span className="text-[10px] font-dmmono font-bold text-text-secondary tabular-nums">{compact(wallet?.vp || 0)}</span>
                </button>
              </div>
              {/* Profile + Settings (founder: replaced the Go Live CTA here —
                  Go Live lives on the Streams tab / composer). */}
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => navigate('/profile')}
                  className="py-2 rounded-lg bg-white/[0.06] hover:bg-white/[0.1] text-text-primary text-[11px] font-bold flex items-center justify-center gap-1.5 transition-colors"
                >
                  <Icon name="person" size={14} /> Profile
                </button>
                <button
                  onClick={() => navigate('/settings')}
                  className="py-2 rounded-lg bg-white/[0.06] hover:bg-white/[0.1] text-text-primary text-[11px] font-bold flex items-center justify-center gap-1.5 transition-colors"
                >
                  <Icon name="settings" size={14} /> Settings
                </button>
              </div>
            </>
          ) : (
            <button onClick={() => navigate('/profile')} className="w-full flex justify-center">
              <UserAvatar src={profile?.avatar || profile?.photoURL} size={30} isVerified={profile?.isVerified} />
            </button>
          )}
        </div>

        {/* Expand toggle when collapsed */}
        {collapsed && (
          <button
            onClick={toggleCollapsed}
            className="flex items-center justify-center py-2 border-t border-white/[0.04] text-text-muted hover:text-text-primary"
            title="Expand"
          >
            <Icon name="menu" size={18} />
          </button>
        )}

        {showCreateModal && <CreateComposer onClose={() => setShowCreateModal(false)} />}
      </aside>

      {/* Flyout portal */}
      {flyout && createPortal(
        <div
          onMouseEnter={keepFlyout}
          onMouseLeave={closeFlyout}
          style={{ position: 'fixed', top: flyout.top, left: flyout.left, zIndex: 9999 }}
          className="bg-[#13131f] border border-white/[0.08] rounded-xl p-1.5 min-w-[190px] shadow-2xl shadow-black/60"
        >
          <div className="px-2.5 pt-1.5 pb-2 text-[9.5px] font-dmmono font-bold text-text-muted/70 uppercase tracking-[0.1em] border-b border-white/[0.04] mb-1">
            {flyout.group.header}
          </div>
          {flyout.group.items.map(item => {
            const b = flyout.group.header === 'Community' ? flyoutBadge(item.path) : null;
            return (
              <button
                key={item.path}
                onClick={() => { navigate(item.path); setFlyout(null); }}
                className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-text-secondary hover:bg-brand-violet/12 hover:text-text-primary text-[12.5px] font-medium text-left transition-colors"
              >
                <Icon name={item.icon} size={14} className="text-text-muted" />
                <span className="flex-1">{item.label}</span>
                {b && <CountPill n={b.n} color={b.color} />}
              </button>
            );
          })}
        </div>,
        document.body
      )}
    </>
  );
}

function compact(n) {
  if (n >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1).replace(/\.0$/, '') + 'K';
  return String(n);
}

