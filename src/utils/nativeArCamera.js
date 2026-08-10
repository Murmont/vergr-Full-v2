/**
 * AR camera with live background effects (native Android only).
 *
 * Bridges to the Kotlin `window.VergrArCamera` interface (ArCameraBridge.kt →
 * ArCameraActivity: CameraX + on-device ML Kit Selfie Segmentation). The effect
 * runs natively on every frame — only the FINISHED JPEG crosses back here.
 *
 * `openArCamera()` resolves a `File` ready for the normal upload/compose path,
 * or null if the user cancelled. It NEVER rejects and NEVER throws, so a caller
 * can always fall back to the existing picker/camera.
 *
 * On web/desktop the bridge doesn't exist → `isArCameraSupported()` is false and
 * nothing about the current camera behaviour changes.
 */

import { isAndroidApp } from './platform';

/** True only where the native AR camera bridge exists (Android shell). */
export function isArCameraSupported() {
  return isAndroidApp()
    && typeof window !== 'undefined'
    && typeof window.VergrArCamera?.open === 'function';
}

let reqSeq = 0;

/**
 * Open the native AR camera. Resolves a File (JPEG) or null.
 */
export function openArCamera() {
  return new Promise((resolve) => {
    if (!isArCameraSupported()) { resolve(null); return; }

    const reqId = `ar${Date.now()}_${reqSeq++}`;
    let done = false;

    const finish = async (path) => {
      if (done) return;
      done = true;
      window.removeEventListener('vergr:ar-camera-result', onResult);
      clearTimeout(timer);
      if (!path) { resolve(null); return; }
      try {
        // The raw cache path isn't fetchable from the WebView — it has to go
        // through Tauri's asset protocol, which is scoped to cache/ar_camera/.
        const { convertFileSrc } = await import('@tauri-apps/api/core');
        const res = await fetch(convertFileSrc(path));
        if (!res.ok) { resolve(null); return; }
        const blob = await res.blob();
        // Tap = JPEG photo, hold = MP4 video — same result channel, the
        // extension says which. The mime must be right or the composer's
        // video-vs-image branches (and compression) misroute the file.
        const isVideo = String(path).toLowerCase().endsWith('.mp4');
        resolve(new File(
          [blob],
          `vergr_${Date.now()}.${isVideo ? 'mp4' : 'jpg'}`,
          { type: blob.type && blob.type !== 'application/octet-stream' ? blob.type : (isVideo ? 'video/mp4' : 'image/jpeg') },
        ));
      } catch {
        resolve(null); // a failed read must not break the composer
      }
    };

    const onResult = (e) => {
      const d = e?.detail;
      if (!d || d.reqId !== reqId) return;
      finish(d.path || null);
    };

    // Generous cap — the camera stays open until the user shoots or cancels.
    // This only guards against a lost bridge event leaving a dangling promise.
    const timer = setTimeout(() => finish(null), 10 * 60 * 1000);
    window.addEventListener('vergr:ar-camera-result', onResult);

    try {
      window.VergrArCamera.open(reqId);
    } catch {
      finish(null);
    }
  });
}
