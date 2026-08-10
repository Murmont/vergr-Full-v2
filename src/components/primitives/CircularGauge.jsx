// CircularGauge — animated SVG ring with a numeric center.
// Used in the broadcaster studio for stream-health (bitrate / latency / quality).
// Spring-physics on the fill, color shifts by zone (good/warn/bad).

import { motion } from 'framer-motion';
import { spring } from './springs';

export default function CircularGauge({
  value,                 // current value
  min = 0,
  max = 100,
  size = 86,
  thickness = 8,
  label = '',
  unit = '',
  zones = [              // [{ until, color }] sorted ascending; first match wins
    { until: 33, color: '#ef4444' },
    { until: 66, color: '#f59e0b' },
    { until: 100, color: '#22c55e' },
  ],
  trackColor = 'rgba(255,255,255,0.08)',
  fmtValue = (v) => Math.round(v).toString(),
}) {
  const radius = (size - thickness) / 2;
  const circumference = 2 * Math.PI * radius;
  const clamped = Math.max(min, Math.min(max, value || 0));
  const pct = (clamped - min) / (max - min);
  const offset = circumference * (1 - pct);
  const pctScaled = pct * 100;
  const color = zones.find((z) => pctScaled <= z.until)?.color || zones[zones.length - 1].color;

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
    }}>
      <div style={{ position: 'relative', width: size, height: size }}>
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke={trackColor}
            strokeWidth={thickness}
          />
          <motion.circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke={color}
            strokeWidth={thickness}
            strokeLinecap="round"
            strokeDasharray={circumference}
            initial={false}
            animate={{ strokeDashoffset: offset, stroke: color }}
            transition={spring.gentle}
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
          />
        </svg>
        <div style={{
          position: 'absolute', inset: 0,
          display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center',
        }}>
          <div style={{
            fontSize: size * 0.22, fontWeight: 800, color: '#fff',
            fontFamily: 'DM Mono, ui-monospace, monospace', lineHeight: 1,
          }}>{fmtValue(clamped)}</div>
          {unit && (
            <div style={{
              fontSize: 9, color: 'rgba(255,255,255,0.55)',
              textTransform: 'uppercase', letterSpacing: '0.06em',
              marginTop: 2,
            }}>{unit}</div>
          )}
        </div>
      </div>
      {label && (
        <div style={{
          fontSize: 10, color: 'rgba(255,255,255,0.55)',
          textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 700,
        }}>{label}</div>
      )}
    </div>
  );
}
