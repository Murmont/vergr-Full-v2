// shareCard — client-side branded share images (zero server cost, real fonts).
//
// Two layouts:
//   'wide'  1200x630  — link-preview / feed ratio, used by share sheets.
//   'story' 1080x1920 — 9:16, used for "Share to my Status" after a stream.
//
// Draws an optional background image (stream thumbnail / cover) with a graceful
// fallback to the brand gradient if it is missing OR taints the canvas
// (cross-origin without CORS). Text is drawn with the app's own fonts (Syne /
// DM Sans), which are already loaded in the page, so it always renders.
//
// Reuses the proven MatchCardShare canvas approach. Never throws: on any
// failure it still returns a branded (image-less) card.

const V = {
  bg: '#0B0B14', violet: '#7B1FFF', violetLight: '#B44FFF', pink: '#C87FFF',
  white: '#FFFFFF', dim: 'rgba(255,255,255,0.72)', ember: '#F04060',
};

function loadImg(url) {
  return new Promise((resolve) => {
    if (!url) return resolve(null);
    const img = new Image();
    img.crossOrigin = 'anonymous';
    const to = setTimeout(() => resolve(null), 6000);
    img.onload = () => { clearTimeout(to); resolve(img); };
    img.onerror = () => { clearTimeout(to); resolve(null); };
    img.src = url;
  });
}

function drawCover(ctx, img, x, y, w, h) {
  const ir = img.width / img.height;
  const r = w / h;
  let sx = 0, sy = 0, sw = img.width, sh = img.height;
  if (ir > r) { sw = img.height * r; sx = (img.width - sw) / 2; }
  else { sh = img.width / r; sy = (img.height - sh) / 2; }
  ctx.drawImage(img, sx, sy, sw, sh, x, y, w, h);
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// Word-wrap helper for a centered/left title.
function wrapText(ctx, text, maxWidth, maxLines) {
  const words = String(text || '').split(/\s+/).filter(Boolean);
  const lines = [];
  let line = '';
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line); line = w;
      if (lines.length === maxLines - 1) break;
    } else line = test;
  }
  if (line && lines.length < maxLines) lines.push(line);
  if (lines.length === maxLines && words.length) {
    // ellipsize last line if we ran out of room
    let last = lines[maxLines - 1];
    while (ctx.measureText(last + '…').width > maxWidth && last.length) last = last.slice(0, -1);
    lines[maxLines - 1] = last + '…';
  }
  return lines;
}

/**
 * @param {Object} o
 * @param {'wide'|'story'} o.layout
 * @param {string} [o.bgImageUrl]   background photo (thumbnail/cover)
 * @param {string} [o.avatarUrl]    creator avatar (story layout)
 * @param {string} o.headline       big line (creator name / stream title)
 * @param {string} [o.subline]      secondary line (game / "was LIVE on VERGR")
 * @param {boolean} [o.live]        show a LIVE badge
 * @param {Array<{label:string,value:string}>} [o.stats]  story stat pills
 * @returns {Promise<Blob>} PNG blob
 */
export async function renderShareCard(o) {
  const layout = o.layout === 'story' ? 'story' : 'wide';
  const W = layout === 'story' ? 1080 : 1200;
  const H = layout === 'story' ? 1920 : 630;

  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');

  try { await (document.fonts?.ready || Promise.resolve()); } catch {}

  // ── Background ──
  const bg = await loadImg(o.bgImageUrl);
  let tainted = false;
  if (bg) {
    try { drawCover(ctx, bg, 0, 0, W, H); } catch { tainted = true; }
  }
  if (!bg || tainted) {
    const g = ctx.createLinearGradient(0, 0, W, H);
    g.addColorStop(0, '#1B1030'); g.addColorStop(0.55, '#160C28'); g.addColorStop(1, V.bg);
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    // soft brand glow
    const rg = ctx.createRadialGradient(W * 0.5, H * 0.28, 40, W * 0.5, H * 0.28, W * 0.7);
    rg.addColorStop(0, 'rgba(157,78,255,0.35)'); rg.addColorStop(1, 'transparent');
    ctx.fillStyle = rg; ctx.fillRect(0, 0, W, H);
  } else {
    // darken photo for legibility
    ctx.fillStyle = 'rgba(11,11,20,0.28)'; ctx.fillRect(0, 0, W, H);
  }

  // bottom scrim for text
  const scrim = ctx.createLinearGradient(0, H * (layout === 'story' ? 0.45 : 0.35), 0, H);
  scrim.addColorStop(0, 'rgba(11,11,20,0)'); scrim.addColorStop(1, 'rgba(11,11,20,0.92)');
  ctx.fillStyle = scrim; ctx.fillRect(0, 0, W, H);

  const pad = layout === 'story' ? 80 : 56;

  // ── VERGR wordmark ──
  ctx.textAlign = 'left';
  ctx.fillStyle = V.violetLight;
  ctx.font = `800 ${layout === 'story' ? 44 : 34}px Syne, sans-serif`;
  ctx.fillText('VERGR', pad, layout === 'story' ? 110 : 70);

  // ── LIVE badge ──
  if (o.live) {
    const bw = layout === 'story' ? 150 : 118, bh = layout === 'story' ? 52 : 42;
    const bx = W - pad - bw, by = layout === 'story' ? 74 : 40;
    ctx.fillStyle = V.ember; roundRect(ctx, bx, by, bw, bh, bh / 2); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.beginPath();
    ctx.arc(bx + bh * 0.42, by + bh / 2, bh * 0.16, 0, Math.PI * 2); ctx.fill();
    ctx.font = `800 ${layout === 'story' ? 24 : 19}px Syne, sans-serif`;
    ctx.textAlign = 'left'; ctx.fillText('LIVE', bx + bh * 0.72, by + bh * 0.66);
  }

  if (layout === 'story') {
    // avatar
    const av = await loadImg(o.avatarUrl);
    const cx = W / 2, cy = 720, rad = 130;
    ctx.save();
    ctx.beginPath(); ctx.arc(cx, cy, rad + 6, 0, Math.PI * 2);
    ctx.strokeStyle = V.violetLight; ctx.lineWidth = 8; ctx.stroke();
    if (av) {
      try {
        ctx.beginPath(); ctx.arc(cx, cy, rad, 0, Math.PI * 2); ctx.clip();
        drawCover(ctx, av, cx - rad, cy - rad, rad * 2, rad * 2);
      } catch {}
    } else {
      ctx.beginPath(); ctx.arc(cx, cy, rad, 0, Math.PI * 2);
      ctx.fillStyle = V.violet; ctx.fill();
    }
    ctx.restore();

    ctx.textAlign = 'center';
    ctx.fillStyle = V.white;
    ctx.font = '800 72px Syne, sans-serif';
    ctx.fillText(String(o.headline || '').slice(0, 22), cx, 960);
    ctx.fillStyle = V.dim;
    ctx.font = '600 36px "DM Sans", sans-serif';
    ctx.fillText(o.subline || 'was LIVE on VERGR', cx, 1015);

    // stat pills
    const stats = (o.stats || []).slice(0, 3);
    if (stats.length) {
      const gap = 28; const pw = (W - pad * 2 - gap * (stats.length - 1)) / stats.length;
      const py = 1120, ph = 150;
      stats.forEach((s, i) => {
        const px = pad + i * (pw + gap);
        ctx.fillStyle = 'rgba(255,255,255,0.06)';
        roundRect(ctx, px, py, pw, ph, 24); ctx.fill();
        ctx.strokeStyle = 'rgba(180,79,255,0.35)'; ctx.lineWidth = 2;
        roundRect(ctx, px, py, pw, ph, 24); ctx.stroke();
        ctx.textAlign = 'center';
        ctx.fillStyle = V.white; ctx.font = '800 52px Syne, sans-serif';
        ctx.fillText(String(s.value).slice(0, 8), px + pw / 2, py + 78);
        ctx.fillStyle = V.dim; ctx.font = '600 24px "DM Sans", sans-serif';
        ctx.fillText(String(s.label).toUpperCase(), px + pw / 2, py + 118);
      });
    }

    ctx.textAlign = 'center';
    ctx.fillStyle = V.violetLight; ctx.font = '700 40px Syne, sans-serif';
    ctx.fillText('Join me on vergr.app', W / 2, H - 130);
  } else {
    // wide layout: headline + subline bottom-left, play glyph if VOD/clip
    ctx.textAlign = 'left';
    ctx.font = '800 64px Syne, sans-serif'; ctx.fillStyle = V.white;
    const lines = wrapText(ctx, o.headline, W - pad * 2, 2);
    let ty = H - pad - (o.subline ? 70 : 10) - (lines.length - 1) * 68;
    for (const ln of lines) { ctx.fillText(ln, pad, ty); ty += 68; }
    if (o.subline) {
      ctx.fillStyle = V.dim; ctx.font = '600 34px "DM Sans", sans-serif';
      ctx.fillText(String(o.subline).slice(0, 60), pad, H - pad);
    }
    if (!o.live) {
      const cx = W - pad - 70, cy = H / 2;
      ctx.fillStyle = 'rgba(255,255,255,0.9)'; ctx.beginPath();
      ctx.arc(cx, cy, 56, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = V.violet; ctx.beginPath();
      ctx.moveTo(cx - 18, cy - 26); ctx.lineTo(cx - 18, cy + 26); ctx.lineTo(cx + 30, cy); ctx.closePath(); ctx.fill();
    }
  }

  return await new Promise((res) => canvas.toBlob((b) => res(b), 'image/png', 0.92));
}

// "I'm on Vergr now" migration announcement (14_GROWTH_MIGRATION §4.5):
// a one-call card auto-filled from the user's channel art, shared as a FILE
// with the profile ref link in the caption so every signup credits the
// creator. layout 'wide' for feeds/Discord, 'story' for IG/WhatsApp status.
export async function shareImOnVergrCard({ profile, uid, layout = 'wide' }) {
  const blob = await renderShareCard({
    layout,
    bgImageUrl: profile?.banner || null,
    avatarUrl: profile?.avatar || profile?.photoURL || null,
    headline: profile?.displayName || profile?.username || 'I',
    subline: "I'm on VERGR now — come through",
  });
  const link = `https://vergr.app/user/${uid}?ref=${uid}`;
  const text = `I'm on Vergr now — follow me here: ${link}`;
  try {
    if (blob && navigator.canShare?.({ files: [new File([blob], 'vergr.png', { type: 'image/png' })] })) {
      await navigator.share({
        text,
        files: [new File([blob], 'im-on-vergr.png', { type: 'image/png' })],
      });
      return true;
    }
    if (navigator.share) { await navigator.share({ text }); return true; }
    await navigator.clipboard.writeText(text);
    return 'copied';
  } catch {
    return false; // user dismissed the sheet
  }
}
