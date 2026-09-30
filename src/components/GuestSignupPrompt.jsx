// GuestSignupPrompt: the one "you need an account for this" dialog.
//
// Opened through dispatchGuestPrompt() (utils/guestPrompt.js) from anywhere:
// GuestRouteGate, and every purchase entry point (adding to the basket,
// opening the basket, web checkout, Google Play / AppGallery billing). Guests
// may browse but never buy, and the purchase check runs BEFORE any payment
// sheet opens, so nobody pays and is then refused.
//
// Mounted once in AppRouter. Bottom sheet on phones and in the app, centred
// dialog on desktop.
//
// Design rules (founder): solid surfaces only, no hairline borders, no
// see-through tints on cards or buttons. The scrim is the only translucent
// layer, and it carries no blur.

import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import Icon from './Icon';
import useResponsive from '../hooks/useResponsive';
import { GUEST_PROMPT_EVENT } from '../utils/guestPrompt';

const C = {
  scrim: 'rgba(6,6,12,0.74)',
  panel: '#14141F',
  handle: '#2A2A38',
  secondary: '#22222F',
  secondaryHover: '#2A2A3A',
  title: '#FFFFFF',
  body: '#A1A1B3',
  quiet: '#8B8B9E',
  violet: '#7B1FFF',
  violetLight: '#B44FFF',
};

function copyFor(prompt) {
  if (prompt.kind === 'purchase') {
    return {
      title: 'Log in or create an account',
      body: 'You need an account to buy Coins, boosts and plans. Creating one is free and takes about a minute.',
    };
  }
  return {
    title: 'Log in or create an account',
    body: `You're browsing as a guest. Log in or create a free account to ${prompt.actionLabel}.`,
  };
}

export default function GuestSignupPrompt() {
  const [prompt, setPrompt] = useState(null);
  const navigate = useNavigate();
  const { isDesktop } = useResponsive();
  const reduce = useReducedMotion();
  const primaryRef = useRef(null);

  useEffect(() => {
    const handler = (e) => {
      const d = (e && e.detail) || {};
      setPrompt({ actionLabel: d.actionLabel || 'do that', kind: d.kind || null });
    };
    window.addEventListener(GUEST_PROMPT_EVENT, handler);
    return () => window.removeEventListener(GUEST_PROMPT_EVENT, handler);
  }, []);

  const open = !!prompt;

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
  // Sign-up converts the anonymous session with linkWithCredential, so the
  // guest keeps the same uid. Log in simply replaces the guest session.
  const goSignup = () => { close(); navigate('/signup'); };
  const goLogin = () => { close(); navigate('/login'); };

  const copy = prompt ? copyFor(prompt) : null;
  const purchase = prompt?.kind === 'purchase';

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
            aria-labelledby="guest-prompt-title"
            aria-describedby="guest-prompt-body"
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
              // The sheet sits ABOVE Vergr's bottom nav (z 9998 vs 50) and
              // covers it, so unlike Modal.jsx it does not reserve the nav's
              // height; only the system gesture bar.
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

            {/* Art: the real Coin for a purchase, a solid violet disc otherwise. */}
            <div className="flex justify-center">
              {purchase ? (
                <img
                  src="/brand/vc-coin.webp"
                  alt=""
                  width={76}
                  height={76}
                  style={{ width: 76, height: 76, objectFit: 'contain', filter: 'drop-shadow(0 10px 22px rgba(240,165,0,0.32))' }}
                />
              ) : (
                <div
                  className="flex items-center justify-center"
                  style={{
                    width: 64, height: 64, borderRadius: 999,
                    background: `linear-gradient(135deg, ${C.violet}, ${C.violetLight})`,
                    boxShadow: '0 10px 24px rgba(123,31,255,0.35)',
                  }}
                >
                  <Icon name="person_add" size={30} className="text-white" />
                </div>
              )}
            </div>

            <h2
              id="guest-prompt-title"
              className="font-syne text-center"
              style={{ color: C.title, fontSize: 21, lineHeight: '26px', fontWeight: 700, marginTop: 16, textWrap: 'balance' }}
            >
              {copy?.title}
            </h2>
            <p
              id="guest-prompt-body"
              className="text-center mx-auto"
              style={{ color: C.body, fontSize: 14, lineHeight: '21px', marginTop: 8, maxWidth: 330, textWrap: 'balance' }}
            >
              {copy?.body}
            </p>

            <div className="flex flex-col" style={{ gap: 10, marginTop: 22 }}>
              <button
                ref={primaryRef}
                type="button"
                onClick={goSignup}
                className="w-full font-bold text-white transition-[filter] hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80"
                style={{
                  height: 50, borderRadius: 14, fontSize: 15,
                  background: `linear-gradient(135deg, ${C.violet}, ${C.violetLight})`,
                }}
              >
                Create a free account
              </button>
              <button
                type="button"
                onClick={goLogin}
                className="w-full font-semibold text-white transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80"
                style={{ height: 50, borderRadius: 14, fontSize: 15, background: C.secondary }}
                onMouseEnter={(e) => { e.currentTarget.style.background = C.secondaryHover; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = C.secondary; }}
              >
                Log in
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
