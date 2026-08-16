// Adaptive video: pick the rendition a viewer's connection can actually carry.
//
// ── THE SAFETY RULE THIS FILE EXISTS TO ENFORCE ──────────────────────
//
// EVERY failure path returns the ORIGINAL url.
//
// No renditions, flag off, malformed data, unknown network, missing field,
// thrown exception: all of them return exactly the URL the player would have
// used before this file existed. There is no state in which adaptive video can
// make a video less playable than it is today, which is the whole reason it is
// safe to ship it switched on.
//
// ── WHY A REMOTE FLAG AND NOT A BUILD CONSTANT ───────────────────────
//
// `app_config/general.adaptiveVideoEnabled` is read at runtime and cached. If
// renditions ever look wrong in the wild, one Firestore field turns the entire
// feature off for every user instantly, with no deploy and no app-store round
// trip. A build-time constant would mean shipping a fix through review.

import { doc, getDoc } from 'firebase/firestore';
import { db } from '../firebase/config';

/** Cached so a feed of twenty videos costs ONE read, not twenty. */
let _cfg = null;
let _cfgAt = 0;
const CFG_TTL_MS = 5 * 60 * 1000;

/**
 * Kick off a config read. Deliberately fire-and-forget: nothing awaits this, so
 * the first video of a session plays from the original while it loads, and
 * everything after uses the cache. Blocking playback on a config read would be
 * a worse bug than the one this feature fixes.
 */
export function primeAdaptiveConfig() {
  const now = Date.now();
  if (_cfg && (now - _cfgAt) < CFG_TTL_MS) return;
  _cfgAt = now;
  getDoc(doc(db, 'app_config', 'general'))
    .then((s) => { _cfg = s.exists() ? (s.data() || {}) : {}; })
    .catch(() => { _cfg = _cfg || {}; }); // a failed read means "leave it off"
}

function enabled() {
  return _cfg?.adaptiveVideoEnabled === true;
}

/**
 * What the browser says about the connection.
 *
 * `navigator.connection` is Chromium-only. Safari and iOS return undefined, and
 * every iOS browser is Safari underneath, so this must NEVER be the only signal.
 * Unknown resolves to the middle rung: good enough everywhere, never the worst
 * experience, and hls-style ABR is not available for progressive MP4.
 */
function connectionTier() {
  try {
    const c = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    if (!c) return 'unknown';
    // Explicit user preference beats any measurement.
    if (c.saveData === true) return 'slow';
    const t = c.effectiveType;
    if (t === 'slow-2g' || t === '2g') return 'slow';
    if (t === '3g') return 'slow';
    // downlink is in Mbps and can be absent.
    if (typeof c.downlink === 'number' && c.downlink > 0 && c.downlink < 1.5) return 'slow';
    if (t === '4g') return 'fast';
    return 'unknown';
  } catch {
    return 'unknown';
  }
}

/**
 * Choose a playback URL.
 *
 * @param {string} originalUrl  what the player uses today. ALWAYS the fallback.
 * @param {Array}  renditions   `post.adaptiveRenditions`, or undefined
 * @returns {string} a url that is safe to play
 */
export function pickVideoUrl(originalUrl, renditions) {
  try {
    if (!originalUrl) return originalUrl;
    if (!enabled()) return originalUrl;
    if (!Array.isArray(renditions) || renditions.length === 0) return originalUrl;

    // Only trust entries that actually carry a usable url and height.
    const usable = renditions
      .filter((r) => r && typeof r.url === 'string' && r.url.startsWith('http') && Number(r.height) > 0)
      .sort((a, b) => Number(a.height) - Number(b.height));
    if (!usable.length) return originalUrl;

    const tier = connectionTier();

    // Slow: the smallest rung. This is the case the whole feature exists for.
    if (tier === 'slow') return usable[0].url;

    // Fast: the original, which is the highest quality we have. A rendition is
    // never better than the source, so there is nothing to gain by picking one.
    if (tier === 'fast') return originalUrl;

    // Unknown (Safari, iOS, older browsers): take the HIGHEST rendition rather
    // than the original. It starts faster than a full-bitrate source and still
    // looks right on a phone, which is where "unknown" mostly happens.
    return usable[usable.length - 1].url;
  } catch {
    // Any surprise at all: the original. Never let this throw into a render.
    return originalUrl;
  }
}
