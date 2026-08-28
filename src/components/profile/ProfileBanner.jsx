// Profile banner — still image or a short looping clip. Scope-table effect 16.
//
// ⚠ ONE COMPONENT BECAUSE THERE ARE FOUR PROFILE VIEWS: web own, web public,
// native own, native public. That is the single most repeated mistake in this
// codebase — the avatar orbit shipped wired to ONE of them and was therefore
// invisible to every visitor. Anything banner-shaped goes through here so the
// four cannot drift.
//
// ⚠ `<CachedImg>` CANNOT RENDER A VIDEO. The banner was an <img> everywhere, so
// a video URL produced a broken-image glyph rather than a clip. That is the
// whole reason this component exists rather than a prop on the old markup.
import { useEffect, useRef } from 'react';
import CachedImg from '../CachedImg';

/**
 * Is this banner a clip rather than a still?
 *
 * ⚠ MATCHED ON THE EXTENSION, NOT A STORED FLAG. The URL is an immutable R2 key
 * ending in the content type's extension (functions/r2.js builds it that way),
 * so the URL is self-describing and there is no second field to keep in sync —
 * which is the failure mode that produced two accent systems on this very
 * screen. Query strings are stripped first: presigned reads carry them.
 */
export const isVideoBanner = (url) =>
  /\.(mp4|webm|mov)$/i.test(String(url || '').split('?')[0]);

export default function ProfileBanner({ src, className, videoRef }) {
  const localRef = useRef(null);
  const ref = videoRef || localRef;
  const video = isVideoBanner(src);

  // ⚠ AUTOPLAY IS NOT GUARANTEED, even muted. If the browser refuses, a paused
  // first frame is still a perfectly good banner — so failure is silent by
  // design and never surfaces an error to someone looking at a profile.
  useEffect(() => {
    if (!video) return;
    const el = ref.current;
    if (el) el.play?.().catch(() => { /* first frame stands in */ });
  }, [video, src, ref]);

  if (!src) return null;

  if (!video) {
    return <CachedImg src={src} permanent alt="" className={className} />;
  }

  return (
    <video
      ref={ref}
      src={src}
      className={className}
      // ⚠ muted + playsInline are REQUIRED, not stylistic. Without muted no
      // browser will autoplay; without playsInline iOS takes the video
      // fullscreen the moment it starts, hijacking the whole page.
      muted
      loop
      autoPlay
      playsInline
      // It is decoration behind a profile header: it must never be a control.
      controls={false}
      disablePictureInPicture
      // ⚠ `preload="metadata"` NOT "auto". The clip is capped at 8s and ~6MB,
      // but a profile visit should not commit to the whole download before the
      // element is even on screen.
      preload="metadata"
      aria-hidden="true"
      tabIndex={-1}
    />
  );
}
