// Share TARGET (Android share sheet → Vergr).
//
// The native shell dispatches `vergr:native-share-in` with the shared text/link.
// There is no composer ROUTE that accepts a prefill (CreateComposer is a modal),
// but ChatThreadScreen already honours `?prefill=` — so the shared text is
// stashed here, the user picks a chat, and the thread consumes it on open.
//
// sessionStorage (not localStorage): a share is for THIS app session. If the
// user never picks a chat, it must not resurface days later.
//
// Text/links only for now — a shared photo arrives as a content:// URI the
// WebView cannot read (see the AndroidManifest note).

export const SHARE_IN_KEY = 'vergr_share_in';
// A shared photo/video: { path, mime, name }. The bytes live in the app's cache
// (Kotlin copied them out of the sender's content:// provider); we only carry
// the path around until a chat is picked.
export const SHARE_MEDIA_KEY = 'vergr_share_media';

export function peekSharedMedia() {
  try { return JSON.parse(sessionStorage.getItem(SHARE_MEDIA_KEY) || 'null'); } catch { return null; }
}
export function setSharedMedia(m) {
  try { sessionStorage.setItem(SHARE_MEDIA_KEY, JSON.stringify(m)); } catch { /* ignore */ }
}
export function consumeSharedMedia() {
  const m = peekSharedMedia();
  if (m) { try { sessionStorage.removeItem(SHARE_MEDIA_KEY); } catch { /* ignore */ } }
  return m;
}
export function clearSharedMedia() {
  try { sessionStorage.removeItem(SHARE_MEDIA_KEY); } catch { /* ignore */ }
}

/**
 * Turn a shared-media descriptor into a real File the normal upload path can
 * take. The bytes are only reachable through Tauri's asset protocol (the
 * WebView can't read a raw filesystem path either), and the protocol is scoped
 * to cache/shared_in/ in tauri.conf.json.
 */
export async function sharedMediaToFile(m) {
  if (!m?.path) return null;
  const { convertFileSrc } = await import('@tauri-apps/api/core');
  const res = await fetch(convertFileSrc(m.path));
  if (!res.ok) throw new Error('Could not read the shared file');
  const blob = await res.blob();
  return new File([blob], m.name || 'shared', { type: m.mime || blob.type || 'application/octet-stream' });
}

// A shared FILE that is not chat media — e.g. a WhatsApp "Export chat" .txt
// shared into Vergr. Routed to /messages/import instead of the chat picker.
export const SHARE_FILE_KEY = 'vergr_share_file';

export function peekSharedFile() {
  try { return JSON.parse(sessionStorage.getItem(SHARE_FILE_KEY) || 'null'); } catch { return null; }
}
export function setSharedFile(m) {
  try { sessionStorage.setItem(SHARE_FILE_KEY, JSON.stringify(m)); } catch { /* ignore */ }
}
export function consumeSharedFile() {
  const m = peekSharedFile();
  if (m) { try { sessionStorage.removeItem(SHARE_FILE_KEY); } catch { /* ignore */ } }
  return m;
}

export function peekSharedText() {
  try { return sessionStorage.getItem(SHARE_IN_KEY) || ''; } catch { return ''; }
}

/** Read AND clear — a share is consumed by the first chat it lands in. */
export function consumeSharedText() {
  try {
    const v = sessionStorage.getItem(SHARE_IN_KEY) || '';
    if (v) sessionStorage.removeItem(SHARE_IN_KEY);
    return v;
  } catch { return ''; }
}

export function clearSharedText() {
  try { sessionStorage.removeItem(SHARE_IN_KEY); } catch { /* ignore */ }
}
