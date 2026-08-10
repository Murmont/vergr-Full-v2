// src/components/vanguard/VanguardLayout.jsx
//
// The chrome for the Vanguard moderator dashboard. Owns:
//   - 240px collapsible side nav (Back to App + 5 grouped sections + footer)
//   - 64px sticky top bar (rank pill + name + level + On/Off Duty toggle + search + avatar)
//   - Mobile drawer + bottom nav
//
// Each Vanguard page slots into `children`. Pages should set their own
// `<VanguardPageHeader>` content if they want a title row under the top bar.
//
// Auth model:
//   - If user is not Vanguard AND not founder → bounce to /home
//   - Founder (role==='admin') gets read-only oversight (PageHeader shows
//     a yellow "Founder oversight view" strip; pages handle action-disable
//     themselves).

import { useState, useEffect, useMemo } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useUser } from '../../context/UserContext';
import useResponsive from '../../hooks/useResponsive';
import Icon from '../Icon';
import UserAvatar from '../UserAvatar';
import { isVanguard } from '../../utils/vanguard';
import { rankMeta } from '../../utils/vanguardRanks';
import { doc, updateDoc } from 'firebase/firestore';
import { db } from '../../firebase/config';

const C = {
  bg:        '#0B0B14',
  card:      '#12121e',
  card2:     '#1A1A2A',
  border:    '#1e1e30',
  borderH:   '#2a2a40',
  text:      '#FFFFFF',
  textDim:   '#9CA3AF',
  textMuted: '#6B7280',
  violet:    '#7B1FFF',
  violetLt:  '#B44FFF',
  gold:      '#F5C842',
  ember:     '#F04060',
  success:   '#22D17E',
};

// 5 grouped sections. Each entry: { key, label, icon, path, minRank?, badge? }
// minRank — if set, only mods at or above that rank see it.
const NAV_SECTIONS = [
  {
    title: null, // first group, no header
    items: [
      { key: 'today',         label: 'Today',         icon: 'home',          path: '/vanguard/today' },
      { key: 'schedule',      label: 'Schedule',      icon: 'event',         path: '/vanguard/schedule' },
      { key: 'queue',         label: 'Queue',         icon: 'inbox',         path: '/vanguard/queue' },
      { key: 'live',          label: 'Live Now',      icon: 'live_tv',       path: '/vanguard/live' },
      { key: 'my-cases',      label: 'My Cases',      icon: 'folder_managed', path: '/vanguard/my-cases' },
      { key: 'notes',         label: 'Notes',         icon: 'sticky_note_2', path: '/vanguard/notes' },
    ],
  },
  {
    title: 'Finance',
    items: [
      { key: 'treasury',      label: 'Treasury',      icon: 'account_balance', path: '/vanguard/treasury' },
      { key: 'payouts',       label: 'Payout History', icon: 'receipt_long',  path: '/vanguard/payouts' },
      { key: 'wallet',        label: 'VP & Wallet',   icon: 'wallet',        path: '/vanguard/wallet' },
    ],
  },
  {
    title: 'Progress',
    items: [
      { key: 'stats',         label: 'My Stats',      icon: 'bar_chart',     path: '/vanguard/stats' },
      { key: 'rank',          label: 'Rank Progress', icon: 'military_tech', path: '/vanguard/rank' },
      { key: 'peer',          label: 'Peer Activity', icon: 'visibility',    path: '/vanguard/peer' },
    ],
  },
  {
    title: 'Team',
    items: [
      { key: 'roster',        label: 'Roster',        icon: 'groups',        path: '/vanguard/roster' },
      { key: 'chat',          label: 'Vanguard Chat', icon: 'chat',          path: '/vanguard/chat' },
      { key: 'escalations',   label: 'Escalations',   icon: 'priority_high', path: '/vanguard/escalations', minRank: 'senior' },
    ],
  },
  {
    title: 'Resources',
    items: [
      { key: 'handbook',      label: 'Handbook',      icon: 'menu_book',     path: '/vanguard/handbook' },
      { key: 'library',       label: 'Decision Library', icon: 'gavel',     path: '/vanguard/library' },
      { key: 'announcements', label: 'Announcements', icon: 'campaign',      path: '/vanguard/announcements' },
    ],
  },
  {
    title: 'Lookups',
    items: [
      { key: 'lookup-user',   label: 'User Lookup',       icon: 'person_search', path: '/vanguard/lookup/user' },
      { key: 'lookup-tour',   label: 'Tournament Lookup', icon: 'emoji_events',  path: '/vanguard/lookup/tournament' },
      { key: 'lookup-action', label: 'Action Lookup',     icon: 'search',        path: '/vanguard/lookup/action' },
    ],
  },
];

const RANK_ORDER = { recruit: 1, vanguard: 2, senior: 3, commander: 4, overseer: 5 };
const visibleForRank = (item, rank) => !item.minRank || (RANK_ORDER[rank] || 0) >= (RANK_ORDER[item.minRank] || 0);

export default function VanguardLayout({ children, page = 'today' }) {
  const navigate = useNavigate();
  const location = useLocation();
  const { currentUser } = useAuth();
  const { profile } = useUser();
  const { isDesktop } = useResponsive();

  const myRank = profile?.vanguard?.rank;
  const meIsVanguard = isVanguard(profile);
  // Admin = role==='admin' OR the founder email — matches useTier/vanguard.js
  // so the founder is never bounced even if the role field is ever missing.
  const isFounder = profile?.role === 'admin'
    || (profile?.email || '').toLowerCase() === 'vergenerd@gmail.com';
  // Founder has FULL moderator authority on this dashboard — no read-only
  // restrictions, every action callable accepts role==='admin' as equivalent
  // to Overseer. The pill on the top bar is informational only.
  const meta = isFounder && !meIsVanguard ? rankMeta('overseer') : rankMeta(myRank);
  const showFounderPill = isFounder && !meIsVanguard;

  const [collapsed, setCollapsed] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [onDuty, setOnDuty] = useState(profile?.vanguard?.onDuty !== false);

  useEffect(() => { setDrawerOpen(false); }, [location.pathname]);

  // Bounce non-Vanguard non-founder. Wait for the profile (Firestore user doc)
  // to load first — currentUser (Auth) resolves before profile, so judging on a
  // null profile would bounce the founder before role==='admin' even arrives.
  useEffect(() => {
    if (!currentUser) return;
    if (!profile) return;
    if (!meIsVanguard && !isFounder) {
      navigate('/home', { replace: true });
    }
  }, [currentUser, profile, meIsVanguard, isFounder, navigate]);

  // Persist on-duty toggle (mod is offline-ish when off duty — banner doesn't fire on stream/tournament joins).
  const toggleDuty = async () => {
    const next = !onDuty;
    setOnDuty(next);
    if (currentUser?.uid && meIsVanguard) {
      try { await updateDoc(doc(db, 'users', currentUser.uid), { 'vanguard.onDuty': next }); } catch {}
    }
  };

  const navWidth = collapsed ? 72 : 240;

  // Founder sees every nav item (effective Overseer rank for visibility gating).
  const navRank = isFounder ? 'overseer' : myRank;

  // Collapsible titled groups. Persist open/closed per group title.
  const [openGroups, setOpenGroups] = useState(() => {
    try { return JSON.parse(localStorage.getItem('vgNavGroups') || '{}'); } catch { return {}; }
  });
  const isGroupOpen = (title) => openGroups[title] !== false; // default open
  const toggleGroup = (title) => {
    setOpenGroups((prev) => {
      const next = { ...prev, [title]: prev[title] === false ? true : false };
      try { localStorage.setItem('vgNavGroups', JSON.stringify(next)); } catch {}
      return next;
    });
  };

  // Render the side nav (shared between desktop fixed + mobile drawer).
  const SideNav = (
    <aside
      style={{
        width: navWidth,
        background: C.card,
        borderRight: `1px solid ${C.border}`,
        height: '100vh',
        position: 'sticky',
        top: 0,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        transition: 'width .2s ease',
      }}
    >
      {/* Brand + Back to App */}
      <div style={{ padding: '14px 12px', borderBottom: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', gap: 10 }}>
        <img src="/brand/logo.png" alt="VERGR" style={{ height: 28, width: 28, flexShrink: 0 }} draggable={false} />
        {!collapsed && (
          <div style={{ fontFamily: 'Syne', fontWeight: 800, fontSize: 18, letterSpacing: '.05em', color: C.text }}>VERGR</div>
        )}
      </div>

      <button
        onClick={() => navigate('/home')}
        style={{
          margin: '10px 10px 4px',
          padding: '8px 10px',
          background: 'transparent',
          border: `1px solid ${C.border}`,
          borderRadius: 8,
          color: C.textDim,
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          fontFamily: 'DM Sans',
          fontSize: 12,
          fontWeight: 600,
        }}
        title="Back to main app"
      >
        <Icon name="arrow_back" size={16} />
        {!collapsed && <span>Back to App</span>}
      </button>

      {/* Nav scroll area */}
      <nav style={{ flex: 1, overflowY: 'auto', padding: '8px 10px 16px' }}>
        {NAV_SECTIONS.map((group, gi) => {
          const items = group.items.filter((it) => visibleForRank(it, navRank));
          if (items.length === 0) return null;
          // A titled group can be collapsed (the first, untitled group never is).
          // Force-open the group containing the active page so it can't hide it.
          const hasActive = items.some((it) => it.key === page);
          const collapsible = !collapsed && !!group.title;
          const open = !collapsible || isGroupOpen(group.title) || hasActive;
          return (
            <div key={gi} style={{ marginTop: gi === 0 ? 4 : 14 }}>
              {!collapsed && group.title && (
                <button
                  onClick={() => toggleGroup(group.title)}
                  style={{
                    width: '100%',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 4,
                    background: 'transparent',
                    border: 0,
                    cursor: 'pointer',
                    fontFamily: 'DM Mono',
                    fontSize: 9.5,
                    color: C.textMuted,
                    textTransform: 'uppercase',
                    letterSpacing: '.16em',
                    padding: '6px 8px 4px',
                  }}
                  title={open ? 'Collapse section' : 'Expand section'}
                >
                  <Icon name={open ? 'expand_more' : 'chevron_right'} size={15} style={{ marginLeft: -3 }} />
                  <span style={{ flex: 1, textAlign: 'left' }}>{group.title}</span>
                </button>
              )}
              {open && items.map((item) => {
                const isActive = page === item.key;
                return (
                  <button
                    key={item.key}
                    onClick={() => navigate(item.path)}
                    title={collapsed ? item.label : undefined}
                    style={{
                      width: '100%',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
                      padding: collapsed ? '10px 0' : '9px 10px',
                      justifyContent: collapsed ? 'center' : 'flex-start',
                      background: isActive ? 'rgba(180,79,255,.12)' : 'transparent',
                      border: 0,
                      borderLeft: isActive ? `2px solid ${C.violetLt}` : '2px solid transparent',
                      borderRadius: collapsed ? 8 : 6,
                      color: isActive ? C.text : C.textDim,
                      fontFamily: 'DM Sans',
                      fontSize: 13,
                      fontWeight: isActive ? 700 : 500,
                      cursor: 'pointer',
                      transition: 'background .12s',
                      marginBottom: 1,
                    }}
                    onMouseEnter={(e) => { if (!isActive) e.currentTarget.style.background = 'rgba(255,255,255,.03)'; }}
                    onMouseLeave={(e) => { if (!isActive) e.currentTarget.style.background = 'transparent'; }}
                  >
                    <Icon name={item.icon} size={18} />
                    {!collapsed && <span style={{ flex: 1, textAlign: 'left' }}>{item.label}</span>}
                  </button>
                );
              })}
            </div>
          );
        })}
      </nav>

      {/* Collapse toggle */}
      <button
        onClick={() => setCollapsed((v) => !v)}
        style={{
          margin: 10,
          padding: '8px 10px',
          background: 'transparent',
          border: `1px solid ${C.border}`,
          borderRadius: 8,
          color: C.textMuted,
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          fontFamily: 'DM Sans',
          fontSize: 11,
          justifyContent: collapsed ? 'center' : 'flex-start',
        }}
      >
        <Icon name={collapsed ? 'chevron_right' : 'chevron_left'} size={16} />
        {!collapsed && <span>Collapse</span>}
      </button>
    </aside>
  );

  // Top bar — rank pill on left, on-duty + search + avatar on right.
  const TopBar = (
    <div
      style={{
        height: 64,
        background: C.card,
        borderBottom: `1px solid ${C.border}`,
        display: 'flex',
        alignItems: 'center',
        padding: '0 18px',
        position: 'sticky',
        top: 0,
        zIndex: 50,
        gap: 16,
      }}
    >
      {/* Mobile drawer trigger */}
      {!isDesktop && (
        <button
          onClick={() => setDrawerOpen(true)}
          style={{ background: 'transparent', border: 0, color: C.text, cursor: 'pointer', padding: 6 }}
          aria-label="Open menu"
        >
          <Icon name="menu" size={22} />
        </button>
      )}

      {/* Rank chip — real identity for mods, or "Founder" pill for founder */}
      {(meIsVanguard || showFounderPill) && (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '6px 12px 6px 6px',
          background: showFounderPill ? 'rgba(245,200,66,.08)' : 'rgba(180,79,255,.08)',
          border: `1px solid ${showFounderPill ? 'rgba(245,200,66,.4)' : 'rgba(180,79,255,.3)'}`,
          borderRadius: 999,
          minHeight: 40,
        }}>
          <img src={meta.avatar} alt={meta.label} style={{ height: 28, width: 28, borderRadius: '50%', flexShrink: 0 }} draggable={false} />
          <div style={{ lineHeight: 1.1 }}>
            <div style={{ fontFamily: 'Syne', fontWeight: 800, fontSize: 12.5, color: showFounderPill ? C.gold : C.text, letterSpacing: '.04em', textTransform: 'uppercase' }}>
              {showFounderPill ? 'Founder' : meta.label}
            </div>
            <div style={{ fontFamily: 'DM Mono', fontSize: 10, color: C.textDim }}>
              {showFounderPill ? 'Full authority' : `Rank ${meta.order}`}
            </div>
          </div>
        </div>
      )}

      {/* On Duty / Off Duty toggle */}
      {meIsVanguard && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button
            onClick={toggleDuty}
            title={onDuty ? 'You are visible to other Vanguard + announce on stream joins' : 'You are off duty — silent joins, no audit credit until back on'}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '6px 12px',
              background: onDuty ? 'rgba(34,209,126,.12)' : 'rgba(107,114,128,.12)',
              border: `1px solid ${onDuty ? 'rgba(34,209,126,.4)' : 'rgba(107,114,128,.4)'}`,
              borderRadius: 999,
              color: onDuty ? C.success : C.textMuted,
              cursor: 'pointer',
              fontFamily: 'DM Sans',
              fontSize: 12,
              fontWeight: 700,
            }}
          >
            <span style={{
              width: 8, height: 8, borderRadius: '50%',
              background: onDuty ? C.success : C.textMuted,
              boxShadow: onDuty ? `0 0 6px ${C.success}` : 'none',
            }} />
            {onDuty ? 'On Duty' : 'Off Duty'}
          </button>
        </div>
      )}

      <div style={{ flex: 1 }} />

      {/* Search — placeholder, wires to lookups */}
      <div style={{
        display: isDesktop ? 'flex' : 'none',
        alignItems: 'center',
        gap: 8,
        padding: '7px 12px',
        background: C.card2,
        border: `1px solid ${C.border}`,
        borderRadius: 8,
        width: 320,
      }}>
        <Icon name="search" size={16} style={{ color: C.textMuted }} />
        <input
          placeholder="Search users, cases, tournaments…"
          onKeyDown={(e) => {
            if (e.key === 'Enter' && e.currentTarget.value.trim()) {
              navigate(`/vanguard/lookup/user?q=${encodeURIComponent(e.currentTarget.value.trim())}`);
            }
          }}
          style={{
            background: 'transparent',
            border: 0,
            color: C.text,
            fontFamily: 'DM Sans',
            fontSize: 13,
            outline: 'none',
            width: '100%',
          }}
        />
      </div>

      {/* Avatar */}
      <button
        onClick={() => navigate('/vanguard/wallet')}
        style={{ background: 'transparent', border: 0, padding: 0, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8 }}
        title="Wallet & VP"
      >
        <UserAvatar src={profile?.avatar} size={36} />
      </button>
    </div>
  );

  return (
    <div style={{ background: C.bg, color: C.text, minHeight: '100vh', display: 'flex', fontFamily: 'DM Sans' }}>
      {/* Desktop side nav */}
      {isDesktop && SideNav}

      {/* Mobile drawer */}
      {!isDesktop && drawerOpen && (
        <>
          <div
            onClick={() => setDrawerOpen(false)}
            style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)', zIndex: 99 }}
          />
          <div style={{ position: 'fixed', left: 0, top: 0, bottom: 0, zIndex: 100 }}>
            {SideNav}
          </div>
        </>
      )}

      {/* Main column */}
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        {TopBar}
        <main style={{ flex: 1, padding: isDesktop ? '24px 28px 80px' : '16px 14px 80px', maxWidth: 1600, width: '100%', margin: '0 auto' }}>
          {children}
        </main>
      </div>
    </div>
  );
}

// Re-export tokens + page title primitive so screens stay visually consistent.
export const VG_COLORS = C;

export function VanguardPageHeader({ title, subtitle, right = null }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: 18, gap: 16, flexWrap: 'wrap' }}>
      <div>
        <h1 style={{ fontFamily: 'Syne', fontWeight: 800, fontSize: 26, color: C.text, margin: 0, letterSpacing: '-.01em' }}>{title}</h1>
        {subtitle && (
          <div style={{ fontFamily: 'DM Sans', fontSize: 13, color: C.textDim, marginTop: 4 }}>{subtitle}</div>
        )}
      </div>
      {right}
    </div>
  );
}

export function VgCard({ children, style, ...rest }) {
  return (
    <div
      style={{
        background: C.card,
        border: `1px solid ${C.border}`,
        borderRadius: 14,
        padding: 18,
        ...style,
      }}
      {...rest}
    >
      {children}
    </div>
  );
}
