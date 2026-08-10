// src/components/creator/Widgets.jsx
// Small reusable studio widgets: KPI card, section header, insight card, empty state.
import Icon from '../Icon';
import { Sparkline, compactNum } from './charts';

// ── Card wrapper — subtle gradient, glassy border ──────────────────────
export function Card({ className = '', children, ...rest }) {
  return (
    <div {...rest}
      className={`bg-gradient-to-br from-[#0f131c] to-[#0a0d14] border border-white/[0.06] rounded-2xl shadow-[0_2px_20px_-4px_rgba(0,0,0,0.4)] ${className}`}>
      {children}
    </div>
  );
}

// ── KPI card with sparkline ────────────────────────────────────────────
export function KpiCard({ label, value, unit = '', delta, deltaLabel, icon, iconColor = 'text-brand-violet-light', spark, sparkColor, tooltip }) {
  const positive = delta == null ? null : delta >= 0;
  return (
    <Card className="p-4 md:p-5 flex flex-col gap-3 min-w-0">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-8 h-8 rounded-xl bg-white/[0.04] border border-white/[0.05] flex items-center justify-center shrink-0">
            <Icon name={icon} size={16} filled className={iconColor} />
          </div>
          <p className="text-[11px] uppercase tracking-widest text-text-muted font-bold truncate">{label}</p>
        </div>
        {tooltip && (
          <span title={tooltip} className="w-5 h-5 rounded-full bg-white/[0.03] border border-white/[0.05] flex items-center justify-center cursor-help">
            <Icon name="help" size={10} className="text-text-muted" />
          </span>
        )}
      </div>
      <div className="flex items-end gap-2 min-w-0">
        <p className="font-dmmono font-bold text-2xl md:text-3xl text-white leading-none tabular-nums truncate">
          {typeof value === 'number' ? compactNum(value) : value}
          {unit && <span className="text-base text-text-muted font-bold ml-1">{unit}</span>}
        </p>
      </div>
      {spark && (
        <div className="-mx-1">
          <Sparkline data={spark} color={sparkColor} height={36} />
        </div>
      )}
      {delta != null && (
        <div className="flex items-center gap-1.5 min-w-0">
          <span className={`flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[11px] font-bold ${
            positive ? 'bg-emerald-500/15 text-emerald-400' : 'bg-rose-500/15 text-rose-400'
          }`}>
            <Icon name={positive ? 'trending_up' : 'trending_down'} size={11} />
            {positive ? '+' : ''}{typeof delta === 'number' ? compactNum(delta) : delta}
          </span>
          {deltaLabel && <span className="text-[11px] text-text-muted truncate">{deltaLabel}</span>}
        </div>
      )}
    </Card>
  );
}

// ── Section header ─────────────────────────────────────────────────────
export function SectionHeader({ title, subtitle, right }) {
  return (
    <div className="flex items-end justify-between gap-4 mb-3">
      <div className="min-w-0">
        <h3 className="font-syne text-base md:text-lg font-extrabold text-white truncate">{title}</h3>
        {subtitle && <p className="text-xs text-text-muted truncate">{subtitle}</p>}
      </div>
      {right}
    </div>
  );
}

// ── AI insight / tip card ──────────────────────────────────────────────
export function InsightCard({ title, body, cta, onCta, icon = 'auto_awesome', tone = 'violet' }) {
  const tones = {
    violet: 'from-brand-violet/20 via-brand-violet/10 to-transparent border-brand-violet/30 text-brand-violet',
    gold:   'from-brand-gold/15 via-amber-500/5 to-transparent border-brand-gold/30 text-brand-gold',
    emerald:'from-emerald-500/15 via-emerald-500/5 to-transparent border-emerald-500/30 text-emerald-400',
    pink:   'from-brand-pink/15 via-brand-pink/5 to-transparent border-brand-pink/30 text-brand-pink',
  };
  const t = tones[tone] || tones.violet;
  return (
    <div className={`relative overflow-hidden rounded-2xl border bg-gradient-to-br ${t} p-4 md:p-5`}>
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-xl bg-white/10 backdrop-blur flex items-center justify-center shrink-0">
          <Icon name={icon} size={20} filled className={t.split(' ').pop()} />
        </div>
        <div className="flex-1 min-w-0">
          <p className={`text-[10px] uppercase tracking-widest font-bold mb-1 ${t.split(' ').pop()}`}>{title}</p>
          <p className="text-sm text-text-primary leading-relaxed">{body}</p>
          {cta && (
            <button onClick={onCta}
              className="mt-3 inline-flex items-center gap-1.5 text-xs font-bold text-white bg-white/10 hover:bg-white/15 transition-colors px-3 py-1.5 rounded-lg">
              {cta} <Icon name="arrow_forward" size={12} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Simple stat row (label + value) ────────────────────────────────────
export function StatRow({ label, value, accent = 'text-text-primary' }) {
  return (
    <div className="flex items-center justify-between py-2 border-b border-white/[0.04] last:border-0">
      <span className="text-xs text-text-muted">{label}</span>
      <span className={`font-dmmono font-bold text-sm ${accent}`}>{value}</span>
    </div>
  );
}

// ── Period/Date range pill selector ────────────────────────────────────
export function PeriodPicker({ value, onChange, options = ['7d','30d','90d','6m','All'] }) {
  return (
    <div className="inline-flex max-w-full items-center gap-1 p-1 rounded-xl bg-white/[0.03] border border-white/[0.05] overflow-x-auto no-scrollbar">
      {options.map(opt => (
        <button key={opt} onClick={() => onChange(opt)}
          className={`px-3 h-7 rounded-lg text-[11px] font-bold transition-all shrink-0 ${
            value === opt
              ? 'bg-white/10 text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,0.1)]'
              : 'text-text-muted hover:text-text-secondary'
          }`}>
          {opt}
        </button>
      ))}
    </div>
  );
}
