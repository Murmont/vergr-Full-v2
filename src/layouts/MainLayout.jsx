import { useEffect } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import ResponsiveLayout from '../components/ResponsiveLayout';
import { useLayout } from '../context/LayoutContext';
import useTier from '../hooks/useTier';
import { syncNativeBanner, hideNativeBanner } from '../utils/nativeBanner';

// Routes whose screens render their OWN full chrome (own sidebar, own header,
// own back-to-app affordance) and must NOT be wrapped in the regular app
// nav. Without this they'd double-stack a 240px DesktopSidebar against
// the admin/wallet/etc. sidebar AND get constrained by the 680px main
// column — tabs overflow, content squashes, looks broken.
const STANDALONE_PREFIXES = ['/admin'];

// NOTE: the guest "browsing as guest" indicator lives in the single global
// <GuestModeBanner /> (rendered in AppRouter, so it covers every page incl.
// wallet/admin). The old inline GuestUpsellBar here duplicated it and the two
// overlapped at the top of the page — removed to leave one cue, not two.

export default function MainLayout() {
  const { rightPanel, contentAlign, layout } = useLayout();
  const { pathname } = useLocation();
  const standalone = STANDALONE_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + '/'));

  // Native AdMob banner follows the route. No-op on web/desktop, and no-op for
  // paying users — the banner util gates on both.
  const { isFree } = useTier();
  useEffect(() => {
    syncNativeBanner(pathname, isFree);
    return () => hideNativeBanner();
  }, [pathname, isFree]);

  return (
    <>
      <ResponsiveLayout
        rightPanel={standalone ? null : rightPanel}
        centered={contentAlign === 'center'}
        layout={layout}
        showNav={!standalone}
      >
        <Outlet />
      </ResponsiveLayout>
    </>
  );
}
