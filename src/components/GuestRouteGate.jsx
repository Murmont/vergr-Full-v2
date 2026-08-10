// GuestRouteGate — wraps routes that are write-only (Create Post,
// Create Tournament, Go Live, etc.) and shows a "Sign up to continue"
// screen for anonymous guest users.
//
// For inline actions on read-mostly screens (Like, Follow, Tip, Send
// Message), use the `useGuestGate().requireSignup()` hook instead —
// that pops a modal rather than blocking the whole route.

import { Link } from 'react-router-dom';
import { useUser } from '../context/UserContext';
import Icon from './Icon';

export default function GuestRouteGate({ children, action = 'do this' }) {
  const { isGuest, loading } = useUser();

  if (loading) {
    return (
      <div className="min-h-[40vh] flex items-center justify-center text-text-muted text-sm">
        Loading…
      </div>
    );
  }

  if (!isGuest) return children;

  return (
    <div className="min-h-[70vh] flex items-center justify-center px-6 py-10">
      <div className="max-w-md w-full rounded-2xl border border-white/[0.08] bg-surface-1 p-8 text-center">
        <div className="mx-auto mb-4 h-14 w-14 rounded-full bg-brand-violet/15 text-brand-violet-light flex items-center justify-center">
          <Icon name="lock_person" size={32} />
        </div>
        <h2 className="font-syne text-xl font-bold mb-2">Sign up to {action}</h2>
        <p className="text-text-muted text-sm leading-relaxed mb-6">
          You're browsing VERGR as a guest. Create a free account in a
          minute to {action} and unlock the full platform.
        </p>
        <Link
          to="/signup"
          className="inline-block px-6 py-3 rounded-xl bg-gradient-to-r from-brand-violet to-brand-violet-light text-white text-sm font-bold shadow-lg shadow-brand-violet/30 hover:brightness-110">
          Create my account →
        </Link>
        <Link
          to="/"
          className="block mt-3 text-text-muted text-xs hover:text-text-secondary transition-colors">
          Keep browsing
        </Link>
      </div>
    </div>
  );
}
