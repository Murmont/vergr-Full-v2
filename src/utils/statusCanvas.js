/**
 * Status canvas — the data model behind the Canva-style status editor.
 *
 * A status used to be "a gradient plus one centred textarea". This turns it
 * into a real canvas: stacked layers (text, image, drawing, sticker) that the
 * user positions, scales, rotates and animates.
 *
 * TWO THINGS ARE SAVED, deliberately:
 *   1. `canvas` — the layer model, so the viewer can REPLAY the animations and
 *      the author can re-edit later. Animation is the whole point of the
 *      feature; flattening it away would throw it out.
 *   2. `mediaUrl` — a flattened PNG. Anything that just wants an image (an old
 *      client, a share card, a link preview, a future feed thumbnail) gets one
 *      without needing to understand the model. A viewer that cannot render
 *      layers still shows the right picture instead of a blank gradient.
 *
 * Coordinates are NORMALISED (0..1 of the canvas box), never pixels — the same
 * status has to look identical on a small phone, a tablet and a desktop
 * preview, and pixel coordinates silently break the moment the box resizes.
 */

export const CANVAS_VERSION = 1;
/** Authoring aspect. 9:16 matches the story/status format everywhere else. */
export const CANVAS_W = 1080;
export const CANVAS_H = 1920;

/** Backgrounds: solid colours and gradients, plus whatever image is added. */
export const CANVAS_BACKGROUNDS = [
  { id: 'violet', css: 'linear-gradient(135deg,#B44FFF,#7B1FFF)' },
  { id: 'pinkviolet', css: 'linear-gradient(135deg,#7B1FFF,#C87FFF)' },
  { id: 'sunset', css: 'linear-gradient(135deg,#F0A500,#F04060)' },
  { id: 'ember', css: 'linear-gradient(135deg,#F04060,#C87FFF)' },
  { id: 'forest', css: 'linear-gradient(135deg,#22C55E,#065F46)' },
  { id: 'ocean', css: 'linear-gradient(135deg,#3D7FFF,#7B1FFF)' },
  { id: 'midnight', css: 'linear-gradient(135deg,#14141F,#3D7FFF)' },
  { id: 'gold', css: 'linear-gradient(135deg,#F5C842,#F0A500)' },
  { id: 'mono', css: 'linear-gradient(135deg,#2A2A3E,#0B0B14)' },
  { id: 'candy', css: 'linear-gradient(135deg,#FF9BD2,#B44FFF)' },
  { id: 'mint', css: 'linear-gradient(135deg,#5EEAD4,#3D7FFF)' },
  { id: 'black', css: '#0B0B14' },
  { id: 'white', css: '#FFFFFF' },
];

/**
 * Swatches for text and brush. Deliberately a broad set — "add more colors"
 * was an explicit ask, and a 6-colour row is what made it feel limited.
 */
export const CANVAS_COLORS = [
  '#FFFFFF', '#000000', '#B44FFF', '#7B1FFF', '#C87FFF', '#FF9BD2',
  '#F04060', '#FF6B6B', '#F0A500', '#F5C842', '#FFE66D', '#22C55E',
  '#5EEAD4', '#3D7FFF', '#60A5FA', '#1E293B', '#94A3B8', '#78350F',
];

/** Fonts already loaded by the app — no extra network cost. */
export const CANVAS_FONTS = [
  { id: 'display', label: 'Display', css: "'Syne', sans-serif", weight: 800 },
  { id: 'body', label: 'Clean', css: "'DM Sans', sans-serif", weight: 700 },
  { id: 'light', label: 'Light', css: "'DM Sans', sans-serif", weight: 400 },
];

/**
 * Entrance animations, Canva-style. Each is a CSS keyframe name defined in
 * index.css. `stagger` lets several layers arrive in sequence rather than all
 * at once, which is what makes a multi-layer status feel designed.
 */
export const CANVAS_ANIMS = [
  { id: 'none', label: 'None' },
  { id: 'fade', label: 'Fade' },
  { id: 'pop', label: 'Pop' },
  { id: 'slideUp', label: 'Rise' },
  { id: 'slideDown', label: 'Drop' },
  { id: 'slideLeft', label: 'Slide' },
  { id: 'zoom', label: 'Zoom' },
  { id: 'bounce', label: 'Bounce' },
  { id: 'spin', label: 'Spin' },
];

let seq = 0;
export const newLayerId = () => `l${Date.now().toString(36)}${(seq++).toString(36)}`;

/** A fresh, empty canvas. */
export function emptyCanvas() {
  return {
    v: CANVAS_VERSION,
    bg: { css: CANVAS_BACKGROUNDS[0].css, imageUrl: null },
    layers: [],
  };
}

export function makeTextLayer(text = 'Tap to edit') {
  return {
    id: newLayerId(), type: 'text', text,
    x: 0.5, y: 0.45, scale: 1, rot: 0,
    color: '#FFFFFF', font: 'display', size: 0.075, align: 'center',
    anim: 'pop', delay: 0,
  };
}

export function makeImageLayer(url, aspect = 1) {
  return {
    id: newLayerId(), type: 'image', url, aspect,
    x: 0.5, y: 0.5, scale: 0.7, rot: 0, radius: 0.02,
    anim: 'fade', delay: 0,
  };
}

export function makeStickerLayer(emoji) {
  return {
    id: newLayerId(), type: 'sticker', emoji,
    x: 0.5, y: 0.5, scale: 1, rot: 0, size: 0.16,
    anim: 'bounce', delay: 0,
  };
}

export function makeDrawLayer() {
  return { id: newLayerId(), type: 'draw', paths: [], anim: 'fade', delay: 0 };
}

/** Is there anything worth posting? */
export function canvasHasContent(c) {
  if (!c) return false;
  return (c.layers || []).some((l) => {
    if (l.type === 'text') return !!String(l.text || '').trim();
    if (l.type === 'draw') return (l.paths || []).some((p) => (p.pts || []).length > 1);
    return true;
  });
}

/** Plain text of a canvas, for notifications, previews and accessibility. */
export function canvasText(c) {
  return (c?.layers || [])
    .filter((l) => l.type === 'text' && String(l.text || '').trim())
    .map((l) => l.text.trim())
    .join(' ')
    .slice(0, 200);
}

/**
 * Flatten to a PNG blob at full authoring resolution.
 *
 * Drawn with the SAME normalised geometry the live renderer uses, so the export
 * matches what the author saw. Images are loaded with crossOrigin so the canvas
 * is not tainted — a tainted canvas throws on toBlob, which would silently make
 * posting fail rather than produce a wrong picture.
 */
export async function flattenCanvas(canvas, { width = CANVAS_W, height = CANVAS_H } = {}) {
  const el = document.createElement('canvas');
  el.width = width; el.height = height;
  const ctx = el.getContext('2d');

  // Background: CSS gradient strings are re-created as canvas gradients, since
  // canvas cannot parse `linear-gradient(...)`.
  paintBackground(ctx, canvas?.bg, width, height);

  for (const layer of canvas?.layers || []) {
    ctx.save();
    const cx = layer.x * width;
    const cy = layer.y * height;
    if (layer.type !== 'draw') {
      ctx.translate(cx, cy);
      ctx.rotate((layer.rot || 0) * Math.PI / 180);
    }
    try {
      if (layer.type === 'text') drawText(ctx, layer, width, height);
      else if (layer.type === 'sticker') drawSticker(ctx, layer, width, height);
      else if (layer.type === 'image') await drawImage(ctx, layer, width, height);
      else if (layer.type === 'draw') drawPaths(ctx, layer, width, height);
    } catch { /* one bad layer must not fail the whole export */ }
    ctx.restore();
  }

  return new Promise((resolve) => el.toBlob((b) => resolve(b), 'image/png', 0.92));
}

function paintBackground(ctx, bg, w, h) {
  const css = bg?.css || CANVAS_BACKGROUNDS[0].css;
  const m = /linear-gradient\(([^,]+),(.+)\)/.exec(css);
  if (m) {
    const stops = m[2].split(',').map((s) => s.trim()).filter(Boolean);
    const g = ctx.createLinearGradient(0, 0, w, h);
    stops.forEach((c, i) => {
      try { g.addColorStop(stops.length === 1 ? 0 : i / (stops.length - 1), c); } catch { /* skip */ }
    });
    ctx.fillStyle = g;
  } else {
    ctx.fillStyle = css;
  }
  ctx.fillRect(0, 0, w, h);
}

function fontFor(layer, h) {
  const f = CANVAS_FONTS.find((x) => x.id === layer.font) || CANVAS_FONTS[0];
  const px = Math.max(8, (layer.size || 0.07) * h * (layer.scale || 1));
  return { css: `${f.weight} ${px}px ${f.css}`, px };
}

function drawText(ctx, layer, w, h) {
  const { css, px } = fontFor(layer, h);
  ctx.font = css;
  ctx.fillStyle = layer.color || '#fff';
  ctx.textAlign = layer.align || 'center';
  ctx.textBaseline = 'middle';
  // Wrap to 84% of the canvas, matching the live renderer's max width.
  const maxW = w * 0.84;
  const lines = wrap(ctx, String(layer.text || ''), maxW);
  const lh = px * 1.22;
  const total = lines.length * lh;
  lines.forEach((ln, i) => {
    ctx.fillText(ln, 0, -total / 2 + lh / 2 + i * lh);
  });
}

function wrap(ctx, text, maxW) {
  const out = [];
  for (const para of String(text).split('\n')) {
    let line = '';
    for (const word of para.split(' ')) {
      const test = line ? `${line} ${word}` : word;
      if (ctx.measureText(test).width > maxW && line) { out.push(line); line = word; }
      else line = test;
    }
    out.push(line);
  }
  return out;
}

function drawSticker(ctx, layer, w, h) {
  const px = (layer.size || 0.16) * h * (layer.scale || 1);
  ctx.font = `${px}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(layer.emoji || '', 0, 0);
}

function drawImage(ctx, layer, w, h) {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const bw = w * (layer.scale || 0.7);
      const bh = bw / (layer.aspect || 1);
      const r = (layer.radius || 0) * w;
      ctx.save();
      if (r > 0) {
        ctx.beginPath();
        roundRect(ctx, -bw / 2, -bh / 2, bw, bh, r);
        ctx.clip();
      }
      ctx.drawImage(img, -bw / 2, -bh / 2, bw, bh);
      ctx.restore();
      resolve();
    };
    img.onerror = () => resolve();
    img.src = layer.url;
  });
}

function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

function drawPaths(ctx, layer, w, h) {
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const p of layer.paths || []) {
    const pts = p.pts || [];
    if (pts.length < 2) continue;
    ctx.strokeStyle = p.color || '#fff';
    ctx.lineWidth = Math.max(1, (p.width || 0.01) * w);
    ctx.beginPath();
    ctx.moveTo(pts[0][0] * w, pts[0][1] * h);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0] * w, pts[i][1] * h);
    ctx.stroke();
  }
}
