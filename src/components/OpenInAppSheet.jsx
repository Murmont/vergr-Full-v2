// OpenInAppSheet — the phone-browser prompt, done the way X does it.
//
// Founder, 2026-09-14: "we need to do what X does, a popup that prompts the
// viewer on mobile to get the app after a few seconds but I don't want a small
// banner like we had, even if the user is an existing user it should show 'open
// in app'".
//
// X's mobile web shows a bottom sheet a few seconds in: the logo, one line on
// why the app is better, a primary "Open app" and a quiet "Not now". This is
// that, with two platform facts:
//
//   Android  "Open the VERGR app" is an intent:// link naming our package. Chrome
//            opens the installed app on this same page (MainActivity handles
//            https://vergr.app), and when the app is not installed Chrome follows
//            S.browser_fallback_url instead. A web page cannot see whether the
//            app is installed, so one button serves both, which is also why X
//            shows "Open app" to everyone.
//   iPhone   there is no iOS app, so the sheet offers what does exist: Add to
//            Home Screen, which opens VERGR full screen.
//
// ⚠ "NOT NOW" LASTS FOR THE BROWSER SESSION, not forever. The old banner wrote a
// permanent localStorage flag, so one tap hid it for good. X asks again on the
// next visit, and so does this.
import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import Icon from './Icon';
import { PLAY_LISTING_LIVE, PLAY_PACKAGE, playStoreUrl } from '../utils/referral';

const SESSION_KEY = 'vergr.openInApp.dismissed';
const DELAY_MS = 4000;
// Pages where a sheet over the screen would interrupt something the person is in
// the middle of: signing in, paying, a call, or already reading how to get the app.
const SKIP_PREFIXES = [
  '/login', '/signup', '/register', '/onboarding', '/auth', '/forgot', '/reset',
  '/verify', '/platform/download', '/call/', '/wallet/buy', '/checkout',
];
const DOWNLOAD_PAGE = 'https://vergr.app/platform/download/mobile';

export function phonePlatform() {
  if (typeof navigator === 'undefined' || typeof window === 'undefined') return null;
  const ua = navigator.userAgent || '';
  if (window.__TAURI__ || '__TAURI_INTERNALS__' in window) return null; // already the app
  const standalone = window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone === true;
  if (standalone) return null; // already installed to the home screen
  if (/android/i.test(ua) && /mobile/i.test(ua)) return 'android';
  if (/iphone|ipod/i.test(ua)) return 'ios';
  return null;
}

function openAppHref(location) {
  const ref = new URLSearchParams(location.search).get('ref');
  const fallback = PLAY_LISTING_LIVE ? playStoreUrl(ref) : DOWNLOAD_PAGE;
  const target = `vergr.app${location.pathname}${location.search}`;
  return `intent://${target}#Intent;scheme=https;package=${PLAY_PACKAGE};S.browser_fallback_url=${encodeURIComponent(fallback)};end`;
}

export default function OpenInAppSheet() {
  const location = useLocation();
  const [platform] = useState(phonePlatform);
  const [open, setOpen] = useState(false);
  const [steps, setSteps] = useState(false);

  const skipped = SKIP_PREFIXES.some((p) => location.pathname.startsWith(p));

  useEffect(() => {
    if (!platform || skipped || open) return undefined;
    try { if (sessionStorage.getItem(SESSION_KEY) === '1') return undefined; } catch { /* private mode */ }
    // If the tab is in the background when the delay ends, show it the moment
    // they come back rather than never (the timer does not run again until the
    // next navigation).
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      document.removeEventListener('visibilitychange', onVisible);
      setOpen(true);
    };
    const t = setTimeout(() => {
      if (document.visibilityState === 'visible') setOpen(true);
      else document.addEventListener('visibilitychange', onVisible);
    }, DELAY_MS);
    return () => { clearTimeout(t); document.removeEventListener('visibilitychange', onVisible); };
  }, [platform, skipped, open]);

  // Navigating into a page where it must not show closes it without counting as
  // a dismissal.
  useEffect(() => { if (skipped) setOpen(false); }, [skipped]);

  const dismiss = () => {
    setOpen(false);
    try { sessionStorage.setItem(SESSION_KEY, '1'); } catch { /* private mode */ }
  };

  if (!platform) return null;

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[140]" role="dialog" aria-modal="true" aria-labelledby="open-in-app-title">
          <motion.button
            type="button"
            aria-label="Close"
            onClick={dismiss}
            className="absolute inset-0 w-full h-full cursor-default"
            style={{ background: 'rgba(0,0,0,0.62)' }}
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          />
          <motion.div
            className="absolute inset-x-0 bottom-0 rounded-t-[24px] px-6 pt-3 text-center"
            style={{ background: '#14141F', paddingBottom: 'calc(24px + var(--vg-safe-b, 0px))' }}
            initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
            transition={{ type: 'spring', stiffness: 420, damping: 38 }}
          >
            <div className="mx-auto mb-5 h-1 w-10 rounded-full" style={{ background: '#2E2E3E' }} />
            <img src="/icons/icon-192-v2.png" alt="" width={64} height={64} className="mx-auto h-16 w-16 rounded-[18px]" />
            <h2 id="open-in-app-title" className="mt-4 font-syne text-[22px] font-extrabold leading-tight text-white">
              VERGR is better in the app
            </h2>

            {platform === 'android' ? (
              <>
                <p className="mx-auto mt-2 max-w-[320px] text-[15px] leading-snug text-text-secondary">
                  Full-screen clips, alerts when people you follow go live, and chat that keeps up.
                </p>
                <a
                  href={openAppHref(location)}
                  onClick={() => { try { sessionStorage.setItem(SESSION_KEY, '1'); } catch { /* private mode */ } }}
                  className="mt-6 flex h-[52px] w-full items-center justify-center rounded-full text-[16px] font-bold text-white active:scale-[0.98] transition-transform"
                  style={{ background: '#7B1FFF' }}
                >
                  Open the VERGR app
                </a>
              </>
            ) : steps ? (
              <ol className="mx-auto mt-4 max-w-[320px] space-y-3 text-left text-[15px] text-white">
                <li className="flex items-center gap-3">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full" style={{ background: '#222233' }}>
                    <Icon name="ios_share" size={20} />
                  </span>
                  Tap the Share button in Safari
                </li>
                <li className="flex items-center gap-3">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full" style={{ background: '#222233' }}>
                    <Icon name="add_box" size={20} />
                  </span>
                  Choose Add to Home Screen
                </li>
              </ol>
            ) : (
              <>
                <p className="mx-auto mt-2 max-w-[320px] text-[15px] leading-snug text-text-secondary">
                  Add VERGR to your Home Screen and it opens full screen, like an app.
                </p>
                <button
                  type="button"
                  onClick={() => setSteps(true)}
                  className="mt-6 flex h-[52px] w-full items-center justify-center rounded-full text-[16px] font-bold text-white active:scale-[0.98] transition-transform"
                  style={{ background: '#7B1FFF' }}
                >
                  Show me how
                </button>
              </>
            )}

            <button
              type="button"
              onClick={dismiss}
              className="mt-3 flex h-[52px] w-full items-center justify-center rounded-full text-[16px] font-bold text-white active:scale-[0.98] transition-transform"
              style={{ background: '#222233' }}
            >
              {steps ? 'Done' : 'Not now'}
            </button>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
