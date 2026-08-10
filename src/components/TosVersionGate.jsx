// TosVersionGate — when the Terms of Service / Privacy Policy version
// in the source of truth (CURRENT_LEGAL_VERSION) is newer than the
// version the signed-in user accepted, this prompts the user to re-accept.
//
// Mount once near the top of the authenticated tree. If the user has not
// yet accepted any version it does nothing (the signup flow handles
// first acceptance). If their version is stale it overlays a blocking
// modal that updates `users/{uid}.tosVersion` + `tosAcceptedAt` once
// they confirm.

import { useState } from 'react';
import { Link } from 'react-router-dom';
import { doc, updateDoc } from 'firebase/firestore';
import { useAuth } from '../context/AuthContext';
import { useUser } from '../context/UserContext';
import { db } from '../firebase/config';
// Import the version constant from the small legal data module directly, NOT
// from PublicMarketingScreens — a static import of that giant module (which
// pulls in helpContent + every help-article body) would force the whole
// marketing/help surface into the main app chunk. PublicMarketingScreens still
// re-exports CURRENT_LEGAL_VERSION for any other caller.
import { LEGAL_VERSION as CURRENT_LEGAL_VERSION } from '../screens/marketing/legal/legalContent';

export default function TosVersionGate() {
  const { currentUser } = useAuth();
  const { profile } = useUser();
  const [saving, setSaving] = useState(false);

  if (!currentUser || !profile) return null;

  const accepted = profile.tosVersion || 0;
  // Don't show the modal for never-accepted users — signup handles that.
  if (accepted === 0) return null;
  if (accepted >= CURRENT_LEGAL_VERSION) return null;

  const handleAccept = async () => {
    setSaving(true);
    try {
      await updateDoc(doc(db, 'users', currentUser.uid), {
        tosVersion: CURRENT_LEGAL_VERSION,
        tosAcceptedAt: Date.now(),
      });
    } catch (err) {
      console.error('[tos] accept failed', err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[9999] bg-black/70 backdrop-blur-sm flex items-center justify-center p-6">
      <div className="max-w-md w-full bg-surface-1 border border-white/[0.08] rounded-2xl p-6">
        <h2 className="font-syne text-xl font-bold mb-2">Our Terms have been updated</h2>
        <p className="text-text-muted text-sm leading-relaxed mb-4">
          We've updated our{' '}
          <Link to="/platform/terms" target="_blank" className="text-brand-violet-light">Terms of Service</Link>
          {' '}and{' '}
          <Link to="/platform/privacy" target="_blank" className="text-brand-violet-light">Privacy Policy</Link>.
          Please review and accept the new version to continue using VERGR.
        </p>
        <button
          onClick={handleAccept}
          disabled={saving}
          className="w-full py-3 rounded-xl bg-gradient-to-r from-brand-violet to-brand-pink text-white text-sm font-bold disabled:opacity-50">
          {saving ? 'Saving…' : 'I accept the updated Terms'}
        </button>
      </div>
    </div>
  );
}
