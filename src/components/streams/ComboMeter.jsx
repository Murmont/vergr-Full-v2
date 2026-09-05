// ComboMeter — the rapid-tap power bar that fills as a viewer spams the like
// button, and the xN counter above it.
//
// ⚠ EXTRACTED FROM MobileLiveViewer, NOT REWRITTEN. It was defined inside that
// screen and not exported, so the stream simulator could not show it and the
// founder noticed it missing: "we used to have a progress bar thing when a user
// clicks like enough times, where did it go?". Importing it from the screen
// would have pulled the whole live viewer into the admin chunk, so it lives
// here and BOTH sides import it — one definition, no drift.
//
// ⚠ THE DECAY IS THE POINT. It fills on rapid taps and empties 1.1s after the
// last one, so the bar rewards a burst rather than a total. A meter that only
// ever goes up is a score; this is a streak.
import { motion, AnimatePresence } from 'framer-motion';

// Taps to fill the bar. Also the point the celebratory burst fires.
export const HEART_COMBO_MAX = 30;

export default function ComboMeter({ combo, max = HEART_COMBO_MAX, style }) {
  const pct = Math.min(1, combo / max);
  return (
    <AnimatePresence>
      {combo > 1 && (
        <motion.div
          initial={{ opacity: 0, scale: 0.7, y: 8 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.7 }}
          style={{ position: 'absolute', right: 9, bottom: 112, zIndex: 9, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5, pointerEvents: 'none', ...style }}
        >
          <motion.div
            key={combo}
            initial={{ scale: 1.35 }} animate={{ scale: 1 }} transition={{ type: 'spring', stiffness: 500, damping: 18 }}
            style={{ fontSize: 14, fontWeight: 900, fontStyle: 'italic', color: '#fff', textShadow: '0 1px 8px rgba(255,45,79,0.85)' }}
          >x{combo}</motion.div>
          <div style={{ width: 6, height: 92, borderRadius: 999, background: 'rgba(255,255,255,0.16)', overflow: 'hidden', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }}>
            <motion.div
              animate={{ height: `${pct * 100}%` }} transition={{ type: 'spring', stiffness: 280, damping: 26 }}
              style={{ width: '100%', background: 'linear-gradient(180deg, #ffd23f, #ff2d4f)', borderRadius: 999 }}
            />
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
