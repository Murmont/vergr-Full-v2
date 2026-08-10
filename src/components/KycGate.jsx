// KycGate — wraps wallet, tournament, payout, and tip screens. If the
// signed-in user has not completed identity verification, renders the
// Persona verification CTA instead of the protected content.
//
// The server-side check is authoritative — every callable that touches
// money calls `assertKycVerified()` server-side. This component is the
// UX layer that lets the user actually do the verification.

import { useUser } from '../context/UserContext';
import { useAuth } from '../context/AuthContext';
import DiditVerify from './verify/DiditVerify';

export default function KycGate({ children, feature = 'this feature' }) {
  const { currentUser } = useAuth();
  const { profile, loading } = useUser();

  if (!currentUser) return children; // ProtectedRoute handles the auth gate
  if (loading) {
    return (
      <div className="min-h-[40vh] flex items-center justify-center text-text-muted text-sm">
        Loading…
      </div>
    );
  }

  const verified = profile?.kyc?.verified === true;
  // Founder bypass — `role:'admin'` is the platform owner; they're not a
  // user subject to KYC and need to dogfood every gated flow without
  // re-doing identity verification each time.
  const isFounder = profile?.role === 'admin';
  if (verified || isFounder) return children;

  return (
    <div className="min-h-[70vh] flex items-center justify-center px-6 py-10">
      <div className="w-full max-w-md">
        <DiditVerify />
        <p className="text-text-muted text-xs text-center mt-4 leading-relaxed">
          Identity verification is required for {feature}. This is a
          one-time check and unlocks the wallet, tournaments, and payouts.
        </p>
      </div>
    </div>
  );
}
