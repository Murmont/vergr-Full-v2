// Renders all 11 entry ribbons at their REAL size (280x70) against the REAL art,
// reproducing JoinAnnouncer's geometry, so the art can be judged in situ rather
// than as full-size source renders. The ribbon is 280px wide: art that reads
// beautifully at 4128px can be mud at 280.
//   node scripts/entry-ribbon-preview.mjs
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { RANK_BANNERS, nameSizeFor } =
  await import(`file://${repo}/src/utils/rankBanners.js`);

const W = 280, H = 70, R = 14;
const avatarD = Math.round(H * 0.74), avatarCx = Math.round(W * 0.145);
const textLeft = Math.round(avatarCx + avatarD / 2 + W * 0.03);
const NAMES = ['ALEX', 'Verion', 'nova_kill', 'Sable'];

const card = (r, i) => {
  const name = NAMES[i % NAMES.length];
  // Node has no canvas, so nameSizeFor() here would return the conservative
  // fallback and the preview would understate every name. The real measured
  // size is applied by the inline script at the bottom of the page, which runs
  // in the browser exactly as the component does. This is only a first paint.
  const nameSize = nameSizeFor(name, W, H);
  const grad = r.nameMid
    ? `linear-gradient(180deg, ${r.nameTop} 0%, ${r.nameMid} 52%, ${r.nameBottom} 100%)`
    : `linear-gradient(180deg, ${r.nameTop} 0%, ${r.nameBottom} 100%)`;
  return `
  <div class="cell">
    <div class="lbl">${r.name} &middot; L${r.min}-${r.max}</div>
    <div class="wrap">
      <div class="halo" style="background:radial-gradient(60% 120% at ${Math.round((avatarCx/W)*100)}% 50%, ${r.ring}55, transparent 70%)"></div>
      <div class="plate">
        <img src="../public/brand/entry/${r.id}.webp" srcset="../public/brand/entry/${r.id}.webp 1x, ../public/brand/entry/${r.id}@2x.webp 2x">
        <div class="scrim"></div>
      </div>
      <div class="av" style="box-shadow:0 0 0 2px ${r.ring}, 0 0 ${Math.round(H*0.22)}px ${r.ring}AA"></div>
      <div class="txt">
        <div class="row">
          <span class="nm" style="font-size:${nameSize}px;background-image:${grad};filter:drop-shadow(0 1px 2px rgba(0,0,0,.85)) drop-shadow(0 0 ${Math.round(H*0.10)}px ${r.ring}66)">${name}</span>
          <span class="jn">joined</span>
        </div>
        <div class="l2">to watch the <span style="color:${r.ring}">LIVE</span></div>
      </div>
    </div>
  </div>`;
};

const html = `<!doctype html><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Syne:wght@700;800&display=swap" rel="stylesheet">
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{background:#0B0B14;font-family:system-ui;padding:22px;display:grid;grid-template-columns:repeat(2,1fr);gap:26px 34px;width:760px}
.lbl{font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:#6B7280;margin-bottom:8px}
.wrap{position:relative;width:${W}px;height:${H}px}
.halo{position:absolute;inset:-${Math.round(H*0.16)}px;border-radius:${R+Math.round(H*0.16)}px;filter:blur(${Math.round(H*0.10)}px)}
.plate{position:absolute;inset:0;border-radius:${R}px;overflow:hidden;box-shadow:0 6px 22px rgba(0,0,0,.45)}
.plate img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
.scrim{position:absolute;inset:0;background:linear-gradient(90deg,rgba(6,6,10,.92) 0%,rgba(6,6,10,.80) 30%,rgba(6,6,10,.55) 62%,rgba(6,6,10,.10) 100%)}
.av{position:absolute;left:${avatarCx-avatarD/2}px;top:${(H-avatarD)/2}px;width:${avatarD}px;height:${avatarD}px;border-radius:50%;background:linear-gradient(135deg,#2a1b4a,#101a30)}
.txt{position:absolute;left:${textLeft}px;right:${Math.round(W*0.04)}px;top:50%;transform:translateY(-50%);display:flex;flex-direction:column;gap:${Math.round(H*0.07)}px;min-width:0}
.row{display:flex;align-items:baseline;gap:${Math.round(W*0.02)}px;min-width:0}
.nm{font-family:Syne;font-weight:800;font-style:italic;line-height:1;letter-spacing:-.01em;text-transform:uppercase;-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;flex:0 1 auto;min-width:0}
.jn{font-family:Syne;font-weight:700;font-style:italic;font-size:${Math.round(H*0.18)}px;line-height:1;color:#fff;text-shadow:0 1px 3px rgba(0,0,0,.9);white-space:nowrap;flex:0 0 auto}
.l2{font-family:Syne;font-weight:700;font-style:italic;font-size:${Math.round(H*0.15)}px;line-height:1;color:#fff;white-space:nowrap;text-shadow:0 1px 3px rgba(0,0,0,.9)}
</style>
${RANK_BANNERS.map(card).join('')}
<script>
// Re-measure every name in the BROWSER, the same way JoinAnnouncer does.
// The generator runs in node where canvas does not exist, so the size baked
// into the markup is only the conservative fallback.
document.fonts.load("italic 800 20px Syne").then(() => document.fonts.ready).then(() => {
  const ctx = document.createElement("canvas").getContext("2d");
  ctx.font = "italic 800 100px Syne, sans-serif";
  const avail = 280 * (148/280) * 0.94;
  document.querySelectorAll(".nm").forEach((el) => {
    const per = ctx.measureText(el.textContent.toUpperCase()).width / 100;
    el.style.fontSize = Math.floor(Math.min(70*0.34, Math.max(70*0.16, avail/per))) + "px";
  });
  document.title = "measured";
});
</script>`;

mkdirSync(`${repo}/.preview`, { recursive: true });
writeFileSync(`${repo}/.preview/ribbons.html`, html);
console.log('wrote .preview/ribbons.html —', RANK_BANNERS.length, 'ranks');
