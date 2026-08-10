// DesktopUpdateGate — Steam-style pre-launch updater for the Tauri desktop app.
//
// The desktop .exe does not hot-reload like the web app: a new build only takes
// effect after the signed installer is downloaded + applied + the app
// relaunches. This gate runs BEFORE the app renders (desktop only): it shrinks
// the window to a compact, undecorated updater frame and checks for a newer
// signed build, then walks the user through:
//   checking → update available → downloading → installing → (relaunch)
//   (error)  → retry / continue anyway
// REQUIRED updates (flagged in the release notes) hide "Later". When there's
// nothing to do it expands straight into the full app window.
//
// Everywhere else (browser, PWA, native Android) this is a pure pass-through:
// it renders children on the first frame and never runs the check, never
// touches the window.
//
// Visual design © Claude Design (VERGR Updater.dc.html): animated particle-mesh
// + orb background, hero progress bar, brand violet→pink palette. The metrics
// shown while downloading (percent, MB, speed, ETA) are REAL — fed by the
// Tauri updater's byte-progress events, not simulated.

import { useState, useEffect, useRef } from 'react';
import { isDesktopApp } from '../utils/platform';
import { checkDesktopUpdate, applyDesktopUpdate, isUpdateRequired } from '../utils/tauriUpdater';
import { APP_VERSION } from '../utils/appVersion';

const SNOOZE_KEY = 'vergr_update_snooze_until';
const SNOOZE_MS = 6 * 60 * 60 * 1000;   // re-prompt at most every 6h for optional updates
const CHECK_TIMEOUT_MS = 4000;          // never block boot more than this on a slow endpoint
const MANIFEST_URL = 'https://vergr.app/downloads/latest.json'; // display-only size lookup

// Compact updater window (matches the 600×800 design). Real values are filled
// from tauri.conf.json for the restore step so we land back on the app default.
const UPDATER_W = 600;
const UPDATER_H = 800;
const APP_W = 1280;
const APP_H = 860;
const APP_MIN_W = 960;
const APP_MIN_H = 640;

// ── window control (best-effort; a permission gap must never trap the user) ──
// The window starts HIDDEN (tauri.conf `visible: false`). We size it FIRST and
// only `reveal` it once the right UI has painted — so there's never a blank or
// wrong-sized window flash, and the updater appears as its own compact frame
// "before" the app (the app tree isn't mounted until phase === 'ready').
async function withWindow(fn, label) {
  try {
    const { getCurrentWindow, LogicalSize } = await import('@tauri-apps/api/window');
    await fn(getCurrentWindow(), LogicalSize);
  } catch (e) { console.warn(`[updater] ${label} skipped:`, e?.message || e); }
}
async function shapeUpdaterWindow() {
  if (!isDesktopApp()) return;
  await withWindow(async (w, LogicalSize) => {
    await w.setResizable(false);
    await w.setDecorations(false);
    await w.setMinSize(new LogicalSize(UPDATER_W, UPDATER_H));
    await w.setSize(new LogicalSize(UPDATER_W, UPDATER_H));
    await w.center();
  }, 'shape updater');
}
async function shapeAppWindow() {
  if (!isDesktopApp()) return;
  await withWindow(async (w, LogicalSize) => {
    await w.setMinSize(new LogicalSize(APP_MIN_W, APP_MIN_H));
    await w.setSize(new LogicalSize(APP_W, APP_H));
    await w.setResizable(true);
    await w.setDecorations(true);
    await w.center();
  }, 'shape app');
}
// Reveal is NOT gated on desktop: on the native mobile shell the window also
// starts hidden, so we must show it there too (no-op/caught in the browser).
async function revealWindow() {
  await withWindow(async (w) => { await w.show(); await w.setFocus(); }, 'reveal');
}
async function closeUpdaterWindow() {
  await withWindow(async (w) => { await w.close(); }, 'close');
}

// Best-effort installer size (bytes) for the "update available" screen, before
// the signed download starts. Display only — the trusted path is the updater.
async function fetchInstallerSize() {
  try {
    const r = await fetch(`${MANIFEST_URL}?t=${Date.now()}`, { cache: 'no-store' });
    if (!r.ok) return 0;
    const j = await r.json();
    return Number(j?.size) || 0;
  } catch { return 0; }
}

// Turn the manifest notes (update.body) into changelog bullet lines. Strips a
// leading [REQUIRED]/REQUIRED: token and common bullet glyphs.
function parseChangelog(body) {
  const raw = String(body || '').replace(/^\s*(\[required\]|required:)\s*/i, '');
  const lines = raw
    .split(/\r?\n/)
    .map((l) => l.replace(/^\s*[•\-*]\s*/, '').trim())
    .filter(Boolean);
  return lines.length ? lines : ['Performance improvements, fixes and the latest VERGR features.'];
}

export default function DesktopUpdateGate({ children }) {
  // booting: window hidden, deciding. ready: render the app. else: updater UI.
  const [phase, setPhase] = useState(isDesktopApp() ? 'booting' : 'ready'); // booting|checking|prompt|downloading|installing|error|ready
  const [update, setUpdate] = useState(null);
  const [required, setRequired] = useState(false);
  const [sizeBytes, setSizeBytes] = useState(0);
  const [errorReason, setErrorReason] = useState('Could not reach the update server. Check your connection and try again.');

  // Live download refs (updated imperatively to keep the bar smooth without re-renders).
  const liveRefs = {
    barFill: useRef(null), cap: useRef(null), percent: useRef(null),
    dl: useRef(null), speed: useRef(null), eta: useRef(null),
    instFill: useRef(null), instPct: useRef(null), instStep: useRef(null),
  };
  const dl = useRef({ total: 0, done: 0, lastT: 0, lastDone: 0, speed: 0 });

  // Reveal the window only after the chosen UI has had a frame to paint, so the
  // window never appears blank or at the wrong size.
  const revealAfterPaint = () => requestAnimationFrame(() => requestAnimationFrame(() => { revealWindow(); }));

  // Hand off into the real app (no update / Later / continue): grow to the app
  // window, mount the app, then reveal — so the app's own loading screen is what
  // appears, never a blank or updater-sized window, and never a checking flash.
  const goToApp = async () => { await shapeAppWindow(); setPhase('ready'); revealAfterPaint(); };

  useEffect(() => {
    if (!isDesktopApp()) { revealWindow(); return; } // mobile shell: just show; browser: no-op
    let cancelled = false;
    let decided = false;
    fetchInstallerSize().then((b) => { if (!cancelled && b) setSizeBytes(b); });

    // Only surface a branded "checking" window if the check is genuinely slow.
    // A fast check (the common case) goes straight to app/prompt with NO flash.
    const slow = setTimeout(async () => {
      if (cancelled || decided) return;
      await shapeUpdaterWindow();
      setPhase('checking');
      revealAfterPaint();
    }, 900);

    const timeout = new Promise((resolve) => setTimeout(() => resolve('timeout'), CHECK_TIMEOUT_MS));
    Promise.race([checkDesktopUpdate(), timeout]).then(async (u) => {
      if (cancelled) return;
      decided = true;
      clearTimeout(slow);
      try {
        if (!u || u === 'timeout') { await goToApp(); return; }
        const req = isUpdateRequired(u);
        if (!req) {
          let snoozed = false;
          try { const until = Number(localStorage.getItem(SNOOZE_KEY) || 0); snoozed = !!until && Date.now() < until; } catch { /* storage blocked: prompt */ }
          if (snoozed) { await goToApp(); return; }
        }
        setUpdate(u);
        setRequired(req);
        await shapeUpdaterWindow();
        setPhase('prompt');
        revealAfterPaint();
      } catch (e) {
        console.warn('[updater] decision failed:', e?.message || e);
        await goToApp();
      }
    });
    return () => { cancelled = true; clearTimeout(slow); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onUpdate = async () => {
    setPhase('downloading');
    dl.current = { total: sizeBytes || 0, done: 0, lastT: performance.now(), lastDone: 0, speed: 0 };
    try {
      await applyDesktopUpdate(update, (ev) => {
        const s = dl.current;
        if (ev?.event === 'Started') {
          s.total = ev.data?.contentLength || sizeBytes || 0;
          s.done = 0; s.lastT = performance.now(); s.lastDone = 0; s.speed = 0;
          paintDownload();
        } else if (ev?.event === 'Progress') {
          s.done += ev.data?.chunkLength || 0;
          const now = performance.now();
          if (now - s.lastT >= 220) {
            const inst = (s.done - s.lastDone) / ((now - s.lastT) / 1000) / 1_048_576; // MB/s
            s.speed = s.speed ? s.speed + (inst - s.speed) * 0.4 : inst;
            s.lastT = now; s.lastDone = s.done;
          }
          paintDownload();
        } else if (ev?.event === 'Finished') {
          paintDownload(100);
          setPhase('installing');
        }
      });
      // applyDesktopUpdate relaunches on success; if it returns, fall through.
    } catch (e) {
      console.warn('[updater] install failed:', e?.message || e);
      setErrorReason(humanError(e));
      setPhase('error');
    }
  };

  // Paint live download numbers straight to the DOM (no setState churn).
  const paintDownload = (forcePct) => {
    const s = dl.current;
    const pct = forcePct != null ? forcePct : (s.total ? Math.min(100, (s.done / s.total) * 100) : 0);
    const totalMB = (s.total || 0) / 1_048_576;
    const doneMB = forcePct === 100 ? totalMB : (s.done || 0) / 1_048_576;
    const eta = s.speed > 0.05 && s.total ? Math.max(0, (totalMB - doneMB) / s.speed) : 0;
    if (liveRefs.barFill.current) liveRefs.barFill.current.style.width = `${Math.max(2, pct)}%`;
    if (liveRefs.cap.current) liveRefs.cap.current.style.left = `${Math.max(2, pct)}%`;
    if (liveRefs.percent.current) liveRefs.percent.current.textContent = String(Math.round(pct));
    if (liveRefs.dl.current) liveRefs.dl.current.textContent = totalMB ? `${doneMB.toFixed(1)} / ${totalMB.toFixed(0)} MB` : `${doneMB.toFixed(1)} MB`;
    if (liveRefs.speed.current) liveRefs.speed.current.textContent = `${s.speed.toFixed(1)} MB/s`;
    if (liveRefs.eta.current) liveRefs.eta.current.textContent = fmtEta(eta);
  };

  const onLater = () => {
    try { localStorage.setItem(SNOOZE_KEY, String(Date.now() + SNOOZE_MS)); } catch { /* ignore */ }
    goToApp();
  };

  if (phase === 'ready') return children;
  if (phase === 'booting') return null; // window hidden; nothing to paint until we decide

  return (
    <UpdateSplash
      phase={phase}
      currentVersion={APP_VERSION}
      newVersion={update?.version}
      changelog={parseChangelog(update?.body)}
      sizeBytes={sizeBytes}
      required={required}
      errorReason={errorReason}
      liveRefs={liveRefs}
      onUpdate={onUpdate}
      onLater={onLater}
      onRetry={onUpdate}
      onContinue={goToApp}
      onClose={required ? null : closeUpdaterWindow}
    />
  );
}

function fmtEta(s) {
  s = Math.max(0, Math.round(s));
  if (s >= 60) { const m = Math.floor(s / 60); return `${m}m ${String(s % 60).padStart(2, '0')}s`; }
  return `${s}s`;
}
function humanError(e) {
  const m = (e?.message || String(e || '')).toLowerCase();
  if (m.includes('network') || m.includes('fetch') || m.includes('connect') || m.includes('dns')) {
    return 'Could not reach the update server. Check your connection and try again.';
  }
  if (m.includes('signature') || m.includes('verify')) {
    return 'The update could not be verified. We blocked it to keep you safe — please try again.';
  }
  return 'Something went wrong while installing the update. You can retry or continue on this version.';
}

// ── the splash ───────────────────────────────────────────────────────────────
function UpdateSplash({
  phase, currentVersion, newVersion, changelog, sizeBytes, required,
  errorReason, liveRefs, onUpdate, onLater, onRetry, onContinue, onClose,
}) {
  const canvasRef = useRef(null);
  const instRaf = useRef(0);
  const sizeLabel = sizeBytes ? `${(sizeBytes / 1_048_576).toFixed(0)} MB` : '';

  // particle-mesh canvas background (runs the whole time the splash is up)
  useEffect(() => {
    const cv = canvasRef.current; if (!cv) return;
    const ctx = cv.getContext('2d');
    let W = 1, H = 1, dpr = 1, raf = 0, lt = 0;
    const resize = () => {
      dpr = Math.min(2, window.devicePixelRatio || 1);
      const r = cv.getBoundingClientRect();
      W = r.width || UPDATER_W; H = r.height || UPDATER_H;
      cv.width = W * dpr; cv.height = H * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    const ro = new ResizeObserver(resize); ro.observe(cv);
    const colors = ['#B44FFF', '#C87FFF', '#7B1FFF', '#3D7FFF'];
    const N = 42, LINK = 132;
    const nodes = Array.from({ length: N }, () => ({
      x: Math.random() * W, y: Math.random() * H,
      vx: (Math.random() - 0.5) * 16, vy: (Math.random() - 0.5) * 16,
      r: 1.1 + Math.random() * 2.1, c: colors[(Math.random() * colors.length) | 0], ph: Math.random() * Math.PI * 2,
    }));
    const draw = (t) => {
      const dt = Math.min(0.05, lt ? (t - lt) / 1000 : 0); lt = t;
      ctx.clearRect(0, 0, W, H);
      for (const n of nodes) {
        n.x += n.vx * dt; n.y += n.vy * dt;
        if (n.x < -20) n.x = W + 20; else if (n.x > W + 20) n.x = -20;
        if (n.y < -20) n.y = H + 20; else if (n.y > H + 20) n.y = -20;
      }
      for (let i = 0; i < N; i++) {
        for (let j = i + 1; j < N; j++) {
          const a = nodes[i], b = nodes[j];
          const d = Math.hypot(a.x - b.x, a.y - b.y);
          if (d < LINK) {
            ctx.globalAlpha = (1 - d / LINK) * 0.16; ctx.strokeStyle = '#B44FFF'; ctx.lineWidth = 1;
            ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
          }
        }
      }
      for (const n of nodes) {
        ctx.globalAlpha = 0.5 * (0.55 + 0.45 * Math.sin(t / 700 + n.ph));
        ctx.fillStyle = n.c; ctx.shadowColor = n.c; ctx.shadowBlur = 9;
        ctx.beginPath(); ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2); ctx.fill();
      }
      ctx.globalAlpha = 1; ctx.shadowBlur = 0;
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); };
  }, []);

  // installing screen: indeterminate ramp (the OS install step has no real %),
  // capped under 100 so it never claims completion before the relaunch.
  useEffect(() => {
    if (phase !== 'installing') return;
    let p = 0, last = 0;
    const tick = (t) => {
      const dt = Math.min(0.05, last ? (t - last) / 1000 : 0); last = t;
      p += (p > 90 ? 5 : 16) * dt; if (p > 96) p = 96;
      const { instFill, instPct, instStep } = liveRefs;
      if (instFill.current) instFill.current.style.width = `${p}%`;
      if (instPct.current) instPct.current.textContent = `${Math.round(p)}%`;
      if (instStep.current) instStep.current.textContent = p < 34 ? 'Verifying package' : p < 70 ? 'Replacing files' : p < 92 ? 'Updating libraries' : 'Finalizing';
      instRaf.current = requestAnimationFrame(tick);
    };
    instRaf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(instRaf.current);
  }, [phase, liveRefs]);

  const V = {
    base: '#0B0B14', surface: '#14141F', surface2: '#1A1A2A', violet: '#7B1FFF',
    violetLight: '#B44FFF', pink: '#C87FFF', gold: '#F0A500', ember: '#F04060',
    blue: '#3D7FFF', text2: '#9CA3AF', muted: '#6B7280',
  };
  const grad = 'linear-gradient(100deg,#7B1FFF,#B44FFF 56%,#C87FFF)';
  const barGrad = 'linear-gradient(90deg,#7B1FFF,#B44FFF 62%,#C87FFF)';

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 99999, overflow: 'hidden',
      display: 'flex', flexDirection: 'column', fontFamily: "'DM Sans',sans-serif", color: '#fff',
      background: 'radial-gradient(130% 120% at 50% 0%,#15152400 0%,#07070d 62%,#050509 100%),#060609',
    }}>
      <Keyframes />
      <canvas ref={canvasRef} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', zIndex: 0, pointerEvents: 'none' }} />
      {/* animated orbs + scanline */}
      <div style={{ position: 'absolute', inset: 0, zIndex: 0, pointerEvents: 'none', overflow: 'hidden' }}>
        <div style={{ position: 'absolute', top: '-32%', left: '-26%', width: 560, height: 560, borderRadius: '50%', background: 'radial-gradient(circle,rgba(123,31,255,.55),transparent 65%)', filter: 'blur(42px)', animation: 'vg-orb1 17s ease-in-out infinite' }} />
        <div style={{ position: 'absolute', bottom: '-32%', right: '-26%', width: 600, height: 600, borderRadius: '50%', background: 'radial-gradient(circle,rgba(200,127,255,.42),transparent 66%)', filter: 'blur(50px)', animation: 'vg-orb2 21s ease-in-out infinite' }} />
        <div style={{ position: 'absolute', top: '34%', right: '-12%', width: 340, height: 340, borderRadius: '50%', background: 'radial-gradient(circle,rgba(61,127,255,.16),transparent 66%)', filter: 'blur(44px)', animation: 'vg-orb1 26s ease-in-out infinite reverse' }} />
        <div style={{ position: 'absolute', left: 0, right: 0, top: 0, height: 200, background: 'linear-gradient(180deg,transparent,rgba(180,79,255,.05),transparent)', animation: 'vg-scan 8.5s linear infinite' }} />
        <div style={{ position: 'absolute', inset: 0, background: 'radial-gradient(135% 100% at 50% 0%,transparent 52%,rgba(0,0,0,.58) 100%)' }} />
        <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 1, background: 'linear-gradient(90deg,transparent,rgba(255,255,255,.2),transparent)' }} />
      </div>

      <div style={{ position: 'relative', zIndex: 2, display: 'flex', flexDirection: 'column', height: '100%' }}>
        {/* custom titlebar (draggable) */}
        <div data-tauri-drag-region style={{ height: 46, flex: 'none', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 12px 0 16px', borderBottom: '1px solid rgba(255,255,255,.05)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 9, pointerEvents: 'none' }}>
            <img src="/brand/logo.png" alt="" style={{ width: 18, height: 18, borderRadius: 5 }} />
            <span style={{ fontFamily: "'Syne',sans-serif", fontWeight: 700, fontSize: 13, letterSpacing: '.16em' }}>VERGR</span>
            <span style={{ fontSize: 11, color: V.muted, letterSpacing: '.04em' }}>Updater</span>
          </div>
          {onClose && (
            <div onClick={onClose} title="Close" style={{ width: 30, height: 26, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 7, color: V.text2, cursor: 'pointer', fontSize: 14 }}
              onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(240,64,96,.85)'; e.currentTarget.style.color = '#fff'; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = V.text2; }}>✕</div>
          )}
        </div>

        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: '30px 34px 32px', minHeight: 0 }}>
          {/* brand row */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 24, flex: 'none' }}>
            <img src="/brand/logo.png" alt="" style={{ width: 52, height: 52, borderRadius: 14, animation: 'vg-logoglow 4s ease-in-out infinite', flex: 'none' }} />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              <div style={{ fontFamily: "'Syne',sans-serif", fontWeight: 800, fontSize: 20, color: '#fff', lineHeight: 1 }}>VERGR</div>
              <div style={{ fontSize: 12.5, color: V.text2 }}>Social gaming platform</div>
            </div>
            <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 7, padding: '6px 11px', borderRadius: 999, background: 'rgba(255,255,255,.04)', border: '1px solid rgba(255,255,255,.07)' }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: V.violetLight, boxShadow: `0 0 8px ${V.violetLight}` }} />
              <span style={{ fontFamily: "'DM Mono',monospace", fontSize: 11.5, color: V.text2, fontVariantNumeric: 'tabular-nums' }}>v{currentVersion}</span>
            </div>
          </div>

          {phase === 'checking' && (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', minHeight: 0 }}>
              <div style={{ position: 'relative', width: 122, height: 122, marginBottom: 32 }}>
                <div style={{ position: 'absolute', inset: 0, borderRadius: '50%', border: '1.5px solid rgba(180,79,255,.16)' }} />
                <div style={{ position: 'absolute', inset: -6, borderRadius: '50%', border: '2px solid transparent', borderTopColor: V.violetLight, borderRightColor: V.pink, animation: 'vg-spin 1.05s linear infinite' }} />
                <div style={{ position: 'absolute', inset: 16, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'radial-gradient(circle,rgba(123,31,255,.28),transparent 70%)' }}>
                  <img src="/brand/logo.png" alt="" style={{ width: 56, height: 56, borderRadius: 15, animation: 'vg-floaty 3s ease-in-out infinite' }} />
                </div>
              </div>
              <div style={{ fontFamily: "'Syne',sans-serif", fontWeight: 700, fontSize: 27, letterSpacing: '-.01em' }}>
                Checking for updates<Dots />
              </div>
              <div style={{ fontSize: 14, color: V.text2, marginTop: 11, maxWidth: 300, lineHeight: 1.5 }}>Making sure you're on the latest build before you jump back in.</div>
              <div style={{ position: 'relative', width: 240, height: 4, borderRadius: 999, background: 'rgba(255,255,255,.07)', overflow: 'hidden', marginTop: 28 }}>
                <div style={{ position: 'absolute', top: 0, height: '100%', width: '38%', borderRadius: 999, background: grad, boxShadow: '0 0 12px rgba(180,79,255,.7)', animation: 'vg-comet 1.4s ease-in-out infinite' }} />
              </div>
            </div>
          )}

          {phase === 'prompt' && (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
              <div style={{ fontFamily: "'Syne',sans-serif", fontWeight: 800, fontSize: 29, letterSpacing: '-.02em', lineHeight: 1.08 }}>A new update is<br />ready to install</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 20, flex: 'none' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontFamily: "'DM Mono',monospace", fontSize: 14, fontVariantNumeric: 'tabular-nums' }}>
                  <span style={{ color: V.muted }}>{currentVersion}</span>
                  <span style={{ color: V.violetLight, fontSize: 16 }}>→</span>
                  <span style={{ color: '#fff', fontWeight: 500, padding: '4px 11px', borderRadius: 8, background: 'rgba(123,31,255,.16)', border: '1px solid rgba(180,79,255,.32)' }}>{newVersion}</span>
                </div>
                {sizeLabel && <div style={{ marginLeft: 'auto', fontFamily: "'DM Mono',monospace", fontSize: 12.5, color: V.text2, padding: '5px 11px', borderRadius: 999, background: 'rgba(255,255,255,.04)', border: '1px solid rgba(255,255,255,.07)' }}>{sizeLabel}</div>}
              </div>
              <div style={{ fontFamily: "'Syne',sans-serif", fontWeight: 600, fontSize: 12, letterSpacing: '.14em', textTransform: 'uppercase', color: V.text2, margin: '24px 0 13px', flex: 'none' }}>What's new</div>
              <ul style={{ listStyle: 'none', margin: 0, padding: '0 6px 0 0', display: 'flex', flexDirection: 'column', gap: 12, overflowY: 'auto', flex: 1, minHeight: 0 }}>
                {changelog.map((line, i) => (
                  <li key={i} style={{ display: 'flex', gap: 11, alignItems: 'flex-start', fontSize: 13.5, lineHeight: 1.45, color: '#D7D9E0' }}>
                    <span style={{ flex: 'none', width: 6, height: 6, borderRadius: 2, marginTop: 6, background: grad, boxShadow: '0 0 8px rgba(180,79,255,.6)' }} />
                    <span>{line}</span>
                  </li>
                ))}
              </ul>
              <div style={{ display: 'flex', gap: 12, marginTop: 22, flex: 'none' }}>
                <BtnPrimary onClick={onUpdate} grad={grad}>Update now</BtnPrimary>
                {!required && <BtnGhost onClick={onLater} text2={V.text2}>Later</BtnGhost>}
              </div>
            </div>
          )}

          {phase === 'downloading' && (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
              <div style={{ fontFamily: "'Syne',sans-serif", fontWeight: 800, fontSize: 26, letterSpacing: '-.01em', flex: 'none' }}>Downloading update</div>
              <div style={{ fontSize: 13.5, color: V.text2, marginTop: 7, flex: 'none' }}>Grabbing <span style={{ fontFamily: "'DM Mono',monospace", color: V.violetLight }}>{newVersion}</span> — hang tight, you'll be in shortly.</div>
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', minHeight: 0 }}>
                <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'center', gap: 3, marginBottom: 28 }}>
                  <span ref={liveRefs.percent} style={{ fontFamily: "'DM Mono',monospace", fontWeight: 500, fontSize: 90, lineHeight: 0.9, fontVariantNumeric: 'tabular-nums', letterSpacing: '-.04em', textShadow: '0 0 44px rgba(180,79,255,.55)' }}>0</span>
                  <span style={{ fontFamily: "'DM Mono',monospace", fontSize: 34, color: V.violetLight, marginBottom: 9 }}>%</span>
                </div>
                <div style={{ position: 'relative', height: 18, borderRadius: 999, background: 'rgba(255,255,255,.05)', boxShadow: 'inset 0 1px 4px rgba(0,0,0,.65),inset 0 0 0 1px rgba(255,255,255,.05)' }}>
                  <div ref={liveRefs.barFill} style={{ position: 'absolute', left: 0, top: 0, height: '100%', width: '2%', minWidth: 18, borderRadius: 999, overflow: 'hidden', background: barGrad, boxShadow: '0 0 16px rgba(180,79,255,.65),inset 0 1px 0 rgba(255,255,255,.3)' }}>
                    <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(100deg,transparent 38%,rgba(255,255,255,.5) 50%,transparent 62%)', animation: 'vg-shine 1.8s ease-in-out infinite' }} />
                  </div>
                  <div ref={liveRefs.cap} style={{ position: 'absolute', top: '50%', left: '2%', width: 4, height: 26, borderRadius: 3, transform: 'translate(-50%,-50%)', background: '#fff', animation: 'vg-cappulse 1.2s ease-in-out infinite' }} />
                </div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 18, fontFamily: "'DM Mono',monospace", fontVariantNumeric: 'tabular-nums' }}>
                  <span ref={liveRefs.dl} style={{ fontSize: 14, color: '#fff' }}>0.0 MB</span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: V.text2 }}><span style={{ width: 6, height: 6, borderRadius: '50%', background: V.violetLight, boxShadow: `0 0 8px ${V.violetLight}` }} /><span ref={liveRefs.speed}>0.0 MB/s</span></span>
                    <span style={{ fontSize: 13, color: V.muted }}>ETA <span ref={liveRefs.eta} style={{ color: V.text2 }}>—</span></span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {phase === 'installing' && (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', textAlign: 'center', minHeight: 0 }}>
              <div style={{ position: 'relative', width: 128, height: 128, marginBottom: 30, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <div style={{ position: 'absolute', inset: 0, borderRadius: '50%', background: 'radial-gradient(circle,rgba(123,31,255,.4),transparent 68%)', animation: 'vg-instpulse 1.8s ease-in-out infinite' }} />
                <div style={{ position: 'absolute', inset: 6, borderRadius: '50%', border: '1.5px solid rgba(180,79,255,.2)' }} />
                <div style={{ position: 'absolute', inset: 6, borderRadius: '50%', border: '2px solid transparent', borderTopColor: V.violetLight, borderRightColor: V.pink, animation: 'vg-spin 1.4s linear infinite' }} />
                <img src="/brand/logo.png" alt="" style={{ position: 'relative', width: 64, height: 64, borderRadius: 17, animation: 'vg-floaty 3s ease-in-out infinite', filter: 'drop-shadow(0 0 22px rgba(180,79,255,.7))' }} />
              </div>
              <div style={{ fontFamily: "'Syne',sans-serif", fontWeight: 800, fontSize: 28 }}>Installing update<Dots /></div>
              <div style={{ fontSize: 14, color: V.text2, marginTop: 12, maxWidth: 330, lineHeight: 1.55 }}>Applying <span style={{ fontFamily: "'DM Mono',monospace", color: V.violetLight }}>{newVersion}</span>. VERGR will restart automatically when it's done.</div>
              <div style={{ width: '100%', display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginTop: 34, marginBottom: 11 }}>
                <span ref={liveRefs.instStep} style={{ fontFamily: "'DM Sans',sans-serif", fontSize: 13, fontWeight: 600, color: V.text2 }}>Verifying package</span>
                <span ref={liveRefs.instPct} style={{ fontFamily: "'DM Mono',monospace", fontSize: 13, color: '#fff', fontVariantNumeric: 'tabular-nums' }}>0%</span>
              </div>
              <div style={{ width: '100%', height: 14, borderRadius: 999, background: 'rgba(255,255,255,.05)', boxShadow: 'inset 0 1px 4px rgba(0,0,0,.65),inset 0 0 0 1px rgba(255,255,255,.05)' }}>
                <div ref={liveRefs.instFill} style={{ height: '100%', width: '0%', minWidth: 14, borderRadius: 999, position: 'relative', overflow: 'hidden', background: barGrad, boxShadow: '0 0 16px rgba(180,79,255,.65),inset 0 1px 0 rgba(255,255,255,.3)' }}>
                  <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(100deg,transparent 38%,rgba(255,255,255,.5) 50%,transparent 62%)', animation: 'vg-shine 1.8s ease-in-out infinite' }} />
                </div>
              </div>
              <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 11, color: V.muted, marginTop: 18, letterSpacing: '.12em' }}>DO NOT CLOSE THIS WINDOW</div>
            </div>
          )}

          {phase === 'error' && (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', flex: 1, justifyContent: 'center', minHeight: 0 }}>
                <div style={{ width: 84, height: 84, borderRadius: 24, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'radial-gradient(circle,rgba(240,64,96,.24),rgba(20,20,31,.5))', border: '1px solid rgba(240,64,96,.4)', animation: 'vg-errpulse 2s ease-in-out infinite', marginBottom: 26 }}>
                  <span style={{ fontFamily: "'Syne',sans-serif", fontWeight: 800, fontSize: 46, color: V.ember, lineHeight: 1 }}>!</span>
                </div>
                <div style={{ fontFamily: "'Syne',sans-serif", fontWeight: 800, fontSize: 28 }}>Update failed</div>
                <div style={{ fontSize: 14, color: V.text2, marginTop: 12, maxWidth: 340, lineHeight: 1.55 }}>{errorReason}</div>
                <div style={{ fontFamily: "'DM Mono',monospace", fontSize: 11.5, color: V.muted, marginTop: 18, padding: '6px 12px', borderRadius: 8, background: 'rgba(240,64,96,.08)', border: '1px solid rgba(240,64,96,.18)' }}>ERR_UPDATE_DOWNLOAD · v{newVersion}</div>
              </div>
              <div style={{ display: 'flex', gap: 12, flex: 'none' }}>
                <BtnPrimary onClick={onRetry} grad={grad}>Retry</BtnPrimary>
                <BtnGhost onClick={onContinue} text2={V.text2}>Continue anyway</BtnGhost>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Dots() {
  return (
    <>
      <span style={{ animation: 'vg-dots 1.4s infinite' }}>.</span>
      <span style={{ animation: 'vg-dots 1.4s infinite .2s' }}>.</span>
      <span style={{ animation: 'vg-dots 1.4s infinite .4s' }}>.</span>
    </>
  );
}
function BtnPrimary({ onClick, grad, children }) {
  return (
    <button type="button" onClick={onClick}
      style={{ flex: 1, border: 'none', cursor: 'pointer', fontFamily: "'DM Sans',sans-serif", fontWeight: 700, fontSize: 15, color: '#fff', padding: 15, borderRadius: 13, background: grad, boxShadow: '0 12px 32px -8px rgba(123,31,255,.6),inset 0 1px 0 rgba(255,255,255,.25)' }}
      onMouseEnter={(e) => { e.currentTarget.style.filter = 'brightness(1.08)'; }}
      onMouseLeave={(e) => { e.currentTarget.style.filter = 'none'; }}>{children}</button>
  );
}
function BtnGhost({ onClick, text2, children }) {
  return (
    <button type="button" onClick={onClick}
      style={{ flex: 'none', border: '1px solid rgba(255,255,255,.12)', cursor: 'pointer', fontFamily: "'DM Sans',sans-serif", fontWeight: 600, fontSize: 15, color: text2, padding: '15px 22px', borderRadius: 13, background: 'transparent' }}
      onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,.05)'; e.currentTarget.style.color = '#fff'; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = text2; }}>{children}</button>
  );
}
function Keyframes() {
  return (
    <style>{`
@keyframes vg-orb1{0%{transform:translate(-10%,-10%) scale(1)}50%{transform:translate(15%,12%) scale(1.18)}100%{transform:translate(-10%,-10%) scale(1)}}
@keyframes vg-orb2{0%{transform:translate(10%,12%) scale(1.12)}50%{transform:translate(-12%,-8%) scale(1)}100%{transform:translate(10%,12%) scale(1.12)}}
@keyframes vg-shine{0%{transform:translateX(-130%)}100%{transform:translateX(240%)}}
@keyframes vg-cappulse{0%,100%{box-shadow:0 0 14px 3px rgba(200,127,255,.9),0 0 30px 7px rgba(123,31,255,.6)}50%{box-shadow:0 0 22px 6px rgba(200,127,255,1),0 0 46px 11px rgba(123,31,255,.85)}}
@keyframes vg-logoglow{0%,100%{box-shadow:0 0 0 1px rgba(180,79,255,.35),0 0 22px rgba(123,31,255,.5)}50%{box-shadow:0 0 0 1px rgba(200,127,255,.7),0 0 42px rgba(180,79,255,.85)}}
@keyframes vg-comet{0%{left:-40%}100%{left:140%}}
@keyframes vg-dots{0%{opacity:.2}50%{opacity:1}100%{opacity:.2}}
@keyframes vg-spin{to{transform:rotate(360deg)}}
@keyframes vg-instpulse{0%,100%{filter:brightness(1)}50%{filter:brightness(1.28)}}
@keyframes vg-scan{0%{transform:translateY(-160px)}100%{transform:translateY(820px)}}
@keyframes vg-floaty{0%,100%{transform:translateY(0)}50%{transform:translateY(-7px)}}
@keyframes vg-errpulse{0%,100%{box-shadow:0 0 0 1px rgba(240,64,96,.45),0 0 24px rgba(240,64,96,.35)}50%{box-shadow:0 0 0 1px rgba(240,64,96,.8),0 0 44px rgba(240,64,96,.7)}}
`}</style>
  );
}
