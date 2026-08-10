// Convert (v2) — ports the design's ConvertScreen with REAL VP-tier commission
// from src/utils/vpSystem.js (NOT the design's 6-tier mock).
// Calls existing convertCoinsToGems Cloud Function callable.

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useUser } from '../../../context/UserContext';
import { useWalletUnlock } from '../../../context/WalletUnlockContext';
import {
  WalletCard, WalletButton, SectionLabel, Pill, FeeBreakdown,
  CoinGlyph, GemGlyph, WALLET_TOKENS, fmtNum, fmtEUR, AnimatedNumber,
} from '../../../components/wallet/primitives';
import Icon from '../../../components/Icon';
import { getVPLevel, getNextVPLevel, getCommission } from '../../../utils/vpSystem';
import { convertCoinsToGems } from '../../../firebase/firestore';

const GEM_TO_EUR = 0.009;

export default function ConvertScreen() {
  const { profile, wallet } = useUser();
  const { requirePin } = useWalletUnlock();
  const navigate = useNavigate();

  // Only RECEIVED coins convert to gems. Coins the user bought are spendable
  // anywhere in VERGR but never cashable, because converting purchased coins
  // and withdrawing would turn Play Billing into a cash-out rail. Mirrors
  // convertibleCoins() in functions/coinLedger.js — the server is the
  // authority, this is only so the UI never offers what will be refused.
  const totalCoins = wallet?.balance || 0;
  const coins = Math.min(Math.max(0, wallet?.earnedBalance || 0), totalCoins);
  const lockedCoins = Math.max(0, totalCoins - coins);
  const vp = wallet?.vp || 0;
  const vpInfo = getVPLevel(vp);
  const vpNext = getNextVPLevel(vp);
  const commission = getCommission(vp);   // matches server (keyed off live VP)
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
      setSubmitting(true);
      setError(null);
      try {
        const result = await convertCoinsToGems(profile.uid, amount);
        setReceived(result?.gemsReceived ?? gemsOut);
        setDone(true);
      } catch (e) {
        setError(e?.message || 'Conversion failed. Try again.');
      } finally {
        setSubmitting(false);
      }
    });
  };

  if (done) {
    return (
      <div style={{ maxWidth: 720, margin: '0 auto' }}>
        <WalletCard padding={48} style={{ textAlign: 'center' }}>
          <div style={{
            width: 80, height: 80, margin: '0 auto 20px', borderRadius: '50%',
            background: 'rgba(34,197,94,0.14)', display: 'grid', placeItems: 'center',
            border: '1px solid rgba(34,197,94,0.4)',
          }}>
            <Icon name="check" size={36} className="text-emerald-400" />
          </div>
          <div style={{ fontFamily: 'Syne, sans-serif', fontWeight: 700, fontSize: 28, marginBottom: 6 }}>
            <AnimatedNumber value={received} /> gems credited.
          </div>
          <div style={{ color: WALLET_TOKENS.textSecondary, fontSize: 14, marginBottom: 24 }}>
            Conversion settled. Ready to withdraw or hold.
          </div>
          <div style={{ display: 'flex', gap: 12, justifyContent: 'center' }}>
            <WalletButton variant="secondary" onClick={() => { setDone(false); setAmount(0); }}>Convert more</WalletButton>
            <WalletButton variant="primary" onClick={() => navigate('/wallet/withdraw')} iconRight="arrow_forward">
              Withdraw now
            </WalletButton>
          </div>
        </WalletCard>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 920, margin: '0 auto' }}>
      <div style={{ marginBottom: 24 }}>
        <div style={{
          fontSize: 11, letterSpacing: '0.12em', textTransform: 'uppercase',
          color: WALLET_TOKENS.violetLight, fontWeight: 600, marginBottom: 8,
        }}>Convert</div>
        <h1 style={{ fontFamily: 'Syne, sans-serif', fontWeight: 700, fontSize: 30, letterSpacing: '-0.02em' }}>
          Coins to gems.
        </h1>
        <p style={{ color: WALLET_TOKENS.textSecondary, fontSize: 14, marginTop: 8 }}>
          Gems are the only currency that cashes out. Conversion rate depends on your rank.
        </p>
      </div>

      <div className="vg-convert-grid" style={{
        display: 'grid', gap: 16,
        gridTemplateColumns: '1fr auto 1fr', alignItems: 'stretch',
      }}>
        {/* FROM */}
        <WalletCard>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 18 }}>
            <CoinGlyph size={32} />
            <div>
              <div style={{ fontSize: 10, letterSpacing: '0.12em', textTransform: 'uppercase', color: WALLET_TOKENS.gold, fontWeight: 600 }}>From</div>
              <div style={{ fontWeight: 600, fontSize: 15 }}>Coins</div>
            </div>
          </div>
          <input value={amount}
            onChange={(e) => setAmount(Math.max(0, parseInt(e.target.value.replace(/\D/g, '')) || 0))}
            inputMode="numeric"
            style={{
              width: '100%', height: 64, padding: '0 18px',
              fontSize: 32, fontWeight: 700,
              fontFamily: 'DM Mono, monospace',
              color: WALLET_TOKENS.goldLight,
              background: WALLET_TOKENS.surface2,
              border: `1px solid ${WALLET_TOKENS.hairlineStrong}`,
              borderRadius: 12, outline: 'none',
            }} />
          <div style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            marginTop: 12,
          }}>
            <span className="font-dmmono" style={{ fontSize: 13, color: WALLET_TOKENS.textMuted }}>
              {fmtNum(coins)} c convertible
            </span>
            <div style={{ display: 'flex', gap: 6 }}>
              <SmallBtn onClick={() => setAmount(Math.floor(coins / 2))}>50%</SmallBtn>
              <SmallBtn onClick={() => setAmount(coins)}>Max</SmallBtn>
            </div>
          </div>
          {lockedCoins > 0 && (
            <p style={{
              marginTop: 10, fontSize: 12, lineHeight: 1.5,
              color: WALLET_TOKENS.textMuted,
            }}>
              {fmtNum(lockedCoins)} of your {fmtNum(totalCoins)} coins were purchased.
              Purchased coins can be spent anywhere in VERGR (tips, tickets,
              subscriptions, tournaments), but only coins you have earned can be
              converted to gems and withdrawn.
            </p>
          )}
        </WalletCard>

        {/* Arrow + commission chip */}
        <div className="vg-convert-arrow" style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center',
          justifyContent: 'center', padding: '0 8px',
        }}>
          <div style={{
            width: 48, height: 48, borderRadius: '50%',
            background: WALLET_TOKENS.surface2,
            border: `1px solid ${WALLET_TOKENS.hairlineStrong}`,
            display: 'grid', placeItems: 'center',
            color: WALLET_TOKENS.violetLight,
          }}>
            <Icon name="arrow_forward" size={20} />
          </div>
          <div style={{ marginTop: 12 }}>
            <Pill tone="violet" size="sm">{commissionPct}% commission</Pill>
          </div>
        </div>

        {/* TO */}
        <WalletCard>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 18 }}>
            <GemGlyph size={32} />
            <div>
              <div style={{ fontSize: 10, letterSpacing: '0.12em', textTransform: 'uppercase', color: WALLET_TOKENS.gemBlue, fontWeight: 600 }}>To</div>
              <div style={{ fontWeight: 600, fontSize: 15 }}>Gems</div>
            </div>
          </div>
          <div style={{
            display: 'flex', alignItems: 'center', paddingLeft: 18,
            width: '100%', height: 64,
            fontSize: 32, fontWeight: 700,
            fontFamily: 'DM Mono, monospace',
            color: '#7CA3FF',
            background: WALLET_TOKENS.surface2,
            border: `1px solid ${WALLET_TOKENS.hairline}`,
            borderRadius: 12,
          }}>
            <AnimatedNumber value={gemsOut} />
          </div>
          <div className="font-dmmono" style={{ fontSize: 13, color: WALLET_TOKENS.textMuted, marginTop: 12 }}>
            Worth ≈ {fmtEUR(gemsOut * GEM_TO_EUR)}
          </div>
        </WalletCard>
      </div>

      {/* Breakdown */}
      <div style={{ marginTop: 24 }}>
        <FeeBreakdown
          items={[
            { label: 'You spend', value: `${fmtNum(amount)} c` },
            { label: `Commission (${vpInfo.name} L${vpInfo.level}, ${commissionPct}%)`, value: `-${fmtNum(amount - gemsOut)} c` },
            { label: 'Conversion rate', value: `1 c → ${(1 - commission).toFixed(2)} gems`, tone: 'muted' },
          ]}
          total={`+${fmtNum(gemsOut)} gems · ≈ ${fmtEUR(gemsOut * GEM_TO_EUR)}`}
        />
      </div>

      {/* Rank progress */}
      {vpNext && (
        <WalletCard style={{ marginTop: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
            <div>
              <div style={{ fontWeight: 600, fontSize: 14 }}>
                {fmtNum(Math.max(0, vpNext.vpRequired - vp))} VP to Lvl {vpNext.level}
              </div>
              <div style={{ color: WALLET_TOKENS.textSecondary, fontSize: 13, marginTop: 4 }}>
                Reach Lvl {vpNext.level} to drop your commission to {Math.round(vpNext.commission * 100)}%.
              </div>
            </div>
            <Pill tone="violet" size="sm">{vpInfo.name} L{vpInfo.level}</Pill>
          </div>
          <div style={{
            height: 6, background: 'rgba(255,255,255,0.06)', borderRadius: 3, overflow: 'hidden',
            marginTop: 10,
          }}>
            <div style={{
              width: `${Math.min(100, (vp / vpNext.vpRequired) * 100)}%`,
              height: '100%', background: WALLET_TOKENS.violetLight,
            }} />
          </div>
        </WalletCard>
      )}

      {error && (
        <div style={{
          marginTop: 16, padding: '10px 14px', borderRadius: 10,
          background: 'rgba(240,64,96,0.10)',
          border: '1px solid rgba(240,64,96,0.28)',
          color: '#FCA5A5', fontSize: 13,
        }}>{error}</div>
      )}

      <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end', marginTop: 24 }}>
        <WalletButton variant="secondary" onClick={() => navigate('/wallet')}>Cancel</WalletButton>
        <WalletButton variant="primary" size="lg" disabled={!valid} onClick={submit} iconRight="arrow_forward">
          {submitting ? 'Converting…' : 'Convert'}
        </WalletButton>
      </div>

      <style>{`
        @media (max-width: 760px) {
          .vg-convert-grid  { grid-template-columns: 1fr !important; }
          .vg-convert-arrow { transform: rotate(90deg); padding: 12px 0 !important; }
        }
      `}</style>
    </div>
  );
}

function SmallBtn({ children, onClick }) {
  return (
    <button onClick={onClick} style={{
      padding: '0 10px', height: 28, fontSize: 12,
      background: 'transparent', border: `1px solid ${WALLET_TOKENS.hairline}`,
      color: WALLET_TOKENS.textSecondary, borderRadius: 8, cursor: 'pointer',
    }}>{children}</button>
  );
}
