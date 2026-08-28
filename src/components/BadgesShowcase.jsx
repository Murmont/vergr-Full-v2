// Compact rank badge strip — designed to be embedded inside a parent card
// (no own border / background). Renders the 3 badges of the user's current
// rank: earned ones solid, locked ones as silhouettes. Sized small so it
// reads as a supporting element next to the VP progress bar.
import { getCurrentRankProgress, smallBadgeArt } from '../utils/badgeSystem';

export default function BadgesShowcase({ level = 1, size = 36 }) {
  const { rank, tiers } = getCurrentRankProgress(level);

  return (
    <div className="flex items-center gap-2">
      {tiers.map(t => (
        <div
          key={t.id}
          className="relative shrink-0"
          style={{ width: size, height: size }}
          title={t.earned ? `${rank.name} badge — Earned` : `Unlock at Lvl ${t.min}`}
        >
          <img
            // ⚠ THE SMALL VARIANT. These render at 32-40px from 1024x1024
            // source art averaging 167 KB — three of them is ~500 KB on every
            // profile view, measured live. The 64px files are 1.9 KB and are
            // still 2x the largest size this component draws.
            src={smallBadgeArt(t.art)}
            alt=""
            className="w-full h-full object-contain"
            style={{
              filter: t.earned ? 'none' : 'grayscale(1) brightness(0.3)',
              opacity: t.earned ? 1 : 0.55,
            }}
          />
          {t.isCurrent && (
            <div
              className="absolute inset-0 rounded-full pointer-events-none"
              style={{ boxShadow: `0 0 0 2px ${rank.ringColor}, 0 0 10px ${rank.ringColor}55` }}
            />
          )}
        </div>
      ))}
    </div>
  );
}
