// Warm the chunks behind the primary navigation, so tapping a tab never shows a
// Suspense fallback.
//
// WHY THIS EXISTS: the router was one 6.6MB chunk, so every screen was already in
// memory and navigation was instant. Splitting it into 311 lazy boundaries cut
// cold start by 57%, but it moved the cost to the first visit of each screen —
// and a chunk that has not loaded yet suspends, which flashed the full branded
// loading screen for a few tens of milliseconds. Fast, but visible, and a
// full-screen splash for a tab switch looks broken.
//
// So: keep the boot chunk small, then quietly fetch the tabs the user is most
// likely to press while the device is idle. By the time they press one it is
// already in memory and there is nothing to suspend on.
//
// The imports below MUST be static string literals matching the ones in
// AppRouter, or Rollup emits a second copy of the chunk instead of reusing it.

import { IS_NATIVE_BUILD } from './platform';

let started = false;

/** The bottom-nav destinations, in the order people actually reach for them. */
function primaryRoutes() {
  return IS_NATIVE_BUILD
    ? [
        () => import('../screens/explore/native/NativeExploreScreen'),
        () => import('../screens/messages/native/NativeMessageScreens'),
        () => import('../screens/shorts/native/NativeShortsScreen'),
        () => import('../screens/profile/native/NativeProfileScreens'),
      ]
    : [
        () => import('../screens/explore/ExploreScreen'),
        () => import('../layouts/MessagesMasterDetail'),
        () => import('../screens/shorts/ShortsScreen'),
        () => import('../screens/profile/ProfileScreen'),
      ];
}

const idle = (fn) =>
  typeof requestIdleCallback === 'function'
    ? requestIdleCallback(fn, { timeout: 3000 })
    : setTimeout(fn, 300);

/**
 * Fetch the primary route chunks one at a time on idle. Sequential on purpose:
 * firing four imports at once on a phone competes with the feed's own images and
 * makes the screen the user is actually looking at slower.
 */
export function prefetchPrimaryRoutes() {
  if (started) return;
  started = true;
  const queue = primaryRoutes();
  const next = () => {
    const load = queue.shift();
    if (!load) return;
    // A failed prefetch is not an error: the route still works, it just loads on
    // demand. Never let it surface.
    load().catch(() => {}).finally(() => idle(next));
  };
  idle(next);
}
