// P9 — wallet biometrics bridge (Android native shell only).
//
// MainActivity exposes window.VergrBiometric (BiometricBridge.kt): the wallet
// PIN is encrypted with a hardware-backed Keystore key and unlocked with
// fingerprint/face. These helpers wrap the @JavascriptInterface (sync booleans)
// + the async event results into Promises. No-ops on web/PWA (returns
// unavailable), so callers can always feature-test with bioAvailable().

const DEFAULT_NAME = 'wallet_pin';
const bridge = () => (typeof window !== 'undefined' ? window.VergrBiometric : null);

export function bioAvailable() {
  try { return !!bridge() && bridge().isAvailable() === true; } catch { return false; }
}

export function bioEnrolled(name = DEFAULT_NAME) {
  try { return !!bridge() && bridge().isEnrolled(name) === true; } catch { return false; }
}

export function bioClear(name = DEFAULT_NAME) {
  try { bridge()?.clear(name); } catch { /* ignore */ }
}

// Encrypt + persist the wallet PIN behind the Keystore key. Resolves true/false.
export function bioEnroll(secret, name = DEFAULT_NAME) {
  return new Promise((resolve) => {
    const b = bridge();
    if (!b) return resolve(false);
    const onEvt = (e) => {
      const d = e?.detail || {};
      if (d.name !== name) return;
      cleanup();
      resolve(!!d.ok);
    };
    const cleanup = () => { window.removeEventListener('vergr:biometric-enroll', onEvt); clearTimeout(t); };
    window.addEventListener('vergr:biometric-enroll', onEvt);
    const t = setTimeout(() => { cleanup(); resolve(false); }, 8000);
    try { b.enroll(name, String(secret)); } catch { cleanup(); resolve(false); }
  });
}

// Prompt biometric → resolve the decrypted PIN, or null on cancel/failure.
export function bioUnlock(name = DEFAULT_NAME, title = 'Unlock wallet') {
  return new Promise((resolve) => {
    const b = bridge();
    if (!b) return resolve(null);
    const onEvt = (e) => {
      const d = e?.detail || {};
      if (d.name !== name) return;
      cleanup();
      resolve(d.ok ? d.secret : null);
    };
    const cleanup = () => { window.removeEventListener('vergr:biometric-result', onEvt); clearTimeout(t); };
    window.addEventListener('vergr:biometric-result', onEvt);
    const t = setTimeout(() => { cleanup(); resolve(null); }, 60000);
    try { b.unlock(name, title); } catch { cleanup(); resolve(null); }
  });
}
