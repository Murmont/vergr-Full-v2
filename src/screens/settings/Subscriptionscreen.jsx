// Redesigned Subscription page — current plan hero, billing history, change plan modal.
// Pulls plans from src/utils/tierSystem.js (source of truth, NOT the design's hardcoded list).
// Honors the hard rule: a flat 10% platform fee applies to all tips, regardless of plan.
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useUser } from '../../context/UserContext';
import { useUI } from '../../context/UIContext';
import { useLayout } from '../../context/LayoutContext';
import TopBar from '../../components/TopBar';
import useResponsive from '../../hooks/useResponsive';
import { TIERS } from '../../utils/tierSystem';
import { C, PageShell } from './_settingsUI';

export default function SubscriptionScreen() {
  const { profile } = useUser();
  const { showToast } = useUI();
  const { isMobile } = useResponsive();
  const navigate = useNavigate();
  const { setRightPanel, setContentAlign } = useLayout();
  const [showChangePlan, setShowChangePlan] = useState(false);

  useEffect(() => {
    setRightPanel(null);
    setContentAlign('left');
    return () => { setRightPanel(null); setContentAlign('center'); };
  }, [setRightPanel, setContentAlign]);

  const currentTierId = (profile?.subscription?.tier || 'free').toLowerCase();
  const current = TIERS[currentTierId] || TIERS.free;
  const renewsAt = profile?.subscription?.renewsAt
    ? new Date(profile.subscription.renewsAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
    : '—';

  const billing = profile?.billingHistory || [];

  return (
    <div style={{ background: C.bg, minHeight: '100%' }}>
      {isMobile && <TopBar title="Subscription" showBack />}
      <PageShell>
        {/* Hero */}
        <div style={{
          background: 'linear-gradient(135deg,#12121e 60%,rgba(124,58,237,0.06))',
          border: `1px solid ${C.border}`, borderRadius: 12, padding: 24,
          display: 'flex', alignItems: 'flex-start', gap: 16,
          flexDirection: isMobile ? 'column' : 'row',
        }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 24, flex: 1, flexDirection: isMobile ? 'column' : 'row' }}>
            <div>
              <span style={{
                background: C.purple, color: '#fff', fontSize: 10, fontWeight: 700,
                padding: '2px 8px', borderRadius: 4, letterSpacing: '0.06em',
              }}>CURRENT PLAN</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 6 }}>
                <span style={{ fontSize: 28, fontWeight: 800, color: C.text }}>{current.name}</span>
                <div style={{
                  width: 26, height: 26, borderRadius: 6,
                  background: 'linear-gradient(135deg,#3d1f7a,#7c3aed)',
                  border: '1px solid #4a2a8a',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  <VLogo size={14}/>
                </div>
              </div>
              <div style={{ fontSize: 12, color: C.textVeryDim, marginTop: 4 }}>You're on the {current.name} plan</div>
              <div style={{ fontSize: 12, color: C.textVeryDim, marginTop: 2 }}>
                {currentTierId === 'free' ? 'No billing — upgrade to unlock perks' : `Next billing date: ${renewsAt}`}
              </div>
              <button
                type="button"
                onClick={() => setShowChangePlan(true)}
                style={{
                  marginTop: 14, background: C.borderSoft, border: `1px solid ${C.borderHard}`,
                  borderRadius: 8, color: C.text, fontSize: 13, padding: '7px 16px', cursor: 'pointer',
                }}
              >Change plan</button>
            </div>

            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 12, color: C.textDim, marginBottom: 12 }}>Your monthly bonuses</div>
              <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
                {current.features.slice(0, 5).map(f => (
                  <div key={f} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <CheckCircle/>
                    <div style={{ fontSize: 13, fontWeight: 600, color: C.text, maxWidth: 220 }}>{f}</div>
                  </div>
                ))}
              </div>
              <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: C.green }}>
                <Dot color={C.green}/>
                {currentTierId === 'pro' ? "You're getting the most out of VERGR." : 'Upgrade for more perks.'}
              </div>
              <div style={{ marginTop: 8, fontSize: 11, color: C.textVeryDim }}>
                A flat 10% platform fee applies to all tips, regardless of plan.
              </div>
            </div>
          </div>

          {!isMobile && (
            <div style={{ position: 'relative', width: 96, height: 110, flexShrink: 0 }}>
              <svg width="96" height="110" viewBox="0 0 96 110">
                <polygon points="48,4 92,27 92,82 48,106 4,82 4,27" fill="rgba(124,58,237,0.15)" stroke={C.purple} strokeWidth="2"/>
                <polygon points="48,14 82,32 82,77 48,96 14,77 14,32" fill="rgba(124,58,237,0.1)" stroke="rgba(124,58,237,0.4)" strokeWidth="1"/>
              </svg>
              <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%,-50%)' }}>
                <VLogo size={38}/>
              </div>
            </div>
          )}
        </div>

        {/* Billing + payment */}
        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 320px', gap: 12, marginTop: 12 }}>
          <Card>
            <div style={{ fontSize: 16, fontWeight: 700, color: C.text, marginBottom: 4 }}>Billing history</div>
            <div style={{ fontSize: 12, color: C.textVeryDim, marginBottom: 14 }}>View your recent payments and invoices.</div>
            {billing.length === 0 ? (
              <div style={{
                padding: '24px 12px', textAlign: 'center', color: C.textVeryDim,
                fontSize: 12, border: `1px dashed ${C.border}`, borderRadius: 8,
              }}>
                No billing history yet.
              </div>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    {['DATE','DESCRIPTION','AMOUNT','STATUS'].map(h => (
                      <th key={h} style={thStyle}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {billing.slice(0, 5).map((row, i) => (
                    <tr key={i} style={{ borderBottom: `1px solid ${C.borderSoft}` }}>
                      <td style={tdStyle}>{row.date}</td>
                      <td style={tdStyle}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span className="material-symbols-outlined" style={{ fontSize: 14, color: C.textVeryDim }}>receipt_long</span>
                          <div>
                            <div>{row.desc}</div>
                            {row.range && <div style={{ fontSize: 10, color: C.textVeryDim }}>{row.range}</div>}
                          </div>
                        </div>
                      </td>
                      <td style={tdStyle}>{row.amount}</td>
                      <td style={{ padding: '12px 4px' }}>
                        <span style={{
                          background: 'rgba(34,197,94,0.1)', color: C.green,
                          border: '1px solid rgba(34,197,94,0.2)', borderRadius: 6,
                          padding: '2px 8px', fontSize: 11,
                        }}>{row.status}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <Card>
              <div style={{ fontSize: 13, fontWeight: 700, color: C.text, marginBottom: 12 }}>Payment method</div>
              <div style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '10px 0', borderBottom: `1px solid ${C.borderSoft}`,
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  {profile?.paymentMethod?.brand ? (
                    <>
                      <div style={{ background: '#1a3a6a', borderRadius: 4, padding: '3px 6px', fontSize: 10, fontWeight: 800, color: '#4a9eff' }}>
                        {profile.paymentMethod.brand.toUpperCase()}
                      </div>
                      <span style={{ fontSize: 13, color: C.textSoft }}>•••• {profile.paymentMethod.last4}</span>
                    </>
                  ) : (
                    <span style={{ fontSize: 13, color: C.textVeryDim }}>No payment method on file</span>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => showToast('Payment method update — coming soon', 'info')}
                  style={updateBtnStyle}
                >
                  {profile?.paymentMethod ? 'Update' : 'Add'} <ChevSm/>
                </button>
              </div>
            </Card>

            <Card>
              <div style={{ fontSize: 13, fontWeight: 700, color: C.text, marginBottom: 12 }}>Billing details</div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 0' }}>
                <div>
                  <div style={{ fontSize: 13, color: C.textSoft }}>Monthly billing</div>
                  <div style={{ fontSize: 11, color: C.textVeryDim, marginTop: 2 }}>
                    {currentTierId === 'free' ? 'No active subscription' : `Renews automatically on ${renewsAt}`}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setShowChangePlan(true)}
                  style={updateBtnStyle}
                >Manage <ChevSm/></button>
              </div>
            </Card>
          </div>
        </div>

        {showChangePlan && (
          <ChangePlanModal
            currentId={currentTierId}
            onClose={() => setShowChangePlan(false)}
          />
        )}
      </PageShell>
    </div>
  );
}

function ChangePlanModal({ currentId, onClose }) {
  const tiers = ['free', 'lite', 'pro'];
  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 1000,
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: C.card, border: `1px solid ${C.border}`, borderRadius: 16,
          padding: 24, width: 720, maxWidth: '95vw', maxHeight: '90vh', overflowY: 'auto',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
          <div>
            <div style={{ fontSize: 18, fontWeight: 700, color: C.text }}>Change plan</div>
            <div style={{ fontSize: 12, color: C.textVeryDim, marginTop: 2 }}>Choose the plan that's right for you.</div>
          </div>
          <button onClick={onClose} style={{ background: 'transparent', border: 'none', color: C.textDim, cursor: 'pointer', fontSize: 24, lineHeight: 1 }}>×</button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12, marginTop: 16 }}>
          {tiers.map(id => {
            const tier = TIERS[id];
            const isCurrent = id === currentId;
            const isRecommended = id === 'pro';
            return (
              <div key={id} style={{
                background: isCurrent ? 'linear-gradient(135deg,rgba(124,58,237,0.12),rgba(109,40,217,0.06))' : C.card,
                border: isCurrent ? '1px solid rgba(124,58,237,0.4)' : `1px solid ${C.border}`,
                borderRadius: 12, padding: 16, position: 'relative',
                display: 'flex', flexDirection: 'column',
              }}>
                {isRecommended && !isCurrent && (
                  <div style={{
                    position: 'absolute', top: -1, left: '50%', transform: 'translateX(-50%)',
                    background: C.purple, color: '#fff', fontSize: 9, fontWeight: 700,
                    letterSpacing: '0.08em', padding: '2px 10px', borderRadius: '0 0 6px 6px',
                    textTransform: 'uppercase',
                  }}>RECOMMENDED</div>
                )}
                <div style={{ paddingTop: isRecommended ? 8 : 0, display: 'flex', flexDirection: 'column', flex: 1 }}>
                  <div style={{ fontSize: 16, fontWeight: 700, color: C.text }}>{tier.name}</div>
                  <div style={{
                    fontSize: 22, fontWeight: 800,
                    color: isCurrent ? C.purpleLight : C.text, marginTop: 4,
                  }}>
                    {tier.price === 0 ? '$0' : `$${tier.price}`}
                    <span style={{ fontSize: 13, fontWeight: 400, color: C.textDim }}>/month</span>
                  </div>
                  <div style={{ fontSize: 11, color: C.textVeryDim, marginTop: 4, marginBottom: 12 }}>{tier.tagline}</div>
                  <div style={{ flex: 1 }}>
                    {tier.features.map(f => (
                      <div key={f} style={{ display: 'flex', alignItems: 'flex-start', gap: 6, marginBottom: 6 }}>
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" style={{ marginTop: 2, flexShrink: 0 }}>
                          <path d="M20 6L9 17l-5-5" stroke={C.purple} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                        <span style={{ fontSize: 11, color: C.textMuted }}>{f}</span>
                      </div>
                    ))}
                  </div>
                  <button
                    type="button"
                    disabled={isCurrent}
                    style={{
                      marginTop: 14, width: '100%', borderRadius: 8, padding: '9px',
                      fontSize: 13, fontWeight: 600,
                      cursor: isCurrent ? 'default' : 'pointer',
                      background: isCurrent
                        ? `linear-gradient(135deg,${C.purple},${C.purpleDeep})`
                        : id === 'free' ? 'transparent' : `linear-gradient(135deg,${C.purple},${C.purpleDeep})`,
                      color: '#fff',
                      border: id === 'free' && !isCurrent ? `1px solid ${C.borderHard}` : 'none',
                      opacity: isCurrent ? 0.85 : 1,
                    }}
                  >
                    {isCurrent ? 'Current plan' : `Choose ${tier.name}`}
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        <div style={{
          textAlign: 'center', marginTop: 14, fontSize: 11, color: C.textVeryDim,
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
        }}>
          <span className="material-symbols-outlined" style={{ fontSize: 12 }}>shield</span>
          All plans include access to VERGR core features. A flat 10% platform fee applies to tips.
        </div>
      </div>
    </div>
  );
}

function Card({ children }) {
  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 18 }}>
      {children}
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

function CheckCircle() {
  return (
    <div style={{
      width: 16, height: 16, borderRadius: '50%',
      border: `1.5px solid ${C.purple}`,
      display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
    }}>
      <svg width="8" height="8" viewBox="0 0 10 10" fill="none">
        <path d="M2 5l2 2 4-4" stroke={C.purple} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    </div>
  );
}

function Dot({ color }) {
  return <div style={{ width: 8, height: 8, borderRadius: '50%', background: color }}/>;
}

function ChevSm() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M9 18l6-6-6-6"/>
    </svg>
  );
}

const thStyle = {
  textAlign: 'left', fontSize: 10, fontWeight: 700, letterSpacing: '0.06em',
  color: C.textVeryDim, padding: '6px 4px', borderBottom: `1px solid ${C.border}`,
  textTransform: 'uppercase',
};
const tdStyle = { fontSize: 12, color: C.textSoft, padding: '12px 4px' };
const updateBtnStyle = {
  background: 'transparent', border: 'none', color: C.purple,
  fontSize: 12, fontWeight: 600, cursor: 'pointer',
  display: 'flex', alignItems: 'center', gap: 4,
};
