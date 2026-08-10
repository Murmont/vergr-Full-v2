// KYC (v2) — ports the design's KycScreen with REAL CLAUDE.md limits.
// "Start verification" deep-links to the existing Didit wizard. The wallet's
// KYC screen is read-only display + ladder + entry point.

import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  WalletCard, WalletButton, Pill, Callout, SectionLabel, WALLET_TOKENS, fmtEUR,
} from '../../../components/wallet/primitives';
import Icon from '../../../components/Icon';
import { getMyWalletSecurityStatus } from '../../../firebase/walletCallables';

// CLAUDE.md-locked KYC tiers — DO NOT use the design's mock numbers.
const KYC_TIERS = [
  { level: 0, name: 'Unverified', dailyEUR: 0,    monthlyEUR: 0,
    requires: ['Email confirmed'],
    unlocks:  ['Buy coins', 'Tip creators', 'Receive gems', 'No withdrawals'] },
  { level: 1, name: 'Basic',      dailyEUR: 0,    monthlyEUR: 50,
    requires: ['Government ID', 'Selfie liveness'],
    unlocks:  ['Convert coins to gems', 'Crypto withdrawals up to €50/month'] },
  { level: 2, name: 'Standard',   dailyEUR: 500,  monthlyEUR: 2500,
    requires: ['L1 + proof of address (utility bill / bank statement)'],
    unlocks:  ['Crypto withdrawals €500/day, €2,500/month', 'Bank withdrawals'] },
  { level: 3, name: 'Premium',    dailyEUR: 2500, monthlyEUR: 15000,
    requires: ['L2 + source-of-funds declaration on first €1,000+ deposit'],
    unlocks:  ['Crypto withdrawals €2,500/day, €15,000/month', 'Priority support'] },
];

export default function KycScreen() {
  const navigate = useNavigate();
  const [kycLevel, setKycLevel] = useState(0);

  useEffect(() => {
    getMyWalletSecurityStatus()
      .then(s => setKycLevel(s?.kycLevel ?? 0))
      .catch(() => {});
  }, []);

  // Existing Didit wizard route lives at /onboarding/identity per AppRouter.
  // KycWizard is the underlying component; we deep-link with a return param
  // that the wizard already respects.
  const startVerification = () => {
    navigate('/onboarding/identity?return=/wallet/kyc');
  };

  return (
    <div style={{ maxWidth: 920, margin: '0 auto' }}>
      <div style={{ marginBottom: 24 }}>
        <div style={{ fontSize: 11, letterSpacing: '0.12em', textTransform: 'uppercase', color: WALLET_TOKENS.violetLight, fontWeight: 600 }}>
          Identity verification
        </div>
        <h1 style={{ fontFamily: 'Syne, sans-serif', fontWeight: 700, fontSize: 30, marginTop: 8, letterSpacing: '-0.02em' }}>
          Raise your limits.
        </h1>
        <p style={{ color: WALLET_TOKENS.textSecondary, fontSize: 14, marginTop: 8 }}>
          Each tier unlocks more. Verification is quick. We use Didit, an EU-licensed identity provider.
        </p>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {KYC_TIERS.map(t => {
          const done = kycLevel > t.level;
          const current = kycLevel === t.level;
          const next = kycLevel + 1 === t.level;
          const future = kycLevel + 1 < t.level;
          return (
            <div key={t.level} style={{
              padding: 24, borderRadius: 16,
              background: current
                ? 'linear-gradient(135deg, rgba(34,197,94,0.08), transparent 50%)'
                : WALLET_TOKENS.surface1,
              border: `1px solid ${current
                ? 'rgba(34,197,94,0.40)'
                : next ? WALLET_TOKENS.hairlineStrong : WALLET_TOKENS.hairline}`,
              opacity: future ? 0.55 : 1,
            }}>
              <div className="vg-walletKyc-row" style={{
                display: 'grid', gap: 20,
                gridTemplateColumns: '64px 1fr auto',
                alignItems: 'flex-start',
              }}>
                <div style={{
                  width: 56, height: 56, borderRadius: 16,
                  background: done || current ? 'rgba(34,197,94,0.16)' : WALLET_TOKENS.surface2,
                  border: `1px solid ${done || current ? 'rgba(34,197,94,0.40)' : WALLET_TOKENS.hairline}`,
                  display: 'grid', placeItems: 'center',
                  fontFamily: 'Syne, sans-serif', fontWeight: 700, fontSize: 18,
                  color: done || current ? '#86EFAC' : WALLET_TOKENS.textSecondary,
                }}>
                  {done ? <Icon name="check" size={22} className="text-emerald-400" /> : `L${t.level}`}
                </div>
                <div style={{ minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10, flexWrap: 'wrap' }}>
                    <div style={{ fontFamily: 'Syne, sans-serif', fontWeight: 700, fontSize: 20 }}>{t.name}</div>
                    {done && <Pill tone="success" size="sm">Complete</Pill>}
                    {current && <Pill tone="violet" size="sm">You are here</Pill>}
                    {next && <Pill tone="gold" size="sm">Next up</Pill>}
                  </div>
                  <div className="vg-walletKyc-detail" style={{
                    display: 'grid', gap: 24, marginTop: 6,
                    gridTemplateColumns: '1fr 1fr',
                  }}>
                    <div>
                      <SectionLabel>Requires</SectionLabel>
                      <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 8 }}>
                        {t.requires.map(r => (
                          <li key={r} style={{ display: 'flex', gap: 8, fontSize: 13, color: WALLET_TOKENS.textSecondary }}>
                            <Icon name="check" size={14} className="text-zinc-500 mt-0.5" />
                            {r}
                          </li>
                        ))}
                      </ul>
                    </div>
                    <div>
                      <SectionLabel>Unlocks</SectionLabel>
                      <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 8 }}>
                        {t.unlocks.map(u => (
                          <li key={u} style={{ display: 'flex', gap: 8, fontSize: 13, color: WALLET_TOKENS.text }}>
                            <Icon name="auto_awesome" size={14} className="text-violet-300 mt-0.5" />
                            {u}
                          </li>
                        ))}
                        {t.dailyEUR > 0 && (
                          <li className="font-dmmono" style={{ fontSize: 12, color: WALLET_TOKENS.textSecondary, marginTop: 4 }}>
                            {fmtEUR(t.dailyEUR)} / day · {fmtEUR(t.monthlyEUR)} / month
                          </li>
                        )}
                      </ul>
                    </div>
                  </div>
                </div>
                <div>
                  {next && (
                    <WalletButton variant="primary" onClick={startVerification} iconRight="arrow_forward">
                      Start verification
                    </WalletButton>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div style={{ marginTop: 22 }}>
        <Callout tone="info" icon="info" title="Why we ask">
          EU regulators require us to verify identity for withdrawals. Your documents go straight to Didit. We see only the result.
        </Callout>
      </div>

      <style>{`
        @media (max-width: 760px) {
          .vg-walletKyc-row    { grid-template-columns: 1fr !important; }
          .vg-walletKyc-detail { grid-template-columns: 1fr !important; }
        }
      `}</style>
    </div>
  );
}
