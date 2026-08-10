/**
 * Media auto-download policy (Telegram-style "Auto-download media").
 *
 * Controls whether the on-device media cache (deviceMediaCache.js) does its
 * EXTRA byte-fetch to PERSIST chat media on the phone. Note: this does NOT stop
 * an image from displaying — the <img> still loads its remote URL so chats never
 * break — it only gates the separate cache-populate download (which on native is
 * a real second fetch via tauri-plugin-http). So "Wi-Fi only" / "Never" save the
 * redundant cellular download; avatars/banners are exempt (never policy-gated)
 * so the instant-avatar UX never regresses.
 *
 *   always  → cache on any network (default)
 *   wifi    → cache only on an unmetered/Wi-Fi network
 *   never   → never persist chat media (still displays remote each time)
 */

const KEY = 'vergr_media_autodl';
export const MEDIA_DL_OPTIONS = [
  { value: 'always', label: 'Always' },
  { value: 'wifi', label: 'Wi-Fi only' },
  { value: 'never', label: 'Never' },
];

export function getMediaAutoDownload() {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'wifi' || v === 'never' ? v : 'always';
  } catch {
    return 'always';
  }
}

export function setMediaAutoDownload(v) {
  try { localStorage.setItem(KEY, v === 'wifi' || v === 'never' ? v : 'always'); } catch { /* ignore */ }
}

/**
 * Is the current network unmetered (Wi-Fi/Ethernet)? Native answers reliably via
 * the VergrNet bridge (ConnectivityManager); web falls back to the (spotty)
 * Network Information API. Unknown → treat as unmetered so we never silently
 * block downloads on a network we can't classify.
 */
export function networkIsUnmetered() {
  try {
    const s = window.VergrNet?.status?.();
    if (s === 'wifi' || s === 'ethernet') return true;
    if (s === 'cellular') return false;
  } catch { /* no bridge */ }
  try {
    const c = typeof navigator !== 'undefined' ? navigator.connection : null;
    if (c) {
      if (c.saveData) return false;
      if (c.type === 'cellular') return false;
      if (c.type === 'wifi' || c.type === 'ethernet') return true;
    }
  } catch { /* ignore */ }
  return true;
}

/** Should chat media be persisted to the on-device cache right now? */
export function shouldAutoDownloadMedia() {
  const p = getMediaAutoDownload();
  if (p === 'never') return false;
  if (p === 'always') return true;
  return networkIsUnmetered(); // 'wifi'
}
