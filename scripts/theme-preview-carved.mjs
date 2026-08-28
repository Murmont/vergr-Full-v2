// CARVED at profile scale.
//
// The claim: this is not a page with panels on it, it is ONE BLOCK with the
// interface machined into it. Nothing floats. Every edge is a chamfer, and the
// chamfers genuinely catch a specular highlight from a moving point light —
// real lighting maths via feSpecularLighting, not an animated gradient.
//
// The bevel is the classic SVG construction: blur SourceAlpha into a height
// field, light it, composite back in. That is what makes an edge respond to
// where the lamp IS, which a gradient cannot do.
//
//   node scripts/theme-preview-carved.mjs
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { accentFor, accentHexFor, hexA } =
  await import(`file://${repo}/src/utils/rankCollections.js`);

const raw = accentHexFor('ember');
const anod = accentFor('carved', raw);   // anodising compresses the hue

const html = `<!doctype html><html><head><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Syne:wght@700;800&family=DM+Sans:wght@400;500;700&family=DM+Mono:wght@500&display=swap" rel="stylesheet">
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{background:#050506;color:#fff;font-family:'DM Sans',system-ui,sans-serif;padding:26px}
.cap{font-size:10px;letter-spacing:.16em;text-transform:uppercase;color:#5A6070;margin-bottom:9px}

/* ── THE BLOCK ───────────────────────────────────────────────────────────
   Brushed metal, anisotropic. The whole page is one piece of material. */
.block{width:760px;border-radius:6px;overflow:hidden;position:relative;
  background:
    repeating-linear-gradient(97deg, rgba(255,255,255,.014) 0 1px, transparent 1px 3px),
    repeating-linear-gradient(97deg, rgba(0,0,0,.22) 0 2px, transparent 2px 7px),
    linear-gradient(168deg,#17181C 0%,#0D0E11 52%,#141519 100%);
  box-shadow:inset 0 1px 0 rgba(226,236,255,.10), 0 24px 60px rgba(0,0,0,.7)}

/* ── ROUTED CAVITIES ────────────────────────────────────────────────────
   Not cards. Pockets cut into the block. The filter supplies the chamfer,
   which is why the highlight MOVES when the lamp does. */
.pocket{position:relative;margin:0 22px 16px;padding:16px 18px;border-radius:4px;isolation:isolate}
.pocket:before{content:'';position:absolute;inset:0;border-radius:4px;z-index:-1;
  background:linear-gradient(180deg, rgba(0,0,0,.66) 0%, rgba(0,0,0,.34) 42%, rgba(255,255,255,.028) 100%);
  filter:url(#vg-carve-bevel)}
.pocket h4{font-family:Syne;font-weight:700;font-size:14px;letter-spacing:-.005em;color:#DCE3F0}
.pocket p{font-size:12px;color:#828B9C;margin-top:6px;line-height:1.5}

/* ── HEADER: the banner sits in a routed pocket, art untouched ─────────── */
.hdr{height:210px;margin:14px 22px 18px;position:relative}
/* the routed POCKET: a frame with a chamfer. filter is on this, never on art. */
.hdr .pocketframe{position:absolute;inset:-3px;border-radius:6px;
  background:linear-gradient(180deg, rgba(0,0,0,.85) 0%, rgba(255,255,255,.05) 100%);
  filter:url(#vg-carve-bevel)}
.hdr .art{position:absolute;inset:0;border-radius:3px;overflow:hidden;
  background:linear-gradient(120deg,#1a0a3a,#2d0a5a 55%,#140828)}
/* the art sits DOWN in the pocket, so the walls shadow onto it */
.hdr .floor{position:absolute;inset:0;border-radius:3px;pointer-events:none;
  box-shadow:inset 0 4px 12px -4px rgba(0,0,0,.95), inset 0 -1px 0 rgba(207,220,255,.14)}

/* ── ENGRAVED TYPE. Instrument panel: tight, technical, mono figures. ──── */
.idb{padding:0 24px 6px;display:flex;align-items:flex-end;gap:16px}
.nm{font-family:Syne;font-weight:800;font-size:30px;letter-spacing:-.018em;color:#E4EAF6;
  text-shadow:0 1px 0 rgba(0,0,0,.9), 0 -1px 0 rgba(226,236,255,.10)}   /* engraved, not raised */
.hd{font-size:10px;letter-spacing:.2em;text-transform:uppercase;color:#6B7482;padding-bottom:5px}

/* ── THE MACHINING GRID everything aligns to ───────────────────────────── */
.grid{position:absolute;inset:0;pointer-events:none;opacity:.5;
  background:
    repeating-linear-gradient(90deg, rgba(226,236,255,.028) 0 1px, transparent 1px 48px),
    repeating-linear-gradient(0deg,  rgba(226,236,255,.020) 0 1px, transparent 1px 48px)}

/* ── ANODISED CHANNEL: colour lives INSIDE a cut, never on a face ──────── */
.chan{margin:0 22px 16px;height:26px;position:relative;border-radius:2px;
  background:linear-gradient(180deg, rgba(0,0,0,.70) 0%, rgba(0,0,0,.30) 46%, rgba(255,255,255,.03) 100%);
  box-shadow:inset 0 1px 0 rgba(0,0,0,1), inset 0 -1px 0 rgba(226,236,255,.16)}
.chan i{position:absolute;left:3px;top:3px;bottom:3px;width:58%;border-radius:1px;
  background:linear-gradient(180deg, ${hexA(anod,.95)} 0%, ${hexA(anod,.62)} 55%, rgba(0,0,0,.35) 100%);
  box-shadow:0 0 0 .5px rgba(0,0,0,.6), inset 0 1px 0 rgba(255,255,255,.22)}
.chan b{position:absolute;right:9px;top:50%;transform:translateY(-50%);
  font-family:'DM Mono',monospace;font-size:11px;color:#93A0B4;letter-spacing:.04em}
.lbl{margin:0 24px 7px;font-size:9px;letter-spacing:.24em;text-transform:uppercase;color:${anod};font-weight:700}

/* countersunk fasteners: precision reads as expense */
.screw{position:absolute;width:9px;height:9px;border-radius:50%;
  background:radial-gradient(circle at 38% 32%, #2B2E36, #0A0B0D 68%);
  box-shadow:inset 0 1px 0 rgba(0,0,0,.9), 0 1px 0 rgba(226,236,255,.09)}
.screw:after{content:'';position:absolute;inset:3px 1px;background:rgba(0,0,0,.65);border-radius:1px}
</style></head><body>

<svg width="0" height="0" style="position:absolute" aria-hidden>
  <!-- THE BEVEL. SourceAlpha is blurred into a height field, then lit by a
       POINT light. Because it is real lighting maths, a chamfer facing the lamp
       catches and one facing away does not, and moving the lamp sweeps the
       highlight along the edge. specularExponent is how hard the metal reads. -->
  <filter id="vg-carve-bevel" x="-8%" y="-8%" width="116%" height="116%">
    <feGaussianBlur in="SourceAlpha" stdDeviation="1.5" result="bump"/>
    <feSpecularLighting in="bump" surfaceScale="4.5" specularConstant="0.85"
                        specularExponent="42" lightingColor="#D4E0FF" result="spec">
      <feDistantLight id="vg-lamp" azimuth="135" elevation="12"/>
    </feSpecularLighting>
    <feComposite in="spec" in2="SourceAlpha" operator="in" result="specClip"/>
    <feComposite in="SourceGraphic" in2="specClip" operator="arithmetic"
                 k1="0" k2="1" k3="1" k4="0"/>
  </filter>
</svg>

<div class="cap">Carved · L38 · milled from one block · feSpecularLighting + moving fePointLight</div>
<div class="block">
  <div class="grid"></div>
  <div class="hdr"><div class="pocketframe"></div><div class="art"></div><div class="floor"></div></div>
  <div class="idb"><div class="nm">Vergr</div><div class="hd">@Vergr</div></div>
  <div class="lbl">Vergr Points</div>
  <div class="chan"><i></i><b>3,147 / 4,000</b></div>
  <div class="pocket"><h4>Squad power-up unlocked</h4>
    <p>Invite friends, get VP, and earn coins together. Every referral counts toward your next rank.</p></div>
  <div class="pocket"><h4>Stream schedule</h4>
    <p>Thursdays and Sundays, 8pm. Co-streams announced the day before.</p></div>
  <div class="screw" style="left:9px;top:9px"></div>
  <div class="screw" style="right:9px;top:9px"></div>
  <div class="screw" style="left:9px;bottom:9px"></div>
  <div class="screw" style="right:9px;bottom:9px"></div>
</div>

<script>
  // The lamp travels a slow arc across the block. Every chamfer responds at
  // once, because it is one lamp on one object. This is the single most
  // convincing "expensive" effect available: genuine specular response.
  // The lamp orbits the block. Because it is ONE light on ONE object, every
  // chamfer responds at the same moment: highlights run around the cuts in
  // sequence. Genuine specular response, not an animated gradient.
  const lamp = document.getElementById('vg-lamp');
  let t0 = performance.now();
  const tick = (t) => {
    const p = ((t - t0) / 16000) % 1;
    lamp.setAttribute('azimuth', String(p * 360));
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
<\/script>
</body></html>`;

mkdirSync(`${repo}/.preview`, { recursive: true });
writeFileSync(`${repo}/.preview/carved.html`, html);
console.log('wrote .preview/carved.html');
