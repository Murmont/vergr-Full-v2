// SmoothWaveform — canvas-rendered audio waveform that breathes with mic level.
// Replaces the bar-graph audio meter with a single smooth wave.
//
// Reads the live AnalyserNode (passed via prop) or falls back to a synthetic
// idle wave if no analyser is provided. Renders at 60fps via requestAnimationFrame.
//
// Visual: a stroked spline that pulses based on RMS over the time-domain buffer.
// Color: gradient cyan→violet with subtle glow.

import { useEffect, useRef } from 'react';
import { prefersReducedMotion } from './springs';

export default function SmoothWaveform({
  analyser,         // AudioContext AnalyserNode (preferred — real audio drives the wave)
  level = 0,        // fallback 0..100 amplitude when no analyser provided
  height = 36,
  className = '',
  colorStart = '#B44FFF',
  colorEnd = '#b44fff',
}) {
  const canvasRef = useRef(null);
  const rafRef = useRef(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const reduced = prefersReducedMotion();
    const dpr = Math.min(2, window.devicePixelRatio || 1);

    const resize = () => {
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    // Pre-allocate buffer for analyser reads.
    let buf = analyser ? new Uint8Array(analyser.fftSize || 1024) : null;
    let t = 0;

    const tick = () => {
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      ctx.clearRect(0, 0, w, h);

      // Compute amplitude (0..1).
      let amp = 0.08;
      if (analyser) {
        if (!buf || buf.length !== analyser.fftSize) buf = new Uint8Array(analyser.fftSize);
        analyser.getByteTimeDomainData(buf);
        let sumSq = 0;
        for (let i = 0; i < buf.length; i++) {
          const v = (buf[i] - 128) / 128;
          sumSq += v * v;
        }
        amp = Math.min(1, Math.sqrt(sumSq / buf.length) * 2.4);
      } else {
        amp = Math.max(0.06, Math.min(1, (level || 0) / 100));
      }

      // Build a stroked spline. Use a sum of two sines for a more organic shape.
      ctx.lineWidth = 2;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      const grad = ctx.createLinearGradient(0, 0, w, 0);
      grad.addColorStop(0, colorStart);
      grad.addColorStop(1, colorEnd);
      ctx.strokeStyle = grad;
      ctx.shadowBlur = 6 + amp * 10;
      ctx.shadowColor = colorEnd;

      ctx.beginPath();
      const mid = h / 2;
      const steps = Math.max(32, Math.floor(w / 4));
      const amplitudePx = (h / 2 - 4) * amp;
      for (let i = 0; i <= steps; i++) {
        const x = (i / steps) * w;
        const phase = (i / steps) * Math.PI * 4 + t;
        const y = mid + Math.sin(phase) * amplitudePx * 0.7
                      + Math.sin(phase * 1.7 + 0.6) * amplitudePx * 0.3;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();

      if (!reduced) t += 0.045 + amp * 0.08;
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(rafRef.current);
      ro.disconnect();
    };
  }, [analyser, level, colorStart, colorEnd]);

  return (
    <canvas
      ref={canvasRef}
      className={className}
      style={{ width: '100%', height, display: 'block' }}
    />
  );
}
