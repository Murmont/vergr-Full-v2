// Desktop-to-mobile QR handoff.
// Creates a short-lived `verification_sessions/{sid}` doc, shows a QR that
// deep-links into /verify/mobile/:sid, and watches the session doc for
// completion. Users without phones can click "Continue on this device".
import { useEffect, useMemo, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { doc, setDoc, onSnapshot, serverTimestamp, Timestamp } from 'firebase/firestore';
import { db } from '../../firebase/config';
import { useAuth } from '../../context/AuthContext';
import Icon from '../Icon';
import { publicUrl } from '../../utils/publicUrl';

export default function DesktopQRHandoff({ onContinueHere }) {
  const { currentUser } = useAuth();
  const [sid] = useState(() => Math.random().toString(36).slice(2) + Date.now().toString(36));
  const [status, setStatus] = useState('idle'); // idle | scanned | completed | expired

  // The phone scanning this is never inside the desktop app, so the QR must
  // carry vergr.app, not the app's own tauri.localhost origin.
  const mobileUrl = useMemo(() => publicUrl(`/verify/mobile/${sid}`), [sid]);

  useEffect(() => {
    if (!currentUser) return;
    (async () => {
      await setDoc(doc(db, 'verification_sessions', sid), {
        sid, userId: currentUser.uid,
        status: 'pending',
        createdAt: serverTimestamp(),
        expiresAt: Timestamp.fromDate(new Date(Date.now() + 30 * 60 * 1000)),
      });
    })();

    const unsub = onSnapshot(doc(db, 'verification_sessions', sid), (snap) => {
      if (!snap.exists()) return;
      setStatus(snap.data().status || 'pending');
    });
    return () => unsub();
  }, [sid, currentUser]);

  return (
    <div className="max-w-md mx-auto text-center">
      <div className="w-16 h-16 rounded-full bg-brand-violet/10 mx-auto flex items-center justify-center mb-4">
        <Icon name="qr_code_2" size={32} className="text-brand-violet-light" />
      </div>
      <h2 className="font-syne font-bold text-white text-xl mb-1">Continue on your phone</h2>
      <p className="text-text-secondary text-sm mb-5">Camera-based verification works much better on mobile. Scan this QR code to pick up where you left off.</p>

      <div className="inline-block bg-white p-4 rounded-2xl mb-4">
        <QRCodeSVG value={mobileUrl} size={220} level="M" />
      </div>

      <p className="text-text-muted text-[11px] break-all max-w-xs mx-auto mb-4">{mobileUrl}</p>

      <div className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-bold mb-4 ${status === 'completed' ? 'bg-green-500/15 text-green-400' : status === 'scanned' ? 'bg-brand-violet/15 text-brand-violet-light' : 'bg-surface-2 text-text-muted'}`}>
        <span className={`w-1.5 h-1.5 rounded-full ${status === 'completed' ? 'bg-green-400' : status === 'scanned' ? 'bg-brand-violet animate-pulse' : 'bg-text-muted'}`} />
        {status === 'completed' ? 'Submitted from your phone' : status === 'scanned' ? 'Phone connected — continue there' : 'Waiting for your phone…'}
      </div>

      <div>
        <button onClick={onContinueHere} className="text-text-muted text-xs underline hover:text-white">
          Continue on this device instead
        </button>
      </div>
    </div>
  );
}
