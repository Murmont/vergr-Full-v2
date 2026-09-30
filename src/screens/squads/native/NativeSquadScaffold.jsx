// NativeSquadScaffold — lean phone-first chrome shared by every native squad
// screen in the APK. Unlike SquadShell (which renders the full desktop rail DOM
// and only hides it with CSS on the phone), this renders NO desktop rails at
// all: just the same safe-area top bar the web shell uses, a single-column
// scroll area, and the squad nav opened as a bottom sheet from the top bar.
// It keeps the `.sqd` design-system tokens/classes (so card markup lifted
// from the web screens styles identically) but skips the heavy grid layout
// for a faster mount on the native WebView.

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import '../../../styles/squad.css';

const GLOBAL_NAV = [
  { group: 'Squads', items: [
    { id: 'find',         label: 'Find Squads',    icon: 'search',        path: '/squads' },
    { id: 'mine',         label: 'My Squads',      icon: 'groups',        path: '/squads/mine' },
    { id: 'invitations',  label: 'Invitations',    icon: 'mail',          path: '/squads/invitations' },
    { id: 'applications', label: 'Applications',   icon: 'description',   path: '/squads/applications' },
    { id: 'players',      label: 'Browse Players', icon: 'person_search', path: '/squads/players' },
  ]},
  { group: 'Create', items: [
    { id: 'create', label: 'Create Squad', icon: 'add_circle', path: '/squads/create' },
  ]},
];

const SQUAD_NAV = [
  { group: 'Squad', items: [
    { id: 'chat',          label: 'Chat',          icon: 'chat',          seg: 'chat' },
    { id: 'overview',      label: 'Overview',      icon: 'grid_view',     seg: '' },
    { id: 'members',       label: 'Members',       icon: 'group',         seg: 'members' },
    { id: 'events',        label: 'Events',        icon: 'event',         seg: 'events' },
    { id: 'challenges',    label: 'Challenges',    icon: 'military_tech', seg: 'challenges' },
    { id: 'announcements', label: 'Announcements', icon: 'campaign',      seg: 'announcements' },
    { id: 'leaderboard',   label: 'Leaderboard',   icon: 'leaderboard',   seg: 'leaderboard' },
    { id: 'media',         label: 'Media',         icon: 'photo_library', seg: 'media' },
    { id: 'pinned',        label: 'Pinned',        icon: 'push_pin',      seg: 'pinned' },
  ]},
  { group: 'Manage', items: [
    { id: 'settings',  label: 'Settings',            icon: 'settings',             seg: 'settings' },
    { id: 'roles',     label: 'Roles & Permissions', icon: 'admin_panel_settings', seg: 'roles' },
    { id: 'requests',  label: 'Join Requests',       icon: 'person_add',           seg: 'requests' },
    { id: 'invite',    label: 'Invite Members',      icon: 'forward_to_inbox',     seg: 'invite' },
    { id: 'analytics', label: 'Analytics',           icon: 'analytics',            seg: 'analytics' },
  ]},
];

export default function NativeSquadScaffold({
  mode = 'global',
  title,
  activeId,
  squadId,
  squadName,
  actions = null,    // optional right-side action node in the TopBar row
  children,
}) {
  const navigate = useNavigate();
  const [navOpen, setNavOpen] = useState(false);

  const groups = mode === 'squad'
    ? SQUAD_NAV.map((g) => ({ group: g.group, items: g.items.map((it) => ({ ...it, path: `/squads/${squadId}${it.seg ? `/${it.seg}` : ''}` })) }))
    : GLOBAL_NAV;

  return (
    <div className="sqd">
      {/* ───── TOP BAR ─────────────────────────────────────────────────
          Uses the SAME `.sqd-mtop` markup and styles as the web SquadShell, so
          the APK and the browser render an identical squad header instead of
          two different chromes (the APK used the generic <TopBar/>, which is
          why they did not match).

          The nav button lives HERE, at the top right, not in a floating FAB at
          the bottom of the page. SquadShell's own comment already made this
          call for the web: "a floating hamburger is a phone antipattern, it
          covered whatever was underneath it, and it put the primary navigation
          somewhere no one looks for it." The native scaffold never got that
          change. Same sheet, same nav, reachable where people look for it. */}
      <div className="sqd-mtop">
        <button className="sqd-mtop-btn" onClick={() => navigate(-1)} aria-label="Back">
          <span className="material-symbols-outlined">arrow_back</span>
        </button>
        <div className="sqd-mtop-ttl">{mode === 'squad' ? (squadName || title || 'Squad') : (title || 'Squads')}</div>
        {actions}
        <button className="sqd-mtop-btn" onClick={() => setNavOpen(true)} aria-label="Squad menu">
          <span className="material-symbols-outlined">menu</span>
        </button>
      </div>

      {/* Bounded so ONLY `.content` scrolls. This was `minHeight:100vh`, which
          does not bound a flex column at all: the child's `flex:1` had nothing
          to divide against, so the DOCUMENT scrolled and the header went with
          it.

          `flex:1` and NOT another `100dvh`: `.sqd` is itself the 100dvh flex
          column (squad.css, max-width:1100px), and `.sqd-mtop` is a SIBLING of
          this element. Giving this one a full viewport height would make the
          page mtop-taller than the screen, which is the precise bug being
          fixed here. */}
      <div style={{ flex: '1 1 auto', minHeight: 0, background: 'var(--bg)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div
          className="content"
          style={{ flex: 1, minHeight: 0, overflowY: 'auto', paddingBottom: 'calc(20px + var(--vg-safe-b, 0px))' }}
        >
          {children}
        </div>
      </div>
      {navOpen && (
        <div className="sqd-native-sheet-backdrop" onClick={() => setNavOpen(false)}>
          <div className="sqd-native-sheet" onClick={(e) => e.stopPropagation()}>
            <div className="sqd-native-grab" />
            <div className="sqd-native-sheet-head">
              <div className="ttl">{mode === 'squad' ? (squadName || 'Squad') : 'Squads'}</div>
              <button onClick={() => setNavOpen(false)} aria-label="Close"><span className="material-symbols-outlined">close</span></button>
            </div>
            {mode === 'squad' && (
              <button className="sqd-native-home" onClick={() => { setNavOpen(false); navigate('/squads'); }}>
                <span className="material-symbols-outlined">arrow_back</span> All squads
              </button>
            )}
            <div className="sqd-native-scroll">
              {groups.map((g) => (
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
