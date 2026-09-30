// BannedGate — the client half of an actual ban.
//
// ⚠ Until 2026-09-20 a ban wrote `banned: true` on users/{uid} and NOTHING read
// it: not the client, not firestore.rules, not a callable. Banning someone
// changed nothing they could notice. The server half now disables the Firebase
// Auth account (functions/bans.js), which stops every future sign-in, but a
// session that is already open keeps its ID token until it expires — up to an
// hour of posting after the ban. This closes that hour.
//
// ⚠ IT COSTS ZERO READS. UserContext already holds a live onSnapshot on the
// signed-in user's own document for the profile, so the ban fields arrive on a
// listener that was going to fire anyway. Do not add a query here.

import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useUser } from '../context/UserContext';
import { AppealForm } from './moderation/Appeal';

// The stored ban may be a Firestore Timestamp, a Date or millis depending on
// which path wrote it. tsMs is the house helper for exactly this.
function untilMs(v) {
  if (!v) return 0;
  if (typeof v === 'number') return v;
  if (typeof v.toMillis === 'function') return v.toMillis();
  if (typeof v.seconds === 'number') return v.seconds * 1000;
  const t = new Date(v).getTime();
  return Number.isNaN(t) ? 0 : t;
}

function formatEnds(ms) {
  try {
    return new Date(ms).toLocaleString(undefined, {
      dateStyle: 'medium', timeStyle: 'short',
    });
  } catch { return null; }
}

export default function BannedGate() {
  const { currentUser, logout } = useAuth();
  const { profile } = useUser();
  const [busy, setBusy] = useState(false);
  // Writing an appeal pauses the automatic sign-out below: the session's token
  // is the only thing that can still reach submitAppeal once the account is
  // disabled, so signing out mid-sentence would lose the appeal.
  const [appealing, setAppealing] = useState(false);

  const until = untilMs(profile?.banUntil);
  const permanent = !!profile?.permabanned;
  // A temp ban whose clock has already run out is NOT a ban. The 6-hourly sweep
  // clears the flags and re-enables the account, but the user should never see
  // a lock screen for a ban that expired twenty minutes ago.
  const active = !!profile?.banned && (permanent || (until > 0 && until > Date.now()));

  // Sign the session out in the background as well. The Auth account is already
  // disabled server-side, so the token cannot be refreshed; this just makes the
  // state honest instead of leaving a half-signed-in app behind the overlay.
  useEffect(() => {
    if (!active || appealing) return;
    const t = setTimeout(() => { logout?.().catch(() => {}); }, 60 * 1000);
    return () => clearTimeout(t);
  }, [active, appealing, logout]);

  if (!currentUser || !profile || !active) return null;

  const ends = until ? formatEnds(until) : null;

  return (
    <div className="fixed inset-0 z-[10000] bg-bg-dark flex items-center justify-center p-6">
      <div className="max-w-md w-full bg-surface-1 rounded-2xl p-6 text-center">
        <div className="w-14 h-14 rounded-full bg-brand-ember/15 flex items-center justify-center mx-auto mb-4">
          <span className="material-symbols-outlined text-brand-ember text-[28px]" aria-hidden="true">block</span>
        </div>
        <h2 className="font-syne text-xl font-bold mb-2">
          {permanent ? 'Your account has been banned' : 'Your account is suspended'}
        </h2>
        <p className="text-text-muted text-sm leading-relaxed mb-4">
          {profile.banReason
            ? profile.banReason
            : 'This account broke the Vergr rules. If you think that is wrong, contact support.'}
        </p>
        {!permanent && ends && (
          <p className="text-text-secondary text-sm mb-4">
            Your access comes back on <span className="font-dmmono tabular-nums">{ends}</span>.
          </p>
        )}
        {appealing ? (
          <div className="text-left bg-surface-2 rounded-xl p-4 mb-3">
            <AppealForm targetType="account" targetId={currentUser.uid} onCancel={() => setAppealing(false)} />
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setAppealing(true)}
            className="block w-full py-3 rounded-xl bg-surface-2 text-text-primary text-sm font-semibold mb-3"
          >
            Appeal this decision
          </button>
        )}
        <a
          href="mailto:support@vergr.app"
          className="block w-full py-3 rounded-xl bg-surface-2 text-text-primary text-sm font-semibold mb-3"
        >
          Contact support
        </a>
        <button
          type="button"
          disabled={busy}
          onClick={() => { setBusy(true); logout?.().catch(() => setBusy(false)); }}
          className="w-full py-3 rounded-xl bg-brand-violet text-white text-sm font-semibold disabled:opacity-60"
        >
          {busy ? 'Signing out…' : 'Sign out'}
        </button>
      </div>
    </div>
  );
}
