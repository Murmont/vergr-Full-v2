// Phase A harness for the Golden Thread. Effect 07, doc §4.
//
// ⚠ THIS EXISTS TO DECIDE WHETHER THE EFFECT SHIPS AT ALL. Doc §4: "If it
// cannot hold frame budget in the harness, it will not hold it on a real
// stream, and the effect should be abandoned rather than shipped degraded."
// So it must be measured BEFORE any product code, not after.
//
// It renders a synthetic chat scrolling at a realistic live rate, running THE
// SHIPPING ENGINE (src/utils/goldenThread.js), and reports frame time with the
// thread on and off.
//
//   node scripts/golden-thread-preview.mjs      # serve on :4610
//
// Then in the page: window.bench() → { off, on, deltaMs, rectReadsPerFrame }
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT || 4610);
const SERVE = { '/goldenThread.js': 'src/utils/goldenThread.js' };

// A realistic busy stream: ~4 messages/second, 8 speakers, one of them tracked.
const PAGE = `<!doctype html><html><head><meta charset="utf-8">
<title>Golden Thread harness</title>
<style>
  :root { color-scheme: dark; }
  body { margin:0; background:#0B0B14; color:#fff;
         font:13px/1.45 system-ui,-apple-system,"Segoe UI",sans-serif; }
  h1 { font-size:14px; padding:12px 16px; margin:0; color:#9CA3AF; }
  .wrap { display:flex; gap:18px; padding:0 16px 20px; }
  /* mirrors the real chat column width */
  .chatbox { position:relative; isolation:isolate; width:360px; height:520px;
             overflow-y:auto; background:#14141F; border-radius:12px; padding:8px 10px 8px 26px; }
  .row { margin:0 0 8px; }
  .who { font-weight:700; font-size:12px; }
  .txt { font-size:12.5px; color:#D7D7E0; }
  svg.thread { position:absolute; inset:0; width:100%; height:100%;
               pointer-events:none; z-index:-1; overflow:visible; }
  svg.thread path { fill:none; stroke-width:2.5; stroke-linecap:round;
                    filter:drop-shadow(0 0 5px rgba(245,200,66,.55)); }
  @media (prefers-reduced-motion:no-preference){
    svg.thread path { stroke-dasharray:5 7; animation:march 1.1s linear infinite; }
  }
  @keyframes march { to { stroke-dashoffset:-12; } }
  pre { background:#14141F; padding:12px; border-radius:10px; font-size:12px; max-width:520px; }
</style></head><body>
<h1>Golden Thread — Phase A. Shipping engine, synthetic chat at ~4 msg/s. Run window.bench() in the console.</h1>
<div class="wrap">
  <div class="chatbox" id="box">
    <svg class="thread" id="svg"><path d=""/></svg>
    <div id="rows"></div>
  </div>
  <pre id="out">window.bench() to measure.
window.setTracked(n) to change which speaker is threaded.</pre>
</div>
<script type="module">
import { createThread, UID_ATTR, MAX_NODES } from './goldenThread.js';

const box=document.getElementById('box'), rows=document.getElementById('rows');
const NAMES=['nova_kill','Sable','ALEX','DrLupo','Vergr','xQcOW','Miquela','Zed'];
const WORDS='gg ez lets go what a play no shot insane clutch chat is this real poggers ok that was nasty'.split(' ');
let n=0;
const add=()=>{
  const who=Math.floor(Math.random()*NAMES.length);
  const d=document.createElement('div');
  d.className='row';
  d.setAttribute(UID_ATTR,'u'+who);
  const len=2+Math.floor(Math.random()*7);
  const txt=Array.from({length:len},()=>WORDS[Math.floor(Math.random()*WORDS.length)]).join(' ');
  d.innerHTML='<span class="who" style="color:hsl('+(who*44)+',70%,68%)">'+NAMES[who]+'</span> <span class="txt">'+txt+'</span>';
  rows.appendChild(d);
  // a live chat is bottom-anchored and prunes; mirror both
  while(rows.children.length>120) rows.removeChild(rows.firstChild);
  box.scrollTop=box.scrollHeight;
  if(++n%3===0) thread.refresh();
};

const thread=createThread(box, document.getElementById('svg'), { gutter:10 });
thread.setUid('u4');                       // "Vergr" is the tracked viewer
thread.start();
setInterval(add, 250);                     // ~4 messages/second
for(let i=0;i<60;i++) add();

window.setTracked=(i)=>{ thread.setUid('u'+i); return NAMES[i]; };

// ── MEASUREMENT ────────────────────────────────────────────────────────
// Frame time is sampled over a fixed window with the thread ON and OFF, while
// the chat keeps scrolling. A number, not an impression (doc §5).
const sample=(ms)=>new Promise(res=>{
  const t=[]; let last=performance.now();
  const tick=(now)=>{ t.push(now-last); last=now;
    if(now-t0<ms) requestAnimationFrame(tick); else finish(); };
  const t0=performance.now();
  const finish=()=>{ t.sort((a,b)=>a-b);
    res({ frames:t.length, median:+t[Math.floor(t.length/2)].toFixed(2),
          p95:+t[Math.floor(t.length*0.95)].toFixed(2) }); };
  requestAnimationFrame(tick);
});

window.bench=async(ms=3000)=>{
  thread.setUid(null); thread.resetStats();
  const off=await sample(ms);
  thread.setUid('u4'); thread.refresh(); thread.resetStats();
  const on=await sample(ms);
  const st=thread.stats();
  const r={ off, on, deltaMedianMs:+(on.median-off.median).toFixed(2),
    tracked:st.tracked, nodeCapRespected: st.tracked<=MAX_NODES,
    rectReadsPerFrame:+(st.rectReads/Math.max(1,on.frames)).toFixed(2),
    // the cap is nodes+1 (the container's own rect) per DRAWN frame
    rectBudgetRespected: (st.rectReads/Math.max(1,on.frames)) <= (MAX_NODES+1) };
  document.getElementById('out').textContent=JSON.stringify(r,null,1);
  return r;
};
window.pathD=()=>document.querySelector('svg.thread path').getAttribute('d');

// ⚠ SYNCHRONOUS COST BENCH. rAF is throttled to a stop in an unfocused tab,
// so the rAF-based bench above hangs instead of reporting. This measures the
// thing that actually matters — the cost of ONE draw — and works regardless of
// tab state. It is also the more honest number: fps depends on whatever else
// the machine is doing, draw cost does not.
window.cost=(iters=600)=>{
  thread.setUid('u4'); thread.refresh();
  // warm up, so we time steady state and not first-call layout
  for(let i=0;i<40;i++) thread.drawNow();
  thread.resetStats();
  const t0=performance.now();
  for(let i=0;i<iters;i++) thread.drawNow();
  const per=(performance.now()-t0)/iters;
  const st=thread.stats();
  // the same loop with NO uid tracked = the floor (R-6: zero cost when off)
  thread.setUid(null); thread.resetStats();
  const t1=performance.now();
  for(let i=0;i<iters;i++) thread.drawNow();
  const perOff=(performance.now()-t1)/iters;
  thread.setUid('u4'); thread.refresh();
  const r={ msPerDrawOn:+per.toFixed(4), msPerDrawOff:+perOff.toFixed(4),
    pctOf16msBudget:+((per/16.67)*100).toFixed(2),
    tracked:st.tracked, nodeCapRespected: st.tracked<=MAX_NODES,
    rectReadsPerDraw:+(st.rectReads/iters).toFixed(2),
    rectBudgetRespected:(st.rectReads/iters)<=(MAX_NODES+1) };
  document.getElementById('out').textContent=JSON.stringify(r,null,1);
  return r;
};
</script></body></html>`;

http.createServer((req, res) => {
  const url = (req.url || '/').split('?')[0];
  if (url === '/' || url === '/index.html') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(PAGE); return;
  }
  const rel = SERVE[url];
  if (rel && fs.existsSync(path.join(ROOT, rel))) {
    res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8' });
    res.end(fs.readFileSync(path.join(ROOT, rel))); return;
  }
  res.writeHead(404).end('not found');
}).listen(PORT, () => console.log(`golden-thread-preview: http://localhost:${PORT}`));
