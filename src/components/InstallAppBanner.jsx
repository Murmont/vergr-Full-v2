import { useEffect, useState } from 'react';
import { APP_VERSION } from '../utils/appVersion';

// ──────────────────────────────────────────────────────────────
// Global "Get the app" banner.
//
// Platform-aware download, NOT a generic PWA prompt:
//   • Android phone (browser)  → download the real native APK (/downloads/VERGR.apk)
//   • Desktop / PC (browser)   → download the desktop installer (cdn.vergr.app, $0 egress)
//   • iPhone / iPad (Safari)   → "Add to Home Screen" hint (Apple blocks
//                                programmatic + direct-install, so a PWA is
//                                the only path on iOS until App Store)
//
// Hidden when already running inside a native shell (Tauri desktop/mobile)
// or when launched as an installed standalone PWA.
// ──────────────────────────────────────────────────────────────

const DISMISS_KEY = 'vergr.installBanner.dismissed';

// Cache-bust + versioned save name so a new release never collides with an old
// VERGR.apk already sitting in the user's Downloads ("file already exists" /
// silently reinstalling the stale build).
const APK_URL = `https://cdn.vergr.app/downloads/VERGR.apk?v=${APP_VERSION}`;
const APK_FILENAME = `VERGR-${APP_VERSION}.apk`;
const DESKTOP_URL = 'https://cdn.vergr.app/downloads/VERGR-Setup.exe';

function isStandalone() {
  if (typeof window === 'undefined') return false;
  return (
    window.matchMedia?.('(display-mode: standalone)').matches ||
    window.navigator.standalone === true
  );
}

function detect() {
  const ua = (typeof navigator !== 'undefined' && navigator.userAgent) || '';
  const isAndroid = /android/i.test(ua);
  const isIOS = /iphone|ipad|ipod/i.test(ua) && !window.MSStream;
  // Tauri (desktop OR mobile native shell) exposes these globals.
  const inNativeShell =
    typeof window !== 'undefined' && (!!window.__TAURI__ || '__TAURI_INTERNALS__' in window);
  return { isAndroid, isIOS, isDesktop: !isAndroid && !isIOS, inNativeShell };
}

export default function InstallAppBanner() {
  const [visible, setVisible] = useState(false);
  const [plat, setPlat] = useState({ isAndroid: false, isIOS: false, isDesktop: false });

  useEffect(() => {
    if (isStandalone()) return; // already installed as a PWA
    const p = detect();
    if (p.inNativeShell) return; // already in the native app, nothing to offer
    try {
      if (localStorage.getItem(DISMISS_KEY) === '1') return;
    } catch {}
    setPlat(p);
    // Small delay so it doesn't fight the first paint.
    const t = setTimeout(() => setVisible(true), p.isIOS ? 2500 : 1200);
    return () => clearTimeout(t);
  }, []);

  const dismiss = () => {
    setVisible(false);
    try { localStorage.setItem(DISMISS_KEY, '1'); } catch {}
  };

  if (!visible) return null;

  // Per-platform copy + action.
  let title = 'Get the VERGR app';
  let subtitle = '';
  let href = null;
  let ctaLabel = '';
  let icon = 'install_mobile';
  if (plat.isAndroid) {
    subtitle = 'Real native app: full-screen + push notifications.';
    href = APK_URL;
    ctaLabel = 'Download';
    icon = 'android';
  } else if (plat.isDesktop) {
    subtitle = 'Native window, system notifications, background run.';
    href = DESKTOP_URL;
    ctaLabel = 'Download';
    icon = 'desktop_windows';
  } else {
    // iOS
    subtitle = 'Tap Share, then “Add to Home Screen”.';
    icon = 'ios_share';
  }

  return (
    <div
      className="fixed inset-x-0 z-[120] px-3 safe-bottom"
      style={{ bottom: 'calc(env(safe-area-inset-bottom, 0px) + 76px)' }}
    >
      {/* Rotating conic-gradient ring draws the eye. */}
      <style>{'@keyframes vergrBannerSpin{to{transform:translate(-50%,-50%) rotate(360deg)}}'}</style>
      <div className="relative mx-auto max-w-md overflow-hidden rounded-2xl p-[2px]">
        <span
          aria-hidden
          className="pointer-events-none absolute left-1/2 top-1/2 aspect-square w-[200%]"
          style={{
            transform: 'translate(-50%, -50%)',
            transformOrigin: 'center',
            background:
              'conic-gradient(from 0deg, #B44FFF 0deg, #7B1FFF 70deg, #14141F 150deg, #14141F 280deg, #B44FFF 360deg)',
            animation: 'vergrBannerSpin 3s linear infinite',
          }}
        />
        <div
          className="relative flex items-center gap-3 rounded-[14px] px-3 py-2.5 shadow-2xl"
          style={{
            background: 'rgba(20,20,31,0.97)',
            backdropFilter: 'blur(12px)',
            boxShadow: '0 8px 32px rgba(123,31,255,0.30)',
          }}
        >
          <img
            src="/icons/icon-192-v2.png"
            alt="VERGR"
            width={40}
            height={40}
            className="h-10 w-10 flex-shrink-0 rounded-xl"
          />
          <div className="min-w-0 flex-1">
            <p className="font-syne text-sm font-semibold text-white">{title}</p>
            <p className="truncate text-xs text-text-secondary">{subtitle}</p>
          </div>
          {href && (
            <a
              href={href}
              download={href === APK_URL ? APK_FILENAME : true}
              onClick={() => { try { localStorage.setItem(DISMISS_KEY, '1'); } catch {} }}
              className="flex-shrink-0 inline-flex items-center gap-1 rounded-xl px-3.5 py-2 text-sm font-semibold text-white"
              style={{ background: 'linear-gradient(135deg,#7B1FFF,#B44FFF)' }}
            >
              <span className="material-symbols-outlined" style={{ fontSize: 18 }}>{icon}</span>
              {ctaLabel}
            </a>
          )}
          <button
            onClick={dismiss}
            aria-label="Dismiss"
            className="flex-shrink-0 rounded-lg p-1.5 text-text-secondary hover:text-white"
          >
            <span className="material-symbols-outlined" style={{ fontSize: 20 }}>close</span>
          </button>
        </div>
      </div>
    </div>
  );
}
