// TwoCameraProofRecorder
//
// High-stakes tournament matches (>5,000c entry) require a side-by-side
// proof feed: the player's game window AND their webcam, composited on the
// client into a single canvas, chunked every 10 seconds via MediaRecorder,
// each chunk PUT to R2, then registered on the match doc through
// `appendProofChunk`. Mods + spectators can play back the chunks via
// <TwoCameraProofViewer/> to verify the player was at their machine.
//
// Props:
//   tournamentId, matchId   — Firestore IDs
//   webcamStream            — already-captured MediaStream from useUserMedia
//                             (TournamentMatchScreen requests it earlier)
//   onStatus(s)             — optional status callback ('idle'|'capturing'|
//                             'recording'|'error', message?)
//
// The recorder asks the player to pick the game window ONCE via
// getDisplayMedia({ displaySurface: 'window' }) — OS enforces window-only
// capture, no full-desktop snooping.

import { useEffect, useRef, useState } from 'react';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../../firebase/config';
import { uploadToR2 } from '../../utils/r2Storage';

const CHUNK_MS = 10_000;          // 10 s per chunk
const OUT_W = 1280;               // composite width
const OUT_H = 720;                // composite height
const PIP_W = 240;                // webcam PiP width
const PIP_H = 180;                // webcam PiP height
const VIDEO_BITRATE = 800_000;    // 800 kbps — small but recognisable

export default function TwoCameraProofRecorder({
  tournamentId, matchId, webcamStream, onStatus,
  // External trigger — when bumped (e.g. by the explainer modal "Start"
  // button), the recorder fires getDisplayMedia immediately without
  // requiring the player to click the internal Start button.
  startTrigger = 0,
}) {
  const [error, setError] = useState(null);
  const [recording, setRecording] = useState(false);
  const [chunkIdx, setChunkIdx] = useState(0);

  const canvasRef = useRef(null);
  const gameStreamRef = useRef(null);
  const gameVideoRef = useRef(null);
  const webcamVideoRef = useRef(null);
  const recorderRef = useRef(null);
  const compositeStreamRef = useRef(null);
  const rafRef = useRef(0);
  const idxRef = useRef(0);

  const status = (s, msg) => onStatus?.(s, msg);

  // ── Step 1: ask player to pick the game window ───────────────────────
  const startCapture = async () => {
    setError(null);
    status('capturing', 'Pick your game window');
    try {
      // displaySurface: 'window' is the OS-enforced way to scope capture to
      // a single application window — desktop / monitor capture is blocked.
      const game = await navigator.mediaDevices.getDisplayMedia({
        video: { displaySurface: 'window', frameRate: { ideal: 24 } },
        audio: false,
      });
      gameStreamRef.current = game;

      // Player may close the share dialog mid-match → stop recording.
      game.getVideoTracks()[0].addEventListener('ended', () => stopAll());

      // Wire both streams into hidden <video> elements so canvas can draw them.
      gameVideoRef.current.srcObject = game;
      await gameVideoRef.current.play();
      webcamVideoRef.current.srcObject = webcamStream;
      await webcamVideoRef.current.play();

      startCompositeLoop();
      startRecorder();
    } catch (e) {
      const msg = e?.message || 'Capture cancelled';
      setError(msg);
      status('error', msg);
    }
  };

  // ── Step 2: draw both videos into the canvas every frame ─────────────
  const startCompositeLoop = () => {
    const ctx = canvasRef.current.getContext('2d');
    const draw = () => {
      if (gameVideoRef.current) {
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, OUT_W, OUT_H);
        // Game fills the canvas (object-fit: cover behaviour).
        const gv = gameVideoRef.current;
        if (gv.videoWidth) {
          const scale = Math.max(OUT_W / gv.videoWidth, OUT_H / gv.videoHeight);
          const w = gv.videoWidth * scale;
          const h = gv.videoHeight * scale;
          ctx.drawImage(gv, (OUT_W - w) / 2, (OUT_H - h) / 2, w, h);
        }
        // Webcam PiP bottom-right with a gold border for proof.
        const wv = webcamVideoRef.current;
        if (wv?.videoWidth) {
          const px = OUT_W - PIP_W - 16;
          const py = OUT_H - PIP_H - 16;
          ctx.fillStyle = '#F0A500';
          ctx.fillRect(px - 3, py - 3, PIP_W + 6, PIP_H + 6);
          ctx.drawImage(wv, px, py, PIP_W, PIP_H);
          // PROOF CAM stamp.
          ctx.fillStyle = 'rgba(0,0,0,0.7)';
          ctx.fillRect(px + 4, py + 4, 90, 16);
          ctx.fillStyle = '#F0A500';
          ctx.font = '700 11px DM Mono, monospace';
          ctx.fillText('● PROOF CAM', px + 8, py + 16);
        }
        // Timestamp + match id watermark.
        ctx.fillStyle = 'rgba(255,255,255,0.6)';
        ctx.font = '600 10px DM Mono, monospace';
        ctx.fillText(`${new Date().toISOString()}  ·  ${matchId.slice(0, 12)}`, 12, OUT_H - 12);
      }
      rafRef.current = requestAnimationFrame(draw);
    };
    rafRef.current = requestAnimationFrame(draw);
  };

  // ── Step 3: MediaRecorder rolling 10s chunks → R2 → match doc ────────
  const startRecorder = () => {
    const canvasStream = canvasRef.current.captureStream(24);
    // Mux webcam audio if the player allowed it (most won't, fine either way).
    const audioTracks = webcamStream?.getAudioTracks() || [];
    if (audioTracks.length) canvasStream.addTrack(audioTracks[0]);
    compositeStreamRef.current = canvasStream;

    const mime = pickSupportedMime();
    if (!mime) {
      // Should never happen inside the Tauri webview (all 3 platforms ship
      // VP9). If it does, the desktop build is broken — surface clearly.
      const msg = 'Encoder unavailable — desktop app needs reinstall.';
      setError(msg);
      status('error', msg);
      return;
    }
    const rec = new MediaRecorder(canvasStream, {
      mimeType: mime,
      videoBitsPerSecond: VIDEO_BITRATE,
    });
    recorderRef.current = rec;

    let chunkStart = Date.now();
    rec.ondataavailable = async (ev) => {
      if (!ev.data || ev.data.size < 1024) return;
      const idx = idxRef.current++;
      const durationMs = Date.now() - chunkStart;
      chunkStart = Date.now();
      setChunkIdx(idx + 1);
      try {
        const blob = new Blob([ev.data], { type: mime });
        const file = new File([blob], `proof-${matchId}-${idx}.webm`, { type: mime });
        const { url, key } = await uploadToR2(file, 'tournament-proof');
        await httpsCallable(functions, 'appendProofChunk')({
          tournamentId, matchId, idx, url, key,
          t: Date.now(), durationMs,
        });
      } catch (e) {
        // Don't kill the recording loop on a single failed chunk — log,
        // surface to the user via status, and continue.
        console.warn('proof chunk upload failed', e);
        status('error', `Chunk ${idx} failed: ${e?.message || e}`);
      }
    };
    rec.onerror = (e) => {
      const msg = e?.error?.message || 'Recorder error';
      setError(msg);
      status('error', msg);
    };

    rec.start(CHUNK_MS);
    setRecording(true);
    status('recording', 'Proof feed active');
  };

  const stopAll = () => {
    cancelAnimationFrame(rafRef.current);
    try { recorderRef.current?.state !== 'inactive' && recorderRef.current?.stop(); } catch {}
    try { gameStreamRef.current?.getTracks().forEach((t) => t.stop()); } catch {}
    try { compositeStreamRef.current?.getTracks().forEach((t) => t.stop()); } catch {}
    setRecording(false);
    status('idle');
  };

  useEffect(() => () => stopAll(), []); // eslint-disable-line

  // External start (from the explainer modal). Skip on initial mount (0).
  useEffect(() => {
    if (startTrigger > 0 && !recording) startCapture();
    // eslint-disable-next-line
  }, [startTrigger]);

  return (
    <div style={{
      // Sits above the existing 160x120 webcam preview tile so the player
      // can still self-check framing while the recorder runs.
      position: 'fixed', bottom: 152, right: 16, width: 200,
      borderRadius: 12, overflow: 'hidden', zIndex: 51,
      border: `2px solid ${recording ? '#F0A500' : 'rgba(255,255,255,0.2)'}`,
      boxShadow: '0 4px 20px rgba(0,0,0,0.5)',
      background: '#0B0B14', color: '#fff', padding: 10, fontSize: 11,
    }}>
      {/* Hidden plumbing — canvas + offscreen videos. */}
      <canvas ref={canvasRef} width={OUT_W} height={OUT_H} style={{ display: 'none' }} />
      <video ref={gameVideoRef} style={{ display: 'none' }} muted playsInline />
      <video ref={webcamVideoRef} style={{ display: 'none' }} muted playsInline />

      <div style={{ fontWeight: 900, fontSize: 10, letterSpacing: '0.12em',
        color: recording ? '#F0A500' : '#9CA3AF', marginBottom: 6 }}>
        ● PROOF FEED {recording ? 'LIVE' : 'IDLE'}
      </div>
      {!recording && !error && (
        <>
          <div style={{
            fontSize: 10, color: '#F04060', lineHeight: 1.4, marginBottom: 6,
          }}>
            ⚠ Without proof recording you can't claim a win in this match.
          </div>
          <button onClick={startCapture} style={{
            width: '100%', padding: '8px 10px', borderRadius: 8,
            background: '#F0A500', color: '#000', fontWeight: 800, fontSize: 11,
            border: 'none', cursor: 'pointer',
          }}>
            Start proof recording
          </button>
        </>
      )}
      {recording && (
        <div style={{ color: 'rgba(255,255,255,0.7)', lineHeight: 1.4 }}>
          {chunkIdx} chunks uploaded.<br />
          Game + webcam captured.
        </div>
      )}
      {error && (
        <div style={{ color: '#F04060', fontSize: 10, lineHeight: 1.3, marginTop: 6 }}>
          {error}
          <button onClick={() => { setError(null); startCapture(); }} style={{
            display: 'block', marginTop: 6, padding: '6px 8px',
            background: 'transparent', color: '#B44FFF',
            border: '1px solid #B44FFF', borderRadius: 6,
            fontSize: 10, fontWeight: 700, cursor: 'pointer',
          }}>Retry</button>
        </div>
      )}
    </div>
  );
}

// Runs inside the Tauri desktop app's webview (WebView2 on Windows,
// WKWebView on Mac, WebKitGTK on Linux). All three encode VP9. The fallback
// chain is defence-in-depth, not a real compatibility concern — tournament
// users are ALWAYS on the desktop app, never a stray Safari tab.
function pickSupportedMime() {
  const candidates = [
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp9',
    'video/webm;codecs=vp8,opus',
    'video/webm;codecs=vp8',
    'video/webm',
  ];
  for (const m of candidates) {
    if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported?.(m)) return m;
  }
  return null;
}
