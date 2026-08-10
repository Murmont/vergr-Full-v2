// Shared game-window capture for tournament matches.
//
// One getDisplayMedia stream per session, shared so the auto-result watcher
// and (later) the proof recorder never double-prompt the OS picker. The
// browser requires a user gesture to start capture, so getGameCaptureStream
// must be called from a click handler.
//
// displaySurface:'window' nudges the picker to window mode (the player picks
// their GAME window, not the whole screen) — same pattern the two-camera
// proof recorder uses.

let stream = null;
let pending = null;

export async function getGameCaptureStream() {
  if (stream && stream.getVideoTracks()[0]?.readyState === 'live') return stream;
  if (pending) return pending;
  pending = navigator.mediaDevices.getDisplayMedia({
    video: { displaySurface: 'window', frameRate: { ideal: 5, max: 10 } },
    audio: false,
  }).then((s) => {
    stream = s;
    pending = null;
    const track = s.getVideoTracks()[0];
    if (track) track.addEventListener('ended', () => { if (stream === s) stream = null; });
    return s;
  }).catch((err) => {
    pending = null;
    throw err;
  });
  return pending;
}

export function getActiveGameCapture() {
  return (stream && stream.getVideoTracks()[0]?.readyState === 'live') ? stream : null;
}

export function stopGameCapture() {
  if (stream) {
    stream.getTracks().forEach((t) => t.stop());
    stream = null;
  }
}

export function captureSupported() {
  return !!navigator.mediaDevices?.getDisplayMedia;
}

// Grab one JPEG frame (base64, no data: prefix) from the capture stream.
// Downscales to maxW so a 4K game window doesn't ship megabytes; 1280 keeps
// chat-sized text (the lobby code) legible for Tesseract.
export async function grabFrameBase64(mediaStream, maxW = 1280, quality = 0.7) {
  const track = mediaStream.getVideoTracks()[0];
  if (!track || track.readyState !== 'live') return null;
  const video = grabFrameBase64._video || (grabFrameBase64._video = document.createElement('video'));
  if (video.srcObject !== mediaStream) {
    video.srcObject = mediaStream;
    video.muted = true;
    video.playsInline = true;
    await video.play().catch(() => {});
    // Give the first frame a beat to paint.
    await new Promise((r) => setTimeout(r, 300));
  }
  const vw = video.videoWidth, vh = video.videoHeight;
  if (!vw || !vh) return null;
  const scale = Math.min(1, maxW / vw);
  const canvas = grabFrameBase64._canvas || (grabFrameBase64._canvas = document.createElement('canvas'));
  canvas.width = Math.round(vw * scale);
  canvas.height = Math.round(vh * scale);
  canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
  const dataUrl = canvas.toDataURL('image/jpeg', quality);
  return dataUrl.split(',')[1] || null;
}
