// ShopLayout — chrome for every /shop/* route. Vergr Shop is the seller's
// standalone commerce workspace: catalog, orders, customers, store
// integrations. It sits OUTSIDE MainLayout (like WalletLayout) so the regular
// app shell doesn't render here. vergr.me is "just a tool"; this is the shop.
import { useMemo } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import Icon from '../components/Icon';
import useResponsive from '../hooks/useResponsive';
import { isMobileApp } from '../utils/platform';
import { useUser } from '../context/UserContext';

const NAV = [
  { path: '/shop',              label: 'Overview',     icon: 'dashboard' },
  { path: '/shop/products',     label: 'Products',     icon: 'inventory_2' },
  { path: '/shop/orders',       label: 'Orders',       icon: 'local_shipping' },
  { path: '/shop/customers',    label: 'Customers',    icon: 'group' },
  { path: '/shop/integrations', label: 'Integrations', icon: 'bolt' },
  { path: '/shop/settings',     label: 'Settings',     icon: 'settings' },
];

export default function ShopLayout() {
  const { isGuest } = useUser();
  const { isDesktop: wide } = useResponsive();
  const isDesktop = wide && !isMobileApp();
  const location = useLocation();
  const navigate = useNavigate();

  const matches = (p) => (p === '/shop' ? location.pathname === '/shop' : location.pathname.startsWith(p));
  const active = useMemo(() => NAV.find((n) => matches(n.path)) || NAV[0], [location.pathname]); // eslint-disable-line

  if (isGuest) return <ShopGuestGate navigate={navigate} />;

  return (
    <div className="min-h-screen flex" style={{ background: '#0B0B14', color: '#fff', fontFamily: 'DM Sans, system-ui, sans-serif' }}>
      {isDesktop && (
        <aside className="w-60 shrink-0 h-screen sticky top-0 flex flex-col bg-[#0F0F1A] border-r border-[#1E1E2E]">
          <button onClick={() => navigate('/home')} className="flex items-center gap-2 px-4 h-14 border-b border-white/[0.05] text-text-secondary hover:text-white text-[13px]">
            <Icon name="arrow_back" size={18} /> Exit shop
          </button>
          <div className="flex items-center gap-2.5 px-4 py-4">
            <img src="/brand/logo.png" alt="VERGR" className="w-8 h-8 rounded-lg" />
            <div className="leading-tight">
              <div className="font-syne text-base font-extrabold">Vergr Shop</div>
              <div className="text-[10px] font-dmmono uppercase tracking-wider text-text-muted">Sell · fulfil · grow</div>
            </div>
          </div>
          <nav className="flex-1 px-2 py-2 space-y-0.5 overflow-y-auto no-scrollbar">
            {NAV.map((n) => {
              const on = matches(n.path);
              return (
                <button key={n.path} onClick={() => navigate(n.path)}
                  className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-[13px] relative ${on ? 'bg-[#1E1035] text-white font-bold' : 'text-text-secondary hover:bg-[#1A1A2A] hover:text-white font-medium'}`}>
                  {on && <span className="absolute right-0 top-0 bottom-0 w-[2px] bg-[#B44FFF]" />}
                  <Icon name={n.icon} filled={on} size={20} /> {n.label}
                </button>
              );
            })}
          </nav>
          <div className="px-2 pb-4 pt-2 border-t border-white/[0.05]">
            <button onClick={() => navigate('/vergrme/edit')} className="w-full flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-[#1A1A2A] text-[13px] font-medium text-text-secondary hover:text-white">
              <Icon name="link" size={20} /> My vergr.me
            </button>
            <button onClick={() => navigate('/help')} className="w-full flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-[#1A1A2A] text-[13px] font-medium text-text-secondary hover:text-white">
              <Icon name="help" size={20} /> Help
            </button>
          </div>
        </aside>
      )}

      <main className="flex-1 min-w-0 flex flex-col" style={{ paddingBottom: isDesktop ? 0 : 'env(safe-area-inset-bottom)' }}>
        {/* Mobile header + horizontal pill nav */}
        {!isDesktop && (
          <header className="sticky top-0 z-30 bg-[#07080D]/90 backdrop-blur-md border-b border-white/[0.06]"
            style={{ paddingTop: 'calc(env(safe-area-inset-top) + 8px)' }}>
            <div className="flex items-center gap-2 px-4 pb-2">
              <button onClick={() => navigate('/home')} className="text-text-secondary"><Icon name="arrow_back" size={22} /></button>
              <div className="font-syne font-extrabold text-lg">Vergr Shop</div>
              <div className="flex-1" />
              <div className="font-syne font-bold text-sm text-brand-violet-light">{active.label}</div>
            </div>
            <div className="flex gap-1.5 px-3 pb-2 overflow-x-auto no-scrollbar">
              {NAV.map((n) => {
                const on = matches(n.path);
                return (
                  <button key={n.path} onClick={() => navigate(n.path)}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs whitespace-nowrap ${on ? 'bg-brand-violet text-white font-semibold' : 'bg-surface-2 text-text-secondary'}`}>
                    <Icon name={n.icon} size={15} filled={on} /> {n.label}
                  </button>
                );
              })}
            </div>
          </header>
        )}

        <div className="flex-1 px-4 md:px-8 py-5 md:py-7 max-w-[980px] w-full mx-auto">
          <Outlet />
        </div>
      </main>
    </div>
  );
}

function ShopGuestGate({ navigate }) {
  return (
    <div className="min-h-screen flex items-center justify-center px-5" style={{ background: '#0B0B14', color: '#fff' }}>
      <div className="w-full max-w-md text-center bg-surface-1 border border-white/[0.06] rounded-3xl p-9">
        <div className="w-16 h-16 rounded-2xl mx-auto mb-5 flex items-center justify-center" style={{ background: 'linear-gradient(135deg,#7B1FFF,#B44FFF)' }}>
          <Icon name="storefront" size={30} className="text-white" />
        </div>
        <h1 className="font-syne font-extrabold text-2xl mb-2.5">Open your Vergr Shop</h1>
        <p className="text-sm text-text-secondary leading-relaxed mb-6">Sell digital and physical products, connect Shopify or WooCommerce, and keep 92% of every sale. Create a free account to start.</p>
        <button onClick={() => navigate('/signup')} className="w-full h-12 rounded-xl font-bold text-white" style={{ background: 'linear-gradient(135deg,#7B1FFF,#B44FFF)' }}>Create free account</button>
        <button onClick={() => navigate('/home')} className="w-full h-11 mt-2.5 rounded-xl font-semibold text-sm text-text-secondary border border-white/10">Exit shop</button>
      </div>
    </div>
  );
}
