// AdminShell — sidebar + topbar wrapper for every screen at /admin/*.
//
// Filters the sidebar nav by the current user's allowedScreens. If the user
// isn't an admin at all (founder OR active sub-admin), shows a locked
// fallback. If they're an admin but don't have access to the screen they
// landed on, shows a "no access" panel without breaking navigation.
//
// Palette + structure mirror the existing admin screens (#09090f bg,
// #12121e cards, #7c3aed accent — same as SuperAdminDashboardScreen).

import { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useUser } from '../../context/UserContext';
import { useLayout } from '../../context/LayoutContext';
import useResponsive from '../../hooks/useResponsive';
import useAdminAccess from '../../hooks/useAdminAccess';
import Icon from '../../components/Icon';
import UserAvatar from '../../components/UserAvatar';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../../firebase/config';

const C = {
  bg: '#09090f',
  card: '#12121e',
  card2: '#171727',
  border: '#1e1e30',
  text: '#e0e0f0',
  textDim: '#7070a0',
  textMuted: '#5a5a85',
  accent: '#7c3aed',
  accent2: '#b44fff',
};

// One entry per screen ID. screen IDs match ADMIN_SCREENS in functions/adminAccess.js.
export const ADMIN_NAV = [
  { id: 'dashboard',     label: 'Dashboard',         path: '/admin',              icon: 'grid_view' },
  { id: 'announcements', label: 'Announcements',     path: '/admin/announce',     icon: 'campaign' },
  { id: 'users',         label: 'Users',             path: '/admin/users',        icon: 'group' },
  { id: 'creators',      label: 'Creators',          path: '/admin/creators',     icon: 'workspace_premium' },
  { id: 'moderation',    label: 'Moderation Queue',  path: '/admin/reports',      icon: 'flag' },
  { id: 'economy',       label: 'Economy',           path: '/admin/economy',      icon: 'paid' },
  { id: 'subscriptions', label: 'Subscriptions',     path: '/admin/subscriptions',icon: 'workspace_premium' },
  // Tournaments removed 2026-08-17 (founder). The product retired tournaments in
  // 2026-08; the admin screen was the last surface still asserting they exist.
  { id: 'config',        label: 'App Config',        path: '/admin/config',       icon: 'tune' },
  { id: 'stream-preview',label: 'Stream Preview',    path: '/admin/stream-preview', icon: 'cast' },
  { id: 'stats',         label: 'Live Stats',        path: '/admin/stats',        icon: 'monitoring' },
  { id: 'audit',         label: 'Audit Log',         path: '/admin/audit',        icon: 'history' },
];

// Secondary nav — admin-tools that aren't on the main mockup sidebar.
export const ADMIN_NAV_SECONDARY = [
  { id: 'security',      label: 'Admin Security',    path: '/admin/security',     icon: 'shield_person' },
  { id: 'access',        label: 'Admin Access',      path: '/admin/access',       icon: 'admin_panel_settings' },
  { id: 'bots',          label: 'News Bots',         path: '/admin/bots',         icon: 'smart_toy' },
  { id: 'vanguard',      label: 'Vanguard',          path: '/admin/vanguard',     icon: 'shield' },
  // Cheat Signatures removed 2026-08-17 (founder), it only ever fed tournament
  // anti-cheat, and there are no tournaments.
];

function Logo() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '4px 8px' }}>
      <div style={{
        width: 34, height: 34, borderRadius: 8,
        background: `linear-gradient(135deg, ${C.accent2}, ${C.accent})`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: '#fff', fontWeight: 800, fontSize: 16,
      }}>V</div>
      <div style={{ fontWeight: 800, letterSpacing: '0.04em', fontSize: 14, color: C.text }}>
        VERGR <span style={{ color: C.accent2 }}>ADMIN</span>
      </div>
    </div>
  );
}

function NavItem({ item, active, allowed, onClick }) {
  return (
    <button
      onClick={() => allowed && onClick(item.path)}
      disabled={!allowed}
      title={allowed ? '' : 'You don\'t have access to this screen'}
      style={{
        display: 'flex', alignItems: 'center', gap: 12,
        width: '100%', padding: '10px 12px',
        background: active ? `linear-gradient(90deg, ${C.accent}40, ${C.accent}15)` : 'transparent',
        border: `1px solid ${active ? `${C.accent}80` : 'transparent'}`,
        borderRadius: 8,
        color: !allowed ? C.textMuted : (active ? '#fff' : C.textDim),
        fontSize: 13, fontWeight: active ? 600 : 400,
        textAlign: 'left', cursor: allowed ? 'pointer' : 'not-allowed',
        opacity: allowed ? 1 : 0.45,
        transition: 'background .15s, color .15s',
      }}
      onMouseEnter={e => { if (allowed && !active) { e.currentTarget.style.background = C.card2; e.currentTarget.style.color = C.text; } }}
      onMouseLeave={e => { if (allowed && !active) { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = C.textDim; } }}
    >
      <Icon name={item.icon} size={17} />
      <span style={{ flex: 1 }}>{item.label}</span>
      {item.badge != null && (
        <span style={{
          fontSize: 10, fontWeight: 700,
          padding: '2px 6px', borderRadius: 999,
          background: active ? 'rgba(255,255,255,0.2)' : 'rgba(240,64,96,0.25)',
          color: active ? '#fff' : '#f04060',
        }}>{item.badge}</span>
      )}
    </button>
  );
}

// Format a badge number: 1–99 as-is, 100+ as "99+".
function fmtBadge(n) {
  if (!n || n <= 0) return null;
  return n > 99 ? '99+' : String(n);
}

function Sidebar({ can, isFounder, activePath, navigate, onBackToApp, badges }) {
  return (
    <aside style={{
      width: 240, flexShrink: 0,
      background: C.card, borderRight: `1px solid ${C.border}`,
      display: 'flex', flexDirection: 'column',
      padding: '20px 14px',
      position: 'sticky', top: 0, height: '100vh',
      overflowY: 'auto',
    }}>
      <div style={{ paddingBottom: 20 }}>
        <Logo />
      </div>

      <nav style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: 1 }}>
        {ADMIN_NAV.map(item => (
          <NavItem
            key={item.id}
            item={{ ...item, badge: fmtBadge(badges?.[item.id]) }}
            active={activePath === item.path}
            allowed={can(item.id)}
            onClick={navigate}
          />
        ))}

        <div style={{ marginTop: 14, marginBottom: 6, padding: '0 12px',
          fontSize: 10, fontWeight: 700, letterSpacing: '0.1em',
          color: C.textMuted, textTransform: 'uppercase' }}>
          Tools
        </div>
        {ADMIN_NAV_SECONDARY.map(item => {
          // 'access' visible only to founders; everyone else hidden.
          if (item.id === 'access' && !isFounder) return null;
          // 'security' visible to anyone with admin access.
          // 'bots' + 'vanguard' visible to founders (existing screens are founder-gated).
          if ((item.id === 'bots' || item.id === 'vanguard') && !isFounder) return null;
          return (
            <NavItem
              key={item.id}
              item={item}
              active={activePath === item.path}
              allowed
              onClick={navigate}
            />
          );
        })}
      </nav>

      <div style={{ marginTop: 16, paddingTop: 16, borderTop: `1px solid ${C.border}` }}>
        <button
          onClick={onBackToApp}
          style={{
            width: '100%', padding: '10px 12px',
            background: 'transparent', border: `1px solid ${C.border}`,
            borderRadius: 8, color: C.textDim,
            fontSize: 12, fontWeight: 500, cursor: 'pointer',
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8,
          }}
        >
          <Icon name="arrow_back" size={14} /> Back to App
        </button>
      </div>
    </aside>
  );
}

function TopBar({ title, subtitle, right }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
      gap: 16, marginBottom: 22, flexWrap: 'wrap',
    }}>
      <div>
        <h1 style={{ fontSize: 26, fontWeight: 700, margin: 0, letterSpacing: '-0.02em', color: C.text }}>
          {title}
        </h1>
        {subtitle && (
          <div style={{ color: C.textDim, fontSize: 13, marginTop: 4 }}>{subtitle}</div>
        )}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        {right}
      </div>
    </div>
  );
}

function LockedPanel({ title, message }) {
  return (
    <div style={{
      background: C.card, border: `1px solid ${C.border}`, borderRadius: 12,
      padding: 60, textAlign: 'center', color: C.textDim,
    }}>
      <Icon name="lock" size={48} className="opacity-40 mx-auto" />
      <h2 style={{ marginTop: 12, fontSize: 18, color: C.text, fontWeight: 700 }}>{title}</h2>
      <p style={{ marginTop: 6, fontSize: 13 }}>{message}</p>
    </div>
  );
}

/**
 * Props:
 *   screen      — screen ID (must match ADMIN_SCREENS / NAV item ids)
 *   title       — page heading
 *   subtitle    — page subheading
 *   topBarRight — optional right-side topbar slot (export buttons, date picker, etc.)
 *   children    — page content
 */
export default function AdminShell({ screen, title, subtitle, topBarRight, children }) {
  const navigate = useNavigate();
  const location = useLocation();
  const { isMobile } = useResponsive();
  const { profile } = useUser();
  const { setRightPanel, setContentAlign } = useLayout();
  const { loading, isAdmin, isFounder, can } = useAdminAccess();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [badges, setBadges] = useState({});

  // Poll nav badge counts every 60s. Cheap aggregation queries server-side.
  useEffect(() => {
    if (!isAdmin) return;
    let cancelled = false;
    const refresh = async () => {
      try {
        const fn = httpsCallable(functions, 'adminGetNavBadges');
        const res = await fn({});
        if (!cancelled && res?.data?.ok) setBadges(res.data.badges || {});
      } catch { /* badge fetch is best-effort */ }
    };
    refresh();
    const t = setInterval(refresh, 60_000);
    return () => { cancelled = true; clearInterval(t); };
  }, [isAdmin]);

  // The shell takes over the whole content area — no right rail, full bleed.
  useEffect(() => {
    setRightPanel(null);
    setContentAlign('left');
    return () => { setRightPanel(null); setContentAlign('center'); };
  }, [setRightPanel, setContentAlign]);

  if (loading) {
    return (
      <div style={{ background: C.bg, minHeight: '100%', padding: 60, color: C.textDim, textAlign: 'center' }}>
        Loading…
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div style={{ background: C.bg, minHeight: '100%', padding: 40 }}>
        <LockedPanel
          title="Admin only"
          message="You don't have access to the VERGR admin dashboard."
        />
      </div>
    );
  }

  const screenAllowed = screen ? can(screen) : true;

  const handleNavigate = (path) => {
    setMobileNavOpen(false);
    navigate(path);
  };

  const sidebar = (
    <Sidebar
      can={can}
      isFounder={isFounder}
      activePath={location.pathname}
      navigate={handleNavigate}
      onBackToApp={() => navigate('/')}
      badges={badges}
    />
  );

  return (
    <div style={{ background: C.bg, minHeight: '100vh', color: C.text, display: 'flex' }}>
      {!isMobile && sidebar}

      {/* Mobile drawer */}
      {isMobile && mobileNavOpen && (
        <>
          <div
            onClick={() => setMobileNavOpen(false)}
            style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)', zIndex: 99 }}
          />
          <div style={{ position: 'fixed', top: 0, left: 0, height: '100vh', zIndex: 100 }}>
            {sidebar}
          </div>
        </>
      )}

      <main style={{ flex: 1, minWidth: 0, padding: isMobile ? '16px 16px 80px' : '24px 28px' }}>
        {isMobile && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
            <button
              onClick={() => setMobileNavOpen(true)}
              style={{
                width: 38, height: 38, borderRadius: 8,
                background: C.card, border: `1px solid ${C.border}`,
                color: C.text, cursor: 'pointer',
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              }}
            >
              <Icon name="menu" size={20} />
            </button>
            <Logo />
          </div>
        )}

        <TopBar
          title={title}
          subtitle={subtitle}
          right={
            <>
              {topBarRight}
              {!isMobile && profile && (
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: '6px 10px 6px 6px',
                  background: C.card, border: `1px solid ${C.border}`,
                  borderRadius: 999,
                }}>
                  <UserAvatar src={profile.avatar} size={28} />
                  <div style={{ fontSize: 12 }}>
                    <div style={{ fontWeight: 600, color: C.text, lineHeight: 1.1 }}>
                      {profile.displayName || 'Admin'}
                    </div>
                    <div style={{ fontSize: 10, color: C.textDim, marginTop: 2 }}>
                      {isFounder ? 'Owner' : 'Sub-admin'}
                    </div>
                  </div>
                </div>
              )}
            </>
          }
        />

        {screenAllowed ? children : (
          <LockedPanel
            title="No access to this screen"
            message="Ask the platform owner to grant you access in Admin → Admin Access."
          />
        )}
      </main>
    </div>
  );
}

export { C as ADMIN_COLORS };
