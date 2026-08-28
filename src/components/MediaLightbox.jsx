// MediaLightbox — full-screen viewer for chat media (Telegram/WhatsApp
// standard: tap a photo → fullscreen, pinch/double-tap zoom, swipe between
// the conversation's media, swipe down to dismiss, save/open).
//
// All gestures are pointer-event based (no native controls) so they work in
// the Android System WebView (durable native rule). Videos use the shared
// InlineVideoPlayer (custom HTML controls, WebView-safe).

import { useEffect, useRef, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import Icon from './Icon';
import InlineVideoPlayer from './media/InlineVideoPlayer';
import ErrorBoundary from './ErrorBoundary';
import { useUI } from '../context/UIContext';
import { isGallerySaveSupported, saveMediaToGallery, isMediaSaved } from '../utils/saveToGallery';

// `allowSave` gates the save-to-gallery button. It defaults to true, because
// saving media someone sent you in a chat is normal and every messenger does
// it. It exists for PAID content: LockedMedia renders unlocked purchases
// through this same lightbox, so a bought photo or video was one tap from the
// camera roll (audit A18, found while looking for something `allowDownloads`
// could honestly protect).
export default function MediaLightbox({ items, startIndex = 0, onClose, allowSave = true }) {
  const [index, setIndex] = useState(startIndex);
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const pointers = useRef(new Map());
  const gesture = useRef(null); // { startDist, startScale, startMid, startOffset, startY, swiping }
  const [dragY, setDragY] = useState(0);

  const item = items[index];
  const count = items.length;

  const { showToast } = useUI();
  const canSaveToGallery = allowSave && isGallerySaveSupported();
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  // Reset the saved/saving state whenever the visible item changes.
  useEffect(() => {
    setSaving(false);
    setSaved(item ? isMediaSaved(item.url) : false);
  }, [item?.url]);

  const handleSaveToGallery = useCallback(async () => {
    if (!item || saving) return;
    setSaving(true);
    const res = await saveMediaToGallery(item.url, { isVideo: item.type === 'video' });
    setSaving(false);
    if (res.ok) {
      setSaved(true);
      showToast?.(item.type === 'video' ? 'Video saved to gallery' : 'Photo saved to gallery', 'success');
    } else if (res.error !== 'unsupported') {
      showToast?.('Could not save to gallery', 'error');
    }
  }, [item, saving, showToast]);

  const resetZoom = useCallback(() => { setScale(1); setOffset({ x: 0, y: 0 }); }, []);

  const go = useCallback((dir) => {
    setIndex(i => {
      const n = Math.min(count - 1, Math.max(0, i + dir));
      return n;
    });
    resetZoom();
    setDragY(0);
  }, [count, resetZoom]);

  // Keyboard: arrows + escape (desktop parity).
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose?.();
      if (e.key === 'ArrowLeft') go(-1);
      if (e.key === 'ArrowRight') go(1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [go, onClose]);

  // Lock background scroll while open.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);

  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

  const onPointerDown = (e) => {
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    e.currentTarget.setPointerCapture?.(e.pointerId);
    const pts = [...pointers.current.values()];
    if (pts.length === 2) {
      gesture.current = {
        kind: 'pinch',
        startDist: dist(pts[0], pts[1]),
        startScale: scale,
        startMid: mid(pts[0], pts[1]),
        startOffset: { ...offset },
      };
    } else if (pts.length === 1) {
      gesture.current = {
        kind: 'drag',
        startX: e.clientX,
        startY: e.clientY,
        startOffset: { ...offset },
        moved: false,
      };
    }
  };

  const onPointerMove = (e) => {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const g = gesture.current;
    if (!g) return;
    const pts = [...pointers.current.values()];

    if (g.kind === 'pinch' && pts.length === 2) {
      const next = Math.min(5, Math.max(1, g.startScale * (dist(pts[0], pts[1]) / g.startDist)));
      setScale(next);
      if (next === 1) setOffset({ x: 0, y: 0 });
      return;
    }
    if (g.kind === 'drag' && pts.length === 1) {
      const dx = e.clientX - g.startX;
      const dy = e.clientY - g.startY;
      if (Math.abs(dx) + Math.abs(dy) > 6) g.moved = true;
      if (scale > 1) {
        // Pan the zoomed image.
        setOffset({ x: g.startOffset.x + dx, y: g.startOffset.y + dy });
      } else {
        // Horizontal swipe = prev/next; vertical drag = dismiss.
        if (Math.abs(dy) > Math.abs(dx)) setDragY(dy);
      }
    }
  };

  const onPointerUp = (e) => {
    pointers.current.delete(e.pointerId);
    const g = gesture.current;
    if (g?.kind === 'drag' && pointers.current.size === 0) {
      const dx = e.clientX - g.startX;
      const dy = e.clientY - g.startY;
      if (scale === 1) {
        if (Math.abs(dy) > 90 && Math.abs(dy) > Math.abs(dx)) { onClose?.(); return; }
        if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy)) { go(dx < 0 ? 1 : -1); return; }
      }
      setDragY(0);
    }
    if (pointers.current.size < 2 && g?.kind === 'pinch') gesture.current = null;
    if (pointers.current.size === 0) gesture.current = null;
  };

  const lastTap = useRef(0);
  const onTap = (e) => {
    // Double-tap toggles zoom (images only).
    const now = Date.now();
    if (now - lastTap.current < 300) {
      if (scale > 1) resetZoom();
      else setScale(2.2);
    }
    lastTap.current = now;
  };

  if (!item) return null;

  return createPortal(
    <div className="fixed inset-0 z-[200] bg-black/95 flex flex-col" style={{ touchAction: 'none' }}>
      {/* Top bar */}
      <div className="flex items-center justify-between px-3 z-10"
        style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 8px)', paddingBottom: 8 }}>
        <button onClick={onClose} aria-label="Close" className="w-10 h-10 rounded-full flex items-center justify-center text-white/90 bg-white/10">
          <Icon name="close" size={22} />
        </button>
        {count > 1 && <span className="text-white/70 text-xs font-dmmono tabular-nums">{index + 1} / {count}</span>}
        {canSaveToGallery ? (
          <button onClick={handleSaveToGallery} disabled={saving} aria-label="Save to gallery"
            className="w-10 h-10 rounded-full flex items-center justify-center text-white/90 bg-white/10 disabled:opacity-60">
            <Icon name={saving ? 'hourglass_empty' : saved ? 'download_done' : 'download'} size={20} />
          </button>
        ) : (
          <a href={item.url} target="_blank" rel="noopener noreferrer" aria-label="Open original"
            className="w-10 h-10 rounded-full flex items-center justify-center text-white/90 bg-white/10">
            <Icon name="download" size={20} />
          </a>
        )}
      </div>

      {/* Stage */}
      <div
        className="flex-1 flex items-center justify-center overflow-hidden select-none"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onClick={item.type === 'image' ? onTap : undefined}
        style={{ transform: dragY ? `translateY(${dragY}px)` : undefined, opacity: dragY ? Math.max(0.4, 1 - Math.abs(dragY) / 400) : 1 }}
      >
        {item.type === 'video' ? (
          <div className="w-full max-h-full" onPointerDown={(e) => e.stopPropagation()}>
            {/* This exact spot is where A41 #1 blanked the entire app: enlarging
                a chat video mounted a player that threw, and with no boundary
                React unmounted everything. That bug is fixed, but a broken
                video should never be able to do it again — the fallback keeps
                the lightbox itself alive so the user can still close it. */}
            <ErrorBoundary
              label="lightbox-video"
              fallback={(
                <div className="w-full h-[50vh] flex flex-col items-center justify-center gap-2 text-center px-6">
                  <Icon name="videocam_off" size={40} className="text-white/30" />
                  <div className="text-white/70 text-sm">This video could not be played.</div>
                </div>
              )}
            >
              <InlineVideoPlayer src={item.url} poster={item.poster} className="w-full max-h-[80vh]" ambilight ambilightSpread={140} />
            </ErrorBoundary>
          </div>
        ) : (
          <img
            src={item.url}
            alt=""
            draggable={false}
            className="max-w-full max-h-full object-contain"
            style={{ transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})`, transition: gesture.current ? 'none' : 'transform 0.15s' }}
          />
        )}
      </div>

      {/* Desktop arrows */}
      {count > 1 && (
        <>
          {index > 0 && (
            <button onClick={() => go(-1)} aria-label="Previous"
              className="hidden lg:flex absolute left-3 top-1/2 -translate-y-1/2 w-11 h-11 rounded-full bg-white/10 text-white items-center justify-center hover:bg-white/20">
              <Icon name="chevron_left" size={26} />
            </button>
          )}
          {index < count - 1 && (
            <button onClick={() => go(1)} aria-label="Next"
              className="hidden lg:flex absolute right-3 top-1/2 -translate-y-1/2 w-11 h-11 rounded-full bg-white/10 text-white items-center justify-center hover:bg-white/20">
              <Icon name="chevron_right" size={26} />
            </button>
          )}
        </>
      )}
    </div>,
    document.body
  );
}
