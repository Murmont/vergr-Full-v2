// Referral attribution: one definition for every signup path.
//
// A friend's invite link is `https://vergr.app/reflink?ref=<uid>`. The ref has
// to survive until the account exists, and it has four ways to arrive:
//   1. in the URL of the page being viewed (the link itself),
//   2. stashed in localStorage by an earlier page (captureReferral in AppRouter,
//      or the invite landing screen),
//   3. from Google Play, when the friend installed the app from the store link:
//      the app starts with its OWN storage, so (2) is gone, and the Play Install
//      Referrer (window.VergrInstallReferrer, InstallReferrerBridge.kt) carries
//      it instead.
// SignUpStep2 (email) and OnboardingFlowScreen (every new account, including
// Google sign-in) both read it through getPendingReferrerId().

export const REF_KEY = 'vergr_ref';

// Firebase uids are 28 characters; the pattern is the one captureReferral uses.
export const isValidRef = (r) => typeof r === 'string' && /^[A-Za-z0-9_-]{6,64}$/.test(r);

export function stashReferral(ref) {
  try { if (isValidRef(ref)) localStorage.setItem(REF_KEY, ref); } catch { /* private mode */ }
}

export function clearReferral() {
  try { localStorage.removeItem(REF_KEY); } catch { /* private mode */ }
}

// The Play Install Referrer arrives as the store URL's `referrer` value, e.g.
// "ref=<uid>". Read lazily: the native side fetches it asynchronously on the
// first launch, and by the time anyone reaches signup it has long landed.
export function readInstallReferrerRef() {
  try {
    const raw = (typeof window !== 'undefined' && window.VergrInstallReferrer?.get?.()) || '';
    const ref = new URLSearchParams(raw).get('ref');
    return isValidRef(ref) ? ref : null;
  } catch { return null; }
}

export function getPendingReferrerId() {
  try {
    const urlRef = new URLSearchParams(window.location.search).get('ref')
      || new URLSearchParams(window.location.hash.split('?')[1] || '').get('ref');
    if (isValidRef(urlRef)) return urlRef;
    const stored = localStorage.getItem(REF_KEY);
    if (isValidRef(stored)) return stored;
  } catch { /* SSR / private mode */ }
  return readInstallReferrerRef();
}

// ── Google Play ──────────────────────────────────────────────────────────
export const PLAY_PACKAGE = 'com.vergr.desktop';

// ⚠ FLIP TO true THE DAY THE PLAY LISTING IS PUBLIC. Until then the store page
// is "item not found" for everyone who is not an opted-in tester, so the invite
// screen must not send people there.
// Flipped 2026-09-25: 1.0.215 published to production, public listing verified.
export const PLAY_LISTING_LIVE = true;

// The `referrer` parameter is what Play hands to the Install Referrer API after
// the install. It is URL-encoded as one value, so `ref=<uid>` survives intact.
export function playStoreUrl(ref) {
  const base = `https://play.google.com/store/apps/details?id=${PLAY_PACKAGE}`;
  return isValidRef(ref) ? `${base}&referrer=${encodeURIComponent(`ref=${ref}`)}` : base;
}
