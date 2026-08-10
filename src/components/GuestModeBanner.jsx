// GuestModeBanner — persistent indicator for guest users.
//
// Two states:
//   1. Expanded (first appearance, per session): full message + Sign Up button + dismiss "×".
//   2. Minimized (after dismiss): small floating pill at top-center, semi-transparent,
//      hover/click to re-expand. Doesn't push page content around in either state —
//      uses `position: fixed` so the rest of the app layout is unaffected.
//
// Dismissal state is per-session (sessionStorage) so the user is reminded once per
// browser tab; they don't get spammed but they also don't permanently lose the cue.

import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useUser } from '../context/UserContext';
import Icon from './Icon';

const DISMISS_KEY = 'vergr_guest_banner_dismissed_v1';

export default function GuestModeBanner() {
  const { isGuest } = useUser();
  const location = useLocation();
  const [dismissed, setDismissed] = useState(() => {
    if (typeof window === 'undefined') return false;
    try { return sessionStorage.getItem(DISMISS_KEY) === '1'; } catch { return false; }
  });

  // Persist dismissal so reloads inside the same tab don't re-expand.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      if (dismissed) sessionStorage.setItem(DISMISS_KEY, '1');
      else sessionStorage.removeItem(DISMISS_KEY);
    } catch {}
  }, [dismissed]);

  if (!isGuest) return null;

  // Hide entirely on auth screens — the user is already on their way.
  const hideOn = ['/login', '/signup', '/forgot-password'];
  if (hideOn.some(p => location.pathname.startsWith(p))) return null;

  // Minimized: small floating pill, top-center.
  if (dismissed) {
    return (
      <button
        type="button"
        onClick={() => setDismissed(false)}
        className="fixed top-3 left-1/2 -translate-x-1/2 z-[70] flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-brand-violet/30 hover:bg-brand-violet/50 backdrop-blur-md border border-brand-violet/40 text-white text-[11px] font-bold transition-all shadow-lg shadow-brand-violet/20"
        style={{ paddingTop: `calc(0.375rem + env(safe-area-inset-top))` }}
        aria-label="Guest mode — click to expand"
        title="Guest mode — click to expand">
        <Icon name="visibility" size={12} />
        <span className="tracking-wide">GUEST</span>
      </button>
    );
  }

  // Expanded: full message bar, top-center floating, doesn't push page content.
  return (
    <div
      className="fixed top-3 left-1/2 -translate-x-1/2 z-[70] flex items-center gap-2 px-4 py-2 rounded-full bg-gradient-to-r from-brand-violet/80 via-brand-violet-light/80 to-brand-violet/80 backdrop-blur-md border border-white/[0.12] text-white text-xs font-semibold shadow-2xl shadow-brand-violet/30 max-w-[min(94vw,560px)]"
      style={{ marginTop: 'env(safe-area-inset-top)' }}>
      <Icon name="visibility" size={14} className="flex-shrink-0" />
      <span className="truncate">
        Browsing as guest — sign up to unlock everything.
      </span>
      <Link
        to="/signup"
        className="flex-shrink-0 inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-bg-dark/30 hover:bg-bg-dark/60 transition-colors text-[11px]">
        Sign up <Icon name="arrow_forward" size={11} />
      </Link>
      <button
        type="button"
        onClick={() => setDismissed(true)}
        className="flex-shrink-0 p-1 -mr-1 rounded-full hover:bg-white/10 transition-colors"
        aria-label="Minimize">
        <Icon name="close" size={14} />
      </button>
    </div>
  );
}
