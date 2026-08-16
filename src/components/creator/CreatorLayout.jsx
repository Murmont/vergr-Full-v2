// src/components/creator/CreatorLayout.jsx
// Professional creator studio shell — fixed left sidebar on desktop, sticky topbar,
// bottom nav on mobile. Sidebar collapsible to icon-only.
import { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { BecomeCreatorModal } from '../../screens/creator/BecomeCreatorScreen';
import { useAuth } from '../../context/AuthContext';
import { useUser } from '../../context/UserContext';
import useResponsive from '../../hooks/useResponsive';
import { IS_NATIVE_BUILD } from '../../utils/platform';
import Icon from '../Icon';
import UserAvatar from '../UserAvatar';
import CoinDisplay from '../CoinDisplay';
import PlanLock from './PlanLock';
import useTier from '../../hooks/useTier';
import CreateComposer from '../composer/CreateComposer';

// `lock` = minimum tier needed. undefined = free.
const NAV = [
  { key: 'home',        label: 'Home',         icon: 'dashboard',                path: '/creator/dashboard' },
  { key: 'analytics',   label: 'Analytics',    icon: 'analytics',                path: '/creator/analytics',  lock: 'lite' },
  { key: 'earnings',    label: 'Earnings',     icon: 'paid',                     path: '/creator/earnings' },
  { key: 'content',     label: 'Content',      icon: 'grid_view',                path: '/creator/content' },
  { key: 'schedule',    label: 'Schedule',     icon: 'calendar_month',           path: '/creator/schedule',   lock: 'lite' },
  { key: 'audience',    label: 'Audience',     icon: 'groups',                   path: '/creator/audience' },
  { key: 'ads',         label: 'Ads',          icon: 'campaign',                 path: '/creator/ads' },
  { key: 'memberships', label: 'Memberships',  icon: 'workspace_premium',        path: '/creator/membership' },
  { key: 'quests',      label: 'Quests',       icon: 'military_tech',            path: '/creator/quests' },
  { key: 'verify',      label: 'Verify',       icon: 'verified',                 path: '/creator/verify' },
];

const MOBILE_NAV = [
  { key: 'home',      label: 'Home',      icon: 'dashboard',      path: '/creator/dashboard' },
  { key: 'analytics', label: 'Insights',  icon: 'analytics',      path: '/creator/analytics' },
  { key: 'earnings',  label: 'Earnings',  icon: 'paid',           path: '/creator/earnings' },
  { key: 'schedule',  label: 'Schedule',  icon: 'calendar_month', path: '/creator/schedule' },
  { key: 'more',      label: 'More',      icon: 'menu',           path: null },
];

export default function CreatorLayout({ children, page = 'home', title, subtitle, headerRight = null, requiredTier = null, lockTitle, lockDescription }) {
  const navigate = useNavigate();
  const location = useLocation();
  const { currentUser } = useAuth();
  const { profile, wallet } = useUser();
  // A non-creator opening Creator Studio gets the explainer, not an empty
  // dashboard. Anyone can use Vergr; only a creator can monetize.
  const [gateOpen, setGateOpen] = useState((profile?.creator?.status || 'none') === 'none');
  const { isDesktop } = useResponsive();
  const { tier } = useTier();

  // Wrap page body in PlanLock when the page requires a tier the user doesn't have
  const RANK = { free: 0, lite: 1, pro: 2 };
  const needsLock = requiredTier && (RANK[tier] ?? 0) < (RANK[requiredTier] ?? 0);
  const body = needsLock
    ? <PlanLock required={requiredTier} title={lockTitle || `${requiredTier === 'pro' ? 'Pro' : 'Lite'}-only feature`} description={lockDescription}>{children}</PlanLock>
    : children;
  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem('vergr_creator_sidebar_collapsed') === '1'; } catch { return false; }
  });
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [composerOpen, setComposerOpen] = useState(false);
  const [composerRect, setComposerRect] = useState(null);

  useEffect(() => {
    try { localStorage.setItem('vergr_creator_sidebar_collapsed', collapsed ? '1' : '0'); } catch {}
  }, [collapsed]);

  // Any creator screen can open the new post composer via this window event.
  useEffect(() => {
    const open = (e) => { setComposerRect(e?.detail?.rect || null); setComposerOpen(true); };
    window.addEventListener('vergr:open-composer', open);
    return () => window.removeEventListener('vergr:open-composer', open);
  }, []);

  const composerNode = composerOpen
    ? <CreateComposer onClose={() => setComposerOpen(false)} originRect={composerRect} />
    : null;

  const greeting = (() => {
    const h = new Date().getHours();
    if (h < 5)  return 'Still up';
    if (h < 12) return 'Good morning';
    if (h < 18) return 'Good afternoon';
    return 'Good evening';
  })();

  const firstName = (profile?.displayName || profile?.username || 'Creator').split(' ')[0];

  // ──────────────────────────────── DESKTOP ────────────────────────────────
  if (isDesktop) {
    const sidebarWidth = collapsed ? 72 : 260;
    return (
      <div className="min-h-screen bg-gradient-to-br from-[#07080c] via-[#0a0d14] to-[#07080c] text-text-primary">
      <BecomeCreatorModal open={gateOpen} onClose={() => setGateOpen(false)} />
        {/* ── Sidebar ── */}
        <aside
          style={{ width: sidebarWidth }}
          className="fixed inset-y-0 left-0 z-40 bg-[#0b0e15]/90 backdrop-blur-xl border-r border-white/[0.05] flex flex-col transition-[width] duration-200">
          {/* Brand */}
          <button onClick={() => navigate('/')}
            className={`flex items-center gap-3 h-16 px-4 border-b border-white/[0.05] hover:bg-white/[0.02] transition-colors ${collapsed ? 'justify-center' : ''}`}>
            <img src="/brand/logo.png" alt="VERGR" className="w-9 h-9 rounded-xl object-contain shrink-0" />
            {!collapsed && (
              <div className="min-w-0">
                <div className="font-syne font-extrabold text-[13px] tracking-wider text-white leading-none">STUDIO</div>
                <div className="text-[10px] text-text-muted uppercase tracking-[0.2em] mt-0.5">VERGR Creator</div>
              </div>
            )}
          </button>

          {/* Nav */}
          <nav className="flex-1 py-4 px-2 space-y-1 overflow-y-auto no-scrollbar">
            {NAV.map((item) => {
              const active = page === item.key || location.pathname === item.path;
              const locked = item.lock && (RANK[tier] ?? 0) < (RANK[item.lock] ?? 0);
              return (
                <button key={item.key} onClick={() => navigate(item.path)}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all group relative ${
                    active
                      ? 'bg-gradient-to-r from-brand-violet/20 via-brand-violet/10 to-transparent text-white border border-white/[0.08]'
                      : 'text-text-muted hover:text-text-primary hover:bg-white/[0.03] border border-transparent'
                  } ${collapsed ? 'justify-center' : ''}`}>
                  {active && (
                    <span className="absolute left-0 top-2 bottom-2 w-[3px] rounded-r-full bg-gradient-to-b from-brand-violet to-brand-violet" />
                  )}
                  <Icon name={item.icon} filled={active} size={20} className={active ? 'text-brand-violet-light' : ''} />
                  {!collapsed && <span className="text-sm font-semibold flex-1 text-left">{item.label}</span>}
                  {!collapsed && locked && (
                    <span className={`px-1.5 py-0.5 rounded-md text-[8px] font-extrabold uppercase tracking-wider ${item.lock === 'pro' ? 'bg-brand-gold/15 text-brand-gold' : 'bg-brand-violet/15 text-brand-violet'}`}>
                      {item.lock}
                    </span>
                  )}
                  {collapsed && locked && (
                    <span className={`absolute top-1 right-1 w-1.5 h-1.5 rounded-full ${item.lock === 'pro' ? 'bg-brand-gold' : 'bg-brand-violet'}`} />
                  )}
                </button>
              );
            })}

            <div className="pt-3 mt-3 border-t border-white/[0.05]">
              <button onClick={() => navigate('/settings')}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-text-muted hover:text-text-primary hover:bg-white/[0.03] transition-colors ${collapsed ? 'justify-center' : ''}`}>
                <Icon name="settings" size={20} />
                {!collapsed && <span className="text-sm font-semibold">Settings</span>}
              </button>
              <button onClick={() => navigate('/')}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-rose-400/80 hover:text-rose-300 hover:bg-rose-500/10 transition-colors ${collapsed ? 'justify-center' : ''}`}>
                <Icon name="logout" size={20} />
                {!collapsed && <span className="text-sm font-semibold">Exit Studio</span>}
              </button>
            </div>
          </nav>

          {/* Collapse toggle + profile mini */}
          <div className="border-t border-white/[0.05] p-3 space-y-2">
            {!collapsed && profile && (
              <button onClick={() => navigate(`/user/${profile.username}`)}
                className="w-full flex items-center gap-2.5 px-2 py-2 rounded-xl hover:bg-white/[0.03] transition-colors">
                <UserAvatar src={profile.avatar} size={32} />
                <div className="flex-1 min-w-0 text-left">
                  <div className="text-xs font-bold text-text-primary truncate">{profile.displayName || profile.username}</div>
                  <div className="text-[10px] text-text-muted truncate">@{profile.username}</div>
                </div>
                <Icon name="open_in_new" size={12} className="text-text-muted" />
              </button>
            )}
            <button onClick={() => setCollapsed(c => !c)}
              className="w-full flex items-center justify-center h-8 rounded-lg bg-white/[0.03] hover:bg-white/[0.06] text-text-muted hover:text-text-secondary transition-colors">
              <Icon name={collapsed ? 'chevron_right' : 'chevron_left'} size={16} />
            </button>
          </div>
        </aside>

        {/* ── Main ── */}
        <div style={{ marginLeft: sidebarWidth }} className="flex-1 transition-[margin] duration-200">
          {/* Sticky topbar */}
          <header className="sticky top-0 z-30 h-16 bg-[#0a0d14]/80 backdrop-blur-xl border-b border-white/[0.05] px-6 flex items-center gap-4">
            <div className="flex-1 min-w-0">
              <h1 className="font-syne text-xl font-extrabold text-white leading-tight truncate">
                {title || `${greeting}, ${firstName}`}
              </h1>
              {subtitle && <p className="text-xs text-text-muted truncate">{subtitle}</p>}
            </div>

            {headerRight}

            <button onClick={() => navigate('/wallet')}
              className="hidden xl:flex items-center gap-2 px-3 h-9 rounded-xl bg-white/[0.04] border border-white/[0.06] hover:bg-white/[0.08] transition-colors">
              <CoinDisplay amount={wallet?.balance || 0} size="xs" clickable={false} />
            </button>
            <button onClick={() => navigate('/go-live')}
              className="flex items-center gap-2 px-4 h-9 rounded-xl bg-gradient-to-r from-brand-ember to-rose-500 text-white font-bold text-sm shadow-[0_6px_20px_-4px_rgba(244,63,94,0.5)] hover:brightness-110 transition-all">
              <span className="relative flex items-center">
                <span className="w-1.5 h-1.5 rounded-full bg-white" />
                <span className="absolute w-1.5 h-1.5 rounded-full bg-white animate-ping" />
              </span>
              Go Live
            </button>
            <button onClick={(e) => window.dispatchEvent(new CustomEvent('vergr:open-composer', { detail: { rect: e.currentTarget.getBoundingClientRect() } }))}
              className="hidden md:flex items-center gap-1.5 px-4 h-9 rounded-xl bg-brand-violet text-white font-bold text-sm hover:brightness-110 transition-all">
              <Icon name="add" size={16} /> Create
            </button>
          </header>

          {/* Page body */}
          <main className="p-6 pb-12 max-w-[1500px] mx-auto">
            {body}
          </main>
        </div>
        {composerNode}
      </div>
    );
  }

  // ──────────────────────────────── MOBILE ────────────────────────────────
  return (
    <div className="min-h-screen bg-gradient-to-br from-[#07080c] via-[#0a0d14] to-[#07080c] text-text-primary pb-20">
      {/* Top bar — the Android status bar overlays the edge-to-edge WebView, so
          inset the native header below it (web/desktop: env() resolves to 0). */}
      <header className="sticky top-0 z-30 bg-[#0a0d14]/85 backdrop-blur-xl border-b border-white/[0.05]"
        style={IS_NATIVE_BUILD ? { paddingTop: 'calc(env(safe-area-inset-top, 0px) + 8px)' } : undefined}>
        <div className="flex items-center gap-3 h-14 px-4">
          <button onClick={() => navigate(-1)} className="w-9 h-9 rounded-full bg-white/[0.04] flex items-center justify-center">
            <Icon name="arrow_back_ios_new" size={14} />
          </button>
          <div className="flex-1 min-w-0">
            <h1 className="font-syne text-sm font-extrabold text-white truncate">{title || 'Creator Studio'}</h1>
            {subtitle && <p className="text-[10px] text-text-muted truncate">{subtitle}</p>}
          </div>
          <button onClick={() => navigate('/go-live')}
            className="flex items-center gap-1.5 px-3 h-9 rounded-xl bg-gradient-to-r from-brand-ember to-rose-500 text-white font-bold text-xs shadow-[0_4px_14px_-3px_rgba(244,63,94,0.5)]">
            <span className="relative w-1.5 h-1.5 rounded-full bg-white">
              <span className="absolute inset-0 rounded-full bg-white animate-ping" />
            </span>
            Live
          </button>
        </div>
      </header>

      {/* Greeting strip for home only */}
      {page === 'home' && (
        <div className="px-4 pt-4 pb-2 flex items-center gap-3">
          <UserAvatar src={profile?.avatar} size={44} />
          <div className="flex-1 min-w-0">
            <p className="text-text-muted text-xs">{greeting},</p>
            <p className="text-text-primary text-base font-extrabold truncate">{firstName}</p>
          </div>
          <CoinDisplay amount={wallet?.balance || 0} size="sm" clickable onClick={() => navigate('/wallet')} />
        </div>
      )}

      <main className="px-4 py-4 pb-32">{body}</main>

      {/* Mobile bottom nav (creator-specific) */}
      <nav className="fixed bottom-0 left-0 right-0 z-40 bg-[#0b0e15]/95 backdrop-blur-xl border-t border-white/[0.05] safe-bottom">
        <div className="grid grid-cols-5 h-14">
          {MOBILE_NAV.map((tab) => {
            const active = tab.key === page || (tab.path && location.pathname === tab.path);
            const handle = () => {
              if (tab.key === 'more') return setMobileMenuOpen(true);
              navigate(tab.path);
            };
            return (
              <button key={tab.key} onClick={handle}
                className={`flex flex-col items-center justify-center gap-0.5 transition-colors ${active ? 'text-brand-violet-light' : 'text-text-muted'}`}>
                <Icon name={tab.icon} filled={active} size={20} />
                <span className="text-[9px] font-bold uppercase tracking-wider">{tab.label}</span>
              </button>
            );
          })}
        </div>
      </nav>

      {/* "More" sheet */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-50" onClick={() => setMobileMenuOpen(false)}>
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
          <div className="absolute bottom-0 left-0 right-0 rounded-t-3xl bg-[#0b0e15] border-t border-white/[0.06] safe-bottom"
            onClick={(e) => e.stopPropagation()}>
            <div className="flex justify-center pt-2">
              <div className="w-10 h-1 rounded-full bg-white/15" />
            </div>
            <div className="p-4 space-y-1">
              <p className="text-[11px] font-bold uppercase tracking-widest text-text-muted px-2 pb-1">Creator tools</p>
              {NAV.filter(n => !MOBILE_NAV.find(m => m.key === n.key)).concat([
                { key: 'settings', label: 'Settings', icon: 'settings', path: '/settings' },
              ]).map((item) => (
                <button key={item.key} onClick={() => { setMobileMenuOpen(false); navigate(item.path); }}
                  className="w-full flex items-center gap-3 px-3 py-3 rounded-xl hover:bg-white/[0.04] text-left">
                  <div className="w-9 h-9 rounded-lg bg-white/[0.04] flex items-center justify-center">
                    <Icon name={item.icon} size={18} className="text-brand-violet-light" />
                  </div>
                  <span className="text-sm font-semibold text-text-primary">{item.label}</span>
                  <Icon name="chevron_right" size={14} className="ml-auto text-text-muted" />
                </button>
              ))}
              <button onClick={() => { setMobileMenuOpen(false); navigate('/'); }}
                className="w-full flex items-center gap-3 px-3 py-3 rounded-xl hover:bg-rose-500/10 text-left mt-2 border-t border-white/[0.05] pt-4">
                <div className="w-9 h-9 rounded-lg bg-rose-500/15 flex items-center justify-center">
                  <Icon name="logout" size={18} className="text-rose-400" />
                </div>
                <span className="text-sm font-semibold text-rose-400">Exit Creator Studio</span>
              </button>
            </div>
          </div>
        </div>
      )}
      {composerNode}
    </div>
  );
}
