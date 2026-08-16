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
import { useUI } from '../../../context/UIContext';
import { useWalletUnlock } from '../../../context/WalletUnlockContext';
import {
  WalletCard, WalletButton, SectionLabel, Pill, Callout, FeeBreakdown,
  CoinGlyph, GemGlyph, VPGlyph, AnimatedNumber, StatusPill,
  WALLET_TOKENS, fmtNum, fmtEUR, fmtUsd,
} from '../../../components/wallet/primitives';
import Icon from '../../../components/Icon';
import { getTransactions, convertCoinsToGems } from '../../../firebase/firestore';
import { getVPLevel, getNextVPLevel, getCommission, COIN_PACKS, GEM_VALUE_USD, COIN_VALUE_USD } from '../../../utils/vpSystem';
import { IS_STORE_BUILD, IS_HUAWEI_BUILD } from '../../../utils/platform';
import { useAuth } from '../../../context/AuthContext';
import {
  isPlayBillingSupported, fetchPlayPrices, buyCoinPack, playProductIdFor,
} from '../../../utils/nativeBilling';

// ONE LADDER, EVERYWHERE — web, Play and Huawei sell the identical packs.
//
// There used to be a second, reduced ladder for Play builds. It is gone: a Play
// IAP product has one fixed quantity, so a second ladder meant the shelf and the
// Play purchase sheet disagreed about what was being sold. Google's cut is
// absorbed in the PRICE of the Play SKU instead, which is set in Play Console
// and read back at runtime through fetchPlayPrices(). See storePricing.js.
const ACTIVE_COIN_PACKS = COIN_PACKS;
import { getMyWalletSecurityStatus, getMyWithdrawals, cancelWithdrawal } from '../../../firebase/walletCallables';
import { useBuyCheckout, MIN_CUSTOM_USD, COIN_PRICE_USD } from '../v2/buyCheckout';
import PaymentMethodPicker from '../../../components/wallet/PaymentMethodPicker';

// GEM_VALUE_USD and COIN_VALUE_USD come from vpSystem (imported above) and are
// never re-declared here. This file used to hardcode `GEM_TO_EUR = 0.009`, which
// understated every gem figure on the native wallet by 10%.
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
        <QuickAction icon="shopping_cart" color={WALLET_TOKENS.gold} title="Buy coins" sub="Card or bank" onClick={() => navigate('/wallet/buy')} />
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
  const amount = tx.amount || 0;
  const credit = amount >= 0;
  const currency = tx.currency || 'coins';
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
        {credit ? '+' : ''}{fmtNum(amount)} {currency === 'gems' ? 'gems' : 'c'}
      </div>
    </div>
  );
}

// ───────────────────────────────────────────────────────── CONVERT

export function NativeConvertScreen() {
  const { profile, wallet } = useUser();
  const { requirePin } = useWalletUnlock();
  const navigate = useNavigate();

  // Only RECEIVED coins convert to gems; purchased coins are spendable but
  // never cashable. Mirrors convertibleCoins() in functions/coinLedger.js.
  // The server enforces this — the UI just avoids offering a refused amount.
  const totalCoins = wallet?.balance || 0;
  const coins = Math.min(Math.max(0, wallet?.earnedBalance || 0), totalCoins);
  const lockedCoins = Math.max(0, totalCoins - coins);
  const vp = wallet?.vp || 0;
  const vpInfo = getVPLevel(vp);
  const vpNext = getNextVPLevel(vp);
  const commission = getCommission(vp);
  const commissionPct = Math.round(commission * 100);

  const [amount, setAmount] = useState(Math.min(1000, coins));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [done, setDone] = useState(false);
  const [received, setReceived] = useState(0);

  const gemsOut = Math.floor(amount * (1 - commission));
  const valid = amount > 0 && amount <= coins && !submitting;

  const submit = () => {
    if (!valid) return;
    requirePin(async () => {
      setSubmitting(true); setError(null);
      try {
        const result = await convertCoinsToGems(profile.uid, amount);
        setReceived(result?.gemsReceived ?? gemsOut);
        setDone(true);
      } catch (e) {
        setError(e?.message || 'Conversion failed. Try again.');
      } finally { setSubmitting(false); }
    });
  };

  if (done) {
    return (
      <WalletCard padding={36} style={{ textAlign: 'center' }}>
        <div style={{ width: 72, height: 72, margin: '0 auto 18px', borderRadius: '50%', background: 'rgba(34,197,94,0.14)', display: 'grid', placeItems: 'center', border: '1px solid rgba(34,197,94,0.4)' }}>
          <Icon name="check" size={32} className="text-emerald-400" />
        </div>
        <div style={{ fontFamily: 'Syne, sans-serif', fontWeight: 700, fontSize: 24, marginBottom: 6 }}>
          <AnimatedNumber value={received} /> gems credited.
        </div>
        <div style={{ color: WALLET_TOKENS.textSecondary, fontSize: 14, marginBottom: 20 }}>Conversion settled.</div>
        <div style={{ ...COL, gap: 10 }}>
          <WalletButton variant="primary" onClick={() => navigate('/creator/earnings')} iconRight="arrow_forward">View earnings</WalletButton>
          <WalletButton variant="secondary" onClick={() => { setDone(false); setAmount(0); }}>Convert more</WalletButton>
        </div>
      </WalletCard>
    );
  }

  return (
    <div style={{ ...COL, gap: 16, width: '100%', maxWidth: '100%' }}>
      <div>
        <div style={{ fontSize: 11, letterSpacing: '0.12em', textTransform: 'uppercase', color: WALLET_TOKENS.violetLight, fontWeight: 600, marginBottom: 6 }}>Convert</div>
        <h1 style={{ fontFamily: 'Syne, sans-serif', fontWeight: 700, fontSize: 26, letterSpacing: '-0.02em' }}>Coins to gems.</h1>
        <p style={{ color: WALLET_TOKENS.textSecondary, fontSize: 13, marginTop: 6 }}>
          Gems are the only currency that cashes out. Rate depends on your rank.
        </p>
      </div>

      {/* FROM */}
      <WalletCard>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
          <CoinGlyph size={28} />
          <div>
            <div style={{ fontSize: 10, letterSpacing: '0.12em', textTransform: 'uppercase', color: WALLET_TOKENS.gold, fontWeight: 600 }}>From</div>
            <div style={{ fontWeight: 600, fontSize: 15 }}>Coins</div>
          </div>
        </div>
        <input value={amount} inputMode="numeric"
          onChange={(e) => setAmount(Math.max(0, parseInt(e.target.value.replace(/\D/g, '')) || 0))}
          style={{
            width: '100%', height: 60, padding: '0 16px', fontSize: 30, fontWeight: 700,
            fontFamily: 'DM Mono, monospace', color: WALLET_TOKENS.goldLight,
            background: WALLET_TOKENS.surface2, border: `1px solid ${WALLET_TOKENS.hairlineStrong}`,
            borderRadius: 12, outline: 'none', boxSizing: 'border-box',
          }} />
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 10 }}>
          <span className="font-dmmono" style={{ fontSize: 13, color: WALLET_TOKENS.textMuted }}>{fmtNum(coins)} c convertible</span>
          <div style={{ display: 'flex', gap: 6 }}>
            <SmallBtn onClick={() => setAmount(Math.floor(coins / 2))}>50%</SmallBtn>
            <SmallBtn onClick={() => setAmount(coins)}>Max</SmallBtn>
          </div>
        </div>
        {lockedCoins > 0 && (
          <p style={{ marginTop: 8, fontSize: 11, lineHeight: 1.5, color: WALLET_TOKENS.textMuted }}>
            {fmtNum(lockedCoins)} of your {fmtNum(totalCoins)} coins were purchased. Purchased
            coins can be spent anywhere in VERGR, but only coins you have earned
            can be converted to gems and withdrawn.
          </p>
        )}
      </WalletCard>

      {/* Arrow (points down in the stack) */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10 }}>
        <div style={{ width: 44, height: 44, borderRadius: '50%', background: WALLET_TOKENS.surface2, border: `1px solid ${WALLET_TOKENS.hairlineStrong}`, display: 'grid', placeItems: 'center', color: WALLET_TOKENS.violetLight }}>
          <Icon name="arrow_downward" size={20} />
        </div>
        <Pill tone="violet" size="sm">{commissionPct}% commission</Pill>
      </div>

      {/* TO */}
      <WalletCard>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
          <GemGlyph size={28} />
          <div>
            <div style={{ fontSize: 10, letterSpacing: '0.12em', textTransform: 'uppercase', color: WALLET_TOKENS.gemBlue, fontWeight: 600 }}>To</div>
            <div style={{ fontWeight: 600, fontSize: 15 }}>Gems</div>
          </div>
        </div>
        <div style={{
          display: 'flex', alignItems: 'center', paddingLeft: 16, width: '100%', height: 60,
          fontSize: 30, fontWeight: 700, fontFamily: 'DM Mono, monospace', color: '#7CA3FF',
          background: WALLET_TOKENS.surface2, border: `1px solid ${WALLET_TOKENS.hairline}`,
          borderRadius: 12, boxSizing: 'border-box',
        }}>
          <AnimatedNumber value={gemsOut} />
        </div>
        <div className="font-dmmono" style={{ fontSize: 13, color: WALLET_TOKENS.textMuted, marginTop: 10 }}>
          Worth ≈ {fmtUsd(gemsOut * GEM_VALUE_USD)}
        </div>
      </WalletCard>

      <FeeBreakdown
        items={[
          { label: 'You spend', value: `${fmtNum(amount)} c` },
          { label: `Commission (${vpInfo.name} L${vpInfo.level}, ${commissionPct}%)`, value: `-${fmtNum(amount - gemsOut)} c` },
          { label: 'Conversion rate', value: `1 c → ${(1 - commission).toFixed(2)} gems`, tone: 'muted' },
        ]}
        total={`+${fmtNum(gemsOut)} gems · ≈ ${fmtUsd(gemsOut * GEM_VALUE_USD)}`}
      />

      {vpNext && (
        <WalletCard>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10, gap: 10 }}>
            <div>
              <div style={{ fontWeight: 600, fontSize: 14 }}>{fmtNum(Math.max(0, vpNext.vpRequired - vp))} VP to Lvl {vpNext.level}</div>
              <div style={{ color: WALLET_TOKENS.textSecondary, fontSize: 13, marginTop: 4 }}>
                Reach Lvl {vpNext.level} to drop your commission to {Math.round(vpNext.commission * 100)}%.
              </div>
            </div>
            <Pill tone="violet" size="sm">{vpInfo.name} L{vpInfo.level}</Pill>
          </div>
          <div style={{ height: 6, background: 'rgba(255,255,255,0.06)', borderRadius: 3, overflow: 'hidden' }}>
            <div style={{ width: `${Math.min(100, (vp / vpNext.vpRequired) * 100)}%`, height: '100%', background: WALLET_TOKENS.violetLight }} />
          </div>
        </WalletCard>
      )}

      {error && (
        <div style={{ padding: '10px 14px', borderRadius: 10, background: 'rgba(240,64,96,0.10)', border: '1px solid rgba(240,64,96,0.28)', color: '#FCA5A5', fontSize: 13 }}>{error}</div>
      )}

      <div style={{ ...COL, gap: 10 }}>
        <WalletButton variant="primary" size="lg" disabled={!valid} onClick={submit} iconRight="arrow_forward">
          {submitting ? 'Converting…' : 'Convert'}
        </WalletButton>
        <WalletButton variant="secondary" onClick={() => navigate('/wallet')}>Cancel</WalletButton>
      </div>
    </div>
  );
}

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
          <Row label="Username">@{profile?.username || '—'}</Row>
          <Row label="Email">{profile?.email ? maskEmail(profile.email) : '—'}</Row>
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
          <DangerBtn label="Freeze wallet" />
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


  { id: 'purchases',    label: 'Purchases',        match: (t) => t.type === 'buy' || t.type === 'coin_purchase' },
  { id: 'tournaments',  label: 'Tournaments',      match: (t) => t.type === 'tournament' || t.type === 'tournament_prize' || t.type === 'tournament_refund' },
  { id: 'memberships',  label: 'Memberships',      match: (t) => t.type === 'membership' || t.type === 'fan_renewal' },
];

export function NativeHistoryScreen() {
  const { profile } = useUser();
  const [filter, setFilter] = useState('all');
  const [txs, setTxs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [withdrawals, setWithdrawals] = useState([]);

  useEffect(() => {
    if (!profile?.uid) return;
    setLoading(true);
    getTransactions(profile.uid, 200).then(setTxs).catch(() => {}).finally(() => setLoading(false));
  }, [profile?.uid]);

  const loadWithdrawals = useCallback(async () => {
    try { const res = await getMyWithdrawals({ limit: 25 }); setWithdrawals(res?.rows || []); } catch { /* silent */ }
  }, []);
  useEffect(() => {
    if (!profile?.uid) return;
    loadWithdrawals();
    const t = setInterval(loadWithdrawals, 20000);
    return () => clearInterval(t);
  }, [profile?.uid, loadWithdrawals]);

  const activeWithdrawals = withdrawals.filter(w => w.status === 'pending' || w.status === 'ready' || w.status === 'processing');
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

      {activeWithdrawals.length > 0 && (
        <div style={{ ...COL, gap: 8 }}>
          <SectionLabel>Active withdrawals · {activeWithdrawals.length}</SectionLabel>
          {activeWithdrawals.map(w => <NativeWithdrawalRow key={w.id} w={w} onChanged={loadWithdrawals} />)}
        </div>
      )}

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
  const amount = tx.amount || 0;
  const credit = amount >= 0;
  const currency = tx.currency === 'gems' ? 'gems' : 'c';
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
          {credit ? '+' : ''}{fmtNum(amount)} {currency}
        </span>
        {showStatus && <StatusPill status={tx.status} />}
      </div>
    </div>
  );
}

function NativeWithdrawalRow({ w, onChanged }) {
  const [now, setNow] = useState(Date.now());
  const [cancelling, setCancelling] = useState(false);
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);

  const META = {
    pending:    { color: '#3B82F6', label: 'Pending', icon: 'schedule' },
    ready:      { color: '#A78BFA', label: 'Ready to send', icon: 'task_alt' },
    processing: { color: '#B44FFF', label: 'Processing', icon: 'sync' },
  };
  const m = META[w.status] || { color: WALLET_TOKENS.textMuted, label: w.status, icon: 'help' };
  const canCancel = w.status === 'pending' && w.cancelDeadline && now < w.cancelDeadline;
  const addrShort = w.destinationAddress ? `${w.destinationAddress.slice(0, 8)}…${w.destinationAddress.slice(-6)}` : '—';

  const cancel = async () => {
    if (!confirm('Cancel this withdrawal and refund your gems?')) return;
    setCancelling(true);
    try { await cancelWithdrawal({ payoutId: w.id }); onChanged?.(); } catch { /* surfaced elsewhere */ } finally { setCancelling(false); }
  };

  return (
    <WalletCard>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8, flexWrap: 'wrap' }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 10, padding: '3px 8px', borderRadius: 999, background: `${m.color}20`, color: m.color, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          <Icon name={m.icon} size={12} /> {m.label}
        </span>
        <span className="font-dmmono" style={{ fontSize: 13, fontWeight: 600 }}>{fmtNum(w.gemsRequested)} gems</span>
        {w.netUSDC && <span style={{ fontSize: 12, color: WALLET_TOKENS.textMuted }}>→ {w.netUSDC} USDC</span>}
      </div>
      <div style={{ fontSize: 12, color: WALLET_TOKENS.textMuted, fontFamily: 'monospace', marginBottom: 8 }}>{addrShort}</div>
      {canCancel && (
        <WalletButton variant="ghost" size="sm" icon="close" onClick={cancel} disabled={cancelling}>
          {cancelling ? 'Cancelling…' : 'Cancel'}
        </WalletButton>
      )}
    </WalletCard>
  );
}

// ───────────────────────────────────────────────────────── KYC

const KYC_TIERS = [
  { level: 0, name: 'Unverified', dailyEUR: 0, monthlyEUR: 0,
    requires: ['Email confirmed'], unlocks: ['Buy coins', 'Tip creators', 'Unlock paid content', 'Cannot be paid a revenue share'] },
  { level: 1, name: 'Basic', dailyEUR: 0, monthlyEUR: 50,
    requires: ['Government ID', 'Selfie liveness'], unlocks: ['VERGR can pay your creator revenue share', 'Paid up to €50 per month'] },
  { level: 2, name: 'Standard', dailyEUR: 0, monthlyEUR: 2500,
    requires: ['L1 + proof of address'], unlocks: ['Paid up to €2,500 per month', 'Faster payout schedules unlock'] },
  { level: 3, name: 'Premium', dailyEUR: 0, monthlyEUR: 15000,
    requires: ['L2 + source-of-funds on first €1,000+ deposit'], unlocks: ['Paid up to €15,000 per month', 'Priority support'] },
];

export function NativeKycScreen() {
  const navigate = useNavigate();
  const [kycLevel, setKycLevel] = useState(0);
  useEffect(() => { getMyWalletSecurityStatus().then(s => setKycLevel(s?.kycLevel ?? 0)).catch(() => {}); }, []);
  const start = () => navigate('/onboarding/identity?return=/wallet/kyc');

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
              <WalletButton variant="primary" full onClick={start} iconRight="arrow_forward">Start verification</WalletButton>
            )}
          </div>
        );
      })}

      <Callout tone="info" icon="info" title="Why we ask">
        EU regulators require identity verification for withdrawals. Documents go straight to Didit; we see only the result.
      </Callout>
    </div>
  );
}

// ───────────────────────────────────────────────────────── BUY

export function NativeBuyScreen() {
  const { showToast } = useUI();
  const [tab, setTab] = useState('packs');
  const [customEUR, setCustomEUR] = useState(20);
  // ONE shared checkout implementation (money flow) — see ../v2/buyCheckout.
  const { checkout, startCheckout, cancelCheckout } = useBuyCheckout(showToast);
  const customCoins = Math.floor((parseFloat(customEUR) || 0) / COIN_PRICE_USD);
  const { currentUser } = useAuth();
  const [playBusy, setPlayBusy] = useState('');
  const [playPrices, setPlayPrices] = useState({});
  const busy = checkout?.status === 'waiting' || Boolean(playBusy);

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

  // Route a pack purchase.
  //
  // ⚠ THIS USED TO FORCE PLAY BILLING and it was WRONG.
  //
  // The old comment here claimed "a card checkout for coins inside a Play app is
  // the payments-policy breach that gets an app pulled", and hid every other
  // rail plus the whole Custom tab on a store build. That belief contradicted
  // `PaymentMethodPicker.jsx`, which had already been written to the correct
  // rule and offers both rails on the web.
  //
  // Google may NOT compel Play Billing as the only option. What it does require
  // is a FAIR comparison: no steering, no badge calling one option better, no
  // pre-selection of the cheaper rail, and the Play price shown as Play's own
  // string. `<PaymentMethodPicker>` already implements exactly that, which is
  // why it is reused here instead of a native-only variant that could drift
  // away from the policy the web version encodes.
  //
  // The buyer picks. That is the whole point.
  const [payFor, setPayFor] = useState(null); // pack awaiting a method choice

  const buyPack = (pack) => setPayFor(pack);

  // Chosen rail for `payFor`. Play Billing only becomes reachable if the bridge
  // is actually up, so a broken bridge disables THAT ROW rather than blocking
  // the purchase entirely as it used to.
  const payWith = (pack, method) => {
    setPayFor(null);
    if (method === 'googlePlay') { buyViaPlay(pack); return; }
    startCheckout({ packSku: pack.id }, pack.name); // card or crypto, via PayRam
  };

  const buyViaPlay = async (pack) => {
    setPlayBusy(pack.id);
    try {
      const res = await buyCoinPack(playProductIdFor(pack.id), currentUser?.uid);
      showToast(`${fmtNum(res.coins || pack.coins)} coins added`, 'success');
    } catch (err) {
      // 'cancelled' is a normal user action, not an error worth shouting about.
      if (err?.code === 'cancelled') return;
      if (err?.code === 'pending') {
        showToast('Payment is processing. Your coins will arrive shortly.', 'info');
        return;
      }
      // redeem_failed means Play took the money but we could not credit it.
      // The purchase stays unconsumed and is retried on next launch, so tell
      // the user it is not lost rather than implying the payment failed.
      showToast(
        err?.code === 'redeem_failed'
          ? 'Payment received. Your coins are still being added — reopen the app if they do not appear.'
          : (err?.message || 'Purchase failed'),
        'error'
      );
    } finally {
      setPlayBusy('');
    }
  };

  return (
    <div style={{ ...COL, gap: 16, width: '100%', maxWidth: '100%' }}>
      <div>
        <div style={{ fontSize: 11, letterSpacing: '0.12em', textTransform: 'uppercase', color: WALLET_TOKENS.violetLight, fontWeight: 600, marginBottom: 6 }}>Buy coins</div>
        <h1 style={{ fontFamily: 'Syne, sans-serif', fontWeight: 700, fontSize: 26, letterSpacing: '-0.02em' }}>Top up your wallet.</h1>
        <p style={{ color: WALLET_TOKENS.textSecondary, fontSize: 13, marginTop: 6 }}>
          Card, Apple Pay, or instant bank. Coins land within seconds.
        </p>
      </div>

      {/* Segmented tabs */}
      <div style={{ display: 'flex', gap: 4, padding: 4, background: WALLET_TOKENS.surface2, borderRadius: 12 }}>
        <NativeTabBtn active={tab === 'packs'}  onClick={() => setTab('packs')}>Coin packs</NativeTabBtn>
        {/* No Custom tab on the Play build: Play Billing sells fixed SKUs only,
            and routing a custom amount through PayRam instead would be exactly
            the payments-policy breach that gets an app pulled. Huawei is the
            exception — it has no Play Billing at all and sells through PayRam
            by design, so a custom amount is fine there. */}
        {/* Custom amount is available on EVERY build, including Play.
            It was hidden on store builds under the same mistaken belief that
            corrupted buyPack. A custom amount cannot use Play Billing (fixed
            SKUs), so it is inherently an alternative-billing purchase, which is
            permitted. Hiding it removed a legitimate option from Play users for
            no policy reason. */}
        <NativeTabBtn active={tab === 'custom'} onClick={() => setTab('custom')}>Custom</NativeTabBtn>
      </div>

      {tab === 'packs' && (
        // Fixed 2-up grid — renders 2 cols at any width (no media query).
        <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' }}>
          {ACTIVE_COIN_PACKS.map(p => (
            <NativePackCard key={p.id} pack={p} busy={busy}
              playPrice={playPrices[playProductIdFor(p.id)]?.price}
              onBuy={() => buyPack(p)} />
          ))}
        </div>
      )}

      {tab === 'custom' && (
        <NativeCustomBuy eur={customEUR} setEur={setCustomEUR} busy={busy}
          onContinue={() => startCheckout({ customCoins }, `${fmtNum(customCoins)} coins`)} />
      )}

      {/* Method choice. Same component the web cart uses, so the fair-comparison
          rules live in ONE place and cannot drift between surfaces. */}
      {payFor && (
        <NativePayMethodSheet
          pack={payFor}
          playPrice={playPrices[playProductIdFor(payFor.id)]?.price}
          playAvailable={IS_STORE_BUILD && !IS_HUAWEI_BUILD && isPlayBillingSupported()}
          onPick={(m) => payWith(payFor, m)}
          onClose={() => setPayFor(null)}
        />
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
/**
 * Choose how to pay for a pack, on native.
 *
 * Wraps the SAME `<PaymentMethodPicker>` the web cart uses. That component
 * already encodes Play's alternative-billing requirements: identical padding,
 * type and tap target on every row, no "best value" badge, no colour that scores
 * one rail against another, and the Play row showing Play's OWN formatted price
 * rather than a number we calculated.
 *
 * Reused rather than reimplemented so those rules cannot drift apart between
 * web and native, which is exactly how this screen ended up Play-only in the
 * first place.
 */
function NativePayMethodSheet({ pack, playPrice, playAvailable, onPick, onClose }) {
  // Nothing is pre-selected as the better deal. 'card' is the default only
  // because it is first in the list, matching the web cart.
  const [method, setMethod] = useState('card');

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 200,
        background: 'rgba(5,5,10,0.72)', backdropFilter: 'blur(6px)',
        display: 'flex', alignItems: 'flex-end',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%', background: WALLET_TOKENS.surface1,
          borderTopLeftRadius: 20, borderTopRightRadius: 20,
          borderTop: `1px solid ${WALLET_TOKENS.hairline}`,
          padding: '18px 16px calc(18px + env(safe-area-inset-bottom))',
          color: WALLET_TOKENS.text, maxHeight: '88vh', overflowY: 'auto',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
          <span style={{ fontFamily: 'Syne, sans-serif', fontWeight: 800, fontSize: 17 }}>
            {pack.name}
          </span>
          <button onClick={onClose} aria-label="Close"
            style={{ background: 'none', border: 0, color: WALLET_TOKENS.textSecondary, padding: 4, cursor: 'pointer' }}>
            <Icon name="close" size={20} />
          </button>
        </div>
        <div style={{ fontSize: 12.5, color: WALLET_TOKENS.textMuted, marginBottom: 14 }}>
          {fmtNum(pack.coins)} coins{pack.vpBonus > 0 ? ` · +${fmtNum(pack.vpBonus)} VP` : ''}
        </div>

        <PaymentMethodPicker
          value={method}
          onChange={setMethod}
          googlePlayAvailable={playAvailable}
          coins={pack.coins}
          cardPrice={`$${pack.priceUSD.toFixed(2)}`}
          playPrice={playPrice}
          playPriceLoading={playAvailable && !playPrice}
          playUnavailableReason={playAvailable ? '' : 'Not available on this device'}
        />

        <button
          onClick={() => onPick(method)}
          style={{
            width: '100%', marginTop: 6, padding: '13px 16px', borderRadius: 12,
            border: 0, cursor: 'pointer', background: WALLET_TOKENS.gold,
            color: '#141018', font: 'inherit', fontWeight: 800, fontSize: 15,
          }}
        >
          Continue
        </button>
      </div>
    </div>
  );
}

function NativePackCard({ pack, onBuy, busy, playPrice }) {
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
      <div style={{ fontSize: 11, color: WALLET_TOKENS.textMuted, lineHeight: 1.35, marginBottom: 12, flex: 1 }}>{pack.tagline}</div>
      <div className="font-dmmono tabular-nums" style={{ fontSize: 18, fontWeight: 700, marginBottom: 10 }}>{playPrice || fmtUsd(pack.priceUSD)}</div>
      <WalletButton variant="primary" full disabled={busy} onClick={onBuy}>Buy</WalletButton>
    </div>
  );
}

function NativeCustomBuy({ eur, setEur, onContinue, busy }) {
  const eurNum = parseFloat(eur) || 0;
  const coins = Math.floor(eurNum / COIN_PRICE_USD);
  const valid = eurNum >= MIN_CUSTOM_USD;
  const procFee = eurNum * 0.015;
  return (
    <WalletCard>
      <SectionLabel>Amount</SectionLabel>
      <div style={{ display: 'flex', gap: 6, overflowX: 'auto', WebkitOverflowScrolling: 'touch', marginBottom: 14, paddingBottom: 2 }}>
        {[10, 20, 50, 100, 250].map(n => (
          <button key={n} onClick={() => setEur(n)} style={{
            flexShrink: 0, padding: '8px 14px', borderRadius: 10, fontSize: 13, fontWeight: 600,
            background: eur === n ? WALLET_TOKENS.violet : WALLET_TOKENS.surface2,
            color: eur === n ? '#fff' : WALLET_TOKENS.textSecondary,
            border: `1px solid ${eur === n ? WALLET_TOKENS.violet : WALLET_TOKENS.hairlineStrong}`,
          }}>{fmtEUR(n)}</button>
        ))}
      </div>
      <div style={{ position: 'relative', marginBottom: 14 }}>
        <span style={{ position: 'absolute', left: 16, top: '50%', transform: 'translateY(-50%)', fontSize: 26, fontWeight: 700, color: WALLET_TOKENS.goldLight, fontFamily: 'DM Mono, monospace' }}>€</span>
        <input value={eur} inputMode="decimal"
          onChange={(e) => setEur(e.target.value.replace(/[^\d.]/g, ''))}
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
      <FeeBreakdown
        items={[
          { label: 'You pay', value: fmtUsd(eurNum) },
          { label: 'Payment processing (~1.5%)', value: `-${fmtEUR(procFee)}`, tone: 'muted' },
          { label: 'VERGR fee', value: fmtUsd(0), tone: 'muted' },
        ]}
        total={`${fmtNum(coins)} coins`}
        totalLabel="You receive"
      />
      {!valid && eur && (
        <div style={{ marginTop: 12, fontSize: 12, color: '#FCD34D' }}>
          Minimum is {fmtUsd(MIN_CUSTOM_USD)} (set by our card processor).
        </div>
      )}
      <div style={{ marginTop: 18 }}>
        <WalletButton variant="primary" size="lg" full disabled={!valid || busy}
          icon="credit_card" iconRight="arrow_forward" onClick={onContinue}>
          Continue to checkout
        </WalletButton>
      </div>
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
      <WalletCard style={{ width: '100%', maxWidth: 460, textAlign: 'center', marginBottom: 'calc(env(safe-area-inset-bottom) + 8px)' }}>
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
