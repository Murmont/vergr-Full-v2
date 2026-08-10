import { motion } from 'framer-motion';
import Icon from './Icon';
import { getVPLevel, getVPProgress, getNextVPLevel, VP_LEVELS } from '../utils/vpSystem';

const RING_GRADIENTS = {
  bronze:   'from-amber-700 to-amber-500',
  silver:   'from-gray-400 to-gray-300',
  gold:     'from-yellow-500 to-amber-400',
  platinum: 'from-cyan-400 to-teal-300',
  diamond:  'from-violet-500 to-indigo-400',
  mythic:   'from-purple-500 via-pink-500 to-purple-500',
};

export default function VPLevelBadge({ vp = 0, size = 'md', showProgress = false }) {
  const level = getVPLevel(vp);
  const progress = getVPProgress(vp);
  const next = getNextVPLevel(vp);

  if (size === 'xs') {
    return (
      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-surface-2 border border-white/[0.06]">
        {level.ring && <span className="w-2 h-2 rounded-full" style={{ background: level.ringColor }} />}
        <span className="text-[8px] font-bold uppercase tracking-wider" style={{ color: level.ringColor || '#7B82A8' }}>{level.name}</span>
      </span>
    );
  }

  if (size === 'sm') {
    return (
      <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-surface-2 border border-white/[0.06]">
        {level.ring && <span className="w-2.5 h-2.5 rounded-full" style={{ background: level.ringColor }} />}
        <span className="text-[9px] font-bold uppercase tracking-wider" style={{ color: level.ringColor || '#7B82A8' }}>{level.name}</span>
        <span className="text-[8px] text-text-muted font-dmmono">Lv{level.level}</span>
      </span>
    );
  }

  // Medium — with progress bar
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2">
        {level.ring && (
          <div className={`w-5 h-5 rounded-full bg-gradient-to-br ${RING_GRADIENTS[level.ring] || ''}`} />
        )}
        <span className="text-sm font-bold" style={{ color: level.ringColor || '#7B82A8' }}>{level.name}</span>
        <span className="text-xs text-text-muted font-dmmono">Lv{level.level}</span>
      </div>
      {showProgress && next && (
        <div className="flex items-center gap-2">
          <div className="flex-1 h-1.5 bg-surface-3 rounded-full overflow-hidden">
            <motion.div
              className="h-full rounded-full"
              initial={{ width: 0 }}
              animate={{ width: `${progress}%` }}
              transition={{ type: 'spring', stiffness: 100, damping: 20, delay: 0.3 }}
              style={{ background: level.ringColor || '#7B82A8' }}
            />
          </div>
          <span className="text-[9px] text-text-muted font-dmmono">{vp.toLocaleString()}/{next.vpRequired.toLocaleString()}</span>
        </div>
      )}
    </div>
  );
}

// Ring around avatar based on VP level
export function VPAvatarRing({ vp = 0, children, size = 44 }) {
  const level = getVPLevel(vp);
  if (!level.ring) return children;

  const isAnimated = level.ring === 'mythic';
  const padding = 3;

  return (
    <div className="relative inline-block" style={{ width: size + padding * 2, height: size + padding * 2 }}>
      <div
        className={`absolute inset-0 rounded-full ${isAnimated ? 'animate-spin-slow' : ''}`}
        style={{
          background: isAnimated
            ? `conic-gradient(${level.ringColor}, #C87FFF, #7B6FFF, #B44FFF, ${level.ringColor})`
            : level.ringColor,
          padding: 2,
          borderRadius: '50%',
        }}
      >
        <div className="w-full h-full rounded-full bg-bg-dark" />
      </div>
      <div className="absolute" style={{ top: padding, left: padding }}>
        {children}
      </div>
    </div>
  );
}
