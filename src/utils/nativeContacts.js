// Contact access that works on BOTH surfaces:
//   - native (Tauri WebView): window.VergrContacts Kotlin bridge (the WebView
//     has NO navigator.contacts) — runtime READ_CONTACTS prompt, returns the
//     whole book (name+tel), capped at 2000, deduped.
//   - web (Chrome/Edge Android): the Contact Picker API (user multi-selects).
//
// PRIVACY (non-negotiable): raw numbers never leave the device. Callers hash
// each normalized number with SHA-256 client-side and send ONLY hashes to
// matchContactHashes (which additionally requires the caller to have saved
// their own phone, blocking drive-by enumeration).

export function contactsSupported() {
  return !!(window.VergrContacts?.pick) || !!(navigator.contacts?.select);
}

/**
 * Returns [{ name, tel }] or throws { name:'AbortError' } on user cancel /
 * permission denial (matching the Contact Picker API's cancel behavior so
 * existing catch blocks keep working).
 */
export async function pickContacts() {
  const bridge = window.VergrContacts;
  if (bridge?.pick) {
    return new Promise((resolve, reject) => {
      const reqId = `c_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const onResult = (e) => {
        if (e?.detail?.reqId !== reqId) return;
        window.removeEventListener('vergr:contacts-result', onResult);
        clearTimeout(timer);
        if (e.detail.error) {
          const err = new Error(e.detail.error);
          err.name = e.detail.error === 'permission_denied' ? 'AbortError' : 'Error';
          reject(err);
          return;
        }
        resolve(Array.isArray(e.detail.contacts) ? e.detail.contacts : []);
      };
      const timer = setTimeout(() => {
        window.removeEventListener('vergr:contacts-result', onResult);
        const err = new Error('timeout');
        err.name = 'AbortError';
        reject(err);
      }, 120000); // permission dialogs can sit open a while
      window.addEventListener('vergr:contacts-result', onResult);
      try { bridge.pick(reqId); } catch (err) {
        window.removeEventListener('vergr:contacts-result', onResult);
        clearTimeout(timer);
        reject(err);
      }
    });
  }
  if (navigator.contacts?.select) {
    const picked = await navigator.contacts.select(['name', 'tel'], { multiple: true });
    return picked.map((c) => ({
      name: (c.name && c.name[0]) || 'Unknown',
      tel: (c.tel && c.tel[0]) || '',
    }));
  }
  const err = new Error('unsupported');
  err.name = 'AbortError';
  throw err;
}
