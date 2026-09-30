// Settings (v2) — ports the design's SettingsScreen. 3-col desktop → 1-col
// mobile (per spec fix #15). Danger zone at the bottom on mobile.

import { useNavigate } from 'react-router-dom';
import { useUser } from '../../../context/UserContext';
import {
  WalletCard, WalletButton, Pill, SectionLabel, LimitProgressBar,
  WALLET_TOKENS,
} from '../../../components/wallet/primitives';
import Icon from '../../../components/Icon';
import UserName from '../../../components/UserName';
import { auth } from '../../../firebase/config';

export default function SettingsScreen() {
  const navigate = useNavigate();
  const { profile } = useUser();

  return (
    <div style={{ maxWidth: 1200, margin: '0 auto' }}>
      <div style={{ marginBottom: 24 }}>
        <div style={{ fontSize: 11, letterSpacing: '0.12em', textTransform: 'uppercase', color: WALLET_TOKENS.violetLight, fontWeight: 600, marginBottom: 8 }}>Settings</div>
        <h1 style={{ fontFamily: 'Syne, sans-serif', fontWeight: 700, fontSize: 30, letterSpacing: '-0.02em' }}>Wallet settings.</h1>
      </div>

      <div className="vg-walletSettings-grid" style={{
        display: 'grid', gap: 20,
        gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
      }}>
        {/* Column 1: Account */}
        <Column title="Account">
          <Card title="Account info">
            <Row label="Username"><UserName user={profile} masked handle fallback={'—'} /></Row>
            <Row label="Email">{auth.currentUser?.email ? maskEmail(auth.currentUser.email) : '—'}</Row>
            <Row label="Member since">{profile?.createdAt
              ? new Date(profile.createdAt.seconds ? profile.createdAt.seconds * 1000 : profile.createdAt).toLocaleDateString()
              : '—'}</Row>
          </Card>
        </Column>

        {/* Column 2: Security */}
        <Column title="Security">
          <LinkCard icon="lock" title="Change PIN" sub="Last changed never"
                    onClick={() => navigate('/wallet/security/pin')} />
          <LinkCard icon="shield" title="Two-factor auth" sub="Manage 2FA + recovery codes"
                    onClick={() => navigate('/wallet/security/totp')} />
        </Column>

        {/* Column 3: Limits + Verification + Danger */}
        <Column title="Limits & verification">
          <Card title="KYC tier">
            <div style={{ color: WALLET_TOKENS.textSecondary, fontSize: 13, marginBottom: 14 }}>
              Raise your daily/monthly limits by completing higher-tier verification.
            </div>
            <WalletButton variant="primary" size="sm" iconRight="arrow_forward"
                          onClick={() => navigate('/wallet/kyc')}>
              Manage KYC
            </WalletButton>
          </Card>
          <Card title="Withdrawal limits">
            <LimitProgressBar used={0} max={500}  label="Daily" money />
            <div style={{ marginTop: 12 }}>
              <LimitProgressBar used={0} max={2500} label="Monthly" money />
            </div>
          </Card>
          <Card title="Danger zone" danger>
            <DangerBtn label="Freeze wallet" />
            <DangerBtn label="Contact support" />
          </Card>
        </Column>
      </div>

      <style>{`
        @media (max-width: 1000px) {
          .vg-walletSettings-grid { grid-template-columns: 1fr !important; }
        }
      `}</style>
    </div>
  );
}

function Column({ title, children }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <SectionLabel>{title}</SectionLabel>
      {children}
    </div>
  );
}

function Card({ title, danger, children }) {
  return (
    <div style={{
      padding: 18, borderRadius: 14,
      background: WALLET_TOKENS.surface1,
      border: `1px solid ${danger ? 'rgba(240,64,96,0.30)' : WALLET_TOKENS.hairline}`,
    }}>
      <div style={{
        fontWeight: 600, fontSize: 14, marginBottom: 12,
        color: danger ? '#FCA5A5' : WALLET_TOKENS.text,
      }}>{title}</div>
      {children}
    </div>
  );
}

function Row({ label, children }) {
  return (
    <div style={{
      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      padding: '8px 0', borderBottom: `1px solid ${WALLET_TOKENS.hairline}`,
      fontSize: 13,
    }}>
      <span style={{ color: WALLET_TOKENS.textSecondary }}>{label}</span>
      <span>{children}</span>
    </div>
  );
}

function LinkCard({ icon, title, sub, onClick }) {
  return (
    <button onClick={onClick} style={{
      width: '100%', padding: 14, borderRadius: 12,
      background: WALLET_TOKENS.surface1,
      border: `1px solid ${WALLET_TOKENS.hairline}`,
      color: WALLET_TOKENS.text, cursor: 'pointer', textAlign: 'left',
      display: 'flex', alignItems: 'center', gap: 14,
      transition: 'all 0.15s',
    }}
    onMouseEnter={(e) => e.currentTarget.style.borderColor = WALLET_TOKENS.hairlineStrong}
    onMouseLeave={(e) => e.currentTarget.style.borderColor = WALLET_TOKENS.hairline}>
      <div style={{
        width: 36, height: 36, borderRadius: 10,
        background: WALLET_TOKENS.surface2, display: 'grid', placeItems: 'center',
        color: WALLET_TOKENS.textSecondary, flexShrink: 0,
      }}>
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

function DangerBtn({ label }) {
  return (
    <button style={{
      display: 'block', width: '100%', textAlign: 'left',
      padding: '8px 10px', borderRadius: 8,
      background: 'transparent', border: 'none',
      color: '#FCA5A5', cursor: 'pointer', fontSize: 13,
    }}
    onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(240,64,96,0.10)'}
    onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}>
      {label}
    </button>
  );
}

function maskEmail(email) {
  const [user, domain] = email.split('@');
  if (!domain) return email;
  return `${user.slice(0, 2)}••••@${domain}`;
}
