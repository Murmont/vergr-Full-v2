/**
 * Native share sheet integration (Android shell).
 *
 * The WebView's Web Share API (navigator.share) is flaky/absent in the Tauri
 * Android WebView. The Kotlin VergrShare bridge opens the real system chooser.
 * initNativeShare() patches navigator.share/canShare to route through the bridge
 * so every existing share button (~19 call sites use navigator.share) upgrades
 * with no per-file change. No-op on web/desktop (bridge absent → Web Share stays).
 */

export function initNativeShare() {
  if (typeof window === 'undefined') return;
  const bridge = window.VergrShare;
  if (!bridge || typeof bridge.share !== 'function') return;
  try {
    navigator.share = (data = {}) => {
      try {
        bridge.share(data.text || '', data.url || '', data.title || '');
      } catch (e) {
        return Promise.reject(e);
      }
      return Promise.resolve();
    };
    // Report support so callers that gate on navigator.canShare use the sheet.
    navigator.canShare = () => true;
  } catch { /* ignore */ }
}

/** Direct share (bypasses navigator.share) — native chooser if available. */
export function nativeShare({ text = '', url = '', title = '' } = {}) {
  if (typeof window !== 'undefined' && window.VergrShare?.share) {
    try { window.VergrShare.share(text, url, title); return true; } catch { /* fall through */ }
  }
  if (typeof navigator !== 'undefined' && navigator.share) {
    try { navigator.share({ text, url, title }); return true; } catch { /* fall through */ }
  }
  return false;
}
