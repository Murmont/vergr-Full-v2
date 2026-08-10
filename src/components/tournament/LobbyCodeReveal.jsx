// LobbyCodeReveal — 3-2-1 countdown then character-by-character flip
// reveal of the lobby code. Plays once when the match screen first mounts.
// Subsequent visits show the static code (see TournamentMatchScreen).

import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { haptic } from '../../utils/haptics';

const C = {
  bg: '#0B0B14',
  gold: '#F0A500', goldLight: '#F5C842',
  text: '#fff', dim: 'rgba(255,255,255,0.65)',
};

export default function LobbyCodeReveal({ code, onDone }) {
  const [stage, setStage] = useState('countdown'); // 'countdown' | 'reveal' | 'done'
  const [count, setCount] = useState(3);

  useEffect(() => {
    if (stage !== 'countdown') return;
    if (count === 0) { setStage('reveal'); haptic.success(); return; }
    haptic.tick?.();
    const t = setTimeout(() => setCount((c) => c - 1), 700);
    return () => clearTimeout(t);
  }, [stage, count]);

  useEffect(() => {
    if (stage !== 'reveal') return;
    const t = setTimeout(() => { setStage('done'); onDone?.(); }, 2200);
    return () => clearTimeout(t);
  }, [stage, onDone]);

  return (
    <AnimatePresence>
      {stage !== 'done' && (
        <motion.div
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          style={{
            position: 'fixed', inset: 0, zIndex: 9998,
            background: 'rgba(11,11,20,0.92)', backdropFilter: 'blur(6px)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        >
          {stage === 'countdown' ? (
            <motion.div
              key={count}
              initial={{ scale: 0.4, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 2.5, opacity: 0 }}
              transition={{ duration: 0.5 }}
              style={{
                fontFamily: 'Syne, sans-serif', fontSize: 160, fontWeight: 900,
                color: C.gold,
                textShadow: `0 0 60px ${C.gold}88`,
              }}
            >
              {count === 0 ? '🎮' : count}
            </motion.div>
          ) : (
            <div style={{ textAlign: 'center' }}>
              <motion.div
                initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }}
                style={{
                  fontSize: 11, fontWeight: 900, color: C.gold,
                  textTransform: 'uppercase', letterSpacing: '0.4em',
                }}
              >Your lobby code</motion.div>
              <div style={{ display: 'flex', gap: 6, justifyContent: 'center', marginTop: 24 }}>
                {(code || '').split('').map((ch, i) => (
                  <motion.div
                    key={i}
                    initial={{ rotateX: -90, opacity: 0 }}
                    animate={{ rotateX: 0, opacity: 1 }}
                    transition={{ delay: 0.08 * i, type: 'spring', stiffness: 200 }}
                    style={{
                      width: ch === '-' ? 24 : 42, height: 56,
                      borderRadius: 10,
                      background: ch === '-' ? 'transparent'
                        : `linear-gradient(135deg, ${C.gold}33, ${C.goldLight}11)`,
                      border: ch === '-' ? 'none' : `1px solid ${C.gold}88`,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontFamily: 'DM Mono, monospace', fontSize: 28, fontWeight: 900,
                      color: C.text,
                    }}
                  >{ch}</motion.div>
                ))}
              </div>
              <motion.div
                initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1.2 }}
                style={{ fontSize: 12, color: C.dim, marginTop: 18 }}
              >Show this in-game so we can verify</motion.div>
            </div>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
