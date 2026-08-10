// nativeMedia — JS side of the VergrMedia gallery bridge (MediaBridge.kt).
//
// The WebView cannot enumerate the device gallery, so an in-app photo grid is
// impossible with web APIs alone: `<input type="file">` can only hand off to the
// system picker, which throws the user out of the app. The native shell reads
// MediaStore and gives us back renderable thumbnails, which is what lets the
// attachment sheet show recent photos inline (the Telegram shape).
//
// Everything here degrades to `isNativeMediaAvailable() === false` off-native,
// and every caller must keep a system-picker fallback for that case — plus for
// the case where the user simply declines the permission.

const REQ = () => `m_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

function bridge() {
  if (typeof window === 'undefined') return null;
  return window.VergrMedia || null;
}

/** True only inside the native shell with the media bridge wired. */
export function isNativeMediaAvailable() {
  const b = bridge();
  if (!b) return false;
  try { return b.available() === '1' || b.available() === true; } catch { return false; }
}

// Shared one-shot event plumbing: fire a bridge call, resolve on the matching
// reqId, and never hang forever if the native side goes quiet.
function awaitEvent(eventName, reqId, timeoutMs) {
  return new Promise((resolve, reject) => {
    const onEvt = (e) => {
      const d = e?.detail;
      if (!d || d.reqId !== reqId) return;
      cleanup();
      if (d.error) reject(new Error(d.error));
      else resolve(d);
    };
    const cleanup = () => {
      window.removeEventListener(eventName, onEvt);
      clearTimeout(timer);
    };
    const timer = setTimeout(() => { cleanup(); reject(new Error('media_timeout')); }, timeoutMs);
    window.addEventListener(eventName, onEvt);
  });
}

/**
 * Recent gallery items, newest first.
 * Resolves [{ id, thumbSrc, mime, name, isVideo, durationMs }] where thumbSrc is
 * already a WebView-loadable URL. Rejects with 'permission_denied' when the user
 * says no — callers should fall back to the system picker, not show an error.
 */
export async function listDeviceMedia(limit = 60) {
  const b = bridge();
  if (!b) throw new Error('media_unavailable');
  const reqId = REQ();
  const pending = awaitEvent('vergr:media-list', reqId, 30000);
  b.list(limit, reqId);
  const { items } = await pending;

  const { convertFileSrc } = await import('@tauri-apps/api/core');
  return (items || []).map((it) => ({
    ...it,
    // The raw path is not fetchable from the WebView; the asset protocol is
    // scoped to cache/media_thumbs in tauri.conf.json.
    thumbSrc: convertFileSrc(it.thumb),
  }));
}

/**
 * Turn selected gallery ids into real Files the normal upload path can take.
 * The originals are only copied out of MediaStore at this point, so browsing a
 * huge gallery never costs more than its thumbnails.
 */
export async function resolveDeviceMedia(ids) {
  const b = bridge();
  if (!b || !ids?.length) return [];
  const reqId = REQ();
  const pending = awaitEvent('vergr:media-resolved', reqId, 120000);
  b.resolve(ids.join(','), reqId);
  const { files } = await pending;

  const { convertFileSrc } = await import('@tauri-apps/api/core');
  const out = [];
  for (const f of files || []) {
    try {
      const res = await fetch(convertFileSrc(f.path));
      if (!res.ok) continue;
      const blob = await res.blob();
      const file = new File([blob], f.name || 'media', {
        type: f.mime || blob.type || 'application/octet-stream',
      });
      // Keep the ORIGINAL on-disk path alongside the File.
      //
      // Hardware video transcoding happens in Kotlin, and Kotlin cannot read a
      // JavaScript Blob — MediaExtractor needs a real file. This path is the
      // only handle on the actual bytes; without it the only way to re-encode is
      // the real-time canvas encoder, which costs a minute per minute of video.
      // Harmless everywhere else: a File is an object, and nothing that consumes
      // one looks at extra properties.
      try { file._nativePath = f.path; } catch { /* frozen File, ignore */ }
      out.push(file);
    } catch { /* skip the one that failed, keep the rest of the selection */ }
  }
  return out;
}

/** mm:ss for a video tile's duration chip. */
export function formatDuration(ms) {
  const total = Math.max(0, Math.round((ms || 0) / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}
