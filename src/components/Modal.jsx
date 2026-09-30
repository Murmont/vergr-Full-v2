import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import Icon from './Icon';

export default function Modal({ isOpen, onClose, title, children, fullScreen = false }) {
  // ⚠⚠ `var(--vg-safe-b, 0px)` IS THE GESTURE BAR, NOT VERGR'S OWN NAV.
  // A sheet opened over a screen that still shows BottomNav lost its last 56px
  // to that nav: measured on the emulator 2026-09-11 (1.0.209), the tip sheet's
  // "Send 500" button was cut in half by the nav on the native public profile.
  // The inset only describes the SYSTEM bar, so the app's own bar has to be
  // measured. It is `position: fixed`, so its height is whatever it renders at
  // (including its own safe-bottom padding) and reading it once per open costs
  // one layout read, no listener.
  const [navPad, setNavPad] = useState(0);
  useEffect(() => {
    if (!isOpen) { setNavPad(0); return; }
    const nav = document.querySelector('[data-vg-bottomnav]');
    // getBoundingClientRect, not offsetHeight: the nav animates and we want the
    // painted height. A hidden nav (immersive routes) measures 0, which is
    // correct, and no nav at all leaves the padding untouched.
    setNavPad(nav ? Math.round(nav.getBoundingClientRect().height) : 0);
  }, [isOpen]);

  useEffect(() => {
    if (isOpen) document.body.style.overflow = 'hidden';
    else document.body.style.overflow = '';
    return () => { document.body.style.overflow = ''; };
  }, [isOpen]);

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-[90] flex items-end justify-center" onClick={onClose}>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
          />
          <motion.div
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', stiffness: 400, damping: 35, mass: 0.8 }}
            className={`relative w-full max-w-[480px] bg-surface-1 border-t border-white/[0.06] ${
              fullScreen ? 'h-full rounded-none' : 'rounded-t-2xl max-h-[85vh]'
            }`}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Handle bar */}
            {!fullScreen && (
              <div className="flex justify-center pt-3 pb-1">
                <div className="w-9 h-1 rounded-full bg-white/[0.08]" />
              </div>
            )}
            {/* Header */}
            {title && (
              <div className="flex items-center justify-between px-4 py-3 border-b border-white/[0.04]">
                <h2 className="font-syne text-base font-bold">{title}</h2>
                <button onClick={onClose} className="w-7 h-7 rounded-full flex items-center justify-center text-text-muted hover:text-text-primary transition-colors">
                  <Icon name="close" size={18} />
                </button>
              </div>
            )}
            {/* Bottom-anchored sheet: without the safe-area allowance the last
                control (usually the primary button) sits under the Android
                gesture/nav bar and cannot be tapped. `navPad` adds Vergr's OWN
                bottom nav on top of that, which the inset does not describe. */}
            <div
              className="overflow-y-auto p-4"
              style={{ paddingBottom: `calc(var(--vg-safe-b, 0px) + 16px + ${navPad}px)` }}
            >
              {children}
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
