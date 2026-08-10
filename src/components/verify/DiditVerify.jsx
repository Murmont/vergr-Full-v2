// DiditVerify — wraps the Didit.me hosted verification flow.
//
// 1. Call `startKycVerification` callable → returns { verificationUrl }.
// 2. Open Didit URL in a new tab (preserves session state in our app).
// 3. Subscribe to users/{uid}.kyc — Didit's webhook flips
//    `verified: true` (or sets `failureReason`) and we react in real time.
//
// See `functions/didit.js` for the server side.

import { useEffect, useRef, useState } from 'react';
import { httpsCallable } from 'firebase/functions';
import { doc, onSnapshot } from 'firebase/firestore';
import { functions, db } from '../../firebase/config';
import { useAuth } from '../../context/AuthContext';
import { useUI } from '../../context/UIContext';
import Icon from '../Icon';

export default function DiditVerify({ onVerified, onCancel, compact = false }) {
  const { currentUser } = useAuth();
  const { showToast } = useUI();
  const [loading, setLoading] = useState(false);
  const [openedAt, setOpenedAt] = useState(null);
  const tabRef = useRef(null);

  // Listen for the webhook flipping kyc.verified — closes the pending state
  // in real time without the user needing to refresh.
  useEffect(() => {
    if (!currentUser?.uid || !openedAt) return;
    const unsub = onSnapshot(doc(db, 'users', currentUser.uid), (snap) => {
      const kyc = snap.data()?.kyc;
      if (kyc?.verified === true) {
        showToast('Identity verified — thanks!', 'success');
        if (onVerified) onVerified(kyc);
      } else if (kyc?.failureReason && kyc?.checkedAt) {
        const reasonText = {
          underage:        'You must be at least 18 years old.',
          blocked_country: 'Your country is not eligible for verification.',
          declined:        'Verification was declined. Try again with a clearer ID photo.',
          abandoned:       'Verification was not completed.',
          incomplete:      'Verification was not completed.',
        }[kyc.failureReason] || 'Verification was not approved.';
        showToast(reasonText, 'error');
      }
    });
    return () => unsub();
  }, [currentUser?.uid, openedAt, onVerified, showToast]);

  const handleStart = async () => {
    if (!currentUser?.uid) {
      showToast('Sign in to verify.', 'error');
      return;
    }
    setLoading(true);
    try {
      const fn = httpsCallable(functions, 'startKycVerification');
      const { data } = await fn({});
      if (data.alreadyVerified) {
        showToast('You are already verified.', 'success');
        if (onVerified) onVerified({ verified: true });
        return;
      }
      if (!data.verificationUrl) {
        throw new Error('No verification URL returned');
      }
      // Open Didit in a new tab. Falling back to same-tab redirect for
      // popup-blocked environments.
      const w = window.open(data.verificationUrl, '_blank', 'noopener,noreferrer');
      if (!w) {
        window.location.href = data.verificationUrl;
        return;
      }
      tabRef.current = w;
      setOpenedAt(Date.now());
      showToast('Verification opened in a new tab. Complete it and we\'ll detect it automatically.', 'info');
    } catch (err) {
      console.error('[didit] start failed', err);
      showToast(err?.message || 'Could not start verification.', 'error');
    } finally {
      setLoading(false);
    }
  };

  if (compact) {
    return (
      <button
        onClick={handleStart}
        disabled={loading}
        className="px-4 py-2 rounded-xl bg-brand-violet text-white text-sm font-bold hover:brightness-110 disabled:opacity-50">
        {loading ? 'Loading…' : 'Verify Identity'}
      </button>
    );
  }

  return (
    <div className="max-w-md w-full mx-auto p-8 rounded-2xl border border-white/[0.08] bg-surface-1 text-center">
      <div className="mx-auto mb-4 h-14 w-14 rounded-full bg-brand-violet/15 text-brand-violet-light flex items-center justify-center">
        <Icon name="verified_user" size={32} />
      </div>
      <h2 className="font-syne text-xl font-bold mb-2">Verify your identity</h2>
      <p className="text-text-muted text-sm leading-relaxed mb-6">
        VERGR requires a one-time identity check before you can access the
        wallet, enter tournaments, or withdraw earnings. The process takes
        about 90 seconds — you'll photograph a government ID and take a
        quick selfie. Verification is handled by Didit; your ID image is
        stored by Didit, not by VERGR.
      </p>
      <button
        onClick={handleStart}
        disabled={loading}
        className="px-6 py-3 rounded-xl bg-gradient-to-r from-brand-violet to-brand-pink text-white text-sm font-bold shadow-lg shadow-brand-violet/30 hover:brightness-110 disabled:opacity-50">
        {loading ? 'Loading…' : 'Start Verification'}
      </button>
      {onCancel && (
        <button onClick={onCancel} className="ml-3 px-4 py-3 text-text-muted text-sm">
          Not now
        </button>
      )}
      <p className="text-text-muted text-[11px] mt-5">
        18+ only. You must be in a supported region.
      </p>
      {openedAt && (
        <p className="text-brand-violet-light text-[11px] mt-3 flex items-center justify-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-brand-violet animate-pulse" />
          Waiting for verification result...
        </p>
      )}
    </div>
  );
}
