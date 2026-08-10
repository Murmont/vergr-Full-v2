import { useCachedImage, reportImageError } from '../utils/deviceMediaCache';

/**
 * Drop-in replacement for <img> that keeps the image ON THE PHONE (hidden app
 * dir) on first sight and renders it from local storage on every later view —
 * including after a restart, and offline. See fileMediaCache.js. Falls back to
 * the remote src whenever caching is unavailable, so in the worst case it
 * behaves exactly like a plain <img>.
 *
 * Only cdn.vergr.app / Firebase Storage / googleusercontent images are cached;
 * anything else (giphy, data URIs, blobs) passes straight through untouched.
 */
export default function CachedImg({ src, policyGated, permanent, onError, ...rest }) {
  // policyGated = chat message media → honours the Storage "auto-download media"
  // setting. permanent = banners/backgrounds, which live in storage Android will
  // not reclaim. Omit both for ordinary content images.
  const cached = useCachedImage(src, { policyGated, permanent });

  const handleError = (e) => {
    // Android may clear the reclaimable cache tier without telling us, so a
    // failure on a local file means a stale manifest entry rather than a bad
    // image. Forget it and retry once over the network before giving up.
    if (src && e.target.src !== src) {
      reportImageError(src);
      e.target.src = src;
      return;
    }
    onError?.(e);
  };

  // While a fallback lookup is pending `cached` can be '' — omit the src
  // attribute entirely (undefined) so no broken-image icon flashes.
  return <img src={cached || undefined} onError={handleError} {...rest} />;
}
