// A single rank badge crest: the .webp art with a coloured glow ring.
// `locked` desaturates it to a silhouette (drives users to unlock the next).
export default function RankCrest({
  art,
  ringColor = '#B44FFF',
  size = 96,
  locked = false,
  glow = true,
  animated = false,
  className = '',
}) {
  return (
    <div className={`relative shrink-0 ${className}`} style={{ width: size, height: size }}>
      {glow && !locked && (
        <div
          className="absolute inset-0 rounded-full pointer-events-none"
          style={{ background: `radial-gradient(circle, ${ringColor}33, transparent 70%)` }}
        />
      )}
      <img
        src={art}
        alt=""
        loading="lazy"
        className={`relative w-full h-full object-contain ${animated && !locked ? 'prestige-float' : ''}`}
        style={{
          filter: locked ? 'grayscale(1) brightness(0.35)' : `drop-shadow(0 3px 10px ${ringColor}66)`,
          opacity: locked ? 0.5 : 1,
        }}
      />
    </div>
  );
}
