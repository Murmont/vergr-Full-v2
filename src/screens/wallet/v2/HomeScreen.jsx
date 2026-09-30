// Wallet Home (v2) — ports the design's HomeScreen layout from
// _wallet3_tmp/src/screens.jsx. Single unified wallet for everyone; KYC is
// the only gate on payouts, which now live in Creator Studio under Earnings.
//
// Layout (matches design):
//   ┌───────────────────────────────────────┬──────────┐
//   │ Greeting + security chips             │ Right    │
//   │ 2-col balance grid (Coins/VP)         │ rail:    │
//   │ 4-up quick actions                    │ Limits   │
//   │ Recent activity                       │ Security │
//   │                                       │ Help     │
//   └───────────────────────────────────────┴──────────┘

import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useUser } from '../../../context/UserContext';
import { useWalletUnlock } from '../../../context/WalletUnlockContext';
import {
  WalletCard, WalletButton, SectionLabel, Pill, Callout,
  CoinGlyph, VPGlyph, AnimatedNumber, StatusPill,
  WALLET_TOKENS, fmtNum, fmtEUR, fmtUsd, txAmount,
} from '../../../components/wallet/primitives';
import Icon from '../../../components/Icon';
import MyBoosts from '../../../components/wallet/MyBoosts';
import { getTransactions } from '../../../firebase/firestore';
import { getVPLevel, getNextVPLevel, COIN_VALUE_USD } from '../../../utils/vpSystem';
import { getMyWalletSecurityStatus } from '../../../firebase/walletCallables';
import { resyncNow } from '../../../firebase/resync';

const useGreeting = () => {
  const h = new Date().getHours();
  if (h < 5)  return 'Good evening';
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
};

export default function HomeScreen() {
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

  // A balance served from the on-device cache is not a balance we can vouch
  // for. With persistentLocalCache on, a stalled connection does not error, it
  // just keeps handing back the last document it saw, so a wrong number looks
  // exactly like a right one. Saying so is the difference between a delay and
  // a lie. `_fromCache` is true on a normal cold start too, for the moment
  // before the server answers, so the notice is deliberately quiet.
  const unverified = wallet?._fromCache === true;

  const vp    = wallet?.vp      || 0;
  const vpInfo = getVPLevel(vp);
  const vpNext = getNextVPLevel(vp);
  const vpToNext = vpNext ? Math.max(0, vpNext.vpRequired - vp) : 0;

  const kycLevel = secStatus?.kycLevel ?? 0;
  const frozen = !!secStatus?.walletFrozen;


  const tryGo = (path) => requirePin(() => navigate(path));

  return (
    <div className="vg-walletHome-grid" style={{
      display: 'grid', gap: 32,
      gridTemplateColumns: 'minmax(0, 1fr) 320px',
      maxWidth: 1280, margin: '0 auto',
    }}>
      <div style={{ minWidth: 0 }}>
        {/* Frozen banner */}
        {frozen && (
          <div style={{ marginBottom: 20 }}>
            <Callout tone="danger" icon="report" title="Your wallet is frozen"
                     action={<WalletButton variant="danger" size="sm">Contact support</WalletButton>}>
              Payouts are paused. Reach support to resolve.
            </Callout>
          </div>
        )}

        {/* Greeting + security chips */}
        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end',
          gap: 16, marginBottom: 24, flexWrap: 'wrap',
        }}>
          <div>
            <div style={{
              fontFamily: 'Syne, sans-serif', fontWeight: 700, fontSize: 28,
              marginBottom: 4, letterSpacing: '-0.02em',
            }}>
              {greeting}{profile?.displayName ? `, ${profile.displayName.split(' ')[0]}.` : '.'}
            </div>
            <div style={{ color: WALLET_TOKENS.textSecondary, fontSize: 14 }}>
              Your wallet, your earnings.
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Chip ok={secStatus?.pinSet}      label="PIN"  />
            <Chip ok={secStatus?.totpEnrolled} label="2FA"  />
            <Chip ok={kycLevel >= 1}          label={`KYC L${kycLevel}`} />
          </div>
        </div>

        {/* 3-col balance grid */}
        <div className="vg-walletHome-bals" style={{
          display: 'grid', gap: 16,
          gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
        }}>
          {/* Coins */}
          <BalCard
            tint="coin"
            glyph={<CoinGlyph size={32} />}
            label="Coins"
            labelColor={WALLET_TOKENS.gold}
            value={coins}
            valueColor={WALLET_TOKENS.goldLight}
            fiat={fmtUsd(coins * COIN_VALUE_USD)}
            below={boostCoins > 0 ? (
              <div style={{ marginTop: 6, fontSize: 12, color: WALLET_TOKENS.textMuted }}>
                + <span className="font-dmmono tabular-nums" style={{ color: WALLET_TOKENS.goldLight, fontWeight: 700 }}>{fmtNum(boostCoins)}</span> boost coins, for boosts and VP packs
              </div>
            ) : null}
            actions={
              <>
                <WalletButton size="sm" variant="primary" onClick={() => navigate('/wallet/buy')}>Buy</WalletButton>
                <WalletButton size="sm" variant="secondary" onClick={() => navigate('/wallet/history')}>History</WalletButton>
              </>
            }
            note={unverified ? (
              <button
                onClick={() => resyncNow()}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 5, marginTop: 8,
                  background: 'transparent', border: 0, padding: 0, cursor: 'pointer',
                  fontSize: 11.5, color: WALLET_TOKENS.textMuted,
                }}
              >
                <Icon name="cloud_off" size={13} />
                Showing your last known balance. Tap to refresh.
              </button>
            ) : null}
          />

          {/* VP */}
          <BalCard
            tint="vp"
            glyph={<VPGlyph size={32} />}
            label="VP"
            labelColor={WALLET_TOKENS.violetLight}
            value={vp}
            valueColor={WALLET_TOKENS.violetLight}
            below={
              <div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 6, flexWrap: 'wrap' }}>
                  <Pill tone="violet" size="sm">{vpInfo.name} · Lvl {vpInfo.level}</Pill>
                  {vpNext && <span className="font-dmmono" style={{ fontSize: 12, color: WALLET_TOKENS.textMuted }}>
                    {fmtNum(vpToNext)} VP to Lvl {vpNext.level}
                  </span>}
                </div>
                {vpNext && (
                  <div style={{
                    marginTop: 10, height: 4,
                    background: 'rgba(255,255,255,0.06)', borderRadius: 2, overflow: 'hidden',
                  }}>
                    <div style={{
                      width: `${Math.min(100, ((vpInfo.vpRequired - vpToNext) / vpInfo.vpRequired) * 100)}%`,
                      height: '100%', background: WALLET_TOKENS.violetLight,
                    }} />
                  </div>
                )}
                {/* The conversion-commission line that lived here was the ONE
                    economic perk of rank. Revenue share is now keyed to lifetime
                    earnings, not VP, so quoting a rate here would be false.
                    Rank is cosmetic until a replacement perk is decided. */}
              </div>
            }
          />

          {/* The Gems card was removed 2026-08-14. Gems are no longer a
              balance a user holds; they are accrued revenue share Vergr
              owes a creator, paid on a schedule. It lives in Creator
              Studio under Earnings, not in a spending wallet. */}
        </div>

        {/* 4-up quick actions */}
        <div className="vg-walletHome-quick" style={{
          display: 'grid', gap: 12, marginTop: 24,
          gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
        }}>
          <QuickAction icon="shopping_cart" color={WALLET_TOKENS.gold}
            title="Buy coins" sub="Card or bank" onClick={() => navigate('/wallet/buy')} />
          <QuickAction icon="workspace_premium" color={WALLET_TOKENS.success}
            title="Subscriptions" sub="Creators you support" onClick={() => navigate('/memberships')} />
          {/* /boost was ROUTED and linked from nowhere (audit A31): a whole
              revenue category sat behind a URL nobody could reach, and every
              purchase on it failed anyway. Purchases work now, so it gets an
              entry point. The wallet is the right home — it is where you spend
              coins. */}
          <QuickAction icon="rocket_launch" color={WALLET_TOKENS.violet}
            title="Boosts" sub="Get seen by more people" onClick={() => navigate('/wallet/buy')} />
        </div>

        {/* What you own. Boosts are inventory now, and inventory you cannot see
            is indistinguishable from inventory you do not have. */}
        <div style={{ marginTop: 24 }}>
          <MyBoosts />
        </div>

        {/* Recent activity */}
        <div style={{ marginTop: 32 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <h2 style={{ fontFamily: 'Syne, sans-serif', fontWeight: 700, fontSize: 18 }}>Recent activity</h2>
            <button onClick={() => navigate('/wallet/history')} style={{
              fontSize: 12, color: WALLET_TOKENS.violetLight, background: 'transparent',
              border: 'none', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 4,
            }}>View all <Icon name="arrow_forward" size={14} /></button>
          </div>
          <WalletCard padding={8}>
            {txs.length === 0 ? (
              <div style={{ padding: 48, textAlign: 'center', color: WALLET_TOKENS.textMuted, fontSize: 14 }}>
                Nothing here yet. Activity shows up as it happens.
              </div>
            ) : txs.map(t => <TxRow key={t.id} tx={t} />)}
          </WalletCard>
        </div>
      </div>

      {/* Right rail */}
      <RightRail
        navigate={navigate}
        kycLevel={kycLevel}
        secStatus={secStatus}
      />

      <style>{`
        @media (max-width: 1100px) {
          .vg-walletHome-grid { grid-template-columns: 1fr !important; }
        }
        @media (max-width: 880px) {
          .vg-walletHome-bals  { grid-template-columns: 1fr !important; }
          .vg-walletHome-quick { grid-template-columns: repeat(2, minmax(0, 1fr)) !important; }
        }
      `}</style>
    </div>
  );
}

function Chip({ ok, label }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 6,
      padding: '4px 10px', borderRadius: 999, fontSize: 11, fontWeight: 600,
      background: ok ? 'rgba(34,197,94,0.10)' : 'rgba(255,255,255,0.04)',
      color: ok ? '#86EFAC' : WALLET_TOKENS.textMuted,
      border: `1px solid ${ok ? 'rgba(34,197,94,0.28)' : WALLET_TOKENS.hairline}`,
    }}>
      <Icon name={ok ? 'check_circle' : 'radio_button_unchecked'} size={12} />
      {label}
    </span>
  );
}

function BalCard({ tint, glyph, label, labelColor, value, valueColor, fiat, below, actions, lockOverlay, note }) {
  const gradMap = {
    coin: 'rgba(240,165,0,0.08)',
    vp:   'rgba(123,31,255,0.08)',
    gem:  'rgba(61,127,255,0.08)',
  };
  return (
    <div style={{
      padding: 20, borderRadius: 18, position: 'relative', overflow: 'hidden',
      background: `linear-gradient(180deg, ${gradMap[tint]} 0%, transparent 60%), ${WALLET_TOKENS.surface1}`,
      border: `1px solid ${WALLET_TOKENS.hairline}`,
      minHeight: 220, display: 'flex', flexDirection: 'column',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14 }}>
        <div>{glyph}</div>
        <div style={{
          fontSize: 10, letterSpacing: '0.12em', textTransform: 'uppercase',
          color: labelColor, fontWeight: 600, marginTop: 6,
        }}>{label}</div>
      </div>
      <div className="font-dmmono tabular-nums" style={{
        fontSize: 40, lineHeight: 1, letterSpacing: '-0.03em',
        fontWeight: 700, color: valueColor,
      }}>
        <AnimatedNumber value={value} />
      </div>
      {fiat && (
        <div className="font-dmmono" style={{ fontSize: 13, color: WALLET_TOKENS.textMuted, marginTop: 6 }}>
          ≈ {fiat}
        </div>
      )}
      {note}
      {below}
      {actions && (
        <div style={{ display: 'flex', gap: 8, marginTop: 'auto', paddingTop: 16, flexWrap: 'wrap' }}>
          {actions}
        </div>
      )}
      {/* A BANNER, not a cover.
          This used to be `position:absolute; inset:0` with a blurred backdrop,
          which hid the balance entirely: a user could not see their coin balance
          until they finished KYC. The balance is THEIRS and was never the thing
          being gated. Hiding it reads as "your money is gone" rather than "one
          more step to finish". Nothing here can be withdrawn in any case.
          The gate is enforced by the server either way, so nothing is
          concealed here. */}
      {lockOverlay && (
        <div style={{
          marginTop: 12, padding: '10px 12px', borderRadius: 12,
          background: 'rgba(123,31,255,0.08)',
          border: '1px solid rgba(123,31,255,0.24)',
          display: 'flex', alignItems: 'flex-start', gap: 10,
        }}>
          <Icon name={lockOverlay.icon} size={18} style={{ color: WALLET_TOKENS.violetLight, flexShrink: 0, marginTop: 1 }} />
          <div style={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
            <div style={{ fontWeight: 700, fontSize: 12.5, marginBottom: 2 }}>
              {lockOverlay.title}
            </div>
            <div style={{ fontSize: 11.5, color: WALLET_TOKENS.textSecondary, lineHeight: 1.45 }}>
              {lockOverlay.body}
            </div>
            <button
              type="button"
              onClick={lockOverlay.onAction}
              style={{
                marginTop: 8, padding: '6px 12px', borderRadius: 8, border: 0,
                cursor: 'pointer', font: 'inherit', fontWeight: 700, fontSize: 12,
                background: WALLET_TOKENS.violet, color: '#fff',
              }}
            >
              {lockOverlay.actionLabel}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function QuickAction({ icon, title, sub, color, onClick, locked }) {
  return (
    <button onClick={onClick} style={{
      padding: 16, textAlign: 'left', cursor: 'pointer',
      background: WALLET_TOKENS.surface1,
      border: `1px solid ${WALLET_TOKENS.hairline}`,
      borderRadius: 14, position: 'relative',
      color: WALLET_TOKENS.text, transition: 'all 0.15s',
    }}
    onMouseEnter={(e) => e.currentTarget.style.borderColor = WALLET_TOKENS.hairlineStrong}
    onMouseLeave={(e) => e.currentTarget.style.borderColor = WALLET_TOKENS.hairline}>
      <div style={{
        width: 38, height: 38, borderRadius: 10,
        background: `${color}1F`, color, display: 'grid', placeItems: 'center', marginBottom: 12,
      }}>
        <Icon name={icon} size={20} />
      </div>
      <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 2 }}>{title}</div>
      <div style={{ fontSize: 11, color: WALLET_TOKENS.textMuted }}>{sub}</div>
      {locked && (
        <div style={{ position: 'absolute', top: 14, right: 14, color: WALLET_TOKENS.textMuted }}>
          <Icon name="lock" size={14} />
        </div>
      )}
    </button>
  );
}

function TxRow({ tx }) {
  const typeMap = {
    tip_received:  { icon: 'south_west', tone: 'success' },
    tip_sent:      { icon: 'north_east', tone: 'ember' },
    conversion:    { icon: 'swap_horiz', tone: 'violet' },
    coin_purchase: { icon: 'add', tone: 'gold' },
    buy:           { icon: 'add', tone: 'gold' },
    gem_withdrawal:{ icon: 'north_east', tone: 'gem' },
    withdrawal:    { icon: 'north_east', tone: 'gem' },
    membership:    { icon: 'auto_awesome', tone: 'pink' },
    tournament_prize: { icon: 'emoji_events', tone: 'gold' },
  };
  const m = typeMap[tx.type] || { icon: 'receipt', tone: 'neutral' };
  const colorMap = {
    success: { bg: 'rgba(34,197,94,0.12)', fg: '#86EFAC' },
    ember:   { bg: 'rgba(240,64,96,0.12)', fg: '#FCA5A5' },
    violet:  { bg: 'rgba(123,31,255,0.12)', fg: WALLET_TOKENS.violetLight },
    gold:    { bg: 'rgba(240,165,0,0.12)',  fg: WALLET_TOKENS.goldLight },
    gem:     { bg: 'rgba(61,127,255,0.12)', fg: '#7CA3FF' },
    pink:    { bg: 'rgba(200,127,255,0.12)', fg: WALLET_TOKENS.pink },
    neutral: { bg: 'rgba(255,255,255,0.05)', fg: WALLET_TOKENS.textSecondary },
  };
  const c = colorMap[m.tone];
  const shown = txAmount(tx);
  const credit = shown.credit;
  const when = tx.createdAt
    ? new Date(tx.createdAt.seconds ? tx.createdAt.seconds * 1000 : tx.createdAt).toLocaleString()
    : '';
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: '40px 1fr auto auto',
      alignItems: 'center', gap: 12,
      padding: '12px 14px', borderRadius: 10,
    }}
    onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.025)'}
    onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}>
      <div style={{
        width: 36, height: 36, borderRadius: '50%',
        background: c.bg, color: c.fg, display: 'grid', placeItems: 'center',
      }}>
        <Icon name={m.icon} size={18} />
      </div>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontWeight: 500, fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {tx.description || tx.type || 'Transaction'}
        </div>
        <div style={{ fontSize: 12, color: WALLET_TOKENS.textMuted }}>{when}</div>
      </div>
      <div className="font-dmmono tabular-nums" style={{
        fontWeight: 600, fontSize: 14, textAlign: 'right',
        color: credit ? '#86EFAC' : WALLET_TOKENS.text,
      }}>
        {shown.text}
      </div>
      {tx.status && tx.status !== 'settled' && tx.status !== 'completed'
        ? <StatusPill status={tx.status} />
        : <span />}
    </div>
  );
}

function RightRail({ navigate, kycLevel, secStatus }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}>
      {/* Earnings pointer.
          This was a "Withdrawal limits" card. The KYC tiers still cap money
          leaving, but they now cap what VERGR PAYS a creator on a schedule,
          not what a user pulls from a balance, so they belong beside the payout
          schedule in Creator Studio rather than in a spending wallet. */}

      {/* Security */}
      <WalletCard>
        <SectionLabel>Security</SectionLabel>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <SecRow ok={!!secStatus?.pinSet}      label={secStatus?.pinSet ? 'PIN set' : 'Set up your PIN'} />
          <SecRow ok={!!secStatus?.totpEnrolled} label={secStatus?.totpEnrolled ? '2FA on' : '2FA off (recommended)'} />
          <SecRow ok={kycLevel >= 1}             label={kycLevel >= 1 ? `KYC Level ${kycLevel}` : 'KYC not started'} />
        </div>
        <div style={{ marginTop: 14 }}>
          <button onClick={() => navigate('/wallet/security')} style={{
            background: 'transparent', border: 'none', color: WALLET_TOKENS.violetLight,
            fontSize: 12, padding: 0, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 4,
          }}>Manage security <Icon name="arrow_forward" size={14} /></button>
        </div>
      </WalletCard>

      {/* Help */}
      <WalletCard>
        <SectionLabel>Need a hand?</SectionLabel>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <a onClick={() => navigate('/wallet/help')} style={{ fontSize: 13, color: WALLET_TOKENS.textSecondary, cursor: 'pointer' }}>What coins are and how to use them</a>
          <a onClick={() => navigate('/wallet/help')} style={{ fontSize: 13, color: WALLET_TOKENS.textSecondary, cursor: 'pointer' }}>Contact support</a>
        </div>
      </WalletCard>
    </div>
  );
}

function SecRow({ ok, label }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <Icon name={ok ? 'check_circle' : 'radio_button_unchecked'} size={14}
            className={ok ? 'text-emerald-400' : 'text-zinc-500'} />
      <span style={{ fontSize: 13, color: ok ? WALLET_TOKENS.text : WALLET_TOKENS.textMuted }}>{label}</span>
    </div>
  );
}
