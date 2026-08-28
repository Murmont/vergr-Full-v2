// Phase B harness for the living crest. Effect 21, doc §8.
//
// ⚠ THIS SERVES THE REAL surface.css AND THE REAL BADGE ART. Only the markup is
// mirrored from RankBadge.jsx, and `vp-mirror-check.mjs` asserts that this
// file's class list matches what that component emits, so the mirror cannot
// drift the way profileThemes/rankCollections did.
//
//   node scripts/crest-preview.mjs            # serve on :4620
//   node scripts/crest-preview.mjs --measure  # headless Chrome, assert, exit
//
// ⚠ THE POINT IS THE DUTY CYCLE. `comet` in effect 06 shipped as a solid bar
// through a whole round of numeric assertions because every number it checked
// was satisfied by a uniform shape. So this samples the sheen's ACTUAL
// transform across a full cycle and counts how much of it is on screen, rather
// than trusting that the keyframes say what the comment says.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT || 4620);
const measure = process.argv.includes('--measure');

const { ANIMATED_CREST_LEVEL, CREST_CYCLE_MS, CREST_SWEEP_MS, crestPhaseMs, RANK_UNLOCKS } =
  await import(`file://${ROOT}/src/utils/rankUnlocks.js`);
const { getCurrentBadge, smallBadgeArt } = await import(`file://${ROOT}/src/utils/badgeSystem.js`);
const { getRankBanner } = await import(`file://${ROOT}/src/utils/rankBanners.js`);
const { RANK_TIERS } = await import(`file://${ROOT}/src/utils/vpSystem.js`);

// Six speakers: two below the unlock, four above, so the boundary is on screen.
const CAST = [
  { uid: 'u-rookie', name: 'nova_kill', level: 24 },
  { uid: 'u-edge61', name: 'Sable',     level: ANIMATED_CREST_LEVEL - 1 },
  { uid: 'u-edge62', name: 'ALEX',      level: ANIMATED_CREST_LEVEL },
  { uid: 'u-vet',    name: 'DrLupo',    level: 67 },
  { uid: 'u-legend', name: 'Vergr',     level: 74 },
  { uid: 'u-imm',    name: 'xQcOW',     level: 100 },
];

const crestHtml = (c, size = 13) => {
  const badge = getCurrentBadge(c.level);
  const rank = getRankBanner(c.level);
  const art = smallBadgeArt(badge.art);
  const living = c.level >= ANIMATED_CREST_LEVEL;
  const img = `<img src="${art}" width="${size}" height="${size}" alt=""
      style="width:${size}px;height:${size}px;object-fit:contain;
             filter:drop-shadow(0 0 ${Math.round(size * 0.3)}px ${rank.ring}66)">`;
  if (!living) return `<span class="crestwrap" data-uid="${c.uid}">${img}</span>`;
  return `<span class="vg-crest vg-crest-live crestwrap" data-uid="${c.uid}" data-living="1"
    style="--vg-crest-ring:${rank.ring}88;
           --vg-crest-cycle:${CREST_CYCLE_MS}ms;--vg-crest-phase:${crestPhaseMs(c.uid)}ms">
    ${img}<span class="vg-crest-sheen" aria-hidden="true"
      style="-webkit-mask-image:url(${art});mask-image:url(${art})"></span></span>`;
};

// The non-chat surfaces. ⚠ NO SHEEN, EVER — `animated` is opt-in and only
// ChatPanel passes it. This mirrors RankBadge: same small art, same silence
// below MIN_BADGE_LEVEL, no `.vg-crest` wrapper and so no motion.
const staticCrest = (c, size) => {
  if (c.level < 11) return '';
  const rank = getRankBanner(c.level);
  const art = smallBadgeArt(getCurrentBadge(c.level).art);
  return `<span class="crestwrap" data-uid="${c.uid}" style="display:inline-flex;cursor:pointer">
    <img src="${art}" width="${size}" height="${size}" alt="" style="width:${size}px;height:${size}px;
      object-fit:contain;filter:drop-shadow(0 0 ${Math.round(size * 0.3)}px ${rank.ring}66)"></span>`;
};

const FEED_LINES = {
  'u-edge61': 'ranked grind tonight, come watch',
  'u-edge62': 'finally hit the level for the crest',
  'u-vet': 'that comeback was filthy',
  'u-legend': 'new PB, 14 seconds off',
};
const COMMENT_LINES = { 'u-vet': 'this is the cleanest run I have seen', 'u-legend': 'absolute movement' };
const SQUAD_LINES = { 'u-edge61': 'queue in 5', 'u-edge62': 'omw', 'u-vet': 'invite sent' };

// ⚠ CREST AFTER THE NAME, mirroring ChatPanel since 2026-08-27. If this harness
// kept the old left-hand order it would be showing a layout the app no longer
// renders, which is the exact drift the mirror-check exists to stop.
const rows = (overlay) => CAST.map((c) => `
  <div class="row ${overlay ? 'ov' : ''}">
    <b style="color:${getRankBanner(c.level).ring}">${c.name}</b>${crestHtml(c)}
    <span class="t">L${c.level} ${c.level >= ANIMATED_CREST_LEVEL ? 'living' : 'static'}</span>
  </div>`).join('');

// The ladder facts the card shows, resolved here so the page needs no bundler.
// Same source the real RankCrestPopover reads: RANK_UNLOCKS, keyed on level.
const cardData = {};
for (const c of CAST) {
  const tier = RANK_TIERS.find((t) => c.level >= t.min && c.level <= t.max) || RANK_TIERS[0];
  // Mirrors RankCrestPopover.nextUnlock: skip the per-level VP-rate rows and
  // point at the next REAL unlock, or the card is inert on ~70 of 100 levels.
  const isMilestone = (r) => r.kind !== 'vprate' && !String(r.id).startsWith('vprate_');
  const later = RANK_UNLOCKS.filter((r) => r.level > c.level).sort((a, b) => a.level - b.level);
  const target = later.find(isMilestone) || later[0];
  const nl = target ? target.level : null;
  cardData[c.uid] = {
    rank: tier.name,
    band: tier.min + '-' + tier.max,
    level: c.level,
    ring: getRankBanner(c.level).ring,
    art: smallBadgeArt(getCurrentBadge(c.level).art),
    at: RANK_UNLOCKS.filter((r) => r.level === c.level).map((r) => r.name).slice(0, 3),
    next: nl ? { level: nl, rows: later.filter((r) => r.level === nl)
      .sort((x, y) => Number(isMilestone(y)) - Number(isMilestone(x)))
      .map((r) => r.name).slice(0, 2) } : null,
  };
}

const PAGE = `<!doctype html><html><head><meta charset="utf-8">
<title>Living crest harness</title>
<link rel="stylesheet" href="/surface.css">
<style>
  :root { color-scheme: dark; }
  body { margin:0; background:#0B0B14; color:#fff; font:13px/1.5 system-ui,sans-serif; }
  h1 { font-size:13px; color:#9CA3AF; padding:12px 16px; margin:0; }
  .cols { display:flex; gap:20px; padding:0 16px 24px; flex-wrap:wrap; align-items:flex-start; }
  .panel { width:330px; border-radius:12px; padding:10px 12px; }
  .side { background:#14141F; }
  .panel h2 { font-size:10px; color:#6B7280; margin:0 0 10px; font-weight:700; letter-spacing:.05em; text-transform:uppercase; }
  .ovbg { background:linear-gradient(135deg,#2b1a4d,#123),url('') ; }
  .row { display:flex; align-items:center; gap:5px; margin-bottom:9px; font-size:11.5px; }
  .row.ov { background:rgba(0,0,0,0.38); border-radius:6px; padding:3px 5px; }
  .t { color:#6B7280; font-size:10px; margin-left:auto; }
  .big { padding:16px; }
  pre { background:#14141F; padding:12px; border-radius:10px; font-size:11px;
        max-width:560px; margin:0 16px; white-space:pre-wrap; }
</style></head><body>
<h1>Rank crest — every placement, at the real size each surface uses.<br>
<span style="color:#6B7280">The crest shows from level 11 on every surface. The level-62 sweep runs in LIVE CHAT ONLY — everywhere else is deliberately static, so a follower list is not 20 moving objects. Click any crest for the ladder card.</span></h1>
<div class="cols">
  <div class="panel side">
    <h2>Live stream chat &mdash; 13px, ANIMATED</h2>${rows(false)}</div>
  <div class="panel ovbg">
    <h2>Chat overlay on video &mdash; 13px, ANIMATED</h2>${rows(true)}</div>
  <div class="panel side big">
    <h2>Blow-up &mdash; 64px</h2>${CAST.filter((c) => c.level >= ANIMATED_CREST_LEVEL)
      .map((c) => '<div class="row">' + crestHtml(c, 64) + '<b>' + c.name + '</b></div>').join('')}</div>
</div>

<div class="cols">
  <div class="panel side" style="width:400px">
    <h2>Feed post card &mdash; 13px, static</h2>
    ${CAST.slice(1, 5).map((c) => `
      <div style="display:flex;gap:9px;padding:9px 0;align-items:flex-start">
        <div style="width:32px;height:32px;border-radius:50%;background:#23233a;flex:0 0 auto"></div>
        <div style="min-width:0">
          <div style="display:flex;align-items:center;gap:4px;font-size:13px">
            <b style="color:${getRankBanner(c.level).ring}">${c.name}</b>${staticCrest(c, 13)}
            <span style="color:#6B7280;font-size:12px">@${c.name.toLowerCase()} &middot; 2h</span>
          </div>
          <div style="color:#D7D7E0;font-size:13px;margin-top:3px">${FEED_LINES[c.uid] || 'nice.'}</div>
        </div>
      </div>`).join('')}
    <h2 style="margin-top:16px">Comment row &mdash; 13px, static</h2>
    ${CAST.slice(2, 4).map((c) => `
      <div style="display:flex;gap:8px;padding:6px 0;align-items:flex-start">
        <div style="width:26px;height:26px;border-radius:50%;background:#23233a;flex:0 0 auto"></div>
        <div><div style="display:flex;align-items:center;gap:4px;font-size:12.5px">
          <b style="color:${getRankBanner(c.level).ring}">${c.name}</b>${staticCrest(c, 13)}</div>
          <div style="color:#D7D7E0;font-size:12.5px">${COMMENT_LINES[c.uid] || 'agreed'}</div></div>
      </div>`).join('')}
  </div>

  <div class="panel side" style="width:330px">
    <h2>Profile header &mdash; 18px, static</h2>
    <div style="display:flex;gap:12px;align-items:center;padding:6px 0 14px">
      <div style="width:56px;height:56px;border-radius:50%;background:#23233a"></div>
      <div><div style="display:flex;align-items:center;gap:5px">
        <span style="font-size:22px;font-weight:800">${CAST[3].name}</span>${staticCrest(CAST[3], 18)}</div>
        <div style="color:#6B7280;font-size:12px">@${CAST[3].name.toLowerCase()} &middot; 1.2k followers</div></div>
    </div>
    <h2>DM thread header &mdash; 13px, static</h2>
    <div style="display:flex;gap:9px;align-items:center;padding:4px 0 14px">
      <div style="width:34px;height:34px;border-radius:50%;background:#23233a"></div>
      <div><div style="display:flex;align-items:center;gap:5px;font-size:14px;font-weight:600">
        ${CAST[4].name}${staticCrest(CAST[4], 13)}</div>
        <div style="color:#22c55e;font-size:10px;font-weight:700;letter-spacing:.04em">ONLINE</div></div>
    </div>
    <h2>Squad chat &mdash; 12px, static</h2>
    ${CAST.slice(1, 4).map((c) => `
      <div style="display:flex;align-items:center;gap:4px;font-size:12px;margin-bottom:8px">
        <b style="color:${getRankBanner(c.level).ring}">${c.name}</b>${staticCrest(c, 12)}
        <span style="color:#D7D7E0;margin-left:4px">${SQUAD_LINES[c.uid] || 'on my way'}</span>
      </div>`).join('')}
  </div>

  <div class="panel side" style="width:300px">
    <h2>Followers / search &mdash; 12px, static</h2>
    ${CAST.map((c) => `
      <div style="display:flex;align-items:center;gap:9px;padding:7px 0">
        <div style="width:34px;height:34px;border-radius:50%;background:#23233a;flex:0 0 auto"></div>
        <div style="min-width:0;flex:1">
          <div style="display:flex;align-items:center;gap:4px;font-size:13px;font-weight:600">
            ${c.name}${staticCrest(c, 12)}</div>
          <div style="color:#6B7280;font-size:11px">@${c.name.toLowerCase()}</div>
        </div>
        <span style="font-size:11px;color:#B44FFF;font-weight:700">Follow</span>
      </div>`).join('')}
    <h2 style="margin-top:14px">Leaderboard &mdash; 12px, static</h2>
    ${CAST.slice().sort((a, b) => b.level - a.level).map((c, i) => `
      <div style="display:flex;align-items:center;gap:8px;padding:5px 0;font-size:12.5px">
        <span style="width:16px;color:#6B7280;font-weight:700">${i + 1}</span>
        <div style="width:24px;height:24px;border-radius:50%;background:#23233a"></div>
        <span style="font-weight:600">${c.name}</span>${staticCrest(c, 12)}
        <span style="margin-left:auto;color:#6B7280;font-size:11px">${(c.level * 6400).toLocaleString()}</span>
      </div>`).join('')}
  </div>
</div>
<!-- Bare crests, 40px apart, flat background, no text. The R1 pixel probe reads
     the gutters between these, so nothing but the sheen can light them. -->
<div id="probe" style="display:flex;gap:40px;padding:24px 40px;background:#0B0B14">
  ${CAST.filter((c) => c.level >= ANIMATED_CREST_LEVEL - 1).map((c) => crestHtml(c)).join('')}
</div>
<div id="card"></div>
<pre id="out">window.measure() to run the assertions.</pre>
<script>
// The rank card. Mirrors RankCrestPopover.jsx: same fields, same source
// (RANK_UNLOCKS), same fixed-position flip-above-when-no-room behaviour.
// ⚠ No progress bar here on purpose. In the app it appears ONLY on your own
// crest, because firestore.rules makes another user's wallet unreadable.
var CARD = ${JSON.stringify(cardData)};
var card = document.getElementById('card');
card.style.cssText = 'position:fixed;width:268px;z-index:99;border-radius:14px;'
  + 'padding:14px 15px 13px;background:linear-gradient(180deg,#16161F,#101018);display:none';
function openCard(uid, el) {
  var d = CARD[uid];
  if (!d) return;
  var h = '<div style="display:flex;align-items:center;gap:11px">'
    + '<img src="' + d.art + '" width="46" height="46" style="width:46px;height:46px;'
    + 'object-fit:contain;filter:drop-shadow(0 0 10px ' + d.ring + '66)">'
    + '<div><div style="font-weight:800;font-size:15px;color:' + d.ring + '">' + d.rank + '</div>'
    + '<div style="color:#9CA3AF;font-size:11.5px">Level <b style="color:#fff">' + d.level
    + '</b> &middot; band ' + d.band + '</div></div></div>';
  var hd = 'font-size:10px;color:#6B7280;text-transform:uppercase;letter-spacing:.05em;font-weight:700';
  var it = 'margin-top:5px;font-size:12px;color:#D7D7E0';
  if (d.at.length) {
    h += '<div style="' + hd + ';margin-top:13px">Unlocked at ' + d.level + '</div>';
    d.at.forEach(function (n) {
      h += '<div style="' + it + '"><span style="color:' + d.ring + ';margin-right:6px">&bull;</span>' + n + '</div>';
    });
  }
  if (d.next) {
    h += '<div style="margin-top:13px;padding-top:11px;border-top:1px solid rgba(255,255,255,.07)">'
      + '<div style="' + hd + '">Next, at level ' + d.next.level + '</div>';
    d.next.rows.forEach(function (n) {
      h += '<div style="' + it + '"><span style="color:#6B7280;margin-right:6px">&bull;</span>' + n + '</div>';
    });
    h += '</div>';
  }
  card.innerHTML = h;
  card.style.boxShadow = '0 18px 44px -14px rgba(0,0,0,.85),0 0 0 1px ' + d.ring
    + '33,0 0 34px -14px ' + d.ring;
  card.style.display = 'block';
  var r = el.getBoundingClientRect();
  var left = Math.max(8, Math.min(r.left + r.width / 2 - 134, window.innerWidth - 276));
  var top = r.bottom + 10;
  if (top + card.offsetHeight > window.innerHeight - 8) {
    top = Math.max(8, r.top - card.offsetHeight - 10);
  }
  card.style.left = left + 'px';
  card.style.top = top + 'px';
}
document.querySelectorAll('.crestwrap').forEach(function (el) {
  el.style.cursor = 'pointer';
  el.addEventListener('click', function (e) { e.stopPropagation(); openCard(el.dataset.uid, el); });
});
document.addEventListener('click', function () { card.style.display = 'none'; });
window.addEventListener('keydown', function (e) {
  if (e.key === 'Escape') card.style.display = 'none';
});
</script>
<script type="module">
const CYCLE = ${CREST_CYCLE_MS}, SWEEP = ${CREST_SWEEP_MS}, LEVEL = ${ANIMATED_CREST_LEVEL};

// The lit fraction, sampled from the REAL animation rather than read off the
// keyframes. Chrome freezes animation timelines in a hidden tab, so the sheen
// is stepped by setting currentTime directly — which also makes this exact and
// instant instead of waiting CYCLE ms in real time.
const dutyCycle = (el) => {
  // The animation lives on ::before now, so a plain getAnimations() returns
  // nothing. subtree:true is what reaches a pseudo-element's animations.
  const a = el.getAnimations({ subtree: true })[0];
  if (!a) return null;
  a.pause();
  let lit = 0;
  const STEPS = 400;
  for (let i = 0; i < STEPS; i++) {
    a.currentTime = (i / STEPS) * CYCLE;
    const m = new DOMMatrixReadOnly(getComputedStyle(el, '::before').transform);
    // The band is 130% wide of travel each way; on screen means |x| < box width.
    if (Math.abs(m.m41) < el.getBoundingClientRect().width) lit++;
  }
  a.play();
  return lit / STEPS;
};

window.measure = async () => {
  const r = [], t = (n, c, d) => r.push({ n, pass: !!c, d });
  const living = [...document.querySelectorAll('[data-living="1"]')];
  const all = [...document.querySelectorAll('.crestwrap')];

  // 1. Boundary. L61 must have nothing, L62 must have a sheen.
  const e61 = document.querySelector('[data-uid="u-edge61"]');
  const e62 = document.querySelector('[data-uid="u-edge62"]');
  t('L' + (LEVEL - 1) + ' has no sheen', !e61.querySelector('.vg-crest-sheen'));
  t('L' + LEVEL + ' has a sheen', !!e62.querySelector('.vg-crest-sheen'));
  t('L' + (LEVEL - 1) + ' has no wrapper class', !e61.classList.contains('vg-crest'));

  // 2. The animation is real and its timing matches the exported constant.
  const sheens = living.map((el) => el.querySelector('.vg-crest-sheen'));
  const anims = sheens.map((s) => s.getAnimations({ subtree: true })[0]).filter(Boolean);
  t('every living crest animates', anims.length === living.length,
    anims.length + '/' + living.length);
  const dur = anims[0] && anims[0].effect.getTiming().duration;
  t('cycle matches CREST_CYCLE_MS', dur === CYCLE, dur + ' vs ' + CYCLE);

  // 3. THE DUTY CYCLE — the one that matters.
  const duty = dutyCycle(sheens[0]);
  t('duty cycle <= 0.20', duty !== null && duty <= 0.20, 'measured ' + duty);
  t('duty cycle is not zero', duty > 0.02, 'measured ' + duty +
    ' — a sheen that is never on screen is not an effect');
  const impliedMs = Math.round(duty * CYCLE);
  t('measured sweep ~= CREST_SWEEP_MS', Math.abs(impliedMs - SWEEP) < 250,
    impliedMs + 'ms measured vs ' + SWEEP + 'ms declared');

  // 4. Phases differ, so crests do not sweep in lockstep.
  // ⚠ Compared per UID, not per element: this page renders the same cast three
  // times (side, overlay, blow-up), so element count is 3x the uid count and a
  // per-element assertion fails on the harness rather than on the product.
  const byUid = new Map();
  for (const el of living) byUid.set(el.dataset.uid,
    getComputedStyle(el.querySelector('.vg-crest-sheen'), '::before').animationDelay);
  t('phases differ per uid', new Set(byUid.values()).size === byUid.size,
    new Set(byUid.values()).size + ' distinct of ' + byUid.size + ' uids');
  t('phases are negative', [...byUid.values()].every((d) => parseFloat(d) <= 0),
    [...byUid.values()].join(' '));
  t('the same uid always gets the same phase', living
    .every((el) => getComputedStyle(el.querySelector('.vg-crest-sheen'), '::before').animationDelay
      === byUid.get(el.dataset.uid)));

  // 5. R1 — the light never leaves its own box.
  //
  // ⚠ THE FIRST VERSION OF THIS TEST WAS WRONG AND REPORTED 12 ESCAPES ON
  // CORRECT CODE. It compared getBoundingClientRect()s, but a transformed
  // element's rect DOES sit outside its parent while 'overflow: hidden' clips
  // what is PAINTED. Rects are not pixels, and R1 is about pixels.
  //
  // So: freeze mid-sweep, hand the crest boxes to the caller, and let it read
  // the actual framebuffer. 'window.__probe' is what the node side screenshots
  // against, and it runs the same measurement twice — once clipped, once with
  // the clip deliberately removed — so a green result is proved to be the clip
  // working rather than the probe looking in the wrong place.
  // ⚠ IT PROBES A DEDICATED STRIP, NOT THE CHAT ROWS. The first version sampled
  // 7px either side of every crest in the rows and measured 255 in BOTH the
  // clipped and unclipped runs — it was reading the white username glyphs
  // sitting right beside the crest. The control assertion is what exposed that;
  // without it, "peak 255, fail" looked like a real spill and "peak 20, pass"
  // would have looked like a real pass. #probe is bare crests on flat
  // background with a 40px gutter, so the only thing that can light that gutter
  // is the sheen.
  //
  // ⚠ AND IT PROBES AT THE ENDS OF THE SWEEP, NOT THE MIDDLE. At mid-sweep the
  // band sits ON the crest, which is exactly when spill is least — the moment a
  // broken clip would look fine.
  // ⚠ THE CONTROL DISABLES THE MASK, NOT overflow. It used to toggle overflow,
  // and once the mask moved to a static parent that stopped being the thing
  // doing the containing — the control run measured IDENTICAL to the real run
  // (11.6 vs 11.6) and the assertion correctly reported itself meaningless.
  // Removing the mask is what actually lets the band escape, so that is what a
  // control has to remove.
  window.__probe = (contained, frac) => {
    const strip = [...document.querySelectorAll('#probe [data-living="1"]')];
    // captureScreenshot grabs the VIEWPORT. If the strip has scrolled below the
    // fold the boxes point outside the image, every sample reads undefined, and
    // the probe returns NaN — which silently PASSES a > comparison.
    document.getElementById('probe').scrollIntoView({ block: 'center' });
    for (const el of strip) {
      const sh = el.querySelector('.vg-crest-sheen');
      const a = sh.getAnimations({ subtree: true })[0];
      a.pause();
      a.currentTime = CYCLE * frac;
      el.style.overflow = contained ? 'hidden' : 'visible';
      sh.style.webkitMaskImage = contained ? '' : 'none';
      sh.style.maskImage = contained ? '' : 'none';
    }
    // Two boxes, because they mean different things now that the wrapper is
    // padded: the OUTER box is what clips (so it is what the spill probe reads
    // beside), the INNER one is the 13px crest itself (so it is where the
    // corner probe looks for a filled square).
    return strip.map((el) => {
      const b = el.getBoundingClientRect();
      const i = el.querySelector('img').getBoundingClientRect();
      return { x: b.left, y: b.top, w: b.width, h: b.height,
               ix: i.left, iy: i.top, iw: i.width, ih: i.height };
    });
  };

  // 6. R6 + the clip, read from computed style rather than from the stylesheet.
  const cs = getComputedStyle(living[0]);
  t('wrapper isolates (R6)', cs.isolation === 'isolate', cs.isolation);
  t('wrapper clips', cs.overflow === 'hidden', cs.overflow);
  const shcs = getComputedStyle(sheens[0]);
  t('sheen is masked to the art',
    (shcs.maskImage || shcs.webkitMaskImage || '').includes('url('),
    shcs.maskImage || shcs.webkitMaskImage);

  // 7. The static half survives, which is what reduced motion falls back to.
  const imgFilter = getComputedStyle(living[0].querySelector('img')).filter;
  t('living crest has a stronger halo than a plain one', imgFilter.includes('drop-shadow'));
  const plainFilter = getComputedStyle(e61.querySelector('img')).filter;
  t('the halo actually differs from L' + (LEVEL - 1), imgFilter !== plainFilter,
    'living=' + imgFilter + ' plain=' + plainFilter);

  // 8. Reduced motion (the Settings switch, which fast-forwards rather than
  // stopping). The resting pose must be the invisible one.
  document.documentElement.setAttribute('data-reduced-motion', 'true');
  await new Promise((res) => setTimeout(res, 60));
  const rmFilter = getComputedStyle(living[0].querySelector('img')).filter;
  t('static lift survives reduced motion', rmFilter.includes('drop-shadow'), rmFilter);
  // ⚠ MEASURED AGAINST THE SHEEN'S OWN WIDTH, NOT THE WRAPPER'S. The wrapper is
  // padded (13px crest + 2x8px of room for the glow), so comparing against it
  // demanded the band travel 29px to count as "off screen" when 13px is all it
  // has to clear. That failed on correct code.
  const rmX = new DOMMatrixReadOnly(getComputedStyle(sheens[0], '::before').transform).m41;
  const sheenW = sheens[0].getBoundingClientRect().width;
  t('sheen rests off-screen under reduced motion', Math.abs(rmX) >= sheenW,
    'x=' + rmX.toFixed(1) + ' vs its own width ' + sheenW.toFixed(1));
  document.documentElement.removeAttribute('data-reduced-motion');

  // 9. §5 — nothing pulls the 1024px source into chat.
  const srcs = all.map((el) => el.querySelector('img').getAttribute('src'));
  t('every crest uses the small art', srcs.every((s) => s.includes('/badges/sm/')),
    srcs.filter((s) => !s.includes('/sm/')).join(', '));
  const loaded = all.map((el) => el.querySelector('img'))
    .filter((i) => i.naturalWidth > 0);
  t('crest art actually loaded', loaded.length === all.length,
    loaded.length + '/' + all.length + ' decoded');
  t('decoded art is 64px, not 1024px',
    loaded.every((i) => i.naturalWidth <= 64), loaded.map((i) => i.naturalWidth).join(','));

  const failed = r.filter((x) => !x.pass);
  const out = { total: r.length, passed: r.length - failed.length, failed: failed.length,
                dutyCycle: duty, failures: failed };
  document.getElementById('out').textContent = JSON.stringify(out, null, 1);
  return out;
};
</script></body></html>`;

const SERVE = { '/surface.css': 'src/styles/surface.css' };

const server = http.createServer((req, res) => {
  const url = decodeURIComponent((req.url || '/').split('?')[0]);
  if (url === '/' || url === '/index.html') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    return res.end(PAGE);
  }
  const mapped = SERVE[url];
  const file = mapped ? path.join(ROOT, mapped)
    : url.startsWith('/badges/') ? path.join(ROOT, 'public', url) : null;
  if (file && fs.existsSync(file)) {
    const ext = path.extname(file);
    res.writeHead(200, {
      'content-type': ext === '.css' ? 'text/css' : ext === '.webp' ? 'image/webp' : 'application/octet-stream',
    });
    return res.end(fs.readFileSync(file));
  }
  res.writeHead(404).end('not found');
});

server.listen(PORT, async () => {
  if (!measure) {
    console.log(`crest-preview: http://localhost:${PORT}  (window.measure())`);
    return;
  }
  // ⚠ Headless, so this cannot depend on a foreground tab. Chrome throttles
  // animation timelines to a stop when hidden, which is why dutyCycle() steps
  // currentTime by hand instead of sampling in real time.
  const CHROME = [
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  ].find((p) => fs.existsSync(p));
  if (!CHROME) { console.error('crest-preview: Chrome not found'); process.exit(1); }

  const port = 9333;
  const chrome = spawn(CHROME, [
    '--headless=new', `--remote-debugging-port=${port}`, '--no-first-run',
    '--disable-gpu', '--hide-scrollbars', `http://localhost:${PORT}/`,
  ], { stdio: 'ignore' });

  const settle = (ms) => new Promise((r) => setTimeout(r, ms));
  let result = null;
  try {
    await settle(2500);
    const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    const page = list.find((t) => t.type === 'page' && t.url.includes(String(PORT)));
    if (!page) throw new Error('no page target');
    // Minimal CDP over the debugger websocket. Node 22 has a global WebSocket,
    // so this needs no dependency and no puppeteer.
    const sock = new globalThis.WebSocket(page.webSocketDebuggerUrl);
    await new Promise((r, j) => { sock.onopen = r; sock.onerror = j; });
    const send = (method, params) => new Promise((r) => {
      const id = Math.floor(Math.random() * 1e6);
      const on = (e) => {
        const m = JSON.parse(e.data);
        if (m.id === id) { sock.removeEventListener('message', on); r(m.result); }
      };
      sock.addEventListener('message', on);
      sock.send(JSON.stringify({ id, method, params }));
    });
    await settle(900);
    const out = await send('Runtime.evaluate', {
      expression: 'window.measure()', awaitPromise: true, returnByValue: true,
    });
    result = out?.result?.value;

    // ── R1, measured in PIXELS, with a control ────────────────────────────
    // Brightest pixel in a band just outside each crest, clipped vs unclipped.
    // If the unclipped run is not markedly brighter, the probe is looking in
    // the wrong place and a "pass" on the clipped run would mean nothing.
    const sharp = (await import('sharp')).default;
    const spillAt = async (clip, frac) => {
      const b = await send('Runtime.evaluate', {
        expression: `window.__probe(${clip}, ${frac})`, returnByValue: true,
      });
      const boxes = b?.result?.value || [];
      const shot = await send('Page.captureScreenshot', { format: 'png' });
      const img = sharp(Buffer.from(shot.data, 'base64'));
      const { width, height } = await img.metadata();
      const raw = await img.removeAlpha().raw().toBuffer();
      let peak = 0;
      const BAND = 12;                      // px of gutter sampled either side
      for (const box of boxes) {
        const y0 = Math.max(0, Math.round(box.y));
        const y1 = Math.min(height - 1, Math.round(box.y + box.h));
        for (const [sx, ex] of [
          [Math.round(box.x) - BAND, Math.round(box.x) - 2],
          [Math.round(box.x + box.w) + 2, Math.round(box.x + box.w) + BAND],
        ]) {
          for (let y = y0; y <= y1; y++) {
            for (let x = Math.max(0, sx); x <= Math.min(width - 1, ex); x++) {
              const i = (y * width + x) * 3;
              const l = 0.2126 * raw[i] + 0.7152 * raw[i + 1] + 0.0722 * raw[i + 2];
              if (l > peak) peak = l;
            }
          }
        }
      }
      return peak;
    };
    // Both ends of the sweep: entering from the left, leaving to the right.
    const spill = async (clip) => Math.max(
      await spillAt(clip, 0.010), await spillAt(clip, 0.150));
    // ── The square. Caught by LOOKING, so now it is a number ──────────────
    // The badge art is ~71% fully transparent, so the corners of the crest box
    // are background. If anything fills the box — an unmasked band, or a soft
    // glow that `overflow: hidden` has squared off — the corners light up.
    //
    // ⚠ THIS IS THE ASSERTION THE FIRST BUILD LACKED. It passed 23/23 while
    // rendering a hard grey rectangle behind every living crest, because every
    // probe read OUTSIDE the box and the damage was INSIDE it.
    const corners = async () => {
      const b = await send('Runtime.evaluate', {
        // ⚠ AT AN IDLE PHASE. The square this catches is the static halo being
        // clipped, which shows at every phase; sampling mid-sweep would let the
        // sheen light the corners and confound the reading.
        expression: 'window.__probe(true, 0.40)', returnByValue: true,
      });
      const boxes = b?.result?.value || [];
      const shot = await send('Page.captureScreenshot', { format: 'png' });
      const img = sharp(Buffer.from(shot.data, 'base64'));
      const { width } = await img.metadata();
      const raw = await img.removeAlpha().raw().toBuffer();
      const lum = (x, y) => {
        const i = (Math.round(y) * width + Math.round(x)) * 3;
        return 0.2126 * raw[i] + 0.7152 * raw[i + 1] + 0.0722 * raw[i + 2];
      };
      const base = await send('Runtime.evaluate', { returnByValue: true, expression:
        `(() => { const el = document.querySelector('#probe .crestwrap:not([data-living])');
                  const i = el.querySelector('img').getBoundingClientRect();
                  return { ix: i.left, iy: i.top, iw: i.width, ih: i.height }; })()` });
      // ⚠ THE SIGNATURE OF A FILLED SQUARE IS A HARD EDGE, NOT BRIGHTNESS.
      //
      // Two earlier versions of this got it wrong. An absolute ceiling failed on
      // correct code, because a crest legitimately glows. A living-vs-plain
      // comparison also failed on correct code, because the living crest's halo
      // IS brighter by design — that is the unlock.
      //
      // What actually distinguishes them: a glow falls off smoothly across the
      // box boundary, and a clipped fill DROPS OFF A CLIFF at it. So sample 2px
      // inside and 2px outside each corner of the clipping box and look for a
      // discontinuity. A real halo shows a few levels; the square showed tens.
      const edgeStep = (bx) => {
        let worst = 0;
        for (const [ix, iy, ox, oy] of [
          [bx.x + 2, bx.y + 2, bx.x - 3, bx.y - 3],
          [bx.x + bx.w - 3, bx.y + 2, bx.x + bx.w + 2, bx.y - 3],
          [bx.x + 2, bx.y + bx.h - 3, bx.x - 3, bx.y + bx.h + 2],
          [bx.x + bx.w - 3, bx.y + bx.h - 3, bx.x + bx.w + 2, bx.y + bx.h + 2],
        ]) worst = Math.max(worst, lum(ix, iy) - lum(ox, oy));
        return worst;
      };
      return {
        step: Math.max(...boxes.map(edgeStep)),
        baseline: edgeStep({ ...base.result.value, x: base.result.value.ix,
          y: base.result.value.iy, w: base.result.value.iw, h: base.result.value.ih }),
      };
    };
    const c = await corners();
    result.total++;
    // ⚠ NaN FIRST. NaN > 25 is false, so an out-of-bounds read would have
    // reported a clean pass while measuring nothing at all.
    if (!Number.isFinite(c.step) || c.step > 25) {
      result.failed++;
      result.failures.push({ n: 'no hard edge at the clip boundary (no filled square)',
        d: `luminance drops ${c.step.toFixed(1)} across the box edge — a glow falls off smoothly, a clipped fill does not` });
    } else result.passed++;
    result.edgeStep = { living: +c.step.toFixed(1), plainCrest: +c.baseline.toFixed(1) };

    const clipped = await spill(true);
    const unclipped = await spill(false);
    result.spill = { clipped: +clipped.toFixed(1), unclipped: +unclipped.toFixed(1) };
    result.total += 2;
    if (!Number.isFinite(clipped) || !Number.isFinite(unclipped) || unclipped - clipped < 25) {
      result.failed++;
      result.failures.push({ n: 'R1 pixel probe is meaningful (control)',
        d: `unclipped peak ${unclipped.toFixed(1)} vs clipped ${clipped.toFixed(1)} — the probe cannot see the spill it is meant to catch` });
    } else result.passed++;
    if (!Number.isFinite(clipped) || clipped > 90) {
      result.failed++;
      result.failures.push({ n: 'no sheen pixel escapes the crest box (R1)',
        d: `peak luminance ${clipped.toFixed(1)} beside the crest` });
    } else result.passed++;

    sock.close();
  } catch (e) {
    console.error('crest-preview: measurement failed —', e.message);
  } finally {
    chrome.kill();
    server.close();
  }

  if (!result) process.exit(1);
  console.log(`crest-preview: ${result.passed}/${result.total} passed, duty cycle ${result.dutyCycle}`);
  console.log(`  R1 spill probe: clipped peak ${result.spill.clipped}, unclipped control ${result.spill.unclipped}`);
  console.log(`  edge-step probe: living ${result.edgeStep.living}, plain crest ${result.edgeStep.plainCrest} (a clipped square shows tens)`);
  if (result.failed) {
    for (const f of result.failures) console.log(`  x ${f.n}${f.d ? ' — ' + f.d : ''}`);
    process.exit(1);
  }
  console.log('living crest verified');
});
