// Opening anything outside Vergr Admin, from inside Vergr Admin.
//
// ⚠ THE ADMIN APP HAS NO CONSUMER ROUTES. It mounts AdminRoutes under a
// MemoryRouter and nothing else, so `navigate('/messages/…')` or
// `navigate('/user/…')` matched no route and bounced to the dashboard. That is
// how "Open and reply" on a support ticket, "Open the room" and "View profile"
// all silently did nothing (2026-09-21). Anything that is a page of the product
// itself opens on vergr.app in the system browser, where the person signs in
// with the ordinary account that takes part in that conversation.
//
// ⚠ `window.open` DOES NOT REACH THE SYSTEM BROWSER FROM A TAURI WINDOW. The
// shell plugin does (capabilities/default.json grants shell:allow-open to the
// "main" window, which is the admin window's label too). It is imported lazily
// so the admin screens stay importable in a plain browser.

import { publicUrl } from '../utils/publicUrl';

export async function openExternal(url) {
  try {
    const { open } = await import('@tauri-apps/plugin-shell');
    await open(url);
    return true;
  } catch {
    try {
      window.open(url, '_blank', 'noopener');
      return true;
    } catch {
      return false;
    }
  }
}

/** A page of the Vergr app itself, opened on vergr.app. */
export const openInVergr = (path) => openExternal(publicUrl(path));
