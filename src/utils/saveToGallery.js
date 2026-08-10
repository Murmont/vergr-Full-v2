/**
 * Save-to-gallery (native Android only).
 *
 * Bridges to the Kotlin `window.VergrGallery` interface (see GalleryBridge.kt),
 * which downloads the bytes natively (no WebView CORS wall) and writes them into
 * a public "VERGR" album via MediaStore, so chat photos/videos show up in the
 * phone's gallery like Telegram's saved media.
 *
 * On web / desktop there is no phone gallery, so `isGallerySaveSupported()` is
 * false and callers keep their existing open-original / browser-download path.
 */

import { isAndroidApp } from './platform';

const SAVED_KEY = 'vergr_saved_media';
const AUTOSAVE_PHOTOS_KEY = 'vergr_autosave_photos';
const AUTOSAVE_VIDEOS_KEY = 'vergr_autosave_videos';
const SAVED_MAX = 600; // cap the remembered-saved set (device-local hygiene)

/** True only where the native gallery bridge exists (Android shell). */
export function isGallerySaveSupported() {
  return isAndroidApp() && typeof window !== 'undefined' && typeof window.VergrGallery?.save === 'function';
}

/** A sensible download filename from a media URL. */
export function fileNameFromUrl(url, isVideo) {
  try {
    // Strip BOTH the query and the #fragment. Voice/video notes carry a
    // `#d=<seconds>` duration stamp on the url, which would otherwise be
    // sanitised into the filename ("clip.webm_d_5.0") and destroy the
    // extension, so the gallery wouldn't recognise the file.
    const path = String(url || '').split(/[?#]/)[0];
    let name = path.substring(path.lastIndexOf('/') + 1);
    name = decodeURIComponent(name).replace(/[^A-Za-z0-9._-]/g, '_');
    if (name && name.includes('.')) return name;
  } catch { /* fall through */ }
  return `VERGR_${Date.now()}.${isVideo ? 'mp4' : 'jpg'}`;
}

let reqSeq = 0;

/**
 * Save one media URL to the gallery. Resolves { ok, error }. Never throws.
 * Times out (large videos take a moment) so a stuck native call can't hang the
 * caller forever.
 */
// Telegram's album split, and the reason it matters: auto-saved chat media
// dumped into the same folder as the things you deliberately kept destroys the
// album you curated. Manual saves (and your own avatar/banner) stay in "VERGR";
// automatic saves land in the per-type albums.
export const ALBUM_MANUAL = 'VERGR';
export const ALBUM_IMAGES = 'VERGR Images';
export const ALBUM_VIDEO = 'VERGR Video';

/** Which album an automatically-saved item belongs in. */
export function autoAlbumFor(isVideo) {
  return isVideo ? ALBUM_VIDEO : ALBUM_IMAGES;
}

export function saveMediaToGallery(url, { fileName, mime, isVideo = false, album } = {}) {
  return new Promise((resolve) => {
    if (!isGallerySaveSupported() || !url) {
      resolve({ ok: false, error: 'unsupported' });
      return;
    }
    const reqId = `g${Date.now()}_${reqSeq++}`;
    let done = false;
    const finish = (res) => {
      if (done) return;
      done = true;
      window.removeEventListener('vergr:gallery-save-result', onResult);
      clearTimeout(timer);
      if (res.ok) markMediaSaved(url);
      resolve(res);
    };
    const onResult = (e) => {
      const d = e?.detail;
      if (!d || d.reqId !== reqId) return;
      finish({ ok: !!d.ok, error: d.error || null });
    };
    const timer = setTimeout(() => finish({ ok: false, error: 'timeout' }), 120000);
    window.addEventListener('vergr:gallery-save-result', onResult);
    try {
      const name = fileName || fileNameFromUrl(url, isVideo);
      const folder = album || ALBUM_MANUAL;
      // Six-arg overload carries the album. An older APK only has the five-arg
      // form, and calling it with an extra argument throws rather than being
      // ignored — so fall back rather than losing the save entirely.
      try {
        window.VergrGallery.save(url, name, mime || '', !!isVideo, folder, reqId);
      } catch {
        window.VergrGallery.save(url, name, mime || '', !!isVideo, reqId);
      }
    } catch (err) {
      finish({ ok: false, error: err?.message || 'bridge failed' });
    }
  });
}

// ── Remembered "already saved" set (for a ✓ state + auto-save dedupe) ──────────

function readSaved() {
  try {
    const raw = localStorage.getItem(SAVED_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

export function isMediaSaved(url) {
  if (!url) return false;
  return readSaved().includes(url);
}

export function markMediaSaved(url) {
  if (!url) return;
  try {
    let arr = readSaved();
    if (arr.includes(url)) return;
    arr.push(url);
    if (arr.length > SAVED_MAX) arr = arr.slice(arr.length - SAVED_MAX);
    localStorage.setItem(SAVED_KEY, JSON.stringify(arr));
  } catch { /* ignore */ }
}

// ── Auto-save preferences (per-device — a desktop has no gallery) ─────────────

export function getAutoSavePhotos() {
  try { return localStorage.getItem(AUTOSAVE_PHOTOS_KEY) === '1'; } catch { return false; }
}
export function getAutoSaveVideos() {
  try { return localStorage.getItem(AUTOSAVE_VIDEOS_KEY) === '1'; } catch { return false; }
}
export function setAutoSavePhotos(on) {
  try { localStorage.setItem(AUTOSAVE_PHOTOS_KEY, on ? '1' : '0'); } catch { /* ignore */ }
}
export function setAutoSaveVideos(on) {
  try { localStorage.setItem(AUTOSAVE_VIDEOS_KEY, on ? '1' : '0'); } catch { /* ignore */ }
}
