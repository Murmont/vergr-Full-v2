// Full-width hero banner used at the top of major sections.
// Uses one of the supplied banner PNGs as the background.
//
// variants: 'trophy' | 'red-v' | 'cyan-v' | 'violet-gem'
//
// Example:
//   <HeroBanner variant="trophy"
//     eyebrow="VERGR CHAMPIONSHIP"
//     title="$25,000 Prize Pool"
//     cta={{ label: 'View Details', onClick: () => nav('...') }}
//   />
import Icon from '../Icon';

const BG = {
  'trophy':      '/brand/banner-trophy.png',
  'red-v':       '/brand/banner-red-v.png',
  'cyan-v':      '/brand/banner-cyan-v.png',
  'violet-gem':  '/brand/banner-violet-gem.webp',
};

export default function HeroBanner({
  variant = 'trophy',
  eyebrow,
  title,
  subtitle,
  cta,
  height = 'md',   // 'sm' | 'md' | 'lg'
  children,
}) {
  const bg = BG[variant] || BG.trophy;
  const h = height === 'lg' ? 'h-64' : height === 'sm' ? 'h-36' : 'h-48';

  return (
    <div className={`relative w-full ${h} rounded-2xl overflow-hidden border border-white/[0.06] shadow-xl shadow-black/40`}>
      <img src={bg} alt="" className="absolute inset-0 w-full h-full object-cover" />
      <div className="absolute inset-0 bg-gradient-to-r from-[#07080D]/90 via-[#07080D]/40 to-transparent" />
      <div className="relative h-full flex flex-col justify-center px-8 max-w-[62%]">
        {eyebrow && (
          <div className="text-[10px] font-dmmono uppercase tracking-[0.22em] text-brand-violet-light mb-2">
            {eyebrow}
          </div>
        )}
        {title && (
          <h2 className="font-syne text-3xl md:text-4xl font-extrabold text-text-primary leading-[1.05] tracking-tight">
            {title}
          </h2>
        )}
        {subtitle && (
          <p className="text-sm text-text-secondary mt-2 max-w-md">{subtitle}</p>
        )}
        {cta && (
          <button
            onClick={cta.onClick}
            className="mt-4 inline-flex items-center gap-2 self-start px-4 py-2 rounded-xl bg-gradient-to-r from-brand-violet to-brand-pink text-white font-semibold text-sm hover:brightness-110 active:scale-[0.98] transition-all shadow-lg shadow-brand-violet/30"
          >
            {cta.label}
            <Icon name="arrow_forward" size={16} />
          </button>
        )}
        {children}
      </div>
    </div>
  );
}
