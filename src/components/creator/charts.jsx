// src/components/creator/charts.jsx
// Reusable Recharts wrappers themed for VERGR studio dashboard.
// All components are responsive, have dark-mode tooltips, and avoid chart.js/echarts bloat.
import { Fragment } from 'react';
import {
  ResponsiveContainer,
  AreaChart, Area,
  LineChart, Line,
  BarChart, Bar,
  PieChart, Pie, Cell,
  CartesianGrid, XAxis, YAxis, Tooltip, Legend,
} from 'recharts';
import Icon from '../Icon';

// ── Theme ──────────────────────────────────────────────────────────────
export const PALETTE = {
  cyan:   '#22d3ee',
  violet: '#a78bfa',
  pink:   '#f472b6',
  ember:  '#f97316',
  gold:   '#fbbf24',
  emerald:'#34d399',
  blue:   '#60a5fa',
  rose:   '#fb7185',
};
const GRID = 'rgba(255,255,255,0.05)';
const AXIS = 'rgba(255,255,255,0.35)';

// ── Shared tooltip ─────────────────────────────────────────────────────
function VTooltip({ active, payload, label, unit = '', formatter }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="px-3 py-2 rounded-xl bg-[#0b0e15]/95 backdrop-blur-xl border border-white/10 shadow-[0_10px_35px_-5px_rgba(0,0,0,0.7)] text-xs">
      <div className="text-text-muted text-[10px] uppercase tracking-widest mb-1.5">{label}</div>
      {payload.map((p, i) => (
        <div key={i} className="flex items-center gap-2 py-0.5">
          <span className="w-2 h-2 rounded-sm" style={{ backgroundColor: p.color || p.fill }} />
          <span className="text-text-secondary flex-1">{p.name}</span>
          <span className="font-dmmono font-bold text-text-primary ml-3">
            {formatter ? formatter(p.value) : p.value.toLocaleString()}{unit}
          </span>
        </div>
      ))}
    </div>
  );
}

// ── Sparkline (tiny trend line inside KPI cards) ───────────────────────
export function Sparkline({ data, color = PALETTE.cyan, height = 44 }) {
  if (!data?.length) {
    return <div style={{ height }} className="w-full rounded-lg bg-white/[0.02]" />;
  }
  const min = Math.min(...data);
  const max = Math.max(...data);
  // A perfectly flat series (e.g. 0 followers) plots at the bottom edge and reads
  // as "invisible". Render it as a visible centered baseline instead.
  const flat = min === max;
  const chartData = data.map((v, i) => ({ i, v: flat ? 0.5 : v }));
  const gradientId = `sparkGrad-${color.replace('#','')}`;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={chartData} margin={{ top: 4, right: 0, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%"  stopColor={color} stopOpacity={0.55} />
            <stop offset="100%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        <Area
          type="monotone"
          dataKey="v"
          stroke={color}
          strokeWidth={2}
          fill={`url(#${gradientId})`}
          isAnimationActive
          animationDuration={700}
          dot={false}
          activeDot={{ r: 3, fill: color, stroke: '#0b0e15', strokeWidth: 2 }}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

// ── Multi-line trend chart with hover tooltip ──────────────────────────
export function TrendLineChart({ data, series, height = 280, unit = '' }) {
  if (!data?.length) return <EmptyChart height={height} />;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 10, right: 16, left: -10, bottom: 0 }}>
        <CartesianGrid stroke={GRID} vertical={false} />
        <XAxis dataKey="label" stroke={AXIS} fontSize={11} tickLine={false} axisLine={false} />
        <YAxis stroke={AXIS} fontSize={11} tickLine={false} axisLine={false}
          tickFormatter={(v) => compactNum(v)} />
        <Tooltip content={<VTooltip unit={unit} />} />
        <Legend iconType="plainline" iconSize={14}
          wrapperStyle={{ fontSize: '11px', color: 'rgba(255,255,255,0.75)', paddingTop: 4 }} />
        {series.map((s) => (
          <Line key={s.key} type="monotone" dataKey={s.key} name={s.label}
            stroke={s.color} strokeWidth={2.5} dot={false}
            activeDot={{ r: 4, fill: s.color, stroke: '#0b0e15', strokeWidth: 2 }}
            isAnimationActive animationDuration={700} />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}

// ── Stacked area (revenue sources over time) ───────────────────────────
export function StackedAreaChart({ data, series, height = 280 }) {
  if (!data?.length) return <EmptyChart height={height} />;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 10, right: 16, left: -10, bottom: 0 }}>
        <defs>
          {series.map((s) => (
            <linearGradient key={s.key} id={`gradArea-${s.key}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%"  stopColor={s.color} stopOpacity={0.55} />
              <stop offset="100%" stopColor={s.color} stopOpacity={0.05} />
            </linearGradient>
          ))}
        </defs>
        <CartesianGrid stroke={GRID} vertical={false} />
        <XAxis dataKey="label" stroke={AXIS} fontSize={11} tickLine={false} axisLine={false} />
        <YAxis stroke={AXIS} fontSize={11} tickLine={false} axisLine={false}
          tickFormatter={(v) => compactNum(v)} />
        <Tooltip content={<VTooltip />} />
        <Legend iconType="square" iconSize={10}
          wrapperStyle={{ fontSize: '11px', color: 'rgba(255,255,255,0.75)', paddingTop: 4 }} />
        {series.map((s) => (
          <Area key={s.key} type="monotone" dataKey={s.key} name={s.label}
            stackId="1" stroke={s.color} strokeWidth={2}
            fill={`url(#gradArea-${s.key})`}
            isAnimationActive animationDuration={700} />
        ))}
      </AreaChart>
    </ResponsiveContainer>
  );
}

// ── Horizontal bar (top posts, countries etc) ──────────────────────────
export function HorizontalBarChart({ data, dataKey, nameKey = 'name', color = PALETTE.cyan, height = 280 }) {
  if (!data?.length) return <EmptyChart height={height} />;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 16, left: 4, bottom: 4 }}>
        <CartesianGrid stroke={GRID} horizontal={false} />
        <XAxis type="number" stroke={AXIS} fontSize={11} tickLine={false} axisLine={false}
          tickFormatter={(v) => compactNum(v)} />
        <YAxis type="category" dataKey={nameKey} stroke={AXIS} fontSize={12} tickLine={false} axisLine={false}
          width={90} />
        <Tooltip content={<VTooltip />} cursor={{ fill: 'rgba(255,255,255,0.03)' }} />
        <Bar dataKey={dataKey} fill={color} radius={[0, 6, 6, 0]}
          isAnimationActive animationDuration={700} />
      </BarChart>
    </ResponsiveContainer>
  );
}

// ── Vertical bar (engagement breakdown) ────────────────────────────────
export function VerticalBarChart({ data, series, height = 280 }) {
  if (!data?.length) return <EmptyChart height={height} />;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
        <CartesianGrid stroke={GRID} vertical={false} />
        <XAxis dataKey="label" stroke={AXIS} fontSize={11} tickLine={false} axisLine={false} />
        <YAxis stroke={AXIS} fontSize={11} tickLine={false} axisLine={false}
          tickFormatter={(v) => compactNum(v)} />
        <Tooltip content={<VTooltip />} cursor={{ fill: 'rgba(255,255,255,0.03)' }} />
        <Legend iconType="square" iconSize={10}
          wrapperStyle={{ fontSize: '11px', color: 'rgba(255,255,255,0.75)' }} />
        {series.map((s) => (
          <Bar key={s.key} dataKey={s.key} name={s.label} fill={s.color} radius={[6, 6, 0, 0]}
            isAnimationActive animationDuration={700} />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}

// ── Donut (revenue sources pie) ────────────────────────────────────────
export function DonutChart({ data, height = 260, centerLabel, centerValue }) {
  if (!data?.length) return <EmptyChart height={height} />;
  return (
    <div className="relative w-full" style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Tooltip content={<VTooltip />} />
          <Pie
            data={data}
            dataKey="value"
            nameKey="name"
            cx="50%" cy="50%"
            innerRadius="62%"
            outerRadius="92%"
            stroke="#0b0e15"
            strokeWidth={3}
            isAnimationActive animationDuration={700}
            paddingAngle={2}
          >
            {data.map((entry, i) => (
              <Cell key={i} fill={entry.color} />
            ))}
          </Pie>
        </PieChart>
      </ResponsiveContainer>
      {(centerValue || centerLabel) && (
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
          {centerValue && <span className="font-syne font-extrabold text-2xl text-white">{centerValue}</span>}
          {centerLabel && <span className="text-[10px] text-text-muted uppercase tracking-widest mt-0.5">{centerLabel}</span>}
        </div>
      )}
    </div>
  );
}

// ── Heatmap (7 days × 24 hours) — pure Tailwind grid ──────────────────
export function ActivityHeatmap({ values /* [7][24] 0–1 */, onCellHover }) {
  const days = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
  const getColor = (v) => {
    if (v == null) return 'bg-white/[0.03]';
    if (v < 0.15) return 'bg-brand-violet/10';
    if (v < 0.35) return 'bg-brand-violet/25';
    if (v < 0.55) return 'bg-brand-violet/50';
    if (v < 0.75) return 'bg-brand-violet/75';
    return 'bg-gradient-to-br from-brand-violet to-brand-pink';
  };
  return (
    <div className="w-full">
      <div className="flex items-center justify-between mb-2 text-[10px] text-text-muted">
        <span className="uppercase tracking-widest">Less</span>
        <div className="flex gap-1">
          {[0.05, 0.25, 0.5, 0.75, 0.95].map((v) => (
            <span key={v} className={`w-3 h-3 rounded ${getColor(v)}`} />
          ))}
        </div>
        <span className="uppercase tracking-widest">More</span>
      </div>
      <div className="grid gap-1.5" style={{ gridTemplateColumns: 'auto 1fr' }}>
        <div /> {/* spacer for time labels */}
        <div className="grid gap-0.5 text-[8px] text-text-muted" style={{ gridTemplateColumns: 'repeat(24, minmax(0, 1fr))' }}>
          {[0,6,12,18].map(h => (
            <span key={h} style={{ gridColumn: `${h + 1}` }} className="tabular-nums">
              {h.toString().padStart(2,'0')}
            </span>
          ))}
        </div>
        {days.map((d, di) => (
          <Fragment key={d}>
            <div className="text-[10px] text-text-muted pr-2 leading-none self-center">{d}</div>
            <div className="grid gap-0.5" style={{ gridTemplateColumns: 'repeat(24, minmax(0, 1fr))' }}>
              {Array.from({ length: 24 }).map((_, hi) => {
                const v = values?.[di]?.[hi];
                return (
                  <div key={hi}
                    onMouseEnter={() => onCellHover?.({ day: d, hour: hi, value: v })}
                    title={`${d} ${hi}:00 — ${v != null ? Math.round(v * 100) + '% engagement' : 'no data'}`}
                    className={`aspect-square rounded-[3px] ${getColor(v)} hover:ring-2 hover:ring-white/30 transition-all cursor-pointer`} />
                );
              })}
            </div>
          </Fragment>
        ))}
      </div>
    </div>
  );
}

// ── Empty state ────────────────────────────────────────────────────────
function EmptyChart({ height = 220, label = 'Not enough data yet' }) {
  return (
    <div style={{ height }} className="w-full flex flex-col items-center justify-center rounded-xl bg-white/[0.02] border border-white/[0.04]">
      <Icon name="insights" size={32} className="text-text-muted mb-2" />
      <p className="text-text-muted text-xs">{label}</p>
    </div>
  );
}

// ── Utility ────────────────────────────────────────────────────────────
export function compactNum(n) {
  if (n == null) return '0';
  const abs = Math.abs(n);
  if (abs >= 1e9) return (n / 1e9).toFixed(1).replace(/\.0$/, '') + 'B';
  if (abs >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
  if (abs >= 1e3) return (n / 1e3).toFixed(1).replace(/\.0$/, '') + 'K';
  return Math.round(n).toLocaleString();
}
