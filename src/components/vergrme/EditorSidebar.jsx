import { useNavigate } from 'react-router-dom';
import Icon from '../Icon';

export const SECTIONS = [
  { id: 'dashboard', label: 'Dashboard', icon: 'home' },
  { id: 'appearance', label: 'Appearance', icon: 'palette' },
  { id: 'links', label: 'Links', icon: 'link' },
  { id: 'media', label: 'Media', icon: 'image' },
  { id: 'products', label: 'Products', icon: 'storefront' },
  { id: 'analytics', label: 'Analytics', icon: 'bar_chart' },
  { id: 'integrations', label: 'Integrations', icon: 'bolt' },
  { id: 'settings', label: 'Settings', icon: 'settings' },
];

// Editor left rail. Matches the app's DesktopSidebar look (dark #0F0F1A,
// violet active pill) so vergr.me feels native, not a bolted-on tool.
export default function EditorSidebar({ active, onSelect, isPro, open, onClose }) {
  const navigate = useNavigate();

  const NavBtn = ({ s }) => {
    const isActive = active === s.id;
    return (
      <button
        onClick={() => { onSelect(s.id); onClose?.(); }}
        className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg transition-all duration-150 relative text-[13px] tracking-tight ${
          isActive
            ? 'bg-[#1E1035] text-white font-bold'
            : 'text-text-secondary hover:bg-[#1A1A2A] hover:text-text-primary font-medium'
        }`}
        style={isActive ? { borderRight: '2px solid #B44FFF' } : undefined}
      >
        {isActive && <span className="absolute right-0 top-0 bottom-0 w-[2px] bg-[#B44FFF]" />}
        <Icon name={s.icon} filled={isActive} size={20} /> {s.label}
      </button>
    );
  };

  const Nav = (
    <div className="w-60 h-full flex flex-col bg-[#0F0F1A] border-r border-[#1E1E2E] text-white shrink-0">
      {/* Brand header — app logo + Vergr.me */}
      <button
        onClick={() => navigate('/')}
        className="flex items-center gap-2.5 px-4 py-4 border-b border-white/[0.04] hover:bg-white/[0.02] transition-colors"
      >
        <img src="/brand/logo.png" alt="VERGR" className="w-8 h-8 rounded-lg shrink-0" />
        <div className="text-left leading-tight">
          <div className="font-syne text-base font-extrabold tracking-wide text-text-primary">Vergr.me</div>
          <div className="text-[10px] font-dmmono uppercase tracking-wider text-text-muted">{isPro ? 'Pro plan' : 'Free plan'}</div>
        </div>
      </button>

      {/* Nav */}
      <nav className="flex-1 px-2 py-3 space-y-0.5 overflow-y-auto no-scrollbar">
        <div className="px-3 pb-1.5 text-[9.5px] font-dmmono uppercase tracking-[0.18em] text-text-muted/70">Builder</div>
        {SECTIONS.map((s) => <NavBtn key={s.id} s={s} />)}
      </nav>

      {/* Bottom */}
      <div className="px-2 pb-4 pt-2 space-y-0.5 border-t border-white/[0.05]">
        <button onClick={() => navigate('/help')} className="w-full flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-[#1A1A2A] text-[13px] font-medium text-text-secondary hover:text-text-primary">
          <Icon name="help" size={20} /> Help & Support
        </button>
        <button onClick={() => navigate('/settings')} className="w-full flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-[#1A1A2A] text-[13px] font-medium text-text-secondary hover:text-text-primary">
          <Icon name="account_circle" size={20} /> Account
        </button>
      </div>
    </div>
  );

  return (
    <>
      {/* Desktop */}
      <div className="hidden lg:block h-full">{Nav}</div>

      {/* Mobile drawer */}
      {open && (
        <div className="lg:hidden fixed inset-0 z-50 flex">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
          <div className="relative h-full shadow-2xl animate-[slidein_0.2s_ease]">{Nav}</div>
        </div>
      )}
    </>
  );
}
