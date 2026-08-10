// Canonical public URL for a user's vergr.me page.
//
// The FEATURE is called vergr.me. The DOMAIN vergr.me is NOT registered
// (verified 2026-07-18: NXDOMAIN from the .me registry), so every public URL
// must use vergr.app/u/<handle>, which is live and is already the SEO
// canonical served by the ugcRenderer function.
//
// When the founder buys vergr.me: point it at Firebase Hosting, then flip
// VERGRME_HOST below to 'https://vergr.me' and set PATH_PREFIX to ''. The
// host-gated routes (RootRoute / VergrMeHostRoute in AppRouter) already
// handle serving on the bare apex, so nothing else needs to change.
const VERGRME_HOST = 'https://vergr.app';
const PATH_PREFIX = '/u';

/** Full shareable URL, e.g. https://vergr.app/u/damien */
export function vergrMeUrl(handle) {
  return `${VERGRME_HOST}${PATH_PREFIX}/${handle}`;
}

/** Display form without the scheme, e.g. vergr.app/u/damien */
export function vergrMeDisplayUrl(handle) {
  return vergrMeUrl(handle).replace(/^https?:\/\//, '');
}

/** Bare domain for marketing copy, e.g. vergr.app/u/ */
export const VERGRME_DISPLAY_PREFIX = `${VERGRME_HOST.replace(/^https?:\/\//, '')}${PATH_PREFIX}/`;
