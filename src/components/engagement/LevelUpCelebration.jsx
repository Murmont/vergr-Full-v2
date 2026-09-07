// ⚠⚠ THIS SCREEN BROKE THREE OF THE FOUNDER'S STANDING VISUAL RULES AT ONCE, and it
// survived every earlier sweep because it is a TRANSIENT — it had timed out by the time
// each DOM walk ran. Measured on the deployed page 2026-09-03 with a control run (zero
// ghost outlines before firing, four after):
//
//   the card        rgb(20,20,31) fill under a rgba(255,255,255,0.08) edge
//   the level badge rgba(180,79,255,0.082) fill under a rgba(180,79,255,0.19) edge
//   each unlock row rgba(180,79,255,0.063) fill under a rgba(180,79,255,0.133) edge
//   Continue        rgba(180,79,255,0.082) fill under a rgba(180,79,255,0.145) edge
//
// Every one of them is a tint doing no work with a hairline doing the separating, which
// is the pattern the poll card was fixed for. Continue is worse than the rest: it is the
// PRIMARY ACTION of a celebration screen, and a selected/primary state is a SOLID accent
// fill, never a tint plus a ring. Its label also measured 4.41:1 against the 4.5 floor.
//
// ⚠ THE INK CANNOT BE HARDCODED, because `color` is the TIER colour and the tiers run
// from Bronze to Diamond. White on Bronze is 3.3:1 and white on Gold is worse. ensureContrast
// solves it per tier and in whichever direction has headroom.
import { ensureContrast } from '../../utils/color';
import { unlocksForLevel, nextUnlock, UNLOCK_SURFACE } from '../../utils/rankUnlocks';
import { motion, AnimatePresence } from 'framer-motion';
import Icon from '../Icon';

export default function LevelUpCelebration({ show = false, level = 1, tierName = 'Silver', onClose }) {
  // What this level ACTUALLY gave you. The modal used to say "keep going to
  // unlock new perks, badges and ring colours", which named nothing, promised
  // things that no longer exist (rank does not colour your avatar ring), and
  // was the same sentence at level 3 and level 90. RANK_UNLOCKS is the truth.
  const gained = unlocksForLevel(level);
  const upNext = nextUnlock(level);
  const tierColors = {
    Bronze: '#CD7F32',
    Silver: '#C0C0C0',
    Gold: '#FFD700',
    Platinum: '#E5E4E2',
    Diamond: '#B9F2FF',
  };
  const color = tierColors[tierName] || '#B44FFF';
  // Type that sits ON the solid tier fill, guaranteed to clear 4.5:1 for every tier.
  const ink = ensureContrast('#0B0B14', color, 4.5);
  // ⚠ AND THE TIER NAME SITS ON THE CARD, NOT ON THE FILL. Measured 4.49:1 — one
  // hundredth under the floor, which is still under it. bg-surface-2 is #1A1A2A.
  const onCard = ensureContrast(color, '#1A1A2A', 4.5);

  return (
    <AnimatePresence>
      {show && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
          onClick={onClose}
        >
          <motion.div
            initial={{ scale: 0.9, opacity: 0, y: 20 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.95, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 400, damping: 30 }}
            className="relative bg-surface-2 rounded-2xl p-8 text-center max-w-[320px] w-full mx-4 shadow-[0_24px_60px_rgba(0,0,0,0.6)]"
            onClick={e => e.stopPropagation()}
          >
            <div
              className="w-16 h-16 rounded-2xl mx-auto mb-5 flex items-center justify-center"
              style={{ backgroundColor: color }}
            >
              <span className="text-3xl font-black font-dmmono" style={{ color: ink }}>{level}</span>
            </div>

            <h2 className="font-syne text-text-primary text-xl font-bold mb-1">
              Level Up
            </h2>

            <p className="text-sm mb-1" style={{ color: onCard }}>
              {tierName} Tier
            </p>

            {gained.length > 0 ? (
              <div className="w-full space-y-1.5 mb-5">
                {gained.map((u) => (
                  <div key={u.id} className="flex items-start gap-2 text-left px-3 py-2 rounded-xl bg-surface-1">
                    <Icon name={UNLOCK_SURFACE[u.surface]?.icon || 'star'} size={14}
                          className="mt-0.5 shrink-0" style={{ color }} />
                    <div className="min-w-0">
                      <p className="text-xs font-bold text-text-primary">{u.name}</p>
                      <p className="text-[11px] text-text-muted leading-snug">{u.desc}</p>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-text-muted text-xs mb-6">Your rank is climbing. Keep going.</p>
            )}

            {upNext && (
              <p className="text-text-muted text-[11px] mb-5">
                Next: <span className="font-bold text-text-secondary">{upNext.name}</span>
                {' '}at level <span className="font-dmmono font-bold">{upNext.level}</span>
              </p>
            )}

            <button
              onClick={onClose}
              className="w-full py-3 rounded-xl font-semibold text-sm transition-colors"
              style={{ backgroundColor: color, color: ink }}
            >
              Continue
            </button>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
