// NativeSquadScaffold — lean phone-first chrome shared by every native squad
// screen in the APK. Unlike SquadShell (which renders the full desktop rail DOM
// and only hides it with CSS on the phone), this renders NO desktop rails at
// all: just a safe-area TopBar, a single-column scroll area with bottom-nav
// clearance, and a floating menu button that opens the squad/global nav as a
// bottom sheet. It keeps the `.sqd` design-system tokens/classes (so the card
// markup lifted from the web screens styles identically) but skips the heavy
// grid layout for faster mount on the native WebView.

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import TopBar from '../../../components/TopBar';
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
      <div style={{ minHeight: '100vh', background: 'var(--bg)', display: 'flex', flexDirection: 'column' }}>
        <TopBar title={title} showBack actions={actions} />
        <div
          className="content"
          style={{ flex: 1, overflowY: 'auto', paddingBottom: 'calc(96px + env(safe-area-inset-bottom, 0px))' }}
        >
          {children}
        </div>
      </div>

      {/* Floating nav button → bottom sheet (reuses .sqd-native-* CSS in squad.css) */}
      <button className="sqd-native-fab" onClick={() => setNavOpen(true)} aria-label="Squad menu">
        <span className="material-symbols-outlined">menu</span>
      </button>
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
