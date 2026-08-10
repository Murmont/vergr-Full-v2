import { motion, AnimatePresence } from 'framer-motion';

export default function LevelUpCelebration({ show = false, level = 1, tierName = 'Silver', onClose }) {
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

            <p className="text-text-muted text-xs mb-6">
              Keep going to unlock new perks and lower commissions.
            </p>

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
