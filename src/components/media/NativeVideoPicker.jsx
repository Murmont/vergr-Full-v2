// NativeVideoPicker — pick a video through VERGR'S OWN gallery, not the system
// photo picker, so the file arrives with a real path on disk.
//
// That distinction is the whole reason this component exists. `nativeMedia.js`
// attaches `file._nativePath` to anything resolved here, and
// `canHardwareTranscode()` (nativeTranscode.js:36) requires it, because Kotlin's
// MediaExtractor cannot read a JavaScript Blob. A video chosen through the
// SYSTEM picker has no path, so it can only ever reach the real-time canvas
// encoder: a minute of encoding per minute of video, and the path that shipped
// a 22-second clip as two frames (CLAUDE.md, 2026-09-12).
//
// So: same bytes, same user gesture, but picking here is what makes hardware
// transcoding possible at all.
//
// Falls back to the system picker by design, never as an error state:
//   • web / desktop — there is no bridge
//   • the user denies gallery permission (`listDeviceMedia` rejects)
//   • the gallery is empty of video
// In every fallback the post still works, it just uses the slower encoder.
import { useState, useEffect, useCallback } from 'react';
import { isNativeMediaAvailable, listDeviceMedia, resolveDeviceMedia, formatDuration } from '../../utils/nativeMedia';
import Icon from '../Icon';

export default function NativeVideoPicker({ open, onClose, onPicked, onUseSystemPicker }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [galleryOff, setGalleryOff] = useState(false);

  const available = isNativeMediaAvailable();

  useEffect(() => {
    if (!open || !available) return;
    let alive = true;
    setLoading(true);
    setGalleryOff(false);
    listDeviceMedia(60)
      .then((rows) => {
        if (!alive) return;
        // Videos only. A clip screen offering photos is a dead end.
        setItems((rows || []).filter((r) => r.isVideo));
      })
      .catch(() => { if (alive) setGalleryOff(true); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [open, available]);

  const pick = useCallback(async (id) => {
    if (busy) return;
    setBusy(true);
    try {
      const files = await resolveDeviceMedia([id]);
      if (files?.length) {
        onPicked?.(files[0]);
        onClose?.();
      } else {
        // Reading the original failed. Do not strand the user on an empty
        // sheet: the system picker can still get the bytes.
        setGalleryOff(true);
      }
    } catch {
      setGalleryOff(true);
    }
    setBusy(false);
  }, [busy, onPicked, onClose]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const fallback = !available || galleryOff;

  return (
    <div className="fixed inset-0 z-[140] flex flex-col justify-end" role="dialog" aria-modal="true" aria-label="Choose a video">
      <button className="absolute inset-0 bg-black/60" onClick={onClose} aria-label="Close" />
      <div
        className="relative w-full rounded-t-2xl bg-surface-1 pt-3"
        style={{ paddingBottom: 'calc(var(--vg-safe-b, 0px) + 12px)' }}
      >
        <div className="flex items-center justify-between px-4 pb-3">
          <h3 className="font-syne font-bold text-sm">Choose a video</h3>
          <button onClick={onClose} className="text-text-muted" aria-label="Close">
            <Icon name="close" size={20} />
          </button>
        </div>

        {fallback ? (
          <div className="px-4 pb-4">
            <p className="text-text-muted text-sm mb-3">
              {galleryOff
                ? 'Vergr cannot read your gallery, so pick the video with your phone’s own picker.'
                : 'Pick a video from your device.'}
            </p>
            <button
              onClick={() => { onUseSystemPicker?.(); onClose?.(); }}
              className="w-full py-3 rounded-xl bg-brand-violet text-white font-bold text-sm"
            >
              Browse files
            </button>
          </div>
        ) : (
          <>
            <div
              className="grid grid-cols-3 gap-1 px-2 overflow-y-auto overscroll-contain"
              style={{ maxHeight: '46vh' }}
            >
              {loading && items.length === 0 && Array.from({ length: 9 }).map((_, i) => (
                <div key={`sk-${i}`} className="aspect-square rounded-lg bg-surface-2/60 animate-pulse" />
              ))}
              {items.map((it) => (
                <button
                  key={it.id}
                  onClick={() => pick(it.id)}
                  disabled={busy}
                  className="relative aspect-square rounded-lg overflow-hidden bg-surface-2 active:scale-[0.97] transition-transform disabled:opacity-50"
                >
                  <img src={it.thumbSrc} alt="" loading="lazy" className="w-full h-full object-cover" />
                  <span className="absolute bottom-1 left-1 flex items-center gap-0.5 px-1.5 py-0.5 rounded-md bg-black/65 text-[9px] font-bold text-white tabular-nums">
                    <Icon name="play_arrow" size={10} />
                    {formatDuration(it.durationMs)}
                  </span>
                </button>
              ))}
            </div>

            {!loading && items.length === 0 && (
              <p className="text-text-muted text-sm text-center py-8 px-4">No videos in your gallery yet.</p>
            )}

            {/* Always reachable: the gallery lists 60 recent items, so a video
                older than that is only findable through the system picker. */}
            <button
              onClick={() => { onUseSystemPicker?.(); onClose?.(); }}
              className="w-full mt-3 py-2.5 text-brand-violet-light text-xs font-bold"
            >
              Browse all files instead
            </button>
          </>
        )}
      </div>
    </div>
  );
}
