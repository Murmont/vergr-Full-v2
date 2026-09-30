// Clip edits: what the clip editor produces (src/components/create/ClipEditor).
//
// Founder decision, 2026-09-13: TRIM and MUTE are cut into the file at post time
// (compressVideo, which already does both); TEXT, STICKERS, SPEED and the two
// VOLUMES are stored on the post as `edits` and drawn by the player, the same
// way a chosen sound is. Posting stays instant, nothing is re-encoded for them,
// and they cost nothing. The one trade-off, stated: a downloaded file does not
// contain the overlays.
//
// Positions are FRACTIONS of the video's own picture (not the screen), so a clip
// looks the same on a phone, a desktop frame, and the feed.

export const SPEEDS = [0.5, 0.75, 1, 1.5, 2];

// Only faces the app already loads (Syne, DM Sans, DM Mono), so a clip with text
// never triggers a font download in the player.
export const TEXT_FONTS = [
  { id: 'classic', label: 'Classic', family: '"DM Sans", sans-serif', weight: 700 },
  { id: 'strong', label: 'Strong', family: 'Syne, sans-serif', weight: 800 },
  { id: 'type', label: 'Typewriter', family: '"DM Mono", monospace', weight: 500 },
  { id: 'neon', label: 'Neon', family: '"DM Sans", sans-serif', weight: 700, glow: true },
];

// No cyan (brand rule).
export const TEXT_COLORS = ['#FFFFFF', '#0B0B14', '#7B1FFF', '#C87FFF', '#F04060', '#F0A500', '#22C55E', '#3D7FFF'];

export const STICKERS = [
  '😂', '🔥', '😍', '💀', '😭', '👀', '🎮', '🏆', '💯', '👑', '⚡', '🎯',
  '😎', '🤯', '🥶', '🙌', '👏', '💜', '❤️', '✨', '🎉', '🤣', '😤', '🫡',
  '🤝', '👊', '💥', '🚀', '🍿', '🎧', '📸', '🌙', '☀️', '🌈', '🐐', '👻',
  '🤖', '🎬', '🕹️', '🧠', '💪', '🤔', '😅', '😴', '🥳', '😈', '🙏', '🫶',
];

export const MAX_OVERLAYS = 12;
export const MAX_TEXT = 150;

const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, Number.isFinite(Number(n)) ? Number(n) : lo));
const isHex = (c) => typeof c === 'string' && /^#[0-9A-Fa-f]{6}$/.test(c);

export const fontById = (id) => TEXT_FONTS.find((f) => f.id === id) || TEXT_FONTS[0];

export const fmtTime = (s) => {
  const t = Math.max(0, Math.floor(Number(s) || 0));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
};

export const defaultEdits = () => ({ speed: 1, overlays: [], originalVolume: 1, soundVolume: 1 });

let seq = 0;
const newId = (p) => `${p}${Date.now().toString(36)}${(seq++).toString(36)}`;

export const newTextOverlay = (patch = {}) => ({
  id: newId('t'), kind: 'text', text: '', font: 'classic', color: '#FFFFFF', bg: 'none',
  x: 0.5, y: 0.42, size: 0.075, rotation: 0, ...patch,
});

export const newStickerOverlay = (emoji, patch = {}) => ({
  id: newId('s'), kind: 'sticker', text: emoji, x: 0.5, y: 0.45, size: 0.18, rotation: 0, ...patch,
});

function cleanOverlay(o) {
  const text = String(o?.text || '').slice(0, MAX_TEXT);
  if (!text.trim()) return null;
  const sticker = o.kind === 'sticker';
  return {
    id: String(o.id || newId('o')).slice(0, 24),
    kind: sticker ? 'sticker' : 'text',
    text,
    ...(sticker ? {} : { font: fontById(o.font).id, color: isHex(o.color) ? o.color : '#FFFFFF', bg: o.bg === 'solid' ? 'solid' : 'none' }),
    x: clamp(o.x, 0, 1),
    y: clamp(o.y, 0, 1),
    size: clamp(o.size, 0.02, 0.6),
    rotation: Math.round(clamp(o.rotation, -180, 180)),
  };
}

/** What createPost stores. Only non-default values; null when nothing was edited. */
export function editsForPost(e) {
  if (!e) return null;
  const out = { v: 1 };
  if (SPEEDS.includes(e.speed) && e.speed !== 1) out.speed = e.speed;
  const overlays = (e.overlays || []).map(cleanOverlay).filter(Boolean).slice(0, MAX_OVERLAYS);
  if (overlays.length) out.overlays = overlays;
  // 0 is never stored: a silent original is cut out of the file instead.
  if (Number.isFinite(e.originalVolume) && e.originalVolume > 0 && e.originalVolume < 1) out.originalVolume = clamp(e.originalVolume, 0, 1);
  if (Number.isFinite(e.soundVolume) && e.soundVolume < 1) out.soundVolume = clamp(e.soundVolume, 0, 1);
  return Object.keys(out).length > 1 ? out : null;
}

/** The read side, used by the player. A post author can write any field, so trust nothing. */
export function playbackEdits(post) {
  const e = post?.edits;
  if (!e || typeof e !== 'object') return null;
  return {
    speed: SPEEDS.includes(e.speed) ? e.speed : 1,
    overlays: Array.isArray(e.overlays) ? e.overlays.map(cleanOverlay).filter(Boolean).slice(0, MAX_OVERLAYS) : [],
    originalVolume: Number.isFinite(e.originalVolume) ? clamp(e.originalVolume, 0, 1) : 1,
    soundVolume: Number.isFinite(e.soundVolume) ? clamp(e.soundVolume, 0, 1) : 1,
  };
}

/** The picture's box inside a player box drawn with object-fit: contain. */
export function contentRect(boxW, boxH, mediaW, mediaH, anchorTop = false) {
  if (!boxW || !boxH || !mediaW || !mediaH) return null;
  const s = Math.min(boxW / mediaW, boxH / mediaH);
  const w = mediaW * s;
  const h = mediaH * s;
  return { x: (boxW - w) / 2, y: anchorTop ? 0 : (boxH - h) / 2, w, h };
}

function readableOn(hex) {
  if (!isHex(hex)) return '#FFFFFF';
  const n = parseInt(hex.slice(1), 16);
  const lin = (c) => { const v = c / 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  const L = 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
  return L > 0.4 ? '#0B0B14' : '#FFFFFF';
}

const EMOJI_FAMILY = '"Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif';

/** Inline style for one overlay inside a picture rect. Shared by the editor and the player. */
export function overlayCss(o, rect) {
  const px = Math.max(8, o.size * rect.w);
  const base = {
    position: 'absolute',
    left: rect.x + o.x * rect.w,
    top: rect.y + o.y * rect.h,
    transform: `translate(-50%, -50%) rotate(${o.rotation || 0}deg)`,
    fontSize: px,
    lineHeight: 1.2,
    whiteSpace: 'pre',
    textAlign: 'center',
  };
  if (o.kind === 'sticker') return { ...base, fontFamily: EMOJI_FAMILY, lineHeight: 1 };
  const font = fontById(o.font);
  const solid = o.bg === 'solid';
  return {
    ...base,
    fontFamily: font.family,
    fontWeight: font.weight,
    // Wraps at 90% of the picture. Width and font both scale with the picture,
    // so a line breaks in the same place on a phone, a desktop frame and the cover.
    whiteSpace: 'pre-wrap',
    width: 'max-content',
    maxWidth: rect.w * 0.9,
    color: solid ? readableOn(o.color) : o.color,
    background: solid ? o.color : 'transparent',
    padding: solid ? '0.18em 0.45em' : 0,
    borderRadius: solid ? '0.35em' : 0,
    textShadow: solid ? 'none' : font.glow
      ? `0 0 0.2em ${o.color}, 0 0 0.55em ${o.color}`
      : '0 0.04em 0.2em rgba(0,0,0,0.7)',
  };
}

/** Evenly spaced frames for the trim and cover filmstrips. Resolves with whatever it managed. */
export function extractFrames(url, duration, count = 10, height = 112) {
  return new Promise((resolve) => {
    if (!url || !(duration > 0)) { resolve([]); return; }
    const out = [];
    let i = 0;
    let finished = false;
    const v = document.createElement('video');
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    const finish = () => {
      if (finished) return;
      finished = true;
      clearTimeout(bail);
      try { v.removeAttribute('src'); v.load(); } catch { /* gone */ }
      resolve(out);
    };
    const bail = setTimeout(finish, 15000);
    const next = () => {
      if (i >= count) { finish(); return; }
      try { v.currentTime = Math.max(0, Math.min(duration - 0.05, ((i + 0.5) * duration) / count)); } catch { finish(); }
    };
    v.muted = true;
    v.playsInline = true;
    v.preload = 'auto';
    v.onloadeddata = next;
    v.onerror = finish;
    v.onseeked = () => {
      try {
        const ratio = v.videoWidth && v.videoHeight ? v.videoWidth / v.videoHeight : 9 / 16;
        canvas.width = Math.max(1, Math.round(height * ratio));
        canvas.height = height;
        ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
        out.push(canvas.toDataURL('image/jpeg', 0.6));
      } catch { /* skip this frame */ }
      i += 1;
      next();
    };
    v.src = url;
  });
}

/**
 * A browser recording (MediaRecorder WebM) carries no duration, so a player reads
 * Infinity: no progress bar, no scrubbing, and trim handles with nothing to measure
 * against. This writes the one missing EBML element (Segment > Info > Duration)
 * from a length we already know, reading only the first 256 KB and never seeking.
 *
 * Deliberately narrow: it patches only the layout Chromium's recorder writes (an
 * unknown-size Segment whose Info comes before any SeekHead or Cluster), and hands
 * back the input untouched for anything else, because a wrong offset would corrupt
 * the video where a missing duration only hides a progress bar.
 */
export async function fixWebmDuration(blob, durationSec) {
  if (!blob || !/webm/i.test(blob.type || '') || !(durationSec > 0) || !Number.isFinite(durationSec)) return blob;
  try {
    const head = new Uint8Array(await blob.slice(0, 256 * 1024).arrayBuffer());
    let p = 0;
    const vint = (keepMarker) => {
      const b = head[p];
      if (b === undefined || b === 0) throw new Error('ebml');
      let len = 1;
      while (!(b & (0x80 >> (len - 1)))) len += 1;
      if (p + len > head.length) throw new Error('ebml');
      const low = b & (0xff >> len);
      let value = keepMarker ? b : low;
      let allOnes = low === (0xff >> len);
      for (let i = 1; i < len; i++) {
        value = value * 256 + head[p + i];
        if (head[p + i] !== 0xff) allOnes = false;
      }
      p += len;
      return { value, len, unknown: !keepMarker && allOnes };
    };

    if (vint(true).value !== 0x1A45DFA3) return blob;           // EBML header
    const headerSize = vint(false);
    if (headerSize.unknown) return blob;
    p += headerSize.value;
    if (vint(true).value !== 0x18538067) return blob;           // Segment
    if (!vint(false).unknown) return blob;                      // a known size would change too

    while (p < head.length) {
      const id = vint(true).value;
      const size = vint(false);
      const dataAt = p;
      if (id === 0x1549A966) {                                  // Info
        const end = dataAt + size.value;
        if (size.unknown || end > head.length) return blob;
        let scale = 1e6;
        while (p < end) {
          const cid = vint(true).value;
          const csize = vint(false);
          if (cid === 0x4489) return blob;                      // already has a Duration
          if (cid === 0x2AD7B1) {                               // TimecodeScale
            let s = 0;
            for (let i = 0; i < csize.value; i++) s = s * 256 + head[p + i];
            if (s > 0) scale = s;
          }
          p += csize.value;
        }
        const duration = new Uint8Array(11);
        duration.set([0x44, 0x89, 0x88]);
        new DataView(duration.buffer).setFloat64(3, (durationSec * 1e9) / scale);
        const sizeBytes = new Uint8Array(8);
        sizeBytes[0] = 0x01;
        let n = size.value + duration.length;
        for (let i = 7; i >= 1; i--) { sizeBytes[i] = n % 256; n = Math.floor(n / 256); }
        const parts = [head.subarray(0, dataAt - size.len), sizeBytes, head.subarray(dataAt, end), duration, blob.slice(end)];
        const out = blob instanceof File
          ? new File(parts, blob.name, { type: blob.type })
          : new Blob(parts, { type: blob.type });
        return out;
      }
      if (id === 0x114D9B74 || id === 0x1F43B675 || size.unknown) return blob; // SeekHead / Cluster first
      p = dataAt + size.value;
    }
    return blob;
  } catch {
    return blob;
  }
}

/** Break overlay text into lines the way the player wraps it (90% of the picture). */
function wrapLines(ctx, text, maxWidth) {
  const out = [];
  for (const para of String(text).split('\n')) {
    const words = para.split(' ');
    let line = '';
    for (const word of words) {
      const next = line ? `${line} ${word}` : word;
      if (line && ctx.measureText(next).width > maxWidth) { out.push(line); line = word; }
      else line = next;
    }
    out.push(line);
  }
  return out;
}

/**
 * Draw overlays onto a cover image (the JPEG from posterFromVideo), so the tile in
 * the feed shows the same text and stickers as the clip. Returns the input on any
 * failure: a cover without text must never be the reason a post fails.
 */
export async function composeCover(file, overlays) {
  const list = (overlays || []).map(cleanOverlay).filter(Boolean);
  if (!file || !list.length) return file;
  try {
    const src = URL.createObjectURL(file);
    const img = await new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = rej; im.src = src; });
    const W = img.naturalWidth;
    const H = img.naturalHeight;
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, W, H);
    URL.revokeObjectURL(src);

    for (const o of list) {
      const px = Math.max(8, o.size * W);
      const sticker = o.kind === 'sticker';
      const font = sticker ? null : fontById(o.font);
      const family = sticker ? EMOJI_FAMILY : font.family;
      const weight = sticker ? 400 : font.weight;
      const fontStr = `${weight} ${px}px ${family}`;
      try { await document.fonts?.load?.(fontStr); } catch { /* fall back to whatever is loaded */ }
      ctx.save();
      ctx.translate(o.x * W, o.y * H);
      ctx.rotate(((o.rotation || 0) * Math.PI) / 180);
      ctx.font = fontStr;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const lines = sticker ? o.text.split('\n') : wrapLines(ctx, o.text, W * 0.9);
      const lineH = px * (sticker ? 1 : 1.2);
      const top = -((lines.length - 1) * lineH) / 2;
      if (!sticker && o.bg === 'solid') {
        const width = Math.max(...lines.map((l) => ctx.measureText(l).width)) + px * 0.9;
        const height = lines.length * lineH + px * 0.36;
        const r = px * 0.35;
        ctx.fillStyle = o.color;
        ctx.beginPath();
        if (ctx.roundRect) ctx.roundRect(-width / 2, -height / 2, width, height, r);
        else ctx.rect(-width / 2, -height / 2, width, height);
        ctx.fill();
        ctx.fillStyle = readableOn(o.color);
      } else if (!sticker) {
        ctx.fillStyle = o.color;
        ctx.shadowColor = font.glow ? o.color : 'rgba(0,0,0,0.7)';
        ctx.shadowBlur = font.glow ? px * 0.5 : px * 0.2;
        ctx.shadowOffsetY = font.glow ? 0 : px * 0.04;
      }
      lines.forEach((line, idx) => ctx.fillText(line, 0, top + idx * lineH));
      ctx.restore();
    }

    const blob = await new Promise((res) => canvas.toBlob(res, 'image/jpeg', 0.85));
    return blob ? new File([blob], 'cover.jpg', { type: 'image/jpeg' }) : file;
  } catch {
    return file;
  }
}
