// SquadShell — the two-level squad layout chrome.
//
//   mode="global"  → Find Squads / My Squads / Invitations / Applications /
//                    Browse Players / Create Squad. Left rail = global squad nav.
//   mode="squad"   → any /squads/:squadId/* screen. Left rail = squad switcher
//                    (current squad + your other squads) + that squad's
//                    contextual nav (Chat, Overview, Members, … + Manage group).
//
// Every squad screen renders:  <SquadShell ...><main>…</main></SquadShell>
// and the page-specific content goes in `children`. Optionally pass
// `rightRail` to render a right column (squad screens pass <SquadInfoRail/>).

import { useEffect, useMemo, useState } from 'react';
import CachedImg from '../CachedImg';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useUser } from '../../context/UserContext';
import { getUserSquads, getSquad } from '../../firebase/firestore';
import { getNavOrigin, clearNavOrigin } from '../../utils/navOrigin';
import Icon from '../Icon';
import UserAvatar from '../UserAvatar';
import '../../styles/squad.css';
import UserName from '../UserName';

const GLOBAL_NAV = [
  { group: 'Squads', items: [
    { id: 'find',         label: 'Find Squads',   icon: 'search',        path: '/squads' },
    { id: 'mine',         label: 'My Squads',     icon: 'groups',        path: '/squads/mine' },
    { id: 'invitations',  label: 'Invitations',   icon: 'mail',          path: '/squads/invitations' },
    { id: 'applications', label: 'Applications',  icon: 'description',   path: '/squads/applications' },
    { id: 'players',      label: 'Browse Players',icon: 'person_search', path: '/squads/players' },
  ]},
  { group: 'Create', items: [
    { id: 'create', label: 'Create Squad', icon: 'add_circle', path: '/squads/create' },
  ]},
];

// Squad-context nav. `path` is built per-squad at render time.
const SQUAD_NAV = [
  { group: 'Squad', items: [
    { id: 'chat',          label: 'Chat',                icon: 'chat',                  seg: 'chat' },
    { id: 'overview',      label: 'Overview',            icon: 'grid_view',             seg: '' },
    { id: 'members',       label: 'Members',             icon: 'group',                 seg: 'members' },
    { id: 'events',        label: 'Events',              icon: 'event',                 seg: 'events' },
    { id: 'challenges',    label: 'Challenges',          icon: 'military_tech',         seg: 'challenges' },
    { id: 'announcements', label: 'Announcements',       icon: 'campaign',              seg: 'announcements' },
    { id: 'leaderboard',   label: 'Leaderboard',         icon: 'leaderboard',           seg: 'leaderboard' },
    { id: 'media',         label: 'Media',               icon: 'photo_library',         seg: 'media' },
    { id: 'pinned',        label: 'Pinned',              icon: 'push_pin',              seg: 'pinned' },
  ]},
  { group: 'Manage', items: [
    { id: 'settings',  label: 'Settings',             icon: 'settings',              seg: 'settings' },
    { id: 'roles',     label: 'Roles & Permissions',  icon: 'admin_panel_settings',  seg: 'roles' },
    { id: 'requests',  label: 'Join Requests',        icon: 'person_add',            seg: 'requests' },
    { id: 'invite',    label: 'Invite Members',       icon: 'forward_to_inbox',      seg: 'invite' },
    { id: 'analytics', label: 'Analytics',            icon: 'analytics',             seg: 'analytics' },
  ]},
];

// Deterministic gradient color class for a squad chip given its id.
const SWATCHES = ['', 'gold', 'cyan', 'ember', 'gem'];
function swatchFor(id) {
  if (!id) return '';
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return SWATCHES[h % SWATCHES.length];
}

function compact(n) {
  if (n >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1).replace(/\.0$/, '') + 'K';
  return String(n || 0);
}

export default function SquadShell({
  mode = 'global',
  activeId,
  squadId,
  rightRail = null,
  children,
}) {
  const navigate = useNavigate();
  const { profile, wallet } = useUser();
  const { currentUser } = useAuth();
  const [squad, setSquad] = useState(null);
  const [mySquads, setMySquads] = useState([]);
  const [switchOpen, setSwitchOpen] = useState(false);
  const [navOpen, setNavOpen] = useState(false);

  // Where "back" goes. Entering the section from the Community hub replaces
  // that rail with this one, so returning to the home feed loses the user's
  // place — the recorded origin sends them back where they came in.
  const origin = getNavOrigin('/squads');
  const backLabel = origin?.label || 'Back to Main';
  const goBack = () => {
    const target = origin?.path || '/';
    clearNavOrigin();
    navigate(target);
  };

  // Native nav items (the desktop left rail is display:none on the native
  // WebView, leaving squad screens with no navigation). Flatten the mode's
  // nav groups into a drawer opened by a floating button.
  const nativeNavGroups = mode === 'squad'
    ? SQUAD_NAV.map((g) => ({ group: g.group, items: g.items.map((it) => ({ ...it, path: `/squads/${squadId}${it.seg ? `/${it.seg}` : ''}` })) }))
    : GLOBAL_NAV;

  // Load the current squad (squad mode) + the user's squad list (for the switcher / My Squads).
  useEffect(() => {
    let alive = true;
    (async () => {
      if (mode === 'squad' && squadId) {
        try {
          const s = await getSquad(squadId);
          if (alive) setSquad(s);
        } catch (e) { /* ignore */ }
      }
      const uid = profile?.uid || currentUser?.uid;
      if (uid) {
        try {
          const list = await getUserSquads(uid);
          if (alive) setMySquads(list || []);
        } catch (e) { /* ignore */ }
      }
    })();
    return () => { alive = false; };
  }, [mode, squadId, profile?.uid, currentUser?.uid]);

  const otherSquads = useMemo(
    () => (mySquads || []).filter(s => s.id !== squadId),
    [mySquads, squadId],
  );

  const initials = (name) => (name || '?').trim().slice(0, 2).toUpperCase();

  return (
    <div className="sqd">
      {/* ───── MOBILE TOP BAR ─────
          Nav belongs at the top of the screen, not floating over the content.
          This replaces a fixed FAB that hovered above the page: a floating
          hamburger is a phone antipattern, it covered whatever was underneath
          it, and it put the primary navigation somewhere no one looks for it.
          Lives in the shell rather than in each screen's own .page-header, so
          all ~19 squad screens get back + menu from one place. Hidden by CSS
          above 1100px, the same breakpoint that shows the left rail. */}
      <div className="sqd-mtop">
        <button className="sqd-mtop-btn" onClick={goBack} aria-label={backLabel}>
          <span className="material-symbols-outlined">arrow_back</span>
        </button>
        <div className="sqd-mtop-ttl">{mode === 'squad' ? (squad?.name || 'Squad') : 'Squads'}</div>
        <button className="sqd-mtop-btn" onClick={() => setNavOpen(true)} aria-label="Squad menu">
          <span className="material-symbols-outlined">menu</span>
        </button>
      </div>
      <div className={`app${rightRail ? '' : ' no-rail'}`}>
        {/* ───── LEFT RAIL ───── */}
        <aside className="rail-l">
          <button className="brand" onClick={() => navigate('/')}>
            <div className="brand-logo"><img src="/brand/logo.png" alt="V" onError={(e) => { e.target.style.display = 'none'; e.target.parentElement.textContent = 'V'; }} /></div>
            <div className="brand-name">VERGR</div>
          </button>

          <button className="back-main" onClick={goBack}>
            <span className="material-symbols-outlined">arrow_back</span>
            <span>{backLabel}</span>
          </button>

          {mode === 'squad' ? (
            <>
              {/* Squad switcher */}
              <div className={`squad-switch${switchOpen ? ' open' : ''}`}>
                <div className="sw-row" onClick={() => setSwitchOpen(o => !o)}>
                  <div className="squad-avatar">
                    {squad?.avatar
                      ? <CachedImg src={squad.avatar} permanent alt="" />
                      : initials(squad?.name)}
                  </div>
                  <div className="squad-meta">
                    <div className="squad-name">
                      {squad?.name || 'Squad'}
                      {squad?.verified && <span className="material-symbols-outlined verified">verified</span>}
                    </div>
                    <div className="squad-tag">{squad?.game || 'Squad'}{squad?.level ? ` · Lvl ${squad.level}` : ''}</div>
                  </div>
                  <span className="material-symbols-outlined chev">expand_more</span>
                </div>
                <div className="switch-list">
                  {otherSquads.map(s => (
                    <div key={s.id} className="switch-row" onClick={() => navigate(`/squads/${s.id}`)}>
                      <div className={`squad-avatar sw-mini ${swatchFor(s.id)}`}>
                        {s.avatar ? <CachedImg src={s.avatar} permanent alt="" /> : initials(s.name)}
                      </div>
                      <div className="sw-name">{s.name}</div>
                    </div>
                  ))}
                  <div className="switch-create" onClick={() => navigate('/squads')}>
                    <span className="material-symbols-outlined" style={{ fontSize: 16 }}>add_circle</span>
                    Create or Join Squad
                  </div>
                </div>
              </div>

              <nav className="nav">
                {SQUAD_NAV.map(group => (
                  <div className="nav-group" key={group.group}>
                    <div className="nav-header">{group.group}</div>
                    {group.items.map(it => {
                      const path = it.seg ? `/squads/${squadId}/${it.seg}` : `/squads/${squadId}`;
                      return (
                        <button
                          key={it.id}
                          className={`nav-item${activeId === it.id ? ' active' : ''}`}
                          onClick={() => navigate(path)}
                        >
                          <span className="material-symbols-outlined">{it.icon}</span>
                          <span>{it.label}</span>
                        </button>
                      );
                    })}
                  </div>
                ))}
              </nav>
            </>
          ) : (
            <>
              <div className="global-header">
                <div className="pill"><span className="material-symbols-outlined">groups_2</span></div>
                <div>
                  <div className="ttl">Squads</div>
                  <div className="sub">Find · Manage · Connect</div>
                </div>
              </div>
              <nav className="nav">
                {GLOBAL_NAV.map(group => (
                  <div className="nav-group" key={group.group}>
                    <div className="nav-header">{group.group}</div>
                    {group.items.map(it => (
                      <button
                        key={it.id}
                        className={`nav-item${activeId === it.id ? ' active' : ''}`}
                        onClick={() => navigate(it.path)}
                      >
                        <span className="material-symbols-outlined">{it.icon}</span>
                        <span>{it.label}</span>
                      </button>
                    ))}
                  </div>
                ))}
              </nav>
            </>
          )}

          {/* User card */}
          <div className="user-card">
            <button className="user-row" onClick={() => navigate('/profile')} style={{ width: '100%' }}>
              <div className="user-av">
                {profile?.avatar ? <CachedImg src={profile.avatar} permanent alt="" /> : (profile?.displayName?.[0] || 'V').toUpperCase()}
              </div>
              <div style={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
                <div className="user-name"><UserName user={profile} masked fallback={'Member'} /></div>
                <div className="user-role">VERGR {profile?.role === 'creator' ? 'Creator' : 'Member'}</div>
              </div>
            </button>
            <div className="xp-row">
              <span>LVL</span>
              <span className="lvl">{profile?.vpLevel || profile?.level || 1}</span>
              <div className="xp-bar">
                <div style={{ width: `${Math.min(100, ((profile?.xp || 0) / (profile?.xpNext || 15000)) * 100)}%` }} />
              </div>
            </div>
            <div className="coins-row">
              <span><span className="coin" />{compact(wallet?.balance || 0)}</span>
              <span><span className="gem" />{compact(wallet?.vp || 0)}</span>
            </div>
          </div>
        </aside>

        {/* ───── MAIN ───── */}
        {children}

        {/* ───── RIGHT RAIL ───── */}
        {rightRail}
      </div>

      {/* Nav sheet, opened from the mobile top bar above. */}
      {navOpen && (
            <div className="sqd-native-sheet-backdrop" onClick={() => setNavOpen(false)}>
              <div className="sqd-native-sheet" onClick={(e) => e.stopPropagation()}>
                <div className="sqd-native-grab" />
                <div className="sqd-native-sheet-head">
                  <div className="ttl">{mode === 'squad' ? (squad?.name || 'Squad') : 'Squads'}</div>
                  <button onClick={() => setNavOpen(false)} aria-label="Close"><span className="material-symbols-outlined">close</span></button>
                </div>
                {/* The origin-aware back ("Back to Community" when you entered
                    from the Community hub) lived only in .rail-l, which is
                    display:none below 1100px — so on mobile it disappeared
                    entirely and there was no way out of the squad section
                    except the browser back button. */}
                <button className="sqd-native-home" onClick={() => { setNavOpen(false); goBack(); }}>
                  <span className="material-symbols-outlined">arrow_back</span> {backLabel}
                </button>
                {mode === 'squad' && (
                  <button className="sqd-native-home" onClick={() => { setNavOpen(false); navigate('/squads'); }}>
                    <span className="material-symbols-outlined">groups</span> All squads
                  </button>
                )}
                <div className="sqd-native-scroll">
                  {nativeNavGroups.map((g) => (
                    <div className="sqd-native-group" key={g.group}>
                      <div className="sqd-native-ghead">{g.group}</div>
                      {g.items.map((it) => (
                        <button key={it.id}
                          className={`sqd-native-item${activeId === it.id ? ' active' : ''}`}
                          onClick={() => { setNavOpen(false); navigate(it.path); }}>
                          <span className="material-symbols-outlined">{it.icon}</span>
                          {it.label}
                        </button>
                      ))}
                    </div>
                  ))}
                </div>
              </div>
            </div>
      )}
    </div>
  );
}
