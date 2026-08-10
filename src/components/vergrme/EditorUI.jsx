import Icon from '../Icon';

// Shared glass primitives for the vergr.me editor panels (template-matched polish).
export function Card({ title, subtitle, badge, right, children, className = '' }) {
  return (
    <div className={`bg-surface-1/70 backdrop-blur-xl rounded-2xl p-5 border border-white/10 shadow-lg ${className}`}>
      {(title || right) && (
        <div className="flex items-start justify-between mb-4">
          <div>
            {title && (
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-semibold">{title}</h2>
                {badge && <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-brand-gold-light/15 text-brand-gold-light font-semibold">{badge}</span>}
              </div>
            )}
            {subtitle && <p className="text-xs text-text-muted mt-0.5">{subtitle}</p>}
          </div>
          {right}
        </div>
      )}
      {children}
    </div>
  );
}

// Single source of truth for the on/off switch. Uses left offsets (not
// translate) so the 20px knob always sits fully inside the 44px track.
export function Switch({ on, onClick, label }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={onClick}
      className={`relative w-11 h-6 rounded-full transition-colors duration-200 shrink-0 ${on ? 'bg-brand-violet' : 'bg-white/15'}`}
    >
      <span
        className={`absolute top-1/2 -translate-y-1/2 w-5 h-5 bg-white rounded-full shadow-md transition-[left] duration-200 ${on ? 'left-[22px]' : 'left-[2px]'}`}
      />
    </button>
  );
}

export function ToggleRow({ label, sub, on, onClick, badge, icon }) {
  return (
    <div className="flex items-center justify-between py-3 px-4 bg-surface-2/60 rounded-xl border border-white/5">
      <div className="flex items-center gap-3">
        {icon && <div className="w-9 h-9 rounded-lg bg-surface-1 flex items-center justify-center text-text-secondary shrink-0"><Icon name={icon} size={18} /></div>}
        <div>
          <div className="flex items-center gap-2">
            <p className="text-sm">{label}</p>
            {badge && <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-brand-gold-light/15 text-brand-gold-light font-semibold">{badge}</span>}
          </div>
          {sub && <p className="text-xs text-text-muted mt-0.5">{sub}</p>}
        </div>
      </div>
      <Switch on={on} onClick={onClick} label={label} />
    </div>
  );
}

export function Field({ label, hint, children }) {
  return (
    <div className="flex flex-col gap-1.5">
      {label && <label className="text-[11px] text-text-muted font-semibold uppercase tracking-wider">{label}</label>}
      {children}
      {hint && <p className="text-[11px] text-text-muted">{hint}</p>}
    </div>
  );
}

export function StatTile({ value, label, accent }) {
  return (
    <div className="bg-surface-2/60 rounded-xl p-4 border border-white/5">
      <p className="text-2xl font-bold font-dmmono tabular-nums" style={accent ? { color: accent } : undefined}>{value}</p>
      <p className="text-[11px] text-text-muted mt-1">{label}</p>
    </div>
  );
}
