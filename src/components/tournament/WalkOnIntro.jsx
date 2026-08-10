// WalkOnIntro — UFC-style player intro card.
//
// Shown for ~5 seconds before round 1 starts. Renders both players' avatar,
// username, Vanguard rank badge (if any), recent W/L, and their trust score
// (when visible). Animates in from the sides, holds, then fades.
//
// Used by TournamentMatchScreen on first render when match.status === 'pending'
// and round === 1 and !introShown.

import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import UserAvatar from '../UserAvatar';
import useMaskedUser from '../../hooks/useMaskedUser';
import { haptic } from '../../utils/haptics';

const C = {
  gold: '#F0A500',
  goldLight: '#F5C842',
  cyan: '#B44FFF',
  text: '#fff',
  dim: 'rgba(255,255,255,0.65)',
};

export default function WalkOnIntro({ player1, player2, trust1, trust2, durationMs = 5000, onDone }) {
  const [open, setOpen] = useState(true);
  const p1 = useMaskedUser(player1) || player1;
  const p2 = useMaskedUser(player2) || player2;

  useEffect(() => {
    haptic.success();
    try {
      // Light walk-on sting from the existing tournament sounds set if present.
      const a = new Audio('/sounds/walkon.mp3');
      a.volume = 0.5;
      a.play().catch(() => {});
    } catch {}
    const t = setTimeout(() => { setOpen(false); setTimeout(() => onDone?.(), 600); }, durationMs);
    return () => clearTimeout(t);
  }, [durationMs, onDone]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          style={{
            position: 'fixed', inset: 0, zIndex: 9999,
            background: 'radial-gradient(circle at center, rgba(0,0,0,0.85), rgba(0,0,0,0.95))',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            backdropFilter: 'blur(8px)',
          }}
        >
          <div style={{ position: 'absolute', top: '20%', textAlign: 'center' }}>
            <div style={{
              fontFamily: 'Syne, sans-serif', fontSize: 12, fontWeight: 900,
              color: C.gold, textTransform: 'uppercase', letterSpacing: '0.4em',
            }}>VERGR Tournament</div>
            <div style={{
              fontFamily: 'Syne, sans-serif', fontSize: 28, fontWeight: 900,
              color: C.text, marginTop: 6,
            }}>Round 1</div>
          </div>

          <div style={{
            display: 'flex', alignItems: 'center', gap: 48,
            maxWidth: '90vw',
          }}>
            <PlayerWalk side="left" user={p1} trust={trust1} />
            <motion.div
              initial={{ scale: 0, rotate: -180 }}
              animate={{ scale: 1, rotate: 0 }}
              transition={{ delay: 1.2, type: 'spring', stiffness: 200 }}
              style={{
                fontFamily: 'Syne, sans-serif', fontSize: 56, fontWeight: 900,
                color: C.gold,
                textShadow: `0 0 30px ${C.gold}88`,
              }}
            >VS</motion.div>
            <PlayerWalk side="right" user={p2} trust={trust2} />
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function PlayerWalk({ side, user, trust }) {
  const fromX = side === 'left' ? -200 : 200;
  return (
    <motion.div
      initial={{ x: fromX, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      transition={{ duration: 0.8, type: 'spring', stiffness: 80 }}
      style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12,
        minWidth: 200,
      }}
    >
      <div style={{
        padding: 4, borderRadius: '50%',
        background: `linear-gradient(135deg, ${C.gold}, ${C.goldLight})`,
        boxShadow: `0 0 40px ${C.gold}66`,
      }}>
        <UserAvatar uid={user?.id} username={user?.username} size="2xl" />
      </div>
      <div style={{
        fontFamily: 'Syne, sans-serif', fontSize: 22, fontWeight: 900,
        color: C.text, textAlign: 'center',
      }}>
        {user?.username || '…'}
      </div>
      {trust?.visible && (
        <div style={{ fontFamily: 'DM Mono, monospace', fontSize: 11, color: C.cyan }}>
          TRUST {trust.score}
        </div>
      )}
    </motion.div>
  );
}
