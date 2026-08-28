// Forcing Firestore back onto the network when a listener has silently gone
// cache-only.
//
// THE FAILURE THIS EXISTS FOR
//
// `persistentLocalCache` is on, which is what makes the app paint instantly on a
// cold open and work offline. The cost is that when the realtime channel stalls,
// `onSnapshot` does not error: it keeps serving the last cached document
// forever. The screen looks synced and is showing an old number, with nothing
// anywhere indicating it.
//
// That was tolerable for a post or a chat row. It is not tolerable for a coin
// balance, which is money, and it is exactly how a wallet can read 68 while the
// server says 224.
//
// WHAT THIS DOES
//
// Nothing, until something reports that it is being served from cache. Then, on
// the next moment the app is plausibly online (regained focus, tab became
// visible, the browser fired `online`), it cycles the Firestore network. That
// tears down the stalled stream and forces a fresh one, and every listener in
// the app gets server data again, not just the one that noticed.
//
// Cycling the network is deliberately the whole hammer rather than re-attaching
// one listener: the stall is at the transport, so fixing one subscription would
// leave the other 131 stale.

import { disableNetwork, enableNetwork } from 'firebase/firestore';
import { db } from './config';

// Set by any listener that receives a cache-only snapshot, cleared the moment
// one arrives from the server.
let cacheOnlySince = 0;
let resyncing = false;
let lastResyncAt = 0;

// How long a listener may sit on cache before we treat it as stalled rather
// than as an ordinary offline moment. Short enough that a user does not stare
// at a wrong balance; long enough that a normal cold start (which legitimately
// serves cache first, then server a moment later) never triggers it.
const STALL_MS = 6_000;

// Never cycle more often than this. A resync is cheap but not free, and a
// genuinely offline device would otherwise thrash on every focus event.
const MIN_INTERVAL_MS = 20_000;

/**
 * Report the cache/server status of a snapshot.
 *
 * Call from any listener that matters. `fromCache` comes straight from
 * `snapshot.metadata.fromCache`.
 */
export function reportSnapshotSource(fromCache) {
  if (fromCache) {
    if (!cacheOnlySince) cacheOnlySince = Date.now();
  } else {
    cacheOnlySince = 0;
  }
}

/** True when a listener has been stuck on cached data long enough to matter. */
export function isStalled() {
  return !!cacheOnlySince && (Date.now() - cacheOnlySince) > STALL_MS;
}

/**
 * Force a fresh connection.
 *
 * Safe to call at any time: if the device really is offline, `enableNetwork`
 * simply leaves the SDK trying, which is what it would be doing anyway.
 */
export async function resyncNow() {
  if (!db || resyncing) return;
  if (Date.now() - lastResyncAt < MIN_INTERVAL_MS) return;
  resyncing = true;
  lastResyncAt = Date.now();
  try {
    await disableNetwork(db);
    await enableNetwork(db);
  } catch (e) {
    // A failed cycle must never break the app; the next trigger tries again.
    console.warn('firestore resync failed:', e?.message || e);
  } finally {
    resyncing = false;
  }
}

/**
 * Watch for the moments when a stalled connection can plausibly be recovered.
 *
 * Mounted once, from UserContext. Deliberately event-driven rather than a
 * timer: polling would cycle the network on a device that is simply offline and
 * sitting idle, which helps nobody and costs battery.
 */
export function installResyncTriggers() {
  if (typeof window === 'undefined') return () => {};

  const maybe = () => { if (isStalled()) resyncNow(); };
  const onVisible = () => { if (document.visibilityState === 'visible') maybe(); };

  window.addEventListener('online', maybe);
  window.addEventListener('focus', maybe);
  document.addEventListener('visibilitychange', onVisible);

  return () => {
    window.removeEventListener('online', maybe);
    window.removeEventListener('focus', maybe);
    document.removeEventListener('visibilitychange', onVisible);
  };
}
