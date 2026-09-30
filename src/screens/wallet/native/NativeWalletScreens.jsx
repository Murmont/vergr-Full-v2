// NATIVE-APP wallet screens (Android/iOS Tauri shell ONLY).
//
// Why these exist separately from src/screens/wallet/v2/*:
// The native Android System WebView reports an inflated layout width, which
// defeats width media queries — so the desktop/web v2 screens (multi-column
// grids that collapse via @media) render desktop-wide and squashed on a phone.
// These screens are built MOBILE-NATIVE from the ground up: every section is a
// single-column flexbox stack with NO grid-collapse and NO media queries, so
// the reported viewport width is irrelevant. They render single-column at any
// width by construction. The desktop + mobile-web screens are untouched.
//
// Routed in AppRouter: isMobileApp() ? <Native*> : <v2 *>.

import { useEffect, useState, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useUser } from '../../../context/UserContext';
import useAppGate, { codaOfferedTo } from '../../../hooks/useAppGate';
import { CodaCheckoutBlock } from '../../../components/wallet/CodaPay';
import { useUI } from '../../../context/UIContext';
import { useWalletUnlock } from '../../../context/WalletUnlockContext';
import {
  WalletCard, WalletButton, SectionLabel, Pill, Callout, FeeBreakdown,
  CoinGlyph, GemGlyph, VPGlyph, AnimatedNumber, StatusPill,
  WALLET_TOKENS, fmtNum, fmtEUR, fmtUsd, txAmount,
} from '../../../components/wallet/primitives';
import Icon from '../../../components/Icon';
import { getTransactions } from '../../../firebase/firestore';
import { getVPLevel, getNextVPLevel, COIN_PACKS, COIN_VALUE_USD } from '../../../utils/vpSystem';
import { IS_STORE_BUILD, IS_HUAWEI_BUILD, IS_PLAY_BUILD, STORE_NAME } from '../../../utils/platform';
import { useAuth } from '../../../context/AuthContext';
import { useCart } from '../../../context/CartContext';
import {
  isPlayBillingSupported, fetchPlayPrices, playProductIdFor,
} from '../../../utils/nativeBilling';

// ONE LADDER, EVERYWHERE — web, Play and Huawei sell the identical packs.
//
// There used to be a second, reduced ladder for Play builds. It is gone: a Play
// IAP product has one fixed quantity, so a second ladder meant the shelf and the
// Play purchase sheet disagreed about what was being sold. Google's cut is
// absorbed in the PRICE of the Play SKU instead, which is set in Play Console
// and read back at runtime through fetchPlayPrices(). See storePricing.js.
const ACTIVE_COIN_PACKS = COIN_PACKS;
import { getMyWalletSecurityStatus } from '../../../firebase/walletCallables';
import { auth } from '../../../firebase/config';
import { useBuyCheckout, MIN_CUSTOM_USD, COIN_PRICE_USD } from '../v2/buyCheckout';
import { BonusPacksTab, BoostsTab } from '../../../components/wallet/StoreTabs';
import UserName from '../../../components/UserName';
import { useActiveCoinPromo, promoBonusForPack } from '../../../utils/coinPromo';

// COIN_VALUE_USD comes from vpSystem (imported above) and is never re-declared
// here. This file used to hardcode `GEM_TO_EUR = 0.009`, which
// understated every money figure on the native wallet by 10%.
const COL = { display: 'flex', flexDirection: 'column' };

const useGreeting = () => {
  const h = new Date().getHours();
  if (h < 5)  return 'Good evening';
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
};

// ───────────────────────────────────────────────────────── HOME

export function NativeHomeScreen() {
  const { profile, wallet } = useUser();
  const { requirePin } = useWalletUnlock();
  const navigate = useNavigate();
  const [txs, setTxs] = useState([]);
  const [secStatus, setSecStatus] = useState(null);
  const greeting = useGreeting();

  useEffect(() => {
    if (!profile?.uid) return;
    getTransactions(profile.uid, 5).then(setTxs).catch(() => {});
    getMyWalletSecurityStatus().then(setSecStatus).catch(() => {});
  }, [profile?.uid]);

  const coins = wallet?.balance || 0;
  // Boost coins: the monthly plan bonus, sale bonuses, ad rewards and some
  // hype trains pay them. They buy boosts and VP packs only, never tips.
  const boostCoins = Math.max(0, Math.floor(Number(wallet?.boostCoins) || 0));

  const vp    = wallet?.vp      || 0;
  const vpInfo = getVPLevel(vp);
  const vpNext = getNextVPLevel(vp);

  const kycLevel = secStatus?.kycLevel ?? 0;
  const frozen = !!secStatus?.walletFrozen;

  const tryGo = (path) => requirePin(() => navigate(path));

  return (
    <div style={{ ...COL, gap: 18, width: '100%', maxWidth: '100%' }}>
      {frozen && (
        <Callout tone="danger" icon="report" title="Your wallet is frozen">
          Buying and spending are paused. Reach support to resolve.
        </Callout>
      )}

      {/* Greeting */}
      <div>
        <div style={{ fontFamily: 'Syne, sans-serif', fontWeight: 700, fontSize: 24, letterSpacing: '-0.02em' }}>
          {greeting}{profile?.displayName ? `, ${profile.displayName.split(' ')[0]}.` : '.'}
        </div>
        <div style={{ color: WALLET_TOKENS.textSecondary, fontSize: 13, marginTop: 2 }}>
          Your wallet, your earnings.
        </div>
      </div>

      {/* Security chips */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <Chip ok={secStatus?.pinSet}       label="PIN" />
        <Chip ok={secStatus?.totpEnrolled} label="2FA" />
        <Chip ok={kycLevel >= 1}           label={`KYC L${kycLevel}`} />
      </div>

      {/* Balances — full-width stacked cards */}
      <NativeBal
        glyph={<CoinGlyph size={28} />} label="Coins" labelColor={WALLET_TOKENS.gold}
        value={coins} valueColor={WALLET_TOKENS.goldLight} fiat={fmtUsd(coins * COIN_VALUE_USD)}
        extra={boostCoins > 0 ? (
              <div style={{ marginTop: 6, fontSize: 12, color: WALLET_TOKENS.textMuted }}>
                + <span className="font-dmmono tabular-nums" style={{ color: WALLET_TOKENS.goldLight, fontWeight: 700 }}>{fmtNum(boostCoins)}</span> boost coins, for boosts and VP packs
              </div>
            ) : null}
        actions={<>
          <WalletButton size="sm" variant="primary" onClick={() => navigate('/wallet/buy')}>Buy</WalletButton>
        </>}
      />
      <NativeBal
        glyph={<VPGlyph size={28} />} label="VP" labelColor={WALLET_TOKENS.violetLight}
        value={vp} valueColor={WALLET_TOKENS.violetLight}
        extra={
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginTop: 8 }}>
            <Pill tone="violet" size="sm">{vpInfo.name} · Lvl {vpInfo.level}</Pill>
            {vpNext && <span className="font-dmmono" style={{ fontSize: 12, color: WALLET_TOKENS.textMuted }}>
              {fmtNum(Math.max(0, vpNext.vpRequired - vp))} VP to Lvl {vpNext.level}
            </span>}
          </div>
        }
      />

      {/* Quick actions — fixed 2-up grid (renders 2 cols at any width) */}
      <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' }}>
        <QuickAction icon="shopping_cart" color={WALLET_TOKENS.gold} title="Buy coins" sub={IS_STORE_BUILD ? STORE_NAME : 'Card or bank'} onClick={() => navigate('/wallet/buy')} />
      </div>


      {/* Recent activity */}
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <h2 style={{ fontFamily: 'Syne, sans-serif', fontWeight: 700, fontSize: 16 }}>Recent activity</h2>
          <button onClick={() => navigate('/wallet/history')} style={{
            fontSize: 12, color: WALLET_TOKENS.violetLight, background: 'transparent',
            border: 'none', display: 'inline-flex', alignItems: 'center', gap: 4,
          }}>View all <Icon name="arrow_forward" size={14} /></button>
        </div>
        <WalletCard padding={6}>
          {txs.length === 0 ? (
            <div style={{ padding: 36, textAlign: 'center', color: WALLET_TOKENS.textMuted, fontSize: 13 }}>
              Nothing here yet.
            </div>
          ) : txs.map(t => <TxRow key={t.id} tx={t} />)}
        </WalletCard>
      </div>

      {/* Security */}
      <WalletCard>
        <SectionLabel>Security</SectionLabel>
        <div style={{ ...COL, gap: 10 }}>
          <SecRow ok={!!secStatus?.pinSet}       label={secStatus?.pinSet ? 'PIN set' : 'Set up your PIN'} />
          <SecRow ok={!!secStatus?.totpEnrolled} label={secStatus?.totpEnrolled ? '2FA on' : '2FA off (recommended)'} />
          <SecRow ok={kycLevel >= 1}             label={kycLevel >= 1 ? `KYC Level ${kycLevel}` : 'KYC not started'} />
        </div>
        <button onClick={() => navigate('/wallet/security')} style={{
          marginTop: 12, background: 'transparent', border: 'none', color: WALLET_TOKENS.violetLight,
          fontSize: 12, padding: 0, display: 'inline-flex', alignItems: 'center', gap: 4,
        }}>Manage security <Icon name="arrow_forward" size={14} /></button>
      </WalletCard>
    </div>
  );
}

function NativeBal({ glyph, label, labelColor, value, valueColor, fiat, extra, actions, note }) {
  return (
    <div style={{
      ...COL, width: '100%', padding: 18, borderRadius: 16,
      background: WALLET_TOKENS.surface1, border: `1px solid ${WALLET_TOKENS.hairline}`,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {glyph}
          <span style={{ fontSize: 10, letterSpacing: '0.12em', textTransform: 'uppercase', color: labelColor, fontWeight: 600 }}>{label}</span>
        </div>
        <div className="font-dmmono tabular-nums" style={{ fontSize: 34, lineHeight: 1, fontWeight: 700, color: valueColor, letterSpacing: '-0.03em' }}>
          <AnimatedNumber value={value} />
        </div>
      </div>
      {fiat && <div className="font-dmmono" style={{ fontSize: 12, color: WALLET_TOKENS.textMuted }}>≈ {fiat}</div>}
      {extra}
      {note && <div style={{ fontSize: 12, color: WALLET_TOKENS.textMuted, marginTop: 10 }}>{note}</div>}
      {actions && <div style={{ display: 'flex', gap: 8, marginTop: 14, flexWrap: 'wrap' }}>{actions}</div>}
    </div>
  );
}

function Chip({ ok, label }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 10px', borderRadius: 999,
      fontSize: 11, fontWeight: 600,
      background: ok ? 'rgba(34,197,94,0.10)' : 'rgba(255,255,255,0.04)',
      color: ok ? '#86EFAC' : WALLET_TOKENS.textMuted,
      border: `1px solid ${ok ? 'rgba(34,197,94,0.28)' : WALLET_TOKENS.hairline}`,
    }}>
      <Icon name={ok ? 'check_circle' : 'radio_button_unchecked'} size={12} />{label}
    </span>
  );
}

function QuickAction({ icon, title, sub, color, onClick, locked }) {
  return (
    <button onClick={onClick} style={{
      padding: 14, textAlign: 'left', background: WALLET_TOKENS.surface1,
      border: `1px solid ${WALLET_TOKENS.hairline}`, borderRadius: 12, position: 'relative',
      color: WALLET_TOKENS.text,
    }}>
      <div style={{ width: 34, height: 34, borderRadius: 9, background: `${color}1F`, color, display: 'grid', placeItems: 'center', marginBottom: 10 }}>
        <Icon name={icon} size={18} />
      </div>
      <div style={{ fontWeight: 600, fontSize: 13 }}>{title}</div>
      <div style={{ fontSize: 11, color: WALLET_TOKENS.textMuted }}>{sub}</div>
      {locked && <div style={{ position: 'absolute', top: 12, right: 12, color: WALLET_TOKENS.textMuted }}><Icon name="lock" size={14} /></div>}
    </button>
  );
}

function SecRow({ ok, label }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <Icon name={ok ? 'check_circle' : 'radio_button_unchecked'} size={14} className={ok ? 'text-emerald-400' : 'text-zinc-500'} />
      <span style={{ fontSize: 13, color: ok ? WALLET_TOKENS.text : WALLET_TOKENS.textMuted }}>{label}</span>
    </div>
  );
}

function TxRow({ tx }) {
  const shown = txAmount(tx);
  const credit = shown.credit;
  const when = tx.createdAt
    ? new Date(tx.createdAt.seconds ? tx.createdAt.seconds * 1000 : tx.createdAt).toLocaleString()
    : '';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px' }}>
      <div style={{ width: 34, height: 34, borderRadius: '50%', background: 'rgba(255,255,255,0.05)', color: WALLET_TOKENS.textSecondary, display: 'grid', placeItems: 'center', flexShrink: 0 }}>
        <Icon name={credit ? 'south_west' : 'north_east'} size={16} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 500, fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {tx.description || tx.type || 'Transaction'}
        </div>
        <div style={{ fontSize: 12, color: WALLET_TOKENS.textMuted }}>{when}</div>
      </div>
      <div className="font-dmmono tabular-nums" style={{ fontWeight: 600, fontSize: 14, color: credit ? '#86EFAC' : WALLET_TOKENS.text, flexShrink: 0 }}>
        {shown.text}
      </div>
    </div>
  );
}
// NativeConvertScreen REMOVED 2026-08-16. It was never routed, and it was a gem surface:
// coins-to-gems conversion is not a user action and gems no longer exist.

function SmallBtn({ children, onClick }) {
  return (
    <button onClick={onClick} style={{
      padding: '0 10px', height: 28, fontSize: 12, background: 'transparent',
      border: `1px solid ${WALLET_TOKENS.hairline}`, color: WALLET_TOKENS.textSecondary, borderRadius: 8,
    }}>{children}</button>
  );
}

// ───────────────────────────────────────────────────────── SETTINGS

export function NativeSettingsScreen() {
  const navigate = useNavigate();
  const { profile } = useUser();

  return (
    <div style={{ ...COL, gap: 18, width: '100%', maxWidth: '100%' }}>
      <div>
        <div style={{ fontSize: 11, letterSpacing: '0.12em', textTransform: 'uppercase', color: WALLET_TOKENS.violetLight, fontWeight: 600, marginBottom: 6 }}>Settings</div>
        <h1 style={{ fontFamily: 'Syne, sans-serif', fontWeight: 700, fontSize: 26, letterSpacing: '-0.02em' }}>Wallet settings.</h1>
      </div>

      <Section title="Account">
        <Card title="Account info">
          <Row label="Username"><UserName user={profile} masked handle fallback={'—'} /></Row>
          <Row label="Email">{auth.currentUser?.email ? maskEmail(auth.currentUser.email) : '—'}</Row>
          <Row label="Member since" last>{profile?.createdAt
            ? new Date(profile.createdAt.seconds ? profile.createdAt.seconds * 1000 : profile.createdAt).toLocaleDateString()
            : '—'}</Row>
        </Card>
      </Section>

      <Section title="Security">
        <LinkCard icon="lock" title="Change PIN" sub="Last changed never" onClick={() => navigate('/wallet/security/pin')} />
        <LinkCard icon="shield" title="Two-factor auth" sub="Manage 2FA + recovery codes" onClick={() => navigate('/wallet/security/totp')} />
      </Section>

      <Section title="Limits & verification">
        <Card title="KYC tier">
          <div style={{ color: WALLET_TOKENS.textSecondary, fontSize: 13, marginBottom: 14 }}>
            Higher-tier verification raises how much VERGR can pay you per month.
          </div>
          <WalletButton variant="primary" size="sm" iconRight="arrow_forward" onClick={() => navigate('/wallet/kyc')}>Manage KYC</WalletButton>
        </Card>
        <Card title="Danger zone" danger>
          {/* There is no self-serve freeze on the server; support freezes it. This
              button used to do nothing at all. */}
          <DangerBtn label="Freeze wallet" onClick={() => { window.location.href = 'mailto:support@vergr.app?subject=' + encodeURIComponent('Please freeze my Vergr wallet'); }} />
          <DangerBtn label="Contact support" onClick={() => navigate('/wallet/help')} />
        </Card>
      </Section>
    </div>
  );
}

function Section({ title, children }) {
  return (
    <div style={{ ...COL, gap: 12 }}>
      <SectionLabel>{title}</SectionLabel>
      {children}
    </div>
  );
}

function Card({ title, danger, children }) {
  return (
    <div style={{ padding: 16, borderRadius: 14, background: WALLET_TOKENS.surface1, border: `1px solid ${danger ? 'rgba(240,64,96,0.30)' : WALLET_TOKENS.hairline}` }}>
      <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 12, color: danger ? '#FCA5A5' : WALLET_TOKENS.text }}>{title}</div>
      {children}
    </div>
  );
}

function Row({ label, children, last }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, padding: '8px 0', borderBottom: last ? 'none' : `1px solid ${WALLET_TOKENS.hairline}`, fontSize: 13 }}>
      <span style={{ color: WALLET_TOKENS.textSecondary, flexShrink: 0 }}>{label}</span>
      <span style={{ textAlign: 'right', overflow: 'hidden', textOverflow: 'ellipsis' }}>{children}</span>
    </div>
  );
}

function LinkCard({ icon, title, sub, onClick }) {
  return (
    <button onClick={onClick} style={{
      width: '100%', padding: 14, borderRadius: 12, background: WALLET_TOKENS.surface1,
      border: `1px solid ${WALLET_TOKENS.hairline}`, color: WALLET_TOKENS.text, textAlign: 'left',
      display: 'flex', alignItems: 'center', gap: 14,
    }}>
      <div style={{ width: 36, height: 36, borderRadius: 10, background: WALLET_TOKENS.surface2, display: 'grid', placeItems: 'center', color: WALLET_TOKENS.textSecondary, flexShrink: 0 }}>
        <Icon name={icon} size={18} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 500, fontSize: 14 }}>{title}</div>
        <div style={{ fontSize: 12, color: WALLET_TOKENS.textMuted }}>{sub}</div>
      </div>
      <Icon name="chevron_right" size={16} className="text-zinc-500" />
    </button>
  );
}

function DangerBtn({ label, onClick }) {
  return (
    <button onClick={onClick} style={{
      display: 'block', width: '100%', textAlign: 'left', padding: '8px 10px', borderRadius: 8,
      background: 'transparent', border: 'none', color: '#FCA5A5', fontSize: 13,
    }}>{label}</button>
  );
}

function maskEmail(email) {
  const [user, domain] = email.split('@');
  if (!domain) return email;
  return `${user.slice(0, 2)}••••@${domain}`;
}

// ───────────────────────────────────────────────────────── HISTORY

const HIST_FILTERS = [
  { id: 'all',          label: 'All',              match: () => true },
  { id: 'tips',         label: 'Tips',             match: (t) => t.type === 'tip_received' || t.type === 'tip_sent' },


  { id: 'purchases',    label: 'Purchases',        match: (t) => ['buy', 'coin_purchase', 'vp_bonus_purchase', 'boost_purchase'].includes(t.type) },
  { id: 'memberships',  label: 'Memberships',      match: (t) => t.type === 'membership' || t.type === 'fan_renewal' },
];

export function NativeHistoryScreen() {
  const { profile } = useUser();
  const [filter, setFilter] = useState('all');
  const [txs, setTxs] = useState([]);
  const [loading, setLoading] = useState(true);


  useEffect(() => {
    if (!profile?.uid) return;
    setLoading(true);
    getTransactions(profile.uid, 200).then(setTxs).catch(() => {}).finally(() => setLoading(false));
  }, [profile?.uid]);

  const loadWithdrawals = useCallback(async () => {
    /* User-initiated withdrawal was removed 2026-08-16; nothing to load. */
    return;
  }, []);
  useEffect(() => {
    if (!profile?.uid) return;
    loadWithdrawals();
    const t = setInterval(loadWithdrawals, 20000);
    return () => clearInterval(t);
  }, [profile?.uid, loadWithdrawals]);

  const filtered = useMemo(() => {
    const f = HIST_FILTERS.find(x => x.id === filter);
    return txs.filter(t => f.match(t));
  }, [txs, filter]);

  return (
    <div style={{ ...COL, gap: 16, width: '100%', maxWidth: '100%' }}>
      <div>
        <div style={{ fontSize: 11, letterSpacing: '0.12em', textTransform: 'uppercase', color: WALLET_TOKENS.violetLight, fontWeight: 600, marginBottom: 6 }}>History</div>
        <h1 style={{ fontFamily: 'Syne, sans-serif', fontWeight: 700, fontSize: 26, letterSpacing: '-0.02em' }}>Transactions.</h1>
      </div>

      {/* Filter pills — horizontal scroller (no width-dependent wrapping) */}
      <div style={{ display: 'flex', gap: 6, overflowX: 'auto', WebkitOverflowScrolling: 'touch', paddingBottom: 2 }}>
        {HIST_FILTERS.map(f => (
          <button key={f.id} onClick={() => setFilter(f.id)} style={{
            flexShrink: 0, padding: '8px 14px', borderRadius: 999, fontSize: 12, fontWeight: 600,
            background: filter === f.id ? WALLET_TOKENS.violet : WALLET_TOKENS.surface2,
            color: filter === f.id ? '#fff' : WALLET_TOKENS.textSecondary,
            border: `1px solid ${filter === f.id ? WALLET_TOKENS.violet : WALLET_TOKENS.hairline}`,
          }}>{f.label}</button>
        ))}
      </div>

      <WalletCard padding={6}>
        {loading ? (
          <div style={{ padding: 40, textAlign: 'center', color: WALLET_TOKENS.textMuted, fontSize: 13 }}>Loading…</div>
        ) : filtered.length === 0 ? (
          <div style={{ padding: 40, textAlign: 'center', color: WALLET_TOKENS.textMuted, fontSize: 13 }}>Nothing here yet.</div>
        ) : filtered.map(t => <NativeHistoryRow key={t.id} tx={t} />)}
      </WalletCard>
    </div>
  );
}

function NativeHistoryRow({ tx }) {
  const when = tx.createdAt
    ? new Date(tx.createdAt.seconds ? tx.createdAt.seconds * 1000 : tx.createdAt).toLocaleString()
    : '';
  const shown = txAmount(tx);
  const credit = shown.credit;
  const showStatus = tx.status && tx.status !== 'settled' && tx.status !== 'completed';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '11px 10px', borderBottom: `1px solid ${WALLET_TOKENS.hairline}` }}>
      <div style={{ width: 34, height: 34, borderRadius: '50%', background: 'rgba(255,255,255,0.05)', color: WALLET_TOKENS.textSecondary, display: 'grid', placeItems: 'center', flexShrink: 0 }}>
        <Icon name={credit ? 'south_west' : 'north_east'} size={16} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 500, fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {tx.description || tx.type || 'Transaction'}
        </div>
        <div style={{ fontSize: 12, color: WALLET_TOKENS.textMuted }}>{when}</div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4, flexShrink: 0 }}>
        <span className="font-dmmono tabular-nums" style={{ fontWeight: 600, fontSize: 14, color: credit ? '#86EFAC' : WALLET_TOKENS.text }}>
          {shown.text}
        </span>
        {showStatus && <StatusPill status={tx.status} />}
      </div>
    </div>
  );
}

// NativeWithdrawalRow REMOVED 2026-08-16 with the withdrawal pipeline.

// ───────────────────────────────────────────────────────── KYC

const KYC_TIERS = [
  { level: 0, name: 'Unverified', dailyEUR: 0, monthlyEUR: 0,
    requires: ['Email confirmed'], unlocks: ['Buy coins', 'Tip creators', 'Unlock paid content', 'Cannot be paid a revenue share'] },
  { level: 1, name: 'Basic', dailyEUR: 0, monthlyEUR: 50,
    requires: ['Government ID', 'Selfie liveness'], unlocks: ['VERGR can pay your creator revenue share', 'Paid up to $50 per month'] },
  // The caps are USD (KYC_MONTHLY_CAP_MICRO_USD, AML policy section 2). These
  // said euros, tied source of funds to deposits (which do not exist), and
  // promised priority support (never built). Now matches the web KYC screen.
  { level: 2, name: 'Standard', dailyEUR: 0, monthlyEUR: 2500,
    requires: ['L1 + proof of address (bill, bank statement or government letter, last 3 months)'], unlocks: ['Paid up to $2,500 per month', 'Faster payout schedules unlock'] },
  { level: 3, name: 'Premium', dailyEUR: 0, monthlyEUR: 15000,
    requires: ['L2 + source-of-funds documents'], unlocks: ['Paid up to $15,000 per month'] },
];

export function NativeKycScreen() {
  const navigate = useNavigate();
  const [kycLevel, setKycLevel] = useState(0);
  useEffect(() => { getMyWalletSecurityStatus().then(s => setKycLevel(s?.kycLevel ?? 0)).catch(() => {}); }, []);
  // Level 1 is the Didit check at /creator/verify (/onboarding/identity is a
  // profile form with no identity check). Levels 2 and 3 are a document upload
  // on the payout setup screen.
  const start = (level) => navigate(level <= 1 ? '/creator/verify' : '/creator/earnings/setup');

  return (
    <div style={{ ...COL, gap: 14, width: '100%', maxWidth: '100%' }}>
      <div>
        <div style={{ fontSize: 11, letterSpacing: '0.12em', textTransform: 'uppercase', color: WALLET_TOKENS.violetLight, fontWeight: 600 }}>Identity verification</div>
        <h1 style={{ fontFamily: 'Syne, sans-serif', fontWeight: 700, fontSize: 26, marginTop: 6, letterSpacing: '-0.02em' }}>Raise your limits.</h1>
        <p style={{ color: WALLET_TOKENS.textSecondary, fontSize: 13, marginTop: 6 }}>
          Each tier unlocks more. We use Didit, an EU-licensed identity provider.
        </p>
      </div>

      {KYC_TIERS.map(t => {
        const done = kycLevel > t.level;
        const current = kycLevel === t.level;
        const next = kycLevel + 1 === t.level;
        const future = kycLevel + 1 < t.level;
        return (
          <div key={t.level} style={{
            ...COL, gap: 14, padding: 18, borderRadius: 16,
            background: current ? 'linear-gradient(135deg, rgba(34,197,94,0.08), transparent 55%)' : WALLET_TOKENS.surface1,
            border: `1px solid ${current ? 'rgba(34,197,94,0.40)' : next ? WALLET_TOKENS.hairlineStrong : WALLET_TOKENS.hairline}`,
            opacity: future ? 0.6 : 1,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <div style={{
                width: 48, height: 48, borderRadius: 14, flexShrink: 0,
                background: done || current ? 'rgba(34,197,94,0.16)' : WALLET_TOKENS.surface2,
                border: `1px solid ${done || current ? 'rgba(34,197,94,0.40)' : WALLET_TOKENS.hairline}`,
                display: 'grid', placeItems: 'center',
                fontFamily: 'Syne, sans-serif', fontWeight: 700, fontSize: 16,
                color: done || current ? '#86EFAC' : WALLET_TOKENS.textSecondary,
              }}>
                {done ? <Icon name="check" size={20} className="text-emerald-400" /> : `L${t.level}`}
              </div>
              <div style={{ fontFamily: 'Syne, sans-serif', fontWeight: 700, fontSize: 19 }}>{t.name}</div>
              {done && <Pill tone="success" size="sm">Complete</Pill>}
              {current && <Pill tone="violet" size="sm">You are here</Pill>}
              {next && <Pill tone="gold" size="sm">Next up</Pill>}
            </div>

            <div>
              <SectionLabel>Requires</SectionLabel>
              <ul style={{ margin: 0, padding: 0, listStyle: 'none', ...COL, gap: 8 }}>
                {t.requires.map(r => (
                  <li key={r} style={{ display: 'flex', gap: 8, fontSize: 13, color: WALLET_TOKENS.textSecondary }}>
                    <Icon name="check" size={14} className="text-zinc-500" /> {r}
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <SectionLabel>Unlocks</SectionLabel>
              <ul style={{ margin: 0, padding: 0, listStyle: 'none', ...COL, gap: 8 }}>
                {t.unlocks.map(u => (
                  <li key={u} style={{ display: 'flex', gap: 8, fontSize: 13, color: WALLET_TOKENS.text }}>
                    <Icon name="auto_awesome" size={14} className="text-violet-300" /> {u}
                  </li>
                ))}
                {t.dailyEUR > 0 && (
                  <li className="font-dmmono" style={{ fontSize: 12, color: WALLET_TOKENS.textSecondary, marginTop: 2 }}>
                    {fmtEUR(t.dailyEUR)} / day · {fmtEUR(t.monthlyEUR)} / month
                  </li>
                )}
              </ul>
            </div>

            {next && (
              <WalletButton variant="primary" full onClick={() => start(t.level)} iconRight="arrow_forward">
                {t.level <= 1 ? 'Start verification' : 'Upload document'}
              </WalletButton>
            )}
          </div>
        );
      })}

      <Callout tone="info" icon="info" title="Why we ask">
        We verify identity before paying a creator their revenue share, as the regulations require. Your ID and selfie go straight to Didit and we see only the result. For Levels 2 and 3 you upload a document that Vergr staff review; it is deleted as soon as it has been reviewed.
      </Callout>
    </div>
  );
}

// ───────────────────────────────────────────────────────── BUY

export function NativeBuyScreen() {
  const { showToast } = useUI();
  const [tab, setTab] = useState('packs');
  // USD, not EUR — the ladder is natively USD. See NativeCustomBuy below.
  const [customUSD, setCustomUSD] = useState(20);
  // ONE shared checkout implementation (money flow) — see ../v2/buyCheckout.
  const { checkout, startCheckout, cancelCheckout } = useBuyCheckout(showToast);
  const customCoins = Math.floor((parseFloat(customUSD) || 0) / COIN_PRICE_USD);
  const { currentUser } = useAuth();
  const [playPrices, setPlayPrices] = useState({});
  const promo = useActiveCoinPromo();
  const cart = useCart();
  const busy = checkout?.status === 'waiting';

  // Play Billing is mandatory for digital goods on the Play build. PayRam is
  // still the path everywhere else (web, desktop, sideload APK), so this is a
  // branch and not a replacement.
  const usePlay = IS_STORE_BUILD && !IS_HUAWEI_BUILD && isPlayBillingSupported();

  // Prices come from Play, not from our EUR constants: Play sets them per
  // market, and showing a number that differs from the purchase sheet is both
  // confusing and a policy problem.
  useEffect(() => {
    if (!usePlay) return;
    let alive = true;
    fetchPlayPrices(ACTIVE_COIN_PACKS.map(p => playProductIdFor(p.id)))
      .then(map => { if (alive) setPlayPrices(map); });
    return () => { alive = false; };
  }, [usePlay]);

  // A pack goes INTO THE BASKET and the basket opens over this screen, exactly
  // as on the web. The basket is the confirm step: fee lines, the payment-method
  // choice (the same PaymentMethodPicker, so the Play fair-comparison rules still
  // live in ONE place, and Play baskets buy line by line) and the refund terms.
  // This screen used to open its own method sheet instead, so the app had no
  // basket at all (founder, 2026-09-11: "what happened to the cart draw?").
  const buyPack = (pack) => {
    cart.add(pack.id, 1);
    cart.setOpen(true);
  };

  // `/wallet/buy?pack=<id>` from an older quick-buy link: same thing, once.
  // Consumed with replaceState so a back gesture does not re-add it.
  useEffect(() => {
    const sku = new URLSearchParams(window.location.search).get('pack');
    if (!sku) return;
    window.history.replaceState({}, '', '/wallet/buy');
    const pack = ACTIVE_COIN_PACKS.find((p) => p.id === sku);
    if (pack) { cart.add(pack.id, 1); cart.setOpen(true); }
  }, []);

  return (
    <div style={{ ...COL, gap: 16, width: '100%', maxWidth: '100%' }}>
      <div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
          <div style={{ fontSize: 11, letterSpacing: '0.12em', textTransform: 'uppercase', color: WALLET_TOKENS.violetLight, fontWeight: 600 }}>Buy coins</div>
          {cart.count > 0 && (
            <button onClick={() => cart.setOpen(true)} aria-label={`Open basket, ${cart.count} item${cart.count === 1 ? '' : 's'}`}
              style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px', borderRadius: 999, border: 0, cursor: 'pointer', background: WALLET_TOKENS.surface2, color: WALLET_TOKENS.text, font: 'inherit', fontSize: 12, fontWeight: 700 }}>
              <Icon name="shopping_cart" size={16} />
              <span className="font-dmmono tabular-nums">{cart.count}</span>
            </button>
          )}
        </div>
        <h1 style={{ fontFamily: 'Syne, sans-serif', fontWeight: 700, fontSize: 26, letterSpacing: '-0.02em' }}>Top up your wallet.</h1>
        <p style={{ color: WALLET_TOKENS.textSecondary, fontSize: 13, marginTop: 6 }}>
          {IS_STORE_BUILD
            ? `Paid through ${STORE_NAME}. Coins land within seconds.`
            : 'Card, Apple Pay, Google Pay or instant bank. Coins land within seconds.'}
        </p>
      </div>

      {/* Segmented tabs */}
      <div style={{ display: 'flex', gap: 4, padding: 4, background: WALLET_TOKENS.surface2, borderRadius: 12 }}>
        <NativeTabBtn active={tab === 'packs'}  onClick={() => setTab('packs')}>Coin packs</NativeTabBtn>
        {/* No Custom tab on the Play build. A custom amount cannot use Play
            Billing (fixed SKUs), so it is always our own checkout, which a Play
            app may offer only to US / UK / EEA users of an ENROLLED developer.
            Vergr is not enrolled yet (founder, 2026-09-11: once the EIN
            arrives). ⚠ HUAWEI LOST IT TOO on 2026-09-17, when that build moved
            from PayRam to HUAWEI IAP: a custom amount cannot use fixed IAP
            products on EITHER store. Web, desktop and sideload keep it. */}
        {!IS_STORE_BUILD && (
          <NativeTabBtn active={tab === 'custom'} onClick={() => setTab('custom')}>Custom</NativeTabBtn>
        )}
        {/* Spending COINS, not opening a second payment rail, so there is no
            Play Billing question here: the coins were already bought through
            whichever rail the user chose. */}
        <NativeTabBtn active={tab === 'bonuses'} onClick={() => setTab('bonuses')}>Bonuses</NativeTabBtn>
        <NativeTabBtn active={tab === 'boosts'} onClick={() => setTab('boosts')}>Boosts</NativeTabBtn>
      </div>

      {tab === 'packs' && (
        // Fixed 2-up grid — renders 2 cols at any width (no media query).
        <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' }}>
          {ACTIVE_COIN_PACKS.map(p => (
            <NativePackCard key={p.id} pack={p} busy={busy} sale={promoBonusForPack(promo, p)}
              playPrice={playPrices[playProductIdFor(p.id)]?.price}
              onBuy={() => buyPack(p)} />
          ))}
        </div>
      )}
      {/* Shared with /wallet/buy and /prestige so the card cannot drift. */}
      {tab === 'bonuses' && <BonusPacksTab compact />}
      {tab === 'boosts' && <BoostsTab compact />}


      {tab === 'custom' && !IS_STORE_BUILD && (
        <NativeCustomBuy usd={customUSD} setUsd={setCustomUSD} busy={busy}
          onCodaSettled={(s) => showToast(`Added ${Number(s?.coins || 0).toLocaleString()} coins to your wallet!`, 'success')}
          onContinue={() => startCheckout({ customCoins }, `${fmtNum(customCoins)} coins`)} />
      )}


      {checkout && <NativeCheckoutOverlay checkout={checkout} onCancel={cancelCheckout} />}
    </div>
  );
}

function NativeTabBtn({ active, children, onClick }) {
  return (
    <button onClick={onClick} style={{
      flex: 1, padding: '10px 12px', borderRadius: 9, fontSize: 13, fontWeight: 600,
      background: active ? WALLET_TOKENS.surface1 : 'transparent',
      color: active ? WALLET_TOKENS.text : WALLET_TOKENS.textSecondary,
      border: `1px solid ${active ? WALLET_TOKENS.hairlineStrong : 'transparent'}`,
    }}>{children}</button>
  );
}

// `playPrice` is Play's own localized string (e.g. "R189,99"). When present it
// MUST win over pack.priceEUR: Play sets the price per market, and rendering a
// different figure than the purchase sheet is both confusing and a policy risk.
function NativePackCard({ pack, onBuy, busy, playPrice, sale }) {
  const isPopular = pack.badgeStyle === 'popular';
  return (
    <div style={{
      ...COL, padding: 14, borderRadius: 16,
      background: WALLET_TOKENS.surface1,
      border: `1px solid ${isPopular ? 'rgba(123,31,255,0.40)' : WALLET_TOKENS.hairline}`,
      position: 'relative', overflow: 'hidden',
    }}>
      {pack.badge && (
        <div style={{ marginBottom: 8 }}>
          <Pill tone={pack.badgeStyle === 'vp' ? 'gold' : pack.badgeStyle === 'popular' ? 'violet' : 'neutral'} size="sm">{pack.badge}</Pill>
        </div>
      )}
      <div style={{ height: 84, display: 'grid', placeItems: 'center', marginBottom: 4 }}>
        <img src={`/brand/packs/${pack.id}-pack.webp`} alt={pack.name} draggable={false}
          onError={(e) => { e.currentTarget.style.display = 'none'; }}
          style={{
            maxHeight: 80, maxWidth: '86%', objectFit: 'contain',
            filter: pack.badgeStyle === 'vp'
              ? 'drop-shadow(0 8px 22px rgba(123,31,255,0.40))'
              : 'drop-shadow(0 8px 22px rgba(240,165,0,0.30))',
          }} />
      </div>
      <div style={{ fontFamily: 'Syne, sans-serif', fontWeight: 700, fontSize: 14, marginBottom: 4 }}>{pack.name}</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
        <CoinGlyph size={20} />
        <span className="font-dmmono tabular-nums" style={{ fontSize: 18, fontWeight: 700, color: WALLET_TOKENS.goldLight }}>{fmtNum(pack.coins)}</span>
      </div>
      {pack.vpBonus > 0 && (
        <div style={{ fontSize: 11, color: WALLET_TOKENS.goldLight, marginBottom: 4 }}>+ {fmtNum(pack.vpBonus)} VP</div>
      )}
      {/* The live sale, from the server. The Play and AppGallery redeem paths
          credit it too, so a phone buyer is told what they get. */}
      {sale && (
        <div style={{ fontSize: 11, fontWeight: 800, color: '#4ADE80', marginBottom: 4 }}>+ {fmtNum(sale.amount)} {sale.unit} free</div>
      )}
      <div style={{ fontSize: 11, color: WALLET_TOKENS.textMuted, lineHeight: 1.35, marginBottom: 12, flex: 1 }}>{pack.tagline}</div>
      {/* ⚠ On the Play build NEVER fall back to our USD: Google charges its own
          (higher) price, so "$0.99" here would show less than the sheet charges.
          Until Google's string arrives the price line stays blank. */}
      <div className="font-dmmono tabular-nums" style={{ fontSize: 18, fontWeight: 700, marginBottom: 10, minHeight: 24 }}>
        {playPrice || (IS_STORE_BUILD && !IS_HUAWEI_BUILD && isPlayBillingSupported() ? '' : fmtUsd(pack.priceUSD))}
      </div>
      <WalletButton variant="primary" full disabled={busy} onClick={onBuy}>Buy</WalletButton>
    </div>
  );
}

// USD throughout — see the long note on CustomTab in wallet/v2/BuyScreen.jsx.
// This is the native mirror of the same panel and carried the identical A27
// bug: `fmtEUR` is a EUR->local CONVERTER, so USD chips rendered inflated by
// the live FX rate, the input was prefixed `€`, and "You pay" echoed the typed
// amount rather than the charge for the whole (floored) coin count.
// PayRam is hidden (founder, 2026-09-25); its server stays. Flip to show it again.
const SHOW_PAYRAM_NATIVE = false;

function NativeCustomBuy({ usd, setUsd, onContinue, busy, onCodaSettled }) {
  // Sideload app (no store): Codapay, like the website. Never on a store build,
  // which does not render this tab at all.
  const { profile } = useUser();
  const appGate = useAppGate();
// !IS_STORE_BUILD first: a compile-time false on Play/AppGallery, so the store
  // bundle drops the Coda checkout entirely instead of shipping it unreachable.
  const codaOn = !IS_STORE_BUILD && codaOfferedTo(appGate, profile);
  const usdNum = parseFloat(usd) || 0;
  const coins = Math.floor(usdNum / COIN_PRICE_USD);
  const valid = usdNum >= MIN_CUSTOM_USD;
  // You are charged for whole coins, and `coins` is floored, so $20 buys 1574
  // coins = $19.99. Unlike the web panel this screen has no server quote to
  // read, so the floored catalogue value is the closest honest figure.
  const chargedUsd = coins * COIN_PRICE_USD;
  const procFee = chargedUsd * 0.015;
  return (
    <WalletCard>
      <SectionLabel>Amount</SectionLabel>
      <div style={{ display: 'flex', gap: 6, overflowX: 'auto', WebkitOverflowScrolling: 'touch', marginBottom: 14, paddingBottom: 2 }}>
        {[10, 20, 50, 100, 250].map(n => (
          <button key={n} onClick={() => setUsd(n)} style={{
            flexShrink: 0, padding: '8px 14px', borderRadius: 10, fontSize: 13, fontWeight: 600,
            background: usd === n ? WALLET_TOKENS.violet : WALLET_TOKENS.surface2,
            color: usd === n ? '#fff' : WALLET_TOKENS.textSecondary,
            border: `1px solid ${usd === n ? WALLET_TOKENS.violet : WALLET_TOKENS.hairlineStrong}`,
          }}>{fmtUsd(n)}</button>
        ))}
      </div>
      <div style={{ position: 'relative', marginBottom: 14 }}>
        <span style={{ position: 'absolute', left: 16, top: '50%', transform: 'translateY(-50%)', fontSize: 26, fontWeight: 700, color: WALLET_TOKENS.goldLight, fontFamily: 'DM Mono, monospace' }}>$</span>
        <input value={usd} inputMode="decimal"
          onChange={(e) => setUsd(e.target.value.replace(/[^\d.]/g, ''))}
          style={{
            width: '100%', padding: '14px 14px 14px 40px', fontSize: 26, fontWeight: 700,
            fontFamily: 'DM Mono, monospace', color: WALLET_TOKENS.goldLight,
            background: WALLET_TOKENS.surface2, border: `1px solid ${WALLET_TOKENS.hairlineStrong}`,
            borderRadius: 10, outline: 'none', boxSizing: 'border-box',
          }} />
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
        <span style={{ fontSize: 13, color: WALLET_TOKENS.textSecondary }}>You receive</span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          <CoinGlyph size={20} />
          <span className="font-dmmono tabular-nums" style={{ fontSize: 20, fontWeight: 700, color: WALLET_TOKENS.goldLight }}>
            <AnimatedNumber value={coins} /> coins
          </span>
        </span>
      </div>
      {!valid && usd && (
        <div style={{ marginTop: 12, fontSize: 12, color: '#FCD34D' }}>
          Minimum is {fmtUsd(MIN_CUSTOM_USD)} (set by our card processor).
        </div>
      )}
      {codaOn ? (
        valid ? <CodaCheckoutBlock payload={{ customCoins: coins }} profile={profile} onSettled={onCodaSettled} /> : null
      ) : SHOW_PAYRAM_NATIVE ? (
        <>
      <FeeBreakdown
        items={[
          { label: 'You pay', value: fmtUsd(chargedUsd) },
          { label: 'Payment processing (~1.5%)', value: `-${fmtUsd(procFee)}`, tone: 'muted' },
          { label: 'VERGR fee', value: fmtUsd(0), tone: 'muted' },
        ]}
        total={`${fmtNum(coins)} coins`}
        totalLabel="You receive"
      />
      <div style={{ marginTop: 18 }}>
        <WalletButton variant="primary" size="lg" full disabled={!valid || busy}
          icon="credit_card" iconRight="arrow_forward" onClick={onContinue}>
          Continue to checkout
        </WalletButton>
      </div>
        </>
      ) : (
        <div style={{ marginTop: 16, background: '#1C1C2B', borderRadius: 12, padding: '12px 14px', fontSize: 13, color: WALLET_TOKENS.textSecondary }}>
          Buying here is not open yet.
        </div>
      )}
    </WalletCard>
  );
}

function NativeCheckoutOverlay({ checkout, onCancel }) {
  const opening = checkout.status === 'opening';
  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(5,5,12,0.82)',
      backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', padding: 16,
    }}>
      <WalletCard style={{ width: '100%', maxWidth: 460, textAlign: 'center', marginBottom: 'calc(var(--vg-safe-b, 0px) + 8px)' }}>
        <div style={{
          width: 56, height: 56, borderRadius: '50%', margin: '4px auto 16px', display: 'grid', placeItems: 'center',
          background: 'rgba(123,31,255,0.15)', border: `1px solid ${WALLET_TOKENS.violet}`,
        }}>
          <Icon name="open_in_new" size={26} style={{ color: WALLET_TOKENS.violetLight }} />
        </div>
        <div style={{ fontFamily: 'Syne, sans-serif', fontWeight: 700, fontSize: 18, marginBottom: 8 }}>
          {opening ? 'Opening secure checkout…' : 'Complete your payment'}
        </div>
        <p style={{ color: WALLET_TOKENS.textSecondary, fontSize: 13, lineHeight: 1.5, marginBottom: 18 }}>
          {opening
            ? 'A secure checkout is opening in your browser. Hold on a moment.'
            : `Finish paying for ${checkout.label} in your browser, then come back. This screen updates the moment your coins land — keep the app open.`}
        </p>
        <WalletButton variant="ghost" full onClick={onCancel}>Cancel</WalletButton>
      </WalletCard>
    </div>
  );
}

// ───────────────────────────────────────────────────────── DEPOSIT (USDC on Base)

export function NativeDepositScreen() {
  const navigate = useNavigate();
  const { profile } = useUser();
  const address = '0x4f9eb4609bbbd0133344adbf5bbdf3df0dc5d8c9'; // Sandbox hot wallet
  const memo = `vergr:${profile?.uid?.slice(0, 12) || 'pending'}`;
  const { showToast } = useUI();
  const copy = (v, label) => { navigator.clipboard?.writeText(v); showToast?.(`${label} copied`, 'success'); };

  return (
    <div style={{ ...COL, gap: 16, width: '100%', maxWidth: '100%' }}>
      <div>
        <div style={{ fontSize: 11, letterSpacing: '0.12em', textTransform: 'uppercase', color: WALLET_TOKENS.violetLight, fontWeight: 600 }}>Deposit address</div>
        <h1 style={{ fontFamily: 'Syne, sans-serif', fontWeight: 700, fontSize: 26, marginTop: 6, letterSpacing: '-0.02em' }}>Send USDC to your wallet.</h1>
        <p style={{ color: WALLET_TOKENS.textSecondary, fontSize: 13, marginTop: 6 }}>USDC on Base only. Other networks or tokens will be lost.</p>
      </div>

      <Callout tone="info" icon="info" title="Most users never need this">
        Buying coins via card or bank routes through PayRam automatically. Use this only if you're depositing USDC from your own crypto wallet.
      </Callout>

      {/* QR */}
      <WalletCard style={{ display: 'grid', placeItems: 'center' }}>
        <div style={{ width: 220, height: 220, background: '#fff', borderRadius: 12, display: 'grid', placeItems: 'center' }}>
          <img src={`https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(address)}`}
               width="200" height="200" alt="Deposit QR" />
        </div>
      </WalletCard>

      {/* Address */}
      <WalletCard>
        <SectionLabel>Wallet address (Base)</SectionLabel>
        <div className="font-dmmono" style={{
          padding: '12px 14px', borderRadius: 10, background: WALLET_TOKENS.surface2,
          border: `1px solid ${WALLET_TOKENS.hairline}`, fontSize: 12, wordBreak: 'break-all', marginBottom: 10,
        }}>{address}</div>
        <WalletButton variant="secondary" full icon="content_copy" onClick={() => copy(address, 'Address')}>Copy address</WalletButton>
      </WalletCard>

      {/* Memo */}
      <Callout tone="warning" icon="warning" title="Memo required">
        Include this memo (hex-encoded in the transaction <code>data</code> field) or your deposit can't be credited.
        <div className="font-dmmono" style={{ padding: '8px 12px', borderRadius: 6, background: 'rgba(0,0,0,0.30)', color: '#FCA5A5', fontSize: 12, margin: '10px 0', wordBreak: 'break-all' }}>{memo}</div>
        <WalletButton variant="secondary" size="sm" full icon="content_copy" onClick={() => copy(memo, 'Memo')}>Copy memo</WalletButton>
      </Callout>

      <Callout tone="warning" icon="warning" title="Base network only">
        Ethereum mainnet, Polygon, Arbitrum, Solana = funds lost.
      </Callout>
      <Callout tone="warning" icon="warning" title="USDC only">
        USDT, ETH, any other token = funds lost.
      </Callout>

      <WalletButton variant="ghost" full icon="arrow_back" onClick={() => navigate('/wallet/security')}>Back to security</WalletButton>
    </div>
  );
}
