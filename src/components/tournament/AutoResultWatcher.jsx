// Phase 2 automated result engine — client half.
//
// The player picks their game window ONCE; we sample a frame every 10s and
// send it to the vergr-ocr box, which:
//   1. auto-verifies the lobby code the moment it appears on their screen
//      (no streaming, no mod, no self-attest needed), then
//   2. reads the end screen ("VICTORY"/"DEFEAT") and records the result with
//      zero player action. One side's read = a claim with the 3-min confirm
//      window; both sides agreeing = instant completion.
//
// Paid tournaments REQUIRE this (the manual report buttons are hidden);
// free tournaments get it as a recommended option with manual fallback.

import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import Icon from '../Icon';
import { auth } from '../../firebase/config';
import {
  getGameCaptureStream, getActiveGameCapture, stopGameCapture,
  captureSupported, grabFrameBase64,
} from '../../utils/gameCapture';

const FRAME_ENDPOINT = 'https://sfu.vergr.app/frame';
const SAMPLE_MS = 10_000;

const C = {
  surface: '#14141F', border: 'rgba(255,255,255,0.10)',
  text: '#fff', dim: 'rgba(255,255,255,0.65)', mute: 'rgba(255,255,255,0.45)',
  cyan: '#B44FFF', green: '#22c55e', amber: '#f59e0b', red: '#ef4444',
  violet: '#7B1FFF', violetLt: '#B44FFF',
};

export default function AutoResultWatcher({ tournamentId, matchId, match, myUid, required }) {
  // idle → active → (detected | stopped | error)
  const [phase, setPhase] = useState(() => (getActiveGameCapture() ? 'active' : 'idle'));
  const [lastScanAt, setLastScanAt] = useState(0);
  const [error, setError] = useState(null);
  const timerRef = useRef(null);
  const stoppedRef = useRef(false);

  const matchDone = ['completed', 'cancelled', 'forfeited', 'disputed'].includes(match?.status);
  const myVerified = match?.verifyState?.[myUid]?.status === 'verified';
  const myAutoResult = match?.autoResult?.[myUid]?.outcome || null;

  const sendFrame = async () => {
    const stream = getActiveGameCapture();
    if (!stream) {
      setPhase('stopped');
      return;
    }
    try {
      const frameBase64 = await grabFrameBase64(stream);
      if (!frameBase64) return;
      const token = await auth.currentUser?.getIdToken();
      if (!token) return;
      const res = await fetch(FRAME_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ tournamentId, matchId, frameBase64 }),
      });
      const out = await res.json().catch(() => ({}));
      setLastScanAt(Date.now());
      if (out?.outcome) setPhase('detected');
      setError(null);
    } catch (err) {
      // Transient network/OCR failures are fine — next tick retries.
      setError(err?.message || 'scan failed');
    }
  };

  const start = async () => {
    setError(null);
    try {
      await getGameCaptureStream(); // user-gesture: OS window picker
      setPhase('active');
    } catch (err) {
      setPhase('idle');
      setError(err?.name === 'NotAllowedError'
        ? 'Capture was cancelled — pick your game window to enable auto-detection.'
        : (err?.message || 'Could not start capture'));
    }
  };

  // Sampling loop — runs while active and the match needs it.
  useEffect(() => {
    if (phase !== 'active' || matchDone || myAutoResult) {
      if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
      return undefined;
    }
    sendFrame(); // immediate first scan
    timerRef.current = setInterval(sendFrame, SAMPLE_MS);
    return () => { if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; } };
    // eslint-disable-next-line
  }, [phase, matchDone, myAutoResult]);

  // Track ending (player stops sharing) → surface it.
  useEffect(() => {
    if (phase !== 'active') return undefined;
    const stream = getActiveGameCapture();
    const track = stream?.getVideoTracks()[0];
    if (!track) return undefined;
    const onEnd = () => { if (!stoppedRef.current) setPhase('stopped'); };
    track.addEventListener('ended', onEnd);
    return () => track.removeEventListener('ended', onEnd);
  }, [phase]);

  // Cleanup: this component owns the capture lifecycle on this screen.
  useEffect(() => () => {
    stoppedRef.current = true;
    stopGameCapture();
  }, []);

  if (matchDone) return null;
  if (!captureSupported()) {
    if (!required) return null;
    return (
      <Card tone={C.red}>
        <Row icon="desktop_access_disabled" color={C.red}
          title="Screen capture unavailable"
          sub="This match requires auto result detection (paid entry). Use a desktop browser with screen-capture support (Chrome, Edge, or the VERGR desktop app)." />
      </Card>
    );
  }

  if (myAutoResult || phase === 'detected') {
    return (
      <Card tone={C.green}>
        <Row icon="emoji_events" color={C.green}
          title={myAutoResult === 'lost' ? 'Result detected from your end screen' : 'Victory detected on your screen'}
          sub="Recording the result — your opponent's screen (or the confirm window) finalises it. Nothing more to do." />
      </Card>
    );
  }

  if (phase === 'active') {
    return (
      <Card tone={C.cyan}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <motion.div
            animate={{ opacity: [1, 0.35, 1] }}
            transition={{ duration: 1.6, repeat: Infinity }}
            style={{ width: 10, height: 10, borderRadius: '50%', background: C.cyan, flexShrink: 0 }}
          />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 800, color: C.text }}>
              Auto-detection active — watching your game
            </div>
            <div style={{ fontSize: 11, color: C.dim, marginTop: 2, lineHeight: 1.5 }}>
              {myVerified
                ? 'Verified ✓ — when your end screen appears, the result records itself.'
                : 'Show the lobby code on screen (chat / name) and you verify automatically. Then play; the end screen records the result.'}
              {lastScanAt > 0 && <span style={{ color: C.mute }}> · last scan {Math.max(1, Math.round((Date.now() - lastScanAt) / 1000))}s ago</span>}
            </div>
          </div>
        </div>
      </Card>
    );
  }

  // idle / stopped / error
  const stopped = phase === 'stopped';
  return (
    <Card tone={required ? C.violet : C.border}>
      <Row icon="screen_record" color={required ? C.violetLt : C.cyan}
        title={stopped ? 'Auto-detection stopped' : 'Automatic result detection'}
        sub={required
          ? 'Required for paid matches: pick your game window once. Verification and the final result are then read from your screen — no buttons, no screenshots.'
          : 'Recommended: pick your game window once and your verification + result are detected automatically.'} />
      {error && <div style={{ fontSize: 11, color: C.amber, marginTop: 8 }}>{error}</div>}
      <button onClick={start} style={{
        width: '100%', marginTop: 10, padding: 12, borderRadius: 10, border: 'none',
        background: `linear-gradient(135deg, ${C.violet}, ${C.violetLt})`,
        color: '#fff', fontSize: 13, fontWeight: 900, cursor: 'pointer',
      }}>
        {stopped ? 'Restart capture' : 'Select my game window'}
      </button>
    </Card>
  );
}

function Card({ tone, children }) {
  return (
    <div style={{
      padding: 14, background: C.surface, borderRadius: 14,
      border: `1px solid ${tone}55`,
    }}>{children}</div>
  );
}

function Row({ icon, color, title, sub }) {
  return (
    <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
      <Icon name={icon} size={18} style={{ color, marginTop: 1, flexShrink: 0 }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 800, color: C.text }}>{title}</div>
        <div style={{ fontSize: 11, color: C.dim, marginTop: 3, lineHeight: 1.5 }}>{sub}</div>
      </div>
    </div>
  );
}
