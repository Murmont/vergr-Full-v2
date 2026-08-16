import { useState, useEffect, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import Icon from './Icon';
import UserAvatar from './UserAvatar';
import { useUser } from '../context/UserContext';
import { useAuth } from '../context/AuthContext';
import { useNotifications } from '../context/NotificationContext';
import { getVPLevel } from '../utils/vpSystem';

// Routes that render their own full-bleed immersive UI — no drawer/swipe there.
const DRAWER_HIDE_PREFIXES = ['/broadcast', '/watch', '/call', '/go-live', '/admin', '/login', '/signup', '/onboarding'];

// Global host: mounted ONCE at the app root so the X-style drawer works on
// every screen regardless of whether that screen uses MainLayout or owns its
// own chrome (e.g. HomeFeedScreen). Opens via the `vergr:open-nav-drawer`
// window event (fired by header avatars) or a left-edge swipe.
export function MobileNavDrawerHost() {
  const [open, setOpen] = useState(false);
  const { pathname } = useLocation();
  const touch = useRef(null);

  const hidden = DRAWER_HIDE_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + '/'));

  useEffect(() => {
    const onOpen = () => setOpen(true);
    window.addEventListener('vergr:open-nav-drawer', onOpen);
    return () => window.removeEventListener('vergr:open-nav-drawer', onOpen);
  }, []);

  // Left-edge swipe (touch start within 24px of the left edge, drag right).
  useEffect(() => {
    const onStart = (e) => {
      const t = e.touches?.[0];
      touch.current = t && t.clientX <= 24 ? { x: t.clientX, y: t.clientY } : null;
    };
    const onMove = (e) => {
      if (!touch.current || open) return;
      const t = e.touches?.[0];
      if (!t) return;
      const dx = t.clientX - touch.current.x;
      const dy = Math.abs(t.clientY - touch.current.y);
      if (dx > 55 && dy < 45) {
        setOpen(true);
        touch.current = null;
      }
    };
    const onEnd = () => { touch.current = null; };
    window.addEventListener('touchstart', onStart, { passive: true });
    window.addEventListener('touchmove', onMove, { passive: true });
    window.addEventListener('touchend', onEnd, { passive: true });
    return () => {
      window.removeEventListener('touchstart', onStart);
      window.removeEventListener('touchmove', onMove);
      window.removeEventListener('touchend', onEnd);
    };
  }, [open]);

  // Close on route change.
  useEffect(() => { setOpen(false); }, [pathname]);

  if (hidden) return null;
  return <MobileNavDrawer open={open} onClose={() => setOpen(false)} />;
}

// ──────────────────────────────────────────────────────────────
// Mobile slide-in nav drawer. Surfaces every primary destination
// that doesn't fit the slimmed 5-slot bottom bar (Wallet, Squads,
// Tournaments, Creator Studio, Settings, Notifications, etc.).
// Mirrors the desktop left-rail groups so mobile has full parity.
// ──────────────────────────────────────────────────────────────

const GROUPS = [
  {
    header: null,
    items: [
      { icon: 'person', label: 'My Profile', path: '/profile' },
      { icon: 'notifications', label: 'Notifications', path: '/notifications' },
    ],
  },
  {
    header: 'Community',
    items: [
      { icon: 'call', label: 'Calls', path: '/calls' },
      { icon: 'amp_stories', label: 'Status', path: '/status' },
      { icon: 'groups', label: 'Squads', path: '/squads' },
    ],
  },
  {
    header: 'Discover',
    items: [
      { icon: 'leaderboard', label: 'Leaderboard', path: '/leaderboard' },
      { icon: 'live_tv', label: 'Live Streams', path: '/streams' },
    ],
  },
  {
    header: 'You',
    items: [
      { icon: 'redeem', label: 'Earn VP', path: '/earn' },
      { icon: 'account_balance_wallet', label: 'Wallet', path: '/wallet' },
      { icon: 'dashboard', label: 'Creator Studio', path: '/creator/dashboard' },
      { icon: 'verified', label: 'Verification', path: '/creator/verify' },
      { icon: 'settings', label: 'Settings', path: '/settings' },
      { icon: 'help', label: 'Help & Support', path: '/platform/help' },
    ],
  },
];

export default function MobileNavDrawer({ open, onClose }) {
  const navigate = useNavigate();
  const { profile, wallet } = useUser();
  const { logout } = useAuth();
  const { unreadNotifCount = 0 } = useNotifications();

  const go = (path) => { onClose?.(); navigate(path); };

  const vp = wallet?.vp || 0;
  const vpLevel = getVPLevel?.(vp);
  const displayName = profile?.displayName || profile?.username || 'You';

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            className="fixed inset-0 z-[130] bg-black/60 lg:hidden"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />
          <motion.aside
            className="fixed top-0 left-0 bottom-0 z-[131] w-[84%] max-w-[320px] overflow-y-auto no-scrollbar lg:hidden safe-top"
            style={{ background: '#0E0E18', borderRight: '1px solid rgba(255,255,255,0.06)' }}
            initial={{ x: '-100%' }}
            animate={{ x: 0 }}
            exit={{ x: '-100%' }}
            transition={{ type: 'spring', stiffness: 380, damping: 38 }}
            drag="x"
            dragConstraints={{ left: 0, right: 0 }}
            dragElastic={{ left: 0.7, right: 0 }}
            onDragEnd={(_, info) => {
              if (info.offset.x < -60 || info.velocity.x < -400) onClose?.();
            }}
          >
            {/* Profile header */}
            <button
              onClick={() => go('/profile')}
              className="flex w-full items-center gap-3 px-4 py-4 text-left"
              style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}
            >
              <UserAvatar src={profile?.avatar || profile?.photoURL} size={48} />
              <div className="min-w-0 flex-1">
                <p className="truncate font-syne text-[15px] font-bold text-white">{displayName}</p>
                <p className="truncate text-[12px] text-text-muted">
                  @{profile?.username || 'player'} · {vpLevel?.name || 'Rookie'}
                </p>
              </div>
              <Icon name="chevron_right" size={18} className="text-text-muted" />
            </button>

            {/* Nav groups. Bottom inset clears the Android gesture nav bar so the
                Sign-out row isn't hidden behind it (edge-to-edge WebView). */}
            <nav className="px-2 py-2" style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 20px)' }}>
              {GROUPS.map((g, gi) => (
                <div key={gi} className="mb-1.5">
                  {g.header && (
                    <p className="px-3 pb-1 pt-2 text-[10px] font-bold uppercase tracking-widest text-text-muted/70">
                      {g.header}
                    </p>
                  )}
                  {g.items.map((it) => {
                    const badge = it.path === '/notifications' ? unreadNotifCount : 0;
                    return (
                      <button
                        key={it.path}
                        onClick={() => go(it.path)}
                        className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-text-secondary transition-colors hover:bg-[#1A1A2A] hover:text-white"
                      >
                        <span className="relative flex items-center justify-center">
                          <Icon name={it.icon} size={20} />
                          {badge > 0 && (
                            <span className="absolute -right-2 -top-1.5 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-brand-ember px-1 text-[9px] font-black text-white">
                              {badge > 99 ? '99+' : badge}
                            </span>
                          )}
                        </span>
                        <span className="text-[14px] font-medium">{it.label}</span>
                      </button>
                    );
                  })}
                </div>
              ))}

              <button
                onClick={async () => { onClose?.(); try { await logout(); } catch {} navigate('/login'); }}
                className="mt-2 flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-brand-ember transition-colors hover:bg-brand-ember/10"
              >
                <Icon name="logout" size={20} />
                <span className="text-[14px] font-semibold">Sign out</span>
              </button>
            </nav>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}
