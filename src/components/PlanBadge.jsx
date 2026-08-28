// Small inline badge showing a member's paid plan, sitting next to their handle
// the same way VanguardBadge sits next to a Vanguard persona's name.
//
// This is the "Pro badge" the pricing page sells. It had no implementation at
// all until 2026-08-19: TIER_FEATURES carried a `profileBadge` field that
// nothing rendered, so Pro members were paying for a badge that did not exist.
//
// Renders NOTHING for free accounts. That is deliberate: an "everyone has one"
// badge is visual noise, and the point of this mark is that it is uncommon.
//
// Colours come from TIERS[plan].color so the badge can never drift from the
// colour the subscription screen paints that plan in.
import { TIERS, resolveTier } from '../utils/tierSystem';

/**
 * @param {object}  props
 * @param {string} [props.plan]    'free' | 'lite' | 'pro'. Wins over `profile`.
 * @param {object} [props.profile] A user doc; the plan is read off it with
 *                                 resolveTier(), which handles every legacy
 *                                 shape the field has been written in.
 * @param {number} [props.size]    Font size in px. The pill scales off it.
 */
export default function PlanBadge({ plan, profile, size = 10, className = '', title }) {
  const tier = plan || resolveTier(profile);
  if (tier !== 'lite' && tier !== 'pro') return null;

  const meta = TIERS[tier];
  const color = meta?.color || '#F5C542';
  const label = meta?.name?.toUpperCase() || tier.toUpperCase();

  return (
    <span
      title={title || `${meta?.name} member`}
      className={className}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        verticalAlign: 'middle',
        padding: `${Math.round(size * 0.2)}px ${Math.round(size * 0.6)}px`,
        borderRadius: 999,
        fontFamily: '"DM Mono", ui-monospace, monospace',
        fontSize: size,
        fontWeight: 700,
        lineHeight: 1,
        letterSpacing: '.08em',
        color,
        // Tinted from the plan colour rather than a flat fill: a solid block of
        // gold next to a handle reads as a warning, not a badge.
        background: `${color}1F`,
        border: `1px solid ${color}59`,
        whiteSpace: 'nowrap',
      }}
    >
      {label}
    </span>
  );
}
