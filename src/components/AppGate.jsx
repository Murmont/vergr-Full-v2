// AppGate: makes two Admin → App Config switches real on every screen.
//
// 1. MAINTENANCE MODE. Until 2026-09-21 the toggle's hint read "Show
//    platform-wide maintenance banner" and nothing read the flag, so switching it
//    on changed nothing. Now every app route is replaced by the maintenance
//    screen. The public site (/platform: legal pages, help centre, downloads)
//    and /login stay reachable, so a reviewer can still read the Terms and staff
//    can still sign in. Staff (`users.staff`) keep using the app, under a banner
//    that says maintenance is on, so the founder can check a fix before
//    reopening.
//
// 2. SIGN-UPS PAUSED. On the phone, Google sign-in is a redirect, so an account
//    created while sign-ups are paused is undone inside AuthContext with no
//    screen to explain it. AuthContext leaves a session flag; this says why.
//
// Costs no reads: useAppGate shares the app_config listener other hooks
// already hold, and the staff flag comes from the profile UserContext holds.

import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useUser } from '../context/UserContext';
import { useUI } from '../context/UIContext';
import useAppGate from '../hooks/useAppGate';
import MaintenanceScreen from '../screens/utility/MaintenanceScreen';

const OPEN_DURING_MAINTENANCE = ['/platform', '/login', '/maintenance'];

export default function AppGate() {
  const { maintenance } = useAppGate();
  const { currentUser } = useAuth();
  const { profile } = useUser();
  const { showToast } = useUI();
  const { pathname } = useLocation();

  useEffect(() => {
    let flagged = false;
    try { flagged = sessionStorage.getItem('vergr.signupsPaused') === '1'; } catch { /* ignore */ }
    if (!flagged) return;
    try { sessionStorage.removeItem('vergr.signupsPaused'); } catch { /* ignore */ }
    showToast?.('New sign-ups are paused right now. Existing accounts can still sign in.', 'error');
  }, [currentUser, showToast]);

  if (!maintenance) return null;
  if (OPEN_DURING_MAINTENANCE.some((p) => pathname === p || pathname.startsWith(p + '/'))) return null;

  if (profile?.staff === true) {
    return (
      <div
        role="status"
        className="fixed top-0 inset-x-0 z-[10001] bg-brand-gold text-bg-dark text-center text-xs font-semibold py-1.5"
        style={{ paddingTop: 'calc(6px + env(safe-area-inset-top, 0px))' }}
      >
        Maintenance mode is on. Only staff can use the app until it is switched off in Vergr Admin.
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[10000] bg-bg-dark overflow-y-auto">
      <MaintenanceScreen />
    </div>
  );
}
