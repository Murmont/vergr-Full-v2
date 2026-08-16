// src/components/creator/StudioSkeletons.jsx
//
// Loading states for Creator Studio that MATCH the layout they replace.
//
// The old approach was `<StackSkeleton rows={5} height={88} />` on every screen:
// five identical bars regardless of what was actually loading. It told the user
// nothing about what was coming, and every screen shifted when the data landed
// because the real layout is a KPI grid and panels of different heights, not a
// stack of equal bars.
//
// The rule these follow: the placeholder is the REAL layout with its content
// greyed, at the same sizes and in the same grid, so swapping in data causes
// zero shift. A skeleton whose only job is to say "something is happening" is
// worse than one that also says "and here is the shape of it".
//
// Sizes below are taken from the live components, not guessed:
//   KPI tile        p-4, label 10px, value text-2xl  -> ~92px
//   Panel head      title 14px + sub 11px + mb-3     -> ~44px
//   Chart body      TrendLineChart/DonutChart default height 260-280

/** One shimmering block. Everything else here composes these. */
function Bar({ w = '100%', h = 12, r = 6, className = '', style }) {
  return (
    <div
      className={`vg-skel ${className}`}
      style={{ width: w, height: h, borderRadius: r, ...style }}
    />
  );
}

/**
 * The shimmer itself, injected once. Kept local rather than added to
 * surface.css so the loading state cannot accidentally become a design
 * primitive that real components start using.
 */
function Style() {
  return (
    <style>{`
      .vg-skel {
        background: linear-gradient(90deg,
          rgba(255,255,255,0.035) 25%,
          rgba(255,255,255,0.075) 37%,
          rgba(255,255,255,0.035) 63%);
        background-size: 400% 100%;
        animation: vg-skel-shimmer 1.4s ease-in-out infinite;
      }
      @keyframes vg-skel-shimmer {
        0% { background-position: 100% 50%; }
        100% { background-position: 0 50%; }
      }
      @media (prefers-reduced-motion: reduce) {
        .vg-skel { animation: none; }
      }
    `}</style>
  );
}

/** Matches the .vg-material panels used across the studio. */
export function PanelSkeleton({ children, titleWidth = 120, subWidth = 190, className = '' }) {
  return (
    <div className={`vg-material vg-grain rounded-2xl overflow-hidden ${className}`}>
      <div className="relative z-[1] p-5">
        {/* Same classes as a real panel head: title text-sm, sub text-xs with
            mt-0.5, mb-3 before the body. Height is produced by the same rules. */}
        <div className="text-sm leading-5 flex items-center"><Bar w={titleWidth} h="0.72em" r={4} /></div>
        {subWidth ? <div className="text-xs leading-4 mt-0.5 flex items-center"><Bar w={subWidth} h="0.72em" r={4} /></div> : null}
        <div className="mb-3" />
        {children}
      </div>
    </div>
  );
}

/**
 * The 2-up / 4-up metric grid: Analytics KPIs, Home snapshot, Earnings money.
 *
 * Column classes are written out in full rather than interpolated. Tailwind
 * scans source text for literal class names, so `lg:grid-cols-${cols}` is never
 * generated and the grid silently collapses to two columns on desktop, which
 * would defeat the whole point of matching the real layout.
 */
const COLS = { 2: 'lg:grid-cols-2', 3: 'lg:grid-cols-3', 4: 'lg:grid-cols-4' };

export function KpiGridSkeleton({ count = 4, cols = 4 }) {
  return (
    <div className={`grid grid-cols-2 ${COLS[cols] || COLS[4]} gap-3`}>
      {Array.from({ length: count }).map((_, i) => (
        // Wrapper, padding and the three stacked lines mirror the real KPI tile
        // in MonthlyAnalyticsScreen exactly. Each bar sits inside a element
        // carrying the SAME type class as the text it replaces, so the line box
        // that determines the tile's height is produced by the same rule.
        <div key={i} className="vg-material vg-grain rounded-2xl overflow-hidden">
          <div className="relative z-[1] p-4">
            <div className="text-[10px] leading-4 mb-2 flex items-center justify-between">
              <Bar w="58%" h="0.8em" r={3} />
              <span className="w-7 h-7 rounded-lg shrink-0"
                style={{ background: 'rgba(255,255,255,0.045)' }} />
            </div>
            <div className="text-2xl leading-8 flex items-center">
              <Bar w="62%" h="0.66em" r={5} />
            </div>
            <div className="text-[10px] leading-4 mt-2 flex items-center">
              <Bar w="80%" h="0.8em" r={3} />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * Rows inside a panel.
 *
 * The markup is COPIED from the real row in CreatorHomeScreen's NeedsYou, not
 * approximated: same wrapper classes (`px-3 py-2.5`, `gap-3`, `rounded-xl`),
 * same 8x8 icon square, same two text lines at `text-sm` and `text-xs` with the
 * same `mt-0.5` between them. Height therefore comes from the same box model
 * rather than from a hard-coded pixel value that drifts the first time anyone
 * changes the padding.
 *
 * The text bars are sized in `em` off their own line's font-size, so they match
 * the cap height of the text they stand in for at any type scale.
 */
export function RowsSkeleton({ rows = 3 }) {
  return (
    <div className="grid gap-1.5">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 rounded-xl px-3 py-2.5"
          style={{ background: 'rgba(255,255,255,0.02)' }}>
          <span className="shrink-0 w-8 h-8 rounded-lg"
            style={{ background: 'rgba(255,255,255,0.045)' }} />
          <div className="min-w-0 flex-1">
            {/* text-sm line */}
            <div className="text-sm leading-5 flex items-center">
              <Bar w={`${72 - i * 9}%`} h="0.72em" r={4} />
            </div>
            {/* text-xs line, mt-0.5, exactly as the real row */}
            <div className="text-xs leading-4 mt-0.5 flex items-center">
              <Bar w={`${44 - i * 6}%`} h="0.72em" r={4} />
            </div>
          </div>
          <span className="shrink-0 w-5 h-5 rounded"
            style={{ background: 'rgba(255,255,255,0.03)' }} />
        </div>
      ))}
    </div>
  );
}

export function ChartSkeleton({ height = 260 }) {
  return <Bar w="100%" h={height} r={12} />;
}

// ── Per-screen presets ────────────────────────────────────────────────
// One per screen so a screen's loading state cannot drift from its layout:
// change the screen, change its preset directly below it.

/** CreatorEarningsScreen: tier hero, 3 money tiles, payout card, ladder. */
export function EarningsSkeleton() {
  return (
    <div className="space-y-4" aria-busy="true">
      <Style />
      <div className="vg-material vg-grain rounded-2xl overflow-hidden">
        <div className="relative z-[1] p-6">
          <Bar w={180} h={54} r={10} />
          <div className="mt-5"><Bar w="100%" h={8} r={4} /></div>
          <div className="mt-3"><Bar w={240} h={11} /></div>
        </div>
      </div>
      <KpiGridSkeleton count={3} cols={3} />
      <PanelSkeleton><ChartSkeleton height={92} /></PanelSkeleton>
      <PanelSkeleton><RowsSkeleton rows={3} /></PanelSkeleton>
    </div>
  );
}

/** MonthlyAnalyticsScreen: KPI row, trend, two format panels, heatmap. */
export function AnalyticsSkeleton() {
  return (
    <div aria-busy="true">
      <Style />
      <div className="mb-6"><KpiGridSkeleton count={4} cols={4} /></div>
      <PanelSkeleton className="mb-3" subWidth={0}><ChartSkeleton height={280} /></PanelSkeleton>
      <div className="grid gap-3 lg:grid-cols-2 mb-3">
        <PanelSkeleton><ChartSkeleton height={260} /></PanelSkeleton>
        <PanelSkeleton><RowsSkeleton rows={4} /></PanelSkeleton>
      </div>
      <PanelSkeleton><ChartSkeleton height={180} /></PanelSkeleton>
    </div>
  );
}

/** CreatorHomeScreen: hero, needs-you rows, snapshot strip, last post. */
export function HomeSkeleton() {
  return (
    <div className="grid gap-4" aria-busy="true">
      <Style />
      <div className="vg-material vg-grain rounded-2xl overflow-hidden">
        <div className="relative z-[1] p-6 flex items-center justify-between gap-4 flex-wrap">
          <div>
            <Bar w={190} h={30} r={8} />
            <div className="mt-3"><Bar w={300} h={11} /></div>
          </div>
          <div className="flex gap-2">
            {[74, 68, 82, 68].map((w, i) => <Bar key={i} w={w} h={34} r={12} />)}
          </div>
        </div>
      </div>
      <PanelSkeleton><RowsSkeleton rows={2} /></PanelSkeleton>
      <div>
        <div className="mb-2 px-1"><Bar w={86} h={12} /></div>
        <KpiGridSkeleton count={4} cols={4} />
      </div>
      <PanelSkeleton>
        <div className="flex items-center gap-3">
          <Bar w={56} h={56} r={12} />
          <div className="flex-1"><Bar w="58%" h={12} /><div className="mt-2"><Bar w="38%" h={10} /></div></div>
        </div>
      </PanelSkeleton>
    </div>
  );
}

/** PayoutSetupScreen: waiting banner + four checklist steps. */
export function PayoutSetupSkeleton() {
  return (
    <div className="space-y-4" aria-busy="true">
      <Style />
      <PanelSkeleton titleWidth={150} subWidth={0}><Bar w={220} h={22} r={8} /></PanelSkeleton>
      <PanelSkeleton titleWidth={110} subWidth={260}>
        <RowsSkeleton rows={4} />
      </PanelSkeleton>
    </div>
  );
}

/** PayoutStatementScreen: the remittance document. */
export function StatementSkeleton() {
  return (
    <div className="space-y-4" aria-busy="true">
      <Style />
      <div className="vg-material vg-grain rounded-2xl overflow-hidden">
        <div className="relative z-[1] p-6">
          <div className="flex items-start justify-between pb-4">
            <div><Bar w={90} h={18} /><div className="mt-2"><Bar w={110} h={10} /></div></div>
            <div><Bar w={70} h={10} /><div className="mt-2"><Bar w={120} h={12} /></div></div>
          </div>
          <div className="grid grid-cols-2 gap-4 py-4">
            <div><Bar w={60} h={9} /><div className="mt-2"><Bar w={130} h={12} /></div></div>
            <div><Bar w={50} h={9} /><div className="mt-2"><Bar w={80} h={12} /></div></div>
          </div>
          <div className="py-4 space-y-3">
            {[0, 1, 2].map((i) => (
              <div key={i} className="flex items-center justify-between">
                <Bar w={120} h={11} /><Bar w={90} h={11} />
              </div>
            ))}
          </div>
          <div className="flex items-center justify-between pt-4">
            <Bar w={100} h={13} /><Bar w={130} h={26} r={8} />
          </div>
        </div>
      </div>
    </div>
  );
}

/** Fallback for studio screens that are a simple list of equal panels. */
export function PanelListSkeleton({ count = 4 }) {
  return (
    <div className="space-y-3" aria-busy="true">
      <Style />
      {Array.from({ length: count }).map((_, i) => (
        <PanelSkeleton key={i}><RowsSkeleton rows={2} /></PanelSkeleton>
      ))}
    </div>
  );
}
