// Founder-only security cockpit. Lives at /admin/security.
//
// Three sections:
//   1. TOTP enrollment: generates the secret, shows QR + manual code,
//      confirms with a 6-digit verify.
//   2. Step-up verifier: used to manually mark the session as "fresh"
//      before performing a destructive admin action elsewhere.
//   3. Recent admin actions: most recent 50 rows from the admin_actions
//      audit log, with actor/IP/target visible.
//
// Style language matches SuperAdminDashboardScreen (#09090f bg + #7c3aed
// accent), not the brand-violet Tailwind palette used by the social pages.

import { useEffect, useState, useCallback } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { useUI } from '../../context/UIContext';
import Icon from '../../components/Icon';
import AdminShell, { ADMIN_COLORS } from './AdminShell';
import {
  enrollAdminTotp,
  confirmAdminTotpEnrollment,
  verifyAdminTotp,
  disableAdminTotp,
  getMyAdminSecurityStatus,
  getRecentAdminActions,
} from '../../firebase/firestore';

const C = {
  ...ADMIN_COLORS,
  purple: ADMIN_COLORS.accent,
  gold: '#f5c542', green: '#22c55e', red: '#ef4444',
};

const fmtTime = (ms) => {
  if (!ms) return '—';
  const d = new Date(ms);
  return d.toLocaleString();
};

// ⚠ THIS PAGE CRASHED ON A ROW IT COULD NOT RENDER. Every admin callable
// writes admin_actions.actor as a uid STRING, but adminMintWalletUnlockToken
// wrote an OBJECT, and `a.actor?.slice(0, 8)` on an object throws, which took
// the whole screen to the ErrorBoundary — including the TOTP enrollment panel,
// which is why admin 2FA was never set up. The writer is fixed; this stays
// because the rows already written still carry the old shape.
const actorLabel = (actor) => {
  if (!actor) return '—';
  if (typeof actor === 'string') return actor.slice(0, 8);
  const uid = actor.uid || actor.id;
  return typeof uid === 'string' ? uid.slice(0, 8) : '—';
};

const fmtAgeSec = (ms) => {
  if (!ms) return null;
  const sec = Math.floor((Date.now() - ms) / 1000);
  if (sec < 60) return `${sec}s ago`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`;
  return `${Math.floor(sec / 86400)}d ago`;
};

export default function AdminSecurityScreen() {
  const { showToast } = useUI();

  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [enrollData, setEnrollData] = useState(null); // { otpauthUrl, secret }
  const [enrollCode, setEnrollCode] = useState('');
  const [enrollBusy, setEnrollBusy] = useState(false);
  const [stepUpCode, setStepUpCode] = useState('');
  const [stepUpBusy, setStepUpBusy] = useState(false);
  const [disableBusy, setDisableBusy] = useState(false);
  const [actions, setActions] = useState([]);
  const [actionsLoading, setActionsLoading] = useState(true);

  const refreshStatus = useCallback(async () => {
    setLoading(true);
    try { setStatus(await getMyAdminSecurityStatus()); }
    catch (err) { showToast(err?.message || 'Failed to load status', 'error'); }
    setLoading(false);
  }, [showToast]);

  const refreshActions = useCallback(async () => {
    setActionsLoading(true);
    try { setActions(await getRecentAdminActions(50)); }
    catch (err) { console.error(err); }
    setActionsLoading(false);
  }, []);

  useEffect(() => {
    refreshStatus();
    refreshActions();
  }, [refreshStatus, refreshActions]);

  // -------- Enroll flow --------
  const startEnroll = async () => {
    setEnrollBusy(true);
    try { setEnrollData(await enrollAdminTotp()); }
    catch (err) { showToast(err?.message || 'Enrollment failed', 'error'); }
    setEnrollBusy(false);
  };

  const confirmEnroll = async () => {
    if (!enrollCode.trim() || enrollCode.trim().length < 6) {
      showToast('Enter the 6-digit code from your authenticator app', 'error');
      return;
    }
    setEnrollBusy(true);
    try {
      await confirmAdminTotpEnrollment(enrollCode.trim());
      showToast('TOTP enrolled. You can now use step-up.', 'success');
      setEnrollData(null);
      setEnrollCode('');
      await refreshStatus();
      await refreshActions();
    } catch (err) {
      showToast(err?.message || 'Invalid code', 'error');
    }
    setEnrollBusy(false);
  };

  // -------- Step-up --------
  const doStepUp = async () => {
    if (!stepUpCode.trim() || stepUpCode.trim().length < 6) {
      showToast('Enter the 6-digit TOTP code', 'error');
      return;
    }
    setStepUpBusy(true);
    try {
      await verifyAdminTotp(stepUpCode.trim());
      showToast('Step-up verified, fresh for 5 minutes.', 'success');
      setStepUpCode('');
      await refreshStatus();
    } catch (err) {
      showToast(err?.message || 'Verification failed', 'error');
    }
    setStepUpBusy(false);
  };

  // -------- Disable (requires step-up first) --------
  const doDisable = async () => {
    if (!window.confirm('Disable TOTP? You will be able to fire destructive admin actions without a fresh code until you re-enroll.')) return;
    setDisableBusy(true);
    try {
      await disableAdminTotp();
      showToast('TOTP disabled.', 'success');
      await refreshStatus();
      await refreshActions();
    } catch (err) {
      showToast(err?.message || 'Disable failed (you may need to step-up first)', 'error');
    }
    setDisableBusy(false);
  };

  const lastStepUpAge = status?.lastStepUpAt ? fmtAgeSec(status.lastStepUpAt) : null;
  const stepUpStaleSec = status?.lastStepUpAt ? (Date.now() - status.lastStepUpAt) / 1000 : null;
  const stepUpFresh = stepUpStaleSec != null && stepUpStaleSec <= 300;

  return (
    <AdminShell
      screen="security"
      title="Admin Security"
      subtitle="TOTP enrollment, step-up verification, and the recent admin-action audit feed."
    >
      <div style={{ maxWidth: 920, display: 'grid', gap: 20 }}>

        {/* Status overview */}
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
            <Icon name="shield_person" size={28} color={status?.enrolled ? C.green : C.gold} />
            <div>
              <div style={{ fontSize: 18, fontWeight: 700 }}>TOTP step-up</div>
              <div style={{ fontSize: 13, color: C.textDim }}>
                {loading ? 'Loading…' :
                  status?.enrolled ? 'Enrolled. Required before destructive actions.' :
                  'Not enrolled. Privileged callables will execute without a step-up gate.'}
              </div>
            </div>
          </div>

          {status?.enrolled && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 12 }}>
              <div>
                <div style={{ fontSize: 11, color: C.textDim, textTransform: 'uppercase', letterSpacing: 0.5 }}>Enrolled at</div>
                <div style={{ fontSize: 14 }}>{fmtTime(status.enrolledAt)}</div>
              </div>
              <div>
                <div style={{ fontSize: 11, color: C.textDim, textTransform: 'uppercase', letterSpacing: 0.5 }}>Last step-up</div>
                <div style={{ fontSize: 14, color: stepUpFresh ? C.green : C.gold }}>
                  {lastStepUpAge || 'Never'}
                  {stepUpFresh ? ' · FRESH' : stepUpStaleSec != null ? ' · STALE' : ''}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Enrollment */}
        {!status?.enrolled && !enrollData && (
          <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 20 }}>
            <h3 style={{ margin: '0 0 8px 0', fontSize: 16, fontWeight: 700 }}>Enroll TOTP</h3>
            <p style={{ color: C.textDim, fontSize: 13, lineHeight: 1.6, margin: '0 0 16px 0' }}>
              Use any authenticator app (Google Authenticator, Authy, 1Password, Bitwarden).
              After enrolling, destructive admin actions will require a fresh 6-digit code
              every 5 minutes. The TOTP secret is stored server-side only, print + safe it.
            </p>
            <button onClick={startEnroll} disabled={enrollBusy}
              style={{ background: C.purple, color: '#fff', border: 'none', borderRadius: 8, padding: '10px 18px', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>
              {enrollBusy ? 'Starting…' : 'Start enrollment'}
            </button>
          </div>
        )}

        {/* Enrollment, show QR + confirm */}
        {!status?.enrolled && enrollData && (
          <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 20 }}>
            <h3 style={{ margin: '0 0 16px 0', fontSize: 16, fontWeight: 700 }}>Scan in your authenticator app</h3>
            <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: 20, alignItems: 'start' }}>
              <div style={{ background: '#fff', padding: 12, borderRadius: 8 }}>
                <QRCodeSVG value={enrollData.otpauthUrl} size={180} level="M" />
              </div>
              <div>
                <div style={{ fontSize: 11, color: C.textDim, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>Manual entry</div>
                <code style={{ display: 'block', background: '#0a0a14', padding: 10, borderRadius: 6, fontSize: 12, wordBreak: 'break-all', color: C.gold, marginBottom: 12 }}>
                  {enrollData.secret}
                </code>
                <div style={{ fontSize: 11, color: C.textDim, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>otpauth URL</div>
                <code style={{ display: 'block', background: '#0a0a14', padding: 10, borderRadius: 6, fontSize: 11, wordBreak: 'break-all', color: C.textDim }}>
                  {enrollData.otpauthUrl}
                </code>
              </div>
            </div>
            <div style={{ marginTop: 20, padding: 16, background: '#0a0a14', borderRadius: 8 }}>
              <div style={{ fontSize: 13, marginBottom: 8 }}>Enter the 6-digit code your app shows now:</div>
              <div style={{ display: 'flex', gap: 10 }}>
                <input
                  type="text" inputMode="numeric" maxLength={6} autoComplete="one-time-code"
                  value={enrollCode}
                  onChange={(e) => setEnrollCode(e.target.value.replace(/[^0-9]/g, ''))}
                  placeholder="000000"
                  style={{ flex: 1, background: C.bg, border: `1px solid ${C.border}`, borderRadius: 6, color: C.text, padding: '10px 14px', fontSize: 18, letterSpacing: 4, fontFamily: 'ui-monospace, monospace', textAlign: 'center' }}
                />
                <button onClick={confirmEnroll} disabled={enrollBusy || enrollCode.length < 6}
                  style={{ background: C.green, color: '#000', border: 'none', borderRadius: 6, padding: '0 18px', fontSize: 14, fontWeight: 700, cursor: 'pointer', opacity: enrollBusy || enrollCode.length < 6 ? 0.5 : 1 }}>
                  Confirm
                </button>
              </div>
              <div style={{ marginTop: 10, fontSize: 11, color: C.textDim }}>
                Expires in 10 minutes. Cancel by closing this page.
              </div>
            </div>
          </div>
        )}

        {/* Step-up box */}
        {status?.enrolled && (
          <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 20 }}>
            <h3 style={{ margin: '0 0 8px 0', fontSize: 16, fontWeight: 700 }}>Step-up verify</h3>
            <p style={{ color: C.textDim, fontSize: 13, lineHeight: 1.6, margin: '0 0 14px 0' }}>
              Mark your session as freshly verified before performing a destructive admin
              action elsewhere. The freshness window is 5 minutes.
            </p>
            <div style={{ display: 'flex', gap: 10 }}>
              <input
                type="text" inputMode="numeric" maxLength={6} autoComplete="one-time-code"
                value={stepUpCode}
                onChange={(e) => setStepUpCode(e.target.value.replace(/[^0-9]/g, ''))}
                placeholder="000000"
                style={{ flex: 1, background: C.bg, border: `1px solid ${C.border}`, borderRadius: 6, color: C.text, padding: '10px 14px', fontSize: 18, letterSpacing: 4, fontFamily: 'ui-monospace, monospace', textAlign: 'center' }}
              />
              <button onClick={doStepUp} disabled={stepUpBusy || stepUpCode.length < 6}
                style={{ background: C.purple, color: '#fff', border: 'none', borderRadius: 6, padding: '0 18px', fontSize: 14, fontWeight: 700, cursor: 'pointer', opacity: stepUpBusy || stepUpCode.length < 6 ? 0.5 : 1 }}>
                Verify
              </button>
            </div>

            <div style={{ marginTop: 20, borderTop: `1px solid ${C.border}`, paddingTop: 16 }}>
              <button onClick={doDisable} disabled={disableBusy}
                style={{ background: 'transparent', color: C.red, border: `1px solid ${C.red}`, borderRadius: 6, padding: '8px 14px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
                {disableBusy ? 'Disabling…' : 'Disable TOTP'}
              </button>
              <span style={{ fontSize: 11, color: C.textDim, marginLeft: 12 }}>
                Requires a fresh step-up first.
              </span>
            </div>
          </div>
        )}

        {/* Recent admin actions */}
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
            <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>Recent admin actions ({actions.length})</h3>
            <button onClick={refreshActions} disabled={actionsLoading}
              style={{ background: 'transparent', border: `1px solid ${C.border}`, color: C.textDim, borderRadius: 6, padding: '4px 10px', fontSize: 12, cursor: 'pointer' }}>
              {actionsLoading ? '…' : 'Refresh'}
            </button>
          </div>
          {actionsLoading ? (
            <div style={{ color: C.textDim, fontSize: 13 }}>Loading…</div>
          ) : actions.length === 0 ? (
            <div style={{ color: C.textDim, fontSize: 13 }}>No admin actions logged yet.</div>
          ) : (
            <div style={{ display: 'grid', gap: 6 }}>
              {actions.map(a => {
                const ts = a.createdAt?.toMillis ? a.createdAt.toMillis() : (a.createdAt?.seconds ? a.createdAt.seconds * 1000 : null);
                const failed = a.action?.endsWith('_failed');
                const isSecurity = a.action?.startsWith('totp_');
                const isAlert = a.action === 'totp_brute_force_alert';
                return (
                  <div key={a.id} style={{
                    background: '#0a0a14',
                    borderLeft: `3px solid ${isAlert ? C.red : failed ? C.red : isSecurity ? C.gold : C.purple}`,
                    padding: '10px 14px',
                    borderRadius: 4,
                    fontSize: 12,
                    display: 'grid',
                    gridTemplateColumns: '160px 1fr auto',
                    gap: 12,
                    alignItems: 'center',
                  }}>
                    <code style={{ color: C.text, fontWeight: 600 }}>{a.action}</code>
                    <div style={{ color: C.textDim, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      actor: {actorLabel(a.actor)}
                      {a.target?.id ? ` · target: ${a.target.type}/${String(a.target.id).slice(0, 12)}` : ''}
                      {a.ip ? ` · ${a.ip}` : ''}
                      {a.stepUpEnforced ? (a.stepUpFresh ? ' · 🔒 stepup' : ' · ⚠️ no-stepup') : ''}
                    </div>
                    <div style={{ color: C.textDim, fontSize: 11 }}>{fmtAgeSec(ts) || '—'}</div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

      </div>
    </AdminShell>
  );
}
