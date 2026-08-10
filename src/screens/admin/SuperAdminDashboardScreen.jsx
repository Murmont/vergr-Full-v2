// Super Admin hub. Card grid linking to admin sub-pages.
// Gated by profile.role === 'admin'.
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { useUser } from '../../context/UserContext';
import { useUI } from '../../context/UIContext';
import { useLayout } from '../../context/LayoutContext';
import useResponsive from '../../hooks/useResponsive';
import TopBar from '../../components/TopBar';
import Icon from '../../components/Icon';

const C = {
  bg: '#09090f', card: '#12121e', border: '#1e1e30',
  text: '#e0e0f0', textDim: '#7070a0', purple: '#7c3aed',
};

const CARDS = [
  { id: 'bots',         icon: 'smart_toy',     color: '#ef4444', title: 'News Bots',          desc: 'Pause posting, run sync, adjust per-run cap, manage individual bots.', path: '/admin/bots',         badge: 'LIVE' },
  { id: 'announce',     icon: 'campaign',      color: '#7c3aed', title: 'Announcements',      desc: 'Send a system notification to all / paid / Pro users.',               path: '/admin/announce',     badge: 'LIVE' },
  { id: 'vanguard',     icon: 'shield',        color: '#B44FFF', title: 'Vanguard Admin',     desc: 'Invite moderators, promote / demote, suspend, view roster + audit log.', path: '/admin/vanguard',    badge: 'LIVE' },
  { id: 'security',     icon: 'shield_person', color: '#22c55e', title: 'Admin Security',     desc: 'TOTP step-up enrollment, session verification, recent admin actions audit feed.', path: '/admin/security',    badge: 'LIVE' },
  { id: 'users',        icon: 'group',         color: '#3b82f6', title: 'Users',              desc: 'Search, ban, mute, role assign, force logout.',                       path: '/admin/users',        badge: 'SOON' },
  { id: 'reports',      icon: 'flag',          color: '#f59e0b', title: 'Moderation Queue',   desc: 'Review reported posts, comments, and users.',                          path: '/admin/reports',      badge: 'SOON' },
  { id: 'economy',      icon: 'paid',          color: '#22c55e', title: 'Economy',            desc: 'Grant coins/VP, refund payouts, view transaction history.',           path: '/admin/economy',      badge: 'SOON' },
  { id: 'subs',         icon: 'workspace_premium', color: '#f5c542', title: 'Subscriptions',  desc: 'Comp a user, override tier, view billing.',                            path: '/admin/subscriptions', badge: 'SOON' },
  { id: 'tournaments',  icon: 'emoji_events',  color: '#c87fff', title: 'Tournaments',        desc: 'Cancel/refund, dispute resolution, participant overrides.',           path: '/admin/tournaments',  badge: 'SOON' },
  { id: 'config',       icon: 'tune',          color: '#a0a0c0', title: 'App Config',         desc: 'Feature flags, maintenance mode, banner messages.',                    path: '/admin/config',       badge: 'SOON' },
  { id: 'stats',        icon: 'monitoring',    color: '#B44FFF', title: 'Live Stats',         desc: 'DAU, signups, revenue, payouts, bot health.',                          path: '/admin/stats',        badge: 'SOON' },
  { id: 'audit',        icon: 'history',       color: '#7070a0', title: 'Audit Log',          desc: 'Every admin action (who did what, when).',                             path: '/admin/audit',        badge: 'SOON' },
];

export default function SuperAdminDashboardScreen() {
  const { profile } = useUser();
  const navigate = useNavigate();
  const { isMobile } = useResponsive();
  const { setRightPanel, setContentAlign } = useLayout();
  const { showToast } = useUI();
  const [corsBusy, setCorsBusy] = useState(false);
  const [corsReport, setCorsReport] = useState(null);
  const [vanguardSquadId, setVanguardSquadId] = useState('wc1atfQOAY2NKFU050Qb');
  const [vsBusy, setVsBusy] = useState(false);

  const applyVanguardSquadConfig = async () => {
    if (!vanguardSquadId.trim()) { showToast('Enter the Vanguard squad ID', 'error'); return; }
    if (!window.confirm(`Set "${vanguardSquadId}" as THE Vanguard squad (unlimited members, special-cased everywhere)?`)) return;
    setVsBusy(true);
    try {
      const fn = httpsCallable(getFunctions(undefined, 'europe-west1'), 'setVanguardSquadConfig');
      const r = await fn({ squadId: vanguardSquadId.trim() });
      showToast(`Vanguard squad set: ${r.data.squadId}`, 'success');
    } catch (err) {
      console.error('setVanguardSquadConfig failed:', err);
      showToast(err?.message || 'Failed', 'error');
    }
    setVsBusy(false);
  };

  const applyR2Cors = async () => {
    setCorsBusy(true);
    setCorsReport(null);
    try {
      const fn = httpsCallable(getFunctions(undefined, 'europe-west1'), 'setR2CorsPolicy');
      const r = await fn();
      console.log('R2 diagnostic report:', r.data);
      setCorsReport(r.data);
      const wrote = r.data?.putCorsSucceeded;
      showToast(wrote ? 'CORS write succeeded — see diagnostic below.' : 'CORS write FAILED — see diagnostic below.', wrote ? 'success' : 'error');
    } catch (err) {
      console.error('setR2CorsPolicy failed:', err);
      setCorsReport({ error: err?.message || String(err), code: err?.code, details: err?.details });
      showToast(err?.message || 'Diagnostic call failed', 'error');
    }
    setCorsBusy(false);
  };

  useEffect(() => {
    setRightPanel(null);
    setContentAlign('left');
    return () => { setRightPanel(null); setContentAlign('center'); };
  }, [setRightPanel, setContentAlign]);

  if (profile && profile.role !== 'admin') {
    return (
      <div style={{ padding: 60, textAlign: 'center', color: C.textDim }}>
        <Icon name="lock" size={48} className="opacity-40 mx-auto" />
        <p className="mt-3">Admin only.</p>
      </div>
    );
  }

  return (
    <div style={{ background: C.bg, minHeight: '100%', color: C.text }}>
      {isMobile && <TopBar title="Super Admin" showBack />}
      <div style={{ padding: 24 }}>
        <div style={{ marginBottom: 20 }}>
          <h1 style={{ fontSize: 22, fontWeight: 800, margin: 0 }}>Super Admin</h1>
          <p style={{ fontSize: 13, color: C.textDim, marginTop: 4 }}>
            Internal control panel. Actions here affect production.
          </p>
        </div>

        {/* One-shot infra fix: write CORS policy onto the R2 media bucket.
            Run this any time uploads start failing with "Failed to fetch"
            (which is browser-speak for CORS-blocked). Idempotent. */}
        <div style={{
          marginBottom: 20, padding: 14, background: C.card, border: `1px solid ${C.border}`,
          borderRadius: 12, display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap',
        }}>
          <div style={{ flex: 1, minWidth: 220 }}>
            <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 2 }}>Apply R2 CORS policy</div>
            <div style={{ fontSize: 11.5, color: C.textDim, lineHeight: 1.45 }}>
              Writes the correct CORS rules to the <code>vergr-media</code> R2 bucket so browser uploads from vergr.app + the web.app mirror work. Idempotent — safe to re-run any time.
            </div>
          </div>
          <button
            onClick={applyR2Cors}
            disabled={corsBusy}
            style={{
              padding: '9px 14px', borderRadius: 8, border: 0,
              background: corsBusy ? '#555' : C.purple, color: '#fff',
              fontSize: 12, fontWeight: 700, cursor: corsBusy ? 'wait' : 'pointer',
              display: 'inline-flex', alignItems: 'center', gap: 6,
            }}
          >
            <Icon name={corsBusy ? 'hourglass_top' : 'cloud_done'} size={16} />
            {corsBusy ? 'Applying…' : 'Apply CORS / Diagnose'}
          </button>
        </div>

        {/* One-shot Vanguard squad bootstrap. Writes app_config/general.vanguardSquadId
            and flips the squad's maxMembers to null (unlimited). Idempotent. */}
        <div style={{
          marginBottom: 20, padding: 14, background: C.card, border: `1px solid ${C.border}`,
          borderRadius: 12, display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap',
        }}>
          <div style={{ flex: 1, minWidth: 220 }}>
            <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 2 }}>Bootstrap Vanguard squad</div>
            <div style={{ fontSize: 11.5, color: C.textDim, lineHeight: 1.45 }}>
              Sets <code>app_config/general.vanguardSquadId</code> and removes the 100-member cap on the chosen squad. Run once after creating the Vanguard squad. Re-running with a different ID changes which squad is the Vanguard squad.
            </div>
          </div>
          <input
            value={vanguardSquadId}
            onChange={(e) => setVanguardSquadId(e.target.value)}
            placeholder="Squad ID"
            style={{ padding: '8px 12px', background: '#0a0a14', color: C.text, border: `1px solid ${C.border}`, borderRadius: 6, fontSize: 12, minWidth: 220 }}
          />
          <button
            onClick={applyVanguardSquadConfig}
            disabled={vsBusy}
            style={{ padding: '9px 14px', borderRadius: 8, border: 0, background: vsBusy ? '#555' : '#B44FFF', color: '#fff', fontSize: 12, fontWeight: 700, cursor: vsBusy ? 'wait' : 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6 }}
          >
            <Icon name={vsBusy ? 'hourglass_top' : 'shield'} size={16} />
            {vsBusy ? 'Setting…' : 'Set Vanguard Squad'}
          </button>
        </div>

        {corsReport && (
          <div style={{
            marginBottom: 20, padding: 14, background: '#0a0a14',
            border: `1px solid ${C.border}`, borderRadius: 12,
          }}>
            <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 8, color: C.text }}>
              R2 Diagnostic Report
            </div>
            <pre style={{
              margin: 0, fontSize: 11, lineHeight: 1.55, color: '#a0c0ff',
              whiteSpace: 'pre-wrap', wordBreak: 'break-all', maxHeight: 480, overflow: 'auto',
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
            }}>
              {JSON.stringify(corsReport, null, 2)}
            </pre>
            <button
              onClick={() => navigator.clipboard?.writeText(JSON.stringify(corsReport, null, 2))}
              style={{
                marginTop: 10, padding: '6px 10px', borderRadius: 6, border: `1px solid ${C.border}`,
                background: 'transparent', color: C.textDim, fontSize: 11, cursor: 'pointer',
              }}
            >Copy report</button>
          </div>
        )}

        <div style={{
          display: 'grid', gap: 12,
          gridTemplateColumns: isMobile ? '1fr' : 'repeat(auto-fill, minmax(280px, 1fr))',
        }}>
          {CARDS.map(card => (
            <button
              key={card.id}
              onClick={() => card.badge === 'LIVE' && navigate(card.path)}
              disabled={card.badge !== 'LIVE'}
              style={{
                background: C.card, border: `1px solid ${C.border}`, borderRadius: 12,
                padding: 16, textAlign: 'left', color: C.text,
                cursor: card.badge === 'LIVE' ? 'pointer' : 'not-allowed',
                opacity: card.badge === 'LIVE' ? 1 : 0.55,
                transition: 'border-color 0.15s',
              }}
              onMouseEnter={e => card.badge === 'LIVE' && (e.currentTarget.style.borderColor = card.color)}
              onMouseLeave={e => (e.currentTarget.style.borderColor = C.border)}
            >
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                <div style={{
                  width: 40, height: 40, borderRadius: 10,
                  background: `${card.color}18`, border: `1px solid ${card.color}30`,
                  color: card.color,
                  display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                }}>
                  <Icon name={card.icon} size={20} />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                    <span style={{ fontSize: 14, fontWeight: 700 }}>{card.title}</span>
                    <span style={{
                      fontSize: 9, fontWeight: 700, letterSpacing: '0.08em',
                      padding: '2px 6px', borderRadius: 4,
                      background: card.badge === 'LIVE' ? 'rgba(34,197,94,0.15)' : 'rgba(255,255,255,0.06)',
                      color: card.badge === 'LIVE' ? '#22c55e' : C.textDim,
                      border: `1px solid ${card.badge === 'LIVE' ? 'rgba(34,197,94,0.30)' : 'rgba(255,255,255,0.08)'}`,
                    }}>{card.badge}</span>
                  </div>
                  <div style={{ fontSize: 12, color: C.textDim, lineHeight: 1.4 }}>{card.desc}</div>
                </div>
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
