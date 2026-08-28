// Creator Verification — identity check required before a creator can be paid.
//
// CANONICAL PROVIDER IS DIDIT. This screen used to mount `KycWizard`, which
// uploads encrypted ID images to Firebase Storage and writes
// `verification_applications` for a human to review. That is a second,
// document-storing identity system running alongside the real one, and it
// wrote none of the fields the platform actually gates on, so a creator could
// finish it and still be blocked forever.
//
// The state that matters is `users/{uid}.kyc`, written only by Didit's webhook
// (`functions/didit.js`), which also sets `users/{uid}.kycLevel = 1`. That
// level is what `creatorProgram.js` requires to apply and what
// `creatorPayouts.js` requires to pay.
import { useEffect, useState } from 'react';
import { doc, onSnapshot, updateDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../../firebase/config';
import { useAuth } from '../../context/AuthContext';
import Icon from '../../components/Icon';
import TopBar from '../../components/TopBar';
import DiditVerify from '../../components/verify/DiditVerify';

export default function CreatorVerificationScreen({ embedded = false, sessionId = null }) {
  const { currentUser } = useAuth();
  const [kyc, setKyc] = useState(null);
  const [kycLevel, setKycLevel] = useState(0);
  const [loading, setLoading] = useState(true);

  // `country` moved off the public user doc to users/{uid}/private/kyc, which
  // only the owner can read (audit A30): users/{uid} is world-readable, and
  // the KYC payload carried the age and government-ID country of every
  // verified user. The status half (`verified`, `failureReason`) stays on the
  // user doc, which is what the rest of the app gates on.
  const [kycPrivate, setKycPrivate] = useState(null);

  useEffect(() => {
    if (!currentUser) return;
    const unsub = onSnapshot(doc(db, 'users', currentUser.uid), (snap) => {
      const d = snap.data() || {};
      setKyc(d.kyc || null);
      setKycLevel(Number(d.kycLevel || 0));
      setLoading(false);
    }, () => setLoading(false));
    const unsubPriv = onSnapshot(doc(db, 'users', currentUser.uid, 'private', 'kyc'),
      (snap) => setKycPrivate(snap.exists() ? snap.data() : null),
      () => setKycPrivate(null));
    return () => { unsub(); unsubPriv(); };
  }, [currentUser]);

  // Mobile handoff page: mark the session scanned so the desktop tab updates.
  useEffect(() => {
    if (!sessionId) return;
    updateDoc(doc(db, 'verification_sessions', sessionId), { status: 'scanned' }).catch(() => {});
  }, [sessionId]);

  const markSessionComplete = async () => {
    if (!sessionId) return;
    try {
      await updateDoc(doc(db, 'verification_sessions', sessionId), {
        status: 'completed', completedAt: serverTimestamp(),
      });
    } catch { /* handoff session is best-effort */ }
  };

  const Body = () => {
    if (loading) return <Spinner />;

    if (kyc?.verified === true) {
      return (
        <div className="max-w-xl mx-auto">
          <div className="rounded-2xl border border-green-500/30 bg-green-500/5 p-6">
            <div className="flex items-start gap-4">
              <div className="w-12 h-12 rounded-full flex items-center justify-center shrink-0 bg-green-500/15">
                <Icon name="verified" filled size={24} className="text-green-400" />
              </div>
              <div className="flex-1">
                <h3 className="font-syne font-bold text-white text-lg">Identity verified</h3>
                <p className="text-text-secondary text-sm mt-1">
                  You can apply to the creator program, set up payouts and offer membership tiers.
                </p>
                <div className="mt-4 grid grid-cols-2 gap-2 text-xs">
                  <Tile label="Level" value={`Level ${kycLevel || 1}`} />
                  {/* Falls back to kyc.country for anyone verified before the
                      split, whose value is still on the old doc. */}
                  <Tile label="Country" value={kycPrivate?.country || kyc.country || '—'} />
                </div>
                <p className="text-[11px] text-text-muted mt-4">
                  Verified by Didit. Vergr never stores your documents.
                </p>
              </div>
            </div>
          </div>
        </div>
      );
    }

    // Not verified: a previous attempt may have failed, which is worth saying
    // before showing the button again.
    const failed = kyc?.failureReason && kyc?.checkedAt;
    const FAILURE_TEXT = {
      underage: 'You must be at least 18 to verify.',
      blocked_country: 'Your country is not eligible for verification.',
      declined: 'That attempt was declined. A clearer photo of your ID usually fixes it.',
      abandoned: 'The last attempt was not finished.',
      incomplete: 'The last attempt was not finished.',
    };

    return (
      <div className="max-w-2xl mx-auto">
        {failed && (
          <div className="mb-6 rounded-2xl border border-brand-ember/30 bg-brand-ember/5 p-4">
            <p className="text-brand-ember font-bold text-sm">Last attempt was not approved</p>
            <p className="text-text-secondary text-xs mt-1">
              {FAILURE_TEXT[kyc.failureReason] || 'Verification was not approved. You can try again.'}
            </p>
          </div>
        )}
        <DiditVerify onVerified={markSessionComplete} />
      </div>
    );
  };

  if (embedded) return <Body />;
  return (
    <div className="screen-container min-h-screen pb-8">
      <TopBar title="Creator Verification" showBack />
      <div className="px-4 py-4"><Body /></div>
    </div>
  );
}

function Spinner() {
  return <div className="flex justify-center py-16"><div className="w-6 h-6 border-2 border-brand-violet border-t-transparent rounded-full animate-spin" /></div>;
}
function Tile({ label, value }) {
  return <div className="bg-surface-1 rounded-xl p-3">
    <p className="text-text-muted uppercase tracking-wider text-[10px]">{label}</p>
    <p className="text-white font-bold mt-0.5 capitalize">{value}</p>
  </div>;
}
