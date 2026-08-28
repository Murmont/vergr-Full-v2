// Renders the PROFILE scale for a collection: the tier where the real
// technique lives, because it draws once instead of hundreds of times.
//
// Grain's claim is that it is printed, not lit: feTurbulence becomes a HEIGHT
// MAP and feDiffuseLighting shades it, so the tooth is real relief rather than
// grey speckle laid on top. This page renders that against Deep so the two can
// be compared as materials rather than as palettes.
//
//   node scripts/theme-preview-full.mjs
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { accentFor, accentHexFor, inkOn, GRAIN_PAPER, hexA } =
  await import(`file://${repo}/src/utils/rankCollections.js`);

const ACCENT = 'ember';
const raw = accentHexFor(ACCENT);
const grainInk = inkOn(accentFor('grain', raw), GRAIN_PAPER);

const html = `<!doctype html><html><head><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Syne:wght@700;800&family=DM+Sans:wght@400;500;700&display=swap" rel="stylesheet">
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{background:#050508;color:#fff;font-family:'DM Sans',system-ui,sans-serif;padding:26px;display:flex;gap:24px}
.pane{width:640px;flex:none}
.cap{font-size:10px;letter-spacing:.16em;text-transform:uppercase;color:#5A6070;margin-bottom:9px}
.frame{border-radius:14px;overflow:hidden;position:relative}

/* ─────────── DEEP: layered light. The cheapest technique on the ladder. ─────────── */
.deep{background:#000;min-height:620px;position:relative}
.deep .hdr{height:250px;position:relative;overflow:hidden;
  background:
    radial-gradient(120% 90% at 50% -30%, rgba(150,180,255,0.20), transparent 62%),
    radial-gradient(46% 70% at 14% 4%, ${hexA(raw,0.13)}, transparent 60%),
    linear-gradient(180deg, transparent 62%, #000 100%), #000}
.deep .art{position:absolute;inset:0;background:linear-gradient(120deg,#1a0a3a,#2d0a5a 55%,#140828);opacity:.75}
.deep .seamline{position:absolute;left:0;right:0;bottom:0;height:1px;
  background:linear-gradient(90deg,transparent,${hexA(raw,0.5)} 22%,${hexA(raw,0.5)} 78%,transparent)}
.deep .scrim{position:absolute;left:0;right:0;bottom:0;height:96px;
  background:linear-gradient(180deg,transparent,#000 96%)}
.deep .body{padding:0 22px 26px}
.deep .nm{font-family:Syne;font-weight:800;font-size:26px;margin-top:-30px;position:relative;z-index:3}
.deep .hd{font-size:12.5px;color:#8A93A6;margin-top:2px}
.deep .card{margin-top:16px;border-radius:14px;padding:15px;position:relative;
  background:linear-gradient(180deg,rgba(255,255,255,0.045),rgba(255,255,255,0.012))}
.deep .card:before{content:'';position:absolute;inset:0;border-radius:inherit;padding:1px;pointer-events:none;
  background:linear-gradient(180deg,rgba(190,210,255,0.24) 0%,transparent 60%);
  -webkit-mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0);-webkit-mask-composite:xor;mask-composite:exclude}
.deep h4{font-size:13px;font-weight:700}
.deep p{font-size:12.5px;color:#9AA3B4;margin-top:6px;line-height:1.5}

/* ─────────── GRAIN: printed. NO emissive light anywhere on this pane. ─────────── */
.grain{background:#0A0908;min-height:620px;position:relative;isolation:isolate}
/* page-wide tooth: ONE filtered layer behind everything, drawn once. */
.grain:before{content:'';position:absolute;inset:0;z-index:0;pointer-events:none;
  background:#8A7C63;filter:url(#vg-grain-paper);opacity:.13;mix-blend-mode:overlay}
.grain>*{position:relative;z-index:1}
.grain .hdr{height:250px;position:relative;overflow:hidden}
/* the stock. one filter, rendered once. */
.grain .stock{position:absolute;inset:0;background:#B9A98A;filter:url(#vg-grain-paper)}
/* the user's banner, printed ONTO the stock: relief multiplies over it, colours untouched */
.grain .art{position:absolute;inset:0;background:linear-gradient(120deg,#1a0a3a,#2d0a5a 55%,#140828);
  opacity:.82;mix-blend-mode:multiply}
.grain .tooth{position:absolute;inset:0;filter:url(#vg-grain-paper);opacity:.5;mix-blend-mode:overlay;background:#B9A98A}
/* deckle: the sheet tears, it does not get cut */
.grain .deckle{position:absolute;left:0;right:0;bottom:0;height:26px;background:#0C0B0A;
  -webkit-mask-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='1200' height='26' preserveAspectRatio='none'%3E%3Cpath d='M0,26 L0,9 C40,4 70,15 110,10 C150,5 180,16 220,11 C265,6 295,17 340,12 C385,7 415,18 460,13 C505,8 535,19 580,14 C625,9 655,20 700,15 C745,10 775,21 820,16 C865,11 895,22 940,17 C985,12 1015,23 1060,18 C1105,13 1140,20 1200,14 L1200,26 Z' fill='%23000'/%3E%3C/svg%3E");
  -webkit-mask-size:100% 100%;mask-size:100% 100%}
.grain .body{padding:0 24px 26px;position:relative}
/* type is this theme's loudest voice: editorial, tight, a real baseline */
.grain .nm{font-family:Syne;font-weight:800;font-size:42px;letter-spacing:-.022em;line-height:.94;
  color:#E9DDC6;margin-top:-22px;position:relative;z-index:3}
.grain .hd{font-size:11px;letter-spacing:.2em;text-transform:uppercase;color:rgba(233,221,198,.42);margin-top:9px}
/* panels are PRESSED IN. no rim light: this theme has none. */
.grain .card{margin-top:18px;border-radius:2px;padding:16px;
  background:rgba(233,221,198,.030);
  box-shadow:inset 0 1px 0 rgba(0,0,0,.62), inset 0 -1px 0 rgba(255,235,200,.07)}
.grain h4{font-family:Syne;font-weight:700;font-size:15px;letter-spacing:-.01em;color:#E9DDC6}
.grain p{font-size:12.5px;color:rgba(233,221,198,.58);margin-top:7px;line-height:1.55}
.grain .rule{height:1px;margin:16px 0 0;
  background:linear-gradient(90deg,transparent,rgba(233,221,198,.20) 16%,rgba(233,221,198,.20) 80%,transparent)}
/* the ink rule + a printed VP band: matte, no glow */
.grain .band{margin-top:14px;height:13px;position:relative;border-radius:0;
  background:rgba(233,221,198,.055);
  box-shadow:inset 0 1px 2px rgba(0,0,0,.75), inset 0 -1px 0 rgba(255,235,200,.05)}
.grain .band i{position:absolute;inset:2px 38% 2px 2px;
  background:linear-gradient(180deg, ${grainInk} 0%, ${grainInk} 62%, rgba(0,0,0,.28) 100%);
  box-shadow:0 0 0 .5px rgba(0,0,0,.35)}
/* the tick marks a printed scale has */
.grain .band:after{content:'';position:absolute;inset:2px 2px 2px 2px;pointer-events:none;
  background:repeating-linear-gradient(90deg, transparent 0 23px, rgba(0,0,0,.22) 23px 24px)}
.grain .figs{display:flex;align-items:baseline;gap:8px;margin-top:9px;
  font-family:Syne;font-weight:800;font-size:20px;color:#E9DDC6;letter-spacing:-.01em}
.grain .figs em{font-style:normal;font-size:11px;letter-spacing:.14em;text-transform:uppercase;
  color:rgba(233,221,198,.40);font-family:'DM Sans'}
.grain .lbl{font-size:9.5px;letter-spacing:.22em;text-transform:uppercase;color:${grainInk};font-weight:700;margin-top:14px}
.grain .big{font-family:Syne;font-weight:800;font-size:64px;line-height:.8;color:rgba(233,221,198,.09);
  position:absolute;right:22px;bottom:16px;letter-spacing:-.03em}
</style></head><body>

<svg width="0" height="0" style="position:absolute" aria-hidden>
  <filter id="vg-grain-paper" x="0" y="0" width="100%" height="100%">
    <!-- the noise becomes a HEIGHT MAP -->
    <feTurbulence type="fractalNoise" baseFrequency="0.52" numOctaves="5" seed="3" result="tex"/>
    <!-- ...and the lighting pass SHADES it. this is what makes it read as fibre
         you could feel rather than grey speckle laid on top, and it is the
         entire technique claim for this collection. -->
    <feDiffuseLighting in="tex" surfaceScale="2.2" diffuseConstant="1.02" lightingColor="#F3E7D2" result="lit">
      <feDistantLight azimuth="135" elevation="55"/>
    </feDiffuseLighting>
    <feComposite in="lit" in2="SourceGraphic" operator="arithmetic" k1="1.05" k2="0" k3="0" k4="-0.05"/>
  </filter>
</svg>

<div class="pane">
  <div class="cap">Deep · L6 · layered light</div>
  <div class="frame deep">
    <div class="hdr"><div class="art"></div><div class="scrim"></div><div class="seamline"></div></div>
    <div class="body">
      <div class="nm">Vergr</div><div class="hd">@Vergr</div>
      <div class="card"><h4>Squad power-up unlocked</h4>
        <p>Invite friends, get VP, and earn coins together. Every referral counts toward your next rank.</p></div>
      <div class="card"><h4>Stream schedule</h4>
        <p>Thursdays and Sundays, 8pm. Co-streams announced the day before.</p></div>
    </div>
  </div>
</div>

<div class="pane">
  <div class="cap">Grain · L16 · printed, zero emissive light</div>
  <div class="frame grain">
    <div class="hdr">
      <div class="stock"></div>
      <div class="art"></div>
      <div class="tooth"></div>
      <div class="deckle"></div>
    </div>
    <div class="body">
      <div class="nm">Vergr</div><div class="hd">@Vergr</div>
      <div class="lbl">Vergr Points</div>
      <div class="band"><i></i></div>
      <div class="figs">3,147 <em>of 4,000 to level 17</em></div>
      <div class="rule"></div>
      <div class="card"><h4>Squad power-up unlocked</h4>
        <p>Invite friends, get VP, and earn coins together. Every referral counts toward your next rank.</p></div>
      <div class="card"><h4>Stream schedule</h4>
        <p>Thursdays and Sundays, 8pm. Co-streams announced the day before.</p></div>
      <div class="big">16</div>
    </div>
  </div>
</div>

</body></html>`;

mkdirSync(`${repo}/.preview`, { recursive: true });
writeFileSync(`${repo}/.preview/full.html`, html);
console.log('wrote .preview/full.html');
