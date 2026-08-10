// HypeMeter — viewer-reactions-per-second visual gauge.
//
// Reads streams/{streamId}.hype = { count, windowStartedAtMs, peak }
// updated server-side every 5s by an aggregator (see functions/streamHype.js).
// Renders as a vertical bar that pulses + glows louder as the rate climbs.
//
// Two modes:
//   compact: small badge for spectator HUD
//   broadcaster: tall bar for the player's HUD (lets them feel the crowd)

import { useEffect, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '../../firebase/config';
import { motion } from 'framer-motion';

const C = {
  cyan: '#B44FFF', pink: '#C87FFF', gold: '#F0A500',
  text: '#fff', dim: 'rgba(255,255,255,0.55)',
};

export default function HypeMeter({ streamId, mode = 'compact' }) {
  const [hype, setHype] = useState({ count: 0, peak: 0 });
  useEffect(() => {
    if (!streamId) return;
    const unsub = onSnapshot(doc(db, 'streams', streamId), (snap) => {
      const h = snap.data()?.hype || {};
      setHype({ count: h.count || 0, peak: h.peak || 0 });
    });
    return () => unsub();
  }, [streamId]);

  const intensity = Math.min(1, hype.count / Math.max(50, hype.peak || 50));
  const color = intensity > 0.8 ? C.gold : intensity > 0.4 ? C.pink : C.cyan;

  // No hype yet → render nothing (an empty dark bar/badge is just visual noise).
  if (!hype.count && !hype.peak) return null;

  if (mode === 'compact') {
    return (
      <motion.div
        animate={{ scale: 1 + intensity * 0.06 }}
        transition={{ duration: 0.25 }}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 6,
          padding: '4px 10px', borderRadius: 999,
          background: `${color}22`, border: `1px solid ${color}66`,
          color, fontSize: 11, fontWeight: 800, fontFamily: 'DM Mono, monospace',
        }}
        title={`Reactions/5s · peak ${hype.peak}`}
      >
        🔥 {hype.count}
      </motion.div>
    );
  }

  // broadcaster mode — vertical bar
  return (
    <div style={{
      width: 22, height: 140, borderRadius: 6,
      background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)',
      position: 'relative', overflow: 'hidden',
    }}>
      <motion.div
        animate={{ height: `${intensity * 100}%` }}
        transition={{ type: 'spring', stiffness: 80, damping: 14 }}
        style={{
          position: 'absolute', bottom: 0, left: 0, right: 0,
          background: `linear-gradient(180deg, ${color}, ${color}66)`,
          boxShadow: `0 0 18px ${color}99`,
        }}
      />
      <div style={{
        position: 'absolute', bottom: -22, left: -6, right: -6,
        textAlign: 'center', fontSize: 9, color: C.dim,
        fontFamily: 'DM Mono, monospace',
      }}>HYPE</div>
    </div>
  );
}
