// Who is allowed to SEE adult content, and where.
//
// Three independent conditions, ALL required. Any one of them false means the
// viewer sees nothing marked NSFW:
//
//   1. The viewer asked for it        (off by default, never opt-out)
//   2. The viewer is age-verified     (Didit; self-declared 18 is not enough)
//   3. The platform permits it here   (a Play build can be made clean remotely)
//
// ⚠ THIS FILE IS PRESENTATION ONLY. It decides what a client draws. It is not
// the security boundary and must never be treated as one: a client can be
// patched, and the whole point of an age gate is that the people most motivated
// to defeat it are the ones it exists to stop. The real gate is server-side in
// functions/entitlements.js → assertNsfwViewerAllowed, which refuses to sign a
// media URL or a playback URL without a verified identity. If you ever find
// yourself relying on this module to protect content, the design is wrong.

import { IS_STORE_BUILD, isAndroidApp } from './platform';

/** localStorage key. Device-local mirror of the account preference, so the
 *  first frame can filter without waiting on a Firestore read. Absent means
 *  off, which is the safe default when we know nothing yet. */
const LS_KEY = 'vergr.nsfw.show';

export const getLocalNsfwPref = () => {
  try { return localStorage.getItem(LS_KEY) === '1'; } catch { return false; }
};

export const setLocalNsfwPref = (on) => {
  try {
    if (on) localStorage.setItem(LS_KEY, '1');
    else localStorage.removeItem(LS_KEY);
  } catch { /* private mode, ignore */ }
};

/** Age-verified via Didit. Mirrors functions/didit.js → assertKycVerified. */
export const isAgeVerified = (profile) => profile?.kyc?.verified === true;

/**
 * Does THIS build permit adult content at all?
 *
 * Google Play's Sexual Content policy does not carve out a "mature but not
 * explicit" band, so a store build defaults to hiding NSFW outright. The
 * override lives in `app_config/general.nsfwVisibleOnAndroid`, which means the
 * posture can be changed from the console in seconds with no deploy and no app
 * review, in either direction. That switch is the reason Section 3A of the
 * Terms reserves the right to withhold Content on particular platforms.
 *
 * `cfg` is the already-loaded app_config/general doc, or null when it has not
 * arrived. Null resolves to the RESTRICTIVE answer on store builds.
 */
export const platformAllowsNsfw = (cfg) => {
  if (IS_STORE_BUILD || isAndroidApp()) return cfg?.nsfwVisibleOnAndroid === true;
  return true;
};

/**
 * The single answer every surface should ask for.
 *
 * @param {object}  p
 * @param {object}  p.profile   viewer profile (for kyc)
 * @param {boolean} p.pref      viewer's stored preference
 * @param {object}  p.cfg       app_config/general, or null
 */
export const viewerAllowsNsfw = ({ profile, pref, cfg }) =>
  pref === true && isAgeVerified(profile) && platformAllowsNsfw(cfg);
