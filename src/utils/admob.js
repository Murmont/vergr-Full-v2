// src/utils/admob.js — JS ↔ native AdMob bridge wrapper
// ─────────────────────────────────────────────────────────────────────
// AdMob only exists inside the native Android shell (the AdMobBridge Kotlin
// class registers `window.VergrAds`). On web / desktop this module no-ops, so
// callers can use it everywhere without branching.
//
// Rewarded ads are the ONLY native ad path we use today: a full-screen ad that,
// on genuine completion, triggers a server-side-verified coin credit (see
// functions/admobReward.js). The coin lands via the wallet subscription a moment
// after the ad closes — this module just runs the ad and resolves when it ends.
//
// Native bridge contract (AdMobBridge.kt):
//   window.VergrAds.available()                       -> "1" if the SDK is wired
//   window.VergrAds.showRewarded(uid, nonce, unitId)  -> loads + shows a rewarded
//                                                 ad, SSV userId=uid, customData=uid|nonce
// Events dispatched back on window:
//   vergr:ad-loaded     — ad fetched, about to show
//   vergr:ad-reward     — user earned the reward (ad watched to completion)
//   vergr:ad-dismissed  — ad closed (after reward or skip)
//   vergr:ad-failed     — { error } load/show failed

import { adUnitFor } from '../config/ads';

function bridge() {
  if (typeof window === 'undefined') return null;
  return window.VergrAds || null;
}

/** True only inside the native app with the AdMob SDK wired. */
export function isAdMobReady() {
  const b = bridge();
  if (!b) return false;
  try { return b.available() === '1' || b.available() === true; } catch { return false; }
}

function randNonce() {
  try {
    const a = new Uint8Array(12);
    (window.crypto || {}).getRandomValues?.(a);
    return Array.from(a).map((x) => x.toString(16).padStart(2, '0')).join('');
  } catch {
    return String(Date.now()) + Math.random().toString(16).slice(2);
  }
}

/**
 * Show a rewarded ad for the given user. Resolves:
 *   { rewarded: true }  if the user watched to completion (coins credited
 *                        server-side via SSV shortly after)
 *   { rewarded: false } if dismissed without earning
 * Rejects on load/show failure or if AdMob isn't available.
 */
export function showRewardedForCoins(uid) {
  return new Promise((resolve, reject) => {
    const b = bridge();
    if (!b || !uid) { reject(new Error('admob_unavailable')); return; }

    let earned = false;
    const cleanup = () => {
      window.removeEventListener('vergr:ad-reward', onReward);
      window.removeEventListener('vergr:ad-dismissed', onDismissed);
      window.removeEventListener('vergr:ad-failed', onFailed);
      clearTimeout(timeout);
    };
    const onReward = () => { earned = true; };
    const onDismissed = () => { cleanup(); resolve({ rewarded: earned }); };
    const onFailed = (e) => { cleanup(); reject(new Error((e && e.detail && e.detail.error) || 'admob_failed')); };

    // Safety: if no event arrives (bridge stalled), fail after 90s.
    const timeout = setTimeout(() => { cleanup(); reject(new Error('admob_timeout')); }, 90000);

    window.addEventListener('vergr:ad-reward', onReward);
    window.addEventListener('vergr:ad-dismissed', onDismissed);
    window.addEventListener('vergr:ad-failed', onFailed);

    try {
      // Same bridge name on both builds; only the slot id differs. On Huawei
      // the native side is HuaweiAdsBridge and AdMob unit ids mean nothing to
      // it, so it must be handed a Petal slot. `adUnitFor` is the one place
      // that decides which — see the note above it in config/ads.js.
      b.showRewarded(uid, randNonce(), adUnitFor('rewarded'));
    } catch (err) {
      cleanup();
      reject(err instanceof Error ? err : new Error('admob_show_threw'));
    }
  });
}
