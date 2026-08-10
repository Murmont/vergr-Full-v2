// 3D glossy icons for the Messages "communication hub" rail (founder Figma).
// Compressed WebP (~2-4KB each) so they paint near-instantly.
import allChatsIcon from '../assets/messages-nav/all-chats.webp';
import callsIcon from '../assets/messages-nav/calls.webp';
import statusIcon from '../assets/messages-nav/status.webp';
import friendsIcon from '../assets/messages-nav/friends.webp';
import browseGroupsIcon from '../assets/messages-nav/browse-groups.webp';
import squadsIcon from '../assets/messages-nav/squads.webp';
import requestsIcon from '../assets/messages-nav/requests.webp';

// Contextual left-rail configurations.
//
// The app has a global "main" rail by default. Inside certain sections
// (Tournaments, Squads, Messaging, Creator Studio, Settings) the rail swaps
// to a section-specific nav with a "Back to Main" item at the top so the
// user can always escape back to global navigation.
//
// Each config is a list of { header?, items: [{ icon, label, path, badge? }] }
// groups. Group order is preserved. The active item is resolved by longest
// matching `path` against the current location.

export const MAIN_NAV = {
  id: 'main',
  groups: [
    {
      items: [
        { icon: 'home', label: 'Home', path: '/' },
        { icon: 'explore', label: 'Explore', path: '/explore' },
        { icon: 'slow_motion_video', label: 'Shorts', path: '/shorts' },
      ],
    },
    {
      header: 'Community',
      // Every Community entry points at its /messages/hub twin so the section
      // opens WITH the community rail (MESSAGING_NAV) pinned. The standalone
      // /calls, /status and /squads routes still exist for deep links, native
      // and the mobile drawer — do NOT point these back at them.
      items: [
        { icon: 'chat_bubble', label: 'Messages', path: '/messages' },
        { icon: 'call', label: 'Calls', path: '/messages/hub/calls' },
        { icon: 'amp_stories', label: 'Status', path: '/messages/hub/status' },
        { icon: 'groups', label: 'Squads', path: '/messages/hub/squads' },
      ],
    },
    {
      header: 'Watch',
      items: [
        { icon: 'live_tv', label: 'Live Streams', path: '/streams' },
        { icon: 'leaderboard', label: 'Leaderboard', path: '/leaderboard' },
      ],
    },
    {
      header: 'You',
      items: [
        { icon: 'redeem', label: 'Earn VP', path: '/earn' },
        { icon: 'account_balance_wallet', label: 'Wallet', path: '/wallet' },
        { icon: 'dashboard', label: 'Creator Studio', path: '/creator/dashboard' },
        { icon: 'settings', label: 'Settings', path: '/settings' },
      ],
    },
  ],
};

export const TOURNAMENTS_NAV = {
  id: 'tournaments',
  title: 'Tournaments',
  back: { label: 'Back to Main', path: '/' },
  groups: [
    {
      header: 'Tournaments',
      items: [
        { icon: 'dashboard', label: 'Overview', path: '/tournaments' },
        { icon: 'format_list_bulleted', label: 'All Tournaments', path: '/tournaments/all' },
        { icon: 'star', label: 'My Tournaments', path: '/tournaments/mine' },
        { icon: 'favorite', label: 'Following', path: '/tournaments/following' },
        { icon: 'history', label: 'Past Tournaments', path: '/tournaments/past' },
      ],
    },
    {
      header: 'Tournament Types',
      items: [
        { icon: 'person', label: '1v1 Single Elim', path: '/tournaments/type/1v1-single' },
        { icon: 'person', label: '1v1 Double Elim', path: '/tournaments/type/1v1-double' },
        { icon: 'groups', label: 'Squad vs Squad', path: '/tournaments/type/squad-single' },
        { icon: 'groups', label: 'Squad Round Robin', path: '/tournaments/type/squad-round' },
        { icon: 'gamepad', label: 'Free For All', path: '/tournaments/type/ffa' },
        { icon: 'military_tech', label: 'Battle Royale', path: '/tournaments/type/battle' },
        { icon: 'swap_horiz', label: 'Swiss System', path: '/tournaments/type/swiss' },
        { icon: 'mail', label: 'Invitational / Custom', path: '/tournaments/type/invite' },
      ],
    },
    {
      header: 'Organise',
      items: [
        { icon: 'add_circle', label: 'Create Tournament', path: '/create-tournament' },
        { icon: 'trophy', label: 'My Tournaments', path: '/tournaments/mine' },
        { icon: 'inbox', label: 'Applications', path: '/tournaments/applications' },
      ],
    },
    {
      header: 'Support',
      items: [
        { icon: 'gavel', label: 'Rules & Guides', path: '/tournaments/rules' },
        { icon: 'help', label: 'Help Center', path: '/platform/help' },
      ],
    },
  ],
};

// SQUADS_NAV was removed 2026-05-14 — SquadShell owns the squad-section nav
// entirely (see src/components/squad/SquadShell.jsx GLOBAL_NAV + SQUAD_NAV).
// Don't reintroduce a navConfig entry for /squads; the contextual rail is
// rendered by SquadShell itself based on the route's mode prop.

export const MESSAGING_NAV = {
  id: 'messaging',
  title: 'Messages',
  back: { label: 'Back to Main', path: '/' },
  // The "communication hub": All Chats stays the chat list; Calls/Status/Squads
  // are launcher entries into those sections. Glossy `img` icons per Figma;
  // `icon` kept as a Material fallback.
  groups: [
    {
      items: [
        { icon: 'forum', img: allChatsIcon, label: 'All Chats', path: '/messages' },
        { icon: 'call', img: callsIcon, label: 'Calls', path: '/messages/hub/calls' },
        { icon: 'amp_stories', img: statusIcon, label: 'Status', path: '/messages/hub/status' },
        { icon: 'person', img: friendsIcon, label: 'Friends', path: '/messages/friends' },
        { icon: 'group_add', img: browseGroupsIcon, label: 'Browse Groups', path: '/messages/browse' },
        { icon: 'groups', img: squadsIcon, label: 'Squads', path: '/messages/hub/squads' },
        { icon: 'outbox', img: requestsIcon, label: 'Requests', path: '/messages/requests' },
      ],
    },
  ],
};

export const CREATOR_NAV = {
  id: 'creator',
  title: 'Creator Studio',
  back: { label: 'Back to Main', path: '/' },
  groups: [
    {
      header: 'Creator Studio',
      items: [
        { icon: 'dashboard', label: 'Overview', path: '/creator/dashboard' },
        { icon: 'analytics', label: 'Analytics', path: '/creator/analytics' },
        { icon: 'attach_money', label: 'Revenue', path: '/creator/earnings' },
        { icon: 'live_tv', label: 'Streams', path: '/creator/streams' },
        { icon: 'people', label: 'Audience', path: '/creator/audience' },
        { icon: 'forum', label: 'Community', path: '/creator/community' },
        { icon: 'favorite', label: 'Engagement', path: '/creator/engagement' },
        { icon: 'payments', label: 'Payouts', path: '/creator/payouts' },
        { icon: 'grid_view', label: 'Content', path: '/creator/content' },
        { icon: 'link', label: 'Vergr.me', path: '/vergrme/edit' },
        { icon: 'calendar_month', label: 'Schedule', path: '/creator/schedule' },
        { icon: 'check_circle', label: 'Quests', path: '/creator/quests' },
        { icon: 'workspace_premium', label: 'Membership', path: '/creator/membership' },
        { icon: 'settings', label: 'Settings', path: '/creator/settings' },
      ],
    },
  ],
};

export const SETTINGS_NAV = {
  id: 'settings',
  title: 'Settings',
  back: { label: 'Back to Main', path: '/' },
  groups: [
    {
      items: [
        { icon: 'person', label: 'Account', path: '/settings' },
        { icon: 'lock', label: 'Privacy', path: '/settings/privacy' },
        { icon: 'notifications', label: 'Notifications', path: '/settings/notifications' },
        { icon: 'palette', label: 'Appearance', path: '/settings/display' },
        { icon: 'sd_storage', label: 'Storage & Data', path: '/settings/storage' },
        { icon: 'link', label: 'Vergr.me Page', path: '/vergrme/edit' },
        { icon: 'shield', label: 'Security', path: '/settings/security' },
        { icon: 'verified', label: 'Verification', path: '/creator/verify' },
        { icon: 'help', label: 'Help & Support', path: '/platform/help' },
      ],
    },
  ],
};

// Route → nav resolver. Longest prefix wins.
// `/squads` intentionally has no entry — `SquadShell` owns the squad-section
// nav. If you add one here you'll re-introduce the double-rail bug.
const RESOLVERS = [
  { prefix: '/creator', nav: CREATOR_NAV },
  // Tournaments are retired from navigation. TOURNAMENTS_NAV is kept above so
  // the section can be restored by re-adding these two resolver entries.
  { prefix: '/messages', nav: MESSAGING_NAV },
  { prefix: '/settings', nav: SETTINGS_NAV },
];

export function resolveNavForPath(pathname) {
  if (!pathname) return MAIN_NAV;
  const match = RESOLVERS
    .filter(r => pathname === r.prefix || pathname.startsWith(r.prefix + '/') || pathname === r.prefix)
    .sort((a, b) => b.prefix.length - a.prefix.length)[0];
  return match ? match.nav : MAIN_NAV;
}

export function findActiveItem(nav, pathname) {
  let best = null;
  for (const g of nav.groups) {
    for (const it of g.items) {
      if (pathname === it.path || pathname.startsWith(it.path + '/')) {
        if (!best || it.path.length > best.path.length) best = it;
      }
    }
  }
  return best;
}
