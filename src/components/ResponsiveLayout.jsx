import { useState, useEffect } from 'react';
import useResponsive from '../hooks/useResponsive';
import { IS_NATIVE_BUILD } from '../utils/platform';
import DesktopSidebar from './DesktopSidebar';
import BottomNav from './BottomNav';
import DiscoveryStrip from './DiscoveryStrip';
import { useUI } from '../context/UIContext';
import { useNotifications } from '../context/NotificationContext';
import Icon from './Icon';

export default function ResponsiveLayout({
  children,
  showNav = true,
  rightPanel,
  centered = true,
  layout = 'standard',
}) {
  const { isMobile, isTablet, isDesktop } = useResponsive();
  const { setNotificationsDrawerOpen } = useUI();
  const { unreadCount } = useNotifications();

  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    try { return localStorage.getItem('vergr_sidebar_collapsed') === '1'; } catch { return false; }
  });

  useEffect(() => {
    const handler = (e) => setSidebarCollapsed(e.detail?.collapsed ?? false);
    window.addEventListener('sidebar-toggle', handler);
    return () => window.removeEventListener('sidebar-toggle', handler);
  }, []);

  if (!showNav) {
    return <>{children}</>;
  }

  const notifButton = isDesktop ? (
    <button
      onClick={() => setNotificationsDrawerOpen(true)}
      className="fixed top-4 right-4 z-40 w-9 h-9 rounded-full bg-surface-2 border border-white/[0.06] text-text-secondary flex items-center justify-center hover:text-text-primary hover:bg-surface-3 transition-colors"
    >
      <Icon name="notifications" size={18} />
      {unreadCount > 0 && (
        <span className="absolute -top-1 -right-1 w-5 h-5 bg-brand-ember rounded-full text-[10px] flex items-center justify-center font-bold text-white">
          {unreadCount > 9 ? '9+' : unreadCount}
        </span>
      )}
    </button>
  ) : null;

  // PROFESSIONAL LAYOUT (Home Feed) – with inner container for borders
  if (isDesktop && layout === 'professional' && rightPanel) {
    const leftMargin = sidebarCollapsed ? '72px' : '240px';
    return (
      <div className="flex min-h-screen bg-bg-dark">
        <DesktopSidebar />
        <div style={{ marginLeft: leftMargin }} className="flex-1 py-4">
          <div className="flex justify-center">
            <div className="flex gap-0">
              <div className="w-[620px] bg-surface-1 shadow-xl shadow-black/30 overflow-visible">
                <div className="border-x border-white/10">
                  {children}
                </div>
              </div>
              <aside className="w-[340px] shrink-0 sticky top-0 h-screen overflow-y-auto no-scrollbar border-l border-white/[0.06] bg-bg-dark py-4">
                {rightPanel}
              </aside>
            </div>
          </div>
        </div>
        {notifButton}
      </div>
    );
  }

  // STANDARD DESKTOP LAYOUT (other pages)
  if (isDesktop) {
    const sidebarWidth = sidebarCollapsed ? '72px' : '240px';
    if (centered) {
      return (
        <div className="flex min-h-screen bg-bg-dark">
          <DesktopSidebar />
          <div style={{ marginLeft: sidebarWidth }} className="flex-1 transition-all duration-200">
            {notifButton}
            <div className="flex">
              <main className="w-full max-w-[680px] min-h-screen border-x border-white/[0.04]">
                {children}
              </main>
              {rightPanel && (
                <aside className="hidden xl:block w-[240px] shrink-0 py-4 sticky top-0 h-screen overflow-y-auto no-scrollbar">
                  {rightPanel}
                </aside>
              )}
            </div>
          </div>
        </div>
      );
    } else {
      if (rightPanel) {
        return (
          <div className="flex min-h-screen bg-bg-dark">
            <DesktopSidebar />
            <div style={{ marginLeft: sidebarWidth }} className="flex-1 transition-all duration-200">
              {notifButton}
              <div className="flex">
                <main className="flex-1 min-h-screen border-x border-white/[0.04]">
                  {children}
                </main>
                <aside className="hidden xl:block w-[240px] shrink-0 py-4 sticky top-0 h-screen overflow-y-auto no-scrollbar border-l border-white/[0.06]">
                  {rightPanel}
                </aside>
              </div>
            </div>
          </div>
        );
      } else {
        return (
          <div className="flex min-h-screen bg-bg-dark">
            <DesktopSidebar />
            <div style={{ marginLeft: sidebarWidth }} className="flex-1 transition-all duration-200">
              {notifButton}
              <div className="flex justify-start">
                <main className="flex-1 min-h-screen border-x border-white/[0.04]">
                  {children}
                </main>
              </div>
            </div>
          </div>
        );
      }
    }
  }

  if (isTablet) {
    return (
      <div className="flex min-h-screen bg-bg-dark">
        <DesktopSidebar collapsed />
        <div className="flex-1 ml-[80px]">
          <div className={`flex ${centered ? 'justify-center' : 'justify-start'}`}>
            <main className="w-full max-w-[680px] min-h-screen border-x border-white/[0.04]">
              {children}
            </main>
          </div>
        </div>
      </div>
    );
  }

  // Mobile. The X-style nav drawer (+ left-edge swipe) is mounted globally as
  // <MobileNavDrawerHost/> in AppRouter so it works on every screen, including
  // those that own their own chrome (e.g. HomeFeedScreen).
  const immersivePath =
    typeof window !== 'undefined' &&
    /^\/(broadcast|watch|shorts|call)(\/|$)/.test(window.location.pathname);
  return (
    <div className="min-h-screen bg-bg-dark">
      {/* Native app: fill the phone width. The Android WebView reports an inflated
          viewport (~980px), so the 480px-centered web column leaves big dead
          gutters and squashes content into a thin strip on a real phone.
          NOTE: do NOT add `safe-top` here. Every screen owns its own sticky
          header that already insets the status bar (TopBar, the dedicated native
          headers, HomeFeed/Explore glass headers). Adding the inset here too
          double-padded the top of every screen. Banner-led screens
          (Native[Public]ProfileScreen) inset their floating controls directly. */}
      <div className={`${IS_NATIVE_BUILD ? 'w-full' : 'max-w-[480px] mx-auto'} min-h-screen relative ${immersivePath ? '' : 'pb-20'}`}>
        {children}
        <BottomNav />
      </div>
    </div>
  );
}