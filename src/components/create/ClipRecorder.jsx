// Record a clip in the app: the first step of /create/clip, modelled on TikTok's
// camera. Full-screen preview, flip and timer down the right, length tabs above a
// large shutter, and Upload beside it for a video that already exists.
//
// Records at the plan's own clip resolution and bitrate (CLIP_LIMITS), so a
// recording is already inside the ladder and does not need re-encoding unless it
// is trimmed. A browser recording reports its length as Infinity, so the real
// length is stamped on the file (`_durationSec`) here rather than discovered
// later with a full-file seek.
//
// House rules: solid values only; the preview is never cropped.
import { useCallback, useEffect, useRef, useState } from 'react';
import Icon from '../Icon';
import { CLIP_LIMITS } from '../../utils/mediaCompression';
import { fmtTime } from '../../utils/clipEdits';

const LENGTHS = [
  { id: '3m', label: '3m', sec: 180 },
  { id: '60s', label: '60s', sec: 60 },
  { id: '15s', label: '15s', sec: 15 },
];

const MIME_TYPES = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4'];
const pickMime = () => MIME_TYPES.find((t) => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported?.(t)) || '';

const SHADOW = { filter: 'drop-shadow(0 1px 3px rgba(0,0,0,0.6))' };

export default function ClipRecorder({ tier = 'free', onRecorded, onUpload, onClose, wide = false }) {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const recRef = useRef(null);
  const chunksRef = useRef([]);
  const startRef = useRef(0);
  const tickRef = useRef(0);
  const countRef = useRef(0);
  const [facing, setFacing] = useState('user');
  const [status, setStatus] = useState('starting'); // starting | ready | recording | error
  const [error, setError] = useState('');
  const [length, setLength] = useState(LENGTHS[1]);
  const [elapsed, setElapsed] = useState(0);
  const [timerOn, setTimerOn] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const limits = CLIP_LIMITS[tier] || CLIP_LIMITS.free;
  const lengthRef = useRef(length); lengthRef.current = length;
  const onRecordedRef = useRef(onRecorded); onRecordedRef.current = onRecorded;

  useEffect(() => {
    let cancelled = false;
    setStatus('starting');
    (async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw Object.assign(new Error('unsupported'), { name: 'NotSupportedError' });
        const short = limits.maxShortSide;
        const long = Math.round((short * 16) / 9);
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: facing,
            width: { ideal: wide ? long : short },
            height: { ideal: wide ? short : long },
            frameRate: { ideal: 30 },
          },
          audio: true,
        });
        if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return; }
        streamRef.current = stream;
        const v = videoRef.current;
        if (v) { v.srcObject = stream; v.muted = true; v.play().catch(() => {}); }
        setStatus('ready');
      } catch (e) {
        if (cancelled) return;
        setStatus('error');
        setError(e?.name === 'NotAllowedError'
          ? 'Camera access is turned off for Vergr. Allow it in your settings, or upload a video instead.'
          : 'No camera is available here. You can upload a video instead.');
      }
    })();
    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
  }, [facing, limits.maxShortSide, wide]);

  const stopRecording = useCallback(() => {
    const r = recRef.current;
    if (r && r.state !== 'inactive') r.stop();
  }, []);

  const beginRecording = useCallback(() => {
    const stream = streamRef.current;
    if (!stream) return;
    const mimeType = pickMime();
    let rec;
    try {
      rec = new MediaRecorder(stream, { ...(mimeType ? { mimeType } : {}), videoBitsPerSecond: limits.videoBitrate });
    } catch {
      setStatus('error');
      setError('Recording is not supported here. You can upload a video instead.');
      return;
    }
    chunksRef.current = [];
    rec.ondataavailable = (e) => { if (e.data?.size) chunksRef.current.push(e.data); };
    rec.onstop = () => {
      clearInterval(tickRef.current);
      const secs = Math.min((performance.now() - startRef.current) / 1000, lengthRef.current.sec);
      const type = (rec.mimeType || mimeType || 'video/webm').split(';')[0];
      const blob = new Blob(chunksRef.current, { type });
      setStatus(streamRef.current ? 'ready' : 'starting');
      setElapsed(0);
      if (secs < 1 || !blob.size) return;
      const file = new File([blob], `clip-${Date.now()}.${type.includes('mp4') ? 'mp4' : 'webm'}`, { type });
      file._durationSec = secs;
      onRecordedRef.current?.(file);
    };
    recRef.current = rec;
    rec.start(250);
    startRef.current = performance.now();
    setStatus('recording');
    tickRef.current = setInterval(() => {
      const s = (performance.now() - startRef.current) / 1000;
      setElapsed(s);
      if (s >= lengthRef.current.sec) stopRecording();
    }, 100);
  }, [limits.videoBitrate, stopRecording]);

  const onShutter = () => {
    if (status === 'recording') { stopRecording(); return; }
    if (status !== 'ready' || countdown) return;
    if (!timerOn) { beginRecording(); return; }
    let n = 3;
    setCountdown(n);
    countRef.current = setInterval(() => {
      n -= 1;
      if (n <= 0) { clearInterval(countRef.current); setCountdown(0); beginRecording(); }
      else setCountdown(n);
    }, 1000);
  };

  useEffect(() => () => {
    clearInterval(tickRef.current);
    clearInterval(countRef.current);
    const r = recRef.current;
    if (r && r.state !== 'inactive') { r.onstop = null; try { r.stop(); } catch { /* gone */ } }
  }, []);

  const recording = status === 'recording';

  const stage = (
    <div
      className={wide ? 'relative mx-auto rounded-[24px] overflow-hidden bg-black' : 'fixed inset-0 z-[60] bg-black'}
      style={wide ? { width: 'min(960px, 100%)', aspectRatio: '16 / 9' } : undefined}
    >
      <video
        ref={videoRef}
        playsInline
        muted
        autoPlay
        className="absolute inset-0 w-full h-full object-contain"
        style={{ transform: facing === 'user' ? 'scaleX(-1)' : undefined }}
      />

      {status === 'error' && (
        <div className="absolute inset-0 grid place-items-center px-8 text-center" style={{ background: '#0B0B14' }}>
          <div>
            <span className="mx-auto w-16 h-16 rounded-full grid place-items-center" style={{ background: '#1E1E2C' }}>
              <Icon name="videocam_off" size={30} className="text-white" />
            </span>
            <p className="mt-4 font-syne font-bold text-white text-[19px]">Camera unavailable</p>
            <p className="mt-2 text-[14px] leading-[20px]" style={{ color: '#9CA3AF' }}>{error}</p>
            <button type="button" onClick={onUpload} className="mt-6 h-12 px-8 rounded-full text-white font-bold text-[15px]" style={{ background: '#7B1FFF' }}>
              Upload a video
            </button>
          </div>
        </div>
      )}

      {countdown > 0 && (
        <div className="absolute inset-0 grid place-items-center pointer-events-none">
          <span className="font-syne font-bold text-white text-[104px]" style={{ textShadow: '0 4px 24px rgba(0,0,0,0.6)' }}>{countdown}</span>
        </div>
      )}

      {/* Top: progress while recording, close, elapsed */}
      <div className="absolute inset-x-0 top-0 px-3" style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 8px)' }}>
        <div className="h-[4px] rounded-full overflow-hidden" style={{ background: recording ? '#2E2E40' : 'transparent' }}>
          {recording && <div className="h-full" style={{ width: `${Math.min(100, (elapsed / length.sec) * 100)}%`, background: '#7B1FFF' }} />}
        </div>
        <div className="mt-2 flex items-center justify-between">
          <button type="button" onClick={onClose} aria-label="Close" className="w-11 h-11 grid place-items-center text-white" style={SHADOW} disabled={recording}>
            <Icon name="close" size={28} />
          </button>
          {recording && (
            <span className="h-8 px-3 rounded-full flex items-center gap-2 text-white text-[14px] font-semibold tabular-nums" style={{ background: '#15151F' }}>
              <span className="w-2 h-2 rounded-full" style={{ background: '#F04060' }} /> {fmtTime(elapsed)}
            </span>
          )}
          <span className="w-11" aria-hidden />
        </div>
      </div>

      {/* Right rail: flip and timer */}
      {status !== 'error' && !recording && (
        <div className="absolute right-2 flex flex-col items-center gap-5" style={{ top: 'calc(env(safe-area-inset-top, 0px) + 76px)' }}>
          <RailButton icon="flip_camera_android" label="Flip" onClick={() => setFacing((f) => (f === 'user' ? 'environment' : 'user'))} />
          <RailButton icon={timerOn ? 'timer_3' : 'timer'} label={timerOn ? '3s' : 'Timer'} active={timerOn} onClick={() => setTimerOn((t) => !t)} />
        </div>
      )}

      {/* Bottom: lengths, shutter, upload */}
      {status !== 'error' && (
        <div className="absolute inset-x-0 bottom-0 px-6" style={{ paddingBottom: 'calc(var(--vg-safe-b, 0px) + 22px)' }}>
          {!recording && (
            <div className="mb-5 flex items-center justify-center gap-6">
              {LENGTHS.map((l) => (
                <button
                  key={l.id}
                  type="button"
                  onClick={() => setLength(l)}
                  className="flex flex-col items-center gap-1 text-[14px] font-bold"
                  style={{ color: l.id === length.id ? '#FFFFFF' : '#D8D8E0', textShadow: '0 1px 2px rgba(0,0,0,0.9), 0 0 8px rgba(0,0,0,0.6)' }}
                >
                  {l.label}
                  <span className="w-1 h-1 rounded-full" style={{ background: l.id === length.id ? '#FFFFFF' : 'transparent' }} />
                </button>
              ))}
            </div>
          )}
          <div className="grid items-center" style={{ gridTemplateColumns: '1fr auto 1fr' }}>
            <span />
            <button
              type="button"
              onClick={onShutter}
              disabled={status === 'starting'}
              aria-label={recording ? 'Stop recording' : 'Record'}
              className="relative w-[84px] h-[84px] rounded-full grid place-items-center disabled:opacity-60"
              style={{ boxShadow: 'inset 0 0 0 5px #FFFFFF' }}
            >
              <span
                className="transition-all duration-200"
                style={{ width: recording ? 30 : 64, height: recording ? 30 : 64, borderRadius: recording ? 8 : 999, background: '#F04060' }}
              />
            </button>
            {!recording ? (
              <button type="button" onClick={onUpload} className="justify-self-end flex flex-col items-center gap-1 text-white text-[12px] font-semibold" style={SHADOW}>
                <span className="w-11 h-11 rounded-[12px] grid place-items-center" style={{ background: '#1E1E2C' }}>
                  <Icon name="photo_library" size={22} />
                </span>
                Upload
              </button>
            ) : <span />}
          </div>
        </div>
      )}
    </div>
  );

  if (!wide) return stage;
  return (
    <div className="min-h-screen" style={{ background: '#0B0B14' }}>
      <div className="w-full max-w-[1120px] mx-auto px-6 pt-4 pb-10">{stage}</div>
    </div>
  );
}

function RailButton({ icon, label, onClick, active = false }) {
  return (
    <button type="button" onClick={onClick} className="flex flex-col items-center gap-1 text-white text-[11px] font-semibold" style={SHADOW}>
      <Icon name={icon} size={28} className={active ? 'text-brand-violet-light' : 'text-white'} />
      {label}
    </button>
  );
}
