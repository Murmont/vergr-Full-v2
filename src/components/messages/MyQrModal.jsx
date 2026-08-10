// MyQrModal — shows the current user's "add me" QR code. Pairs with the native
// QR scanner (qrScanner.js / ScannerActivity): another person scans this and is
// deep-linked straight to your profile to follow you. The encoded value is a
// canonical https://vergr.app/user/<uid> link, which the scanner routes in-app
// (qrValueToPath) and a plain phone camera opens on the web too. Works on every
// platform (pure JS); no native bridge required to DISPLAY a QR.

import { useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { auth } from '../../firebase/config';
import { useUser } from '../../context/UserContext';
import { useUI } from '../../context/UIContext';
import UserAvatar from '../UserAvatar';
import Icon from '../Icon';

// `user` (optional): show THAT profile's QR instead of your own — lets the
// profile share row offer "QR code" for any profile you're viewing.
export default function MyQrModal({ open, onClose, user = null }) {
  const { profile: ownProfile } = useUser();
  const { showToast } = useUI();
  const [copied, setCopied] = useState(false);
  if (!open) return null;

  const profile = user || ownProfile;
  const isOwn = !user || user.id === (auth.currentUser?.uid || ownProfile?.uid);
  const uid = user?.id || auth.currentUser?.uid || ownProfile?.uid;
  // Prefer the readable username in the link; /user/:id resolves by username OR
  // uid, so fall back to the (permanent) uid only when there's no handle yet.
  const slug = profile?.username || uid;
  const url = slug ? `https://vergr.app/user/${encodeURIComponent(slug)}` : 'https://vergr.app';
  const handle = profile?.username ? `@${profile.username}` : (profile?.displayName || 'You');

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      showToast?.('Could not copy link', 'error');
    }
  };
  const share = () => {
    if (navigator.share) {
      navigator.share({ title: handle, text: isOwn ? `Add me on Vergr — ${handle}` : `${handle} on Vergr`, url }).catch(() => {});
    } else {
      copyLink();
    }
  };

  return (
    <div className="fixed inset-0 z-[95] flex items-center justify-center p-4" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-[2px]" onClick={onClose} />
      <div
        className="relative w-full max-w-[340px] rounded-3xl bg-surface-1 border border-white/[0.06] p-6 flex flex-col items-center"
        style={{ boxShadow: '0 0 0 1px rgba(180,79,255,0.35), 0 0 60px rgba(123,31,255,0.28)' }}
      >
        <button
          onClick={onClose}
          className="absolute top-3 right-3 w-8 h-8 rounded-full flex items-center justify-center text-text-secondary hover:bg-white/[0.06]"
          aria-label="Close"
        >
          <Icon name="close" size={20} />
        </button>

        <div className="flex flex-col items-center gap-1 mb-4">
          <UserAvatar src={profile?.avatar} size={56} />
          <p className="text-white font-bold text-base mt-1">{handle}</p>
          <p className="text-text-muted text-xs">{isOwn ? 'Scan to add me on Vergr' : 'Scan to open this profile'}</p>
        </div>

        {/* White card keeps the QR high-contrast on any theme. */}
        <div className="rounded-2xl bg-white p-4">
          <QRCodeSVG value={url} size={200} bgColor="#ffffff" fgColor="#0B0B14" level="M" />
        </div>

        <div className="flex items-center gap-2 mt-5 w-full">
          <button
            onClick={copyLink}
            className="flex-1 flex items-center justify-center gap-2 h-11 rounded-xl bg-white/[0.06] hover:bg-white/[0.1] text-white text-sm font-semibold transition-colors"
          >
            <Icon name={copied ? 'check' : 'link'} size={18} />
            {copied ? 'Copied' : 'Copy link'}
          </button>
          <button
            onClick={share}
            className="flex-1 flex items-center justify-center gap-2 h-11 rounded-xl text-white text-sm font-semibold transition-opacity hover:opacity-90"
            style={{ background: 'linear-gradient(135deg, #9D4EFF, #6E1FD1)' }}
          >
            <Icon name="share" size={18} />
            Share
          </button>
        </div>
      </div>
    </div>
  );
}
