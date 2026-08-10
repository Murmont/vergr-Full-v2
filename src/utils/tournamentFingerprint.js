// VERGR tournament hardware fingerprint.
//
// Generated client-side at tournament entry. Combines stable but
// non-personally-identifying signals into a sha256:
//
//   navigator.userAgent + colorDepth + width*height + timezone +
//   GPU vendor (WebGL UNMASKED_VENDOR_WEBGL) +
//   GPU renderer (WebGL UNMASKED_RENDERER_WEBGL) +
//   canvas-2d render hash (subtle text-rendering differences per machine)
//
// Hash matches across browser sessions on the same hardware.
// Changes if user swaps GPU, monitor, OS, or browser.
// Does NOT include username, MAC, IP, or anything we can't already see.

async function sha256Hex(input) {
  const buf = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, '0')).join('');
}

function gpuInfo() {
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
    if (!gl) return 'no-webgl';
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const vendor = ext ? gl.getParameter(ext.UNMASKED_VENDOR_WEBGL) : '';
    const renderer = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : '';
    return `${vendor}|${renderer}`;
  } catch {
    return 'gpu-err';
  }
}

function canvasHash() {
  try {
    const c = document.createElement('canvas');
    c.width = 220; c.height = 30;
    const ctx = c.getContext('2d');
    ctx.textBaseline = 'top';
    ctx.font = "14px 'Arial'";
    ctx.fillStyle = '#f60';
    ctx.fillRect(125, 1, 62, 20);
    ctx.fillStyle = '#069';
    ctx.fillText('vergr-fingerprint', 2, 15);
    return c.toDataURL().slice(-64);
  } catch {
    return 'canvas-err';
  }
}

export async function computeTournamentFingerprint() {
  const ua = navigator.userAgent;
  const cd = screen.colorDepth;
  const dim = `${screen.width}x${screen.height}`;
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'unknown';
  const gpu = gpuInfo();
  const canv = canvasHash();
  return sha256Hex(`${ua}|${cd}|${dim}|${tz}|${gpu}|${canv}`);
}
