/**
 * Hand a URL to the device's real browser instead of loading it in the WebView.
 *
 * The native shell exposes `window.VergrOpener` (MainActivity.kt). Two things
 * need it:
 *
 *   1. OAuth — Google refuses to authenticate inside an embedded WebView
 *      (`disallowed_useragent`), and the post-link redirect has to land on the
 *      vergr.app App Link so the native session is handed back.
 *   2. Withdrawals on the Play build — the payout is authorised on the web so
 *      the money movement itself does not happen inside the store app.
 *
 * Returns true if the URL was handed off, false if there is no bridge (web,
 * desktop, or an older APK). Callers MUST handle false — silently doing
 * nothing would strand the user on a dead button.
 */
export function openExternalUrl(url) {
  if (typeof window === 'undefined') return false;
  const opener = window.VergrOpener;
  if (!opener || typeof opener.open !== 'function') return false;
  try {
    opener.open(url);
    return true;
  } catch {
    return false;
  }
}

/** True when a handoff would actually reach a browser. */
export function canOpenExternally() {
  return typeof window !== 'undefined'
    && !!window.VergrOpener
    && typeof window.VergrOpener.open === 'function';
}
