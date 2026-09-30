// Text and sticker overlays drawn over a clip's picture. ONE renderer for the
// player (ShortsDeck, LadderPlayer), the post preview and the editor, so what a
// creator places is exactly what a viewer sees. Positions come from
// utils/clipEdits.js and are fractions of the picture, not of the screen.
import { useEffect, useState } from 'react';
import { contentRect, overlayCss } from '../../utils/clipEdits';

/**
 * The picture's rect inside `boxRef`, tracking resizes and the video's metadata.
 * `enabled` false costs nothing, so a player only observes when a clip has overlays.
 */
export function useContentRect(boxRef, videoRef, anchorTop = false, enabled = true) {
  const [rect, setRect] = useState(null);
  useEffect(() => {
    const box = boxRef.current;
    const v = videoRef.current;
    if (!enabled || !box || !v) return undefined;
    const measure = () => setRect(contentRect(box.clientWidth, box.clientHeight, v.videoWidth, v.videoHeight, anchorTop));
    measure();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    ro?.observe(box);
    v.addEventListener('loadedmetadata', measure);
    v.addEventListener('resize', measure);
    return () => {
      ro?.disconnect();
      v.removeEventListener('loadedmetadata', measure);
      v.removeEventListener('resize', measure);
    };
  }, [boxRef, videoRef, anchorTop, enabled]);
  return rect;
}

/**
 * Plays only the trimmed window of a local preview, looping inside it. Checked
 * every frame while playing, so the loop point lands within a frame of the handle.
 */
export function useTrimLoop(videoRef, start = 0, end = null, enabled = true) {
  useEffect(() => {
    const v = videoRef.current;
    if (!v || !enabled) return undefined;
    const s = Math.max(0, start || 0);
    let raf = 0;
    const restart = () => { try { v.currentTime = s; } catch { /* not seekable yet */ } };
    const tick = () => {
      raf = 0;
      if (end != null && v.currentTime >= end - 0.03) restart();
      else if (v.currentTime < s - 0.2) restart();
      if (!v.paused) raf = requestAnimationFrame(tick);
    };
    const onPlay = () => { if (!raf) raf = requestAnimationFrame(tick); };
    const onEnded = () => { restart(); v.play().catch(() => {}); };
    v.addEventListener('play', onPlay);
    v.addEventListener('ended', onEnded);
    if (!v.paused) onPlay();
    else if (v.currentTime < s || (end != null && v.currentTime > end)) restart();
    return () => {
      v.removeEventListener('play', onPlay);
      v.removeEventListener('ended', onEnded);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [videoRef, start, end, enabled]);
}

export default function EditOverlays({ overlays, rect }) {
  if (!rect || !overlays?.length) return null;
  return (
    <div aria-hidden className="absolute inset-0 z-[2] pointer-events-none overflow-hidden">
      {overlays.map((o) => (
        <div key={o.id} style={overlayCss(o, rect)}>{o.text}</div>
      ))}
    </div>
  );
}
