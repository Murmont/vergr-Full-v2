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
            className="relative bg-surface-1 border border-white/[0.08] rounded-2xl p-8 text-center max-w-[320px] w-full mx-4"
            onClick={e => e.stopPropagation()}
          >
            <div
              className="w-16 h-16 rounded-2xl mx-auto mb-5 flex items-center justify-center"
              style={{ backgroundColor: color + '15', border: `1px solid ${color}30` }}
            >
              <span className="text-3xl font-black font-dmmono" style={{ color }}>{level}</span>
            </div>

            <h2 className="font-syne text-text-primary text-xl font-bold mb-1">
              Level Up
            </h2>

            <p className="text-sm mb-1" style={{ color }}>
              {tierName} Tier
            </p>

            {gained.length > 0 ? (
              <div className="w-full space-y-1.5 mb-5">
                {gained.map((u) => (
                  <div key={u.id} className="flex items-start gap-2 text-left px-3 py-2 rounded-xl"
                       style={{ background: color + '10', border: `1px solid ${color}22` }}>
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
              style={{ backgroundColor: color + '15', color, border: `1px solid ${color}25` }}
            >
              Continue
            </button>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
