// Creator Verification — hosts the KYC wizard or a status card if already applied.
// Offers a desktop-to-mobile QR handoff for better camera UX.
import { useEffect, useState } from 'react';
import { doc, getDoc, onSnapshot, updateDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../../firebase/config';
import { useAuth } from '../../context/AuthContext';
import { useUser } from '../../context/UserContext';
import Icon from '../../components/Icon';
import TopBar from '../../components/TopBar';
import KycWizard from '../../components/verify/KycWizard';
import DesktopQRHandoff from '../../components/verify/DesktopQRHandoff';

const isMobileDevice = () => /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);

export default function CreatorVerificationScreen({ embedded = false, sessionId = null }) {
  const { currentUser } = useAuth();
  const { profile } = useUser();
  const [existing, setExisting] = useState(null);
  const [loading, setLoading] = useState(true);
  const [forceHere, setForceHere] = useState(false);

  useEffect(() => {
    if (!currentUser) return;
    const unsub = onSnapshot(doc(db, 'verification_applications', currentUser.uid), (snap) => {
      setExisting(snap.exists() ? { id: snap.id, ...snap.data() } : null);
      setLoading(false);
    }, () => setLoading(false));
    return () => unsub();
  }, [currentUser]);

  // On mobile handoff page, flip the session status to 'scanned'
  useEffect(() => {
    if (!sessionId) return;
    updateDoc(doc(db, 'verification_sessions', sessionId), { status: 'scanned' }).catch(() => {});
  }, [sessionId]);

  const handleComplete = async () => {
    if (sessionId) {
      try { await updateDoc(doc(db, 'verification_sessions', sessionId), { status: 'completed', completedAt: serverTimestamp() }); } catch {}
    }
  };

  const Body = () => {
    if (loading) return <Spinner />;

    if (existing && existing.status !== 'rejected') {
      const isApproved = existing.status === 'approved' || profile?.verified;
      const pending    = !isApproved;
      const needsManual = !!existing.needsManualReview;
      return (
        <div className="max-w-xl mx-auto">
          <div className={`rounded-2xl border p-6 ${isApproved ? 'border-green-500/30 bg-green-500/5' : 'border-yellow-500/30 bg-yellow-500/5'}`}>
            <div className="flex items-start gap-4">
              <div className={`w-12 h-12 rounded-full flex items-center justify-center shrink-0 ${isApproved ? 'bg-green-500/15' : 'bg-yellow-500/15'}`}>
                <Icon name={isApproved ? 'verified' : 'hourglass_top'} filled size={24} className={isApproved ? 'text-green-400' : 'text-yellow-400'} />
              </div>
              <div className="flex-1">
                <h3 className="font-syne font-bold text-white text-lg">{isApproved ? 'Verified creator' : needsManual ? 'Under manual review' : 'Under review'}</h3>
                <p className="text-text-secondary text-sm mt-1">
                  {isApproved && 'You can launch ad campaigns, request payouts and offer membership tiers.'}
                  {pending && !needsManual && 'Automated checks passed. Final approval usually within 48 hours.'}
                  {pending && needsManual && 'A reviewer will take a closer look — this is normal for some lighting, document layouts or edge cases.'}
                </p>
                <div className="mt-4 grid grid-cols-2 gap-2 text-xs">
                  <Tile label="Status" value={isApproved ? 'Approved' : existing.status} />
                  <Tile label="Country" value={existing.country || '—'} />
                </div>
                <p className="text-[11px] text-text-muted mt-4">Raw documents are encrypted and auto-delete 90 days after a decision.</p>
              </div>
            </div>
          </div>
        </div>
      );
    }

    // New or rejected: offer mobile handoff on desktop, else wizard directly
    if (!isMobileDevice() && !forceHere && !sessionId) {
      return <DesktopQRHandoff onContinueHere={() => setForceHere(true)} />;
    }
    return (
      <>
        {existing?.status === 'rejected' && (
          <div className="max-w-2xl mx-auto mb-6 rounded-2xl border border-brand-ember/30 bg-brand-ember/5 p-4">
            <p className="text-brand-ember font-bold text-sm">Previous application rejected</p>
            <p className="text-text-secondary text-xs mt-1">{existing.rejectionReason || 'Please review your details and resubmit.'}</p>
          </div>
        )}
        <KycWizard onComplete={handleComplete} />
      </>
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
