/**
 * QR / barcode scanner (native Android only).
 *
 * Bridges to the Kotlin `window.VergrScanner` interface (ScannerBridge.kt →
 * ScannerActivity, CameraX + on-device ML Kit, no backend). `scan()` opens the
 * camera and resolves with the raw scanned string (or null if cancelled).
 *
 * Vergr's QR codes across the app encode `https://vergr.app/...` deep links
 * (profile share, event share, etc.), so a scanned value is normally routed
 * straight into the SPA. `qrValueToPath()` extracts a routable in-app path.
 */

import { isAndroidApp } from './platform';

/** True only where the native scanner bridge exists (Android shell). */
export function isQrScanSupported() {
  return isAndroidApp() && typeof window !== 'undefined' && typeof window.VergrScanner?.scan === 'function';
}

let reqSeq = 0;

/**
 * Open the native scanner. Resolves the scanned string, or null (cancel /
 * unsupported / timeout). Never rejects.
 */
export function scanQr() {
  return new Promise((resolve) => {
    if (!isQrScanSupported()) { resolve(null); return; }
    const reqId = `q${Date.now()}_${reqSeq++}`;
    let done = false;
    const finish = (val) => {
      if (done) return;
      done = true;
      window.removeEventListener('vergr:qr-result', onResult);
      clearTimeout(timer);
      resolve(val);
    };
    const onResult = (e) => {
      const d = e?.detail;
      if (!d || d.reqId !== reqId) return;
      finish(d.value || null);
    };
    // Generous cap — the scanner window stays open until the user scans or
    // cancels; this only guards against a lost bridge event.
    const timer = setTimeout(() => finish(null), 5 * 60 * 1000);
    window.addEventListener('vergr:qr-result', onResult);
    try {
      window.VergrScanner.scan(reqId);
    } catch {
      finish(null);
    }
  });
}

/**
 * If the scanned value is a Vergr deep link, return the in-app path
 * (`/user/foo`, `/e/123`, …) to navigate to. Otherwise null.
 */
export function qrValueToPath(value) {
  if (!value) return null;
  const raw = String(value).trim();
  try {
    const u = new URL(raw);
    const host = u.hostname.toLowerCase();
    if (host === 'vergr.app' || host === 'www.vergr.app' || host === 'vergr.me') {
      const path = (u.pathname || '/') + (u.search || '');
      return path || '/';
    }
  } catch { /* not a URL */ }
  // vergr:// deep link scheme.
  const m = raw.match(/^vergr:\/\/(.+)$/i);
  if (m) return '/' + m[1].replace(/^\/+/, '');
  return null;
}
