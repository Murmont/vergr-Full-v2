/* Audit harness — PASTE THIS INTO THE BROWSER CONSOLE on the page being audited.
 *
 * Not imported by anything and not part of the build. It exists because rebuilding these
 * probes from scratch is where measurement mistakes come from: every function below has a
 * comment naming the false result it produces if you get it wrong, and each of those was a
 * real wrong answer during the 2026-09-03 audit.
 *
 * Read docs/AUDIT_RULES.md first. Usage after pasting:
 *
 *   await __A.setState({device:'Mobile', phase:'Live', role:'Viewer',
 *                       viewer:'Plain viewer', layout:'Solo', view:'Immersive',
 *                       playback:'Playing', chat:'Open'});
 *   await __A.fitFrame();
 *   __A.audit();            // blocked / tiny / unnamed
 *   __A.style();            // fake glass / ghost outlines / stray fonts
 *   __A.contrast();         // text below its floor
 *   await __A.fire('Poll'); // fire a transient, settle, then measure it
 */
window.__A = (() => {
  const tick = (n = 8) => new Promise((res) => {
    // ⚠ MessageChannel, NOT setTimeout/rAF. A background tab throttles timers to ~1s and
    // freezes rAF, so a "wait" looks fine here and silently does nothing.
    let i = 0; const c = new MessageChannel();
    c.port1.onmessage = () => { if (++i >= n) { c.port1.close(); res(); } else c.port2.postMessage(0); };
    c.port2.postMessage(0);
  });

  const vis = (el) => {
    const s = getComputedStyle(el);
    if (s.display === 'none' || s.visibility === 'hidden' || Number(s.opacity) === 0) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };

  // ⚠ CLIP AGAINST EVERY SCROLL ANCESTOR, not just the viewport. A chat row scrolled out of
  // its own list still has a rect, and probing it returns the page behind — the first audit
  // run produced 20 phantom "occluders" this way and not one was real.
  const visRect = (el) => {
    const r = el.getBoundingClientRect();
    let x1 = r.left, y1 = r.top, x2 = r.right, y2 = r.bottom;
    for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
      const s = getComputedStyle(p);
      if (s.overflow === 'visible' && s.overflowX === 'visible' && s.overflowY === 'visible') continue;
      const pr = p.getBoundingClientRect();
      x1 = Math.max(x1, pr.left); y1 = Math.max(y1, pr.top);
      x2 = Math.min(x2, pr.right); y2 = Math.min(y2, pr.bottom);
    }
    x1 = Math.max(x1, 0); y1 = Math.max(y1, 0);
    x2 = Math.min(x2, innerWidth); y2 = Math.min(y2, innerHeight);
    return { x1, y1, w: x2 - x1, h: y2 - y1 };
  };

  // The simulated device stage. ⚠ SCOPE TO THIS, never to #root — #root sweeps in the admin
  // sidebar and the preview's own control rail, which is tooling, not product.
  const frame = () => {
    const c = [...document.querySelectorAll('div')].map((d) => {
      const r = d.getBoundingClientRect(); const s = getComputedStyle(d);
      return { d, w: r.width, h: r.height, ov: s.overflow };
    }).filter((x) => x.ov !== 'visible' && x.w > 240 && x.w < 1500 && x.h > 320);
    c.sort((a, b) => b.w * b.h - a.w * a.h);
    return c[0]?.d || document.body;
  };

  // ⚠ MEASURE WITH THE WHOLE FRAME ON SCREEN. The phone is 852px in a ~915px viewport, so
  // its bottom ~115px — the composer and every sheet's action row — sits below the fold,
  // where elementFromPoint returns null and reads as "unreachable" when it means
  // "not scrolled to". The profile sheet read 0/3 this way and is actually 3/3.
  const fitFrame = async () => {
    const f = frame(); const r = f.getBoundingClientRect();
    if (r.bottom > innerHeight - 4 || r.top < 4) { window.scrollBy(0, r.bottom - innerHeight + 8); await tick(8); }
    return true;
  };

  const btns = (t) => [...document.querySelectorAll('button')].filter((b) => b.textContent.trim() === t);
  const pick = (t, i = 0) => { const a = btns(t); return a[i] ?? a[a.length - 1]; };

  // ⚠ ORDER MATTERS: device and phase first. In phase "Other" the role buttons are inert, so
  // clicking Viewer before setting the phase silently leaves you on Broadcaster and the
  // whole sweep describes a surface you never opened.
  const setState = async (st) => {
    for (const t of [st.device, st.phase, st.role, st.viewer, st.layout, st.view, st.playback, st.chat]) {
      if (!t) continue;
      const b = (t === 'Live') ? pick('Live', 0) : pick(t);   // "Live" is ambiguous: phase vs pre-live toggle
      if (b) b.click();
      await tick(5);
    }
    await tick(16);
  };

  // ⚠ RESET EVERY OVERLAY, not just sheets. A sheet or a full-page celebration left open by
  // an earlier step reports the NEXT surface's controls as blocked. Three false alarms.
  const reset = async () => {
    const cont = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Continue');
    if (cont) cont.click();
    window.__openSheet?.(null);
    await tick(24);
  };

  // Reach into React for the sheet opener, so every sheet kind can be audited — not just the
  // ones with a button on the surface you happen to be on.
  const findOpenSheet = () => {
    const root = document.querySelector('#root');
    const key = Object.keys(root).find((k) => k.startsWith('__reactContainer'));
    const seen = new Set(); const stack = [root[key]]; let found = null;
    while (stack.length && !found) {
      const n = stack.pop(); if (!n || seen.has(n)) continue; seen.add(n);
      const p = n.memoizedProps;
      if (p && typeof p.onOpenSheet === 'function') found = p.onOpenSheet;
      if (n.child) stack.push(n.child); if (n.sibling) stack.push(n.sibling);
    }
    window.__openSheet = found; return !!found;
  };

  const LIG = /^[a-z][a-z0-9_]*$/;

  /** blocked = present but unreachable · tiny = under 24x24 · unnamed = no accessible name */
  const audit = () => {
    const f = frame();
    const els = [...f.querySelectorAll('button,[role="button"],a[href],[role="switch"]')].filter(vis);
    const tiny = [], unnamed = [], blocked = [];
    for (const e of els) {
      const r = e.getBoundingClientRect(), v = visRect(e);
      if (v.w < 4 || v.h < 4) continue;
      const t = document.elementFromPoint(v.x1 + v.w / 2, v.y1 + v.h / 2);
      if (t && !(t === e || e.contains(t) || t.contains(e))) {
        blocked.push((e.getAttribute('aria-label') || e.textContent.trim().slice(0, 14) || e.tagName) + ' <- ' + t.tagName);
      }
      // ⚠ offsetWidth, NOT getBoundingClientRect: the rect is POST-transform, so a card
      // animating in from scale(0.96) reports 23.04px for a 24px button. Measure after the
      // entry animation settles, and compare the untransformed box.
      if (Math.abs(v.w - r.width) <= 1 && Math.abs(v.h - r.height) <= 1 && Math.min(e.offsetWidth, e.offsetHeight) < 24) {
        // Walk outward: a pseudo-element can widen the hit area without changing the box.
        let u = 0, d = 0, l = 0, ri = 0;
        for (let k = 1; k <= 14; k++) { const x = document.elementFromPoint(r.x + r.width / 2, r.y - k); if (x && (x === e || e.contains(x))) u = k; else break; }
        for (let k = 1; k <= 14; k++) { const x = document.elementFromPoint(r.x + r.width / 2, r.bottom + k); if (x && (x === e || e.contains(x))) d = k; else break; }
        for (let k = 1; k <= 14; k++) { const x = document.elementFromPoint(r.x - k, r.y + r.height / 2); if (x && (x === e || e.contains(x))) l = k; else break; }
        for (let k = 1; k <= 14; k++) { const x = document.elementFromPoint(r.right + k, r.y + r.height / 2); if (x && (x === e || e.contains(x))) ri = k; else break; }
        if (e.offsetWidth + l + ri < 24 || e.offsetHeight + u + d < 24) {
          tiny.push((e.getAttribute('aria-label') || e.textContent.trim().slice(0, 14) || e.tagName).replace(/,.*/, '')
            + '@' + (e.offsetWidth + l + ri) + 'x' + (e.offsetHeight + u + d));
        }
      }
      // ⚠ `title` IS a valid accessible name, and <Icon> is aria-hidden so a ligature is NOT.
      const al = (e.getAttribute('aria-label') || '').trim(), ti = (e.getAttribute('title') || '').trim();
      if (!al && !ti && !e.getAttribute('aria-labelledby')) {
        const img = [...e.querySelectorAll('img')].map((i) => i.getAttribute('alt')).filter(Boolean).join('').trim();
        const own = [...e.querySelectorAll('*')]
          .filter((x) => x.getAttribute('aria-hidden') !== 'true' && !x.classList.contains('material-symbols-outlined') && x.tagName !== 'STYLE')
          .map((x) => [...x.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join('')).join('')
          + [...e.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join('');
        if (!img && (!own.trim() || LIG.test(own.trim()))) unnamed.push(e.querySelector('.material-symbols-outlined')?.textContent.trim() || e.tagName);
      }
    }
    return { blocked: [...new Set(blocked)], tiny: [...new Set(tiny)], unnamed: [...new Set(unnamed)] };
  };

  const rgba = (c) => { const m = (c.match(/[-\d.]+/g) || []).map(Number); return m.length >= 3 ? { r: m[0], g: m[1], b: m[2], a: m.length > 3 ? m[3] : 1 } : null; };
  const lum = (o) => 0.2126 * o.r + 0.7152 * o.g + 0.0722 * o.b;
  const over = (fg, bg) => ({ r: fg.r * fg.a + bg.r * (1 - fg.a), g: fg.g * fg.a + bg.g * (1 - fg.a), b: fg.b * fg.a + bg.b * (1 - fg.a), a: 1 });
  const backdrop = (el) => { for (let p = el.parentElement; p; p = p.parentElement) { const c = rgba(getComputedStyle(p).backgroundColor); if (c && c.a > 0.9) return c; } return { r: 11, g: 11, b: 20, a: 1 }; };

  /** The founder's two standing visual laws, measured rather than grepped. */
  const style = () => {
    const f = frame(); const glass = [], ghost = [], fonts = [];
    for (const el of [...f.querySelectorAll('*')].filter(vis)) {
      const cs = getComputedStyle(el); const r = el.getBoundingClientRect();
      if (r.width < 24 || r.height < 12 || r.width > 1250) continue;
      const bg = rgba(cs.backgroundColor); if (!bg) continue;
      // fake glass: a translucent light wash used as a surface (a full-bleed SCRIM is fine)
      if ((parseFloat(cs.borderTopLeftRadius) || 0) >= 4 && bg.a > 0.015 && bg.a < 0.5 && lum(bg) > 140) {
        glass.push((el.textContent.trim().slice(0, 18) || el.tagName) + ' ' + cs.backgroundColor);
      }
      // ghost outline: a border brighter than the fill it surrounds, once both are composited
      // ⚠ backgroundColor is TRANSPARENT when the fill is a gradient, so a deliberately
      // glossy badge reads as a ring over nothing. Check backgroundImage before believing it.
      const bw = parseFloat(cs.borderTopWidth) || 0;
      if (bw > 0 && cs.backgroundImage === 'none') {
        const bc = rgba(cs.borderTopColor);
        if (bc && bc.a > 0.02) {
          const back = backdrop(el);
          if (lum(over(bc, over(bg, back))) > lum(over(bg, back)) + 3) {
            ghost.push((el.textContent.trim().slice(0, 16) || el.tagName) + ' fill ' + cs.backgroundColor + ' edge ' + cs.borderTopColor);
          }
        }
      }
      if (/Inter/.test(cs.fontFamily)) fonts.push(el.tagName);
    }
    return { glass: [...new Set(glass)], ghost: [...new Set(ghost)], strayFont: [...new Set(fonts)] };
  };

  /** ⚠ CONTRAST AGAINST THE PAINTED BACKDROP. Most of these surfaces sit on video or on a
   *  translucent parent, so reading backgroundColor off the element gives rgba(0,0,0,0) and
   *  every ratio comes out meaningless. */
  const contrast = () => {
    const f = frame(); const out = [];
    const L = (o) => { const g = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * g(o.r) + 0.7152 * g(o.g) + 0.0722 * g(o.b); };
    const ratio = (a, b) => { const l1 = L(a), l2 = L(b); return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05); };
    for (const el of [...f.querySelectorAll('*')].filter(vis)) {
      if (el.children.length) continue;
      const t = (el.textContent || '').trim(); if (t.length < 2) continue;
      if (el.classList.contains('material-symbols-outlined')) continue;
      const cs = getComputedStyle(el); const fg = rgba(cs.color); if (!fg || fg.a < 0.5) continue;
      const size = parseFloat(cs.fontSize), weight = Number(cs.fontWeight) || 400;
      const stack = []; let bg = null;
      for (let p = el; p; p = p.parentElement) { const c = rgba(getComputedStyle(p).backgroundColor); if (c && c.a > 0) { stack.push(c); if (c.a >= 0.999) { bg = c; break; } } }
      if (!bg) bg = { r: 11, g: 11, b: 20, a: 1 };
      let back = bg; for (let i = stack.length - 2; i >= 0; i--) back = over(stack[i], back);
      const r = ratio(over(fg, back), back);
      const floor = (size >= 24 || (size >= 18.66 && weight >= 700)) ? 3 : 4.5;
      if (r < floor) out.push(t.slice(0, 22) + ' ' + Math.round(r * 100) / 100 + ':1 (needs ' + floor + ')');
    }
    return [...new Set(out)];
  };

  /** ⚠⚠ FIRE THE TRANSIENT, LET IT SETTLE, THEN MEASURE. Alerts, ribbons, celebrations,
   *  poll cards and countdown banners all expire, so a plain DOM sweep sees whichever
   *  happens to be up — usually none. This hole hid four defects behind a "finished" audit. */
  const fire = async (name) => {
    const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim().endsWith(name));
    if (!b) return 'no button: ' + name;
    b.click();
    await tick(26);                       // entry animation settles
    return { audit: audit(), style: style() };
  };

  /** No verified/host tick may overlap an avatar. ⚠ An occlusion probe that skips ancestors
   *  cannot see a badge losing to its own wrapper — compare the rects directly. */
  const ticks = () => {
    const f = frame();
    const badges = [...f.querySelectorAll('span,div')].filter(vis).filter((e) => {
      const g = e.querySelector(':scope > .material-symbols-outlined');
      const t = (g?.textContent || '').trim();
      return (t === 'check' || t === 'verified') && e.getBoundingClientRect().width <= 22;
    });
    const imgs = [...f.querySelectorAll('img')].filter(vis).map((i) => i.getBoundingClientRect()).filter((r) => r.width >= 20 && r.width <= 140);
    const hits = [];
    for (const b of badges) { const br = b.getBoundingClientRect();
      for (const r of imgs) {
        const ox = Math.min(br.right, r.right) - Math.max(br.left, r.left);
        const oy = Math.min(br.bottom, r.bottom) - Math.max(br.top, r.top);
        if (ox > 1 && oy > 1) hits.push('tick overlaps an avatar by ' + Math.round(ox) + 'x' + Math.round(oy));
      } }
    return { ticks: badges.length, avatars: imgs.length, overlaps: hits };
  };

  /** 60fps check. ⚠ A HIDDEN TAB FREEZES rAF, so a frozen animation reads as a perfect one.
   *  document.visibilityState must be "visible" or this measures nothing. */
  const perf = async (ms = 4000) => {
    if (document.visibilityState !== 'visible') return 'TAB HIDDEN — rAF is frozen, this would measure nothing';
    const long = []; let po = null;
    try { po = new PerformanceObserver((l) => { for (const e of l.getEntries()) long.push(Math.round(e.duration)); }); po.observe({ entryTypes: ['longtask'] }); } catch { /* not supported */ }
    let frames = 0, last = performance.now(); const gaps = []; const t0 = performance.now();
    await new Promise((res) => { const t = (now) => { frames++; gaps.push(now - last); last = now; if (now - t0 < ms) requestAnimationFrame(t); else res(); }; requestAnimationFrame(t); });
    const dur = performance.now() - t0; gaps.shift(); gaps.sort((a, b) => a - b);
    const p = (q) => Math.round(gaps[Math.floor(gaps.length * q)] * 10) / 10;
    if (po) po.disconnect();
    return { fps: Math.round(frames / (dur / 1000)), p50: p(0.5), p90: p(0.9), p99: p(0.99), longTasks: long.filter((d) => d >= 50), dropped: gaps.filter((g) => g > 33).length };
  };


  /** ⚠⚠ THE PROBE CLASS EVERY OTHER ONE IN THIS FILE IS MISSING.
   *  Added 2026-09-04. Ten surfaces and seventeen sheets had just been reported clean
   *  by every probe above, and the founder then found three defects by LOOKING at the
   *  screen: a co-host grid drawing one video instead of two, oversized panel tiles,
   *  and a PiP that rendered nothing.
   *
   *  None of the probes above could see any of it, because they all ask the same kind of
   *  question: "is there something BAD in what is rendered?". A missing tile is CLEAN on
   *  contrast, tap targets, occlusion and outlines. An ABSENCE generates no evidence.
   *
   *  expect() asks the other question. Declare what a surface MUST contain and an
   *  absence FAILS instead of staying silent.
   *
   *    __A.expect({ minStageVideos: 2, mustShowText: ['HOST', 'CO-HOST'],
   *                 maxTileHeightPct: 70 })
   */
  const stageVideos = () => {
    const f = frame(); const fr = f.getBoundingClientRect();
    return [...f.querySelectorAll('video')].filter(vis).map((v) => {
      const r = v.getBoundingClientRect();
      return { w: Math.round(r.width), h: Math.round(r.height),
        pctW: +(r.width / fr.width * 100).toFixed(1), pctH: +(r.height / fr.height * 100).toFixed(1) };
    });
  };
  const textPresent = (t) => [...frame().querySelectorAll('*')]
    .some((e) => vis(e) && e.children.length === 0 && (e.textContent || '').trim() === t);
  const expect = (spec) => {
    const fails = []; const vids = stageVideos();
    if (spec.minStageVideos !== undefined && vids.length < spec.minStageVideos)
      fails.push(`expected >=${spec.minStageVideos} stage videos, found ${vids.length}`);
    for (const t of (spec.mustShowText || [])) if (!textPresent(t)) fails.push(`missing text "${t}"`);
    for (const t of (spec.mustNotShowText || [])) if (textPresent(t)) fails.push(`unexpected text "${t}"`);
    if (spec.maxTileHeightPct !== undefined) {
      const small = vids.filter((v) => v.pctW < 60);
      // ⚠ AN EMPTY MEASUREMENT IS NOT A PASS. The first version of this check found zero
      // guest tiles and "passed" — it had simply failed to enter Panel mode, which needs
      // Co-host selected first. Say so instead of going quiet.
      if (!small.length) fails.push('VACUOUS: no guest tiles were measured — is the layout actually applied?');
      else {
        const stack = small.reduce((a, v) => a + v.pctH, 0);
        if (stack > spec.maxTileHeightPct)
          fails.push(`guest tiles fill ${stack.toFixed(0)}% of the stage height, over the ${spec.maxTileHeightPct}% bound`);
      }
    }
    return fails;
  };

  /** ⚠ A HANDLER EXISTING IS NOT THE CONTROL WORKING.
   *  audit() only ever checked that a control HAS an onClick. The Game+cam / Camera only
   *  toggle had one, and could not reach the component it was meant to drive because the
   *  `scene` prop was never passed to it — so it changed nothing for five deploys.
   *  flip() presses the control and asserts the screen actually changed.
   *  ⚠ Uses REAL time, not tick(): tick() yields microtasks and would measure the surface
   *  mid-animation. The tab must be visible or the timeline is frozen.
   */
  const flip = async (label, settle = 800) => {
    if (document.visibilityState !== 'visible') return 'TAB HIDDEN — animations frozen, this measures nothing';
    const b = pick(label); if (!b) return 'NO BUTTON: ' + label;
    const f = frame();
    const sig = () => f.innerText.replace(/\s+/g, ' ').slice(0, 900)
      + '||' + stageVideos().map((v) => v.w + 'x' + v.h).join(',');
    const before = sig();
    b.click();
    await new Promise((r) => setTimeout(r, settle));
    return before === sig() ? 'NO VISIBLE CHANGE — this control is dead even though it has a handler' : 'changed';
  };
  findOpenSheet();
  return { tick, vis, visRect, frame, fitFrame, setState, reset, audit, style, contrast, fire, ticks, perf, pick, findOpenSheet, expect, flip, stageVideos, textPresent };
})();
'audit harness ready — see docs/AUDIT_RULES.md';
