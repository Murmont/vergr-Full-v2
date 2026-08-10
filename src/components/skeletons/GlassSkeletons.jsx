import './GlassSkeletons.css';

// Frosted glass shimmer block. `index` staggers the diagonal sweep (80ms cascade).
export function GlassSkeleton({ variant = 'card', width, height, index = 0, radius, style, className = '' }) {
  const sweepDelay = `${(index * 80) % 2400}ms`;
  return (
    <div
      className={`gs gs-${variant} ${className}`}
      style={{ width, height, ...(radius != null ? { borderRadius: radius } : {}), '--sweep-delay': sweepDelay, ...style }}
    >
      <div className="gs-bg" />
      <div className="gs-border" />
      <div className="gs-sweep" />
    </div>
  );
}

// One post-card placeholder shaped like PostCard (avatar + name + body + media + actions).
function PostCardSkeleton({ base = 0 }) {
  return (
    <div style={{ padding: '16px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
        <GlassSkeleton variant="circle" width={40} height={40} index={base} />
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
          <GlassSkeleton width="42%" height={11} index={base + 1} />
          <GlassSkeleton width="26%" height={9} index={base + 2} />
        </div>
        <GlassSkeleton width={24} height={24} radius={6} index={base + 3} />
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 7, marginBottom: 12 }}>
        <GlassSkeleton width="92%" height={11} index={base + 2} />
        <GlassSkeleton width="68%" height={11} index={base + 3} />
      </div>
      <GlassSkeleton variant="hero" height={200} index={base + 4} style={{ width: '100%' }} />
      <div style={{ display: 'flex', gap: 10, marginTop: 12 }}>
        <GlassSkeleton width={64} height={26} radius={999} index={base + 5} />
        <GlassSkeleton width={64} height={26} radius={999} index={base + 6} />
        <GlassSkeleton width={64} height={26} radius={999} index={base + 7} />
      </div>
    </div>
  );
}

// Full feed loading state — a few staggered post-card skeletons.
export function FeedSkeleton({ count = 3 }) {
  return (
    <div aria-busy="true" aria-label="Loading feed">
      {Array.from({ length: count }).map((_, i) => (
        <PostCardSkeleton key={i} base={i * 8} />
      ))}
    </div>
  );
}

// Generic list — avatar + 2 text lines + meta. For DM inbox, friends, search,
// leaderboard, follow lists, etc.
export function ListSkeleton({ rows = 6, withAvatar = true, withMeta = true }) {
  return (
    <div aria-busy="true" aria-label="Loading list">
      {Array.from({ length: rows }).map((_, i) => {
        const b = i * 4;
        return (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
            {withAvatar && <GlassSkeleton variant="circle" width={40} height={40} index={b} />}
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
              <GlassSkeleton width="48%" height={11} index={b + 1} />
              <GlassSkeleton width="72%" height={9} index={b + 2} />
            </div>
            {withMeta && <GlassSkeleton width={44} height={10} index={b + 3} />}
          </div>
        );
      })}
    </div>
  );
}

// Generic responsive card grid — image + 2 lines. For explore, tournaments,
// shorts grids, etc.
export function CardGridSkeleton({ count = 6, columns = 2, aspect = '4/5' }) {
  return (
    <div aria-busy="true" aria-label="Loading grid" style={{ display: 'grid', gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`, gap: 12, padding: 12 }}>
      {Array.from({ length: count }).map((_, i) => {
        const b = i * 4;
        return (
          <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <GlassSkeleton variant="thumb" index={b} style={{ width: '100%', aspectRatio: aspect }} />
            <GlassSkeleton width="78%" height={11} index={b + 1} />
            <GlassSkeleton width="52%" height={9} index={b + 2} />
          </div>
        );
      })}
    </div>
  );
}

// Profile page — banner + avatar + name + 3 stats + tabs + thumb grid.
export function ProfileSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading profile">
      <GlassSkeleton variant="hero" height={140} index={0} style={{ width: '100%', borderRadius: 0 }} />
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 14, padding: '0 16px', marginTop: -36 }}>
        <GlassSkeleton variant="circle" width={84} height={84} index={1} style={{ border: '3px solid #0B0B14' }} />
        <div style={{ flex: 1, paddingBottom: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
          <GlassSkeleton width="42%" height={13} index={2} />
          <GlassSkeleton width="28%" height={10} index={3} />
        </div>
        <div style={{ paddingBottom: 8 }}>
          <GlassSkeleton width={88} height={32} radius={999} index={4} />
        </div>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-around', padding: '20px 16px', gap: 10 }}>
        {[0, 1, 2].map((i) => (
          <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
            <GlassSkeleton width={36} height={14} index={5 + i * 2} />
            <GlassSkeleton width={50} height={9} index={6 + i * 2} />
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 8, padding: '0 16px 12px' }}>
        {[0, 1, 2, 3].map((i) => <GlassSkeleton key={i} width={70} height={28} radius={999} index={11 + i} />)}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 2, padding: '0 2px' }}>
        {Array.from({ length: 9 }).map((_, i) => (
          <GlassSkeleton key={i} variant="thumb" index={15 + i} style={{ width: '100%', aspectRatio: '1/1', borderRadius: 4 }} />
        ))}
      </div>
    </div>
  );
}

// Wallet — balance hero + 3 action pills + transaction rows.
export function WalletSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading wallet" style={{ padding: 16 }}>
      <GlassSkeleton variant="hero" height={160} index={0} style={{ width: '100%' }} />
      <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
        {[0, 1, 2].map((i) => <GlassSkeleton key={i} height={48} radius={14} index={1 + i} style={{ flex: 1 }} />)}
      </div>
      <div style={{ marginTop: 18 }}>
        <GlassSkeleton width={120} height={12} index={5} />
      </div>
      <div style={{ marginTop: 10 }}>
        {Array.from({ length: 5 }).map((_, i) => {
          const b = 6 + i * 3;
          return (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
              <GlassSkeleton variant="circle" width={36} height={36} index={b} />
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 5 }}>
                <GlassSkeleton width="58%" height={11} index={b + 1} />
                <GlassSkeleton width="38%" height={9} index={b + 2} />
              </div>
              <GlassSkeleton width={70} height={12} index={b + 3} />
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Chat thread — alternating incoming/outgoing bubble skeletons.
export function ChatThreadSkeleton({ rows = 6 }) {
  return (
    <div aria-busy="true" aria-label="Loading conversation" style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: 16 }}>
      {Array.from({ length: rows }).map((_, i) => {
        const mine = i % 2 === 1;
        const w = ['60%', '45%', '72%', '38%', '55%', '50%'][i % 6];
        return (
          <div key={i} style={{ display: 'flex', justifyContent: mine ? 'flex-end' : 'flex-start' }}>
            <GlassSkeleton width={w} height={36} radius={mine ? '14px 14px 4px 14px' : '14px 14px 14px 4px'} index={i * 2} />
          </div>
        );
      })}
    </div>
  );
}

// Stream / video tile — 16:9 + host bar (avatar + 2 lines).
export function StreamTileSkeleton({ index = 0 }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <GlassSkeleton variant="hero" index={index} style={{ width: '100%', aspectRatio: '16/9' }} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <GlassSkeleton variant="circle" width={32} height={32} index={index + 1} />
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4 }}>
          <GlassSkeleton width="65%" height={11} index={index + 2} />
          <GlassSkeleton width="40%" height={9} index={index + 3} />
        </div>
      </div>
    </div>
  );
}

// Simple convenience: vertical column of N rows for cases that just need
// "something is loading" without strong layout.
export function StackSkeleton({ rows = 5, height = 56, gap = 10 }) {
  return (
    <div aria-busy="true" style={{ display: 'flex', flexDirection: 'column', gap, padding: 12 }}>
      {Array.from({ length: rows }).map((_, i) => (
        <GlassSkeleton key={i} variant="row" height={height} index={i} style={{ width: '100%' }} />
      ))}
    </div>
  );
}
