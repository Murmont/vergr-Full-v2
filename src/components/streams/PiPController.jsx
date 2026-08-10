// PiPController — Picture-in-Picture that follows the user across the app.
//
// Two modes:
//   1. Document PiP (Chromium ≥ 116) — full HTML rendered in a floating
//      window; we move our existing <video> + chat snippet into that window.
//   2. Video PiP fallback — standard `requestPictureInPicture()` on the
//      <video> element. Works on Safari + Firefox + older Chrome.
//
// The PiP follows wherever the user navigates (the floating window is
// page-independent), so they can scroll the home feed while still watching
// the stream. Closing the PiP returns control to the page.

import { useEffect, useRef, useState } from 'react';

export default function PiPController({ videoElRef, enabled = true, title = 'Live stream' }) {
  const [active, setActive] = useState(false);
  const docPipRef = useRef(null);

  // Listen for native PiP toggles too.
  useEffect(() => {
    const v = videoElRef?.current;
    if (!v) return;
    const onEnter = () => setActive(true);
    const onLeave = () => setActive(false);
    v.addEventListener('enterpictureinpicture', onEnter);
    v.addEventListener('leavepictureinpicture', onLeave);
    return () => {
      v.removeEventListener('enterpictureinpicture', onEnter);
      v.removeEventListener('leavepictureinpicture', onLeave);
    };
  }, [videoElRef]);

  const enter = async () => {
    const v = videoElRef?.current;
    if (!v) return;
    // Prefer Document PiP if available — allows richer overlays.
    if (typeof window !== 'undefined' && 'documentPictureInPicture' in window) {
      try {
        const pip = await window.documentPictureInPicture.requestWindow({
          width: 360, height: 200,
        });
        docPipRef.current = pip;
        // Style the PiP body identically to ours.
        pip.document.head.innerHTML = `<style>
          html, body { margin: 0; background: #000; overflow: hidden; height: 100%; font-family: 'Inter', system-ui, sans-serif; }
          video { width: 100%; height: 100%; object-fit: contain; background: #000; }
          .vergr-pip-strap {
            position: absolute; left: 0; right: 0; bottom: 0;
            padding: 6px 10px;
            background: linear-gradient(0deg, rgba(0,0,0,0.7), transparent);
            color: #fff; font-size: 11px; font-weight: 700;
            display: flex; align-items: center; gap: 6px;
          }
          .live-dot { width: 6px; height: 6px; border-radius: 50%;
            background: #ef4444; box-shadow: 0 0 6px #ef4444; }
        </style>`;
        const wrap = pip.document.createElement('div');
        wrap.style.position = 'relative';
        wrap.style.width = '100%';
        wrap.style.height = '100%';
        pip.document.body.appendChild(wrap);
        wrap.appendChild(v); // move the live <video>
        const strap = pip.document.createElement('div');
        strap.className = 'vergr-pip-strap';
        strap.innerHTML = `<span class="live-dot"></span><span>LIVE · ${escapeHtml(title)}</span>`;
        wrap.appendChild(strap);
        pip.addEventListener('pagehide', () => {
          // User closed PiP — return the video to its original parent if still mounted.
          // Caller is responsible for keeping a slot for it.
          window.dispatchEvent(new CustomEvent('vergr:pip-closed'));
        });
        setActive(true);
        return;
      } catch (err) { /* fall through to native */ }
    }
    // Native video PiP.
    if (document.pictureInPictureEnabled && !v.disablePictureInPicture) {
      try {
        await v.requestPictureInPicture();
        setActive(true);
      } catch (err) {
        console.warn('PiP failed:', err);
      }
    }
  };

  const exit = async () => {
    try {
      if (docPipRef.current) docPipRef.current.close();
      else if (document.pictureInPictureElement) await document.exitPictureInPicture();
    } catch {}
    setActive(false);
    docPipRef.current = null;
  };

  if (!enabled) return null;

  return (
    <button
      onClick={active ? exit : enter}
      aria-label={active ? 'Exit Picture-in-Picture' : 'Picture-in-Picture'}
      style={{
        padding: '5px 10px', borderRadius: 6, border: 'none',
        background: 'rgba(0,0,0,0.55)', color: '#fff',
        fontSize: 11, fontWeight: 700, cursor: 'pointer',
        display: 'flex', alignItems: 'center', gap: 4,
      }}
    >
      <span className="material-symbols-outlined" style={{ fontSize: 14 }}>
        {active ? 'picture_in_picture_alt' : 'picture_in_picture'}
      </span>
      {active ? 'Exit PiP' : 'PiP'}
    </button>
  );
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}
