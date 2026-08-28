import { getFunctions, httpsCallable } from 'firebase/functions';

const getUploadUrl = () => httpsCallable(getFunctions(undefined, 'europe-west1'), 'getR2UploadUrl');

// Bytes cross the JS bridge base64-encoded (a Blob can't). That inflates the
// hand-off by a third, so only route files small enough for it to be cheap —
// voice notes, video notes, photos. Anything bigger keeps the browser path,
// where a large upload streams instead of being held twice in memory.
const NATIVE_PUT_MAX_BYTES = 24 * 1024 * 1024;

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    // readAsDataURL gives "data:<type>;base64,<payload>" — the bridge wants
    // only the payload.
    r.onload = () => resolve(String(r.result).split(',')[1] || '');
    r.onerror = () => reject(r.error || new Error('read failed'));
    r.readAsDataURL(blob);
  });
}

/**
 * PUT through the Kotlin bridge. Resolves true when the upload succeeded,
 * false when this path isn't available so the caller falls through to the
 * browser paths. A real HTTP refusal from R2 THROWS — falling back to a
 * browser PUT that would fail identically just hides the reason.
 */
async function nativePut(url, file, contentType, cacheControl, onProgress) {
  const bridge = typeof window !== 'undefined' ? window.VergrUpload : null;
  if (!bridge?.available?.() || file.size > NATIVE_PUT_MAX_BYTES) return false;

  let base64;
  try {
    base64 = await blobToBase64(file);
  } catch {
    return false; // couldn't encode — let the browser path try
  }

  if (typeof onProgress === 'function') onProgress(0);

  const reqId = `up_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      window.removeEventListener('vergr:upload-result', onResult);
      window.removeEventListener('vergr:upload-progress', onNativeProgress);
      resolve(false); // bridge went silent — fall through rather than hang
    }, 180_000);

    // Real byte progress from Kotlin. This used to jump 10 -> 100 because the
    // bridge wrote the whole body in one call and had nothing to report in
    // between; it now writes in chunks and beats as it goes, which is what lets
    // the chat bubble show an honest MB counter instead of an indefinite
    // "sending".
    function onNativeProgress(e) {
      const d = e.detail;
      if (!d || d.reqId !== reqId || !d.total) return;
      if (typeof onProgress === 'function') {
        onProgress(Math.min(99, Math.round((d.sent / d.total) * 100)), d.sent, d.total);
      }
    }

    function onResult(e) {
      const d = e.detail;
      if (!d || d.reqId !== reqId) return;
      clearTimeout(timer);
      window.removeEventListener('vergr:upload-result', onResult);
      window.removeEventListener('vergr:upload-progress', onNativeProgress);
      if (d.ok) {
        if (typeof onProgress === 'function') onProgress(100);
        resolve(true);
      } else {
        reject(new Error(`R2 upload failed (${d.status || 0}): ${d.error || 'unknown'}`));
      }
    }

    window.addEventListener('vergr:upload-result', onResult);
    window.addEventListener('vergr:upload-progress', onNativeProgress);
    try {
      bridge.put(url, base64, contentType, cacheControl || '', reqId);
    } catch (err) {
      clearTimeout(timer);
      window.removeEventListener('vergr:upload-result', onResult);
      window.removeEventListener('vergr:upload-progress', onNativeProgress);
      reject(err);
    }
  });
}

/**
 * Upload a file to R2 via presigned URL.
 * @param {File|Blob} file
 * @param {'avatar'|'banner'|'post'|'short'|'clip'|'article'|'squad'|'tournament'|'tournament-proof'|'ambiance'} kind
 * @param {(pct:number)=>void} [onProgress] - upload progress 0-100; when given we
 *        PUT via XMLHttpRequest so the caller can render a real percentage.
 * @returns {Promise<{ url: string, key: string }>}
 */
export async function uploadToR2(file, kind, onProgress) {
  // R2's upload allowlist EXACT-matches the MIME type — a `;codecs=...` suffix
  // (which MediaRecorder/canvas-encoded blobs carry) makes it silently reject.
  const contentType = (file.type || 'application/octet-stream').split(';')[0].trim();
  const sizeBytes = file.size;

  // Phase 1: Get a presigned URL from our Cloud Function.
  let uploadUrl, publicUrl, key, cacheControl;
  try {
    const { data } = await getUploadUrl()({ contentType, sizeBytes, kind });
    ({ uploadUrl, publicUrl, key, cacheControl } = data);
  } catch (err) {
    throw new Error(`Could not get upload URL: ${err?.message || err?.code || String(err)}`);
  }

  // Phase 2: PUT the file to R2.
  // B9: when the server signed a Cache-Control header into the URL, we MUST
  // send the identical value or the signature mismatches and R2 403s.
  const putHeaders = { 'Content-Type': contentType };
  if (cacheControl) putHeaders['Cache-Control'] = cacheControl;
  const host = (() => { try { return new URL(uploadUrl).host; } catch { return 'r2'; } })();

  // Native path: PUT through Kotlin. The WebView's origin is not on the R2
  // bucket's CORS allowlist and we cannot change that policy (our R2 token has
  // object-level permissions only), so a browser-side PUT can fail with a bare
  // rejection carrying no status and no body. Kotlin is not a browser request,
  // so it is not preflighted at all, and it can read R2's actual error text.
  if (await nativePut(uploadUrl, file, contentType, cacheControl, onProgress)) {
    return { url: publicUrl, key };
  }

  // XHR path: gives real upload.onprogress for a percentage UI.
  if (typeof onProgress === 'function' && typeof XMLHttpRequest !== 'undefined') {
    await new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('PUT', uploadUrl, true);
      Object.entries(putHeaders).forEach(([k, v]) => xhr.setRequestHeader(k, v));
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
      };
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) { onProgress(100); resolve(); }
        else reject(new Error(`R2 upload failed (${xhr.status}): ${xhr.responseText || xhr.statusText}`));
      };
      // A network/CORS failure surfaces here with no status — say so.
      xhr.onerror = () => reject(new Error(`Upload network/CORS error hitting ${host}`));
      xhr.send(file);
    });
    return { url: publicUrl, key };
  }

  // Plain fetch path (no progress needed). A "Failed to fetch" here is almost
  // always CORS on the R2 bucket (or a network block); surface the host.
  let res;
  try {
    res = await fetch(uploadUrl, { method: 'PUT', headers: putHeaders, body: file });
  } catch (err) {
    throw new Error(`Upload network/CORS error hitting ${host}: ${err?.message || String(err)}`);
  }
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`R2 upload failed (${res.status}): ${text}`);
  }
  return { url: publicUrl, key };
}
