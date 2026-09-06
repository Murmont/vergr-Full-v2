// MediaFramer — the user says what the picture shows, not us.
//
// ⚠⚠ THIS EXISTS BECAUSE THE APP DECIDED, IN THREE PLACES. `PRESETS.avatar` set
// `square: true` and `compressImage` centre-cropped every avatar to 1:1;
// `resizeImageToBanner` cover-fits and "crops overflow" at 1500x500 and again at
// 600x800. In all three a portrait photo silently lost whatever fell outside,
// including the top of somebody's head, and they only found out once it was
// live. Founder, 2026-09-06: *"if cropping on any media is [required] then we
// shouldnt do it for the user because thats not what other platforms do, we
// should allow them to move lines so that will see what will be visible and
// what wont be visible."*
//
// ⚠ ONE COMPONENT, ANY ASPECT. Three separate croppers would drift, and two of
// the three would end up not carrying the labels. `aspect` is width / height:
// 1 for an avatar, 3 for the banner, 0.75 for the 3:4 card.
//
// ⚠ BOTH REGIONS ARE LABELLED. A dimmed area with no words on it only says
// "something is different here". The window says KEPT, the outside says CUT.
//
// ⚠ THE CIRCLE IS A GUIDE, NOT THE CROP. Avatars render round nearly everywhere
// but the stored file is square, so the square is what is saved and the circle
// shows what most surfaces will show of it. Cropping to the circle would throw
// away corners that some surfaces legitimately use.
//
// ⚠ IT RETURNS SOURCE PIXELS, NOT PREVIEW PIXELS. The preview is scaled to fit
// the dialog, so returning on-screen coordinates would crop a different part of
// a large photo than the one the user drew.
import { useEffect, useRef, useState } from 'react';
import Icon from '../Icon';

const MIN_FRAC = 0.2;   // never smaller than a fifth of the fitted box

export default function MediaFramer({
  file,
  aspect = 1,
  round = false,
  title = 'Position your photo',
  hint = 'Drag to choose what is shown. Anything outside is cut.',
  onCancel,
  onConfirm,
}) {
  const [url, setUrl] = useState(null);
  const [nat, setNat] = useState(null);      // source pixels
  const [imgEl, setImgEl] = useState(null);
  const [rect, setRect] = useState(null);    // { sx, sy, w, h } in SOURCE px
  const dragRef = useRef(null);

  useEffect(() => {
    if (!file) return undefined;
    const u = URL.createObjectURL(file);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [file]);

  const onLoad = (e) => {
    const w = e.target.naturalWidth;
    const h = e.target.naturalHeight;
    setNat({ w, h });
    // Open on the largest window of this aspect that fits, centred — i.e. what
    // the old automatic crop produced, so anyone happy with it just presses go.
    let cw = w;
    let ch = w / aspect;
    if (ch > h) { ch = h; cw = h * aspect; }
    setRect({ sx: Math.round((w - cw) / 2), sy: Math.round((h - ch) / 2), w: Math.round(cw), h: Math.round(ch) });
  };

  const scale = imgEl && nat ? imgEl.getBoundingClientRect().width / nat.w : 1;

  const start = (mode) => (e) => {
    if (!rect || !nat) return;
    e.preventDefault();
    e.stopPropagation();
    dragRef.current = { mode, x: e.clientX, y: e.clientY, rect: { ...rect } };
    const move = (ev) => {
      const d = dragRef.current;
      if (!d) return;
      const dx = (ev.clientX - d.x) / scale;
      const dy = (ev.clientY - d.y) / scale;
      if (d.mode === 'move') {
        setRect({
          w: d.rect.w,
          h: d.rect.h,
          sx: Math.min(nat.w - d.rect.w, Math.max(0, d.rect.sx + dx)),
          sy: Math.min(nat.h - d.rect.h, Math.max(0, d.rect.sy + dy)),
        });
        return;
      }
      // A corner resizes, aspect locked. One axis drives it and the result is
      // clamped so the window can never leave the photo — an unclamped resize
      // reads pixels that are not there and leaves a transparent edge.
      const grow = d.mode === 'se' ? Math.max(dx, dy) : -Math.max(dx, dy);
      const maxW = Math.min(nat.w, nat.h * aspect);
      let w = Math.min(maxW, Math.max(maxW * MIN_FRAC, d.rect.w + grow));
      let h = w / aspect;
      let sx = d.mode === 'se' ? d.rect.sx : d.rect.sx + (d.rect.w - w);
      let sy = d.mode === 'se' ? d.rect.sy : d.rect.sy + (d.rect.h - h);
      sx = Math.min(nat.w - w, Math.max(0, sx));
      sy = Math.min(nat.h - h, Math.max(0, sy));
      w = Math.min(w, nat.w - sx);
      h = Math.min(w / aspect, nat.h - sy);
      w = h * aspect;
      setRect({ sx, sy, w, h });
    };
    const up = () => {
      dragRef.current = null;
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const pct = rect && nat ? {
    left: `${(rect.sx / nat.w) * 100}%`,
    top: `${(rect.sy / nat.h) * 100}%`,
    width: `${(rect.w / nat.w) * 100}%`,
    height: `${(rect.h / nat.h) * 100}%`,
  } : null;

  const Corner = ({ mode, style }) => (
    <div onPointerDown={start(mode)} style={{
      position: 'absolute', width: 26, height: 26, cursor: 'nwse-resize',
      display: 'grid', placeItems: 'center', touchAction: 'none', ...style,
    }}>
      <span style={{
        width: 16, height: 16, borderRadius: 5,
        background: 'linear-gradient(180deg, #9a4cf5, #7526f5)',
        boxShadow: '0 3px 10px rgba(0,0,0,0.55)',
      }} />
    </div>
  );

  return (
    <div role="dialog" aria-label={title} style={{
      position: 'fixed', inset: 0, zIndex: 120, background: 'rgba(0,0,0,0.72)',
      display: 'grid', placeItems: 'center', padding: 16,
    }}>
      <div style={{
        width: 'min(460px, 100%)', borderRadius: 22, padding: 16,
        background: 'linear-gradient(180deg, #17132f 0%, #0e0d22 100%)',
        boxShadow: '0 24px 60px rgba(0,0,0,0.6)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
          <span style={{ flex: 1, fontSize: 16, fontWeight: 800, color: '#fff' }}>{title}</span>
          <button type="button" aria-label="Cancel" onClick={onCancel} style={{
            width: 30, height: 30, borderRadius: 999, border: 'none', cursor: 'pointer',
            background: '#1c1c3c', color: '#c9c9dd', display: 'grid', placeItems: 'center',
          }}><Icon name="close" size={16} /></button>
        </div>
        <div style={{ fontSize: 12, color: '#a0a0b8', lineHeight: 1.5, marginBottom: 12 }}>{hint}</div>

        <div style={{ position: 'relative', width: '100%', borderRadius: 12, overflow: 'hidden', background: '#0a0a14', touchAction: 'none' }}>
          {url && <img ref={setImgEl} src={url} alt="" onLoad={onLoad} style={{ display: 'block', width: '100%', height: 'auto' }} />}
          {pct && (
            <>
              {/* Four dim panels rather than one with a hole, so the kept region
                  is genuinely untouched pixels and not a lightened overlay. */}
              <div style={{ position: 'absolute', left: 0, right: 0, top: 0, height: pct.top, background: 'rgba(0,0,0,0.62)' }} />
              <div style={{ position: 'absolute', left: 0, right: 0, top: `calc(${pct.top} + ${pct.height})`, bottom: 0, background: 'rgba(0,0,0,0.62)' }} />
              <div style={{ position: 'absolute', left: 0, width: pct.left, top: pct.top, height: pct.height, background: 'rgba(0,0,0,0.62)' }} />
              <div style={{ position: 'absolute', left: `calc(${pct.left} + ${pct.width})`, right: 0, top: pct.top, height: pct.height, background: 'rgba(0,0,0,0.62)' }} />
              <span style={{ position: 'absolute', left: 8, top: 8, fontSize: 9, fontWeight: 800, letterSpacing: '0.06em', color: '#8b8ba7' }}>CUT</span>

              <div onPointerDown={start('move')} style={{
                position: 'absolute', ...pct, cursor: 'grab', touchAction: 'none',
                boxShadow: '0 0 0 2px #b44fff, 0 0 22px rgba(180,79,255,0.45)',
              }}>
                {round && <span style={{ position: 'absolute', inset: 0, borderRadius: '50%', boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.55)' }} />}
                <Corner mode="nw" style={{ left: -13, top: -13 }} />
                <Corner mode="se" style={{ right: -13, bottom: -13 }} />
                <span style={{
                  position: 'absolute', left: '50%', bottom: 6, transform: 'translateX(-50%)',
                  whiteSpace: 'nowrap', fontSize: 9, fontWeight: 800, letterSpacing: '0.06em',
                  color: '#fff', background: 'linear-gradient(180deg, #9a4cf5, #7526f5)',
                  padding: '2px 8px', borderRadius: 999,
                }}>KEPT</span>
              </div>
            </>
          )}
        </div>

        <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
          <button type="button" onClick={onCancel} style={{
            flex: 1, padding: 14, borderRadius: 14, cursor: 'pointer', fontSize: 14, fontWeight: 800,
            background: 'linear-gradient(180deg, #1c1c3c 0%, #141530 100%)',
            border: '1px solid #423a5f', color: '#e8e8f0',
          }}>Cancel</button>
          <button type="button" disabled={!rect} onClick={() => onConfirm(rect)} style={{
            flex: 2, padding: 14, borderRadius: 14, border: 'none', cursor: rect ? 'pointer' : 'default',
            background: 'linear-gradient(135deg, #a84dff 0%, #9a43f8 38%, #7427f4 100%)',
            color: '#fff', fontSize: 14, fontWeight: 800, opacity: rect ? 1 : 0.5,
          }}>Use photo</button>
        </div>
      </div>
    </div>
  );
}
