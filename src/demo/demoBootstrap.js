/**
 * DEMO-ONLY boot side-effects. Imported for its side effect by mockFirestore.js
 * (which config.js loads at startup), so this runs before any screen mounts.
 *
 * Fakes the camera/mic so the broadcaster + go-live previews show gameplay-ish
 * video instead of a black rectangle, and so device pickers look populated.
 */
// Animated canvas "camera" — reliable (no cross-origin taint), never black.
// Renders a branded moving scene so broadcaster/go-live previews look alive.
function makeFakeStream(withAudio) {
  const canvas = document.createElement('canvas');
  canvas.width = 1280; canvas.height = 720;
  const ctx = canvas.getContext('2d');
  let t = 0;
  const draw = () => {
    t += 0.015;
    const g = ctx.createLinearGradient(0, 0, 1280, 720);
    g.addColorStop(0, '#160a2e'); g.addColorStop(1, '#3a0f6e');
    ctx.fillStyle = g; ctx.fillRect(0, 0, 1280, 720);
    for (let i = 0; i < 6; i++) {
      const x = 640 + Math.cos(t + i) * (200 + i * 60);
      const y = 360 + Math.sin(t * 1.3 + i) * (120 + i * 40);
      ctx.beginPath(); ctx.arc(x, y, 60 + i * 10, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${120 + i * 20},${40 + i * 10},${255 - i * 10},0.18)`; ctx.fill();
    }
    ctx.fillStyle = '#ff3b5c'; ctx.beginPath(); ctx.arc(70, 60, 12, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.font = 'bold 40px sans-serif'; ctx.fillText('LIVE', 92, 74);
    ctx.font = 'bold 34px sans-serif'; ctx.textAlign = 'center';
    ctx.fillText('demo gameplay preview', 640, 380); ctx.textAlign = 'left';
    if (window.__demoCamRun !== false) requestAnimationFrame(draw);
  };
  window.__demoCamRun = true; draw();
  const stream = canvas.captureStream(30);
  if (withAudio) {
    try {
      const ac = new (window.AudioContext || window.webkitAudioContext)();
      const dst = ac.createMediaStreamDestination();
      const osc = ac.createGain(); osc.gain.value = 0; osc.connect(dst);
      dst.stream.getAudioTracks().forEach((tr) => stream.addTrack(tr));
    } catch { /* ignore */ }
  }
  return stream;
}

try {
  if (typeof navigator !== 'undefined' && navigator.mediaDevices) {
    const md = navigator.mediaDevices;
    md.getUserMedia = async (c = {}) => makeFakeStream(!!c.audio);
    md.getDisplayMedia = async () => makeFakeStream(false);
    md.enumerateDevices = async () => ([
      { kind: 'videoinput', label: 'Demo Camera', deviceId: 'demo-cam', groupId: 'demo' },
      { kind: 'audioinput', label: 'Demo Mic', deviceId: 'demo-mic', groupId: 'demo' },
      { kind: 'audiooutput', label: 'Demo Speakers', deviceId: 'demo-out', groupId: 'demo' },
    ]);
  }
} catch { /* ignore */ }
