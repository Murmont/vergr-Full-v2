import useResponsive from '../../hooks/useResponsive';
import VergrLogo from '../VergrLogo';
import Icon from '../Icon';

// Shared auth layout. On desktop it's a two-panel split (brand hero + form),
// so the auth screens stop looking like a phone-sized column floating in a
// dark void. On mobile/native it's the original centered column with the
// violet vignette — unchanged. Every auth screen wraps its form in this.

const FEATURES = [
  { icon: 'emoji_events', title: 'Compete for real', desc: 'Run and join tournaments with real prizes.' },
  { icon: 'sensors',      title: 'Go live to your squad', desc: 'Stream, co-host and clip your best plays.' },
  { icon: 'toll',         title: 'Earn VP, cash out', desc: 'Rack up rewards and withdraw to crypto.' },
];

function Vignette({ subtle = false }) {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute"
      style={{
        left: '50%', top: '50%', transform: 'translate(-50%, -50%)',
        width: 'min(1100px, 160vw)', height: 'min(900px, 120vh)',
        background: subtle
          ? 'radial-gradient(ellipse at center, rgba(123,31,255,0.12) 0%, rgba(123,31,255,0.06) 40%, transparent 72%)'
          : 'radial-gradient(ellipse at center, rgba(123,31,255,0.22) 0%, rgba(123,31,255,0.14) 22%, rgba(123,31,255,0.07) 45%, rgba(123,31,255,0.03) 62%, transparent 78%)',
        filter: 'blur(20px)', zIndex: 0,
      }}
    />
  );
}

export default function AuthShell({ children }) {
  const { isDesktop } = useResponsive();

  // Mobile / native: original centered column + vignette (unchanged look).
  if (!isDesktop) {
    return (
      <div className="screen-container items-center justify-center p-6 min-h-screen relative overflow-hidden">
        <Vignette />
        <div className="w-full max-w-[400px] relative z-10">{children}</div>
      </div>
    );
  }

  // Desktop: brand hero (left) + form (right).
  return (
    <div className="min-h-screen flex bg-bg-dark">
      {/* ── Hero panel ── */}
      <div className="relative w-1/2 max-w-[680px] shrink-0 overflow-hidden flex flex-col justify-between p-12 xl:p-16 border-r border-white/[0.06]">
        {/* Layered brand gradient + glow */}
        <div aria-hidden className="absolute inset-0" style={{
          background: 'linear-gradient(155deg,#0d0820 0%,#160a33 40%,#1e0a44 70%,#120a28 100%)',
        }} />
        <div aria-hidden className="absolute" style={{
          left: '-10%', top: '-10%', width: '70%', height: '60%',
          background: 'radial-gradient(ellipse at center, rgba(180,79,255,0.28) 0%, transparent 70%)', filter: 'blur(40px)',
        }} />
        <div aria-hidden className="absolute" style={{
          right: '-15%', bottom: '-10%', width: '70%', height: '60%',
          background: 'radial-gradient(ellipse at center, rgba(200,127,255,0.18) 0%, transparent 70%)', filter: 'blur(50px)',
        }} />

        <div className="relative z-10 flex items-center gap-3">
          <VergrLogo size={40} />
          <span className="font-syne font-extrabold text-xl text-white tracking-tight">VERGR</span>
        </div>

        <div className="relative z-10 max-w-[440px]">
          <h2 className="font-syne text-4xl xl:text-5xl font-extrabold text-white leading-[1.05] mb-4">
            Where gamers<br />converge.
          </h2>
          <p className="text-text-secondary text-base mb-9 leading-relaxed">
            Tournaments, live streams, squads and a real creator economy — one home for competitive play.
          </p>
          <ul className="space-y-4">
            {FEATURES.map((f) => (
              <li key={f.title} className="flex items-start gap-3.5">
                <span className="w-10 h-10 rounded-xl shrink-0 flex items-center justify-center"
                  style={{ background: 'rgba(123,31,255,0.18)', border: '1px solid rgba(180,79,255,0.35)', color: '#C87FFF' }}>
                  <Icon name={f.icon} size={20} />
                </span>
                <div>
                  <p className="text-white font-bold text-sm">{f.title}</p>
                  <p className="text-text-muted text-[13px] leading-snug">{f.desc}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>

        <p className="relative z-10 text-text-muted text-xs">© 2026 Vergr · Play. Stream. Earn.</p>
      </div>

      {/* ── Form panel ── */}
      <div className="flex-1 flex items-center justify-center p-8 relative overflow-hidden">
        <Vignette subtle />
        <div className="w-full max-w-[420px] relative z-10">{children}</div>
      </div>
    </div>
  );
}
