// Skeleton primitives shaped like the real components they replace.
// Banned: gray rectangles. Skeletons must match the layout the user is
// about to see so the transition is seamless.
//
// All variants use the same shimmer animation (CSS keyframe) and respect
// prefers-reduced-motion (static muted-gray when reduced).

import { prefersReducedMotion } from './springs';

const shimmerStyle = (reduced) => ({
  background: reduced
    ? 'rgba(255,255,255,0.04)'
    : 'linear-gradient(90deg, rgba(255,255,255,0.04) 0%, rgba(255,255,255,0.10) 50%, rgba(255,255,255,0.04) 100%)',
  backgroundSize: '200% 100%',
  animation: reduced ? 'none' : 'vergr-shimmer 1.4s linear infinite',
});

const KEYFRAMES = `
@keyframes vergr-shimmer {
  0% { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}
`;

let injected = false;
function ensureKeyframes() {
  if (injected || typeof document === 'undefined') return;
  injected = true;
  const style = document.createElement('style');
  style.textContent = KEYFRAMES;
  document.head.appendChild(style);
}

export function SkeletonBlock({ width = '100%', height = 16, radius = 6, style }) {
  ensureKeyframes();
  const reduced = prefersReducedMotion();
  return (
    <div style={{
      width, height, borderRadius: radius,
      ...shimmerStyle(reduced), ...style,
    }}/>
  );
}

export function SkeletonAvatar({ size = 36 }) {
  ensureKeyframes();
  const reduced = prefersReducedMotion();
  return (
    <div style={{
      width: size, height: size, borderRadius: '50%',
      flexShrink: 0, ...shimmerStyle(reduced),
    }}/>
  );
}

/** Stream tile skeleton — 16/9 video + host bar underneath. */
export function SkeletonStreamTile() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <SkeletonBlock height={undefined} style={{ aspectRatio: '16/9', borderRadius: 12 }}/>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <SkeletonAvatar size={32}/>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4 }}>
          <SkeletonBlock width="65%" height={12}/>
          <SkeletonBlock width="40%" height={10}/>
        </div>
      </div>
    </div>
  );
}

/** Chat-row skeleton — used while messages first load. */
export function SkeletonChatRow() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0' }}>
      <SkeletonAvatar size={20}/>
      <SkeletonBlock width={70} height={10}/>
      <SkeletonBlock width="40%" height={10}/>
    </div>
  );
}

/** Host bar skeleton (avatar + name + follow button shape). */
export function SkeletonHostBar() {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 12,
      padding: 14, borderRadius: 12,
      background: 'rgba(255,255,255,0.02)',
      border: '1px solid rgba(255,255,255,0.06)',
    }}>
      <SkeletonAvatar size={40}/>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 5 }}>
        <SkeletonBlock width="40%" height={13}/>
        <SkeletonBlock width="65%" height={10}/>
      </div>
      <SkeletonBlock width={80} height={32} radius={8}/>
    </div>
  );
}
