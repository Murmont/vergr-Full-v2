import { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { doc, updateDoc } from 'firebase/firestore';
import { auth, db } from '../../firebase/config';
import { useAuth } from '../../context/AuthContext';
import { useUI } from '../../context/UIContext';
import VergrLogo from '../../components/VergrLogo';
import Icon from '../../components/Icon';
import AuthShell from '../../components/auth/AuthShell';
import { authErrorMessage } from '../../utils/authErrors';

// The pending referrer: the URL's ?ref=, a stashed value, or the Play install
// referrer. One definition, shared with onboarding (Google signups) so no path
// reads it differently.
import { getPendingReferrerId } from '../../utils/referral';

// Suggest a handle from a display name (TikTok-style): sanitize to the username
// charset. Returns '' if nothing usable, so we never force a bad handle.
const suggestHandle = (name) => String(name || '').toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 20);

export default function SignUpStep2() {
  // Prefill the handle the user picked on /linkinbio (stashed by step 1).
  const claimed = (() => { try { return sessionStorage.getItem('vergr_claim_handle') || ''; } catch { return ''; } })();
  const [username, setUsername] = useState(claimed);
  const [displayName, setDisplayName] = useState('');
  const [usernameTouched, setUsernameTouched] = useState(!!claimed);
  const [loading, setLoading] = useState(false);
  const { signUp, convertGuestToAccount, isAnonymous } = useAuth();
  const { showToast } = useUI();
  const navigate = useNavigate();
  const location = useLocation();
  const { email, password, dob, tosVersion, tosAcceptedAt, complianceConfirmedAt, fromGuest } = location.state || {};
  // Trust both signals — `fromGuest` was set when step 1 saw an anonymous
  // user, and `isAnonymous` reflects the live auth state right now. If
  // either is true, treat as a conversion.
  const isConverting = fromGuest === true || isAnonymous === true;

  const usernameValid = /^[a-zA-Z0-9_]{3,20}$/.test(username);

  const handleCreate = async () => {
    if (!usernameValid || !displayName) return;
    setLoading(true);
    try {
      // Server-side double-check on reserved + uniqueness. The signup form
      // does a soft check separately; this is defence in depth.
      const { checkUsername } = await import('../../utils/usernameValidation');
      const err = await checkUsername(username);
      if (err) {
        showToast?.(err, 'error');
        setLoading(false);
        return;
      }
      if (!email) { navigate('/login'); return; }
      // Path A — converting an existing anonymous guest session into a
      // permanent account. Preserves the uid + any data accumulated as
      // a guest. Path B — fresh user creates a brand-new auth record.
      if (isConverting) {
        await convertGuestToAccount(email, password, displayName);
      } else {
        await signUp(email, password, displayName);
      }

      // Persist referral attribution if one is pending. We write it after
      // `signUp()` so we know the auth user + their Firestore user doc both
      // exist. `referredBy` is later read by `claimQuestReward('refer_friend')`
      // to validate the invitee genuinely came from the referrer's link.
      try {
        const referrerId = getPendingReferrerId();
        // Compliance fields written at account creation so every account
        // has a recorded ToS acceptance + claimed DOB. The Persona KYC
        // step later overwrites `kyc.*` once government-ID verification
        // completes.
        const compliancePatch = {
          username,
          dob: dob || null,
          tosVersion: tosVersion || 1,
          tosAcceptedAt: tosAcceptedAt || Date.now(),
          // Evidence trail for the §4A.2 user-responsibility shift —
          // captures the moment the user explicitly affirmed that their
          // use is lawful in their jurisdiction. If a dispute ever
          // arises, this is the primary record.
          complianceConfirmedAt: complianceConfirmedAt || Date.now(),
          // `kyc` is NOT seeded here any more. It is server-only now (Didit's
          // webhook is the only writer), because an owner-writable
          // `kyc.verified` is a flag the user can set on themselves and
          // assertKycVerified reads it. An absent `kyc` already means
          // unverified everywhere it is checked, so nothing needs seeding.
        };
        if (referrerId && auth.currentUser && referrerId !== auth.currentUser.uid) {
          await updateDoc(doc(db, 'users', auth.currentUser.uid), {
            ...compliancePatch,
            referredBy: referrerId,
            referredAt: new Date(),
          });
        } else if (auth.currentUser) {
          await updateDoc(doc(db, 'users', auth.currentUser.uid), compliancePatch);
        }
        localStorage.removeItem('vergr_ref');
      } catch (e) {
        console.warn('Post-signup user-doc patch failed:', e);
      }

      // Route through email verification (it self-skips to onboarding if the
      // email backend isn't configured yet, so this never blocks signup).
      navigate('/verify-email?next=/onboarding', { replace: true });
    } catch (err) {
      showToast(authErrorMessage(err, 'Sign up failed'), 'error');
    }
    setLoading(false);
  };

  return (
    <AuthShell>
      <div className="w-full">
        <div className="flex justify-center mb-8 lg:hidden"><VergrLogo size={44} /></div>
        <h1 className="font-syne text-2xl font-bold text-center mb-1">Choose Your Identity</h1>
        <p className="text-text-secondary text-center mb-8">This is how people will find you</p>

        <div className="flex flex-col gap-5">
          {/* Display name first — typing it auto-suggests a handle (TikTok-style),
              which the user can freely edit. The handle field is never empty. */}
          <label className="block relative group">
            <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none text-text-muted group-focus-within:text-brand-violet-light transition-colors">
              <Icon name="person" size={22} />
            </div>
            <input type="text" placeholder="Display Name" value={displayName}
              onChange={e => { const v = e.target.value; setDisplayName(v); if (!usernameTouched) setUsername(suggestHandle(v)); }}
              className="input-with-icon" maxLength={30} />
          </label>

          <label className="block relative group">
            <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none text-text-muted group-focus-within:text-brand-violet-light transition-colors">
              <Icon name="alternate_email" size={22} />
            </div>
            <input type="text" placeholder="Username" value={username}
              onChange={e => { setUsernameTouched(true); setUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '')); }}
              className="input-with-icon pr-12" maxLength={20} />
            {username.length >= 3 && (
              <div className="absolute inset-y-0 right-0 pr-4 flex items-center">
                <Icon name={usernameValid ? 'check_circle' : 'cancel'} size={20}
                  className={usernameValid ? 'text-brand-violet-light' : 'text-brand-ember'} />
              </div>
            )}
          </label>
          {username && !usernameValid && (
            <p className="text-brand-ember text-xs px-1 -mt-3">3-20 characters, letters, numbers, underscores only</p>
          )}
          {username && usernameValid && !usernameTouched && (
            <p className="text-text-muted text-xs px-1 -mt-3">Suggested from your name — tap to change it.</p>
          )}

          <button onClick={handleCreate} disabled={!usernameValid || !displayName || loading}
            className={`btn-primary mt-4 ${(!usernameValid || !displayName) ? 'opacity-40 cursor-not-allowed' : ''}`}>
            {loading ? <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : 'Create Account'}
          </button>
        </div>
      </div>
    </AuthShell>
  );
}
