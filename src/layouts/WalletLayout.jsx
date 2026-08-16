// WalletLayout — chrome for every /wallet/* route. Own sidebar + topbar on
// desktop, own bottom-nav on mobile. Sits OUTSIDE MainLayout so the regular
// app shell (DesktopSidebar + BottomNav) does NOT render here. Single
// "Exit Wallet" button takes the user back to /home.

import { useEffect, useState } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import Icon from '../components/Icon';
import useResponsive from '../hooks/useResponsive';
import { isMobileApp } from '../utils/platform';
import { useUser } from '../context/UserContext';
import { WalletUnlockProvider, useWalletUnlock } from '../context/WalletUnlockContext';
import PinUnlockModal from '../components/wallet/PinUnlockModal';
import WalletOnboarding from '../components/wallet/WalletOnboarding';
import WalletWalkthrough from '../components/wallet/WalletWalkthrough';
import { getMyWalletSecurityStatus } from '../firebase/walletCallables';
import { COIN_VALUE_USD, GEM_VALUE_USD } from '../utils/vpSystem';

// LocalStorage flag — walkthrough plays once per browser, even if the user
// later cancels onboarding. They can replay manually from Settings.
const WALKTHROUGH_FLAG = 'vergr.wallet.walkthroughSeen.v1';
import {
  CoinGlyph, GemGlyph, VPGlyph, WALLET_TOKENS, fmtNum, fmtEUR, fmtUsd,
} from '../components/wallet/primitives';

const NAV_MONEY = [
  { path: '/wallet',          label: 'Home',     icon: 'home' },
  { path: '/wallet/buy',      label: 'Buy coins', icon: 'shopping_cart' },
  { path: '/wallet/referral', label: 'Refer & Earn', icon: 'redeem' },
  { path: '/wallet/history',  label: 'History',  icon: 'history' },
];
const NAV_ACCOUNT = [
  { path: '/wallet/settings', label: 'Settings',         icon: 'settings' },
  { path: '/wallet/security', label: 'Security',         icon: 'lock' },
  { path: '/wallet/kyc',      label: 'KYC verification', icon: 'verified_user' },
];
// Mobile bottom-nav: 5 slots (Home / Buy / Convert / History / More).
// "More" opens a sheet (MobileMoreDrawer) with the rest — Refer & Earn,
// Settings, Security, KYC, Help — since referral + account items don't fit
// the 5 primary slots on a phone.
const MOBILE_NAV = [
  { path: '/wallet',         label: 'Home',    icon: 'home' },
  { path: '/wallet/buy',     label: 'Buy',     icon: 'shopping_cart' },
  { path: '/wallet/history', label: 'History', icon: 'history' },
  { label: 'More',   icon: 'menu', more: true },
];
// The "More" sheet — everything that isn't a primary bottom-nav slot.
const MORE_MENU = [
  { path: '/wallet/referral', label: 'Refer & Earn',     icon: 'redeem' },
  { path: '/wallet/settings', label: 'Settings',         icon: 'settings' },
  { path: '/wallet/security', label: 'Security',         icon: 'lock' },
  { path: '/wallet/kyc',      label: 'KYC verification', icon: 'verified_user' },
  { path: '/wallet/help',     label: 'Help & support',   icon: 'help' },
];

export default function WalletLayout() {
  const { isGuest } = useUser();
  // Guests have no wallet backend (the callables reject anonymous users), so
  // every wallet screen would either render an empty shell or throw the raw
  // "deploy functions/wallet.js" developer error. Show a clean account-gate
  // instead — the route still exists, it just prompts sign-up.
  if (isGuest) return <WalletGuestGate />;
  return (
    <WalletUnlockProvider>
      <WalletShell />
      <PinUnlockModal />
      <OnboardingGate />
    </WalletUnlockProvider>
  );
}

// Friendly stop for anonymous/guest sessions hitting /wallet/*.
function WalletGuestGate() {
  const navigate = useNavigate();
  return (
    <div style={{
      minHeight: '100vh', background: WALLET_TOKENS.bg, color: WALLET_TOKENS.text,
      fontFamily: 'DM Sans, system-ui, sans-serif',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: 'calc(24px + env(safe-area-inset-top)) 20px calc(24px + env(safe-area-inset-bottom))',
    }}>
      <div style={{
        width: '100%', maxWidth: 420, textAlign: 'center',
        background: WALLET_TOKENS.surface1, border: `1px solid ${WALLET_TOKENS.hairline}`,
        borderRadius: 20, padding: '36px 28px',
      }}>
        <div style={{
          width: 64, height: 64, margin: '0 auto 20px', borderRadius: 18,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: `linear-gradient(135deg, ${WALLET_TOKENS.violet}, ${WALLET_TOKENS.violetLight})`,
        }}>
          <Icon name="account_balance_wallet" size={32} style={{ color: '#fff' }} />
        </div>
        <h1 style={{ fontFamily: 'Syne, sans-serif', fontWeight: 800, fontSize: 24, margin: '0 0 10px' }}>
          Your wallet needs an account
        </h1>
        <p style={{ fontSize: 14, lineHeight: 1.6, color: WALLET_TOKENS.textSecondary, margin: '0 0 24px' }}>
          Coins are tied to a real account. Create a free
          one to buy and spend coins. It only takes a minute.
        </p>
        <button
          onClick={() => navigate('/signup')}
          style={{
            width: '100%', height: 48, borderRadius: 12, border: 'none', cursor: 'pointer',
            fontWeight: 800, fontSize: 14, color: '#fff',
            background: `linear-gradient(135deg, ${WALLET_TOKENS.violet}, ${WALLET_TOKENS.violetLight})`,
          }}>
          Create free account
        </button>
        <button
          onClick={() => navigate('/home')}
          style={{
            width: '100%', height: 44, marginTop: 10, borderRadius: 12, cursor: 'pointer',
            fontWeight: 600, fontSize: 13, color: WALLET_TOKENS.textSecondary,
            background: 'transparent', border: `1px solid ${WALLET_TOKENS.hairline}`,
          }}>
          Exit wallet
        </button>
      </div>
    </div>
  );
}

// First-visit gate. For users who haven't completed wallet onboarding yet:
//   1. Plays the cinematic 8-beat walkthrough (full-screen). Skippable.
//   2. Once walkthrough completes or is skipped, opens the PIN/2FA modal.
// LocalStorage flag prevents the walkthrough from replaying on every visit
// if the user dismissed it without finishing PIN setup. They can still
// replay via Settings → "Watch wallet intro" (planned).
function OnboardingGate() {
  const [status, setStatus] = useState(null);
  const [showWalkthrough, setShowWalkthrough] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [error, setError] = useState(null);
  const { profile } = useUser() || {};
  const isAdmin = profile?.role === 'admin';

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const s = await getMyWalletSecurityStatus();
        if (cancelled) return;
        setStatus(s);
        // Admins bypass onboarding entirely — testing convenience. They can
        // still set up a PIN later via Settings if they want.
        if (isAdmin) return;
        // A PIN that already exists IS a completed setup. `onboardingCompleted`
        // only started being stamped later, so accounts that set their PIN
        // before that were re-prompted through the whole wizard on every visit
        // with no way to dismiss it. Treat pinSet as authoritative.
        if (!s.onboardingCompleted && !s.pinSet) {
          // Walkthrough first (if never seen); else jump straight to PIN.
          const seen = (() => { try { return localStorage.getItem(WALKTHROUGH_FLAG) === '1'; } catch { return false; } })();
          if (seen) setShowOnboarding(true);
          else setShowWalkthrough(true);
        }
      } catch (e) {
        if (cancelled) return;
        setError(e?.message || 'Could not load wallet security status.');
      }
    })();
    return () => { cancelled = true; };
  }, [isAdmin]);

  const closeWalkthrough = () => {
    try { localStorage.setItem(WALKTHROUGH_FLAG, '1'); } catch {}
    setShowWalkthrough(false);
    setShowOnboarding(true);
  };

  if (error) {
    return (
      <div style={{
        position: 'fixed', top: 70, left: '50%', transform: 'translateX(-50%)',
        zIndex: 80, padding: '8px 14px', borderRadius: 8, fontSize: 12,
        background: 'rgba(240,64,96,0.10)',
        border: '1px solid rgba(240,64,96,0.32)',
        color: '#FCA5A5', maxWidth: '90vw',
      }}>
        Wallet backend not reachable. Deploy <code>functions/wallet.js</code> callables. ({error})
      </div>
    );
  }

  return (
    <>
      {showWalkthrough && (
        <WalletWalkthrough
          onComplete={closeWalkthrough}
          onSkip={closeWalkthrough}
        />
      )}
      <WalletOnboarding open={showOnboarding} onComplete={() => setShowOnboarding(false)} />
    </>
  );
}

// A `useStripeReturn()` hook lived here to catch Stripe Embedded Checkout's
// redirect back to `return_url` and clear the basket once `stripe_orders/{sid}`
// read `settled`. It went with the rest of Stripe on 2026-08-13.
//
// If a redirecting card rail is ever added back, the rule it encoded still
// holds and is the part worth keeping: a `session_id` in the URL is NOT proof of
// payment (anyone can type one), so the basket may only be cleared once the
// SERVER's own order doc says settled, written by a signature-verified webhook.
// A redirect is the normal path, not an edge case: 3-D Secure, iDEAL and most
// non-card methods all return that way, so the panel's own onPaid callback
// cannot be relied on.

function WalletShell() {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const { wallet } = useUser();
  // Desktop layout (sidebar) ONLY on a true desktop browser. The native mobile
  // shell is ALWAYS a phone, but its Android WebView can report a desktop-class
  // width (>=1024) AND ignore the CSS max-width media query — both width-based
  // checks failed there, leaving the sidebar visible on mobile. So force mobile
  // whenever we're in the native app (`isMobileApp()`), independent of width.
  // `isMobileApp()` is the same detection the update banner uses (proven on device).
  const { isDesktop: wideViewport } = useResponsive();
  const isDesktop = wideViewport && !isMobileApp();

  const path = location.pathname;
  const matches = (p) => (p === '/wallet' ? path === '/wallet' : path.startsWith(p));

  // Breadcrumbs derived from path
  const titles = {
    '/wallet':                       { title: 'Home',     parents: [] },
    '/wallet/buy':                   { title: 'Buy coins', parents: ['Coins'] },
    '/wallet/history':               { title: 'History',  parents: ['Coins'] },
    '/wallet/referral':              { title: 'Refer & Earn', m: 'Referrals', parents: ['Coins'] },
    '/wallet/settings':              { title: 'Settings', parents: ['Coins'] },
    '/wallet/security':              { title: 'Security', parents: ['Coins'] },
    '/wallet/security/pin':          { title: 'Change PIN', parents: ['Coins', 'Security'] },
    '/wallet/security/totp':         { title: 'Two-factor auth', m: 'Two-factor', parents: ['Coins', 'Security'] },
    '/wallet/kyc':                   { title: 'KYC verification', m: 'KYC', parents: ['Coins'] },
    '/wallet/help':                  { title: 'Help', parents: ['Coins'] },
  };
  const meta = titles[path] || { title: 'Coins', parents: [] };

  return (
    <div className={isDesktop ? undefined : 'vg-wallet-mobile'} style={{
      display: 'flex', minHeight: '100vh',
      background: WALLET_TOKENS.bg,
      color: WALLET_TOKENS.text,
      fontFamily: 'DM Sans, system-ui, sans-serif',
    }}>
      {/* Desktop sidebar — only mounted on true desktop width. Not rendered at
          all on mobile/tablet so it can never show or squash the content. */}
      {isDesktop && (
        <Sidebar collapsed={collapsed} setCollapsed={setCollapsed}
                 matches={matches} navigate={navigate} />
      )}

      <main style={{
        flex: 1, display: 'flex', flexDirection: 'column',
        minWidth: 0,                    // critical so children can shrink
        overflowX: 'hidden',            // decorative glows must not scroll the page
        // Mobile gets extra bottom padding to clear the fixed bottom-nav.
        paddingBottom: isDesktop ? 'env(safe-area-inset-bottom)' : 'calc(88px + env(safe-area-inset-bottom))',
      }}>
        <Topbar meta={meta} wallet={wallet} navigate={navigate} isDesktop={isDesktop}
                onMobileNav={() => setMobileNavOpen(v => !v)} />
        <div style={{ flex: 1, padding: '24px clamp(16px, 4vw, 40px) 96px' }}>
          <Outlet />
        </div>
      </main>

      {/* Mobile bottom-nav — only on mobile/tablet. */}
      {!isDesktop && (
        <MobileBottomNav matches={matches} navigate={navigate}
          moreOpen={mobileNavOpen} onOpenMore={() => setMobileNavOpen(true)} />
      )}

      {/* Mobile "more" drawer */}
      {mobileNavOpen && (
        <MobileMoreDrawer
          onClose={() => setMobileNavOpen(false)}
          navigate={(p) => { setMobileNavOpen(false); navigate(p); }}
          matches={matches}
        />
      )}

      {/* Mobile layout override. The wallet SCREENS each use multi-column grids
          that collapse via their own `@media (max-width: N)` queries — but the
          native Android WebView reports a desktop-class width, so those queries
          never fire and the columns overflow/clip on a phone. When the shell is
          in mobile mode (driven by isMobileApp(), NOT width, via the
          .vg-wallet-mobile class on the root), force every wallet layout grid to
          a single column so content stacks and fits. Scoped to .vg-wallet-mobile
          so a real desktop browser is unaffected. */}
      <style>{`
        .vg-wallet-mobile .vg-walletHome-grid,
        .vg-wallet-mobile .vg-walletHome-bals,
        .vg-wallet-mobile .vg-walletSettings-grid,
        .vg-wallet-mobile .vg-convert-grid,
        .vg-wallet-mobile .vg-walletKyc-row,
        .vg-wallet-mobile .vg-walletKyc-detail,
        .vg-wallet-mobile .vg-walletDeposit-grid,
        .vg-wallet-mobile .vg-walletDeposit-warns {
          grid-template-columns: 1fr !important;
        }
        .vg-wallet-mobile .vg-walletHome-quick,
        .vg-wallet-mobile .vg-walletBuy-grid {
          grid-template-columns: repeat(2, minmax(0, 1fr)) !important;
        }
      `}</style>
    </div>
  );
}

function Sidebar({ collapsed, setCollapsed, matches, navigate }) {
  return (
    <aside className="vg-wallet-sidebar" style={{
      width: collapsed ? 72 : 260, flexShrink: 0,
      background: 'rgba(10,9,18,0.55)',
      borderRight: `1px solid ${WALLET_TOKENS.hairline}`,
      display: 'flex', flexDirection: 'column',
      transition: 'width 0.25s cubic-bezier(0.2,0.8,0.2,1)',
      backdropFilter: 'blur(8px)',
      position: 'sticky', top: 0, height: '100vh',
    }}>
      {/* Exit Wallet */}
      <button onClick={() => navigate('/home')} style={{
        display: 'flex', alignItems: 'center', gap: 12,
        padding: collapsed ? '14px 0' : '14px 18px', height: 56,
        borderBottom: `1px solid ${WALLET_TOKENS.hairline}`,
        background: 'transparent', border: 'none',
        color: WALLET_TOKENS.textSecondary, fontSize: 13,
        justifyContent: collapsed ? 'center' : 'flex-start',
        cursor: 'pointer', borderBottomWidth: 1, borderBottomStyle: 'solid',
      }} title="Back to VERGR">
        <Icon name="arrow_back" size={18} />
        {!collapsed && <span>Exit wallet</span>}
      </button>

      {/* Brand block */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 12,
        padding: collapsed ? '16px 0' : '16px 18px',
        justifyContent: collapsed ? 'center' : 'flex-start',
      }}>
        <img src="/brand/logo.png" alt="VERGR" style={{
          width: 32, height: 32, borderRadius: 8, flexShrink: 0, objectFit: 'cover',
        }} />
        {!collapsed && (
          <div style={{ minWidth: 0 }}>
            <div style={{ fontFamily: 'Syne, sans-serif', fontWeight: 700, fontSize: 14 }}>VERGR</div>
            <div style={{ fontSize: 10, letterSpacing: '0.10em', textTransform: 'uppercase', color: WALLET_TOKENS.textMuted }}>Coins</div>
          </div>
        )}
      </div>

      <NavGroup title="Money" items={NAV_MONEY} matches={matches} navigate={navigate} collapsed={collapsed} />
      <NavGroup title="Account" items={NAV_ACCOUNT} matches={matches} navigate={navigate} collapsed={collapsed} />

      <div style={{ marginTop: 'auto', padding: collapsed ? '14px 8px' : '14px 12px' }}>
        <NavItem path="/wallet/help" label="Help & support" icon="help"
                 collapsed={collapsed} active={matches('/wallet/help')}
                 onClick={() => navigate('/wallet/help')} />
        <button onClick={() => setCollapsed(!collapsed)} style={{
          display: 'flex', alignItems: 'center', gap: 8,
          justifyContent: collapsed ? 'center' : 'flex-end',
          width: '100%', marginTop: 8, padding: '6px 12px',
          background: 'transparent', border: 'none', cursor: 'pointer',
          fontSize: 11, color: WALLET_TOKENS.textMuted,
        }}>
          <Icon name="menu" size={14} />
          {!collapsed && <span>Collapse</span>}
        </button>
      </div>
    </aside>
  );
}

function NavGroup({ title, items, matches, navigate, collapsed }) {
  return (
    <div style={{ padding: collapsed ? '6px 8px' : '6px 12px', marginTop: 8 }}>
      {!collapsed && (
        <div style={{
          fontSize: 10, letterSpacing: '0.10em', textTransform: 'uppercase',
          color: WALLET_TOKENS.textMuted, fontWeight: 600,
          padding: '8px 12px 6px',
        }}>{title}</div>
      )}
      {items.map(it => (
        <NavItem key={it.path} {...it} collapsed={collapsed}
                 active={matches(it.path)} onClick={() => navigate(it.path)} />
      ))}
    </div>
  );
}

function NavItem({ icon, label, active, onClick, collapsed }) {
  return (
    <button onClick={onClick} style={{
      display: 'flex', alignItems: 'center', gap: 12,
      width: '100%', height: 38,
      padding: collapsed ? '10px 0' : '9px 12px',
      borderRadius: 8, border: 'none',
      color: active ? WALLET_TOKENS.text : WALLET_TOKENS.textSecondary,
      background: active ? 'rgba(255,255,255,0.045)' : 'transparent',
      fontSize: 13, fontWeight: 500, cursor: 'pointer',
      justifyContent: collapsed ? 'center' : 'flex-start',
      position: 'relative', transition: 'all 0.12s',
    }}
    onMouseEnter={(e) => { if (!active) e.currentTarget.style.background = 'rgba(255,255,255,0.025)'; }}
    onMouseLeave={(e) => { if (!active) e.currentTarget.style.background = 'transparent'; }}>
      {active && !collapsed && (
        <div style={{
          position: 'absolute', left: -12, top: 10, bottom: 10, width: 2,
          background: WALLET_TOKENS.violetLight, borderRadius: 4,
        }} />
      )}
      <Icon name={icon} size={18} />
      {!collapsed && <span>{label}</span>}
    </button>
  );
}

function Topbar({ meta, wallet, navigate, onMobileNav, isDesktop }) {
  const [balOpen, setBalOpen] = useState(false);
  const coins = wallet?.balance || 0;
  const gems = wallet?.gems || 0;
  // Coins and gems are NOT the same value and must not be summed at one rate.
  // The accrual unit is worth $0.01 flat, because that is what it pays out at
  // (functions/withdrawals.js GEM_TO_MICRO_USDC). A coin is valued at what it
  // COSTS to buy, which is the number that makes sense when you are about to
  // spend some. A coin's redemption value is much lower, since converting runs
  // through the 15-30% rank commission, so this figure must never be presented
  // as what the wallet would pay out.
  const totalUSD = (coins * COIN_VALUE_USD) + (gems * GEM_VALUE_USD);
  return (
    <header style={{
      position: 'sticky', top: 0, zIndex: 50,
      display: 'flex', alignItems: 'center', gap: 16,
      // The wallet renders OUTSIDE MainLayout/ResponsiveLayout, so it never gets
      // the app shell's `.safe-top`. Without this the sticky bar sits UNDER the
      // native Android status bar (same bug class as the home-feed/chat top bar).
      // env(safe-area-inset-top) is 0 on desktop/web, so this is mobile-only.
      // Bar height sits BELOW the status bar inset, plus a little breathing room
      // so the title never hugs the status bar on the native app.
      minHeight: 'calc(60px + env(safe-area-inset-top))',
      paddingTop: 'calc(env(safe-area-inset-top) + 8px)',
      paddingBottom: 8,
      paddingLeft: 'clamp(16px, 3vw, 32px)',
      paddingRight: 'clamp(16px, 3vw, 32px)',
      background: 'rgba(7,7,16,0.78)',
      borderBottom: `1px solid ${WALLET_TOKENS.hairline}`,
      backdropFilter: 'blur(12px)',
    }}>
      {/* Mobile: back arrow replaces the sidebar's Exit button. Only rendered
          on mobile/tablet (no sidebar there). */}
      {!isDesktop && (
        <button onClick={() => navigate('/home')} style={{
          display: 'flex', alignItems: 'center', gap: 6,
          background: 'transparent', border: 'none', color: WALLET_TOKENS.textSecondary,
          cursor: 'pointer', fontSize: 13, padding: 0,
        }}>
          <Icon name="arrow_back" size={20} />
        </button>
      )}

      {/* Breadcrumb + title. Breadcrumbs are a desktop pattern; on mobile the
          back arrow already conveys hierarchy, so we show ONLY the (concise)
          screen title on a single line — no parent chain, no ellipsis. */}
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, flexWrap: 'nowrap', overflow: 'hidden' }}>
        {isDesktop && meta.parents.map((p, i) => (
          <span key={i} style={{
            display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0,
            color: WALLET_TOKENS.textMuted, fontSize: 13,
          }}>
            <span>{p}</span>
            <Icon name="chevron_right" size={12} />
          </span>
        ))}
        <div style={{
          fontFamily: 'Syne, sans-serif', fontWeight: 700,
          fontSize: isDesktop ? 18 : 17, color: WALLET_TOKENS.text,
          whiteSpace: 'nowrap',
        }}>
          {(!isDesktop && meta.m) ? meta.m : meta.title}
        </div>
      </div>

      {/* Balance chip (coin + gem only — VP is a rank-progress number, not a wallet balance) */}
      <div style={{ position: 'relative' }}>
        <button onClick={() => setBalOpen(v => !v)} style={{
          display: 'flex', alignItems: 'center', gap: 10,
          padding: '6px 14px', height: 36,
          background: WALLET_TOKENS.surface2,
          border: `1px solid ${WALLET_TOKENS.hairlineStrong}`,
          borderRadius: 999, color: WALLET_TOKENS.text,
          cursor: 'pointer',
        }}>
          <CoinGlyph size={18} />
          <span className="font-dmmono tabular-nums" style={{ fontSize: 13, fontWeight: 600 }}>{fmtNum(coins)}</span>
          <GemGlyph size={16} />
          <span className="font-dmmono tabular-nums" style={{ fontSize: 13, fontWeight: 600 }}>{fmtNum(gems)}</span>
          <Icon name="expand_more" size={14} />
        </button>
        {balOpen && (
          <div onMouseLeave={() => setBalOpen(false)} style={{
            position: 'absolute', top: 'calc(100% + 8px)', right: 0,
            width: 260, padding: 14, zIndex: 100,
            background: WALLET_TOKENS.surface1,
            border: `1px solid ${WALLET_TOKENS.hairlineStrong}`,
            borderRadius: 12,
            boxShadow: '0 24px 64px rgba(0,0,0,0.6)',
          }}>
            <BalRow icon={<CoinGlyph size={20} />} label="Coins" value={coins} />
            <BalRow icon={<GemGlyph size={20} />} label="Gems"  value={gems} />
            <BalRow icon={<VPGlyph size={20} />} label="VP"    value={wallet?.vp || 0} muted />
            <div style={{ height: 1, background: WALLET_TOKENS.hairline, margin: '10px 0' }} />
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ fontSize: 12, color: WALLET_TOKENS.textSecondary }}>Estimated total</span>
              <span className="font-dmmono tabular-nums" style={{ fontWeight: 600 }}>{fmtUsd(totalUSD)}</span>
            </div>
          </div>
        )}
      </div>
    </header>
  );
}

function BalRow({ icon, label, value, muted }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '4px 0' }}>
      <span style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13, color: muted ? WALLET_TOKENS.textMuted : WALLET_TOKENS.text }}>
        {icon}{label}
      </span>
      <span className="font-dmmono tabular-nums" style={{ fontSize: 13, fontWeight: 600 }}>{fmtNum(value)}</span>
    </div>
  );
}

function MobileBottomNav({ matches, navigate, moreOpen, onOpenMore }) {
  // The "More" tab is active when its sheet is open OR the current route is one
  // of the sheet's destinations (referral / settings / security / kyc / help).
  const onMoreRoute = MORE_MENU.some(m => matches(m.path));
  return (
    <nav style={{
      display: 'flex',
      position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 60,
      height: 'calc(64px + env(safe-area-inset-bottom))',
      paddingBottom: 'env(safe-area-inset-bottom)',
      background: 'rgba(7,7,16,0.92)',
      borderTop: `1px solid ${WALLET_TOKENS.hairlineStrong}`,
      backdropFilter: 'blur(12px)',
      justifyContent: 'space-around', alignItems: 'center',
    }}>
      {MOBILE_NAV.map(it => {
        const active = it.more ? (moreOpen || onMoreRoute) : matches(it.path);
        return (
          <button key={it.label} onClick={() => (it.more ? onOpenMore() : navigate(it.path))} style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2,
            background: 'transparent', border: 'none', cursor: 'pointer',
            color: active ? WALLET_TOKENS.violetLight : WALLET_TOKENS.textMuted,
            fontSize: 10, fontWeight: 600, padding: '4px 8px',
          }}>
            <Icon name={it.icon} size={22} filled={active} />
            <span>{it.label}</span>
          </button>
        );
      })}
    </nav>
  );
}

// Bottom sheet for the mobile "More" tab — referral + account items that don't
// fit the 5 primary bottom-nav slots.
function MobileMoreDrawer({ onClose, navigate, matches }) {
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 70 }} role="dialog" aria-modal="true">
      <div onClick={onClose} style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(2px)' }} />
      <div style={{
        position: 'absolute', left: 0, right: 0, bottom: 0,
        background: WALLET_TOKENS.surface1,
        borderTop: `1px solid ${WALLET_TOKENS.hairlineStrong}`,
        borderTopLeftRadius: 20, borderTopRightRadius: 20,
        padding: '8px 12px calc(16px + env(safe-area-inset-bottom))',
      }}>
        <div style={{ width: 40, height: 4, borderRadius: 4, background: WALLET_TOKENS.hairlineStrong, margin: '8px auto 12px' }} />
        {MORE_MENU.map(it => {
          const active = matches(it.path);
          return (
            <button key={it.path} onClick={() => navigate(it.path)} style={{
              display: 'flex', alignItems: 'center', gap: 14, width: '100%',
              padding: '14px 12px', borderRadius: 12, border: 'none', cursor: 'pointer',
              background: active ? 'rgba(180,79,255,0.10)' : 'transparent',
              color: active ? WALLET_TOKENS.text : WALLET_TOKENS.textSecondary,
              fontSize: 15, fontWeight: 600,
            }}>
              <Icon name={it.icon} size={22} />
              <span style={{ flex: 1, textAlign: 'left' }}>{it.label}</span>
              <Icon name="chevron_right" size={18} />
            </button>
          );
        })}
      </div>
    </div>
  );
}
