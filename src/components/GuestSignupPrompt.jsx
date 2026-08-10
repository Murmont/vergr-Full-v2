// GuestSignupPrompt — listens for the GUEST_PROMPT_EVENT custom event
// and renders a global modal that nudges the user to upgrade their
// anonymous account into a permanent email/password account.
//
// Mounted once near the top of the authenticated app tree (alongside
// PushToast, ConsentSheet, etc.) so it's available everywhere.

import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Icon from './Icon';
import { GUEST_PROMPT_EVENT } from '../hooks/useGuestGate';

export default function GuestSignupPrompt() {
  const [actionLabel, setActionLabel] = useState(null);
  const navigate = useNavigate();

  useEffect(() => {
    const handler = (e) => {
      setActionLabel((e && e.detail && e.detail.actionLabel) || 'do that');
    };
    window.addEventListener(GUEST_PROMPT_EVENT, handler);
    return () => window.removeEventListener(GUEST_PROMPT_EVENT, handler);
  }, []);

  if (!actionLabel) return null;

  const close = () => setActionLabel(null);
  const goSignup = () => {
    close();
    // Signup detects the existing anonymous user and converts via
    // linkWithCredential, preserving the uid.
    navigate('/signup');
  };

  return (
    <div
      className="fixed inset-0 z-[9998] bg-black/70 backdrop-blur-sm flex items-center justify-center p-6"
      onClick={close}
    >
      <div
        className="max-w-sm w-full bg-surface-1 border border-white/[0.08] rounded-2xl p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mx-auto mb-4 h-12 w-12 rounded-full bg-brand-violet/15 text-brand-violet-light flex items-center justify-center">
          <Icon name="person_add" size={28} />
        </div>
        <h2 className="font-syne text-xl font-bold text-center mb-2">Sign up to {actionLabel}</h2>
        <p className="text-text-muted text-sm text-center leading-relaxed mb-5">
          You're browsing VERGR as a guest. Create a free account in a
          minute to {actionLabel} and unlock the full platform.
        </p>
        <button
          onClick={goSignup}
          className="w-full py-3 rounded-xl bg-gradient-to-r from-brand-violet to-brand-violet-light text-white text-sm font-bold shadow-lg shadow-brand-violet/30 hover:brightness-110"
        >
          Create my account
        </button>
        <button
          onClick={close}
          className="w-full mt-2 py-2 text-text-muted text-xs"
        >
          Not now
        </button>
      </div>
    </div>
  );
}
