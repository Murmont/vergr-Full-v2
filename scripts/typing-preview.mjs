// Renders every typing-indicator style against the REAL stylesheet, at the two
// real sizes (7px in a chat bubble, 4px inline), and serves it so a browser can
// MEASURE it. Effect 06. Doc: docs/effects/06-typing-indicator.md
//
//   node scripts/typing-preview.mjs          # serve on :5199, prints the URL
//   node scripts/typing-preview.mjs --write  # just write the file, no server
//
// WHY THIS EXISTS: effects/README.md rule 6 — "three consecutive theme versions
// shipped unrendered and all three were wrong". A motion cosmetic cannot be
// judged from source, and a screenshot cannot prove a duration or a stagger.
// This page is the thing the numbers in doc 06 §7 are read out of.
//
// ⚠ THE STYLESHEET IS LINKED, NOT COPIED. It is served straight off disk, so
// what is measured here is byte-identical to what ships. The style LIST comes
// from rankUnlocks.js for the same reason. The only thing reproduced is which
// elements each style needs, and `assertMarkupMatches` below fails the run if
// that ever drifts from the component.
import { writeFileSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { TYPING_STYLES } = await import(`file://${repo}/src/utils/rankUnlocks.js`);
const CSS_PATH = 'src/components/effects/triggers/TypingStyles.css';
const JSX_PATH = 'src/components/effects/triggers/TypingStyles.jsx';

// The component's own branching, mirrored. If someone adds a style that needs
// different elements and does not update this, the harness would quietly
// measure the wrong DOM and report a pass.
const kids = (id) =>
  id === 'orbit' ? '<i class="vg-typing-track"></i><i class="vg-typing-spin"></i>'
  : id === 'comet' ? '<i></i>'
  : '<i></i><i></i><i></i>';

function assertMarkupMatches() {
  const src = readFileSync(`${repo}/${JSX_PATH}`, 'utf8');
  const problems = [];
  if (!src.includes('vg-typing-track') || !src.includes('vg-typing-spin')) problems.push('orbit markup');
  for (const s of TYPING_STYLES) {
    if (!src.includes(`'${s.id}'`) && !/THREE\s*=/.test(src)) problems.push(s.id);
  }
  if (problems.length) {
    console.error('typing-preview: harness markup has drifted from ' + JSX_PATH + ': ' + problems.join(', '));
    process.exit(1);
  }
}
assertMarkupMatches();

const ACCENT = '#7B1FFF';
const cell = (s, size, ink) => `
    <div class="cell">
      <div class="lbl">${s.name} <em>${size}px</em></div>
      <div class="stage">
        <span class="vg-typing vg-typing--${s.id}" data-style="${s.id}" data-size="${size}"
              style="--vg-typing-d:${size}px${ink ? `;--vg-typing-ink:${ink}` : ''}">${kids(s.id)}</span>
      </div>
    </div>`;

const html = `<!doctype html><meta charset="utf-8"><title>Typing indicator styles</title>
<link rel="stylesheet" href="/typing.css">
<style>
  body{margin:0;padding:28px;background:#0B0B14;color:#fff;font:13px/1.4 system-ui,sans-serif}
  h1{font-size:15px;margin:0 0 4px}
  p.sub{color:#9CA3AF;margin:0 0 20px;font-size:12px}
  h2{font-size:12px;color:#9CA3AF;font-weight:600;margin:26px 0 10px;text-transform:uppercase;letter-spacing:.08em}
  .grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;max-width:760px}
  .cell{background:#14141F;border-radius:12px;padding:12px}
  .lbl{font-size:11px;color:#9CA3AF;margin-bottom:10px}
  .lbl em{font-style:normal;color:#6B7280}
  .stage{height:34px;display:flex;align-items:center}
  .bubble{background:#1A1A2A;border-radius:16px 16px 16px 4px;padding:12px 16px;display:inline-flex;align-items:center;gap:8px}
  .bubble span.t{font-size:10px;color:#6B7280;font-weight:500}
  .row{display:flex;align-items:center;gap:6px;font-size:11px;color:#B44FFF;margin-bottom:8px}
</style>
<h1>Typing indicator — every style, both real sizes</h1>
<p class="sub">Stylesheet served straight from ${CSS_PATH}. Ink = the accent a user with a style equipped gets.</p>

<h2>Bubble, 7px, accent ink</h2>
<div class="grid">${TYPING_STYLES.map((s) => cell(s, 7, s.id === 'dots' ? null : ACCENT)).join('')}</div>

<h2>Inline, 4px, accent ink</h2>
<div class="grid">${TYPING_STYLES.map((s) => cell(s, 4, s.id === 'dots' ? null : ACCENT)).join('')}</div>

<h2>Filmstrip — each style paused at 5 phases of one cycle</h2>
<p class="sub">A still of a moving thing proves nothing unless the phases are pinned. This is how the shape of the motion gets judged: read each row left to right.</p>
<div id="strip"></div>
<script>
  // Clone each style five times and pin each copy to a fixed point in its own
  // cycle. Uses the Web Animations API on the REAL running animations, so the
  // frames are the ones the browser actually paints.
  const strip = document.getElementById('strip');
  for (const el of document.querySelectorAll('.stage .vg-typing')) {
    if (el.dataset.size !== '7') continue;
    const row = document.createElement('div');
    row.className = 'film';
    row.innerHTML = '<span class="fl">' + el.dataset.style + '</span>';
    for (const frac of [0, 0.2, 0.4, 0.6, 0.8]) {
      const box = document.createElement('span');
      box.className = 'fcell';
      const c = el.cloneNode(true);
      c.style.setProperty('--vg-typing-d', '10px');
      box.appendChild(c);
      row.appendChild(box);
      for (const i of c.querySelectorAll('i')) {
        for (const a of i.getAnimations()) { a.pause(); a.currentTime = a.effect.getTiming().duration * frac; }
      }
    }
    strip.appendChild(row);
  }
</script>
<style>
  .film{display:flex;align-items:center;gap:10px;margin-bottom:10px}
  .fl{width:52px;font-size:11px;color:#6B7280}
  .fcell{width:90px;height:40px;background:#14141F;border-radius:8px;display:flex;align-items:center;justify-content:center}
</style>

<h2>In situ</h2>
<div class="grid" style="grid-template-columns:1fr">
  <div class="cell">
    ${TYPING_STYLES.map((s) => `<div class="row"><span class="vg-typing vg-typing--${s.id}" style="--vg-typing-d:4px;--vg-typing-ink:${s.id === 'dots' ? '#6B7280' : ACCENT}">${kids(s.id)}</span><span>Verion is typing…</span></div>`).join('')}
    <div class="bubble"><span class="vg-typing vg-typing--dots" style="--vg-typing-d:7px">${kids('dots')}</span><span class="t">Verion is typing</span></div>
  </div>
</div>
`;

const out = process.env.TEMP ? `${process.env.TEMP}/vergr-typing-preview.html` : `${repo}/typing-preview.html`;
writeFileSync(out, html);
console.log('typing-preview: wrote ' + out);

const PORT = Number(process.env.PORT || 5199);
const serve = () => new Promise((done) => {
  const srv = createServer((req, res) => {
    if (req.url.startsWith('/typing.css')) {
      res.writeHead(200, { 'content-type': 'text/css', 'cache-control': 'no-store' });
      res.end(readFileSync(`${repo}/${CSS_PATH}`));
      return;
    }
    res.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'no-store' });
    res.end(html);
  }).listen(PORT, () => done(srv));
});

if (process.argv.includes('--write')) {
  // nothing else to do
} else if (process.argv.includes('--measure')) {
  // ── MEASURE, do not eyeball ────────────────────────────────────────
  // Drives the page in the installed Chrome and reads NUMBERS out of it:
  // durations, staggers, how far each channel actually travels, and the two
  // things a screenshot can never show — that the comet's loop is seamless and
  // that reduced motion leaves a VISIBLE indicator rather than an empty gap.
  const puppeteer = (await import('puppeteer-core')).default;
  const srv = await serve();
  const browser = await puppeteer.launch({
    executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: 'new',
    args: ['--force-device-scale-factor=2'],
  });
  const results = [];
  const say = (name, pass, detail) => results.push({ name, pass, detail });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 900, height: 900, deviceScaleFactor: 2 });
    await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle0' });

    // 1. Every style animates, with the timing its stylesheet declares.
    const timing = await page.evaluate(() => {
      const o = {};
      for (const el of document.querySelectorAll('.stage .vg-typing')) {
        if (el.dataset.size !== '7') continue;
        const kids = [...el.querySelectorAll('i')];
        const a = kids.map((k) => k.getAnimations()[0]).find(Boolean);
        o[el.dataset.style] = {
          animation: a?.animationName || null,
          duration: a?.effect.getTiming().duration ?? null,
          delays: kids.map((k) => getComputedStyle(k).animationDelay),
          running: a?.playState === 'running',
        };
      }
      return o;
    });
    for (const s of TYPING_STYLES) {
      const t = timing[s.id];
      say(`${s.id} animates`, !!t?.animation && t.running, t?.animation || 'NO ANIMATION');
    }
    say('dots uses the reference 1.4s period', timing.dots?.duration === 1400, String(timing.dots?.duration));
    say('dots stagger is NEGATIVE (-0.32 / -0.16 / 0)',
      JSON.stringify(timing.dots?.delays) === JSON.stringify(['-0.32s', '-0.16s', '0s']),
      JSON.stringify(timing.dots?.delays));

    // 2. Real travel. The version this replaced ran Tailwind's `bounce`
    //    (translateY(-25%)) on a 5px dot = 1.25px of movement, which is why
    //    "it animates" was never a sufficient test. Sample the whole cycle and
    //    measure how far each channel actually moves.
    const travel = await page.evaluate(async () => {
      const o = {};
      for (const el of document.querySelectorAll('.stage .vg-typing')) {
        if (el.dataset.size !== '7') continue;
        const t = el.querySelector('i.vg-typing-spin') || el.querySelector('i');
        const a = t.getAnimations()[0];
        a.pause();
        const d = a.effect.getTiming().duration;
        const op = [], px = [], bp = new Set();
        for (let i = 0; i <= 20; i++) {
          a.currentTime = (d * i) / 20;
          const cs = getComputedStyle(t);
          op.push(parseFloat(cs.opacity));
          const m = new DOMMatrixReadOnly(cs.transform === 'none' ? '' : cs.transform);
          px.push(Math.hypot(m.m41, m.m42) + Math.abs(1 - m.a) * 20 + Math.abs(1 - m.d) * 20);
          bp.add(cs.backgroundPosition);
        }
        o[el.dataset.style] = {
          opacitySwing: +(Math.max(...op) - Math.min(...op)).toFixed(3),
          transformSwing: +(Math.max(...px) - Math.min(...px)).toFixed(2),
          bgPositions: bp.size,
        };
        a.play();
      }
      return o;
    });
    for (const s of TYPING_STYLES) {
      const t = travel[s.id];
      // A style must move MEANINGFULLY in at least one channel. The thresholds
      // are the point: 0.2 opacity, 2px-equivalent transform, or a moving
      // background. The old 1.25px bounce clears none of them.
      const moves = t.opacitySwing >= 0.2 || t.transformSwing >= 2 || t.bgPositions > 3;
      say(`${s.id} moves enough to read`, moves,
        `opacity ${t.opacitySwing} · transform ${t.transformSwing} · bg steps ${t.bgPositions}`);
    }

    // 3. The comet's loop is SEAMLESS: the LAST frame of a cycle and the FIRST
    //    frame of the next must be the same pixels, or the sweep snaps once per
    //    revolution (docs/effects/03 §0.1, a whole session's worth of lesson).
    //
    // ⚠ ONE element, screenshotted twice. The first version of this probe used
    //    two clones stacked in a column, and they differed by 123 bytes —
    //    nothing to do with the loop. The rows are 12.4px tall, so the second
    //    one started on a half-pixel boundary and antialiased differently. A
    //    measurement that moves the subject is measuring the wrong thing.
    //
    //    Start of cycle = background-position 100%, end = 0%. If the image is
    //    genuinely two identical cycles those two positions show the same
    //    pixels; if it is one cycle stretched over 200% they show opposite ends
    //    of it and the diff is enormous.
    await page.evaluate(() => {
      const src = [...document.querySelectorAll('.vg-typing--comet')].find((e) => e.dataset.size === '7');
      const c = src.cloneNode(true);
      c.id = 'seam';
      c.style.cssText += ';position:fixed;left:20px;top:20px;z-index:9999';
      c.style.setProperty('--vg-typing-d', '20px');   // blown up: a seam would be unmissable
      document.body.appendChild(c);
      c.querySelector('i').getAnimations()[0].pause();
    });
    // ⚠ Drive `background-position` DIRECTLY rather than the clock. Reading the
    // last frame as `currentTime = duration - 1` lands on 0.067% instead of 0%,
    // which on a 108px box is a 0.07px shift — real subpixel antialiasing, and
    // it failed a loop that is exactly periodic. The claim under test is
    // "position 0% and position 100% are the same pixels", so set those two
    // positions and compare them, with nothing in between to be approximate
    // about.
    const seamAt = async (pos) => {
      await page.evaluate((p) => {
        const i = document.querySelector('#seam i');
        i.style.animation = 'none';
        i.style.backgroundPosition = p;
      }, pos);
      return Buffer.from(await (await page.$('#seam')).screenshot());
    };
    const [seamA, seamB] = [await seamAt('0% 50%'), await seamAt('100% 50%')];
    say('comet loop is seamless (last frame === first frame, pixel for pixel)',
      Buffer.compare(seamA, seamB) === 0, `${seamA.length} vs ${seamB.length} bytes`);
    // ⚠ THE SEAM TEST ALONE CAN PASS ON A BUG. It did: `.vg-typing i` sets a
    // solid background-colour, the comet only overrode background-IMAGE, and a
    // solid bar loops perfectly — seamless, and completely wrong. So also
    // assert the light is actually visible, by requiring that HALF WAY through
    // the cycle looks different from the start. A uniform fill fails this.
    const seamMid = await seamAt('50% 50%');
    say('comet light is visible (mid-cycle differs from the start)',
      Buffer.compare(seamA, seamMid) !== 0, `${seamA.length} vs ${seamMid.length} bytes`);
    await page.evaluate(() => document.getElementById('seam')?.remove());

    // 4. Reduced motion. ⚠ The test is NOT "does the animation stop" — it is
    //    "does the animation stop AND is the indicator still visible". Every
    //    style rests at a dim or shrunk pose, so an `animation: none` with no
    //    resting form declared would pass a naive check while telling the user
    //    nothing is happening.
    await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
    const rm = await page.evaluate(() => {
      const o = {};
      for (const el of document.querySelectorAll('.stage .vg-typing')) {
        if (el.dataset.size !== '7') continue;
        const kids = [...el.querySelectorAll('i')];
        // ⚠ MAX, not MIN. `orbit`'s track is deliberately a 0.26-opacity ring
        // — it is the groove the light runs in, not the light. Asserting on the
        // dimmest child failed a style that was perfectly visible, which is the
        // probe being wrong rather than the effect.
        o[el.dataset.style] = {
          anims: kids.reduce((n, k) => n + k.getAnimations().length, 0),
          topOpacity: Math.max(...kids.map((k) => parseFloat(getComputedStyle(k).opacity))),
          visible: kids.every((k) => k.getBoundingClientRect().width > 0),
        };
      }
      return o;
    });
    for (const s of TYPING_STYLES) {
      const t = rm[s.id];
      say(`${s.id} stops under reduced motion`, t.anims === 0, `${t.anims} running`);
      say(`${s.id} stays VISIBLE under reduced motion`, t.topOpacity >= 0.5 && t.visible,
        `brightest element ${t.topOpacity}`);
    }
    await page.emulateMediaFeatures([]);

    // 4b. THE APP'S OWN reduced-motion switch, which the media query above does
    // NOT catch. Settings → Appearance sets html[data-reduced-motion="true"] and
    // index.css answers it by fast-forwarding every animation to its last
    // keyframe (`duration: 0.001ms; iteration-count: 1`) rather than stopping
    // it. The last keyframe is the RESTING pose, so without an explicit rule
    // `pixel` lands on opacity .2 — an indicator nobody can see. Same assertion,
    // other switch.
    const rmAttr = await page.evaluate(() => {
      document.documentElement.setAttribute('data-reduced-motion', 'true');
      // index.css is not loaded in this harness, so reproduce exactly what it does.
      const s = document.createElement('style');
      s.textContent = 'html[data-reduced-motion="true"] *, html[data-reduced-motion="true"] *::before, html[data-reduced-motion="true"] *::after { animation-duration: 0.001ms !important; animation-iteration-count: 1 !important; }';
      document.head.appendChild(s);
      const o = {};
      for (const el of document.querySelectorAll('.stage .vg-typing')) {
        if (el.dataset.size !== '7') continue;
        const kids = [...el.querySelectorAll('i')];
        o[el.dataset.style] = Math.max(...kids.map((k) => parseFloat(getComputedStyle(k).opacity)));
      }
      return o;
    });
    for (const s of TYPING_STYLES) {
      say(`${s.id} stays VISIBLE under the app's Reduced Motion setting`, rmAttr[s.id] >= 0.5,
        `brightest element ${rmAttr[s.id]}`);
    }
    await page.evaluate(() => document.documentElement.removeAttribute('data-reduced-motion'));

    // 5. Zero JS. The whole point of doing this in CSS: an indicator can sit on
    //    screen for minutes, and a group chat can hold several.
    const timers = await page.evaluate(async () => {
      let made = 0;
      const si = window.setInterval, st = window.setTimeout;
      window.setInterval = (...a) => { made++; return si(...a); };
      window.setTimeout = (...a) => { made++; return st(...a); };
      document.body.appendChild(document.querySelector('.vg-typing').cloneNode(true));
      // `st`, the ORIGINAL reference captured before the patch, so this probe's
      // own wait is not counted. (Subtracting 1 for it was wrong twice over: it
      // was never counted, so the result read -1.)
      await new Promise((r) => st(r, 1200));
      return made;
    });
    say('no JS timer per indicator', timers === 0, `${timers} created`);

    await page.screenshot({ path: `${repo}/scripts/.typing-preview.png`, fullPage: true });
    console.log('typing-preview: screenshot → scripts/.typing-preview.png');
  } finally {
    await browser.close();
    srv.close();
  }
  const bad = results.filter((r) => !r.pass);
  for (const r of results) console.log(`  ${r.pass ? '.' : 'x'} ${r.name}${r.detail ? ' — ' + r.detail : ''}`);
  console.log(`\nPASS ${results.length - bad.length}/${results.length}`);
  process.exit(bad.length ? 1 : 0);
} else {
  await serve();
  console.log(`typing-preview: http://localhost:${PORT}/`);
}
