// src/components/creator/PlanLock.jsx
// Gates creator-studio features behind subscription tiers (free < lite < pro).
// - If the user has the required tier (or higher), renders children normally.
// - Otherwise renders children blurred + non-interactive with an overlay
//   containing a compact "Upgrade to {tier}" CTA that routes to /settings/subscription.
//
// Two modes:
//   <PlanLock required="lite">...</PlanLock>                     // full-block lock
//   <PlanLock required="pro" variant="inline">...</PlanLock>     // smaller CTA
import { useNavigate } from 'react-router-dom';
import useTier from '../../hooks/useTier';
import Icon from '../Icon';

const RANK = { free: 0, lite: 1, pro: 2 };
const LABEL = { lite: 'Lite', pro: 'Pro' };
const COLOR = {
  lite: 'from-brand-violet to-brand-violet',
  pro:  'from-brand-gold to-brand-ember',
};
const PRICE = { lite: '$9.99/mo', pro: '$24.99/mo' };

export default function PlanLock({ required = 'lite', children, variant = 'block', title, description }) {
  const navigate = useNavigate();
  const { tier } = useTier();
  const userRank = RANK[tier] ?? 0;
  const reqRank  = RANK[required] ?? 0;
  const unlocked = userRank >= reqRank;

  if (unlocked) return children;

  const reqLabel = LABEL[required] || 'Pro';
  const reqColor = COLOR[required] || COLOR.pro;
  const reqPrice = PRICE[required];

  const goUpgrade = () => navigate('/settings/subscription');

  return (
    <div className="relative">
      {/* Blurred content (still renders so layout is preserved) */}
      <div className="pointer-events-none select-none filter blur-[6px] opacity-40">
        {children}
      </div>

      {/* Overlay */}
      <div className="absolute inset-0 flex items-center justify-center rounded-2xl">
        <div className={`${variant === 'inline' ? 'px-4 py-3' : 'px-6 py-5'} rounded-2xl bg-[#0b0e15]/90 backdrop-blur-md border border-white/10 shadow-[0_10px_40px_-10px_rgba(0,0,0,0.8)] text-center max-w-[340px]`}>
          <div className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-gradient-to-r ${reqColor} text-bg-dark text-[10px] font-extrabold uppercase tracking-wider mb-2`}>
            <Icon name="workspace_premium" size={12} filled />
            {reqLabel}
          </div>
          {title && <p className="text-white font-bold text-sm mb-1">{title}</p>}
          {description && (
            <p className="text-text-muted text-xs leading-relaxed mb-3">{description}</p>
          )}
          {!title && !description && (
            <p className="text-text-secondary text-xs mb-3">Unlock with {reqLabel}{reqPrice ? ` — ${reqPrice}` : ''}.</p>
          )}
          <button
            onClick={goUpgrade}
            className={`inline-flex items-center gap-1.5 px-4 h-9 rounded-xl bg-gradient-to-r ${reqColor} text-bg-dark font-bold text-xs hover:brightness-110 transition-all`}>
            <Icon name="bolt" size={14} filled />
            Upgrade
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Small helper: "Requires Pro" chip inline — for sections inside a card where
 * a full PlanLock would be too heavy. Just renders a pill that opens upgrade.
 */
export function PlanChip({ required = 'pro' }) {
  const navigate = useNavigate();
  const { tier } = useTier();
  const userRank = RANK[tier] ?? 0;
  const reqRank  = RANK[required] ?? 0;
  if (userRank >= reqRank) return null;
  const color = COLOR[required] || COLOR.pro;
  return (
    <button onClick={() => navigate('/settings/subscription')}
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-gradient-to-r ${color} text-bg-dark text-[9px] font-extrabold uppercase tracking-wider hover:brightness-110 transition-all`}>
      <Icon name="lock" size={10} filled />
      {LABEL[required] || 'Pro'}
    </button>
  );
}
