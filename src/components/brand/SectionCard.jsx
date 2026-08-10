// Reusable card with an optional header (title + action link).
// Matches the dark-surface card look used across the new design mocks.
import Icon from '../Icon';

export function SectionCard({ title, action, actionIcon = 'arrow_forward', onAction, children, className = '', padding = 'p-5' }) {
  return (
    <div className={`rounded-2xl bg-[#12132099] border border-white/[0.06] backdrop-blur-sm ${className}`}>
      {title && (
        <div className="flex items-center justify-between px-5 pt-4 pb-2">
          <h3 className="font-syne text-sm font-bold uppercase tracking-[0.12em] text-text-primary">{title}</h3>
          {action && (
            <button
              onClick={onAction}
              className="flex items-center gap-1 text-[11px] font-dmmono uppercase tracking-[0.1em] text-brand-violet-light hover:text-brand-violet-light/80"
            >
              {action}
              <Icon name={actionIcon} size={14} />
            </button>
          )}
        </div>
      )}
      <div className={title ? 'px-5 pb-5 pt-2' : padding}>{children}</div>
    </div>
  );
}

// Small stat tile (Active / Won / Earned style).
export function StatTile({ icon, iconColor = 'text-brand-violet-light', label, value, sub }) {
  return (
    <div className="rounded-xl bg-white/[0.03] border border-white/[0.05] p-3">
      <div className="flex items-center justify-between mb-1.5">
        <div className="text-[9.5px] font-dmmono uppercase tracking-[0.14em] text-text-muted">{label}</div>
        {icon && <Icon name={icon} size={14} className={iconColor} />}
      </div>
      <div className={`font-dmmono text-lg font-bold tabular-nums ${iconColor}`}>{value}</div>
      {sub && <div className="text-[10px] text-text-muted mt-0.5">{sub}</div>}
    </div>
  );
}

export default SectionCard;
