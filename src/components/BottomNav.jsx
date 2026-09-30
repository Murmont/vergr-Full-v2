import { useNavigate, useLocation } from 'react-router-dom';
import { motion } from 'framer-motion';
import Icon from './Icon';
import UserAvatar from './UserAvatar';
import { useNotifications } from '../context/NotificationContext';
import { useUser } from '../context/UserContext';

const tabs = [
  { path: '/', icon: 'home', label: 'Home' },
  { path: '/explore', icon: 'explore', label: 'Explore' },
  { path: '/shorts', icon: 'slow_motion_video', label: 'Shorts' },
  { path: '/messages', icon: 'chat_bubble', label: 'Chat' },
];

// Routes that render full-bleed immersive UI with their own controls — bottom nav would overlap.
// '/post' = the post-detail + comments screen: it docks its own comment
// composer at the bottom, so the app tab bar would overlap it (mainstream
// apps drop the tab bar on a post detail anyway). Back button in its TopBar.
// /create/short and /create/clip: the post screen owns the bottom of the screen
// for its Post button, the way TikTok's publish screen hides the tab bar.
const NAV_ICON_BOX = 'flex items-center justify-center h-[26px] w-[26px] shrink-0';

// Form screens with their own fixed Save / Create bar hide the tab bar too: on
// the phone the nav (z-50) was drawn over Edit Profile's Cancel and Save and over
// Create Event's button, so neither could be tapped (measured 2026-09-16).
const HIDE_ON_PATHS = ['/broadcast', '/watch', '/stream/', '/shorts', '/call/', '/go-live', '/creator', '/post/', '/create/short', '/create/clip', '/edit-profile', '/events/create'];

// ONE number on the tab, the way every major messaging app does it.
//
// This used to be a red count for DMs plus up to three coloured dots for squad
// activity, missed calls and message requests. Founder rejected it, and he was
// right: a bare dot tells a user something is unread but not what or where, and
// nothing on the tab says which colour means what, so there is no way to work
// out how to clear it. A count is self-explanatory and matches the platform
// convention. The per-destination breakdown still exists one level down, in
// the Community submenu, where each row can say which number is its own.
//
// Deliberately does NOT include the notification-bell count: those are cleared
// from the bell drawer, which is not inside this tab, so counting them here
// would produce a badge with nothing behind it to open.

export default function BottomNav() {
  const navigate = useNavigate();
  const location = useLocation();
  const {
    unreadChatCount = 0, squadUnreadCount = 0, missedCallCount = 0, requestCount = 0,
  } = useNotifications();
  const { profile } = useUser();

  if (HIDE_ON_PATHS.some((p) => location.pathname.startsWith(p))) return null;

  const isActive = (path) => {
    if (path === '/') return location.pathname === '/';
    return location.pathname.startsWith(path);
  };

  const profileActive = location.pathname.startsWith('/profile');

  return (
    // `data-vg-bottomnav` is read by Modal.jsx, which measures this bar so a
    // bottom sheet's primary button is not covered by it. Do not remove it.
    // Solid and no top rule (founder, 2026-09-14): a see-through bar shows the
    // feed scrolling under the labels, and the rule was one of the thin lines.
    <nav data-vg-bottomnav="" className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-[480px] z-50 safe-bottom lg:hidden" style={{ background: '#0E0E17' }}>
      <div className="flex items-center justify-around h-14 px-2">
        {tabs.map((tab) => {
          const active = isActive(tab.path);
          const badge = tab.icon === 'chat_bubble'
            ? unreadChatCount + squadUnreadCount + missedCallCount + requestCount
            : 0;
          return (
            <button
              key={tab.path}
              onClick={() => navigate(tab.path)}
              className={`flex flex-col items-center justify-center w-16 h-full gap-0.5 transition-colors duration-200 relative ${
                active ? 'text-brand-violet-light' : 'text-text-muted hover:text-text-secondary'
              }`}
            >
              {active && (
                <motion.div
                  layoutId="bottomNavIndicator"
                  className="absolute -top-[1px] w-8 h-[2px] bg-brand-violet rounded-full"
                  transition={{ type: 'spring', stiffness: 500, damping: 35 }}
                />
              )}
              {/* ⚠ ONE BOX SIZE FOR EVERY TAB, the avatar included. The icon
                  glyph's line box and the 24px avatar were different heights, so
                  PROFILE's label sat about 5px higher than the other four
                  (measured on the founder's phone screenshot, 2026-09-14). */}
              <div className={`relative ${NAV_ICON_BOX}`}>
                <Icon name={tab.icon} filled={active} size={22} />
                {badge > 0 && (
                  <span className="absolute -top-1.5 -right-2.5 min-w-[16px] h-4 bg-brand-ember rounded-full flex items-center justify-center text-[9px] font-black text-white px-1">
                    {badge > 99 ? '99+' : badge}
                  </span>
                )}
              </div>
              <span className={`text-[9px] font-semibold uppercase tracking-tight transition-opacity ${active ? 'opacity-100' : 'opacity-50'}`}>
                {tab.label}
              </span>
            </button>
          );
        })}

        {/* Profile = avatar that navigates to the user's own profile.
            The X-style nav drawer is opened from the header avatar or a
            left-edge swipe (handled in ResponsiveLayout), NOT from here. */}
        <button
          onClick={() => navigate('/profile')}
          aria-label="Profile"
          className={`flex flex-col items-center justify-center w-16 h-full gap-0.5 transition-colors duration-200 relative ${
            profileActive ? 'text-brand-violet-light' : 'text-text-muted hover:text-text-secondary'
          }`}
        >
          {profileActive && (
            <motion.div
              layoutId="bottomNavIndicator"
              className="absolute -top-[1px] w-8 h-[2px] bg-brand-violet rounded-full"
              transition={{ type: 'spring', stiffness: 500, damping: 35 }}
            />
          )}
          {/* No ring. A ring on an avatar is a SIGNAL elsewhere in the app
              (live = ember, unseen status = violet), so using one to mean
              "this tab is selected" overloads it. The underline bar and the
              label colour already mark the active tab. */}
          <span className={NAV_ICON_BOX}>
            <UserAvatar src={profile?.avatar || profile?.photoURL} size={24} />
          </span>
          <span className={`text-[9px] font-semibold uppercase tracking-tight transition-opacity ${profileActive ? 'opacity-100' : 'opacity-50'}`}>
            Profile
          </span>
        </button>
      </div>
    </nav>
  );
}
