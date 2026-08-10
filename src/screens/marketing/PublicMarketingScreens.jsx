// VERGR public marketing pages.
//
// PHASE 1 (this turn): shared MarketingShell (nav + footer + breadcrumbs +
// global styles) + new LandingScreen design + stubs for every page in the
// site map. All routes work, breadcrumbs render, fonts/brand match the app.
// Phases 2-5 fill in the substance for static pages, help center search,
// forms, and the forums Q&A.
//
// Design language: adapted from the founder's Claude Design pack (zip in
// Downloads). Inline styles + CSS variables, like the settings redesign.
// Brand fonts (Syne / DM Sans / DM Mono) and Vergr accent palette
// (cyan / violet / pink / gold / ember) replace the design's Space Grotesk
// + violet-only palette. Currency is € not $. Downloads are real (no
// "coming soon" — web/desktop/iOS/Android all redirect to /signup which
// the PWA install banner handles per platform).

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link, useLocation, useParams } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { COIN_PACKS } from '../../utils/vpSystem';
import { APP_VERSION } from '../../utils/appVersion';
import Icon from '../../components/Icon';
import { LEGAL_DOCUMENTS, LEGAL_VERSION as LEGAL_FILE_VERSION, OPERATOR } from './legal/legalContent';
import useSeo from '../../utils/seo';
import JsonLd, {
  articleSchema, faqSchema, howToSchema, breadcrumbSchema, webPageSchema, useRobots,
} from '../../utils/JsonLd';
import {
  HELP_CATEGORIES, HELP_ARTICLES, HELP_ARTICLE_BY_SLUG, HELP_CATEGORY_BY_ID,
  articlesInCategory, searchArticles, POPULAR_FAQS, slugify,
} from './help/helpContent';

// ─────────────────────────────────────────────────────────────────────
// Brand tokens — match CLAUDE.md design tokens
// ─────────────────────────────────────────────────────────────────────
export const C = {
  bg:         '#07080D',
  surface:    '#0F1118',
  surface2:   '#161922',
  border:     'rgba(123,111,255,0.18)',
  borderSoft: 'rgba(255,255,255,0.08)',
  text:       '#ECEFFE',
  text2:      '#A8AEC9',
  text3:      '#6B7290',
  cyan:       '#B44FFF',
  violet:     '#7B6FFF',
  pink:       '#C87FFF',
  gold:       '#F5C542',
  ember:      '#FF4D6A',
};

const cx = (...classes) => classes.filter(Boolean).join(' ');

// Canonical marketing path.
//
// /platform is the LANDING SITE and is separate from the app at /. Several
// tables below still hold legacy bare paths ('/store', '/help', '/learn/*')
// that only 301 to their /platform equivalent — linking to those internally
// makes every nav click a redirect hop, which is what GSC reports under
// "Page with redirect" and what bleeds link equity. Normalise at render so
// every emitted href is already the canonical destination.
//
// '/' means the marketing HOME, i.e. /platform — never the app root.
export const mkPath = (p) => {
  if (!p || p === '/') return '/platform';
  if (p.startsWith('/platform')) return p;
  return `/platform${p}`;
};

// ─────────────────────────────────────────────────────────────────────
// Site map — single source of truth for footer + breadcrumb paths
// ─────────────────────────────────────────────────────────────────────
const SITE_MAP = {
  platform: {
    label: 'Platform',
    items: [
      ['Live',         '/learn/live'],
      ['Tournaments',  '/learn/tournaments'],
      ['Squads',       '/learn/squads'],
      ['Clips',        '/learn/clips'],
      ['Coins',        '/learn/coins'],
    ],
  },
  earn: {
    label: 'Earn',
    items: [
      ['Make Money Gaming',  '/platform/make-money-gaming'],
      ['EA Sports FC',       '/platform/play/fc25'],
      ['CS2',                '/platform/play/cs2'],
      ['Warzone',            '/platform/play/warzone'],
      ['NBA 2K',             '/platform/play/nba2k'],
      ['Apex Legends',       '/platform/play/apex'],
      ['Rocket League',      '/platform/play/rocketleague'],
      ['Is VERGR Legit?',    '/platform/legit'],
    ],
  },
  creators: {
    label: 'Creators',
    items: [
      ['Become a Streamer', '/streamer'],
      ['For Creators',      '/creators'],
      ['Free Link in Bio',  '/linkinbio'],
      ['Monetization',      '/monetization'],
      ['Studio Tools',      '/studio-tools'],
      ['Partner Program',   '/partners'],
    ],
  },
  community: {
    label: 'Community',
    items: [
      ['Forums',           '/forums'],
      ['Code of Conduct',  '/code-of-conduct'],
      ['Help Center',      '/help'],
    ],
  },
  company: {
    label: 'Company',
    items: [
      ['About',    '/about'],
      ['Careers',  '/careers'],
      ['Contact',  '/contact'],
      ['Delete Account', '/delete-account'],
    ],
  },
};

// Look up the human label for a path (used by breadcrumbs).
const PATH_LABELS = {
  '/':                 'Home',
  '/store':            'Coins',
  '/download':         'Download',
  '/help':             'Help Center',
  '/about':            'About',
  '/careers':          'Careers',
  '/contact':          'Contact',
  '/delete-account':   'Delete Account',
  '/code-of-conduct':  'Code of Conduct',
  '/forums':           'Forums',
  '/linkinbio':        'Link in Bio',
  '/streamer':         'Become a Streamer',
  '/creators':         'For Creators',
  '/monetization':     'Monetization',
  '/studio-tools':     'Studio Tools',
  '/partners':         'Partner Program',
  '/learn/live':         'Live',
  '/learn/tournaments':  'Tournaments',
  '/learn/squads':       'Squads',
  '/learn/clips':        'Clips',
  '/learn/coins':        'Coins',
  '/privacy':          'Privacy',
  '/terms':            'Terms',
  '/acceptable-use':   'Acceptable Use',
  '/cookies':          'Cookies',
  '/child-safety':     'Child Safety',
  '/learn/tournament-rules': 'Tournament Rules',
  '/platform/make-money-gaming': 'Make Money Gaming',
  '/platform/legit':             'Is VERGR Legit?',
  '/platform/play':              'Play for Money',
  '/platform/play/fc25':         'EA Sports FC',
  '/platform/play/cs2':          'CS2',
  '/platform/play/warzone':      'Warzone',
  '/platform/play/nba2k':        'NBA 2K',
  '/platform/play/apex':         'Apex Legends',
  '/platform/play/rocketleague': 'Rocket League',
};

// ─────────────────────────────────────────────────────────────────────
// Global style block (CSS vars + small utility classes used by inline-
// styled components, e.g. .lift, .grad-text, .reveal animations)
// ─────────────────────────────────────────────────────────────────────
function MarketingStyles() {
  return (
    <style>{`
      :root {
        --vg-bg: ${C.bg};
        --vg-surface: ${C.surface};
        --vg-surface-2: ${C.surface2};
        --vg-border: ${C.border};
        --vg-border-soft: ${C.borderSoft};
        --vg-text: ${C.text};
        --vg-text-2: ${C.text2};
        --vg-text-3: ${C.text3};
        --vg-cyan: ${C.cyan};
        --vg-violet: ${C.violet};
        --vg-pink: ${C.pink};
        --vg-gold: ${C.gold};
        --vg-ember: ${C.ember};
        --vg-grad: linear-gradient(92deg, ${C.cyan} 0%, ${C.violet} 50%, ${C.pink} 100%);
        /* Primary-button fill: a few shades deeper than the cyan/violet/pink
           accent so the gradient reads bold against the dark bg (the lighter
           violet→pink looked washed-out on "Create account" etc.). */
        --vg-grad-violet: linear-gradient(135deg, #5A35D6 0%, #8E27C9 100%);
        --vg-grad-card: linear-gradient(180deg, rgba(123,111,255,0.06) 0%, rgba(7,8,13,0.40) 100%);
      }
      .vg-grad-text {
        background: var(--vg-grad);
        -webkit-background-clip: text;
        background-clip: text;
        color: transparent;
      }
      .vg-mono { font-family: 'DM Mono', ui-monospace, monospace; font-variant-numeric: tabular-nums; }
      .vg-syne { font-family: 'Syne', 'DM Sans', sans-serif; }
      .vg-link { color: var(--vg-text-2); transition: color 0.15s; }
      .vg-link:hover { color: var(--vg-text); }
      .vg-lift { transition: transform 0.18s ease, border-color 0.18s ease; }
      .vg-lift:hover { transform: translateY(-2px); border-color: rgba(123,111,255,0.45); }
      .vg-btn-primary {
        padding: 14px 24px;
        font: 700 14px/1 'DM Sans', sans-serif;
        color: #fff;
        background: var(--vg-grad-violet);
        border-radius: 12px;
        box-shadow: 0 16px 40px -14px rgba(90,53,214,0.50), inset 0 1px 0 rgba(255,255,255,0.14);
        display: inline-flex; align-items: center; gap: 10px;
        cursor: pointer;
      }
      .vg-btn-primary:hover { filter: brightness(1.12); }
      .vg-btn-ghost {
        padding: 14px 24px;
        font: 600 14px/1 'DM Sans', sans-serif;
        color: var(--vg-text);
        background: rgba(255,255,255,0.04);
        border: 1px solid var(--vg-border-soft);
        border-radius: 12px;
        backdrop-filter: blur(8px);
        cursor: pointer;
      }
      .vg-btn-ghost:hover { background: rgba(255,255,255,0.08); }
      /* Interactive feature slides */
      .vg-slide-tabs { display: flex; flex-wrap: wrap; justify-content: center; gap: 8px; }
      .vg-slide-tab {
        padding: 8px 16px; border-radius: 999px; cursor: pointer; white-space: nowrap;
        font: 700 13px/1 'DM Sans', sans-serif;
        transition: background 0.18s ease, color 0.18s ease, border-color 0.18s ease;
      }
      .vg-slide-arrow {
        position: absolute; top: 50%; transform: translateY(-50%);
        width: 38px; height: 38px; border-radius: 999px; z-index: 4;
        display: grid; place-items: center; cursor: pointer;
        color: var(--vg-text); background: rgba(20,20,31,0.86);
        border: 1px solid var(--vg-border); backdrop-filter: blur(8px);
        box-shadow: 0 6px 22px rgba(0,0,0,0.4); transition: background 0.18s ease;
      }
      .vg-slide-arrow:hover { background: rgba(30,30,46,0.95); }
      .vg-slide-arrow.vg-left { left: -14px; }
      .vg-slide-arrow.vg-right { right: -14px; }
      @keyframes vg-pulseDot { 0%,100% { opacity:1; transform:scale(1); } 50% { opacity:0.5; transform:scale(0.85); } }
      @keyframes vg-floatY { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-8px); } }
      .vg-pulse-dot { animation: vg-pulseDot 1.6s infinite; }
      .vg-float-y { animation: vg-floatY 6s ease-in-out infinite; }
      .vg-stripe-bg {
        background-image: repeating-linear-gradient(45deg,
          rgba(255,255,255,0.04) 0 2px, transparent 2px 12px);
      }
      /* Help center */
      .vg-hscroll-wrap { position: relative; }
      .vg-hscroll {
        display: flex; gap: 14px; overflow-x: auto;
        padding-bottom: 6px; -webkit-overflow-scrolling: touch;
        scrollbar-width: none; cursor: grab;
      }
      .vg-hscroll.vg-dragging { cursor: grabbing; user-select: none; }
      .vg-hscroll.vg-dragging a { pointer-events: none; }
      .vg-hscroll::-webkit-scrollbar { display: none; }
      .vg-hscroll > * { flex: 0 0 auto; }
      .vg-hscroll-arrow {
        position: absolute; top: 50%; transform: translateY(-50%);
        width: 40px; height: 40px; border-radius: 999px; z-index: 4;
        display: grid; place-items: center; cursor: pointer;
        background: rgba(20,20,31,0.86); color: var(--vg-text);
        border: 1px solid var(--vg-border); backdrop-filter: blur(8px);
        box-shadow: 0 6px 22px rgba(0,0,0,0.4);
        transition: opacity 0.18s ease, background 0.18s ease;
      }
      .vg-hscroll-arrow:hover { background: rgba(30,30,46,0.95); }
      .vg-hscroll-arrow.vg-left { left: -6px; }
      .vg-hscroll-arrow.vg-right { right: -6px; }
      .vg-hscroll-arrow[hidden] { opacity: 0; pointer-events: none; }
      .vg-hscroll-fade {
        position: absolute; top: 0; bottom: 6px; width: 56px; z-index: 3;
        pointer-events: none; transition: opacity 0.18s ease;
      }
      .vg-hscroll-fade.vg-left { left: 0; background: linear-gradient(90deg, var(--vg-bg) 0%, transparent 100%); }
      .vg-hscroll-fade.vg-right { right: 0; background: linear-gradient(270deg, var(--vg-bg) 0%, transparent 100%); }
      .vg-hscroll-fade[hidden] { opacity: 0; }
      @media (hover: none) { .vg-hscroll-arrow { display: none; } .vg-hscroll { cursor: default; } }
      .vg-help-grid { display: grid; grid-template-columns: minmax(0,1fr) 260px; gap: 40px; align-items: start; }
      .vg-help-toc { position: sticky; top: 92px; }
      .vg-help-art p, .vg-help-art li { color: var(--vg-text-2); }
      .vg-help-art h2 { scroll-margin-top: 96px; }
      .vg-faq-chev { transition: transform 0.2s ease; }
      details[open] > summary .vg-faq-chev { transform: rotate(180deg); }
      .vg-step { counter-increment: vgstep; }
      /* Mobile nav hamburger — hidden on desktop, shown ≤720. */
      .vg-nav-burger {
        display: none; width: 42px; height: 42px; border-radius: 10px;
        align-items: center; justify-content: center; cursor: pointer;
        color: var(--vg-text); background: rgba(255,255,255,0.05);
        border: 1px solid var(--vg-border-soft);
      }
      .vg-nav-burger:hover { background: rgba(255,255,255,0.09); }
      /* Drawer only exists on tablet/mobile — never paint it on full desktop. */
      @media (min-width: 1025px) {
        .vg-drawer-root { display: none !important; }
      }
      /* Tablet and below: collapse text/visual splits; cards go multi-up.
         The full desktop nav needs ~1024px to fit (7 links + logo + 2 auth
         buttons); below that it overflowed and clipped the Sign Up button, so
         collapse it to the hamburger here, in lockstep with the hero. */
      @media (max-width: 1024px) {
        .vg-nav-bar { grid-template-columns: 1fr auto !important; }
        .vg-nav-links, .vg-nav-auth { display: none !important; }
        .vg-nav-burger { display: inline-flex !important; }
        .vg-grid-hero, .vg-grid-2 { grid-template-columns: 1fr !important; }
        .vg-grid-cols-4 { grid-template-columns: repeat(2, minmax(0,1fr)) !important; }
        .vg-footer-grid { grid-template-columns: repeat(4, 1fr) !important; gap: 32px 28px !important; }
        .vg-footer-brand { grid-column: 1 / -1 !important; }
        .vg-help-grid { grid-template-columns: 1fr !important; }
        .vg-help-toc { display: none !important; }
        .vg-hero-mock-wrap { min-height: 0 !important; }
        /* Feature slides: stack screen-over-info, hide arrows, scroll the tabs. */
        .vg-slide-grid { grid-template-columns: 1fr !important; gap: 24px !important; }
        .vg-slide-grid .vg-slide-screen { order: -1; }
        .vg-slide-arrow { display: none !important; }
        .vg-slide-tabs {
          flex-wrap: nowrap !important; overflow-x: auto; justify-content: flex-start;
          -webkit-overflow-scrolling: touch; scrollbar-width: none; padding-bottom: 4px;
        }
        .vg-slide-tabs::-webkit-scrollbar { display: none; }
        .vg-slide-tab { flex: 0 0 auto; }
        .vg-desktop-mock { display: none !important; }       /* laptop render too wide for tablet/phone */
        .vg-phone-mock {
          position: static !important; right: auto !important; bottom: auto !important;
          display: block !important; margin: 8px auto 0 !important;
          width: 92% !important; max-width: 440px !important;
        }
        .vg-h1 { font-size: 44px !important; }
      }
      /* Mobile: hamburger, smaller chrome, 2-up card grids, compact footer. */
      @media (max-width: 720px) {
        .vg-h1 { font-size: 34px !important; }
        .vg-h2 { font-size: 26px !important; }
        .vg-section { padding: 32px 18px 48px !important; }
        /* nav-links is display:none on mobile, so a 3-col grid would auto-place
           the burger into the (now empty) middle column. Collapse to 2 cols:
           logo | burger, so the burger sits hard-right. */
        .vg-nav-bar { padding: 12px 18px !important; grid-template-columns: 1fr auto !important; }
        .vg-nav-links, .vg-nav-auth { display: none !important; }
        .vg-nav-burger { display: inline-flex !important; }
        .vg-brand-logo { width: 30px !important; height: 30px !important; }
        .vg-brand-text { font-size: 17px !important; letter-spacing: 0.12em !important; }
        .vg-btn-primary, .vg-btn-ghost { padding: 11px 16px !important; font-size: 13px !important; }
        .vg-card-grid { grid-template-columns: repeat(2, minmax(0,1fr)) !important; gap: 12px !important; }
        .vg-grid-cols-4 { grid-template-columns: repeat(2, minmax(0,1fr)) !important; }
        .vg-footer-grid { grid-template-columns: 1fr 1fr !important; gap: 24px 18px !important; }
        .vg-stats-grid > div { border-left: none !important; padding-left: 0 !important; }
        .vg-economy, .vg-levels, .vg-cta, .vg-slide-card { padding: 28px 18px !important; }
        .vg-stats-grid { padding: 24px 18px !important; gap: 16px !important; }
        .vg-grid-2 { gap: 32px !important; }
        /* VP rank diamond — shrink centre + chips so the side tiers fit on a phone. */
        .vg-vp-diamond {
          grid-template-columns: minmax(0,1fr) 116px minmax(0,1fr) !important;
          grid-template-rows: minmax(0,1fr) 116px minmax(0,1fr) !important;
          column-gap: 4px !important; row-gap: 8px !important; max-width: 100% !important;
        }
        .vg-vp-chip { min-width: 0 !important; padding: 6px 8px !important; }
        .vg-vp-chip .vg-mono { font-size: 8px !important; letter-spacing: 0.06em !important; }
      }
    `}</style>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Nav + Footer + Breadcrumbs + Shell
// ─────────────────────────────────────────────────────────────────────

function Logo({ size = 40, className }) {
  return (
    <img src="/brand/logo.png" alt="VERGR" width={size} height={size} className={className} style={{
      width: size, height: size,
      borderRadius: size * 0.22,
      objectFit: 'cover',
      display: 'block',
      boxShadow: `0 4px 14px -4px ${C.violet}aa`,
    }} />
  );
}

const NAV_LINKS = [
  ['Home',        '/'],
  ['Shop',        '/store'],
  ['Tournaments', '/learn/tournaments'],
  ['Streamers',   '/streamer'],
  ['Squads',      '/learn/squads'],
  ['Help',        '/help'],
  ['Contact',     '/contact'],
];

function Nav() {
  const { currentUser } = useAuth();
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);

  // Close the drawer whenever the route changes (e.g. a link was tapped).
  useEffect(() => { setOpen(false); }, [pathname]);

  // Lock body scroll + close on Escape while the drawer is open.
  useEffect(() => {
    if (!open) return undefined;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => { document.body.style.overflow = prev; window.removeEventListener('keydown', onKey); };
  }, [open]);

  return (
    <header style={{
      position: 'sticky', top: 0, zIndex: 50,
      backdropFilter: 'blur(14px)', WebkitBackdropFilter: 'blur(14px)',
      background: 'rgba(7,8,13,0.65)',
      borderBottom: `1px solid ${C.borderSoft}`,
    }}>
      <div className="vg-nav-bar" style={{
        maxWidth: 1280, margin: '0 auto',
        padding: '16px 32px',
        display: 'grid',
        gridTemplateColumns: '1fr auto 1fr',
        alignItems: 'center', gap: 24,
      }}>
        <Link to={mkPath('/')} style={{ display: 'flex', alignItems: 'center', gap: 12, textDecoration: 'none' }}>
          <Logo size={40} className="vg-brand-logo" />
          <span className="vg-syne vg-brand-text" style={{
            fontWeight: 800, fontSize: 22, letterSpacing: '0.16em', color: C.text,
          }}>VERGR</span>
        </Link>

        <nav className="vg-nav-links" style={{ display: 'flex', gap: 4 }}>
          {NAV_LINKS.map(([label, to]) => (
            <Link key={label} to={mkPath(to)} style={{
              padding: '10px 16px', fontSize: 14, fontWeight: 500,
              color: C.text2, textDecoration: 'none', borderRadius: 8,
            }}
            onMouseEnter={e => { e.currentTarget.style.color = C.text; }}
            onMouseLeave={e => { e.currentTarget.style.color = C.text2; }}>
              {label}
            </Link>
          ))}
        </nav>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, alignItems: 'center' }}>
          <div className="vg-nav-auth" style={{ display: 'flex', gap: 10 }}>
            {currentUser ? (
              <Link to="/home" className="vg-btn-primary" style={{ textDecoration: 'none' }}>
                Open App
              </Link>
            ) : (
              <>
                <Link to="/login" className="vg-btn-ghost" style={{ textDecoration: 'none', padding: '10px 18px' }}>
                  Log In
                </Link>
                <Link to="/signup" className="vg-btn-primary" style={{ textDecoration: 'none', padding: '10px 18px' }}>
                  Sign Up
                </Link>
              </>
            )}
          </div>
          <button
            type="button"
            className="vg-nav-burger"
            aria-label="Open menu"
            aria-expanded={open}
            onClick={() => setOpen(true)}
          >
            <Icon name="menu" size={24} />
          </button>
        </div>
      </div>

      <MobileDrawer open={open} onClose={() => setOpen(false)} currentUser={currentUser} />
    </header>
  );
}

function MobileDrawer({ open, onClose, currentUser }) {
  // The nav <header> uses backdrop-filter, which establishes a containing
  // block for position:fixed descendants — that would trap this drawer inside
  // the 66px header. Portal to <body> so the fixed root fills the viewport.
  if (typeof document === 'undefined') return null;
  return createPortal(
    // Fixed, viewport-sized, overflow-hidden root. This CLIPS the off-canvas
    // panel so it can never add horizontal page scroll, and lets clicks pass
    // through to the page when closed (pointer-events none).
    <div
      className="vg-drawer-root"
      aria-hidden={!open}
      style={{
        position: 'fixed', inset: 0, zIndex: 80, overflow: 'hidden',
        pointerEvents: open ? 'auto' : 'none',
      }}
    >
      <div
        className="vg-drawer-backdrop"
        onClick={onClose}
        style={{
          position: 'absolute', inset: 0,
          background: 'rgba(0,0,0,0.6)',
          opacity: open ? 1 : 0,
          transition: 'opacity 0.25s ease',
        }}
      />
      <aside
        className="vg-drawer"
        role="dialog" aria-modal="true" aria-label="Menu"
        style={{
          position: 'absolute', top: 0, right: 0, bottom: 0,
          width: 'min(82vw, 330px)',
          background: '#0C0D15',
          borderLeft: `1px solid ${C.border}`,
          boxShadow: '-24px 0 60px -20px rgba(0,0,0,0.7)',
          transform: open ? 'translateX(0)' : 'translateX(100%)',
          transition: 'transform 0.3s cubic-bezier(0.4,0,0.2,1)',
          display: 'flex', flexDirection: 'column',
          padding: 'calc(16px + env(safe-area-inset-top)) 18px calc(20px + env(safe-area-inset-bottom))',
          overflowY: 'auto',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
          <Link to="/" onClick={onClose} style={{ display: 'flex', alignItems: 'center', gap: 10, textDecoration: 'none' }}>
            <Logo size={30} />
            <span className="vg-syne" style={{ fontWeight: 800, fontSize: 17, letterSpacing: '0.14em', color: C.text }}>VERGR</span>
          </Link>
          <button
            type="button" aria-label="Close menu" onClick={onClose}
            style={{
              width: 40, height: 40, borderRadius: 10, cursor: 'pointer',
              display: 'grid', placeItems: 'center', color: C.text,
              background: 'rgba(255,255,255,0.05)', border: `1px solid ${C.borderSoft}`,
            }}
          >
            <Icon name="close" size={22} />
          </button>
        </div>

        <nav style={{ display: 'flex', flexDirection: 'column', gap: 2, marginTop: 10 }}>
          {NAV_LINKS.map(([label, to]) => (
            <Link key={label} to={mkPath(to)} onClick={onClose} style={{
              padding: '14px 12px', fontSize: 16, fontWeight: 600,
              color: C.text, textDecoration: 'none', borderRadius: 10,
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              borderBottom: `1px solid ${C.borderSoft}`,
            }}>
              {label}
              <Icon name="chevron_right" size={18} className="vg-arrow" />
            </Link>
          ))}
        </nav>

        <div style={{ marginTop: 'auto', paddingTop: 20, display: 'flex', flexDirection: 'column', gap: 10 }}>
          {currentUser ? (
            <Link to="/home" onClick={onClose} className="vg-btn-primary" style={{ textDecoration: 'none', justifyContent: 'center' }}>
              Open App
            </Link>
          ) : (
            <>
              <Link to="/signup" onClick={onClose} className="vg-btn-primary" style={{ textDecoration: 'none', justifyContent: 'center' }}>
                Sign Up
              </Link>
              <Link to="/login" onClick={onClose} className="vg-btn-ghost" style={{ textDecoration: 'none', justifyContent: 'center', textAlign: 'center' }}>
                Log In
              </Link>
            </>
          )}
        </div>
      </aside>
    </div>,
    document.body
  );
}

function Breadcrumbs() {
  const { pathname } = useLocation();
  if (pathname === '/' || pathname === '' || pathname === '/platform') return null;
  // /platform IS home, so it never renders as its own crumb — it's the root
  // link. Remaining segments accumulate under it, and labels are looked up on
  // BOTH the full path and the legacy bare path, since PATH_LABELS still keys
  // most entries the old way ('/store', not '/platform/store').
  const parts = pathname.replace(/^\/platform/, '').split('/').filter(Boolean);
  const crumbs = [{ label: 'Home', to: '/platform' }];
  let bare = '';
  for (const p of parts) {
    bare += '/' + p;
    const label = PATH_LABELS[`/platform${bare}`] || PATH_LABELS[bare]
      || p.replace(/-/g, ' ').replace(/\b\w/g, m => m.toUpperCase());
    crumbs.push({ label, to: `/platform${bare}` });
  }
  return (
    <nav aria-label="Breadcrumb" style={{
      maxWidth: 1280, margin: '0 auto',
      padding: '20px 32px 0',
      fontSize: 13, color: C.text3,
      display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
    }}>
      {crumbs.map((c, i) => {
        const last = i === crumbs.length - 1;
        return (
          <span key={c.to} style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            {last
              ? <span style={{ color: C.text }}>{c.label}</span>
              : <Link to={c.to} className="vg-link" style={{ textDecoration: 'none' }}>{c.label}</Link>}
            {!last && <span style={{ color: C.text3, opacity: 0.6 }}>›</span>}
          </span>
        );
      })}
    </nav>
  );
}

function Footer() {
  return (
    <footer style={{
      borderTop: `1px solid ${C.borderSoft}`,
      padding: '56px 32px 32px',
      background: 'rgba(7,8,13,0.6)',
    }}>
      <div style={{
        maxWidth: 1280, margin: '0 auto',
        display: 'grid',
        gridTemplateColumns: `1.4fr repeat(${Object.keys(SITE_MAP).length}, 1fr)`,
        gap: 48,
      }} className="vg-footer-grid">
        <div className="vg-footer-brand">
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <Logo size={40} className="vg-brand-logo" />
            <span className="vg-syne vg-brand-text" style={{ fontWeight: 800, fontSize: 22, letterSpacing: '0.16em' }}>VERGR</span>
          </div>
          <p style={{ marginTop: 16, fontSize: 13, color: C.text3, lineHeight: 1.55, maxWidth: 280 }}>
            Where gamers converge. Compete, create, earn, and grow with the squads and creators that built it.
          </p>
        </div>
        {Object.values(SITE_MAP).map(col => (
          <div key={col.label}>
            <div style={{
              fontSize: 11, fontWeight: 700, letterSpacing: '0.18em',
              textTransform: 'uppercase', color: C.violet, marginBottom: 16,
            }}>{col.label}</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {col.items.map(([label, to]) => (
                <Link key={label} to={mkPath(to)} className="vg-link"
                  style={{ fontSize: 13, textDecoration: 'none' }}>
                  {label}
                </Link>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div style={{
        maxWidth: 1280, margin: '40px auto 0',
        paddingTop: 24,
        borderTop: `1px solid ${C.borderSoft}`,
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        fontSize: 12, color: C.text3, flexWrap: 'wrap', gap: 12,
      }}>
        <div style={{ maxWidth: 560 }}>
          © {new Date().getFullYear()} {OPERATOR.legalName}. All rights reserved.
          <div style={{ marginTop: 4, color: C.text3 }}>
            VERGR is operated by {OPERATOR.legalName}, a {OPERATOR.formationState.replace('State of ', '').replace(', United States of America', '')} limited
            liability company. Registered address: {OPERATOR.registeredAddress}. Contact: {OPERATOR.supportEmail}.
          </div>
        </div>
        <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap' }}>
          <Link to="/platform/terms"                  className="vg-link" style={{ textDecoration: 'none' }}>Terms</Link>
          <Link to="/platform/privacy"                className="vg-link" style={{ textDecoration: 'none' }}>Privacy</Link>
          <Link to="/platform/acceptable-use"         className="vg-link" style={{ textDecoration: 'none' }}>Acceptable Use</Link>
          <Link to="/platform/cookies"                className="vg-link" style={{ textDecoration: 'none' }}>Cookies</Link>
          <Link to="/platform/child-safety"           className="vg-link" style={{ textDecoration: 'none' }}>Child Safety</Link>
          <Link to="/platform/learn/tournament-rules" className="vg-link" style={{ textDecoration: 'none' }}>Tournament Rules</Link>
        </div>
      </div>
    </footer>
  );
}

export function MarketingShell({ children, hideBreadcrumbs }) {
  // Scroll to top whenever a marketing page mounts or the route changes.
  // react-router under HashRouter doesn't auto-restore scroll between
  // route changes; without this, navigating from /privacy → /terms keeps
  // the previous page's scroll position.
  const location = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [location.pathname]);
  return (
    <div style={{
      color: C.text, minHeight: '100vh',
      // Guard against any stray child overflowing the viewport on narrow
      // phones. `clip` (not `hidden`) clips the x-axis WITHOUT creating a
      // scroll container, so the sticky nav keeps working.
      overflowX: 'clip',
      fontFamily: "'DM Sans', sans-serif",
      // Big, visible brand-tinted glows at 25–30% strength + fixed
      // attachment so the gradient travels with the viewport on scroll.
      // Same opacity pattern as the landing-hero backdrop (which the
      // founder confirmed is visible).
      backgroundColor: C.bg,
      backgroundImage: `
        radial-gradient(800px 600px at 10% 0%, rgba(123,111,255,0.32), transparent 60%),
        radial-gradient(900px 700px at 95% 25%, rgba(180, 79, 255,0.20), transparent 60%),
        radial-gradient(900px 800px at 30% 70%, rgba(200,127,255,0.22), transparent 60%),
        radial-gradient(700px 500px at 85% 95%, rgba(255,77,106,0.16), transparent 60%)
      `,
      backgroundAttachment: 'fixed',
      backgroundRepeat: 'no-repeat',
    }}>
      <MarketingStyles />
      <Nav />
      {!hideBreadcrumbs && <Breadcrumbs />}
      {children}
      <Footer />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Reusable section primitives for stubs and content pages
// ─────────────────────────────────────────────────────────────────────

export function PageHero({ title, subtitle, accent = 'cyan', centered }) {
  const accentColor = { cyan: C.cyan, violet: C.violet, pink: C.pink, gold: C.gold, ember: C.ember }[accent] || C.cyan;
  return (
    <section className="vg-section" style={{ padding: '56px 32px 40px' }}>
      <div style={{
        maxWidth: 1280, margin: '0 auto',
        textAlign: centered ? 'center' : 'left',
      }}>
        <h1 className="vg-syne vg-h1" style={{
          fontSize: 56, lineHeight: 1.05, fontWeight: 800,
          letterSpacing: '-0.03em', margin: 0,
        }}>
          {title}
        </h1>
        {subtitle && (
          <p style={{
            marginTop: 18, maxWidth: 720,
            margin: centered ? '18px auto 0' : '18px 0 0',
            fontSize: 18, lineHeight: 1.55, color: C.text2,
          }}>{subtitle}</p>
        )}
        <div style={{
          marginTop: 24, height: 3, width: 80, borderRadius: 3,
          margin: centered ? '24px auto 0' : '24px 0 0',
          background: `linear-gradient(90deg, ${accentColor}, transparent)`,
        }} />
      </div>
    </section>
  );
}

// Placeholder for screenshots that the founder will fill in. Renders a
// glass panel sized like a real app screen with a centered description so
// the founder knows what to capture.
function ScreenshotPlaceholder({ label, ratio = '16/10', tall }) {
  return (
    <div style={{
      aspectRatio: tall ? '9/16' : ratio,
      maxWidth: tall ? 280 : '100%',
      margin: tall ? '0 auto' : 0,
      borderRadius: 14,
      background: 'var(--vg-grad-card)',
      border: `1px dashed ${C.violet}55`,
      position: 'relative', overflow: 'hidden',
      display: 'grid', placeItems: 'center',
    }}>
      <div className="vg-stripe-bg" style={{ position: 'absolute', inset: 0, opacity: 0.3 }} />
      <div style={{ position: 'relative', textAlign: 'center', padding: 24 }}>
        <span style={{ color: C.violet, marginBottom: 8, display: 'inline-block' }}>
          <Icon name="image" size={32} />
        </span>
        <div className="vg-mono" style={{
          fontSize: 11, fontWeight: 700, color: C.violet,
          letterSpacing: '0.18em', textTransform: 'uppercase', marginBottom: 6,
        }}>Screenshot needed</div>
        <div style={{ fontSize: 13, color: C.text2 }}>{label}</div>
      </div>
    </div>
  );
}

function StubPage({ title, subtitle, comingNext }) {
  return (
    <MarketingShell>
      <PageHero title={title} subtitle={subtitle} />
      <section className="vg-section" style={{ padding: '20px 32px 80px' }}>
        <div style={{
          maxWidth: 1280, margin: '0 auto',
          padding: 32, borderRadius: 16,
          background: C.surface,
          border: `1px solid ${C.borderSoft}`,
        }}>
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: 8,
            padding: '4px 10px', borderRadius: 999,
            background: 'rgba(245,197,66,0.10)',
            border: '1px solid rgba(245,197,66,0.25)',
            color: C.gold, fontSize: 11, fontWeight: 700,
            letterSpacing: '0.12em', textTransform: 'uppercase',
          }}>
            <span style={{ width: 6, height: 6, borderRadius: 99, background: C.gold }} />
            In progress
          </div>
          <p style={{ marginTop: 16, color: C.text2, fontSize: 15, lineHeight: 1.6, maxWidth: 720 }}>
            {comingNext || 'This page is being written. The structure, navigation, and design are in place — content is coming in the next pass.'}
          </p>
          <div style={{ marginTop: 24, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <Link to="/" className="vg-btn-ghost" style={{ textDecoration: 'none', fontSize: 13, padding: '10px 18px' }}>
              Back to home
            </Link>
            <Link to="/platform/help" className="vg-btn-ghost" style={{ textDecoration: 'none', fontSize: 13, padding: '10px 18px' }}>
              Visit Help Center
            </Link>
          </div>
        </div>
      </section>
    </MarketingShell>
  );
}

// ═════════════════════════════════════════════════════════════════════
// LandingScreen — adapted from the design pack with real Vergr assets
// ═════════════════════════════════════════════════════════════════════

// Visual primitive — Vergr-tinted "screenshot" panel used inside the
// feature cards and the hero mock. Stripes + radial gradient stand in for
// real game / stream imagery without claiming a specific frame.
function GameTile({ label, hue = 290, ratio = '16/9', live, viewers, children, style }) {
  return (
    <div style={{
      aspectRatio: ratio, borderRadius: 10, position: 'relative', overflow: 'hidden',
      background: `linear-gradient(135deg, hsl(${hue} 60% 32%) 0%, hsl(${hue + 30} 50% 16%) 100%)`,
      boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.06)',
      ...style,
    }}>
      <div className="vg-stripe-bg" style={{ position: 'absolute', inset: 0, opacity: 0.5, mixBlendMode: 'overlay' }} />
      <div style={{
        position: 'absolute', inset: 0,
        background: 'repeating-linear-gradient(0deg, rgba(255,255,255,0.04) 0px, rgba(255,255,255,0.04) 1px, transparent 1px, transparent 3px)',
      }} />
      {label && (
        <div className="vg-mono" style={{
          position: 'absolute', inset: 0, display: 'grid', placeItems: 'center',
          fontSize: 9, color: 'rgba(255,255,255,0.55)', letterSpacing: '0.18em', textTransform: 'uppercase',
        }}>{label}</div>
      )}
      {live && (
        <div style={{
          position: 'absolute', top: 8, left: 8,
          display: 'flex', gap: 6, alignItems: 'center',
          padding: '3px 8px', borderRadius: 6,
          background: C.ember, fontSize: 9, fontWeight: 800, color: '#fff',
          letterSpacing: '0.12em',
        }}>
          <span className="vg-pulse-dot" style={{ width: 6, height: 6, borderRadius: 99, background: '#fff' }} />
          LIVE
        </div>
      )}
      {viewers && (
        <div className="vg-mono" style={{
          position: 'absolute', top: 8, right: 8,
          padding: '3px 8px', borderRadius: 6,
          background: 'rgba(7,8,13,0.7)', fontSize: 10, fontWeight: 600,
          backdropFilter: 'blur(6px)',
        }}>{viewers}</div>
      )}
      {children}
    </div>
  );
}

function SidebarItem({ icon, label, active }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10,
      padding: '7px 10px', borderRadius: 7,
      fontSize: 11, fontWeight: 500,
      color: active ? C.text : C.text2,
      background: active ? 'rgba(123,111,255,0.18)' : 'transparent',
      boxShadow: active ? 'inset 0 0 0 1px rgba(123,111,255,0.30)' : 'none',
    }}>
      <Icon name={icon} size={15} className="" />
      <span style={{ display: 'inline-block', color: 'inherit' }}>{label}</span>
    </div>
  );
}

function ChatLine({ user, msg, color = C.violet, emoji }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 11, lineHeight: 1.4 }}>
      <span style={{
        width: 18, height: 18, borderRadius: 99, flexShrink: 0,
        background: `linear-gradient(135deg, ${color}, ${C.pink})`,
      }} />
      <div style={{ minWidth: 0 }}>
        <span style={{ color, fontWeight: 600 }}>{user}</span>
        <span style={{ color: C.text2, marginLeft: 6 }}>{msg}</span>
        {emoji && <span style={{ marginLeft: 4 }}>{emoji}</span>}
      </div>
    </div>
  );
}

// Detailed Vergr home-feed mock — matches the actual app structure
// (sidebar nav, live hero, tournaments rail, squads rail, live chat).
function DesktopMock() {
  return (
    <div style={{
      width: '100%', borderRadius: 16, overflow: 'hidden',
      background: `linear-gradient(180deg, ${C.surface} 0%, ${C.bg} 100%)`,
      border: `1px solid ${C.border}`,
      boxShadow: `0 30px 80px -20px rgba(123,111,255,0.45), 0 0 0 1px rgba(123,111,255,0.06)`,
      display: 'flex', flexDirection: 'column',
    }}>
      <div style={{
        padding: '12px 14px',
        display: 'flex', alignItems: 'center', gap: 10,
        borderBottom: `1px solid ${C.borderSoft}`,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <Logo size={22} />
          <span className="vg-syne" style={{ fontWeight: 800, fontSize: 12, letterSpacing: '0.18em' }}>VERGR</span>
        </div>
        <div style={{
          flex: 1, height: 28,
          background: 'rgba(123,111,255,0.06)',
          border: `1px solid ${C.borderSoft}`,
          borderRadius: 7,
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '0 10px',
          fontSize: 11, color: C.text3,
        }}>
          <Icon name="search" size={14} />
          <span>Search squads, users, games…</span>
        </div>
        <div style={{ display: 'flex', gap: 12, color: C.text3 }}>
          <Icon name="notifications" size={16} />
          <Icon name="chat" size={16} />
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '170px 1fr 220px', minHeight: 540 }}>
        <div style={{
          padding: 10, borderRight: `1px solid ${C.borderSoft}`,
          display: 'flex', flexDirection: 'column', gap: 3,
        }}>
          <SidebarItem icon="home" label="Home" active />
          <SidebarItem icon="live_tv" label="Live" />
          <SidebarItem icon="groups" label="Squads" />
          <SidebarItem icon="emoji_events" label="Tournaments" />
          <SidebarItem icon="movie" label="Clips" />
          <SidebarItem icon="account_balance_wallet" label="Wallet" />
          <SidebarItem icon="notifications" label="Notifications" />
          <SidebarItem icon="explore" label="Explore" />
          <div style={{
            marginTop: 'auto', display: 'flex', alignItems: 'center', gap: 8,
            padding: 8, borderRadius: 8, background: 'rgba(123,111,255,0.08)',
          }}>
            <div style={{ width: 28, height: 28, borderRadius: 99, background: `linear-gradient(135deg, ${C.pink}, ${C.violet})` }} />
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 11, fontWeight: 600 }}>LunaX</div>
              <div style={{ fontSize: 9, color: C.violet }}>Champion · Lvl 56</div>
            </div>
          </div>
        </div>

        <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div className="vg-syne" style={{ fontWeight: 700, fontSize: 14 }}>Live Now</div>
            <div style={{ fontSize: 10, color: C.violet, fontWeight: 600 }}>View All →</div>
          </div>
          <GameTile hue={285} live viewers="↗ 12.4K" ratio="16/9" label="ROAD TO RADIANT · VALORANT">
            <div style={{ position: 'absolute', bottom: 10, left: 10, right: 10, display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <div style={{
                  width: 28, height: 28, borderRadius: 99,
                  background: `linear-gradient(135deg, ${C.pink}, ${C.violet})`,
                  boxShadow: `0 0 0 2px ${C.violet}77`,
                }} />
                <div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: '#fff' }}>LunaX <span style={{ color: C.violet }}>●</span></div>
                  <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.7)' }}>Road to Radiant · Valorant</div>
                </div>
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                {['Competitive', 'EN'].map(t => (
                  <span key={t} style={{ padding: '3px 7px', borderRadius: 6, fontSize: 9, color: '#fff', background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)' }}>{t}</span>
                ))}
              </div>
            </div>
          </GameTile>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div className="vg-syne" style={{ fontWeight: 700, fontSize: 13 }}>Upcoming Tournaments</div>
            <div style={{ fontSize: 10, color: C.violet, fontWeight: 600 }}>View All</div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            {[
              ['VERGR Season Cup', '€10,000', 'May 24', 'Open',       '#34d399'],
              ['Elite Showdown',   '€5,000',  'May 25', 'Registering', C.gold],
              ['Squad Wars',       '€2,500',  'May 26', 'Open',        '#34d399'],
            ].map(([title, prize, date, status, color]) => (
              <div key={title} style={{
                flex: 1, padding: 12, minWidth: 0,
                background: 'rgba(123,111,255,0.06)',
                border: '1px solid rgba(123,111,255,0.12)',
                borderRadius: 10,
                display: 'flex', flexDirection: 'column', gap: 6,
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <div style={{
                    width: 22, height: 22, borderRadius: 5,
                    background: 'var(--vg-grad-violet)',
                    display: 'grid', placeItems: 'center',
                    fontSize: 10, fontWeight: 800, fontFamily: 'Syne',
                  }}>V</div>
                  <div style={{ fontSize: 11, fontWeight: 600, color: '#fff', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{title}</div>
                </div>
                <div>
                  <div style={{ fontSize: 9, color: C.text3 }}>Prize</div>
                  <div className="vg-mono" style={{ fontSize: 13, fontWeight: 700, color: C.violet }}>{prize}</div>
                </div>
                <div style={{ fontSize: 10, color: C.text3 }}>{date}</div>
                <div style={{
                  display: 'inline-block', alignSelf: 'flex-start',
                  padding: '3px 8px', borderRadius: 5,
                  fontSize: 9, fontWeight: 700, letterSpacing: '0.08em',
                  textTransform: 'uppercase', color, background: `${color}22`,
                  border: `1px solid ${color}44`,
                }}>{status}</div>
              </div>
            ))}
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 }}>
            <div className="vg-syne" style={{ fontWeight: 700, fontSize: 13 }}>Recommended Squads</div>
            <div style={{ fontSize: 10, color: C.violet, fontWeight: 600 }}>View All</div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            {[
              ['NightRaiders', 12, 285],
              ['Quantum Crew', 8,  300],
              ['Elite Society', 15, 250],
              ['Phoenix Rising', 9, 20],
            ].map(([name, members, hue]) => (
              <div key={name} style={{
                flex: 1, minWidth: 0,
                padding: '12px 8px',
                background: 'rgba(123,111,255,0.05)',
                border: '1px solid rgba(123,111,255,0.10)',
                borderRadius: 10,
                display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6,
                textAlign: 'center',
              }}>
                <div style={{
                  width: 36, height: 36,
                  clipPath: 'polygon(50% 0,100% 25%,100% 75%,50% 100%,0 75%,0 25%)',
                  background: `linear-gradient(135deg, hsl(${hue} 65% 60%), hsl(${hue + 40} 50% 35%))`,
                  display: 'grid', placeItems: 'center',
                  fontFamily: 'Syne', fontWeight: 800, fontSize: 14, color: '#fff',
                }}>{name[0]}</div>
                <div style={{ fontSize: 10, fontWeight: 600, color: '#fff', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '100%' }}>{name}</div>
                <div style={{ fontSize: 9, color: C.text3 }}>{members} Members</div>
              </div>
            ))}
          </div>
        </div>

        <div style={{
          borderLeft: `1px solid ${C.borderSoft}`,
          padding: 12, display: 'flex', flexDirection: 'column', gap: 8,
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div className="vg-syne" style={{ fontWeight: 700, fontSize: 12 }}>Live Chat</div>
            <div className="vg-mono" style={{ fontSize: 9, color: C.violet }}>↗ 12.8K</div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
            <ChatLine user="NinjaPro" msg="let's gooooo" emoji="🔥" color={C.gold} />
            <ChatLine user="ViperX"   msg="insane clutch!"     color={C.cyan} />
            <ChatLine user="QueenB"   msg="that was clean"     color={C.pink} />
            <ChatLine user="Zyro"     msg="GG"                 color={C.violet} />
            <ChatLine user="Shadow"   msg="next match?"        color="#34d399" />
            <ChatLine user="LunaX"    msg="thanks for the love!" emoji="💜" color={C.violet} />
          </div>
          <div style={{
            marginTop: 'auto',
            padding: '7px 10px',
            background: 'rgba(123,111,255,0.08)',
            border: '1px solid rgba(123,111,255,0.10)',
            borderRadius: 7,
            fontSize: 10, color: C.text3,
          }}>Send a message…</div>
        </div>
      </div>
    </div>
  );
}

// Compact phone mock that floats next to the desktop hero.
function PhoneMock() {
  return (
    <div style={{
      width: 220,
      background: C.bg,
      border: `8px solid #1a0f3d`,
      borderRadius: 36,
      boxShadow: `0 30px 60px -10px rgba(123,111,255,0.55), 0 0 0 1px ${C.violet}33`,
      overflow: 'hidden',
      position: 'relative',
    }}>
      <div style={{ padding: '10px 14px 6px', display: 'flex', justifyContent: 'space-between', fontSize: 10, fontWeight: 600 }}>
        <span className="vg-mono">11:41</span>
        <span style={{ color: C.text3 }}>● ◑ ▴</span>
      </div>
      <div style={{ padding: '4px 14px 10px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <Logo size={18} />
          <span className="vg-syne" style={{ fontWeight: 800, fontSize: 10, letterSpacing: '0.18em' }}>VERGR</span>
        </div>
        <div style={{ display: 'flex', gap: 10, color: C.text3 }}>
          <Icon name="search" size={14} />
          <Icon name="notifications" size={14} />
        </div>
      </div>
      <div style={{ padding: '0 12px 10px' }}>
        <div className="vg-syne" style={{ fontWeight: 700, fontSize: 11, marginBottom: 6 }}>Live Now</div>
        <GameTile hue={295} live viewers="↗ 8.7K" ratio="16/10" label="ROAD TO RADIANT">
          <div style={{ position: 'absolute', bottom: 8, left: 8, right: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
            <div style={{ width: 22, height: 22, borderRadius: 99, background: `linear-gradient(135deg, ${C.pink}, ${C.violet})` }} />
            <div>
              <div style={{ fontSize: 10, fontWeight: 700, color: '#fff' }}>LunaX</div>
              <div style={{ fontSize: 8, color: 'rgba(255,255,255,0.7)' }}>Road to Radiant</div>
            </div>
          </div>
        </GameTile>
      </div>
      <div style={{ padding: '12px 12px 10px' }}>
        <div className="vg-syne" style={{ fontWeight: 700, fontSize: 11, marginBottom: 6 }}>Up Next</div>
        <div style={{
          padding: 10,
          background: 'rgba(123,111,255,0.06)',
          border: '1px solid rgba(123,111,255,0.12)',
          borderRadius: 9,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <div style={{ width: 18, height: 18, borderRadius: 4, background: 'var(--vg-grad-violet)', fontSize: 8, fontWeight: 800, fontFamily: 'Syne', color: '#fff', display: 'grid', placeItems: 'center' }}>V</div>
              <span style={{ fontSize: 10, fontWeight: 600 }}>Season Cup</span>
            </div>
            <div className="vg-mono" style={{ fontSize: 11, fontWeight: 700, color: C.violet, marginTop: 2 }}>€10,000</div>
            <div style={{ fontSize: 9, color: C.text3 }}>May 24</div>
          </div>
          <div style={{ padding: '4px 8px', borderRadius: 5, fontSize: 9, fontWeight: 700, color: '#34d399', background: 'rgba(52,211,153,0.12)', border: '1px solid rgba(52,211,153,0.3)' }}>Open</div>
        </div>
      </div>
      <div style={{
        borderTop: `1px solid ${C.borderSoft}`,
        padding: '10px 14px',
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        color: C.text3,
      }}>
        <span style={{ color: C.violet }}><Icon name="home" size={18} /></span>
        <Icon name="explore" size={18} />
        <span style={{
          width: 32, height: 32, borderRadius: 99,
          background: 'var(--vg-grad-violet)',
          display: 'grid', placeItems: 'center',
          boxShadow: `0 8px 20px -4px ${C.violet}aa`,
          color: '#fff',
        }}><Icon name="add" size={18} /></span>
        <Icon name="notifications" size={18} />
        <Icon name="person" size={18} />
      </div>
    </div>
  );
}

// Shared "sleek container" surface — the look from LandingCTA ("Where will
// your run begin?"). Reused by LandingStats + LandingEconomy so the three
// hero containers read as one family. Callers add their own padding/grid.
const CTA_SURFACE = {
  background: `radial-gradient(circle at 50% 0%, rgba(123,111,255,0.20), transparent 60%), linear-gradient(180deg, rgba(15,17,24,0.9), rgba(7,8,13,0.95))`,
  border: '1px solid rgba(123,111,255,0.25)',
};

function LandingHero() {
  const { currentUser, signInAsGuest } = useAuth();
  const [guestLoading, setGuestLoading] = useState(false);
  const handleGuest = async () => {
    setGuestLoading(true);
    try {
      await signInAsGuest();
      // Land them on the home feed — the guest gate kicks in for any
      // action that writes data.
      window.location.href = '/';
    } catch (err) {
      console.error('guest signin failed', err);
    } finally {
      setGuestLoading(false);
    }
  };
  return (
    <section className="vg-section" style={{
      padding: '28px 32px 100px', position: 'relative', overflow: 'hidden',
    }}>
      <div style={{
        position: 'absolute', top: '10%', right: '-10%', width: '60%', height: '80%',
        background: `radial-gradient(closest-side, ${C.violet}55, transparent 70%)`,
        filter: 'blur(60px)', zIndex: 0, pointerEvents: 'none',
      }} />
      <div style={{
        maxWidth: 1400, margin: '0 auto',
        position: 'relative', zIndex: 1,
        display: 'grid',
        gridTemplateColumns: '0.85fr 1.55fr',
        gap: 32, alignItems: 'start',
      }} className="vg-grid-hero">
        <div style={{ position: 'relative', zIndex: 2 }}>
          <h1 className="vg-syne vg-h1" style={{
            fontSize: 52, lineHeight: 1.05, fontWeight: 800,
            letterSpacing: '-0.03em', margin: 0,
          }}>
            <div>Play together.</div>
            <div>Win together.</div>
            <div className="vg-grad-text">Grow together.</div>
          </h1>

          <p style={{
            marginTop: 22, fontSize: 16, lineHeight: 1.6,
            color: C.text2, maxWidth: 440,
          }}>
            VERGR is where gamers, creators, and squads come together to play, compete, and earn.
            Build crews, watch live, enter tournaments, and turn your wins into something real.
          </p>

          <div style={{ marginTop: 28, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <Link
              to={currentUser ? '/home' : '/signup'}
              className="vg-btn-primary"
              style={{ textDecoration: 'none' }}
            >
              {currentUser ? 'Open the app' : 'Start your journey'} →
            </Link>
            <Link to="/platform/store" className="vg-btn-ghost" style={{ textDecoration: 'none' }}>
              Shop coin packs
            </Link>
            {!currentUser && (
              <button
                type="button"
                onClick={handleGuest}
                disabled={guestLoading}
                className="vg-btn-ghost"
                style={{ cursor: 'pointer' }}
              >
                {guestLoading ? 'Loading…' : 'Browse as guest'}
              </button>
            )}
          </div>
        </div>

        <div className="vg-hero-mock-wrap" style={{ position: 'relative', minHeight: 480 }}>
          {/* Real product renders (laptop + angled phone) replace the in-code
              mocks. Transparent webps so the page bg shows through. */}
          <img
            className="vg-desktop-mock"
            src="/brand/platform-hero-desktop.webp"
            alt="VERGR running on a laptop — Home feed, live rail, and squads"
            loading="eager"
            style={{
              position: 'relative', zIndex: 1, width: '100%', display: 'block',
              filter: `drop-shadow(0 36px 80px ${C.violet}55)`,
            }}
          />
          <img
            className="vg-float-y vg-phone-mock"
            src="/brand/platform-hero-mobile.webp"
            alt="VERGR on a phone — the feed in your pocket"
            loading="eager"
            style={{
              position: 'absolute', right: -28, bottom: -52, zIndex: 3,
              width: '56%', maxWidth: 380, display: 'block',
              filter: `drop-shadow(0 24px 50px ${C.violet}66)`,
            }}
          />
        </div>
      </div>
    </section>
  );
}


// ═════════════════════════════════════════════════════════════════════
// LandingSlides — full-width "app store listing" deck. Each slide pairs a
// real app screenshot (iMac render in /brand/slide-*.webp) with an info
// sidebar. Mobile: stacks screen-over-info; tabs become a horizontal scroller.
// ═════════════════════════════════════════════════════════════════════
const SLIDE_DATA = [
  {
    id: 'live', tab: 'Live Streaming', accent: C.ember, img: '/brand/slide-live.webp',
    title: 'Go live in one tap.',
    intro: 'Broadcast from your browser or OBS and your audience watches edge-to-edge, in sync, with chat and tips rolling in.',
    bullets: [
      ['live_tv', 'Edge-to-edge viewing', 'Full-screen, low-latency playback in crystal-clear quality on any device.'],
      ['forum', 'Real-time chat & tips', 'Chat reacts live and fans tip you in coins while you play.'],
      ['monitoring', 'Stream health built in', 'Bitrate, viewers, and dropped frames at a glance, no second monitor.'],
      ['smartphone', 'Mobile-first controls', 'Start, switch cameras, and moderate straight from your phone.'],
    ],
    chips: ['1080p60 on Pro', 'Tips at 10% flat', 'OBS or browser'],
  },
  {
    id: 'connect', tab: 'Connect', accent: C.violet, img: '/brand/slide-connect.webp',
    title: 'Talk. Team up. Belong.',
    intro: 'Spin up a squad space, drop into voice, and meet people who main your games. Private DMs stay private.',
    bullets: [
      ['lock', 'Private, encrypted chat', 'DMs and group chats stay private and unmoderated, always.'],
      ['groups', 'Servers up to 10,000', 'Build community spaces with text and voice channels.'],
      ['link', 'Link your games', 'Connect Steam, Riot, Xbox and more to show your real stats.'],
      ['diversity_3', 'Find your people', 'Discover players who main your games and your region.'],
    ],
    chips: ['End-to-end private', 'Voice channels', 'Cross-platform'],
  },
  {
    id: 'squads', tab: 'Find Squads', accent: C.cyan, img: '/brand/slide-squads.webp',
    title: 'Never solo queue again.',
    intro: 'Get matched to squads built around your games, rank, and schedule, then win and earn together.',
    bullets: [
      ['recommend', 'Recommended squads', 'Matched to your games, rank, and when you actually play.'],
      ['account_balance_wallet', 'Shared treasury', 'Tournament winnings flow into a squad wallet you all share.'],
      ['groups', 'Up to 100 members', 'Run scrims, events, and squad streams together.'],
      ['trending_up', 'Climb together', 'Squad XP and loyalty rewards for your active members.'],
    ],
    chips: ['Shared treasury', 'Squad streams', 'Up to 100'],
  },
  {
    id: 'payments', tab: 'Payments', accent: C.gold, img: '/brand/slide-payments.webp',
    title: 'Real money, real fast.',
    intro: 'Top up in seconds and cash eligible gems out to your own wallet. One balance powers tips, entries, and boosts.',
    bullets: [
      ['bolt', 'Top up instantly', 'Buy coins with card, Apple Pay, or crypto via PayRam.'],
      ['payments', 'Withdraw to crypto', 'Cash eligible gems out to your own Base wallet.'],
      ['trending_down', 'Convert as you rank', 'Your conversion commission drops the higher your VP rank.'],
      ['verified', 'Transparent fees', 'Flat 10% tip fee, no hidden cuts, no surprises.'],
    ],
    chips: ['Card · crypto', 'Min 1,000 gems', 'Lower fees by rank'],
  },
  {
    id: 'tournaments', tab: 'Tournaments', accent: C.violet, img: '/brand/slide-tournaments.webp',
    title: "Prove you're the best.",
    intro: 'Enter skill-based brackets with real coin prize pools. Results are verified, so wins are earned, not claimed.',
    bullets: [
      ['emoji_events', 'Real prize pools', 'Skill-based brackets with coin prizes, winner takes all.'],
      ['fact_check', 'Verified results', 'Auto screen-reading plus mod review keep every match fair.'],
      ['account_tree', 'Every format', '1v1 to 256-player, single or double elim, round robin.'],
      ['groups', 'Squad or solo', 'Enter alone or roll in as your squad for the treasury.'],
    ],
    chips: ['Up to 256 players', 'Anti-cheat scan', 'Winner takes all'],
  },
];

function LandingSlides() {
  const [active, setActive] = useState(0);
  const slide = SLIDE_DATA[active];
  const go = (dir) => setActive((i) => (i + dir + SLIDE_DATA.length) % SLIDE_DATA.length);

  return (
    <section className="vg-section" style={{ padding: '40px 32px 80px' }}>
      <div style={{ maxWidth: 1280, margin: '0 auto' }}>
        <div style={{ textAlign: 'center', marginBottom: 28 }}>
          <h2 className="vg-syne vg-h2" style={{
            fontSize: 40, fontWeight: 800, letterSpacing: '-0.03em', margin: 0, lineHeight: 1.1,
          }}>
            Built for <span className="vg-grad-text">gamers</span>. Designed for{' '}
            <span style={{
              background: `linear-gradient(92deg, ${C.cyan}, ${C.violet})`,
              WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent',
            }}>communities</span>.
          </h2>
          <p style={{ marginTop: 12, fontSize: 16, color: C.text2 }}>
            One app for streaming, chat, squads, payments, and tournaments. Swipe through what you get.
          </p>
        </div>

        {/* Tab pills (horizontal scroller on mobile) */}
        <div className="vg-slide-tabs">
          {SLIDE_DATA.map((s, i) => (
            <button
              key={s.id}
              type="button"
              onClick={() => setActive(i)}
              aria-selected={i === active}
              className="vg-slide-tab"
              style={{
                background: i === active ? 'var(--vg-grad-violet)' : 'rgba(255,255,255,0.04)',
                color: i === active ? '#fff' : C.text2,
                border: i === active ? '1px solid transparent' : `1px solid ${C.borderSoft}`,
              }}
            >
              {s.tab}
            </button>
          ))}
        </div>

        {/* Active slide */}
        <div className="vg-slide-card vg-slide-grid" style={{
          ...CTA_SURFACE, borderRadius: 24, padding: '40px 44px', marginTop: 22,
          display: 'grid', gridTemplateColumns: '0.82fr 1.18fr', gap: 44,
          alignItems: 'center', position: 'relative',
        }}>
          <button type="button" aria-label="Previous" onClick={() => go(-1)} className="vg-slide-arrow vg-left"><Icon name="chevron_left" size={22} /></button>
          <button type="button" aria-label="Next" onClick={() => go(1)} className="vg-slide-arrow vg-right"><Icon name="chevron_right" size={22} /></button>

          <div className="vg-slide-info" style={{ minWidth: 0 }}>
            <span style={{
              display: 'inline-flex', alignItems: 'center', gap: 6, padding: '5px 12px', borderRadius: 999,
              fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase',
              color: slide.accent, background: `${slide.accent}1f`, border: `1px solid ${slide.accent}55`,
            }}>{slide.tab}</span>
            <h3 className="vg-syne" style={{ fontSize: 30, fontWeight: 800, letterSpacing: '-0.02em', margin: '14px 0 0', lineHeight: 1.1 }}>
              {slide.title}
            </h3>
            <p style={{ marginTop: 12, fontSize: 15, color: C.text2, lineHeight: 1.6 }}>{slide.intro}</p>
            <div style={{ marginTop: 10 }}>
              {slide.bullets.map(([icon, title, body]) => (
                <Bullet key={title} icon={icon} title={title} body={body} color={slide.accent} />
              ))}
            </div>
            <div style={{ marginTop: 14, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {slide.chips.map((ch) => (
                <span key={ch} style={{
                  padding: '6px 11px', borderRadius: 999, fontSize: 11, fontWeight: 700,
                  color: C.text2, background: 'rgba(255,255,255,0.04)', border: `1px solid ${C.borderSoft}`,
                }}>{ch}</span>
              ))}
            </div>
          </div>

          {/* Real app screen (iMac render). Accent glow + drop-shadow behind
              the device so it pops off the dark container. */}
          <div className="vg-slide-screen" style={{ position: 'relative', minWidth: 0, display: 'grid', placeItems: 'center' }}>
            <div aria-hidden style={{
              position: 'absolute', inset: '4% 4% 12% 4%',
              background: `radial-gradient(closest-side, ${slide.accent}4d, transparent 72%)`,
              filter: 'blur(48px)', zIndex: 0, pointerEvents: 'none',
            }} />
            <img
              src={slide.img}
              alt={`VERGR ${slide.tab} screen`}
              loading="lazy"
              style={{
                position: 'relative', zIndex: 1, width: '100%', display: 'block',
                filter: `drop-shadow(0 36px 70px rgba(0,0,0,0.55)) drop-shadow(0 12px 34px ${slide.accent}40)`,
              }}
            />
          </div>
        </div>

        {/* Dots */}
        <div style={{ display: 'flex', justifyContent: 'center', gap: 8, marginTop: 20 }}>
          {SLIDE_DATA.map((s, i) => (
            <button
              key={s.id}
              type="button"
              aria-label={`Go to ${s.tab}`}
              onClick={() => setActive(i)}
              style={{
                width: i === active ? 26 : 9, height: 9, borderRadius: 999, padding: 0, cursor: 'pointer',
                border: 'none', transition: 'width 0.2s ease, background 0.2s ease',
                background: i === active ? 'var(--vg-grad-violet)' : 'rgba(255,255,255,0.16)',
              }}
            />
          ))}
        </div>
      </div>
    </section>
  );
}

// Stats bar (4 platform pillars)
function LandingStats() {
  return (
    <section className="vg-section" style={{ padding: '0 32px 60px' }}>
      <div style={{
        maxWidth: 1280, margin: '0 auto',
        padding: '40px 48px', borderRadius: 24,
        ...CTA_SURFACE,
        display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 24,
        position: 'relative', overflow: 'hidden',
      }} className="vg-grid-cols-4 vg-stats-grid">
        <div style={{
          position: 'absolute', inset: 0,
          background: `radial-gradient(600px 200px at 50% 50%, ${C.violet}33, transparent 70%)`,
        }} />
        {[
          ['paid',                    'Free',                 'To join, play and stream'],
          ['verified_user',           'Lower fees',           'Commission drops as you rank up'],
          ['devices',                 'Desktop · Mobile',     'One account, all devices'],
          ['account_balance_wallet',  'Real payouts',          'Withdraw eligible gems'],
        ].map(([ic, n, l], i) => (
          <div key={i} style={{
            display: 'flex', alignItems: 'center', gap: 14,
            position: 'relative', zIndex: 1,
            borderLeft: i === 0 ? 'none' : `1px solid ${C.violet}33`,
            paddingLeft: i === 0 ? 0 : 24,
          }}>
            <span style={{ color: C.violet, flexShrink: 0 }}>
              <Icon name={ic} size={28} />
            </span>
            <div>
              <div className="vg-syne" style={{ fontSize: 20, fontWeight: 800, lineHeight: 1.1 }}>{n}</div>
              <div style={{ fontSize: 13, color: C.text2, marginTop: 4 }}>{l}</div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function LandingEconomy() {
  return (
    <section className="vg-section" style={{ padding: '40px 32px 80px' }}>
      <div style={{
        maxWidth: 1280, margin: '0 auto',
        padding: '56px 56px', borderRadius: 24,
        ...CTA_SURFACE,
        display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 56, alignItems: 'center',
      }} className="vg-grid-2 vg-economy">
        <div>
          <h2 className="vg-syne" style={{
            fontSize: 40, lineHeight: 1.05,
            fontWeight: 800, letterSpacing: '-0.03em', margin: 0,
          }}>
            Earn while you <span className="vg-grad-text">play, create, and compete.</span>
          </h2>
          <p style={{
            marginTop: 18, fontSize: 16, color: C.text2, lineHeight: 1.6, maxWidth: 460,
          }}>
            VC Coins flow through every corner of VERGR — tips for streamers, prizes for tournaments,
            memberships for top fans, and boosts for squads on the rise. Eligible gem earnings convert and withdraw.
          </p>
          <div style={{ marginTop: 24, display: 'flex', flexDirection: 'column', gap: 10 }}>
            {[
              'Tip your favorite creators in real time',
              'Win tournament prizes paid in VC',
              'Subscribe to creators and squads — recurring perks',
              'Convert eligible gems → withdraw to your wallet',
            ].map((t, i) => (
              <div key={i} style={{ display: 'flex', gap: 10, alignItems: 'center', fontSize: 14, color: C.text2 }}>
                <span style={{
                  width: 20, height: 20, borderRadius: 99,
                  background: 'rgba(52,211,153,0.18)', color: '#34d399',
                  display: 'grid', placeItems: 'center',
                  fontSize: 12, fontWeight: 800,
                }}>✓</span>
                {t}
              </div>
            ))}
          </div>
          <Link to="/platform/learn/coins" className="vg-btn-primary" style={{
            marginTop: 28, textDecoration: 'none', display: 'inline-flex',
          }}>
            How VERGR Coins work →
          </Link>
        </div>

        <div style={{ display: 'grid', placeItems: 'center', minHeight: 420, position: 'relative' }}>
          <div style={{
            position: 'absolute', inset: '10%',
            background: `radial-gradient(closest-side, ${C.gold}55, transparent 70%)`,
            filter: 'blur(50px)',
          }} />
          <img src="/brand/vc-coin.webp" alt="VC coin" className="vg-float-y" style={{
            position: 'relative', width: '100%', maxWidth: 360,
            filter: `drop-shadow(0 30px 50px ${C.violet}66) drop-shadow(0 10px 20px ${C.gold}55)`,
          }} />
          <div className="vg-mono" style={{
            position: 'absolute', bottom: 0, left: 0, right: 0,
            textAlign: 'center', fontSize: 12,
            color: C.violet, letterSpacing: '0.18em',
          }}>
            1 VC ≈ €0.01 · MIN. WITHDRAWAL 1,000 GEMS
          </div>
        </div>
      </div>
    </section>
  );
}

// VP / Levels — uses the real /brand/vp-gem.webp with 4 tier chips at the
// cardinal points. Commission % matches commissionForVP() in src/utils/vpSystem.js
// (and the authoritative functions/economy.js): steps DOWN with lifetime VP from
// 30% to a 15% floor at 100,000 VP. Rookie 30%, Challenger ~18%, Champion 15%,
// Immortal 15%.
function LandingLevels() {
  // Each chip uses explicit edge anchoring (top/right/bottom/left = 0) so
  // it lands on a perfect cross relative to the wrapper, regardless of the
  // wrapper's actual rendered size.
  const chip = {
    padding: '8px 14px',
    background: 'rgba(7,8,13,0.78)',
    backdropFilter: 'blur(8px)',
    border: `1px solid ${C.violet}55`,
    borderRadius: 999,
    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2,
    minWidth: 100, whiteSpace: 'nowrap',
  };
  const chipName = { fontSize: 9, fontWeight: 700, letterSpacing: '0.18em', color: C.violet };
  const chipFee  = { fontSize: 11, fontWeight: 600 };
  return (
    <section className="vg-section" style={{ padding: '40px 32px 80px' }}>
      <div style={{
        maxWidth: 1280, margin: '0 auto',
        display: 'grid', gridTemplateColumns: '1fr 1fr',
        gap: 56, alignItems: 'center',
      }} className="vg-grid-2">
        {/* 3x3 CSS grid: gem occupies the dead-center cell, chips occupy
            N/E/S/W cells. Corners are empty. This makes "centered" a CSS
            guarantee — there's no positioning math to get wrong. */}
        <div className="vg-vp-diamond" style={{
          position: 'relative',
          display: 'grid',
          gridTemplateColumns: '1fr 280px 1fr',
          gridTemplateRows: '1fr 280px 1fr',
          width: '100%', maxWidth: 520,
          margin: '0 auto',
          placeItems: 'center',
          rowGap: 12, columnGap: 12,
        }}>
          {/* Glow behind everything */}
          <div style={{
            gridColumn: '1 / -1', gridRow: '1 / -1',
            position: 'relative', width: '100%', height: '100%',
          }}>
            <div style={{
              position: 'absolute', inset: '20%',
              background: `radial-gradient(closest-side, ${C.violet}77, transparent 70%)`,
              filter: 'blur(60px)', pointerEvents: 'none',
            }} />
          </div>

          {/* Row 1 col 2 — Rookie */}
          <div className="vg-vp-chip" style={{ gridColumn: 2, gridRow: 1, ...chip }}>
            <div className="vg-mono" style={chipName}>ROOKIE</div>
            <div style={chipFee}>30% fees</div>
          </div>

          {/* Row 2 col 1 — Immortal */}
          <div className="vg-vp-chip" style={{ gridColumn: 1, gridRow: 2, ...chip }}>
            <div className="vg-mono" style={chipName}>IMMORTAL</div>
            <div style={chipFee}>15% fees</div>
          </div>

          {/* Row 2 col 2 — GEM (dead center) */}
          <img src="/brand/vp-gem.webp" alt="VP gem" className="vg-float-y vg-vp-gem" style={{
            gridColumn: 2, gridRow: 2,
            width: '100%', height: '100%', objectFit: 'contain',
            filter: `drop-shadow(0 30px 60px ${C.violet}99)`,
          }} />

          {/* Row 2 col 3 — Challenger */}
          <div className="vg-vp-chip" style={{ gridColumn: 3, gridRow: 2, ...chip }}>
            <div className="vg-mono" style={chipName}>CHALLENGER</div>
            <div style={chipFee}>18% fees</div>
          </div>

          {/* Row 3 col 2 — Champion */}
          <div className="vg-vp-chip" style={{ gridColumn: 2, gridRow: 3, ...chip }}>
            <div className="vg-mono" style={chipName}>CHAMPION</div>
            <div style={chipFee}>15% fees</div>
          </div>
        </div>

        <div>
          <h2 className="vg-syne" style={{
            fontSize: 40, lineHeight: 1.05, fontWeight: 800,
            letterSpacing: '-0.03em', margin: 0,
          }}>
            Level up.<br />
            <span className="vg-grad-text">Earn perks for life.</span>
          </h2>
          <p style={{ marginTop: 18, fontSize: 16, color: C.text2, lineHeight: 1.6, maxWidth: 480 }}>
            Every match, stream, and tip you send earns VP. Climb the 11 ranks
            from Rookie all the way to Immortal to collect 30 rank badges and cut
            your coin-to-gem platform commission as you rise.
          </p>
          <div style={{ marginTop: 24, display: 'flex', flexDirection: 'column', gap: 12 }}>
            {[
              ['Lower platform commission', 'Your conversion rate improves as you rank up — keep more of what you earn'],
              ['Animated rank badges',      'Show your tier in chat, on profiles, and over your stream'],
              ['Tier-only events',          'Invite-only tournaments and creator drops at higher ranks'],
              ['Faster VP gains',           'Bonus VP multipliers kick in the higher your rank'],
            ].map(([t, d], i) => (
              <div key={i} style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                <span style={{
                  width: 22, height: 22, borderRadius: 99, flexShrink: 0,
                  background: `${C.violet}33`, color: C.violet,
                  display: 'grid', placeItems: 'center', marginTop: 2,
                }}>
                  <Icon name="check" size={14} />
                </span>
                <div>
                  <div className="vg-syne" style={{ fontSize: 14, fontWeight: 700 }}>{t}</div>
                  <div style={{ fontSize: 13, color: C.text3, marginTop: 2 }}>{d}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

// Captures Android Chrome's beforeinstallprompt so we can fire it on demand
// when the user taps "Get on mobile" / "Get for Windows" rather than expecting
// them to discover Chrome's menu → Install app option themselves.
function useInstallPrompt() {
  const [deferred, setDeferred] = useState(null);
  useEffect(() => {
    const onBefore = (e) => { e.preventDefault(); setDeferred(e); };
    const onInstalled = () => setDeferred(null);
    window.addEventListener('beforeinstallprompt', onBefore);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onBefore);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);
  return deferred;
}

function detectPlatform() {
  const ua = (typeof navigator !== 'undefined' && navigator.userAgent) || '';
  const isAndroid = /android/i.test(ua);
  const isIOS = /iPad|iPhone|iPod/.test(ua) && !window.MSStream;
  const isSafari = isIOS || (/^((?!chrome|android).)*safari/i.test(ua));
  const isStandalone =
    (typeof window !== 'undefined' && window.matchMedia?.('(display-mode: standalone)').matches) ||
    (typeof navigator !== 'undefined' && navigator.standalone);
  const isWindows = /Windows/i.test(ua);
  const isDesktop = !isAndroid && !isIOS;
  return { isAndroid, isIOS, isSafari, isStandalone, isWindows, isDesktop };
}

function IosInstallModal({ onClose }) {
  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        background: 'rgba(0,0,0,0.75)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 24,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          maxWidth: 420, width: '100%',
          padding: 24, borderRadius: 16,
          background: C.surface, border: `1px solid ${C.border}`, color: C.text,
        }}
      >
        <h3 className="vg-syne" style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>Install VERGR on iPhone</h3>
        <ol style={{ marginTop: 16, paddingLeft: 18, fontSize: 14, lineHeight: 1.7, color: C.text2 }}>
          <li>Tap the <strong>Share</strong> button at the bottom of Safari (the square with the arrow).</li>
          <li>Scroll down and tap <strong>Add to Home Screen</strong>.</li>
          <li>Tap <strong>Add</strong> in the top right.</li>
        </ol>
        <p style={{ marginTop: 12, fontSize: 12, color: C.text3 }}>
          Apple doesn't let websites trigger this automatically — you have to do it from Safari's Share menu.
          If you're in Chrome on iPhone, switch to Safari first.
        </p>
        <button
          onClick={onClose}
          style={{
            marginTop: 16, width: '100%', padding: '12px 16px', borderRadius: 8,
            background: C.violet, color: '#fff', border: 'none', fontWeight: 700, cursor: 'pointer',
          }}
        >Got it</button>
      </div>
    </div>
  );
}

function AndroidInstallModal({ onClose }) {
  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        background: 'rgba(0,0,0,0.75)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 24,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          maxWidth: 440, width: '100%',
          padding: 24, borderRadius: 16,
          background: C.surface, border: `1px solid ${C.border}`, color: C.text,
        }}
      >
        <h3 className="vg-syne" style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>Installing VERGR on Android</h3>
        <p style={{ marginTop: 10, fontSize: 13, color: C.text2 }}>
          Because VERGR installs directly (not through the Play Store), Android shows a
          one-time Play Protect notice for new apps. VERGR is signed and safe. Here's the path:
        </p>
        <ol style={{ marginTop: 12, paddingLeft: 18, fontSize: 14, lineHeight: 1.7, color: C.text2 }}>
          <li>Tap <strong>Download for Android</strong> and open the downloaded file.</li>
          <li>If your browser asks, allow it to <strong>install unknown apps</strong>.</li>
          <li>If you see <strong>“Play Protect doesn't recognize this app”</strong>, tap
            <strong> More details</strong>, then <strong>Install anyway</strong>.</li>
          <li>Open VERGR. You're in.</li>
        </ol>
        <p style={{ marginTop: 12, fontSize: 12, color: C.text3 }}>
          This notice appears for every app installed outside the Play Store and goes away as more
          people install VERGR. Your device stays protected — you're only allowing this one app.
        </p>
        <button
          onClick={onClose}
          style={{
            marginTop: 16, width: '100%', padding: '12px 16px', borderRadius: 8,
            background: C.violet, color: '#fff', border: 'none', fontWeight: 700, cursor: 'pointer',
          }}
        >Got it</button>
      </div>
    </div>
  );
}

function LandingDownload() {
  const deferredPrompt = useInstallPrompt();
  const [showIosModal, setShowIosModal] = useState(false);
  const [showAndroidModal, setShowAndroidModal] = useState(false);
  const { isIOS, isAndroid, isStandalone } = detectPlatform();

  // Fires the right install path on click instead of routing to /signup.
  // Android Chrome → native install prompt. iOS Safari → modal with steps
  // (Apple has no programmatic install API). Desktop → also native prompt
  // if available, else fall back to /signup.
  const handleInstall = async (e, fallbackTo) => {
    if (isStandalone) return; // already installed
    if (deferredPrompt) {
      e.preventDefault();
      try {
        await deferredPrompt.prompt();
        await deferredPrompt.userChoice;
      } catch {/* user dismissed */}
      return;
    }
    if (isIOS) {
      e.preventDefault();
      setShowIosModal(true);
      return;
    }
    // Otherwise let the link navigate (signup flow), still better than nothing.
    void fallbackTo;
  };

  // Choose CTAs per platform so the user sees a button that matches what
  // tapping it will actually do.
  const mobileCta = isIOS
    ? 'Install on iPhone'
    : isAndroid
      ? (deferredPrompt ? 'Install now' : 'How to install')
      : 'Get on mobile';
  const cards = [
    { title: 'Web app',         body: 'Open VERGR right in your browser. Nothing to install.',                  icon: 'language',        cta: 'Open web app', to: '/signup',                  install: false },
    // Standalone desktop app: a signed NSIS installer on R2 / cdn.vergr.app
    // ($0 egress). Direct download (silent auto-updates itself thereafter).
    { title: 'Windows desktop', body: 'Native window, system notifications, and Discord-style background run.', icon: 'desktop_windows', cta: 'Download for Windows', href: 'https://cdn.vergr.app/downloads/VERGR-Setup.exe', download: 'VERGR-Setup.exe' },
    // Real native Android app: a signed APK served from R2 / cdn.vergr.app
    // ($0 egress, no Play Store). Direct download, not a router link.
    { title: 'Android app',     body: 'The real native app. Direct download, native push, full-screen. Tap then allow install from this source.', icon: 'android', cta: 'Download for Android', href: `https://cdn.vergr.app/downloads/VERGR.apk?v=${APP_VERSION}`, download: `VERGR-${APP_VERSION}.apk` },
    { title: 'iPhone',          body: 'Add VERGR to your home screen from Safari. Push notifications, full-screen viewer.', icon: 'phone_iphone', cta: 'Install on iPhone', to: '/signup?platform=mobile', install: true },
  ];
  return (
    <section className="vg-section" style={{ padding: '40px 32px 80px' }}>
      <div className="vg-cta" style={{
        maxWidth: 1280, margin: '0 auto',
        ...CTA_SURFACE, borderRadius: 24, padding: '56px 48px',
      }}>
        <div style={{ textAlign: 'center', marginBottom: 40 }}>
          <h2 className="vg-syne vg-h2" style={{
            fontSize: 48, fontWeight: 800, letterSpacing: '-0.03em',
            margin: 0,
          }}>
            Take VERGR <span className="vg-grad-text">everywhere.</span>
          </h2>
          <p style={{ marginTop: 14, fontSize: 16, color: C.text2 }}>
            One account. Web, desktop, and mobile — all in sync.
          </p>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16 }} className="vg-grid-cols-4">
          {cards.map((card) => {
            const cardStyle = {
              padding: 24, borderRadius: 16,
              background: 'var(--vg-grad-card)',
              border: `1px solid ${C.borderSoft}`,
              textDecoration: 'none', color: 'inherit',
              display: 'flex', flexDirection: 'column', gap: 12,
            };
            const inner = (
              <>
                <span style={{ color: C.violet }}><Icon name={card.icon} size={36} /></span>
                <h3 className="vg-syne" style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>{card.title}</h3>
                <p style={{ fontSize: 13, lineHeight: 1.55, color: C.text2, margin: 0, flex: 1 }}>{card.body}</p>
                <div style={{
                  marginTop: 8, padding: '10px 14px', borderRadius: 8,
                  background: 'rgba(123,111,255,0.12)',
                  border: `1px solid ${C.violet}55`,
                  color: C.text, fontSize: 13, fontWeight: 700,
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'space-between',
                }}>
                  {card.cta} <span>→</span>
                </div>
              </>
            );
            // Direct file download (the Android APK) uses a plain anchor so the
            // browser downloads the file instead of client-routing.
            if (card.download) {
              return (
                <a key={card.title} href={card.href} download={typeof card.download === 'string' ? card.download : true} className="vg-lift" style={cardStyle}>
                  {inner}
                </a>
              );
            }
            return (
              <Link
                key={card.title}
                to={card.to}
                onClick={(e) => { if (card.install) handleInstall(e, card.to); }}
                className="vg-lift"
                style={cardStyle}
              >
                {inner}
              </Link>
            );
          })}
        </div>
        <p style={{ textAlign: 'center', marginTop: 18, fontSize: 13, color: C.text3 }}>
          On Android, you'll install VERGR directly (not via the Play Store).{' '}
          <button
            type="button"
            onClick={() => setShowAndroidModal(true)}
            style={{
              background: 'none', border: 'none', padding: 0, cursor: 'pointer',
              color: C.violet, fontWeight: 700, textDecoration: 'underline', fontSize: 13,
            }}
          >See how to install &amp; get past the Play Protect notice</button>
        </p>
      </div>
      {showIosModal && <IosInstallModal onClose={() => setShowIosModal(false)} />}
      {showAndroidModal && <AndroidInstallModal onClose={() => setShowAndroidModal(false)} />}
    </section>
  );
}

function LandingCTA() {
  const { currentUser } = useAuth();
  return (
    <section className="vg-section" style={{ padding: '60px 32px 100px' }}>
      <div style={{
        maxWidth: 1100, margin: '0 auto',
        padding: '64px 56px', borderRadius: 24,
        ...CTA_SURFACE,
        textAlign: 'center',
      }} className="vg-cta">
        <h2 className="vg-syne vg-h2" style={{
          fontSize: 48, fontWeight: 800, letterSpacing: '-0.03em', margin: 0, lineHeight: 1.1,
        }}>
          Where will <span className="vg-grad-text">your run</span> begin?
        </h2>
        <p style={{ marginTop: 18, fontSize: 16, color: C.text2, maxWidth: 580, margin: '18px auto 0' }}>
          Sign up free, link your games, find your squad, and try a tournament — all in your first hour on VERGR.
        </p>
        <div style={{ marginTop: 32, display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
          <Link to={currentUser ? '/home' : '/signup'} className="vg-btn-primary" style={{ textDecoration: 'none' }}>
            {currentUser ? 'Open the app' : 'Create account'} →
          </Link>
          <Link to="/platform/help" className="vg-btn-ghost" style={{ textDecoration: 'none' }}>
            Visit Help Center
          </Link>
        </div>
      </div>
    </section>
  );
}

export function LandingScreen() {
  useSeo({
    title: 'Vergr | Connect, Stream & Compete in Tournaments',
    description: 'Connect with gamers, live stream in high quality, and compete in tournaments on Vergr. Manage your competitive squad and earn rewards with daily quests.',
    canonical: 'https://vergr.app/platform',
  });
  return (
    <MarketingShell hideBreadcrumbs>
      <LandingHero />
      <LandingStats />
      <LandingSlides />
      <LandingEconomy />
      <LandingLevels />
      <LandingDownload />
      <LandingCTA />
    </MarketingShell>
  );
}

// ═════════════════════════════════════════════════════════════════════
// Coin store (existing functionality, new shell)
// ═════════════════════════════════════════════════════════════════════

function PublicPackCard({ pack }) {
  const slug = `${pack.id}-pack`;
  return (
    <Link to="/signup" className="vg-lift" style={{
      padding: 18, borderRadius: 16, textDecoration: 'none',
      background: 'var(--vg-grad-card)',
      border: `1px solid ${C.borderSoft}`,
      display: 'flex', flexDirection: 'column', gap: 10, color: 'inherit',
    }}>
      <div style={{ height: 110, display: 'grid', placeItems: 'center' }}>
        <img
          src={`/brand/packs/${slug}.webp`}
          alt={pack.name}
          style={{ maxHeight: 100, maxWidth: '90%', objectFit: 'contain', filter: `drop-shadow(0 6px 16px ${C.gold}66)` }}
          onError={(e) => { e.currentTarget.style.display = 'none'; }}
        />
      </div>
      <div className="vg-syne" style={{ fontSize: 16, fontWeight: 700 }}>{pack.name}</div>
      <div className="vg-mono" style={{ fontSize: 13, color: C.gold }}>
        {pack.coins.toLocaleString()} VC{pack.vpBonus ? ` · +${pack.vpBonus.toLocaleString()} VP` : ''}
      </div>
      <div style={{ marginTop: 'auto', display: 'flex', alignItems: 'baseline', gap: 8 }}>
        <span className="vg-mono" style={{ fontSize: 22, fontWeight: 800, color: C.text }}>
          €{pack.priceEUR.toFixed(2)}
        </span>
      </div>
    </Link>
  );
}

export function StoreScreen() {
  useSeo({
    title: 'Shop — Buy VC Coins | VERGR',
    description: 'Buy VC Coins to tip streamers, enter tournaments, subscribe to squads, and boost your reach. Eight pack sizes from €0.99 to €224.99. Pay with cryptocurrency or card.',
    canonical: 'https://vergr.app/platform/store',
  });
  return (
    <MarketingShell>
      <PageHero
        title="Shop — Buy VC Coins"
        subtitle="VC Coins power tips, memberships, tournament entries, and post boosts. Bigger packs unlock better per-coin value, and the top tiers come with VP bonuses."
        accent="gold"
      />
      <section className="vg-section" style={{ padding: '20px 32px 60px' }}>
        <div style={{ maxWidth: 1280, margin: '0 auto' }}>
          <div style={{
            display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 16,
          }}>
            {COIN_PACKS.map(pack => <PublicPackCard key={pack.id} pack={pack} />)}
          </div>
          <div style={{
            marginTop: 24, padding: 20, borderRadius: 16,
            background: `linear-gradient(90deg, rgba(123,111,255,0.10), rgba(180, 79, 255,0.04))`,
            border: `1px solid ${C.violet}55`,
            display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap',
          }}>
            <span style={{ color: C.violet }}><Icon name="bolt" size={28} /></span>
            <div style={{ flex: 1, minWidth: 240 }}>
              <div className="vg-syne" style={{ fontSize: 16, fontWeight: 800, color: C.text }}>
                Coins fuel everything
              </div>
              <div style={{ fontSize: 13, color: C.text2, marginTop: 4 }}>
                Tip creators, enter tournaments, subscribe to squads, boost your reach. Pick a pack to get started.
              </div>
            </div>
            <Link to="/signup" className="vg-btn-primary" style={{ textDecoration: 'none' }}>
              Create account →
            </Link>
          </div>
        </div>
      </section>
    </MarketingShell>
  );
}

// ═════════════════════════════════════════════════════════════════════
// Download (real platforms — no "coming soon")
// ═════════════════════════════════════════════════════════════════════

export function DownloadScreen() {
  const deferredPrompt = useInstallPrompt();
  const [showIosModal, setShowIosModal] = useState(false);
  const { isIOS, isAndroid, isStandalone } = detectPlatform();

  const handleInstall = async (e, target) => {
    if (isStandalone) return;
    if (target === 'ios' || isIOS) { e.preventDefault(); setShowIosModal(true); return; }
    if (deferredPrompt) {
      e.preventDefault();
      try {
        await deferredPrompt.prompt();
        await deferredPrompt.userChoice;
      } catch {/* dismissed */}
    }
    // else fall through to /signup
  };

  const androidCta = isAndroid
    ? (deferredPrompt ? 'Install on Android' : 'How to install')
    : 'Get for Android';
  const cards = [
    { title: 'Web app',         body: 'Use VERGR right in your browser — no install needed.',                                       icon: 'language',        cta: 'Open web app',    to: '/signup',                  install: false                       },
    // Standalone desktop app: signed NSIS installer on cdn.vergr.app, direct
    // download (silent auto-updates itself afterward).
    { title: 'Windows desktop', body: 'Native window, system notifications, runs in the background. Best for streamers and mods.', icon: 'desktop_windows', cta: 'Download for Windows', href: 'https://cdn.vergr.app/downloads/VERGR-Setup.exe', download: 'VERGR-Setup.exe' },
    { title: 'iOS',             body: 'Add VERGR to your iPhone home screen. Push alerts, full-screen viewer, picture-in-picture.', icon: 'phone_iphone',    cta: 'Install on iPhone', to: '/signup?platform=ios',   install: true,  target: 'ios'        },
    { title: 'Android',         body: 'Install on Android via your browser. Background playback, notifications, fast wallet flows.', icon: 'android',        cta: androidCta,        to: '/signup?platform=android', install: true,  target: 'android'    },
  ];
  return (
    <MarketingShell>
      <PageHero
        title="One account. Every platform."
        subtitle="VERGR runs on the web, your desktop, and your phone. Start anywhere — your wallet, squads, and notifications follow you."
        accent="cyan"
      />
      <section className="vg-section" style={{ padding: '20px 32px 80px' }}>
        <div style={{ maxWidth: 1280, margin: '0 auto' }}>
          <div style={{
            display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 16,
          }}>
            {cards.map((card) => {
              const cardStyle = {
                padding: 24, borderRadius: 16, textDecoration: 'none', color: 'inherit',
                background: 'var(--vg-grad-card)',
                border: `1px solid ${C.borderSoft}`,
                display: 'flex', flexDirection: 'column', gap: 12,
              };
              const inner = (
                <>
                  <span style={{ color: C.violet }}><Icon name={card.icon} size={36} /></span>
                  <h3 className="vg-syne" style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>{card.title}</h3>
                  <p style={{ fontSize: 13, lineHeight: 1.55, color: C.text2, margin: 0, flex: 1 }}>{card.body}</p>
                  <div style={{
                    marginTop: 8, padding: '10px 14px', borderRadius: 8,
                    background: 'rgba(123,111,255,0.12)',
                    border: `1px solid ${C.violet}55`,
                    color: C.text, fontSize: 13, fontWeight: 700,
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  }}>
                    {card.cta} <span>→</span>
                  </div>
                </>
              );
              // Direct file download (the desktop installer) uses a plain anchor
              // so the browser downloads it instead of client-routing.
              if (card.download) {
                return (
                  <a key={card.title} href={card.href} download={typeof card.download === 'string' ? card.download : true} className="vg-lift" style={cardStyle}>
                    {inner}
                  </a>
                );
              }
              return (
                <Link
                  key={card.title}
                  to={card.to}
                  onClick={(e) => { if (card.install) handleInstall(e, card.target); }}
                  className="vg-lift"
                  style={cardStyle}
                >
                  {inner}
                </Link>
              );
            })}
          </div>
          <p style={{ marginTop: 24, fontSize: 12, color: C.text3, textAlign: 'center' }}>
            Tap the card for your device. Android/desktop fire the native install prompt; iPhone gets a quick step-by-step.
          </p>
        </div>
      </section>
      {showIosModal && <IosInstallModal onClose={() => setShowIosModal(false)} />}
    </MarketingShell>
  );
}

// ═════════════════════════════════════════════════════════════════════
// Content primitives used by Phase 2 info pages
// ═════════════════════════════════════════════════════════════════════

export function Section({ children, bordered }) {
  return (
    <section className="vg-section" style={{
      padding: '20px 32px 60px',
      borderTop: bordered ? `1px solid ${C.borderSoft}` : 'none',
    }}>
      <div style={{ maxWidth: 1080, margin: '0 auto' }}>{children}</div>
    </section>
  );
}

export function H2({ children }) {
  return (
    <h2 className="vg-syne vg-h2" style={{
      fontSize: 32, fontWeight: 800, letterSpacing: '-0.02em',
      margin: '0 0 16px', lineHeight: 1.2,
    }}>{children}</h2>
  );
}

export function P({ children, dim, max }) {
  return (
    <p style={{
      fontSize: 15, lineHeight: 1.7,
      color: dim ? C.text3 : C.text2,
      maxWidth: max || 760, margin: '0 0 12px',
    }}>{children}</p>
  );
}

// Bullet row with optional Material-Symbols icon, title, body.
function Bullet({ icon, title, body, color = C.violet }) {
  return (
    <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start', padding: '12px 0' }}>
      <span style={{
        width: 36, height: 36, borderRadius: 10, flexShrink: 0,
        background: `${color}1f`, color,
        display: 'grid', placeItems: 'center',
      }}>
        <Icon name={icon} size={20} />
      </span>
      <div style={{ minWidth: 0 }}>
        <div className="vg-syne" style={{ fontSize: 15, fontWeight: 700, color: C.text }}>{title}</div>
        <div style={{ fontSize: 13, color: C.text2, marginTop: 4, lineHeight: 1.6 }}>{body}</div>
      </div>
    </div>
  );
}

// Tile card used in grids — icon header + title + body + optional CTA.
export function Tile({ icon, title, body, accent = C.violet, to, cta }) {
  const inner = (
    <>
      <span style={{
        width: 40, height: 40, borderRadius: 10,
        background: `${accent}1f`, color: accent,
        display: 'grid', placeItems: 'center',
      }}>
        <Icon name={icon} size={22} />
      </span>
      <h3 className="vg-syne" style={{ fontSize: 17, fontWeight: 700, margin: 0 }}>{title}</h3>
      <p style={{ fontSize: 13, lineHeight: 1.6, color: C.text2, margin: 0, flex: 1 }}>{body}</p>
      {cta && (
        <span style={{
          marginTop: 6, fontSize: 12, fontWeight: 700,
          color: accent, display: 'inline-flex', alignItems: 'center', gap: 6,
        }}>{cta} <Icon name="arrow_forward" size={14} /></span>
      )}
    </>
  );
  const style = {
    padding: 20, borderRadius: 14,
    background: 'var(--vg-grad-card)',
    border: `1px solid ${C.borderSoft}`,
    display: 'flex', flexDirection: 'column', gap: 12,
    height: '100%', textDecoration: 'none', color: 'inherit',
  };
  return to
    ? <Link to={to} className="vg-lift" style={style}>{inner}</Link>
    : <div className="vg-lift" style={style}>{inner}</div>;
}

export function Grid({ children, cols = 3, min = 240 }) {
  return (
    <div style={{
      display: 'grid', gap: 16,
      gridTemplateColumns: `repeat(auto-fit, minmax(${min}px, 1fr))`,
    }} className="vg-card-grid">{children}</div>
  );
}

// ═════════════════════════════════════════════════════════════════════
// Stub pages still pending phases 3-5
// ═════════════════════════════════════════════════════════════════════

// ═════════════════════════════════════════════════════════════════════
// Help Center — index, category, and article screens.
// Content lives in ./help/helpContent.jsx. Only articles with a body are
// PUBLISHED (live route + indexable); titles without a body show as
// "Coming soon" and are never routed to a thin page.
// ═════════════════════════════════════════════════════════════════════

// Horizontal scroller that also responds to a vertical mouse wheel on desktop.
function HScroller({ children, style }) {
  const ref = useRef(null);
  const [atStart, setAtStart] = useState(true);
  const [atEnd, setAtEnd] = useState(false);
  const [overflowing, setOverflowing] = useState(false);

  // Recompute which edges are reachable so we can show/hide arrows + fades.
  const sync = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const max = el.scrollWidth - el.clientWidth;
    setOverflowing(max > 2);
    setAtStart(el.scrollLeft <= 1);
    setAtEnd(el.scrollLeft >= max - 1);
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    sync();

    // Mouse wheel → horizontal (trackpads send deltaX directly and are skipped).
    const onWheel = (e) => {
      if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
      if (el.scrollWidth <= el.clientWidth) return;
      e.preventDefault();
      el.scrollLeft += e.deltaY;
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    el.addEventListener('scroll', sync, { passive: true });

    // Click-hold drag to scroll (mouse only; touch uses native momentum scroll).
    //
    // This suppresses the click that ends a real drag, so it sits directly in
    // front of every card link — get it wrong and the cards simply stop
    // navigating. Two things it must not do:
    //
    //  1. Treat an ordinary click as a drag. A press-and-release always drifts
    //     a couple of pixels (more on a trackpad), so the old 3px threshold
    //     tripped on genuine clicks and ate them. 8px is the usual drag slop.
    //  2. Leave `moved` set. A drag that releases OUTSIDE the scroller fires no
    //     click on `el`, so the flag survived and swallowed the NEXT real click
    //     instead. The reset is deferred a tick: the click event dispatches
    //     synchronously before a 0ms timeout, so suppression still works for
    //     the drag that just ended but can never leak past it.
    const DRAG_SLOP = 8;
    let dragging = false;
    let startX = 0;
    let startScroll = 0;
    let moved = false;
    let resetTimer = null;
    const onPointerDown = (e) => {
      if (e.pointerType !== 'mouse' || e.button !== 0) return;
      // Nothing to scroll means nothing to suppress.
      if (el.scrollWidth <= el.clientWidth) return;
      if (resetTimer) { clearTimeout(resetTimer); resetTimer = null; }
      dragging = true;
      moved = false;
      startX = e.clientX;
      startScroll = el.scrollLeft;
    };
    const onPointerMove = (e) => {
      if (!dragging) return;
      const dx = e.clientX - startX;
      if (Math.abs(dx) > DRAG_SLOP) {
        moved = true;
        // Only claim the gesture once it's genuinely a drag, so a plain click
        // never picks up the grabbing cursor.
        el.classList.add('vg-dragging');
      }
      if (moved) el.scrollLeft = startScroll - dx;
    };
    const endDrag = () => {
      if (!dragging) return;
      dragging = false;
      el.classList.remove('vg-dragging');
      if (moved) resetTimer = setTimeout(() => { moved = false; resetTimer = null; }, 0);
    };
    // Swallow the click that follows a real drag so cards don't navigate.
    const onClickCapture = (e) => {
      if (moved) { e.preventDefault(); e.stopPropagation(); }
    };
    el.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', endDrag);
    el.addEventListener('click', onClickCapture, true);

    const ro = new ResizeObserver(sync);
    ro.observe(el);
    Array.from(el.children).forEach((c) => ro.observe(c));

    return () => {
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('scroll', sync);
      el.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', endDrag);
      el.removeEventListener('click', onClickCapture, true);
      if (resetTimer) clearTimeout(resetTimer);
      ro.disconnect();
    };
  }, [sync, children]);

  const nudge = (dir) => {
    const el = ref.current;
    if (!el) return;
    const amount = Math.max(el.clientWidth * 0.8, 264);
    el.scrollBy({ left: dir * amount, behavior: 'smooth' });
  };

  return (
    <div className="vg-hscroll-wrap">
      <div ref={ref} className="vg-hscroll" style={style}>{children}</div>
      <div className="vg-hscroll-fade vg-left" hidden={!overflowing || atStart} aria-hidden="true" />
      <div className="vg-hscroll-fade vg-right" hidden={!overflowing || atEnd} aria-hidden="true" />
      <button
        type="button" className="vg-hscroll-arrow vg-left" aria-label="Scroll left"
        hidden={!overflowing || atStart} onClick={() => nudge(-1)}
      ><Icon name="chevron_left" size={22} /></button>
      <button
        type="button" className="vg-hscroll-arrow vg-right" aria-label="Scroll right"
        hidden={!overflowing || atEnd} onClick={() => nudge(1)}
      ><Icon name="chevron_right" size={22} /></button>
    </div>
  );
}

function HelpSearchBox({ value, onChange }) {
  return (
    <div style={{ maxWidth: 680, margin: '0 auto', position: 'relative' }}>
      <span style={{
        position: 'absolute', left: 16, top: '50%', transform: 'translateY(-50%)',
        color: C.text3, pointerEvents: 'none',
      }}><Icon name="search" size={20} /></span>
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Search help articles…"
        aria-label="Search help articles"
        style={{
          width: '100%', padding: '14px 16px 14px 46px',
          fontSize: 15, color: C.text,
          background: C.surface, border: `1px solid ${C.border}`,
          borderRadius: 12, outline: 'none',
        }}
        onFocus={(e) => { e.currentTarget.style.borderColor = C.cyan + '88'; }}
        onBlur={(e) => { e.currentTarget.style.borderColor = C.border; }}
      />
    </div>
  );
}

function ComingSoonChip() {
  return (
    <span className="vg-mono" style={{
      fontSize: 10, fontWeight: 700, letterSpacing: '0.06em',
      color: C.text3, border: `1px solid ${C.borderSoft}`,
      borderRadius: 999, padding: '2px 8px', textTransform: 'uppercase', whiteSpace: 'nowrap',
    }}>Coming soon</span>
  );
}

// One article row in a list (search results / category page).
function ArticleRow({ article, showCategory }) {
  const cat = HELP_CATEGORY_BY_ID[article.category];
  const inner = (
    <div className="vg-lift" style={{
      display: 'flex', alignItems: 'center', gap: 14,
      padding: '14px 18px', borderRadius: 12,
      border: `1px solid ${C.borderSoft}`,
      background: 'rgba(255,255,255,0.02)',
      opacity: article.published ? 1 : 0.62,
    }}>
      <span style={{
        width: 34, height: 34, borderRadius: 9, flexShrink: 0,
        background: `${C.violet}1f`, color: C.violet,
        display: 'grid', placeItems: 'center',
      }}><Icon name={cat?.icon || 'help'} size={18} /></span>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div className="vg-syne" style={{ fontSize: 15, fontWeight: 700, color: C.text }}>{article.title}</div>
        {showCategory && (
          <div style={{ fontSize: 12, color: C.text3, marginTop: 2 }}>{cat?.label}</div>
        )}
      </div>
      {article.published
        ? <Icon name="arrow_forward" size={16} className="vg-arrow" />
        : <ComingSoonChip />}
    </div>
  );
  return article.published
    ? <Link to={`/platform/help/${article.slug}`} style={{ textDecoration: 'none' }}>{inner}</Link>
    : <div>{inner}</div>;
}

export function HelpScreen() {
  const [q, setQ] = useState('');
  const query = q.trim();
  const results = useMemo(() => (query ? searchArticles(query) : []), [query]);
  const popular = useMemo(() => {
    const core = HELP_ARTICLES.filter(a => a.tier === 'core');
    return [...core.filter(a => a.published), ...core.filter(a => !a.published)].slice(0, 12);
  }, []);

  useSeo({
    title: 'Help Center — guides, how-tos, and FAQ | VERGR',
    description: 'Search the VERGR help center. How to go live, earn, run tournaments, withdraw, join squads, and more. Plain answers to how VERGR works.',
    canonical: 'https://vergr.app/platform/help',
  });

  return (
    <MarketingShell>
      <JsonLd data={[
        webPageSchema({ name: 'VERGR Help Center', description: 'Guides, how-tos, and FAQ for VERGR.', url: '/platform/help' }),
        faqSchema(POPULAR_FAQS),
        breadcrumbSchema([{ name: 'Home', path: '/platform' }, { name: 'Help Center', path: '/platform/help' }]),
      ]} />
      <PageHero
        title="Help Center"
        subtitle="Search for an answer, or browse by topic. Everything you need to play, stream, earn, and cash out on VERGR."
        accent="cyan"
      />

      <section className="vg-section" style={{ padding: '4px 32px 32px' }}>
        <HelpSearchBox value={q} onChange={setQ} />
      </section>

      {query ? (
        <Section>
          <H2>{results.length} result{results.length === 1 ? '' : 's'} for “{query}”</H2>
          {results.length === 0 ? (
            <P dim>No articles matched. Try different words, or write to <a href="mailto:support@vergr.app" style={{ color: C.cyan }}>support@vergr.app</a>.</P>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 8 }}>
              {results.map(a => <ArticleRow key={a.slug} article={a} showCategory />)}
            </div>
          )}
        </Section>
      ) : (
        <>
          <Section>
            <H2>Popular guides</H2>
            <HScroller style={{ marginTop: 4 }}>
              {popular.map(a => {
                const c = HELP_CATEGORY_BY_ID[a.category];
                const card = (
                  <div className="vg-lift" style={{
                    width: 250, height: '100%', padding: 18, borderRadius: 14,
                    border: `1px solid ${C.borderSoft}`, background: 'var(--vg-grad-card)',
                    display: 'flex', flexDirection: 'column', gap: 10,
                    opacity: a.published ? 1 : 0.6,
                  }}>
                    <span style={{
                      width: 34, height: 34, borderRadius: 9,
                      background: `${C.violet}1f`, color: C.violet, display: 'grid', placeItems: 'center',
                    }}><Icon name={c?.icon || 'help'} size={18} /></span>
                    <div className="vg-syne" style={{ fontSize: 14.5, fontWeight: 700, color: C.text, lineHeight: 1.3 }}>{a.title}</div>
                    <div style={{ marginTop: 'auto' }}>
                      {a.published
                        ? <span className="vg-mono" style={{ fontSize: 11, color: C.cyan, display: 'inline-flex', alignItems: 'center', gap: 5 }}>Read <Icon name="arrow_forward" size={13} /></span>
                        : <ComingSoonChip />}
                    </div>
                  </div>
                );
                return a.published
                  ? <Link key={a.slug} to={`/platform/help/${a.slug}`} style={{ textDecoration: 'none', display: 'flex' }}>{card}</Link>
                  : <div key={a.slug} style={{ display: 'flex' }}>{card}</div>;
              })}
            </HScroller>
          </Section>
          <Section bordered>
            <H2>Browse by topic</H2>
            <Grid cols={3} min={260}>
              {HELP_CATEGORIES.map(cat => {
                const count = articlesInCategory(cat.id).length;
                return (
                  <Link key={cat.id} to={`/platform/help/category/${cat.id}`} className="vg-lift" style={{
                    textDecoration: 'none', color: 'inherit',
                    padding: 20, borderRadius: 14,
                    border: `1px solid ${C.borderSoft}`,
                    background: 'var(--vg-grad-card)',
                    display: 'flex', flexDirection: 'column', gap: 10,
                  }}>
                    <span style={{
                      width: 40, height: 40, borderRadius: 10,
                      background: `${C.cyan}1f`, color: C.cyan,
                      display: 'grid', placeItems: 'center',
                    }}><Icon name={cat.icon} size={22} /></span>
                    <div>
                      <div className="vg-syne" style={{ fontSize: 16, fontWeight: 800, color: C.text }}>{cat.label}</div>
                      <div style={{ marginTop: 4, fontSize: 13, color: C.text2, lineHeight: 1.55 }}>{cat.blurb}</div>
                    </div>
                    <div className="vg-mono" style={{ marginTop: 'auto', fontSize: 11, color: C.text3 }}>
                      {count} article{count === 1 ? '' : 's'}
                    </div>
                  </Link>
                );
              })}
            </Grid>
          </Section>

          <Section bordered>
            <H2>Popular questions</H2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16, marginTop: 8 }}>
              {POPULAR_FAQS.map(([qq, aa]) => (
                <details key={qq} style={{
                  padding: '14px 18px', borderRadius: 12,
                  border: `1px solid ${C.borderSoft}`,
                  background: 'rgba(255,255,255,0.02)',
                }}>
                  <summary className="vg-syne" style={{
                    cursor: 'pointer', fontWeight: 700, fontSize: 15, color: C.text,
                    listStyle: 'none', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  }}>
                    <span>{qq}</span>
                    <Icon name="expand_more" size={20} className="vg-faq-chev" />
                  </summary>
                  <p style={{ marginTop: 10, fontSize: 14, color: C.text2, lineHeight: 1.7 }}>{aa}</p>
                </details>
              ))}
            </div>
          </Section>

          <Section bordered>
            <div style={{
              padding: 22, borderRadius: 14,
              background: `linear-gradient(90deg, ${C.cyan}11, transparent)`,
              border: `1px solid ${C.cyan}44`,
            }}>
              <div className="vg-syne" style={{ fontSize: 18, fontWeight: 800, color: C.cyan }}>Still need help?</div>
              <p style={{ marginTop: 6, fontSize: 14, color: C.text2 }}>
                Write to <a href="mailto:support@vergr.app" style={{ color: C.cyan }}>support@vergr.app</a> or visit the{' '}
                <Link to="/platform/contact" style={{ color: C.cyan }}>Contact</Link> page.
              </p>
            </div>
          </Section>
        </>
      )}
    </MarketingShell>
  );
}

export function HelpCategoryScreen() {
  const { catId } = useParams();
  const cat = HELP_CATEGORY_BY_ID[catId];
  const articles = cat ? articlesInCategory(catId) : [];

  useSeo({
    title: cat ? `${cat.label} — Help Center | VERGR` : 'Help Center | VERGR',
    description: cat ? cat.blurb : 'VERGR help center.',
    canonical: `https://vergr.app/platform/help/category/${catId}`,
  });
  // A category with no published articles yet should not be indexed as a thin page.
  useRobots(cat ? !articles.some(a => a.published) : true);

  if (!cat) {
    return (
      <MarketingShell>
        <PageHero title="Topic not found" subtitle="That help topic does not exist." accent="cyan" />
        <Section>
          <Link to="/platform/help" className="vg-btn-primary" style={{ textDecoration: 'none' }}>Back to Help Center</Link>
        </Section>
      </MarketingShell>
    );
  }

  return (
    <MarketingShell hideBreadcrumbs>
      <JsonLd data={breadcrumbSchema([
        { name: 'Home', path: '/platform' },
        { name: 'Help Center', path: '/platform/help' },
        { name: cat.label, path: `/platform/help/category/${catId}` },
      ])} />
      <section className="vg-section" style={{ padding: '24px 32px 0' }}>
        <nav aria-label="Breadcrumb" style={{
          maxWidth: 1080, margin: '0 auto',
          fontSize: 13, color: C.text3, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center',
        }}>
          <Link to="/platform/help" className="vg-link" style={{ textDecoration: 'none' }}>Help Center</Link>
          <span style={{ opacity: 0.5 }}>›</span>
          <span style={{ color: C.text2 }}>{cat.label}</span>
        </nav>
      </section>
      <PageHero title={cat.label} subtitle={cat.blurb} accent="cyan" />
      <Section>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {articles.map(a => <ArticleRow key={a.slug} article={a} />)}
        </div>
      </Section>
      <Section bordered>
        <Link to="/platform/help" className="vg-link" style={{ textDecoration: 'none', fontSize: 14 }}>
          ‹ All topics
        </Link>
      </Section>
    </MarketingShell>
  );
}

// Renders one article body block.
function HelpBlock({ block }) {
  if (block.h2 != null) {
    return (
      <h2 id={slugify(block.h2)} className="vg-syne" style={{
        fontSize: 23, fontWeight: 800, letterSpacing: '-0.01em',
        margin: '34px 0 12px', lineHeight: 1.25, color: C.text,
      }}>{block.h2}</h2>
    );
  }
  if (block.p != null) {
    return <p style={{ fontSize: 16, lineHeight: 1.75, color: C.text2, margin: '0 0 14px' }}>{block.p}</p>;
  }
  if (block.note != null) {
    return (
      <div style={{
        margin: '18px 0', padding: '14px 16px 14px 16px', borderRadius: 12,
        background: `linear-gradient(90deg, ${C.cyan}12, transparent)`,
        borderLeft: `3px solid ${C.cyan}`,
        display: 'flex', gap: 12, alignItems: 'flex-start',
      }}>
        <span style={{ color: C.cyan, flexShrink: 0, marginTop: 1 }}><Icon name="lightbulb" size={18} /></span>
        <span style={{ fontSize: 14.5, color: C.text2, lineHeight: 1.65 }}>{block.note}</span>
      </div>
    );
  }
  if (Array.isArray(block.list)) {
    return (
      <ul style={{ margin: '10px 0 18px', paddingLeft: 0, listStyle: 'none' }}>
        {block.list.map((it, i) => (
          <li key={i} style={{
            display: 'flex', gap: 12, alignItems: 'flex-start',
            marginTop: i === 0 ? 0 : 10, fontSize: 16, lineHeight: 1.7, color: C.text2,
          }}>
            <span style={{ color: C.cyan, flexShrink: 0, marginTop: 3 }}><Icon name="check_circle" size={16} /></span>
            <span>{it}</span>
          </li>
        ))}
      </ul>
    );
  }
  if (Array.isArray(block.steps)) {
    return (
      <ol style={{ margin: '12px 0 20px', padding: 0, listStyle: 'none', counterReset: 'vgstep' }}>
        {block.steps.map((it, i) => (
          <li key={i} className="vg-step" style={{
            display: 'flex', gap: 14, alignItems: 'flex-start',
            padding: '12px 0', borderTop: i === 0 ? 'none' : `1px solid ${C.borderSoft}`,
          }}>
            <span className="vg-mono" style={{
              flexShrink: 0, width: 28, height: 28, borderRadius: 8,
              background: `${C.violet}22`, color: C.pink,
              display: 'grid', placeItems: 'center', fontSize: 13, fontWeight: 700,
            }}>{i + 1}</span>
            <span style={{ fontSize: 16, lineHeight: 1.7, color: C.text2, paddingTop: 3 }}>
              {typeof it === 'string' ? it : it.text}
            </span>
          </li>
        ))}
      </ol>
    );
  }
  if (block.cta) {
    const links = Array.isArray(block.cta) ? block.cta : [block.cta];
    return (
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', margin: '4px 0 18px' }}>
        {links.map(l => (
          <Link key={l.to} to={l.to} className="vg-link vg-lift" style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            fontSize: 13.5, fontWeight: 600, textDecoration: 'none',
            padding: '8px 14px', borderRadius: 999,
            border: `1px solid ${C.borderSoft}`, background: 'rgba(255,255,255,0.02)',
          }}>{l.label} <Icon name="arrow_forward" size={14} /></Link>
        ))}
      </div>
    );
  }
  if (Array.isArray(block.faq)) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, margin: '16px 0' }}>
        {block.faq.map(([qq, aa]) => (
          <details key={qq} style={{
            padding: '14px 16px', borderRadius: 12,
            border: `1px solid ${C.borderSoft}`, background: 'rgba(255,255,255,0.02)',
          }}>
            <summary className="vg-syne" style={{
              cursor: 'pointer', fontWeight: 700, fontSize: 15, color: C.text,
              listStyle: 'none', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12,
            }}>
              <span>{qq}</span>
              <Icon name="expand_more" size={18} className="vg-faq-chev" />
            </summary>
            <p style={{ marginTop: 10, fontSize: 14.5, color: C.text2, lineHeight: 1.7 }}>{aa}</p>
          </details>
        ))}
      </div>
    );
  }
  return null;
}

// Helpful / not-helpful widget (local only, no backend write).
function HelpFeedback() {
  const [v, setV] = useState(null);
  return (
    <div style={{
      marginTop: 36, padding: '18px 20px', borderRadius: 14,
      border: `1px solid ${C.borderSoft}`, background: 'rgba(255,255,255,0.02)',
      textAlign: 'center',
    }}>
      {v == null ? (
        <>
          <div className="vg-syne" style={{ fontSize: 15, fontWeight: 700, color: C.text }}>Was this helpful?</div>
          <div style={{ display: 'flex', gap: 10, justifyContent: 'center', marginTop: 12 }}>
            <button type="button" onClick={() => setV('yes')} className="vg-btn-ghost" style={{ padding: '10px 20px' }}>
              <Icon name="thumb_up" size={16} /> Yes
            </button>
            <button type="button" onClick={() => setV('no')} className="vg-btn-ghost" style={{ padding: '10px 20px' }}>
              <Icon name="thumb_down" size={16} /> No
            </button>
          </div>
        </>
      ) : (
        <div style={{ fontSize: 14.5, color: C.text2 }}>
          {v === 'yes'
            ? 'Glad it helped. Thanks for the feedback.'
            : <>Sorry this missed the mark. Tell us what you needed at <a href="mailto:support@vergr.app" style={{ color: C.cyan }}>support@vergr.app</a>.</>}
        </div>
      )}
    </div>
  );
}

export function HelpArticleScreen() {
  const { slug } = useParams();
  const article = HELP_ARTICLE_BY_SLUG[slug];
  const published = !!(article && article.published);
  const cat = article ? HELP_CATEGORY_BY_ID[article.category] : null;

  useSeo({
    title: article ? `${article.title} | VERGR Help` : 'Help article | VERGR',
    description: published ? article.summary : 'This VERGR help guide is being written.',
    canonical: article ? `https://vergr.app/platform/help/${article.slug}` : 'https://vergr.app/platform/help',
  });
  // Only published articles are indexable. Coming-soon + unknown slugs are noindex.
  useRobots(!published);

  // Unknown slug or not yet written: graceful in-shell state, never the app 404.
  if (!published) {
    return (
      <MarketingShell hideBreadcrumbs>
        <PageHero
          title={article ? article.title : 'Guide coming soon'}
          subtitle={article ? 'We are still writing this one. In the meantime, browse the topic or contact support.' : 'That help article does not exist yet.'}
          accent="cyan"
        />
        <Section>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            {cat && (
              <Link to={`/platform/help/category/${cat.id}`} className="vg-btn-ghost" style={{ textDecoration: 'none' }}>
                Browse {cat.label}
              </Link>
            )}
            <Link to="/platform/help" className="vg-btn-primary" style={{ textDecoration: 'none' }}>Help Center</Link>
            <a href="mailto:support@vergr.app" className="vg-btn-ghost" style={{ textDecoration: 'none' }}>Contact support</a>
          </div>
        </Section>
      </MarketingShell>
    );
  }

  const related = articlesInCategory(article.category).filter(a => a.slug !== article.slug && a.published).slice(0, 6);
  const hasFaq = article.body.some(b => Array.isArray(b.faq));
  const stepBlock = article.body.find(b => Array.isArray(b.steps));

  const schema = [
    articleSchema({
      headline: article.title,
      description: article.summary,
      url: `/platform/help/${article.slug}`,
      datePublished: article.updated,
    }),
    breadcrumbSchema([
      { name: 'Home', path: '/platform' },
      { name: 'Help Center', path: '/platform/help' },
      ...(cat ? [{ name: cat.label, path: `/platform/help/category/${cat.id}` }] : []),
      { name: article.title, path: `/platform/help/${article.slug}` },
    ]),
  ];
  if (hasFaq) {
    const allFaq = article.body.filter(b => Array.isArray(b.faq)).flatMap(b => b.faq);
    schema.push(faqSchema(allFaq));
  }
  if (stepBlock) {
    schema.push(howToSchema({ name: article.title, description: article.summary, steps: stepBlock.steps }));
  }

  const toc = article.body.filter(b => b.h2 != null).map(b => ({ id: slugify(b.h2), label: b.h2 }));

  const glass = {
    background: 'rgba(7,8,13,0.62)',
    backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)',
    border: `1px solid ${C.borderSoft}`, borderRadius: 18,
    boxShadow: '0 24px 60px -28px rgba(0,0,0,0.8)',
  };

  return (
    <MarketingShell hideBreadcrumbs>
      <JsonLd data={schema} />

      <section className="vg-section" style={{ padding: '24px 32px 64px' }}>
        <div style={{ maxWidth: 1080, margin: '0 auto' }}>
          {/* Single breadcrumb (shell breadcrumb is hidden to avoid a duplicate) */}
          <nav aria-label="Breadcrumb" style={{
            fontSize: 13, color: C.text3, display: 'flex', gap: 8, flexWrap: 'wrap',
            alignItems: 'center', marginBottom: 16,
          }}>
            <Link to="/platform/help" className="vg-link" style={{ textDecoration: 'none' }}>Help Center</Link>
            {cat && (
              <>
                <span style={{ opacity: 0.5 }}>›</span>
                <Link to={`/platform/help/category/${cat.id}`} className="vg-link" style={{ textDecoration: 'none' }}>{cat.label}</Link>
              </>
            )}
          </nav>

          <div className={toc.length > 0 ? 'vg-help-grid' : ''}>
            {/* Reading column — glass card so it stays legible over the busy background */}
            <article className="vg-help-art" style={{
              minWidth: 0, maxWidth: toc.length > 0 ? 'none' : 820,
              padding: 'clamp(20px, 4vw, 40px)', ...glass,
            }}>
              <h1 className="vg-syne" style={{
                fontSize: 'clamp(27px, 4.5vw, 40px)', margin: 0,
                fontWeight: 800, letterSpacing: '-0.02em', color: C.text, lineHeight: 1.18,
              }}>{article.title}</h1>
              {article.summary && (
                <p style={{ marginTop: 14, fontSize: 17, lineHeight: 1.6, color: C.text2 }}>{article.summary}</p>
              )}
              {article.updated && (
                <div className="vg-mono" style={{ marginTop: 14, fontSize: 12, color: C.text3 }}>Updated {fmtHelpDate(article.updated)}</div>
              )}

              <div style={{ marginTop: 22, paddingTop: 22, borderTop: `1px solid ${C.borderSoft}` }}>
                {article.body.map((block, i) => <HelpBlock key={i} block={block} />)}
              </div>

              <HelpFeedback />

              {related.length > 0 && (
                <div style={{ marginTop: 36, paddingTop: 26, borderTop: `1px solid ${C.borderSoft}` }}>
                  <div className="vg-syne" style={{ fontSize: 18, fontWeight: 800, color: C.text, marginBottom: 12 }}>Related articles</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {related.map(a => <ArticleRow key={a.slug} article={a} />)}
                  </div>
                </div>
              )}

              <div style={{
                marginTop: 28, padding: '16px 18px', borderRadius: 12,
                border: `1px solid ${C.borderSoft}`, background: 'rgba(255,255,255,0.03)',
                display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap',
              }}>
                <span style={{ fontSize: 14, color: C.text2 }}>Still stuck? We read every message.</span>
                <a href="mailto:support@vergr.app" className="vg-btn-primary" style={{ textDecoration: 'none' }}>Contact support</a>
              </div>
            </article>

            {toc.length > 0 && (
              <aside className="vg-help-toc">
                <div style={{ padding: '16px 18px', ...glass, borderRadius: 14 }}>
                  <div className="vg-mono" style={{
                    fontSize: 10, fontWeight: 700, color: C.text3,
                    textTransform: 'uppercase', letterSpacing: '0.16em', marginBottom: 12,
                  }}>On this page</div>
                  <nav style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
                    {toc.map(t => (
                      <a key={t.id} href={`#${t.id}`} className="vg-link"
                        style={{ fontSize: 13.5, textDecoration: 'none', lineHeight: 1.45 }}>{t.label}</a>
                    ))}
                  </nav>
                </div>
              </aside>
            )}
          </div>
        </div>
      </section>
    </MarketingShell>
  );
}

function fmtHelpDate(s) {
  try { return new Date(s).toLocaleDateString('en-US', { month: 'long', year: 'numeric' }); }
  catch { return s; }
}

export function CareersScreen() {
  return (
    <MarketingShell>
      <PageHero
        title="Careers at VERGR"
        subtitle="VERGR is built by a tiny team and a community moderator program. There are two ways to work with us today — both are paid in real money, not equity-only or coins."
        accent="cyan"
      />
      <Section>
        <H2>Open paths</H2>
        <Grid cols={2} min={300}>
          <Tile icon="shield" accent={C.cyan} title="Vanguard moderator program"
            body="Run tournament dispute resolution, content moderation, and community escalations. Paid per-shift in fiat, plus a share of platform tournament fees you adjudicate. Requires VP Level 30+ and a track record of clean play." />
          <Tile icon="terminal" accent={C.violet} title="Engineering"
            body="React + Node, Cloud Functions, WebRTC, Go (SFU). Send a GitHub link and one paragraph on something you've built that you're proud of. We hire on craft, not credentials." />
        </Grid>
      </Section>
      <Section bordered>
        <H2>What we won't do</H2>
        <Grid cols={3} min={260}>
          <Tile icon="block" accent={C.ember} title="Pay in coins only" body="Coins are a feature you build with, not a salary. Every role at VERGR is paid in fiat or USDT, on a transparent schedule." />
          <Tile icon="block" accent={C.ember} title="Unpaid trials" body="A short paid take-home, sure. Two weeks of unpaid work to prove you're worth hiring — never." />
          <Tile icon="block" accent={C.ember} title="Equity scams" body="If equity is offered it's at a real strike price with a real valuation memo. No vague 'percentages of revenue when we're profitable'." />
        </Grid>
      </Section>
      <Section bordered>
        <div style={{
          padding: 22, borderRadius: 14,
          background: `linear-gradient(90deg, ${C.violet}15, transparent)`,
          border: `1px solid ${C.violet}55`,
        }}>
          <div className="vg-syne" style={{ fontSize: 18, fontWeight: 800, color: C.violet }}>Apply</div>
          <p style={{ marginTop: 6, fontSize: 14, color: C.text2 }}>
            Email <a href="mailto:support@vergr.app" style={{ color: C.cyan }}>support@vergr.app</a> with
            "Vanguard application" or "Engineering application" in the subject. A working application form
            (collecting VP level, timezone, references) ships once the rest of the platform is stable.
          </p>
        </div>
      </Section>
    </MarketingShell>
  );
}

// Working contact form — submits to functions/submitContactForm callable
// which writes to the `contact_messages` Firestore inbox. No external
// email service needed; founder reviews in Firebase Console.
function ContactForm() {
  const [name, setName]       = useState('');
  const [email, setEmail]     = useState('');
  const [topic, setTopic]     = useState('general');
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(null); // ticketId on success
  const [error, setError]     = useState('');

  const TOPICS = [
    ['general',     'General support'],
    ['support',     'Account / wallet / technical'],
    ['privacy',     'Privacy / data request (GDPR)'],
    ['legal',       'Legal / compliance / regulator'],
    ['abuse',       'Abuse / safety report'],
    ['copyright',   'Copyright / DMCA'],
    ['press',       'Press / media'],
    ['partnership', 'Partnership / business'],
    ['other',       'Other'],
  ];

  const canSubmit = name.trim() && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) && message.trim().length >= 10;

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!canSubmit || submitting) return;
    setSubmitting(true);
    setError('');
    try {
      const { httpsCallable } = await import('firebase/functions');
      const { functions } = await import('../../firebase/config');
      const fn = httpsCallable(functions, 'submitContactForm');
      const { data } = await fn({
        name: name.trim(),
        email: email.trim(),
        topic,
        subject: subject.trim(),
        message: message.trim(),
      });
      setSuccess(data?.ticketId || 'sent');
      setName(''); setEmail(''); setSubject(''); setMessage(''); setTopic('general');
    } catch (err) {
      setError(err?.message || 'Could not send. Please try again, or email support@vergr.app directly.');
    } finally {
      setSubmitting(false);
    }
  };

  if (success) {
    return (
      <div style={{
        padding: '32px 28px', borderRadius: 16,
        background: `linear-gradient(120deg, ${C.cyan}11, ${C.violet}11)`,
        border: `1px solid ${C.cyan}55`,
        textAlign: 'center',
      }}>
        <div style={{ color: C.cyan, marginBottom: 12 }}>
          <Icon name="check_circle" size={48} />
        </div>
        <div className="vg-syne" style={{ fontSize: 22, fontWeight: 800, color: C.text }}>Message sent.</div>
        <p style={{ marginTop: 8, fontSize: 14, color: C.text2, maxWidth: 480, marginLeft: 'auto', marginRight: 'auto' }}>
          Thanks — we'll reply within two business days, usually sooner. Your reference ID is{' '}
          <span className="vg-mono" style={{ color: C.cyan }}>{success}</span>.
        </p>
        <button
          type="button"
          onClick={() => setSuccess(null)}
          className="vg-btn-ghost"
          style={{ marginTop: 20, cursor: 'pointer' }}>
          Send another message
        </button>
      </div>
    );
  }

  const inputStyle = {
    width: '100%',
    padding: '12px 14px',
    borderRadius: 10,
    border: `1px solid ${C.borderSoft}`,
    background: 'rgba(255,255,255,0.03)',
    color: C.text,
    fontFamily: 'inherit',
    fontSize: 14,
    outline: 'none',
  };
  const labelStyle = {
    display: 'block', fontSize: 12, fontWeight: 700,
    color: C.text2, marginBottom: 6, letterSpacing: '0.02em',
  };

  return (
    <form onSubmit={handleSubmit} style={{
      padding: 'clamp(20px, 4vw, 32px)', borderRadius: 16,
      background: C.surface,
      border: `1px solid ${C.borderSoft}`,
    }}>
      <div style={{ display: 'grid', gap: 16, gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))' }}>
        <div>
          <label style={labelStyle}>Your name</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            maxLength={100}
            placeholder="Your name"
            style={inputStyle}
          />
        </div>
        <div>
          <label style={labelStyle}>Your email</label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            maxLength={254}
            placeholder="you@example.com"
            style={inputStyle}
          />
        </div>
      </div>

      <div style={{ marginTop: 16, display: 'grid', gap: 16, gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))' }}>
        <div>
          <label style={labelStyle}>Topic</label>
          <select
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            style={{ ...inputStyle, cursor: 'pointer' }}>
            {TOPICS.map(([v, label]) => (
              <option key={v} value={v} style={{ background: C.surface, color: C.text }}>{label}</option>
            ))}
          </select>
        </div>
        <div>
          <label style={labelStyle}>Subject (optional)</label>
          <input
            type="text"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            maxLength={200}
            placeholder="Brief subject line"
            style={inputStyle}
          />
        </div>
      </div>

      <div style={{ marginTop: 16 }}>
        <label style={labelStyle}>Message</label>
        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          required
          maxLength={5000}
          rows={6}
          placeholder="How can we help?"
          style={{ ...inputStyle, resize: 'vertical', minHeight: 140 }}
        />
        <div style={{ marginTop: 6, fontSize: 11, color: C.text3, textAlign: 'right' }}>
          {message.length} / 5000
        </div>
      </div>

      {error && (
        <div style={{
          marginTop: 14, padding: '10px 14px', borderRadius: 8,
          background: `${C.ember}15`, border: `1px solid ${C.ember}55`,
          color: C.text, fontSize: 13,
        }}>
          {error}
        </div>
      )}

      <div style={{ marginTop: 20, display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
        <button
          type="submit"
          disabled={!canSubmit || submitting}
          className="vg-btn-primary"
          style={{
            cursor: (!canSubmit || submitting) ? 'not-allowed' : 'pointer',
            opacity: (!canSubmit || submitting) ? 0.6 : 1,
          }}>
          {submitting ? 'Sending…' : 'Send message →'}
        </button>
        <span style={{ fontSize: 12, color: C.text3 }}>
          Or email <a href="mailto:support@vergr.app" style={{ color: C.cyan }}>support@vergr.app</a> directly.
        </span>
      </div>
    </form>
  );
}

export function ContactScreen() {
  useSeo({
    title: 'Contact — Get in Touch with VERGR',
    description: 'Send the VERGR team a message about support, privacy, legal, abuse, copyright, press, or partnerships. We reply within two business days.',
    canonical: 'https://vergr.app/platform/contact',
  });
  return (
    <MarketingShell>
      <PageHero
        title="Contact"
        subtitle="Reach the VERGR team. Use the form below for the fastest reply — or email support@vergr.app directly. We answer every message within two business days."
        accent="cyan"
      />
      <Section>
        <ContactForm />
      </Section>
      <Section bordered>
        <H2>Where to write (by topic)</H2>
        <Grid cols={2} min={300}>
          <Tile icon="support" accent={C.cyan} title="General support"
            body="Account, wallet, tournaments, streaming, payment questions. support@vergr.app" />
          <Tile icon="privacy_tip" accent={C.violet} title="Privacy & data requests"
            body="Access, correction, deletion, portability, GDPR/CCPA rights. support@vergr.app — mention 'Privacy request' in the subject." />
          <Tile icon="gavel" accent={C.gold} title="Legal & compliance"
            body="Terms questions, processor enquiries, regulator correspondence, formal notices. support@vergr.app — mention 'Legal' in the subject." />
          <Tile icon="report" accent={C.ember} title="Abuse & safety"
            body="Reporting harassment, fraud, illegal content, or platform-rule violations. support@vergr.app — also use the in-app report tools where available." />
          <Tile icon="copyright" accent={C.pink} title="Copyright / DMCA"
            body="Notices of alleged infringement and counter-notices. See section 12 of the Terms of Service for required contents. support@vergr.app." />
          <Tile icon="newspaper" accent={C.gold} title="Press & partnerships"
            body="Coverage requests, brand partnerships, integration enquiries. support@vergr.app — mention 'Press' or 'Partnership' in the subject." />
        </Grid>
      </Section>
      <Section bordered>
        <H2>Response times</H2>
        <Grid cols={3} min={260}>
          <Tile icon="schedule" accent={C.cyan}   title="General support" body="Two business days, often the same day." />
          <Tile icon="schedule" accent={C.violet} title="Privacy requests" body="Within one month, in line with GDPR. Complex requests may take longer; we will let you know." />
          <Tile icon="schedule" accent={C.gold}   title="Safety reports" body="Immediate triage; severe cases (CSAM, violent threats) actioned within hours." />
        </Grid>
      </Section>
      <Section bordered>
        <H2>Business details</H2>
        <div style={{ padding: 22, borderRadius: 14, background: 'rgba(255,255,255,0.03)', border: `1px solid ${C.borderSoft}`, display: 'grid', gap: 16, gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))' }}>
          <div>
            <div className="vg-mono" style={{ fontSize: 11, color: C.text3, textTransform: 'uppercase', letterSpacing: '0.14em', marginBottom: 4 }}>Operating company</div>
            <div className="vg-syne" style={{ fontSize: 15, fontWeight: 700, color: C.text }}>{OPERATOR.legalName}</div>
            <div style={{ fontSize: 13, color: C.text2 }}>Trading as VERGR — a competitive gaming social platform</div>
            <div style={{ fontSize: 13, color: C.text2, marginTop: 4 }}>Formed in the {OPERATOR.formationState}</div>
          </div>
          <div>
            <div className="vg-mono" style={{ fontSize: 11, color: C.text3, textTransform: 'uppercase', letterSpacing: '0.14em', marginBottom: 4 }}>Registered address</div>
            <div style={{ fontSize: 15, fontWeight: 700, color: C.text, lineHeight: 1.4 }}>{OPERATOR.registeredAddress}</div>
          </div>
          <div>
            <div className="vg-mono" style={{ fontSize: 11, color: C.text3, textTransform: 'uppercase', letterSpacing: '0.14em', marginBottom: 4 }}>Email</div>
            <a href="mailto:support@vergr.app" style={{ fontSize: 15, fontWeight: 700, color: C.cyan, textDecoration: 'none' }}>support@vergr.app</a>
            <div style={{ fontSize: 13, color: C.text2, marginTop: 4 }}>Replies within 2 business days</div>
          </div>
          <div>
            <div className="vg-mono" style={{ fontSize: 11, color: C.text3, textTransform: 'uppercase', letterSpacing: '0.14em', marginBottom: 4 }}>Website</div>
            <a href="https://vergr.app" style={{ fontSize: 15, fontWeight: 700, color: C.cyan, textDecoration: 'none' }}>vergr.app</a>
            <div style={{ fontSize: 13, color: C.text2, marginTop: 4 }}>Live production deployment</div>
          </div>
        </div>
        <p style={{ marginTop: 12, fontSize: 13, color: C.text3 }}>
          VERGR is a product and brand owned and operated by {OPERATOR.legalName}. Formal notices, regulator
          correspondence, and law-enforcement requests may be sent to the registered address above or to
          {' '}{OPERATOR.legalEmail}.
        </p>
      </Section>
    </MarketingShell>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Account & data deletion.
//
// REQUIRED BY GOOGLE PLAY. The User Data policy requires a PUBLIC web
// resource where a user can REQUEST account and data deletion without
// reinstalling the app, linked from the Data safety form. Google's stated
// criteria: the link must load without error, the deletion pathway must be
// prominent and easy to find, and the page must name the app or developer
// exactly as it appears on the store listing.
//
// It does NOT have to execute deletion unauthenticated, and it must not:
// destruction stays behind auth at /settings/delete-account. This page only
// explains the process and offers two request routes.
//
// Do not remove this route or drop it from the prerender list — the Play
// listing points at it, and a dead link is a policy violation.
// ─────────────────────────────────────────────────────────────────────

export function DeleteAccountScreen() {
  useSeo({
    title: 'Delete Your VERGR Account & Data',
    description: 'How to permanently delete your VERGR account and associated data, what is removed, what is retained and for how long, and how to submit a deletion request.',
    canonical: 'https://vergr.app/platform/delete-account',
  });

  const Step = ({ n, title, children }) => (
    <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
      <div className="vg-dmmono" style={{
        flexShrink: 0, width: 30, height: 30, borderRadius: 999,
        background: C.violet, color: '#fff', fontWeight: 700, fontSize: 14,
        display: 'grid', placeItems: 'center',
      }}>{n}</div>
      <div>
        <div className="vg-syne" style={{ fontSize: 15, fontWeight: 700, color: C.text, marginBottom: 2 }}>{title}</div>
        <div style={{ fontSize: 14, color: C.text2, lineHeight: 1.6 }}>{children}</div>
      </div>
    </div>
  );

  return (
    <MarketingShell>
      <PageHero
        title="Delete your account"
        subtitle="You can permanently delete your VERGR account and its data at any time. This page explains exactly what happens, what we are required to keep, and how to make the request."
        accent="violet"
      />

      <Section>
        <H2>Delete from inside the app</H2>
        <p style={{ fontSize: 15, color: C.text2, lineHeight: 1.7, marginBottom: 20 }}>
          The fastest route. Deletion is irreversible, so we confirm your identity first.
        </p>
        <div style={{ display: 'grid', gap: 18 }}>
          <Step n={1} title="Open Settings">In the VERGR app or on vergr.app, go to your profile menu and choose Settings.</Step>
          <Step n={2} title="Choose Delete Account">Open Account, then Delete Account. You can also go straight to{' '}
            <Link to="/settings/delete-account" className="vg-link">vergr.app/settings/delete-account</Link>.</Step>
          <Step n={3} title="Confirm">Re-enter your password (and your second factor, if enabled) to confirm. Deletion begins immediately.</Step>
        </div>
      </Section>

      <Section bordered>
        <H2>Request deletion by email</H2>
        <p style={{ fontSize: 15, color: C.text2, lineHeight: 1.7 }}>
          If you cannot sign in, email{' '}
          <a href="mailto:support@vergr.app?subject=Account%20deletion%20request" className="vg-link" style={{ fontWeight: 700 }}>support@vergr.app</a>{' '}
          with the subject <strong style={{ color: C.text }}>Account deletion request</strong>, from the email address on the account.
          We verify ownership before deleting anything, and we action verified requests within 30 days.
        </p>
      </Section>

      <Section bordered>
        <H2>What gets deleted</H2>
        <Grid cols={2} min={300}>
          <Tile icon="person_remove" accent={C.violet} title="Your account and profile"
            body="Username, display name, email, avatar and banner images, bio, linked gaming accounts, and your settings." />
          <Tile icon="delete_sweep" accent={C.pink} title="Your content"
            body="Posts, clips, comments, uploaded media, your vergr.me page, and your direct messages are removed from the platform." />
          <Tile icon="groups" accent={C.cyan} title="Social connections"
            body="Follows, followers, squad memberships, and blocked-user lists." />
          <Tile icon="wallet" accent={C.gold} title="Wallet balances"
            body="Any remaining coin and gem balances are forfeited on deletion. Withdraw first if you hold a balance." />
        </Grid>
      </Section>

      <Section bordered>
        <H2>What we keep, and for how long</H2>
        <p style={{ fontSize: 15, color: C.text2, lineHeight: 1.7, marginBottom: 16 }}>
          A small amount of data survives deletion because the law requires it or because removing it would
          damage other people&apos;s records. We keep the minimum, and it is never used to re-identify you on the platform.
        </p>
        <Grid cols={2} min={300}>
          <Tile icon="receipt_long" accent={C.gold} title="Financial records — up to 7 years"
            body="Payment, payout and tax records, retained to meet accounting and anti-money-laundering obligations." />
          <Tile icon="verified_user" accent={C.cyan} title="Identity-verification records"
            body="Where you completed KYC, the verification outcome is retained for the period required by financial-crime rules." />
          <Tile icon="gavel" accent={C.ember} title="Moderation and safety records"
            body="Records relating to serious policy violations, retained to protect other users and to comply with legal requests." />
          <Tile icon="hub" accent={C.violet} title="Other users' content"
            body="Messages you sent to other people, and tournament results involving other competitors, remain in their records." />
        </Grid>
      </Section>

      <Section bordered>
        <H2>Before you delete</H2>
        <Grid cols={3} min={260}>
          <Tile icon="account_balance_wallet" accent={C.gold} title="Withdraw your balance"
            body="Coin and gem balances are forfeited. Convert and withdraw before deleting." />
          <Tile icon="event_busy" accent={C.ember} title="Finish active tournaments"
            body="Deleting mid-tournament forfeits your place and any prize." />
          <Tile icon="autorenew" accent={C.cyan} title="Cancel subscriptions"
            body="Cancel any active plan or creator membership so you are not billed again." />
        </Grid>
      </Section>

      <Section bordered>
        <p style={{ fontSize: 13, color: C.text3, lineHeight: 1.7 }}>
          VERGR is operated by {OPERATOR.legalName}, {OPERATOR.registeredAddress}. This page describes the
          account-deletion process for the VERGR app and vergr.app. For the full picture of what we collect and
          why, see our <Link to="/platform/privacy" className="vg-link">Privacy Policy</Link>, which also covers your
          rights of access, correction and portability.
        </p>
      </Section>
    </MarketingShell>
  );
}

export function ForumsScreen() {
  return (
    <MarketingShell>
      <PageHero
        title="VERGR Forums"
        subtitle="Ask. Answer. Earn. A community Q&A where the best answers rise to the top — and the people who give them get recognised."
        accent="cyan"
      />
      <Section>
        <H2>How it'll work</H2>
        <Grid cols={3} min={240}>
          <Tile icon="forum"       accent={C.cyan}   title="Ask a question"     body="Any logged-in user can post a question about a game, a tournament, a creator tool, or a platform feature. Tag it so it surfaces to the right people." />
          <Tile icon="thumb_up"    accent={C.violet} title="Vote on answers"    body="The community ranks answers by upvote. Helpful answers climb to the top, bad ones drop out of view." />
          <Tile icon="verified"    accent={C.gold}   title="Accept the best"    body="The asker picks the answer that solved their problem. Accepted answers stick to the top and earn the answerer VP toward their next rank." />
        </Grid>
      </Section>
      <Section bordered>
        <H2>Categories at launch</H2>
        <Grid cols={4} min={200}>
          <Tile icon="sports_esports" accent={C.cyan}   title="Game help"      body="Strategy, builds, rotations, agent picks." />
          <Tile icon="emoji_events"   accent={C.gold}   title="Tournaments"    body="Format questions, dispute precedent, prize-distribution clarifications." />
          <Tile icon="payments"       accent={C.violet} title="Wallet & coins" body="How conversion works, withdrawals, address questions, refund flow." />
          <Tile icon="groups"         accent={C.pink}   title="Squads & creators" body="Building an audience, squad operations, monetisation tactics." />
        </Grid>
      </Section>
      <Section bordered>
        <H2>On the roadmap</H2>
        <P max={720}>
          Forums are scheduled to launch once the core wallet + tournaments + streaming flows are battle-tested in the
          wild. Building the platform's foundations first means the forum has real conversations to have when it goes
          live — not just empty categories.
        </P>
        <P max={720}>
          In the meantime: ask in your squad chat, or write to{' '}
          <a href="mailto:support@vergr.app" style={{ color: C.cyan }}>support@vergr.app</a>. We reply within two
          business days — the same answers will seed the forum's FAQ when it opens.
        </P>
      </Section>
      <Section bordered>
        <div style={{
          padding: 22, borderRadius: 14,
          background: `linear-gradient(90deg, ${C.cyan}11, transparent)`,
          border: `1px solid ${C.cyan}44`,
        }}>
          <div className="vg-syne" style={{ fontSize: 18, fontWeight: 800, color: C.cyan }}>Want to be a moderator when forums open?</div>
          <p style={{ marginTop: 6, fontSize: 14, color: C.text2 }}>
            Email <a href="mailto:support@vergr.app" style={{ color: C.cyan }}>support@vergr.app</a> with subject
            "Forum mod interest" and a link to your VERGR profile. Vanguard moderators get a share of platform
            revenue from the categories they manage.
          </p>
        </div>
      </Section>
    </MarketingShell>
  );
}

export function PartnerProgramScreen() {
  return (
    <MarketingShell>
      <PageHero
        title="Partner Program"
        subtitle="For top creators, squads, and tournament organisers — verified partner status, custom Stream Boost terms, and direct support."
        accent="violet"
      />
      <Section>
        <H2>Who qualifies</H2>
        <Grid cols={3} min={260}>
          <Tile icon="emoji_events" accent={C.gold} title="Creators" body="Monthly average ≥500 concurrent viewers across the past three months, or ≥10,000 followers on VERGR, or an equivalent profile on another platform we recognise." />
          <Tile icon="shield"       accent={C.cyan} title="Squads"   body="Active squad with ≥50 members, a clean moderation record, and consistent tournament participation." />
          <Tile icon="campaign"     accent={C.violet} title="Organizers" body="At least three successful tournaments hosted on VERGR, no unresolved disputes, and a track record of clear rules and on-time payouts." />
        </Grid>
      </Section>
      <Section bordered>
        <H2>What you get</H2>
        <div>
          <Bullet icon="verified"     color={C.cyan}   title="Verified badge"        body="A visible check on your profile that audiences trust." />
          <Bullet icon="rocket_launch" color={C.gold}   title="Custom Boost terms"   body="Larger reach amplification on Boosted streams + better surfacing in discovery." />
          <Bullet icon="payments"     color={C.violet} title="Priority payouts"      body="Faster review window on Gem withdrawals and dedicated support contact." />
          <Bullet icon="forum"        color={C.pink}   title="Direct line"           body="A private Discord channel with VERGR for product feedback, early access, and roadmap input." />
        </div>
      </Section>
      <Section bordered>
        <div style={{ padding: 22, borderRadius: 14, background: `linear-gradient(90deg, ${C.violet}15, transparent)`, border: `1px solid ${C.violet}55` }}>
          <div className="vg-syne" style={{ fontSize: 18, fontWeight: 800, color: C.violet }}>Apply</div>
          <p style={{ marginTop: 6, fontSize: 14, color: C.text2 }}>
            Email <a href="mailto:support@vergr.app" style={{ color: C.cyan }}>support@vergr.app</a> with
            "Partner application" in the subject and one paragraph on why you qualify. Verified partners
            are reviewed quarterly.
          </p>
        </div>
      </Section>
    </MarketingShell>
  );
}

// ═════════════════════════════════════════════════════════════════════
// Phase 2 — static info pages (full content)
// ═════════════════════════════════════════════════════════════════════

export function AboutScreen() {
  return (
    <MarketingShell>
      <PageHero
        title="About VERGR"
        subtitle="Where gamers converge to play, compete, and grow — on a platform that shares the economy with the people who build it."
        centered
      />
      <Section>
        <H2>Why we built VERGR</H2>
        <P>
          You've probably noticed it: most gaming social platforms either gate everything behind ads,
          sell your data, or split creators into revenue tiers so small that almost nobody outside the top 1%
          earns enough for it to mean anything. We built VERGR to do the opposite.
        </P>
        <P>
          On VERGR, players, creators, and squads share the same wallet, the same tournaments, and the same
          upside. The tips you send, the memberships you subscribe to, the tournament entries you pay, and
          the boosts you spend on your stream all run through one currency — VC Coins — that converts back
          out to a real payout. The platform takes a flat 10% on tips and a tier-based commission on
          conversions, and that's it. No ads, no sponsored slots, no "Gifts" category siphoning money to the house.
        </P>
      </Section>
      <Section bordered>
        <H2>What we believe</H2>
        <Grid cols={4} min={220}>
          <Tile icon="emoji_events"          accent={C.gold}   title="Skill should pay"
            body="Tournaments are won by playing well, not by buying loot or grinding for a chance at random rewards. Posted rules, verified results, real prizes." />
          <Tile icon="groups"                accent={C.cyan}   title="Squads matter as much as solo"
            body="Most great gaming moments happen with a crew. Squads are first-class on VERGR — shared streams, shared tournament entries, shared earnings split." />
          <Tile icon="payments"              accent={C.violet} title="Creators keep more"
            body="Tip fee is a flat 10%, the same for free and Pro alike. The only thing that changes with subscription is what you can produce — never what you keep." />
          <Tile icon="rocket_launch"         accent={C.ember}  title="Reach is investment, not paywall"
            body="Stream Boosts amplify your reach — and refund themselves from the first tips you earn during the boosted stream. The platform invests in you, not against you." />
        </Grid>
      </Section>
      <Section bordered>
        <H2>Built without compromise</H2>
        <Grid cols={3} min={260}>
          <Tile icon="bolt"             accent={C.cyan}   title="Real prizes, no casino"
            body="Tournament platform caps disclosed to Riot Games: per-player entry max 10,000 coins, per-tournament prize max 500,000 coins, fixed 5% mod cut. Skill-based, audit-trailed, dispute-handled." />
          <Tile icon="account_balance"  accent={C.violet} title="Flat 10% tip fee"
            body="Same on free, same on Pro. We never sell a sliding scale on the thing creators do most. Conversion-side commission is your tier-based margin lever." />
          <Tile icon="verified_user"    accent={C.gold}   title="Withdraw to your wallet"
            body="Eligible gem earnings withdraw to your crypto wallet. 1,000-gem minimum, 7-day hold for fraud review, then the payout is sent." />
        </Grid>
      </Section>
      <Section bordered>
        <div style={{ textAlign: 'center', padding: '24px 0' }}>
          <H2>Be early.</H2>
          <P max={580}>
            VERGR is in early access. Sign up free, link your games, find your squad, and try a tournament — all in your first hour.
          </P>
          <Link to="/signup" className="vg-btn-primary" style={{ marginTop: 12, textDecoration: 'none' }}>
            Create account →
          </Link>
        </div>
      </Section>
    </MarketingShell>
  );
}

export function CodeOfConductScreen() {
  return (
    <MarketingShell>
      <PageHero
        title="Code of Conduct"
        subtitle="What we expect from you on VERGR — and what we'll do when someone crosses the line."
        accent="ember"
        centered
      />
      <Section>
        <H2>Our values</H2>
        <Grid cols={4} min={220}>
          <Tile icon="diversity_3"  accent={C.cyan}   title="Respect"      body="Treat other players, creators, and squads the way you'd want to be treated. Disagreement is fine — disrespect isn't." />
          <Tile icon="balance"      accent={C.violet} title="Fair play"    body="No cheats, no exploits, no smurfs in tournaments. The platform is competitive — that only works if everyone plays it straight." />
          <Tile icon="visibility"   accent={C.gold}   title="Honesty"      body="Don't misrepresent yourself, your stats, or your content. Fake views, fake followers, and bot tips ruin trust for everyone." />
          <Tile icon="construction" accent={C.ember}  title="Build, don't break" body="Help squads grow. Boost the people you root for. Use the report tools when you see harm — they protect everyone, including you." />
        </Grid>
      </Section>
      <Section bordered>
        <H2>What's expected</H2>
        <div>
          <Bullet icon="check_circle" color="#34d399" title="Use real handles" body="Your VERGR account is yours — don't share logins, don't run multi-accounts, don't impersonate others." />
          <Bullet icon="check_circle" color="#34d399" title="Respect the rules of the games you play" body="Tournament organizers post rules per event. Read them before you enter. Match results are verified — don't dispute in bad faith." />
          <Bullet icon="check_circle" color="#34d399" title="Keep streams safe" body="Moderate your chat, follow your platform's content guidelines, and use the safety tools we provide." />
          <Bullet icon="check_circle" color="#34d399" title="Use VERGR features for their purpose" body="Boosts amplify streams. Tournaments compete. Squads collaborate. Don't twist them into something they're not." />
        </div>
      </Section>
      <Section bordered>
        <H2>What's not allowed</H2>
        <div>
          <Bullet icon="block" color={C.ember} title="Harassment, hate speech, threats" body="Targeting another user with personal attacks, slurs, or threats — in chat, on stream, in DMs — is grounds for immediate action." />
          <Bullet icon="block" color={C.ember} title="Cheating, exploits, match-fixing" body="Aimbots, wall-hacks, scripts, account boosting, or coordinating to throw matches in a tournament. Verified events are tracked end-to-end." />
          <Bullet icon="block" color={C.ember} title="Fraud and chargeback abuse" body="Stolen card use, refund abuse, fake tip rings to game leaderboards, and money-laundering through coin purchases all trigger account holds and possible legal referral." />
          <Bullet icon="block" color={C.ember} title="Doxxing and impersonation" body="Posting private info about another user, or pretending to be a creator/squad/employee you aren't, will end the account." />
          <Bullet icon="block" color={C.ember} title="Illegal content" body="CSAM, terrorism content, sales of illegal goods, and content that violates the law of your jurisdiction or ours are reported to authorities and removed immediately." />
          <Bullet icon="block" color={C.ember} title="Sexual content involving minors" body="Zero tolerance. Reported to NCMEC and law enforcement. The account is permanently terminated and the host blacklisted across the platform." />
        </div>
      </Section>
      <Section bordered>
        <H2>How we enforce</H2>
        <P>
          Most reports are handled by trained Vanguard moderators (the same paid mod role described on the
          Careers page). High-severity cases are escalated to platform admins. Decisions follow a written rubric
          — the same offense gets the same response, every time.
        </P>
        <P>
          Actions range from a warning, to feature throttling (no boosts, no payouts, no tournament entries),
          to a suspension, to a permanent ban. Severe cases also include payment processor referrals and law
          enforcement contact.
        </P>
      </Section>
      <Section bordered>
        <H2>Appeals</H2>
        <P>
          Every action can be appealed once. Email <span className="vg-mono" style={{ color: C.cyan }}>support@vergr.app</span> with
          your account handle and a description of what you think was wrong. A different reviewer than the one
          who took the original action will read it. Permanent bans for the most serious offenses (CSAM, illegal
          content, repeat fraud) are not eligible for appeal.
        </P>
      </Section>
    </MarketingShell>
  );
}

export function BecomeStreamerScreen() {
  return (
    <MarketingShell>
      <PageHero
        title="Become a Streamer"
        subtitle="Go live, build your fan base, and turn the moments you create into real income. Free to start — no install, no setup required."
        accent="ember"
        centered
      />
      <Section>
        <H2>Three ways to broadcast</H2>
        <Grid cols={3} min={260}>
          <Tile icon="language" accent={C.cyan}
            title="Browser (Free)"
            body="Hit Go Live in your browser — VERGR pushes fragmented MP4 chunks straight to the platform. No install, no OBS. 480p at 30fps, 3 Mbps." />
          <Tile icon="desktop_windows" accent={C.violet}
            title="OBS (Lite)"
            body="Push from OBS to VERGR's RTMP ingest. 720p at 60fps, 4.5 Mbps. Custom scenes, multi-source layouts, professional tooling." />
          <Tile icon="hd" accent={C.gold}
            title="OBS Pro (Pro)"
            body="Same RTMP path, higher quality ceiling — 1080p at 60fps, 6.5 Mbps. Plus IP-masked privacy via Cloudflare TURN, and clip lengths up to 90 seconds." />
        </Grid>
      </Section>
      <Section bordered>
        <H2>Free public streaming starts at 100 followers</H2>
        <P>
          To stream publicly on the free tier, you need 100 followers and a 50-coin Stream Boost on the
          session. Squad streams (voice + on-demand video, up to 100 members) are unconditional — no
          followers, no fee, ever.
        </P>
        <P style={{ fontWeight: 700, color: C.text }}>
          The Boost isn't a paywall. It's a real growth lever:
        </P>
        <div style={{ marginTop: 8 }}>
          <Bullet icon="redeem"           color={C.gold}   title="Refunded by the first 50 coins of tips you earn during the stream"        body="If your stream lands a single tip of 50 coins or more, the Boost effectively cost you nothing. If it doesn't, the platform recoups the infrastructure cost." />
          <Bullet icon="trending_up"      color={C.cyan}   title="+1.5× discovery feed visibility for the duration"                          body="Your stream is preferentially surfaced to viewers with high tip-likelihood scores (recent tippers, paying members, high VP balance)." />
          <Bullet icon="notifications_active" color={C.violet} title="Push-notification eligibility to a sample of your followers"          body="Boosted streams can wake up dormant followers — the platform actively reaches out on your behalf." />
          <Bullet icon="stars"            color={C.ember}  title='"Boosted" badge on the stream'                                              body="Visible proof to viewers that you've put skin in the game. Lite and Pro can opt-in to Boost any stream for the same effect." />
        </div>
      </Section>
      <Section bordered>
        <H2>Earn from your stream</H2>
        <Grid cols={4} min={220}>
          <Tile icon="payments"      accent={C.gold}   title="Tips"           body="Real-time during the stream. Senders pay N coins → 10% platform fee → you receive floor(N × 0.90) coins, instantly." />
          <Tile icon="card_membership" accent={C.violet} title="Memberships"    body="Recurring monthly subscriptions from your top fans. Tier-based perks you set yourself — emotes, badge, member chat." />
          <Tile icon="emoji_events"  accent={C.ember}  title="Tournament casts" body="Stream a tournament with the integrated bracket overlay. Bonus visibility from the tournament page." />
          <Tile icon="rocket_launch" accent={C.cyan}   title="Boost amplification" body="Free users boost to unlock; paid users boost to amplify. Real algorithmic reach, refundable from tips." />
        </Grid>
      </Section>
      <Section bordered>
        <H2>Squad streams are free, always</H2>
        <P>
          A squad stream is a Discord-style hangout for up to 100 squad members — voice subscribed by everyone,
          video on-demand for ≤2 publishers at once. No follower requirement, no Boost fee. Run scrims, hold
          listening parties, or just hang out.
        </P>
        <Link to="/platform/learn/squads" style={{ color: C.cyan, fontSize: 14, fontWeight: 700, textDecoration: 'none' }}>
          Read more about squads →
        </Link>
      </Section>
      <Section bordered>
        <div style={{ textAlign: 'center', padding: '24px 0' }}>
          <H2>Ready to go live?</H2>
          <Link to="/signup" className="vg-btn-primary" style={{ textDecoration: 'none' }}>
            Create your streaming account →
          </Link>
        </div>
      </Section>
    </MarketingShell>
  );
}

export function MonetizationScreen() {
  useSeo({
    title: 'Make Money Gaming — VERGR Creator Monetisation',
    description: 'Five ways to earn on VERGR: tips, memberships, tournament prizes, Stream Boost amplification, and squad treasury shares. Flat 10% tip fee. Your conversion commission drops 30% → 10% as you climb the rank ladder.',
    canonical: 'https://vergr.app/platform/monetization',
  });
  // Real commission per rank — derived from commissionForVP() in src/utils/vpSystem.js
  // (the same threshold table the server enforces). It steps down with lifetime VP
  // and hits its 15% floor around 100,000 VP, so every rank from Elite up sits at 15%.
  const ranks = [
    ['Rookie',     'Lvl 1–10',  '20–30%', C.text2,  '/badges/rookie1-3.webp'],
    ['Contender',  'Lvl 11–20', '18–20%', '#CD7F32', '/badges/contender11-13.webp'],
    ['Rival',      'Lvl 21–30', '18%',    '#C0C0C0', '/badges/rival21-23.webp'],
    ['Challenger', 'Lvl 31–40', '15–18%', C.gold,    '/badges/challenger31-33.webp'],
    ['Elite',      'Lvl 41–50', '15%',    C.cyan,    '/badges/elite41-43.webp'],
    ['Champion',   'Lvl 51–60', '15%',    C.violet,  '/badges/champion51-53.webp'],
    ['Veteran',    'Lvl 61–70', '15%',    '#2A2A2A', '/badges/veteran61-63.webp'],
    ['Legend',     'Lvl 71–80', '15%',    '#E0115F', '/badges/legend71-73.webp'],
    ['Mythic',     'Lvl 81–90', '15%',    C.pink,    '/badges/mythic81-83.webp'],
    ['Ascendant',  'Lvl 91–99', '15%',    '#FFB347', '/badges/ascendant91-93.webp'],
    ['Immortal',   'Lvl 100',   '15%',    '#fff',    '/badges/ascendant97-100.webp'],
  ];
  return (
    <MarketingShell>
      <PageHero
        title="Monetization"
        subtitle="Every way to earn on VERGR. The platform takes a flat 10% on tips. Your coin-to-gem conversion commission steps down as your VP grows, from 30% at Rookie to a 15% floor at the top."
        accent="gold"
      />
      <Section>
        <H2>Five ways to earn</H2>
        <Grid cols={3} min={260}>
          <Tile icon="payments"        accent={C.gold}   title="Tips"
            body="When fans tip you N coins, 10% goes to the platform and you keep the rest — instantly, in your wallet. Same flat fee on free, Lite, and Pro." />
          <Tile icon="card_membership" accent={C.violet} title="Memberships"
            body="Set your own tier prices and perks. Top fans subscribe monthly with VC Coins, and you keep a recurring share every renewal." />
          <Tile icon="emoji_events"   accent={C.ember}  title="Tournament prizes"
            body="Enter brackets, win matches, take a share of the prize. The mod team takes 5%; the rest goes to the players who placed." />
          <Tile icon="rocket_launch"  accent={C.cyan}   title="Stream Boost amplification"
            body="Free streamers spend 50 coins to unlock public streaming. The first 50 coins of tips you earn during that stream refund the boost — so a single decent tip makes it free." />
          <Tile icon="groups"         accent={C.pink}   title="Squad treasury share"
            body="When you win a tournament, 10% of your prize auto-routes to your squad's treasury. The treasury funds future tournament entries for the team — Treasury Secretary motions distribute coins to members with President approval." />
        </Grid>
      </Section>

      {/* Coin graphic centerpiece — gives the page visual weight */}
      <Section bordered>
        <div style={{
          padding: '40px 32px', borderRadius: 20,
          background: `radial-gradient(circle at 50% 0%, ${C.gold}22, transparent 60%), linear-gradient(180deg, rgba(15,17,24,0.9), rgba(7,8,13,0.95))`,
          border: `1px solid ${C.gold}33`,
          display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 40, alignItems: 'center',
        }} className="vg-grid-2">
          <div>
            <H2>Coins → Gems → Cash</H2>
            <P>
              The coins you earn are spendable inside VERGR. When you want to cash out, convert them to gems at
              your rank's commission rate, then withdraw the gems to your crypto wallet.
            </P>
            <div style={{ marginTop: 8 }}>
              <Bullet icon="paid"                   color={C.gold}   title="Earn coins"      body="Tips, memberships, tournament wins, and boosted-stream rewards all credit your wallet in VC Coins." />
              <Bullet icon="swap_horiz"             color={C.violet} title="Convert to gems" body="Convert when you're ready to cash out. Your VP rank decides the commission — see the table below." />
              <Bullet icon="account_balance_wallet" color={C.cyan}   title="Withdraw"        body="1,000-gem minimum, 7-day hold for fraud review, then the payout lands in your wallet. Payment-processor and network fees are shown at confirmation." />
            </div>
          </div>
          <div style={{ display: 'grid', placeItems: 'center', position: 'relative', minHeight: 320 }}>
            <div style={{
              position: 'absolute', inset: '15%',
              background: `radial-gradient(closest-side, ${C.gold}55, transparent 70%)`,
              filter: 'blur(40px)',
            }} />
            <img src="/brand/vc-coin.webp" alt="VC coin" className="vg-float-y" style={{
              position: 'relative', width: '70%', maxWidth: 280,
              filter: `drop-shadow(0 20px 40px ${C.gold}77)`,
            }} />
          </div>
        </div>
      </Section>

      {/* Real conversion table with VP badges */}
      <Section bordered>
        <H2>Conversion commission by rank</H2>
        <P max={680}>
          You earn the same gross either way — the rank just decides how much you keep. The lowest commission
          is 10% (at Immortal, level 100). Most active creators land between Champion and Legend.
        </P>
        <div style={{
          marginTop: 16, borderRadius: 16, overflow: 'hidden',
          border: `1px solid ${C.borderSoft}`,
          background: 'var(--vg-grad-card)',
        }}>
          {/* Header */}
          <div style={{
            display: 'grid', gridTemplateColumns: '60px 1fr 1fr auto',
            padding: '14px 18px', gap: 14,
            background: 'rgba(123,111,255,0.08)',
            borderBottom: `1px solid ${C.borderSoft}`,
            fontSize: 11, fontWeight: 700, letterSpacing: '0.12em',
            color: C.text3, textTransform: 'uppercase',
          }}>
            <div>Badge</div>
            <div>Rank</div>
            <div>Levels</div>
            <div>Commission</div>
          </div>
          {ranks.map(([rank, lvl, comm, color, badge], i) => (
            <div key={rank} style={{
              display: 'grid', gridTemplateColumns: '60px 1fr 1fr auto',
              padding: '12px 18px', alignItems: 'center', gap: 14,
              borderTop: i === 0 ? 'none' : `1px solid ${C.borderSoft}`,
              background: rank === 'Immortal'
                ? `linear-gradient(90deg, ${C.gold}11, transparent)`
                : 'transparent',
            }}>
              <img src={badge} alt={rank} style={{
                width: 40, height: 40, objectFit: 'contain',
                filter: `drop-shadow(0 4px 10px ${color}66)`,
              }} onError={(e) => { e.currentTarget.style.display = 'none'; }} />
              <div className="vg-syne" style={{ fontWeight: 700, color }}>{rank}</div>
              <div className="vg-mono" style={{ fontSize: 12, color: C.text3 }}>{lvl}</div>
              <div className="vg-mono" style={{ fontWeight: 800, color, fontSize: 14 }}>{comm}</div>
            </div>
          ))}
        </div>
      </Section>

      <Section bordered>
        <div style={{
          padding: 24, borderRadius: 14,
          background: `linear-gradient(90deg, ${C.violet}15, ${C.cyan}08)`,
          border: `1px solid ${C.violet}55`,
        }}>
          <div className="vg-syne" style={{ fontSize: 18, fontWeight: 800, color: C.violet, marginBottom: 10 }}>
            Quests give VP, never coins
          </div>
          <div style={{ fontSize: 14, color: C.text2, lineHeight: 1.7 }}>
            Creator quests reward you with VP toward your next rank — that's how you climb the conversion table
            and keep more of what you earn. Coins, on the other hand, only come from real users paying you (tips,
            memberships, tournament wins, boosted-stream rewards). That's what keeps the economy honest and
            your earnings credible.
          </div>
        </div>
      </Section>
    </MarketingShell>
  );
}

export function StudioToolsScreen() {
  const tools = [
    ['Dashboard',   'space_dashboard',  'KPIs at a glance, top posts, wallet snapshot, daily quest teaser.', '/creator/dashboard', C.cyan],
    ['Earnings',    'payments',         'Revenue hero, supporters list, payouts, full transaction ledger.', '/creator/earnings', C.gold],
    ['Content',     'collections',      'Every post you\'ve made — engagement chips, filters, quick edit.', '/creator/content', C.violet],
    ['Schedule',    'calendar_month',   'Plan posts and streams on a month grid + agenda view.', '/creator/schedule', C.pink],
    ['Audience',    'groups',           'Growth trend, demographics, country/age/gender, top supporters.', '/creator/audience', C.cyan],
    ['Community',   'forum',            'Activity stream, replies needed, milestones, sentiment, announcements.', '/creator/community', C.ember],
    ['Quests',      'rocket_launch',    'VP rewards for hitting weekly goals — never coins.', '/creator/quests', C.violet],
    ['Membership',  'card_membership',  'Set tier prices and perks for paid subscribers.', '/creator/membership', C.gold],
    ['Analytics',   'analytics',        'Monthly performance: views, watch time, retention, conversion.', '/creator/analytics', C.cyan],
  ];
  return (
    <MarketingShell>
      <PageHero
        title="Creator Studio"
        subtitle="Nine tools that handle the analytics, scheduling, and earnings tracking — so you can focus on creating."
        accent="violet"
        centered
      />
      <Section>
        <Grid cols={3} min={260}>
          {tools.map(([title, icon, body, to, accent]) => (
            <Tile key={title} icon={icon} accent={accent} title={title} body={body} to={to} cta="Open" />
          ))}
        </Grid>
      </Section>
      <Section bordered>
        <H2>Mobile + desktop, one Studio</H2>
        <P>
          Creator Studio works on phone and desktop with the same data and the same controls. The studio sidebar
          collapses on smaller screens; bottom nav handles the most-used routes (Dashboard / Content / Earnings /
          Audience). Moderation tools belong on Mod / Manager dashboards — not here.
        </P>
      </Section>
      <Section bordered>
        <div style={{ textAlign: 'center', padding: '24px 0' }}>
          <H2>Open the Studio</H2>
          <Link to="/creator/dashboard" className="vg-btn-primary" style={{ textDecoration: 'none' }}>
            Go to Dashboard →
          </Link>
        </div>
      </Section>
    </MarketingShell>
  );
}

export function LearnLiveScreen() {
  useSeo({
    title: 'Stream Gameplay & Earn — Live Streaming on VERGR',
    description: 'Go live in 30 seconds from your browser, no install. Earn real tips while you play, build memberships, and stream tournaments with 720p60 (Lite) or 1080p60 (Pro). The Twitch alternative built for gamer monetisation.',
    canonical: 'https://vergr.app/platform/learn/live',
  });
  return (
    <MarketingShell>
      <PageHero
        title="Stream Your Gameplay. Earn From Day One."
        subtitle="Go live straight from your browser — no install, no studio. Get paid in real tips while you play. Build a following on a gaming platform built by gamers."
        accent="ember"
        centered
      />

      <Section>
        <H2>Three ways to earn the moment you go live</H2>
        <Grid cols={3} min={260}>
          <Tile icon="payments" accent={C.gold}
            title="Tips in coins, instantly"
            body="Viewers send tips during your stream — your name and amount pop in your overlay live. 10% platform fee, you keep the rest. Convert to cash whenever you're ready." />
          <Tile icon="card_membership" accent={C.violet}
            title="Paid memberships"
            body="Your top fans subscribe monthly for perks you set — exclusive emotes, sub-only chat, private squad channels. Recurring revenue every month." />
          <Tile icon="rocket_launch" accent={C.cyan}
            title="Stream Boost amplification"
            body="Spend 50 coins to boost a stream's reach in the discovery feed. The first 50 coins of tips you earn refund the boost — one good tip and it pays for itself." />
        </Grid>
      </Section>

      <Section bordered>
        <H2>Go live in 30 seconds — no install</H2>
        <Grid cols={3} min={260}>
          <Tile icon="language" accent={C.cyan}
            title="Browser broadcast"
            body="Click Go Live, share your screen and webcam, and you're streaming. Works on any laptop. No software to install, no scene config to wrestle with." />
          <Tile icon="desktop_windows" accent={C.violet}
            title="OBS power-mode (Lite & Pro)"
            body="Plug OBS into our RTMP ingest for custom scenes, transitions, alerts, and overlays. Same RTMP workflow you already know from Twitch and YouTube." />
          <Tile icon="shield" accent={C.gold}
            title="Built-in moderation"
            body="Block-word lists, slow-chat, follower-only mode, timeouts, instant bans. Invite a Vanguard mod per stream if you want backup. Tools shipped, not promised." />
        </Grid>
      </Section>

      <Section bordered>
        <H2>Resolution + framerate per tier</H2>
        <P max={680}>
          We stream at your source quality with no transcoding ladder, so viewers see exactly what you push. Free tier is sharper per pixel than most non-partner Twitch streams at the same bitrate.
        </P>
        <Grid cols={3} min={260}>
          <Tile icon="hd" accent={C.cyan}
            title="Free — 480p · 30 fps"
            body="3 Mbps source bitrate. Stream from your browser, share screen + webcam, watch your audience build. Upgrade to Lite for 720p60 once you outgrow it." />
          <Tile icon="hd" accent={C.violet}
            title="Lite (€4.99/mo) — 720p · 60 fps"
            body="4.5 Mbps. 60 fps makes fast-action games look smooth. OBS supported, scheduled streams, ad-free, custom banner. The proper streamer tier." />
          <Tile icon="4k" accent={C.gold}
            title="Pro (€9.99/mo) — 1080p · 60 fps"
            body="6.5 Mbps. Highest quality on the platform, plus IP-masked private streaming via Cloudflare TURN if you don't want your origin exposed." />
        </Grid>
      </Section>

      <Section bordered>
        <H2>For viewers — watch, tip, follow</H2>
        <Grid cols={3} min={260}>
          <Tile icon="visibility" accent={C.cyan}
            title="HD playback at every tier"
            body="Free viewers watch at 480p, Lite at 720p, Pro at 1080p — capped at the streamer's source quality. No buffering, no pre-roll ads, no mid-stream ad breaks. Ever." />
          <Tile icon="forum" accent={C.violet}
            title="Real-time chat"
            body="Reply, react with emotes, and tag the streamer. Big streams get threaded chat so the conversation stays readable instead of scrolling past in a blur." />
          <Tile icon="favorite" accent={C.ember}
            title="Follow + push when live"
            body="Hit follow and we push you a notification the moment they go live. Stop checking 'is anyone streaming right now' and just be there when it counts." />
        </Grid>
      </Section>

      <Section bordered>
        <H2>Squad streams — Discord-style hangouts</H2>
        <Grid cols={2} min={300}>
          <Tile icon="groups" accent={C.cyan}
            title="Voice + video with your squad"
            body="Squad members hop into a voice hangout with up to 100 people, optional video for up to 2 at a time. Same place you organise, scrim, and post-game review — built in." />
          <Tile icon="cast_for_education" accent={C.violet}
            title="Co-stream as a team"
            body="Stream a tournament match together — two broadcasters in one composited feed, side-by-side. Shoutcast your own bracket without any third-party software." />
        </Grid>
      </Section>

      <Section bordered>
        <H2>Built for tournaments</H2>
        <P max={680}>
          Tournament streams run through our verified delivery path — no peer-to-peer shortcuts — so the
          prize-money audit trail stays clean and disputes have a real timestamped record. Co-host streams
          put two broadcasters side-by-side in a single composited feed for shoutcast-style coverage of
          your own brackets.
        </P>
      </Section>

      <Section bordered>
        <H2>Public streaming unlocks at 100 followers (free) or instantly (Lite/Pro)</H2>
        <P max={680}>
          Free creators unlock public streaming at 100 followers, then start each public session with a
          50-coin Stream Boost that <em>actually amplifies your reach</em> in the discovery feed. The Boost
          refunds itself from the first 50 coins of tips you earn during that stream — meaning a single
          decent tip makes the boost free and your reach has already grown. Lite and Pro skip the follower
          gate and can boost any stream optionally.
        </P>
      </Section>

      <Section bordered>
        <div style={{ textAlign: 'center', padding: '24px 0' }}>
          <H2>Start streaming. Start earning.</H2>
          <Link to="/signup" className="vg-btn-primary" style={{ textDecoration: 'none' }}>
            Create my account →
          </Link>
        </div>
      </Section>
    </MarketingShell>
  );
}

export function LearnTournamentsScreen() {
  useSeo({
    title: 'Online Gaming Tournaments — Cash Prizes for Skill | VERGR',
    description: 'Compete in CS2, Apex Legends, Overwatch 2, Dota 2 and 60+ supported games. Real brackets, verified results, instant prize payouts. Auto-detected wins via Steam GSI + game APIs. Solo or squad.',
    canonical: 'https://vergr.app/platform/learn/tournaments',
  });
  return (
    <MarketingShell>
      <PageHero
        title="Tournaments Where Your Skill Pays the Bills"
        subtitle="Real brackets. Real prizes. Verified results. Compete in CS2, Apex, Overwatch 2, Dota 2, and 60+ supported games — solo, with your squad, or host your own event and take a cut."
        accent="violet"
        centered
      />

      <Section>
        <H2>Four steps from entry to payout</H2>
        <Grid cols={4} min={220}>
          <Tile icon="add_circle"     accent={C.cyan}   title="1. Join or host"
            body="Browse open tournaments and join in one tap, or create your own with custom rules and prize structure." />
          <Tile icon="lock"           accent={C.violet} title="2. Server escrow"
            body="Your entry fee is held in server-side escrow the moment you join — refundable while the tournament is still open, locked once it starts." />
          <Tile icon="emoji_events"   accent={C.gold}   title="3. Play your matches"
            body="Bracket generates automatically. Where game APIs support it, results are detected automatically — no screenshot wars." />
          <Tile icon="payments"       accent={C.ember}  title="4. Prize lands in seconds"
            body="Winner coins hit the wallet within seconds of finalisation. 5% mod cut, the rest goes to placing players per the posted formula." />
        </Grid>
      </Section>

      <Section bordered>
        <H2>Six bracket formats — pick the right one for your event</H2>
        <Grid cols={3} min={220}>
          <Tile icon="account_tree"     accent={C.cyan}   title="Single elimination"
            body="Lose once, you're out. Fastest format — perfect for short evening ladders and weekly cups." />
          <Tile icon="account_tree"     accent={C.violet} title="Double elimination"
            body="Lose twice, you're out. Winners + losers brackets ensure the true champion crowns themselves." />
          <Tile icon="grid_on"          accent={C.gold}   title="Swiss"
            body="Configurable rounds, players paired by record. Great for 16+ entrants without committing to a full single-elim." />
          <Tile icon="public"           accent={C.ember}  title="Battle Royale"
            body="Multi-game format with point accumulation per placement. Built for Apex, Warzone, Fortnite, PUBG." />
          <Tile icon="loop"             accent={C.pink}   title="Round-robin"
            body="Everyone plays everyone. Ideal for small groups (≤8) where every match matters." />
          <Tile icon="psychology"       accent={C.cyan}   title="Custom"
            body="Host non-standard formats with manual bracket entry. Admin override on results when you need it." />
        </Grid>
      </Section>

      <Section bordered>
        <H2>Auto-detected results — no more "I won, no I won"</H2>
        <P max={720}>
          Result reporting is one of the biggest headaches in community tournaments. VERGR auto-detects winners
          wherever the game lets us, falling back to a two-player-agree flow when it doesn't.
        </P>
        <Grid cols={3} min={240}>
          <Tile icon="memory" accent={C.cyan}
            title="Steam GSI — CS2 & Dota 2"
            body="Install the auto-generated config file once. The game itself reports your match outcome to VERGR the moment the post-game screen loads. Zero screenshots needed." />
          <Tile icon="api" accent={C.violet}
            title="Game wrappers — Apex & OW2"
            body="Link your EA/Origin or Battle.net account. We poll the game's stats API and detect the win on the next refresh. Live for Apex Legends and Overwatch 2 today." />
          <Tile icon="how_to_reg" accent={C.gold}
            title="Two-player-agree fallback"
            body="No integration for your game? Both players report the result through the in-app reporter. If you agree, the match advances. If you don't, a Vanguard mod reviews evidence." />
        </Grid>
      </Section>

      <Section bordered>
        <H2>Host your own — keep most of the entry fees flowing back to your community</H2>
        <Grid cols={3} min={240}>
          <Tile icon="vertical_align_top" accent={C.cyan}   title="Up to 10,000 coins per entry"
            body="Cap is locked at 10,000 coins per player. We disclosed this to Riot Games when applying for their tournament API — moving the cap would mean re-notifying them." />
          <Tile icon="bar_chart"          accent={C.violet} title="Up to 500,000 coins in prizes"
            body="Per-tournament prizes top out at 500,000 coins. Plenty of room to run a serious event while keeping things responsible." />
          <Tile icon="shield_person"      accent={C.gold}   title="Fixed 5% platform fee"
            body="VERGR takes 5% of the total prize to fund moderation, escrow, dispute resolution, and the infrastructure. The remaining 95% goes to placing players, never higher." />
        </Grid>
      </Section>

      <Section bordered>
        <H2>Squad tournaments — enter as a team, win as a team</H2>
        <P max={720}>
          Tournaments aren't just solo. Enter as a 5-stack in CS2, a 6-stack in Overwatch 2, or a full squad in any
          team-based title. The bracket runs squad-vs-squad, results count toward the squad leaderboard, and prizes
          drop directly into the squad treasury split however your squad has agreed (equal, contribution-based, or
          leader-defined).
        </P>
      </Section>

      <Section bordered>
        <H2>Disputes — never your word against theirs</H2>
        <P max={720}>
          When players disagree on a result, the match flips to <span className="vg-mono" style={{ color: C.ember }}>disputed</span> and
          a Vanguard moderator reviews it using screenshots, replay data, GSI logs, or wrapper API records — whichever
          is available. Admins have the final word on edge cases. Every action is audit-logged so the same dispute
          never re-litigates.
        </P>
      </Section>

      <Section bordered>
        <div style={{ padding: 20, borderRadius: 12, background: `${C.ember}11`, border: `1px solid ${C.ember}55` }}>
          <div className="vg-syne" style={{ fontSize: 16, fontWeight: 800, color: C.ember, marginBottom: 8 }}>
            Skill-based competitions, not a casino
          </div>
          <div style={{ fontSize: 14, color: C.text2, lineHeight: 1.7 }}>
            VERGR tournaments are competitions of skill with posted rules, verified results, and transparent prize
            distribution. There is no random-chance betting, no slot mechanics, no wagering against the house, no
            loot-box mechanics on prizes. Outcomes are determined by player skill — execution, decision-making,
            strategy. Eligibility to participate depends on age (18+) and jurisdiction. Full rules at{' '}
            <Link to="/platform/learn/tournament-rules" style={{ color: C.cyan }}>/learn/tournament-rules</Link>.
          </div>
        </div>
      </Section>

      <Section bordered>
        <div style={{ textAlign: 'center', padding: '24px 0' }}>
          <H2>Find a tournament. Win some coins.</H2>
          <Link to="/signup" className="vg-btn-primary" style={{ textDecoration: 'none' }}>
            Create my account →
          </Link>
        </div>
      </Section>
    </MarketingShell>
  );
}

export function LearnSquadsScreen() {
  useSeo({
    title: 'Squads — Gaming Crews with Shared Treasuries | VERGR',
    description: 'Up to 100 members. Voice + video hangouts built in. Monthly elections, real roles (President, Vice President, Treasury), and 10% of every tournament win auto-routed to the squad treasury. Discord meets esports team.',
    canonical: 'https://vergr.app/platform/learn/squads',
  });
  return (
    <MarketingShell>
      <PageHero
        title="Squads — Your Gaming Crew, Your Own Org"
        subtitle="Up to 100 members. Voice + video hangouts built in. A shared treasury that grows every time a member wins a tournament. Monthly elections, real roles, real responsibilities. It's a Discord, an esports team, and a co-op savings account, all in one."
        accent="cyan"
        centered
      />

      <Section>
        <H2>What a squad actually is</H2>
        <P max={720}>
          A squad on VERGR is your persistent gaming crew — a private space with shared chat, voice + video
          hangouts, scheduled events, a tournament leaderboard, and a treasury that funds future entry fees
          for the team. Six friends running ranked, or a 100-strong competitive org — the squad is the unit
          that holds it together.
        </P>
      </Section>

      <Section bordered>
        <H2>The hangout — Discord-style, but built in</H2>
        <Grid cols={3} min={240}>
          <Tile icon="mic" accent={C.cyan}
            title="Voice for everyone"
            body="All members can join the squad voice channel. Audio mixed via our own Pion SFU on dedicated infrastructure — no Discord account needed, no third-party app, no leaving VERGR." />
          <Tile icon="videocam" accent={C.violet}
            title="Video for up to 2 at a time"
            body="Two members can share camera or game capture simultaneously. Listeners tap 'Watch' to subscribe to a feed — bandwidth-friendly default, no surprise data bills." />
          <Tile icon="event" accent={C.gold}
            title="Scheduled events"
            body="Built-in calendar with reminders. Run weekly scrims, league nights, watch parties, or strat-review sessions without leaving the squad." />
        </Grid>
      </Section>

      <Section bordered>
        <H2>Roles — squads are democratic, not corporate</H2>
        <P max={720}>
          Squads are governed by elected positions, not handed-down hierarchy. The President is elected by
          the members on the 1st of every month, and they appoint other officers from candidates the squad votes on.
          If the President goes inactive for 4+ days, the Vice President can call a new election. The squad
          owns itself.
        </P>
        <Grid cols={3} min={220}>
          <Tile icon="workspace_premium" accent={C.gold}
            title="👑 President"
            body="Elected monthly. Makes final decisions on treasury spending and squad direction. Can veto any officer choice. Active leadership is rewarded — inactivity triggers a re-vote." />
          <Tile icon="star" accent={C.violet}
            title="⭐ Vice President"
            body="Second-in-command. Can call a new presidential election if the current president goes inactive for 4+ days. Steps in for absent leadership." />
          <Tile icon="payments" accent={C.cyan}
            title="💰 Treasury Secretary"
            body="Manages the squad wallet, distributions to members, and tournament entry-fee funding. Can move coins between treasury buckets but cannot solo-veto the president." />
          <Tile icon="shield" accent={C.ember}
            title="🛡️ Security / General"
            body="Moderates squad chat. Can mute disruptive members and start kick votes. The squad's first line of defence against toxicity." />
          <Tile icon="group" accent={C.pink}
            title="⚔️ Member"
            body="Standard squad member. Full access to voice, video, events, clips, and the squad feed. Votes on every election and every treasury motion above a configurable threshold." />
        </Grid>
      </Section>

      <Section bordered>
        <H2>Squad treasury: 10% of every tournament win, auto-collected</H2>
        <P max={720}>
          When any squad member wins a tournament, <strong>10% of the prize automatically goes to the squad
          treasury</strong>. That treasury funds future tournament entries, so the squad can subsidise smaller
          members getting into bigger events, run scrim leagues with covered entry fees, or pay out to members
          on a Treasury Secretary motion approved by the President.
        </P>
        <Grid cols={3} min={240}>
          <Tile icon="auto_awesome" accent={C.cyan}
            title="Auto-contribution"
            body="10% of any tournament prize a squad member wins is automatically routed to the squad treasury. No admin step, no chasing members for their cut." />
          <Tile icon="account_balance_wallet" accent={C.violet}
            title="Treasury-funded entries"
            body="The treasury covers tournament entry fees for members the squad wants to back. Affordable path into bigger events for the team's best players." />
          <Tile icon="how_to_vote" accent={C.gold}
            title="Distributions need a vote"
            body="Treasury Secretary can propose a payout — the President signs off. Larger distributions trigger a member vote. The treasury isn't anyone's piggy bank." />
        </Grid>
      </Section>

      <Section bordered>
        <H2>Compete as a team — squad tournaments</H2>
        <P max={720}>
          Squad tournaments are 5-stack CS2, 6-stack Overwatch 2, full-squad Valorant — your squad enters as
          a team, results count toward the squad leaderboard, prizes drop into the squad treasury. Climb
          the leaderboard and bigger leagues invite you in. Build a reputation as a team, not as scattered
          solo queues.
        </P>
      </Section>

      <Section bordered>
        <div style={{ textAlign: 'center', padding: '24px 0' }}>
          <H2>Build your crew. Win together.</H2>
          <Link to="/signup" className="vg-btn-primary" style={{ textDecoration: 'none' }}>
            Create my account →
          </Link>
        </div>
      </Section>
    </MarketingShell>
  );
}

export function LearnClipsScreen() {
  useSeo({
    title: 'Gaming Clips — Upload, Share, Earn | VERGR',
    description: 'Upload your clutch moments or embed YouTube/Twitch clips. Up to 60s (Free), 3min (Lite), or 10min (Pro). Earn VP from views and tips. Discover clips from squads and the global feed.',
    canonical: 'https://vergr.app/platform/learn/clips',
  });
  return (
    <MarketingShell>
      <PageHero
        title="Clips"
        subtitle="Capture the clutch moments. Share them with your followers. Earn from the views and tips they bring in."
        accent="pink"
        centered
      />
      <Section>
        <H2>How clips work</H2>
        <Grid cols={3} min={240}>
          <Tile icon="cloud_upload" accent={C.cyan}   title="Upload from your device"
            body="Record on your console, PC, or phone, then upload to VERGR. Client-side compression means even slow connections post fast." />
          <Tile icon="link"         accent={C.violet} title="Or embed an external link"
            body="Paste a YouTube, Twitch, or Streamable URL and VERGR pulls the video in. Keep your existing edit workflow." />
          <Tile icon="share"        accent={C.pink}   title="Share + earn"
            body="Clips appear on your profile, in your followers' feeds, and in your squad's clips feed. Views and tips earn you VP." />
        </Grid>
      </Section>
      <Section bordered>
        <H2>Per-tier upload length</H2>
        <Grid cols={3} min={220}>
          <Tile icon="hd" accent={C.cyan}   title="Free"  body="Up to 60-second clips. Standard quality." />
          <Tile icon="hd" accent={C.violet} title="Lite"  body="Up to 3-minute clips. 720p quality." />
          <Tile icon="4k" accent={C.gold}   title="Pro"   body="Up to 10-minute clips. 1080p quality, full upload resolution preserved." />
        </Grid>
      </Section>
      <Section bordered>
        <H2>Discovery</H2>
        <P>
          Clips surface in three feeds: your own clips page (every clip you've posted), the global clips feed
          (algorithmically ranked), and your squad's clips feed (clips posted by members of your squad).
        </P>
      </Section>
      <Section bordered>
        <div style={{
          padding: 16, borderRadius: 12,
          background: `${C.cyan}08`,
          border: `1px solid ${C.cyan}33`,
          display: 'flex', alignItems: 'flex-start', gap: 12,
        }}>
          <span style={{ color: C.cyan }}><Icon name="schedule" size={20} /></span>
          <div>
            <div className="vg-syne" style={{ fontSize: 14, fontWeight: 800, color: C.cyan }}>Coming with the live-streaming rollout: in-stream Tap to Clip</div>
            <div style={{ fontSize: 13, color: C.text2, marginTop: 6, lineHeight: 1.6 }}>
              The in-stream "clip the last N seconds" button — letting viewers grab a moment from a running
              live stream without leaving the player — ships alongside the public live-streaming launch. Uploading
              and viewing clips already works today.
            </div>
          </div>
        </div>
      </Section>
    </MarketingShell>
  );
}

export function LearnCoinsScreen() {
  useSeo({
    title: 'VC Coins — Gaming Currency You Can Cash Out | VERGR',
    description: 'Buy coins from €0.99 to €224.99 with crypto or card. Tip streamers, enter tournaments, boost streams. Earn coins from your audience and convert to gems for crypto cash-out.',
    canonical: 'https://vergr.app/platform/learn/coins',
  });
  return (
    <MarketingShell>
      <PageHero
        title="VC Coins — The Currency Behind Gaming Earnings"
        subtitle="Buy coins to play, tip, and enter tournaments. Earn coins from your audience, your competitions, and your community. Convert to gems and cash out to crypto when you're ready to move money out."
        accent="gold"
        centered
      />

      <Section>
        <H2>How the in-game currency works</H2>
        <Grid cols={4} min={220}>
          <Tile icon="shopping_cart" accent={C.gold}
            title="Buy coins"
            body="Eight pack sizes from €0.99 to €224.99. Bigger packs scale to a lower per-coin price." />
          <Tile icon="payments" accent={C.violet}
            title="Spend on platform"
            body="Tip your favourite streamers, subscribe to memberships, enter tournaments, boost your own stream's reach, unlock customisation." />
          <Tile icon="trending_up" accent={C.cyan}
            title="Earn from activity"
            body="Tournament wins, tips from viewers, paid memberships, squad treasury distributions — every income source on VERGR pays in coins." />
          <Tile icon="account_balance_wallet" accent={C.ember}
            title="Cash out"
            body="Convert coins to gems at your rank's commission, request a payout in cryptocurrency. Real money out, not just spend-only credit." />
        </Grid>
      </Section>

      <Section bordered>
        <H2>Pack catalog</H2>
        <P max={680}>
          Bigger packs scale to a lower per-coin price. The economy floor is <strong>€0.0090 per coin</strong>, and full-price packs
          never drop below it. Coin prices are fixed and transparent, so everyone pays the same. The way to get more value
          is to buy a larger pack for a better per-coin rate, with bonus VP on the top tiers.
        </P>
        <div style={{
          marginTop: 16, display: 'grid', gap: 12,
          gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
        }}>
          {COIN_PACKS.map(pack => <PublicPackCard key={pack.id} pack={pack} />)}
        </div>
      </Section>

      <Section bordered>
        <H2>How you actually pay</H2>
        <Grid cols={2} min={260}>
          <Tile icon="credit_card" accent={C.violet}
            title="Card, Apple Pay, or bank"
            body="Pay with Visa, Mastercard, Apple Pay, Google Pay, or bank transfer through our secure checkout — it opens right inside the app. No crypto knowledge needed." />
          <Tile icon="bolt" accent={C.cyan}
            title="Settlement"
            body="Coins land in your wallet within seconds of payment confirmation. You can immediately tip, subscribe, enter a tournament, or boost a stream." />
        </Grid>
      </Section>

      <Section bordered>
        <H2>How coins become real money</H2>
        <P max={720}>
          When you earn coins from tips, memberships, or tournament wins, you can convert them to <strong>Gems</strong>{' '}
          at a commission rate tied to your VP rank. Gems are the only currency that withdraws to your crypto
          wallet — minimum 1,000 gems (~€10), with a 7-day fraud-review hold before processing. The payment
          processor and network gas fees are deducted from your withdrawal at confirmation; they're not VERGR's
          revenue, just the cost of moving the crypto.
        </P>
        <P max={720}>
          The commission scale rewards engagement: Rookie (Level 1) starts at 30%, dropping linearly with every
          level you gain. By Immortal (Level 100) you're keeping 90% of every conversion — a 20-percentage-point
          margin improvement just from playing the platform actively.
        </P>
        <Link to="/platform/monetization" style={{ color: C.cyan, fontSize: 14, fontWeight: 700, textDecoration: 'none' }}>
          See the full rank-by-rank commission table →
        </Link>
      </Section>

      <Section bordered>
        <H2>The economy in one paragraph</H2>
        <P max={720}>
          Coins flow IN through purchases and out through creator earnings + tournament prizes. VERGR earns from
          a flat 10% platform fee on tips and a tier-based commission on coin-to-gem conversion (your rank lever).
          That's it. No ads, no hidden fees, no "sponsored slot" carved out of your feed. Payment processors charge
          their own fees on inbound purchases and outbound withdrawals — these pass through to/from you directly
          and aren't VERGR revenue. Subscriptions (€4.99 Lite / €9.99 Pro) buy you platform features — they never
          buy you a margin advantage on the parts of the economy that matter.
        </P>
      </Section>

      <Section bordered>
        <div style={{ textAlign: 'center', padding: '24px 0' }}>
          <H2>Get your first pack</H2>
          <P max={580}>
            Pick a pack that fits how you play. Starter for casual tipping, Pro Pack for entering your first tournament,
            Champion if you're going to grind it out. You can top up any time.
          </P>
          <Link to="/signup" className="vg-btn-primary" style={{ marginTop: 12, textDecoration: 'none' }}>
            Create account →
          </Link>
        </div>
      </Section>
    </MarketingShell>
  );
}


// ═════════════════════════════════════════════════════════════════════
// Legal documents — Terms, Privacy, Tournament Rules, Acceptable Use,
// Cookie Policy. The text lives in ./legal/legalContent.js (imported
// at the top of this file). This section is just the on-screen renderer.
// ═════════════════════════════════════════════════════════════════════


// Renders one paragraph or list within a legal section.
function LegalBodyBlock({ block }) {
  if (typeof block === 'string') {
    return <p style={{ marginTop: 10, fontSize: 15, lineHeight: 1.75, color: C.text2 }}>{block}</p>;
  }
  if (block && block.type === 'list') {
    return (
      <ul style={{
        marginTop: 10, marginBottom: 4, paddingLeft: 22,
        listStyleType: 'disc',
      }}>
        {block.items.map((item, i) => (
          <li key={i} style={{
            marginTop: i === 0 ? 0 : 8, fontSize: 15, lineHeight: 1.7, color: C.text2,
          }}>{item}</li>
        ))}
      </ul>
    );
  }
  return null;
}

// Renders a single numbered section with a heading + body blocks.
function LegalSection({ section }) {
  return (
    <section id={section.id} style={{ scrollMarginTop: 100 }}>
      <h2 className="vg-syne" style={{
        fontSize: 22, fontWeight: 800, margin: 0, color: C.text,
        letterSpacing: '-0.01em',
      }}>{section.title}</h2>
      {section.body.map((block, i) => (
        <LegalBodyBlock key={i} block={block} />
      ))}
    </section>
  );
}

export function LegalScreen({ type }) {
  const page = LEGAL_DOCUMENTS[type] || LEGAL_DOCUMENTS.privacy;
  const introBlocks = Array.isArray(page.intro) ? page.intro : [page.intro];
  return (
    <MarketingShell>
      <section className="vg-section" style={{ padding: '40px 32px 80px' }}>
        <article style={{
          maxWidth: 880, margin: '0 auto',
          padding: 'clamp(24px, 5vw, 40px)', borderRadius: 16,
          background: C.surface,
          border: `1px solid ${C.borderSoft}`,
        }}>
          <p className="vg-mono" style={{
            fontSize: 11, fontWeight: 700, color: C.cyan,
            textTransform: 'uppercase', letterSpacing: '0.18em',
          }}>{page.updated}{page.effective ? ` · ${page.effective}` : ''} · v{page.version}</p>
          <h1 className="vg-syne" style={{
            marginTop: 12, fontSize: 'clamp(28px, 5vw, 42px)',
            fontWeight: 800, letterSpacing: '-0.02em', color: C.text,
          }}>{page.label}</h1>

          {introBlocks.map((p, i) => (
            <p key={i} style={{ marginTop: i === 0 ? 16 : 12, fontSize: 16, lineHeight: 1.7, color: C.text2 }}>{p}</p>
          ))}

          {/* Table of contents */}
          <nav aria-label="Sections" style={{
            marginTop: 28, padding: '16px 18px',
            borderRadius: 12, background: 'rgba(255,255,255,0.02)',
            border: `1px solid ${C.borderSoft}`,
          }}>
            <p className="vg-mono" style={{
              fontSize: 10, fontWeight: 700, color: C.text3,
              textTransform: 'uppercase', letterSpacing: '0.18em', margin: 0, marginBottom: 8,
            }}>Contents</p>
            <ol style={{ margin: 0, paddingLeft: 22, color: C.text2, fontSize: 14, lineHeight: 1.85 }}>
              {page.sections.map(s => (
                <li key={s.id}>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.preventDefault();
                      const el = document.getElementById(s.id);
                      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
                    }}
                    style={{
                      background: 'transparent', border: 'none', padding: 0,
                      color: C.text2, cursor: 'pointer', font: 'inherit',
                      textAlign: 'left',
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.color = C.text; }}
                    onMouseLeave={(e) => { e.currentTarget.style.color = C.text2; }}
                  >{s.title}</button>
                </li>
              ))}
            </ol>
          </nav>

          <div style={{ marginTop: 32, display: 'flex', flexDirection: 'column', gap: 32 }}>
            {page.sections.map(s => <LegalSection key={s.id} section={s} />)}
          </div>
        </article>
      </section>
    </MarketingShell>
  );
}

// Exported so the signup flow + force-acceptance modal can show "Terms
// updated to version X" and decide whether to re-prompt the user.
export const CURRENT_LEGAL_VERSION = LEGAL_FILE_VERSION;

// ============================================================
// For Creators — the Twitch-acquisition landing page
// (14_GROWTH_MIGRATION §4.1). The commission comparison uses Twitch's
// PUBLISHED terms, verified + founder-approved 2026-07-15; the footnote
// dates them. Payout path stated honestly (coins → gems → USDC incl. the
// rank-based conversion commission) — an inflated claim here would cost
// more trust than it wins.
// ============================================================
export function CreatorsLandingScreen() {
  useSeo({
    title: 'For Creators — Keep 90% From Your First Fan | VERGR',
    description: 'VERGR takes a flat 10% on tips and memberships — you keep 90% from day one, no points program, no tier ladder. Mirror your stream to Twitch while you grow here. Trying it costs nothing.',
    canonical: 'https://vergr.app/platform/creators',
  });
  const rows = [
    ['Memberships / subs', 'You keep 90%, from your first fan', 'Default 50/50. 60/40 needs 100 Plus Points, 70/30 needs 300 — each held 3 straight months; gifted + Prime subs don\'t count'],
    ['Tips / cheers', 'Flat 10% fee — tip 100 coins, creator gets 90', 'Bits: your viewer pays ~$1.40 per 100, you receive $1.00'],
    ['Getting paid', '1,000-gem minimum, withdraw as USDC', '$100 minimum payout'],
    ['Starting out', 'Same 90% on day one as at 1M followers', 'Best rates are gated behind sustained sub counts'],
  ];
  return (
    <MarketingShell>
      <PageHero
        title="Keep 90% from your first fan"
        subtitle="VERGR takes a flat 10% on tips and memberships. No points program, no 3-month holds, no tier ladder — the rate every creator gets is the rate you get on day one."
        accent="violet"
      />

      <Section>
        <H2>The math, side by side</H2>
        <div style={{
          marginTop: 16, borderRadius: 16, overflow: 'hidden',
          border: `1px solid ${C.borderSoft}`, background: 'var(--vg-grad-card)',
        }}>
          <div style={{
            display: 'grid', gridTemplateColumns: '1fr 1.2fr 1.6fr', gap: 14,
            padding: '14px 18px', background: 'rgba(123,111,255,0.08)',
            borderBottom: `1px solid ${C.borderSoft}`,
            fontSize: 11, fontWeight: 700, letterSpacing: '0.12em',
            color: C.text3, textTransform: 'uppercase',
          }}>
            <div />
            <div style={{ color: C.violet }}>VERGR</div>
            <div>Twitch</div>
          </div>
          {rows.map(([label, us, them]) => (
            <div key={label} style={{
              display: 'grid', gridTemplateColumns: '1fr 1.2fr 1.6fr', gap: 14,
              padding: '16px 18px', borderBottom: `1px solid ${C.borderSoft}`,
              fontSize: 14, lineHeight: 1.5,
            }}>
              <div style={{ fontWeight: 700, color: C.text }}>{label}</div>
              <div style={{ color: C.text, fontWeight: 600 }}>{us}</div>
              <div style={{ color: C.text2 }}>{them}</div>
            </div>
          ))}
        </div>
        <p style={{ marginTop: 10, fontSize: 12, color: C.text3 }}>
          Twitch figures are their published terms as of July 2026 (default sub split, Plus Program thresholds, Bits pricing, payout minimum). Check twitch.tv for current terms.
        </p>
      </Section>

      <Section bordered>
        <H2>Trying VERGR costs you nothing</H2>
        <P max={720}>
          The Twitch mirror forwards your VERGR stream to your Twitch channel in real time. You go live here,
          your Twitch audience sees the same stream on the same channel they always watch — nothing changes for
          them, while your VERGR channel and its 90% economics grow underneath.
        </P>
        <Grid cols={3} min={240}>
          <Tile icon="cast" accent={C.violet} title="Stream to both"
            body="Link Twitch once, then flip the mirror toggle in go-live setup. One broadcast, two audiences." />
          <Tile icon="forum" accent={C.pink} title="One chat"
            body="The chat bridge relays your Twitch chat into your VERGR stream, so the conversation stays whole." />
          <Tile icon="query_stats" accent={C.gold} title="See where fans watch"
            body="Your stream-end recap counts viewers per platform, so you watch the migration happen." />
        </Grid>
      </Section>

      <Section bordered>
        <H2>How you actually get paid</H2>
        <P max={720}>
          No asterisks: fans tip and subscribe with VC Coins, and 90% lands in your wallet instantly. Coins are
          spendable on VERGR as-is. To cash out, you convert coins to gems — that conversion carries a commission
          that starts at 30% and falls to a 15% floor as your rank grows — then withdraw gems as USDC
          (1,000-gem minimum). Most creators spend some and cash out some; the split is yours.
        </P>
        <div style={{ marginTop: 8 }}>
          <Bullet icon="paid" color={C.gold} title="Earn" body="Tips and memberships credit your wallet in coins, 90% of every payment." />
          <Bullet icon="swap_horiz" color={C.violet} title="Convert" body="Coins → gems at your rank's commission (30% at the start, 15% floor as you climb)." />
          <Bullet icon="account_balance_wallet" color={C.pink} title="Withdraw" body="Gems → USDC to your wallet. 1,000-gem minimum, fraud-review hold, network fees shown at confirmation." />
        </div>
      </Section>

      <Section bordered>
        <H2>Bring your channel over in one tap</H2>
        <P max={720}>
          Link your Twitch account and VERGR sets you up: your display name and bio prefill your profile, and a
          starter vergr.me link-in-bio page is generated with your existing VODs and clips embedded. Recruit other
          streamers with your referral link and you earn a share of their supporters' coin purchases for two years.
        </P>
        <div style={{ marginTop: 20, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <Link to="/signup" style={{
            padding: '14px 28px', borderRadius: 12, fontWeight: 800, fontSize: 15,
            background: `linear-gradient(90deg, ${C.violet}, ${C.pink})`, color: '#fff', textDecoration: 'none',
          }}>Create your channel</Link>
          <Link to="/platform/learn/live" style={{
            padding: '14px 28px', borderRadius: 12, fontWeight: 800, fontSize: 15,
            border: `1px solid ${C.borderSoft}`, color: C.text, textDecoration: 'none',
          }}>How streaming works</Link>
        </div>
      </Section>
    </MarketingShell>
  );
}
