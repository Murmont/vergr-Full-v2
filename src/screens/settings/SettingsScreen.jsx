// src/screens/settings/SettingsScreen.jsx
// Redesigned settings hub. Card grid + danger row. Wallet & Payouts is a
// link-only entry to /wallet — its UI is intentionally untouched.
import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useUser } from '../../context/UserContext';
import { useLayout } from '../../context/LayoutContext';
import TopBar from '../../components/TopBar';
import useResponsive from '../../hooks/useResponsive';
import { C, PageShell } from './_settingsUI';
import { APP_VERSION, APP_VERSION_CODE } from '../../utils/appVersion';
import { resolveTier } from '../../utils/tierSystem';

const Chevron = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#3a3a5a" strokeWidth="2" style={{ flexShrink: 0 }}>
    <path d="M9 18l6-6-6-6"/>
  </svg>
);

// Shared settings-card definitions so the web hub and the native hub list the
// exact same entries (no drift). Sub-components below are function declarations,
// so they hoist and are usable from here.
export function getSettingsCards({ navigate, profile, wallet }) {
  const displayName = profile?.username || profile?.displayName || 'You';
  const handle = profile?.username ? `@${profile.username}` : '';
  const email = profile?.email || '';
  const subTier = resolveTier(profile);
  const tierLabel = subTier === 'pro' ? 'PRO' : subTier === 'lite' ? 'LITE' : 'FREE';
  const verifyStatus = profile?.creatorVerification?.status || profile?.verifiedAt ? 'approved' : (profile?.kycSubmittedAt ? 'pending' : null);

  const cards = [
    {
      id: 'account', icon: 'person', color: C.purple, title: 'Account',
      desc: 'Update your profile, handle, email, and profile picture.',
      onClick: () => navigate('/edit-profile'),
      right: (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{
            width: 36, height: 36, borderRadius: '50%',
            background: profile?.avatar ? `url(${profile.avatar}) center/cover` : 'linear-gradient(135deg,#3d1f7a,#7c3aed)',
            border: '2px solid #4a2a8a',
          }}/>
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: C.text }}>{displayName}</div>
            {handle && <div style={{ fontSize: 11, color: C.textVeryDim }}>{handle}</div>}
            {email && <div style={{ fontSize: 11, color: C.textVeryDim }}>{email}</div>}
          </div>
        </div>
      ),
    },
    {
      id: 'privacy', icon: 'lock', color: C.purple, title: 'Privacy',
      desc: 'Control who can message you, tag you, and see your activity.',
      onClick: () => navigate('/settings/privacy'),
      right: <ManageBtn>Manage</ManageBtn>,
    },
    {
      id: 'notifications', icon: 'notifications', color: C.purple, title: 'Notifications',
      desc: 'Choose what you want to be notified about and how.',
      onClick: () => navigate('/settings/notifications'),
      right: (
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <MaterialIconStroke name="phone_iphone" />
          <MaterialIconStroke name="mail_outline" />
          <MaterialIconStroke name="chat_bubble_outline" stroke={C.green} />
        </div>
      ),
    },
    {
      id: 'language', icon: 'translate', color: C.purple, title: 'Language',
      desc: 'Your language for translating posts and chats, and for content suggestions.',
      onClick: () => navigate('/settings/language'),
      right: <ManageBtn>Set</ManageBtn>,
    },
    {
      id: 'security', icon: 'shield', color: C.purple, title: 'Security',
      desc: 'Password, 2FA, active sessions, and trusted devices.',
      onClick: () => navigate('/settings/security'),
      right: (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: C.green, fontSize: 13, fontWeight: 600 }}>
          <Dot color={C.green}/> Secure
        </div>
      ),
    },
    {
      id: 'subscription', icon: 'workspace_premium', color: C.amber, title: 'Subscription',
      desc: 'Manage your plan, billing, and subscription settings.',
      onClick: () => navigate('/settings/subscription'),
      extra: (
        <div style={{
          background: C.cardSoft, borderRadius: 10, padding: 14,
          marginTop: 12, border: `1px solid ${C.border}`,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
            <div style={{
              width: 36, height: 36, background: 'linear-gradient(135deg,#3d1f7a,#7c3aed)',
              borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <VLogo size={18}/>
            </div>
            <div>
              <span style={{
                background: C.purple, color: '#fff', fontSize: 10, fontWeight: 700,
                padding: '2px 6px', borderRadius: 4, marginRight: 6,
              }}>{tierLabel}</span>
              <div style={{ fontSize: 16, fontWeight: 700, color: C.text, display: 'inline' }}>VERGR {tierLabel === 'FREE' ? 'Free' : tierLabel.charAt(0) + tierLabel.slice(1).toLowerCase()}</div>
              <div style={{ fontSize: 11, color: C.textVeryDim, marginTop: 2 }}>
                {subTier === 'free' ? 'Upgrade for monthly perks' : `Renews ${profile?.subscription?.renewsAt ? new Date(profile.subscription.renewsAt).toLocaleDateString() : 'monthly'}`}
              </div>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 12, marginBottom: 10, flexWrap: 'wrap' }}>
            {(subTier === 'pro'
              ? ['Pro badge', '2× VP multiplier', 'Co-streaming', 'Priority support']
              : subTier === 'lite'
              ? ['Lite badge', '1.5× VP multiplier', 'No ads', '720p streaming']
              : ['Free tier', 'Core + tournaments', '480p streaming', 'Community support']
            ).map(b => (
              <div key={b} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: C.textMuted }}>
                <CheckCircle/>{b}
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); navigate('/settings/subscription'); }}
              style={{
                background: `linear-gradient(135deg,${C.purple},${C.purpleDeep})`,
                color: '#fff', border: 'none',
                borderRadius: 8, padding: '7px 14px', fontSize: 12, fontWeight: 600, cursor: 'pointer',
              }}
            >Manage Plan</button>
            {subTier !== 'free' && (
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); navigate('/settings/subscription'); }}
                style={{
                  background: 'transparent', color: C.textMuted, border: `1px solid ${C.borderHard}`,
                  borderRadius: 8, padding: '7px 14px', fontSize: 12, fontWeight: 600, cursor: 'pointer',
                }}
              >Cancel Subscription</button>
            )}
          </div>
        </div>
      ),
    },
    {
      id: 'wallet', icon: 'account_balance_wallet', color: C.green, title: 'Wallet & Payouts',
      desc: 'Manage your balances, payout method, and view payout history.',
      onClick: () => navigate('/wallet'),
      right: (
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 10, color: C.textVeryDim, marginBottom: 4 }}>Balance</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: C.text, fontSize: 13, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
            <span style={{ color: C.amber }}>◆</span>
            {(wallet?.gems ?? 0).toLocaleString()} gems
          </div>
        </div>
      ),
    },
    {
      id: 'connected', icon: 'link', color: C.purple, title: 'Connected Accounts',
      desc: 'Connect your gaming and social accounts to unlock more features.',
      onClick: () => navigate('/settings/linked-accounts'),
      right: (
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          {[['#1b2838','S'],['#c6362f','R'],['#107c10','X'],['#5865f2','D']].map(([c, l], i) => (
            <div key={i} style={{
              width: 24, height: 24, borderRadius: 6, background: c,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 10, color: '#fff', fontWeight: 700,
            }}>{l}</div>
          ))}
          <div style={{
            width: 24, height: 24, borderRadius: 6, background: C.borderHard,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 10, color: C.textDim,
          }}>+1</div>
        </div>
      ),
    },
    {
      id: 'verification', icon: 'verified', color: C.purple, title: 'Creator Verification',
      desc: 'Verify your identity to unlock creator features.',
      onClick: () => navigate('/creator/verify'),
      right: verifyStatus === 'approved' ? (
        <span style={{
          background: 'rgba(34,197,94,0.15)', color: C.green,
          border: '1px solid rgba(34,197,94,0.3)', borderRadius: 6,
          padding: '3px 10px', fontSize: 11, fontWeight: 700,
        }}>APPROVED</span>
      ) : verifyStatus === 'pending' ? (
        <span style={{
          background: 'rgba(245,158,11,0.15)', color: C.amber,
          border: '1px solid rgba(245,158,11,0.3)', borderRadius: 6,
          padding: '3px 10px', fontSize: 11, fontWeight: 700,
        }}>PENDING</span>
      ) : (
        <ManageBtn>Get Verified</ManageBtn>
      ),
    },
    {
      id: 'help', icon: 'help', color: '#3b82f6', title: 'Help & Support',
      desc: 'Browse FAQs or contact our support team.',
      onClick: () => navigate('/settings/help'),
      right: <LinkBtn>Visit Help Center</LinkBtn>,
    },
    {
      id: 'legal', icon: 'description', color: C.textDim, title: 'Legal',
      desc: 'View our Terms of Service, Privacy Policy, and Refund Policy.',
      onClick: () => navigate('/settings/privacy-policy'),
      right: <LinkBtn>View Documents</LinkBtn>,
    },
    {
      id: 'about', icon: 'info', color: C.textDim, title: 'About',
      desc: 'View app version, build details, and attributions.',
      onClick: () => navigate('/settings/about'),
      right: (
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 13, color: C.text, fontWeight: 600 }}>VERGR v{APP_VERSION}</div>
          <div style={{ fontSize: 11, color: C.textVeryDim }}>Build {APP_VERSION_CODE}</div>
        </div>
      ),
    },
    {
      id: 'appearance', icon: 'palette', color: C.purple, title: 'Appearance',
      desc: 'Theme, font size, and reduced motion.',
      onClick: () => navigate('/settings/display'),
      right: <ManageBtn>Customize</ManageBtn>,
    },
    {
      id: 'storage', icon: 'sd_storage', color: '#3b82f6', title: 'Storage & Data',
      desc: 'Manage cached media and clear local storage.',
      onClick: () => navigate('/settings/storage'),
      right: <ManageBtn>Manage</ManageBtn>,
    },
    {
      id: 'backup', icon: 'cloud_sync', color: '#3b82f6', title: 'Backup & Export',
      desc: 'Export your data or restore from a backup.',
      onClick: () => navigate('/settings/backup'),
      right: <ManageBtn>Manage</ManageBtn>,
    },
    {
      id: 'permissions', icon: 'admin_panel_settings', color: C.amber, title: 'App Permissions',
      desc: 'Camera, microphone, notifications, location, and photos.',
      onClick: () => navigate('/settings/permissions'),
      right: <ManageBtn>Review</ManageBtn>,
    },
  ];
  return cards;
}

// One settings card (icon + title + desc + right slot + optional extra block).
export function SettingsCard({ card }) {
  return (
    <div
      key={card.id}
      onClick={card.onClick}
      style={{
        background: C.card, border: `1px solid ${C.border}`,
        borderRadius: 12, padding: 16, cursor: 'pointer',
        transition: 'border-color 0.15s',
      }}
      onMouseEnter={e => e.currentTarget.style.borderColor = '#2a2a3e'}
      onMouseLeave={e => e.currentTarget.style.borderColor = C.border}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
        <div style={{
          width: 38, height: 38, borderRadius: 10,
          background: `${card.color}18`, border: `1px solid ${card.color}30`,
          display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
          color: card.color,
        }}>
          <span className="material-symbols-outlined" style={{ fontSize: 18 }}>{card.icon}</span>
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: C.text, marginBottom: 3 }}>{card.title}</div>
          <div style={{ fontSize: 12, color: C.textVeryDim, lineHeight: 1.4 }}>{card.desc}</div>
        </div>
        {card.right && <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>{card.right}</div>}
        <Chevron/>
      </div>
      {card.extra}
    </div>
  );
}

export default function SettingsScreen() {
  const { logout } = useAuth();
  const { profile, wallet } = useUser();
  const navigate = useNavigate();
  const { isMobile } = useResponsive();
  const { setRightPanel, setContentAlign } = useLayout();

  useEffect(() => {
    setRightPanel(null);
    setContentAlign('left');
    return () => { setRightPanel(null); setContentAlign('center'); };
  }, [setRightPanel, setContentAlign]);

  const handleLogout = async () => {
    await logout();
    navigate('/login', { replace: true });
  };

  const cards = getSettingsCards({ navigate, profile, wallet });
  const heroCard = cards.find(c => c.id === 'subscription');
  const gridCards = cards.filter(c => c.id !== 'subscription');

  return (
    <div style={{ background: C.bg, minHeight: '100%' }}>
      {isMobile && <TopBar title="Settings" showBack />}
      <PageShell>
        {/* Subscription hero (full width — keeps grid below tidy) */}
        {heroCard && <div style={{ marginBottom: 12 }}><SettingsCard card={heroCard} /></div>}

        <div style={{
          display: 'grid',
          gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr',
          gap: 12, marginBottom: 12,
        }}>
          {gridCards.map(c => <SettingsCard key={c.id} card={c} />)}
        </div>

        {/* Danger row */}
        <div style={{
          display: 'grid', gap: 12,
          gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr',
        }}>
          <DangerCard
            icon="logout"
            title="Sign out"
            desc="Sign out of your VERGR account."
            onClick={handleLogout}
          />
          <DangerCard
            icon="delete"
            title="Delete account"
            desc="Permanently delete your account."
            onClick={() => navigate('/settings/delete-account')}
          />
        </div>
      </PageShell>
    </div>
  );
}

function ManageBtn({ children }) {
  return (
    <span style={{
      background: 'transparent', border: `1px solid ${C.borderHard}`, borderRadius: 8,
      color: C.textMuted, fontSize: 12, padding: '5px 12px', whiteSpace: 'nowrap',
    }}>{children}</span>
  );
}

function LinkBtn({ children }) {
  return (
    <span style={{
      background: 'transparent', border: '1px solid #3d1f7a', borderRadius: 8,
      color: C.purple, fontSize: 12, padding: '5px 12px', whiteSpace: 'nowrap',
    }}>{children}</span>
  );
}

function MaterialIconStroke({ name, stroke = C.textVeryDim }) {
  return (
    <span className="material-symbols-outlined" style={{ fontSize: 16, color: stroke }}>
      {name}
    </span>
  );
}

function Dot({ color }) {
  return <div style={{ width: 8, height: 8, borderRadius: '50%', background: color }}/>;
}

function CheckCircle() {
  return (
    <div style={{
      width: 14, height: 14, borderRadius: '50%',
      border: `1.5px solid ${C.purple}`,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      <svg width="8" height="8" viewBox="0 0 10 10" fill="none">
        <path d="M2 5l2 2 4-4" stroke={C.purple} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    </div>
  );
}

function VLogo({ size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <polygon points="12,2 22,20 2,20" fill="#7c3aed"/>
      <text x="12" y="17" textAnchor="middle" fill="white" fontSize="9" fontWeight="bold" fontFamily="sans-serif">V</text>
    </svg>
  );
}

export function DangerCard({ icon, title, desc, onClick }) {
  return (
    <div
      onClick={onClick}
      style={{
        background: C.card, border: '1px solid rgba(239,68,68,0.2)',
        borderRadius: 12, padding: 16,
        display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer',
      }}
    >
      <span className="material-symbols-outlined" style={{ fontSize: 18, color: C.red }}>{icon}</span>
      <div>
        <div style={{ fontSize: 14, fontWeight: 700, color: C.red }}>{title}</div>
        <div style={{ fontSize: 11, color: C.textDim }}>{desc}</div>
      </div>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#3a3a5a" strokeWidth="2" style={{ marginLeft: 'auto' }}>
        <path d="M9 18l6-6-6-6"/>
      </svg>
    </div>
  );
}
