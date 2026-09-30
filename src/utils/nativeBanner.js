import { IS_NATIVE_BUILD } from './platform';
import { adUnitFor } from '../config/ads';

// Anchored AdMob banner for the native shell.
//
// The native feed used to render the AdSense in-feed slot, which left blank
// gaps: AdSense is a web-pages-only program and does not serve inside an app,
// and running it there puts the AdSense account — which also serves the website
// — at risk. AdMob is the sanctioned in-app path, but its ads are drawn by the
// SDK into a real Android view, so they cannot sit inline between feed cards.
// An anchored banner above the bottom nav is the standard answer and monetises
// every screen, not just the feed.

// ⚠ `adUnitFor('banner')` — NOT `ADS_CONFIG.admob.bannerUnitId`. That field is
// null, and reading it directly is what kept the banner off the Huawei build
// even after a real Petal banner slot existed for it.
export const isNativeBannerAvailable = () =>
  IS_NATIVE_BUILD && !!window.VergrBanner?.available?.() && !!adUnitFor('banner');

// Screens where a persistent banner would cover content or break immersion.
// Ads on a live stream or an active call are both a bad experience and an
// AdMob policy risk (an ad must not obscure interactive content).
const HIDDEN_PREFIXES = [
  '/watch', '/live', '/go-live', '/broadcast', '/call', '/group-call',
  '/shorts', '/messages/', '/squads/', '/wallet', '/kyc', '/onboarding',
];

export function shouldShowBanner(pathname) {
  if (!pathname) return false;
  return !HIDDEN_PREFIXES.some((p) => pathname === p || pathname.startsWith(p));
}

export function showNativeBanner() {
  if (!isNativeBannerAvailable()) return;
  try { window.VergrBanner.show(adUnitFor('banner')); } catch { /* no fill — stay clean */ }
}

export function hideNativeBanner() {
  if (!IS_NATIVE_BUILD) return;
  try { window.VergrBanner?.hide?.(); } catch { /* ignore */ }
}

/**
 * Drive the banner from the current route. Free tier only — a paying user must
 * never see an ad, which is the whole promise of the plan.
 */
export function syncNativeBanner(pathname, isFree) {
  if (!isNativeBannerAvailable()) return;
  if (isFree && shouldShowBanner(pathname)) showNativeBanner();
  else hideNativeBanner();
}
