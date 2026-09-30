// VerifyEmailPrompt: the one "verify your email first" dialog (founder,
// 2026-09-29: every account is asked, existing ones included).
//
// Opens two ways:
//   1. once per app session, shortly after sign-in, for any account whose email
//      is not verified (the "prompted" half of the founder's decision);
//   2. whenever something is blocked: dispatchVerifyPrompt() from
//      utils/emailGate.js (posting, messaging, buying, a relay refusal).
//
// Unverified accounts can still browse, like and follow, so "Not now" is always
// offered. The enforcement is server-side (firestore.rules, the chat relay,
// checkout); this only explains it before a write fails.
//
// Mounted once in AppRouter. Same construction as GuestSignupPrompt: solid
// surfaces, no hairlines, a bottom sheet on phones and a dialog on desktop.

import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { onAuthStateChanged } from 'firebase/auth';
import { auth } from '../firebase/config';
import Icon from './Icon';
import useResponsive from '../hooks/useResponsive';
import { VERIFY_PROMPT_EVENT, needsEmailVerification } from '../utils/emailGate';

const C = {
  scrim: 'rgba(6,6,12,0.74)',
  panel: '#14141F',
  handle: '#2A2A38',
  secondary: '#22222F',
  secondaryHover: '#2A2A3A',
  title: '#FFFFFF',
  body: '#A1A1B3',
  quiet: '#8B8B9E',
  email: '#C9A6FF',
  violet: '#7B1FFF',
  violetLight: '#B44FFF',
};

// Screens where the prompt would be in the way of the thing it asks for.
const QUIET_PATHS = ['/login', '/signup', '/verify-email', '/unsubscribe', '/onboarding', '/forgot-password', '/platform'];
const SESSION_KEY = 'vergr.verifyPromptShown';

export default function VerifyEmailPrompt() {
  const [prompt, setPrompt] = useState(null); // { actionLabel } | { startup: true }
  const navigate = useNavigate();
  const location = useLocation();
  const { isDesktop } = useResponsive();
  const reduce = useReducedMotion();
  const primaryRef = useRef(null);
  const pathRef = useRef(location.pathname);
  pathRef.current = location.pathname;

  const quiet = (p) => QUIET_PATHS.some((q) => p === q || p.startsWith(q + '/'));

  // Blocked actions.
  useEffect(() => {
    const handler = (e) => {
      const d = (e && e.detail) || {};
      setPrompt({ actionLabel: d.actionLabel || 'do that' });
    };
    window.addEventListener(VERIFY_PROMPT_EVENT, handler);
    return () => window.removeEventListener(VERIFY_PROMPT_EVENT, handler);
  }, []);

  // Once per session, after Firebase has restored the account.
  useEffect(() => {
    let timer = null;
    const unsub = onAuthStateChanged(auth, () => {
      clearTimeout(timer);
      if (!needsEmailVerification()) return;
      let shown = false;
      try { shown = sessionStorage.getItem(SESSION_KEY) === '1'; } catch { /* private mode */ }
      if (shown) return;
      // A short delay, so it lands after the first screen has painted rather
      // than over a blank app.
      timer = setTimeout(() => {
        if (!needsEmailVerification() || quiet(pathRef.current)) return;
        try { sessionStorage.setItem(SESSION_KEY, '1'); } catch { /* ignore */ }
        setPrompt((p) => p || { startup: true });
      }, 2500);
    });
    return () => { clearTimeout(timer); unsub(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const open = !!prompt && !quiet(location.pathname);

  useEffect(() => {
    if (!open) return undefined;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e) => { if (e.key === 'Escape') setPrompt(null); };
    window.addEventListener('keydown', onKey);
    const t = setTimeout(() => primaryRef.current?.focus(), 60);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener('keydown', onKey);
      clearTimeout(t);
    };
  }, [open]);

  const close = () => setPrompt(null);
  const goVerify = () => {
    close();
    const next = location.pathname + location.search;
    navigate(`/verify-email?next=${encodeURIComponent(next)}`);
  };

  const email = auth.currentUser?.email || '';
  const title = prompt?.startup ? 'Verify your email' : `Verify your email to ${prompt?.actionLabel || 'continue'}`;
  const body = prompt?.startup
    ? 'Until your email is verified you can browse Vergr, but you can’t post, message or buy. It takes one tap.'
    : 'Posting, messaging and buying need a verified email. It takes one tap.';

  const sheet = !isDesktop;
  const panelMotion = reduce
    ? { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 } }
    : sheet
      ? { initial: { y: '100%' }, animate: { y: 0 }, exit: { y: '100%' } }
      : { initial: { opacity: 0, scale: 0.96, y: 8 }, animate: { opacity: 1, scale: 1, y: 0 }, exit: { opacity: 0, scale: 0.97, y: 6 } };

  return (
    <AnimatePresence>
      {open && (
        <div
          className={`fixed inset-0 z-[9998] flex justify-center ${sheet ? 'items-end' : 'items-center p-6'}`}
          onClick={close}
        >
          <motion.div
            className="absolute inset-0"
            style={{ background: C.scrim }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
          />
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-labelledby="verify-prompt-title"
            aria-describedby="verify-prompt-body"
            {...panelMotion}
            transition={sheet && !reduce
              ? { type: 'spring', stiffness: 420, damping: 38, mass: 0.8 }
              : { duration: 0.18, ease: [0.2, 0.8, 0.2, 1] }}
            onClick={(e) => e.stopPropagation()}
            className="relative w-full"
            style={{
              maxWidth: sheet ? 520 : 400,
              background: C.panel,
              borderRadius: sheet ? '24px 24px 0 0' : 24,
              boxShadow: '0 -8px 40px rgba(0,0,0,0.45), 0 24px 64px rgba(0,0,0,0.55)',
              // Above Vergr's bottom nav (z 9998 vs 50): reserve only the gesture bar.
              padding: sheet
                ? '12px 20px calc(20px + var(--vg-safe-b,0px))'
                : '28px 28px 22px',
            }}
          >
            {sheet && (
              <div className="flex justify-center" style={{ marginBottom: 18 }}>
                <div style={{ width: 36, height: 4, borderRadius: 2, background: C.handle }} />
              </div>
            )}

            <div className="flex justify-center">
              <div
                className="flex items-center justify-center"
                style={{
                  width: 64, height: 64, borderRadius: 999,
                  background: `linear-gradient(135deg, ${C.violet}, ${C.violetLight})`,
                  boxShadow: '0 10px 24px rgba(123,31,255,0.35)',
                }}
              >
                <Icon name="mark_email_unread" size={30} className="text-white" />
              </div>
            </div>

            <h2
              id="verify-prompt-title"
              className="font-syne text-center"
              style={{ color: C.title, fontSize: 21, lineHeight: '26px', fontWeight: 700, marginTop: 16, textWrap: 'balance' }}
            >
              {title}
            </h2>
            <p
              id="verify-prompt-body"
              className="text-center mx-auto"
              style={{ color: C.body, fontSize: 14, lineHeight: '21px', marginTop: 8, maxWidth: 340, textWrap: 'balance' }}
            >
              {body}
            </p>
            {email && (
              <p className="text-center break-all" style={{ color: C.email, fontSize: 14, fontWeight: 600, marginTop: 10 }}>
                {email}
              </p>
            )}

            <div className="flex flex-col" style={{ gap: 10, marginTop: 22 }}>
              <button
                ref={primaryRef}
                type="button"
                onClick={goVerify}
                className="w-full font-bold text-white transition-[filter] hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80"
                style={{
                  height: 50, borderRadius: 14, fontSize: 15,
                  background: `linear-gradient(135deg, ${C.violet}, ${C.violetLight})`,
                }}
              >
                Send me the verification email
              </button>
              <button
                type="button"
                onClick={close}
                className="w-full transition-colors hover:text-white focus-visible:outline-none focus-visible:text-white"
                style={{ height: 40, fontSize: 13, color: C.quiet }}
              >
                Not now
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
