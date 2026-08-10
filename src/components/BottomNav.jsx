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
const HIDE_ON_PATHS = ['/broadcast', '/watch', '/stream/', '/shorts', '/call/', '/go-live', '/creator', '/post/'];

// Color-coded unread (mirrors DesktopSidebar's Community badges): DMs+groups
// red pill with a count; squad/calls/requests are stacked dots so the user can
// tell the categories apart at a glance without four numbers fighting for room.
const DOT_COLORS = {
  purple: 'bg-brand-violet',  // squad chat activity
  green:  'bg-success-green', // missed calls
  amber:  'bg-brand-gold',    // message requests
};

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
    <nav className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-[480px] z-50 glass-header safe-bottom lg:hidden" style={{ borderBottom: 'none', borderTop: '1px solid rgba(255,255,255,0.04)' }}>
      <div className="flex items-center justify-around h-14 px-2">
        {tabs.map((tab) => {
          const active = isActive(tab.path);
          const badge = tab.icon === 'chat_bubble' ? unreadChatCount : 0;
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
              <div className="relative flex items-center justify-center">
                <Icon name={tab.icon} filled={active} size={22} />
                {badge > 0 && (
                  <span className="absolute -top-1.5 -right-2.5 min-w-[16px] h-4 bg-brand-ember rounded-full flex items-center justify-center text-[9px] font-black text-white px-1">
                    {badge > 99 ? '99+' : badge}
                  </span>
                )}
                {tab.icon === 'chat_bubble' && (squadUnreadCount > 0 || missedCallCount > 0 || requestCount > 0) && (
                  <span className="absolute -bottom-1 -right-2.5 flex items-center gap-[3px]">
                    {squadUnreadCount > 0 && <span className={`w-1.5 h-1.5 rounded-full ${DOT_COLORS.purple}`} />}
                    {missedCallCount > 0 && <span className={`w-1.5 h-1.5 rounded-full ${DOT_COLORS.green}`} />}
                    {requestCount > 0 && <span className={`w-1.5 h-1.5 rounded-full ${DOT_COLORS.amber}`} />}
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
          <UserAvatar src={profile?.avatar || profile?.photoURL} size={24} />
          <span className={`text-[9px] font-semibold uppercase tracking-tight transition-opacity ${profileActive ? 'opacity-100' : 'opacity-50'}`}>
            Profile
          </span>
        </button>
      </div>
    </nav>
  );
}
