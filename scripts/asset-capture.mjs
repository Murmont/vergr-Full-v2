// Capture plates for commissioning motion assets.
//
// WHY THIS EXISTS. We have no real users, so the marketing page has to show
// product that looks real without being real. The split that makes that work:
//
//   * VERGR CHROME IS RENDERED HERE, FOR REAL. The entry ribbon uses the actual
//     founder art in public/brand/entry/ and JoinAnnouncer's actual geometry;
//     the tip alert and goal bar reproduce StreamGoalAndAlerts. Nothing here is
//     an artist's impression of our UI — it IS our UI, just large.
//   * PEOPLE AND MOTION COME FROM GEMINI. Faces, gameplay and movement are the
//     parts we cannot author, so they get generated on green and keyed out.
//
// So: run this, screenshot a plate, hand the plate to Gemini as the reference
// for what the overlay must look like, and composite its output back.
//
// ⚠ PLATES ARE RENDERED AT 4x THE SHIPPING SIZE. The entry ribbon ships at
// 280x70 (rankBanners.js), which is far too small to be a useful reference for
// a generator — art that reads at 4128px can be mud at 280. SCALE is applied to
// geometry, not to a zoomed bitmap, so the plate is sharp.
//
// ⚠ THE GREEN PLATE IS A SEPARATE OUTPUT ON PURPOSE. Keying works far better
// against a flat key colour than against our dark UI, and #00B140 (broadcast
// digital green) is the standard. A dark-background plate is written too, for
// judging how it will actually sit on the page.
//
//   node scripts/asset-capture.mjs
//   → .preview/asset-capture.html   (open it, screenshot the plates)

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { RANK_BANNERS, nameSizeFor } = await import(`file://${repo}/src/utils/rankBanners.js`);

// Shipping geometry, straight from JoinAnnouncer / rankBanners.
const W = 280, H = 70;
const SCALE = 4;                      // plate size, not a zoom
const KEY = '#00B140';                // broadcast digital green

// Who appears on the plates. Deliberately plausible handles, not "User1".
const CAST = [
  { name: 'nova_kill', rank: 'ascendant' },
  { name: 'Sable',     rank: 'legend' },
  { name: 'ALEX',      rank: 'challenger' },
];

const px = (n) => `${Math.round(n * SCALE)}px`;

function ribbon(rankId, name) {
  const r = RANK_BANNERS.find((b) => b.id === rankId) || RANK_BANNERS[0];
  const avatarD = H * 0.74;
  const avatarCx = W * 0.145;
  const textLeft = avatarCx + avatarD / 2 + W * 0.03;
  const nameSize = nameSizeFor(name, W, H);
  const grad = r.nameMid
    ? `linear-gradient(180deg, ${r.nameTop} 0%, ${r.nameMid} 52%, ${r.nameBottom} 100%)`
    : `linear-gradient(180deg, ${r.nameTop} 0%, ${r.nameBottom} 100%)`;
  return `
  <div class="ribbon" style="width:${px(W)};height:${px(H)};border-radius:${px(14)}">
    <img class="plate" src="../public/brand/entry/${r.id}@2x.webp" alt="">
    <div class="scrim"></div>
    <div class="av" style="
      width:${px(avatarD)};height:${px(avatarD)};
      left:${px(avatarCx - avatarD / 2)};
      box-shadow:0 0 0 ${px(2)} ${r.ring}, 0 0 ${px(H * 0.22)} ${r.ring}AA"></div>
    <div class="txt" style="left:${px(textLeft)}">
      <div class="nm" style="font-size:${px(nameSize)};background-image:${grad}">${name}</div>
      <div class="jn" style="font-size:${px(H * 0.16)}">joined</div>
    </div>
  </div>`;
}

function tipAlert(from, coins) {
  return `
  <div class="tip">
    <span class="tipIcon">◆</span>
    <span class="tipTxt"><b>${from}</b> sent <b class="amt">${coins}</b></span>
  </div>`;
}

function goalBar(label, cur, target) {
  const pct = Math.round((cur / target) * 100);
  return `
  <div class="goal">
    <div class="goalTop"><span class="goalStar">★</span> TIP GOAL <span class="goalReason">· ${label}</span>
      <span class="goalNum">${cur.toLocaleString()} / ${target.toLocaleString()}</span></div>
    <div class="goalTrack"><div class="goalFill" style="width:${pct}%"></div></div>
  </div>`;
}

const plate = (title, note, bg, body) => `
  <section class="sheet">
    <h2>${title}</h2>
    <p class="note">${note}</p>
    <div class="stage" style="background:${bg}">${body}</div>
  </section>`;

const ribbons = CAST.map((c) => ribbon(c.rank, c.name)).join('');

const html = `<!doctype html><meta charset="utf-8">
<title>Vergr asset capture plates</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Syne:wght@700;800&family=DM+Sans:wght@400;700&display=swap" rel="stylesheet">
<style>
  body { margin:0; background:#0b0c12; color:#ECEFFE; font-family:'DM Sans',system-ui,sans-serif; padding:40px; }
  h1 { font-family:Syne,sans-serif; font-size:26px; margin:0 0 6px; }
  .lede { color:#A8AEC9; font-size:14px; max-width:760px; margin:0 0 32px; line-height:1.6; }
  .sheet { margin:0 0 46px; }
  h2 { font-family:Syne,sans-serif; font-size:17px; margin:0 0 4px; }
  .note { color:#6B7290; font-size:12.5px; margin:0 0 14px; max-width:760px; line-height:1.55; }
  .stage { padding:56px; border-radius:16px; display:flex; flex-direction:column; gap:34px;
           align-items:flex-start; }

  /* ── entry ribbon: JoinAnnouncer geometry ── */
  .ribbon { position:relative; overflow:hidden; flex:0 0 auto; }
  .ribbon .plate { position:absolute; inset:0; width:100%; height:100%; object-fit:cover; }
  .ribbon .scrim { position:absolute; inset:0;
    background:linear-gradient(90deg, rgba(0,0,0,0.55), rgba(0,0,0,0.12) 60%, transparent); }
  .ribbon .av { position:absolute; top:50%; transform:translateY(-50%); border-radius:50%;
    background:linear-gradient(140deg,#3a3350,#171622); }
  .ribbon .txt { position:absolute; top:50%; transform:translateY(-50%); line-height:1; }
  .ribbon .nm { font-family:Syne,sans-serif; font-weight:800; font-style:italic;
    text-transform:uppercase; letter-spacing:.01em;
    -webkit-background-clip:text; background-clip:text; color:transparent; }
  .ribbon .jn { color:rgba(255,255,255,.82); font-weight:700; margin-top:.35em;
    text-transform:uppercase; letter-spacing:.18em; }

  /* ── tip alert ── */
  .tip { display:inline-flex; align-items:center; gap:14px; padding:18px 26px; border-radius:18px;
    background:rgba(10,11,18,.86); border:2px solid rgba(245,197,66,.45); }
  .tipIcon { color:#F5C542; font-size:30px; }
  .tipTxt { font-size:26px; color:#ECEFFE; }
  .tipTxt b { color:#fff; } .tipTxt .amt { color:#F5C542; }

  /* ── goal bar ── */
  .goal { width:720px; padding:18px 24px; border-radius:16px; background:rgba(10,11,18,.86); }
  .goalTop { display:flex; align-items:center; gap:8px; font-size:19px; font-weight:700;
    letter-spacing:.08em; color:#fff; margin-bottom:12px; }
  .goalStar { color:#F5C542; }
  .goalReason { color:#A8AEC9; font-weight:400; letter-spacing:0; }
  .goalNum { margin-left:auto; font-family:'DM Mono',monospace; color:#fff; letter-spacing:0; }
  .goalTrack { height:10px; border-radius:999px; background:rgba(255,255,255,.14); overflow:hidden; }
  .goalFill { height:100%; border-radius:999px; background:linear-gradient(90deg,#7B6FFF,#F5C542); }
</style>

<h1>Vergr capture plates</h1>
<p class="lede">Real Vergr chrome at ${SCALE}x shipping size. Screenshot a plate and give it to the
generator as the reference for what the overlay must look like. The green plates are for keying, the
dark plates are for judging how it will sit on the page.</p>

${plate('Entry ribbon · key plate', 'Ask for: the ribbon sliding in from the left, settling, light sweeping the edge once, then fading. Hold ~3s. Keep the ribbon shape and text EXACTLY as rendered here.', KEY, ribbons)}
${plate('Entry ribbon · on-page plate', 'Same thing on our own background, so you can judge the read before committing to a render.', '#0F1118', ribbons)}
${plate('Tip alert · key plate', 'Ask for: the pill flying in, a soft gold pulse on the amount, then drifting up and out. ~2.5s.', KEY, tipAlert('nova_kill', 250) + tipAlert('Sable', 1000))}
${plate('Tip alert · on-page plate', '', '#0F1118', tipAlert('nova_kill', 250) + tipAlert('Sable', 1000))}
${plate('Tip goal · key plate', 'Ask for: the bar filling from 41% to 68% with the number counting up. ~2s, then hold.', KEY, goalBar('New mic!', 3120, 5000))}
${plate('Tip goal · on-page plate', '', '#0F1118', goalBar('New mic!', 3120, 5000))}

<script type="module">
  // nameSizeFor() falls back to a conservative estimate under node, which has no
  // canvas. Re-measure in the browser exactly as the component does, so the
  // plate shows the size that will actually ship.
  const { nameSizeFor } = await import('../src/utils/rankBanners.js');
  document.querySelectorAll('.ribbon .nm').forEach((el) => {
    const s = nameSizeFor(el.textContent.trim(), ${W}, ${H});
    el.style.fontSize = (s * ${SCALE}) + 'px';
  });
</script>`;

mkdirSync(resolve(repo, '.preview'), { recursive: true });
const out = resolve(repo, '.preview/asset-capture.html');
writeFileSync(out, html);
console.log('wrote', out);
console.log(`ribbons: ${CAST.map((c) => `${c.name} (${c.rank})`).join(', ')}`);
