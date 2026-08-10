// src/utils/mediaHelpers.js
import { compressMedia } from './mediaCompression';
import { uploadToR2 } from './r2Storage';

// R2 handles object lifecycle via bucket rules — no TTL metadata needed.

/**
 * Starts audio recording. Returns a MediaRecorder instance.
 */
export const startVoiceRecording = async () => {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const recorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
    const chunks = [];

    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data);
    };

    recorder._chunks = chunks;
    recorder._stream = stream;

    // Real waveform: sample mic RMS ~16×/sec via an AnalyserNode while
    // recording. stopVoiceRecording downsamples to a compact bar array that
    // ships with the message, so the bubble shows the ACTUAL audio shape.
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      const ac = new Ctx();
      const src = ac.createMediaStreamSource(stream);
      const analyser = ac.createAnalyser();
      analyser.fftSize = 512;
      src.connect(analyser);
      const buf = new Uint8Array(analyser.fftSize);
      const samples = [];
      const tick = setInterval(() => {
        analyser.getByteTimeDomainData(buf);
        let sum = 0;
        for (let i = 0; i < buf.length; i++) { const d = (buf[i] - 128) / 128; sum += d * d; }
        samples.push(Math.sqrt(sum / buf.length));
      }, 60);
      recorder._waveSamples = samples;
      recorder._waveCleanup = () => { clearInterval(tick); try { src.disconnect(); ac.close(); } catch {/* ignore */} };
    } catch {/* waveform is best-effort — recording works without it */}

    recorder.start();
    return recorder;
  } catch (error) {
    console.error("Error accessing microphone:", error);
    throw error;
  }
};

/** Downsample raw RMS samples to `bars` peak-normalized ints (0-100). */
export function waveformFromSamples(samples, bars = 40) {
  if (!samples?.length) return null;
  const out = [];
  for (let i = 0; i < bars; i++) {
    const a = Math.floor((i / bars) * samples.length);
    const b = Math.max(a + 1, Math.floor(((i + 1) / bars) * samples.length));
    let peak = 0;
    for (let j = a; j < b; j++) peak = Math.max(peak, samples[j]);
    out.push(peak);
  }
  const max = Math.max(...out, 0.001);
  return out.map(v => Math.max(4, Math.round((v / max) * 100)));
}

/**
 * Stops recording and returns the audio blob. The recorder's real waveform
 * (if sampled) lands on `recorder._waveform` as 0-100 ints.
 */
export const stopVoiceRecording = (recorder) => {
  return new Promise((resolve) => {
    recorder.onstop = () => {
      try { recorder._waveCleanup?.(); } catch {/* ignore */}
      recorder._waveform = waveformFromSamples(recorder._waveSamples);
      const blob = new Blob(recorder._chunks, { type: 'audio/webm' });
      recorder._stream?.getTracks().forEach(t => t.stop());
      resolve(blob);
    };
    recorder.stop();
  });
};

/**
 * Starts a round-message style VIDEO recording (front camera + mic).
 * Returns a MediaRecorder; `recorder._stream` is exposed so the caller can
 * attach it to a <video> for a live preview while recording (Telegram/IG).
 */
export const startVideoRecording = async () => {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 640 } },
    audio: true,
  });
  // Pick the first MIME the platform actually supports. Prefer VP8 — the Android
  // System WebView reports vp9 as "supported" but frequently can't encode it in
  // real time (→ a 0-byte recording), whereas vp8 records reliably everywhere.
  // mp4/H.264 is the last-resort fallback for WebViews without webm.
  const mime = [
    'video/webm;codecs=vp8,opus',
    'video/webm;codecs=vp9,opus',
    'video/webm',
    'video/mp4',
  ].find(t => { try { return MediaRecorder.isTypeSupported?.(t); } catch { return false; } }) || 'video/webm';
  const recorder = new MediaRecorder(stream, { mimeType: mime });
  const chunks = [];
  recorder.ondataavailable = (e) => { if (e.data && e.data.size > 0) chunks.push(e.data); };
  recorder.onerror = (e) => { recorder._error = e?.error || e; };
  recorder._chunks = chunks;
  recorder._stream = stream;
  // Store the BASE mime only (strip any `;codecs=...`). R2's upload allowlist
  // matches the content-type EXACTLY ('video/webm'), so a codec-qualified
  // type like 'video/webm;codecs=vp9,opus' would be rejected and the upload
  // (and therefore the whole send) would silently fail.
  recorder._mime = (mime.split(';')[0] || 'video/webm');
  // Start WITH a timeslice so `dataavailable` fires periodically and chunks
  // accumulate during the recording. Without it, some Android WebViews emit the
  // single `dataavailable` AFTER `onstop`, so the blob is built empty → the send
  // is silently skipped (the exact native "video message doesn't send" bug).
  recorder.start(250);
  return recorder;
};

/**
 * Stops a video recording and returns the video blob (bare-MIME, R2-safe).
 * Resolves only AFTER the final `dataavailable` has been flushed, so the blob is
 * never built empty due to the WebView's dataavailable/onstop ordering.
 */
export const stopVideoRecording = (recorder) => {
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      const blob = new Blob(recorder._chunks, { type: recorder._mime || 'video/webm' });
      recorder._stream?.getTracks().forEach(t => t.stop());
      resolve(blob);
    };
    recorder.onstop = finish;
    // Safety net: if onstop never fires on this WebView, settle shortly after stop.
    setTimeout(finish, 1500);
    try { recorder.requestData?.(); } catch { /* not all impls support it */ }
    try { recorder.stop(); } catch { finish(); }
  });
};

/**
 * Uploads a file to Firebase Storage with client-side compression and TTL metadata.
 * @param {File} file - The file to upload
 * @param {string} folder - Storage folder path
 * @param {string} tier - User tier: 'free' | 'lite' | 'pro'
 * @param {number} ttlDays - Days until server copy should expire
 * @param {string} preset - Compression preset: 'chat' | 'post' | 'avatar' | 'background'
 * @returns {Promise<string>} Download URL
 */
export const uploadMediaFile = async (
  file, folder = 'chat_media', tier = 'free', ttlDays = 7, preset = 'chat', onProgress, opts = {},
) => {
  const compressed = await compressMedia(file, tier, preset, opts);
  const kind = folder.startsWith('post') ? 'post' : 'post';
  // onProgress receives (percent, sentBytes, totalBytes). The byte figures come
  // from the native bridge and are what lets a chat bubble show "2.1 / 8.4 MB"
  // rather than an indefinite spinner.
  const { url } = await uploadToR2(compressed, kind, onProgress);
  return url;
};

/**
 * Uploads a blob (like voice recording) to R2.
 */
export const uploadBlob = async (blob, folder = 'voice_notes', ext = 'webm') => {
  const file = new File([blob], `recording.${ext}`, { type: blob.type || `audio/${ext}` });
  const { url } = await uploadToR2(file, 'post');
  return url;
};

/**
 * Helper to check if a string is a YouTube link and extract the ID.
 */
export const getYouTubeID = (url) => {
  if (!url || typeof url !== 'string') return null;
  const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|&v=)([^#&?]*).*/;
  const match = url.match(regExp);
  return (match && match[2].length === 11) ? match[2] : null;
};