// ReferIntroGate: tells every NEW account about Refer & Earn, once.
//
// Founder, 2026-09-10: "notify every new user of the Refer & Earn since we need
// to grow our userbase fast ... we can't just wait for users to stumble across
// it". The referral screen, the rewards and the revenue share all existed and
// nothing pointed a new user at them.
//
// Mounted app-wide next to TosVersionGate, so it reaches every signup path (email,
// Google, the Play app) the first time the account lands in the app after
// onboarding. Shown once per account: `users/{uid}.referIntroSeen` is written on
// any close, with a localStorage mirror so a failed write never re-shows it.
//
// ⚠ EVERY NUMBER HERE IS READ FROM THE SOURCE, NOT RESTATED. The VP amounts are
// the vpSystem constants the server pays; the coin share is 1% rising to a 3%
// cap (functions/referralRevenue.js BASE_RATE / MAX_RATE). If either changes,
// this copy must change with it.
import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { doc, updateDoc } from 'firebase/firestore';
import { useAuth } from '../context/AuthContext';
import { useUser } from '../context/UserContext';
import { db } from '../firebase/config';
import useResponsive from '../hooks/useResponsive';
import { REFERRAL_VP_REFERRER, REFERRAL_VP_REFEREE } from '../utils/vpSystem';
import { CoinIcon, VPIcon } from './CoinIcon';
import Icon from './Icon';

// Only accounts created from this date: "every new user", not a pop-up for the
// existing base. 2026-09-10 UTC (month index 8 is September).
const SHOW_FOR_ACCOUNTS_FROM = Date.UTC(2026, 8, 10);

// Never interrupt signup, onboarding, the referral screen itself, a live
// stream or a call.
const QUIET_PREFIXES = ['/onboarding', '/signup', '/login', '/reflink', '/earn/refer', '/wallet/referral', '/watch', '/broadcast', '/call', '/platform'];

const T = { panel: '#14141F', row: '#1A1A2A', text: '#e8e8f0', dim: '#a0a0b8', muted: '#6b7280', purple: '#7c3aed', purpleLight: '#b44fff', gold: '#F5C842' };

const toMs = (t) => {
  if (!t) return 0;
  if (typeof t.toMillis === 'function') return t.toMillis();
  if (typeof t.seconds === 'number') return t.seconds * 1000;
  if (typeof t === 'number') return t;
  const p = Date.parse(t);
  return Number.isFinite(p) ? p : 0;
};

export default function ReferIntroGate() {
  const { currentUser } = useAuth();
  const { profile } = useUser();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const { isDesktop } = useResponsive();
  const [open, setOpen] = useState(false);

  const uid = currentUser?.uid;
  const localKey = uid ? `vergr.referIntroSeen.${uid}` : '';
  const eligible = !!(
    uid && !currentUser.isAnonymous && profile && profile.isOnboarded === true
    && !profile.referIntroSeen && toMs(profile.createdAt) >= SHOW_FOR_ACCOUNTS_FROM
  );
  const quiet = QUIET_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + '/'));

  useEffect(() => {
    if (!eligible || quiet || open) return undefined;
    try { if (localStorage.getItem(localKey)) return undefined; } catch { /* private mode */ }
    // A beat after landing, so it never fights the first paint of home.
    const t = setTimeout(() => setOpen(true), 1200);
    return () => clearTimeout(t);
  }, [eligible, quiet, open, localKey]);

  if (!open) return null;

  const done = (goTo = null) => {
    setOpen(false);
    try { localStorage.setItem(localKey, '1'); } catch { /* private mode */ }
    updateDoc(doc(db, 'users', uid), { referIntroSeen: true }).catch(() => {});
    if (goTo) navigate(goTo);
  };

  const card = (
    <div onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Refer and earn" style={{
      width: isDesktop ? 420 : '100%', background: T.panel, color: T.text,
      borderRadius: isDesktop ? 22 : '22px 22px 0 0',
      padding: '22px 20px', paddingBottom: isDesktop ? 22 : 'calc(22px + var(--vg-safe-b, 0px))',
      boxShadow: '0 -12px 40px rgba(0,0,0,0.5)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
        <span style={{ width: 44, height: 44, borderRadius: 14, background: `linear-gradient(135deg, ${T.purple}, ${T.purpleLight})`, display: 'grid', placeItems: 'center', flexShrink: 0 }}>
          <Icon name="group_add" size={24} style={{ color: '#fff' }} />
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="font-syne" style={{ fontSize: 19, fontWeight: 800, lineHeight: 1.15 }}>Invite friends, earn together</div>
          <div style={{ fontSize: 12.5, color: T.dim, marginTop: 3 }}>Refer & Earn is open on your account.</div>
        </div>
        <button type="button" aria-label="Close" onClick={() => done()} style={{ width: 32, height: 32, borderRadius: '50%', border: 'none', background: T.row, color: T.dim, cursor: 'pointer', display: 'grid', placeItems: 'center', flexShrink: 0 }}>
          <Icon name="close" size={17} />
        </button>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ display: 'flex', gap: 12, padding: 12, borderRadius: 14, background: T.row }}>
          <VPIcon size={26} />
          <div style={{ fontSize: 13, lineHeight: 1.5 }}>
            <b>You get {REFERRAL_VP_REFERRER.toLocaleString()} VP</b> and your friend gets {REFERRAL_VP_REFEREE.toLocaleString()} VP
            when they join with your link and verify their phone.
          </div>
        </div>
        <div style={{ display: 'flex', gap: 12, padding: 12, borderRadius: 14, background: T.row }}>
          <CoinIcon size={26} />
          <div style={{ fontSize: 13, lineHeight: 1.5 }}>
            <b>You earn coins too:</b> 1% of every coin purchase they make for two years,
            rising to 3% as more of your friends go Lite or Pro.
          </div>
        </div>
      </div>

      <button type="button" onClick={() => done('/earn/refer')} style={{
        width: '100%', marginTop: 16, padding: 14, borderRadius: 14, border: 'none', cursor: 'pointer',
        background: `linear-gradient(135deg, ${T.purple}, ${T.purpleLight})`, color: '#fff', fontSize: 14, fontWeight: 800,
        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
      }}>
        <Icon name="link" size={18} /> Get my invite link
      </button>
      <button type="button" onClick={() => done()} style={{
        width: '100%', marginTop: 8, padding: 12, borderRadius: 14, border: 'none', cursor: 'pointer',
        background: 'transparent', color: T.dim, fontSize: 13, fontWeight: 700,
      }}>Maybe later</button>
    </div>
  );

  return (
    <div onClick={() => done()} style={{
      position: 'fixed', inset: 0, zIndex: 9000, background: 'rgba(0,0,0,0.6)',
      display: 'flex', alignItems: isDesktop ? 'center' : 'flex-end', justifyContent: 'center',
      padding: isDesktop ? 24 : 0,
    }}>
      {card}
    </div>
  );
}
