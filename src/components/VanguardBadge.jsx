// Small inline badge that goes next to a user's display name when they are
// (or appear as) a Vanguard member. Use cases:
//
//   - Next to a chat sender's name
//   - Next to a post author's name
//   - Next to a tournament participant's display name
//   - Inside the moderator roster on /admin/vanguard
//
// Renders nothing if `rank` is falsy. Defaults to a tight inline height
// matching common 14–15px label rows. Pass `size` to override.
//
// The badge art is responsive to rank because each rank's file lives at a
// known path on the CDN (public/vanguard/<rank>-badge.webp). Defined in
// src/utils/vanguardRanks.js — DON'T hardcode the paths here.
import { rankMeta } from '../utils/vanguard';

export default function VanguardBadge({ rank, size = 18, className = '', title }) {
  if (!rank) return null;
  const meta = rankMeta(rank);
  if (!meta?.badge) return null;
  return (
    <img
      src={meta.badge}
      alt={`${meta.label} badge`}
      title={title || meta.label}
      className={className}
      style={{
        height: size,
        width: 'auto',
        verticalAlign: 'middle',
        display: 'inline-block',
        flexShrink: 0,
        // Image-protection compatible — `pointer-events: none` keeps the
        // tooltip working without enabling right-click on the badge image.
        userSelect: 'none',
      }}
      draggable={false}
    />
  );
}
