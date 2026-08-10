// AdminUsersScreen — /admin/users
//
// Tabs: All / Active / New / Banned. KPI strip on top. Filter rail on right
// (search + role + plan + status). Table with per-row action menu that opens
// the user-detail drawer with every action (ban / unban / mute / role /
// force-logout / password reset).
//
// All actions go through guarded callables in functions/adminUsers.js. Every
// destructive button prompts for a fresh TOTP code if the founder is enrolled.

import { useState, useEffect, useCallback, useRef } from 'react';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { useUI } from '../../context/UIContext';
import Icon from '../../components/Icon';
import UserAvatar from '../../components/UserAvatar';
import AdminShell, { ADMIN_COLORS as C } from './AdminShell';
import { resolveTier } from '../../utils/tierSystem';

const fnRegion = () => getFunctions(undefined, 'europe-west1');
const call = (name, data) => httpsCallable(fnRegion(), name)(data).then(r => r.data);

const fmtDate = (ms) => ms ? new Date(ms).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : '—';
const fmtRelative = (ms) => {
  if (!ms) return '—';
  const diff = Date.now() - ms;
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  if (diff < 30 * 86_400_000) return `${Math.floor(diff / 86_400_000)}d ago`;
  return fmtDate(ms);
};
const fmtNumber = (n) => (n ?? 0).toLocaleString();

// ───────────────────────────────────────────────────────────
// TOTP step-up prompt — used by every destructive action.
// ───────────────────────────────────────────────────────────

function StepUpPrompt({ onSubmit, onCancel, busy }) {
  const [code, setCode] = useState('');
  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200,
    }}>
      <div style={{
        background: C.card, border: `1px solid ${C.border}`, borderRadius: 12,
        padding: 22, width: 360, maxWidth: '90vw',
      }}>
        <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: C.text }}>Verify with TOTP</h3>
        <p style={{ margin: '6px 0 14px', fontSize: 12, color: C.textDim }}>
          Open your authenticator app and enter the 6-digit code to confirm this destructive action.
        </p>
        <input
          autoFocus
          inputMode="numeric"
          maxLength={6}
          value={code}
          onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
          placeholder="123 456"
          style={{
            width: '100%', padding: '12px 14px', fontSize: 18, letterSpacing: '0.3em',
            background: '#0a0a14', border: `1px solid ${C.border}`, borderRadius: 8,
            color: C.text, textAlign: 'center', fontFamily: 'ui-monospace, monospace',
          }}
        />
        <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
          <button onClick={onCancel} disabled={busy} style={{
            flex: 1, padding: '10px 12px', borderRadius: 8,
            background: 'transparent', border: `1px solid ${C.border}`, color: C.textDim,
            fontSize: 12, fontWeight: 600, cursor: 'pointer',
          }}>Cancel</button>
          <button onClick={() => onSubmit(code)} disabled={busy || code.length !== 6} style={{
            flex: 1, padding: '10px 12px', borderRadius: 8,
            background: busy ? '#555' : C.accent, color: '#fff', border: 0,
            fontSize: 12, fontWeight: 700, cursor: busy ? 'wait' : 'pointer',
            opacity: code.length !== 6 ? 0.6 : 1,
          }}>{busy ? 'Verifying…' : 'Verify'}</button>
        </div>
      </div>
    </div>
  );
}

// Wraps any async fn — if it throws STEP_UP_REQUIRED, prompts for TOTP and retries.
function useGuardedCall() {
  const { showToast } = useUI();
  const [stepUp, setStepUp] = useState(null);  // { resolve, reject } or null
  const [busy, setBusy] = useState(false);

  const guarded = useCallback(async (fn) => {
    try {
      return await fn();
    } catch (err) {
      const isStepUp = err?.code === 'functions/failed-precondition' &&
                       (err?.message || '').toLowerCase().includes('step-up');
      if (!isStepUp) {
        showToast(err?.message || 'Action failed', 'error');
        throw err;
      }
      // Prompt for code, verify, then retry the original fn ONCE.
      return new Promise((resolve, reject) => {
        setStepUp({
          submit: async (code) => {
            setBusy(true);
            try {
              await call('verifyAdminTotp', { code });
              setStepUp(null);
              setBusy(false);
              try { resolve(await fn()); } catch (e) { showToast(e?.message || 'Action failed', 'error'); reject(e); }
            } catch (e) {
              setBusy(false);
              showToast(e?.message || 'Verification failed', 'error');
            }
          },
          cancel: () => { setStepUp(null); reject(new Error('cancelled')); },
        });
      });
    }
  }, [showToast]);

  return {
    guarded,
    overlay: stepUp ? (
      <StepUpPrompt onSubmit={stepUp.submit} onCancel={stepUp.cancel} busy={busy} />
    ) : null,
  };
}

// ───────────────────────────────────────────────────────────
// KPI strip
// ───────────────────────────────────────────────────────────

function KpiCard({ icon, color, label, value, sub }) {
  return (
    <div style={{
      padding: 16, background: C.card, border: `1px solid ${C.border}`, borderRadius: 12,
      minWidth: 0,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{
          width: 38, height: 38, borderRadius: 10,
          background: `${color}20`, border: `1px solid ${color}30`,
          color, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
        }}>
          <Icon name={icon} size={20} />
        </div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 11, color: C.textDim, fontWeight: 500 }}>{label}</div>
          <div style={{ fontSize: 22, fontWeight: 800, color: C.text, lineHeight: 1.1, marginTop: 2 }} className="font-dmmono tabular-nums">
            {value}
          </div>
          {sub && <div style={{ fontSize: 11, color: C.textDim, marginTop: 2 }}>{sub}</div>}
        </div>
      </div>
    </div>
  );
}

function StatStrip({ stats, loading }) {
  return (
    <div style={{
      display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12,
      marginBottom: 16,
    }}>
      <KpiCard icon="group"     color="#7c3aed" label="Total Users"  value={loading ? '—' : fmtNumber(stats?.total)} />
      <KpiCard icon="circle"    color="#22c55e" label="Active (7d)"  value={loading ? '—' : fmtNumber(stats?.active)} />
      <KpiCard icon="person_add" color="#3b82f6" label="New (30d)"   value={loading ? '—' : fmtNumber(stats?.new)} />
      <KpiCard icon="block"     color="#f04060" label="Banned"       value={loading ? '—' : fmtNumber(stats?.banned)} />
      <KpiCard icon="workspace_premium" color="#f5c542" label="Pro Users" value={loading ? '—' : fmtNumber(stats?.pro)} />
    </div>
  );
}

// ───────────────────────────────────────────────────────────
// Table row + action menu
// ───────────────────────────────────────────────────────────

function StatusPill({ user }) {
  const now = Date.now();
  let label, color;
  if (user.banned) { label = 'Banned'; color = '#f04060'; }
  else if (user.lastActiveAt && (now - user.lastActiveAt) > 7 * 86_400_000) { label = 'Inactive'; color = '#f5c542'; }
  else { label = 'Active'; color = '#22c55e'; }
  return (
    <span style={{
      padding: '3px 9px', borderRadius: 999,
      background: `${color}25`, color, fontSize: 11, fontWeight: 700,
    }}>{label}</span>
  );
}

function PlanPill({ plan }) {
  const colors = { free: C.textDim, lite: '#3b82f6', pro: '#f5c542' };
  const color = colors[plan] || C.textDim;
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      padding: '3px 8px', borderRadius: 6,
      background: `${color}20`, color, fontSize: 11, fontWeight: 700, textTransform: 'capitalize',
    }}>
      {plan === 'pro' && <Icon name="workspace_premium" size={11} />}
      {plan}
    </span>
  );
}

function UserRow({ user, onOpen }) {
  return (
    <tr
      onClick={() => onOpen(user)}
      style={{ cursor: 'pointer', borderTop: `1px solid ${C.border}` }}
      onMouseEnter={e => e.currentTarget.style.background = C.card2}
      onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
    >
      <td style={{ padding: '12px 14px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <UserAvatar src={user.avatar} size={32} />
          <div style={{ minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontWeight: 600, color: C.text, fontSize: 13 }}>{user.displayName}</span>
              {user.verified && <Icon name="verified" size={13} style={{ color: C.accent }} />}
            </div>
            {user.username && <div style={{ fontSize: 11, color: C.textDim }}>@{user.username}</div>}
          </div>
        </div>
      </td>
      <td style={{ padding: '12px 14px', fontSize: 12, color: C.textDim }}>{user.email || '—'}</td>
      <td style={{ padding: '12px 14px' }}><StatusPill user={user} /></td>
      <td style={{ padding: '12px 14px', fontSize: 12, color: C.text, textTransform: 'capitalize' }}>{user.role}</td>
      <td style={{ padding: '12px 14px' }}><PlanPill plan={resolveTier(user)} /></td>
      <td style={{ padding: '12px 14px', fontSize: 12, color: C.textDim }}>{fmtDate(user.createdAt)}</td>
      <td style={{ padding: '12px 14px', fontSize: 12, color: C.textDim }}>{fmtRelative(user.lastActiveAt)}</td>
    </tr>
  );
}

// ───────────────────────────────────────────────────────────
// Detail drawer
// ───────────────────────────────────────────────────────────

function ReasonPrompt({ title, message, placeholder = 'Reason (required)', onConfirm, onCancel, extraField, danger = true }) {
  const [reason, setReason] = useState('');
  const [extra, setExtra] = useState(extraField?.defaultValue ?? '');
  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)', zIndex: 250,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 22, width: 420, maxWidth: '92vw' }}>
        <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: C.text }}>{title}</h3>
        <p style={{ margin: '6px 0 14px', fontSize: 12, color: C.textDim }}>{message}</p>
        {extraField && (
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: C.textDim, marginBottom: 6 }}>{extraField.label}</div>
            <input
              type={extraField.type || 'text'}
              value={extra}
              onChange={e => setExtra(e.target.value)}
              placeholder={extraField.placeholder}
              style={{ width: '100%', padding: '10px 12px', background: '#0a0a14', border: `1px solid ${C.border}`, borderRadius: 8, color: C.text, fontSize: 13 }}
            />
          </div>
        )}
        <textarea
          rows={3}
          value={reason}
          onChange={e => setReason(e.target.value)}
          placeholder={placeholder}
          style={{ width: '100%', padding: '10px 12px', background: '#0a0a14', border: `1px solid ${C.border}`, borderRadius: 8, color: C.text, fontSize: 13, resize: 'vertical', fontFamily: 'inherit' }}
        />
        <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
          <button onClick={onCancel} style={{ flex: 1, padding: '10px', borderRadius: 8, background: 'transparent', border: `1px solid ${C.border}`, color: C.textDim, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>Cancel</button>
          <button
            onClick={() => onConfirm({ reason, extra })}
            disabled={!reason.trim() || (extraField?.required && !String(extra).trim())}
            style={{ flex: 1, padding: '10px', borderRadius: 8, border: 0, background: danger ? '#f04060' : C.accent, color: '#fff', fontSize: 12, fontWeight: 700, cursor: 'pointer', opacity: !reason.trim() ? 0.5 : 1 }}>
            Confirm
          </button>
        </div>
      </div>
    </div>
  );
}

function ActionRow({ icon, label, color = C.text, danger = false, onClick, disabled = false }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        width: '100%', padding: '10px 12px', borderRadius: 8,
        background: 'transparent', border: `1px solid ${danger ? '#f04060' : C.border}`,
        color: danger ? '#f04060' : color,
        fontSize: 12, fontWeight: 600, cursor: disabled ? 'not-allowed' : 'pointer',
        textAlign: 'left', display: 'flex', alignItems: 'center', gap: 10,
        opacity: disabled ? 0.45 : 1,
      }}
    >
      <Icon name={icon} size={15} />
      {label}
    </button>
  );
}

function UserDrawer({ uid, onClose, onChanged }) {
  const { showToast } = useUI();
  const { guarded, overlay } = useGuardedCall();
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [prompt, setPrompt] = useState(null);  // active reason-prompt config

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const r = await call('adminGetUserDetail', { targetUid: uid });
      setDetail(r);
    } catch (err) {
      showToast(err?.message || 'Failed to load user', 'error');
    }
    setLoading(false);
  }, [uid, showToast]);

  useEffect(() => { reload(); }, [reload]);

  const doBan = (permanent) => setPrompt({
    title: permanent ? 'Permanently ban user?' : 'Temporarily ban user',
    message: permanent
      ? 'This permanently bans the account and revokes all sessions. Reversible only by another unban.'
      : 'Choose duration and reason. Sessions will be revoked.',
    extraField: !permanent ? { label: 'Duration (days)', type: 'number', defaultValue: '7', required: true, placeholder: '7' } : null,
    danger: true,
    onConfirm: async ({ reason, extra }) => {
      setPrompt(null);
      try {
        await guarded(() => call('adminBanUser', {
          targetUid: uid, reason,
          durationDays: permanent ? null : Number(extra),
          permanent,
        }));
        showToast(permanent ? 'User permanently banned' : 'User banned', 'success');
        await reload();
        onChanged?.();
      } catch {}
    },
    onCancel: () => setPrompt(null),
  });

  const doUnban = () => setPrompt({
    title: 'Unban user?',
    message: 'Restores account access and clears all ban flags.',
    danger: false,
    onConfirm: async ({ reason }) => {
      setPrompt(null);
      try {
        await guarded(() => call('adminUnbanUser', { targetUid: uid, reason }));
        showToast('User unbanned', 'success');
        await reload();
        onChanged?.();
      } catch {}
    },
    onCancel: () => setPrompt(null),
  });

  const doMute = () => setPrompt({
    title: 'Mute user',
    message: 'User cannot send chat / post messages until the mute expires.',
    extraField: { label: 'Duration (hours)', type: 'number', defaultValue: '24', required: true, placeholder: '24' },
    danger: false,
    onConfirm: async ({ reason, extra }) => {
      setPrompt(null);
      try {
        await guarded(() => call('adminMuteUser', { targetUid: uid, hours: Number(extra), reason }));
        showToast('User muted', 'success');
        await reload();
        onChanged?.();
      } catch {}
    },
    onCancel: () => setPrompt(null),
  });

  const doUnmute = async () => {
    try {
      await call('adminUnmuteUser', { targetUid: uid });
      showToast('User unmuted', 'success');
      await reload();
      onChanged?.();
    } catch (err) {
      showToast(err?.message || 'Unmute failed', 'error');
    }
  };

  const doRole = (role) => {
    if (!window.confirm(`Set role to "${role}"?`)) return;
    guarded(() => call('adminSetUserRole', { targetUid: uid, role }))
      .then(() => { showToast(`Role updated to ${role}`, 'success'); reload(); onChanged?.(); })
      .catch(() => {});
  };

  const doForceLogout = () => setPrompt({
    title: 'Force logout?',
    message: 'Revokes all refresh tokens. User will have to sign in again on every device.',
    danger: true,
    onConfirm: async ({ reason }) => {
      setPrompt(null);
      try {
        await guarded(() => call('adminForceLogoutUser', { targetUid: uid, reason }));
        showToast('All sessions revoked', 'success');
      } catch {}
    },
    onCancel: () => setPrompt(null),
  });

  const doPasswordReset = async () => {
    if (!window.confirm('Issue a password reset link?')) return;
    try {
      const r = await call('adminSendPasswordReset', { targetUid: uid });
      navigator.clipboard?.writeText(r.link).catch(() => {});
      showToast('Reset link issued (copied to clipboard)', 'success');
    } catch (err) {
      showToast(err?.message || 'Failed to issue reset', 'error');
    }
  };

  const isFounder = detail?.role === 'admin';
  const isMuted = detail?.mutedUntil && detail.mutedUntil > Date.now();

  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 150 }} />
      <aside style={{
        position: 'fixed', top: 0, right: 0, bottom: 0, width: 520, maxWidth: '95vw',
        background: C.bg, borderLeft: `1px solid ${C.border}`,
        zIndex: 151, overflowY: 'auto', padding: 24,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: C.text }}>User detail</h2>
          <button onClick={onClose} style={{ background: 'transparent', border: 0, color: C.textDim, cursor: 'pointer' }}>
            <Icon name="close" size={20} />
          </button>
        </div>

        {loading || !detail ? (
          <div style={{ color: C.textDim, fontSize: 13 }}>Loading…</div>
        ) : (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 16 }}>
              <UserAvatar src={detail.avatar} size={56} />
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontSize: 17, fontWeight: 800, color: C.text }}>{detail.displayName}</span>
                  {detail.verified && <Icon name="verified" size={16} style={{ color: C.accent }} />}
                </div>
                {detail.username && <div style={{ fontSize: 12, color: C.textDim }}>@{detail.username}</div>}
                <div style={{ fontSize: 11, color: C.textMuted, marginTop: 4 }}>{detail.email}</div>
              </div>
            </div>

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 14 }}>
              <StatusPill user={detail} />
              <PlanPill plan={resolveTier(detail)} />
              <span style={{ padding: '3px 8px', borderRadius: 6, background: `${C.accent}25`, color: C.text, fontSize: 11, fontWeight: 600, textTransform: 'capitalize' }}>{detail.role}</span>
              {isMuted && <span style={{ padding: '3px 8px', borderRadius: 6, background: '#f5c54225', color: '#f5c542', fontSize: 11, fontWeight: 600 }}>Muted</span>}
              {detail.kycStatus && <span style={{ padding: '3px 8px', borderRadius: 6, background: '#3b82f625', color: '#3b82f6', fontSize: 11, fontWeight: 600 }}>KYC: {detail.kycStatus}</span>}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginBottom: 16 }}>
              <StatBlock label="Followers" value={fmtNumber(detail.followers)} />
              <StatBlock label="Following" value={fmtNumber(detail.following)} />
              <StatBlock label="Posts"     value={fmtNumber(detail.postsCount)} />
              <StatBlock label="Coins"     value={fmtNumber(detail.wallet?.balance)} />
              <StatBlock label="Gems"      value={fmtNumber(detail.wallet?.gems)} />
              <StatBlock label="VP"        value={fmtNumber(detail.wallet?.vp)} />
            </div>

            <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: 14, marginBottom: 14 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: C.textDim, marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Account</div>
              <KeyVal label="Joined" value={fmtDate(detail.createdAt)} />
              <KeyVal label="Last active" value={fmtRelative(detail.lastActiveAt)} />
              {detail.banned && (
                <>
                  <KeyVal label="Banned" value={detail.permabanned ? 'Permanent' : `Until ${fmtDate(detail.banUntil)}`} />
                  {detail.banReason && <KeyVal label="Reason" value={detail.banReason} />}
                </>
              )}
              {isMuted && <KeyVal label="Muted until" value={fmtRelative(detail.mutedUntil)} />}
            </div>

            {isFounder ? (
              <div style={{ padding: 14, background: '#f5c54215', border: '1px solid #f5c54240', borderRadius: 10, color: '#f5c542', fontSize: 12 }}>
                <Icon name="shield_person" size={14} /> Platform owner — moderation actions are disabled.
              </div>
            ) : (
              <>
                <SectionLabel>Moderation</SectionLabel>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 14 }}>
                  {!detail.banned ? (
                    <>
                      <ActionRow icon="block" label="Temp ban" color="#f04060" onClick={() => doBan(false)} />
                      <ActionRow icon="gpp_bad" label="Permaban" danger onClick={() => doBan(true)} />
                    </>
                  ) : (
                    <ActionRow icon="lock_open" label="Unban" onClick={doUnban} />
                  )}
                  {!isMuted
                    ? <ActionRow icon="volume_off" label="Mute" onClick={doMute} />
                    : <ActionRow icon="volume_up" label="Unmute" onClick={doUnmute} />}
                  <ActionRow icon="logout" label="Force logout" danger onClick={doForceLogout} />
                  <ActionRow icon="key" label="Password reset" onClick={doPasswordReset} />
                </div>

                <SectionLabel>Role</SectionLabel>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 14 }}>
                  {['user', 'moderator', 'admin'].map(r => (
                    <button
                      key={r}
                      onClick={() => doRole(r)}
                      disabled={detail.role === r}
                      style={{
                        padding: '8px 14px', borderRadius: 8,
                        background: detail.role === r ? C.accent : 'transparent',
                        border: `1px solid ${detail.role === r ? C.accent : C.border}`,
                        color: detail.role === r ? '#fff' : C.text,
                        fontSize: 12, fontWeight: 600, cursor: detail.role === r ? 'default' : 'pointer',
                        textTransform: 'capitalize',
                      }}
                    >
                      {r}
                    </button>
                  ))}
                </div>
              </>
            )}
          </>
        )}
      </aside>
      {prompt && <ReasonPrompt {...prompt} />}
      {overlay}
    </>
  );
}

function StatBlock({ label, value }) {
  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, padding: 10, textAlign: 'center' }}>
      <div style={{ fontSize: 10, color: C.textDim, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</div>
      <div style={{ fontSize: 16, fontWeight: 700, color: C.text, marginTop: 2 }} className="font-dmmono tabular-nums">{value}</div>
    </div>
  );
}

function KeyVal({ label, value }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', padding: '4px 0', fontSize: 12 }}>
      <span style={{ color: C.textDim }}>{label}</span>
      <span style={{ color: C.text, fontWeight: 500 }}>{value}</span>
    </div>
  );
}

function SectionLabel({ children }) {
  return (
    <div style={{ fontSize: 11, fontWeight: 700, color: C.textDim, marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
      {children}
    </div>
  );
}

// ───────────────────────────────────────────────────────────
// Main screen
// ───────────────────────────────────────────────────────────

const TABS = [
  { id: 'all',    label: 'All Users' },
  { id: 'active', label: 'Active' },
  { id: 'new',    label: 'New' },
  { id: 'banned', label: 'Banned' },
];

export default function AdminUsersScreen() {
  const { showToast } = useUI();
  const [tab, setTab] = useState('all');
  const [search, setSearch] = useState('');
  const [role, setRole] = useState('');
  const [plan, setPlan] = useState('');
  const [rows, setRows] = useState([]);
  const [cursor, setCursor] = useState(null);
  const [nextCursor, setNextCursor] = useState(null);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState(null);
  const [openUid, setOpenUid] = useState(null);
  const searchDebounceRef = useRef(null);

  const loadStats = useCallback(async () => {
    try { setStats(await call('adminGetUserStats', {})); } catch {}
  }, []);

  const loadPage = useCallback(async (reset = false) => {
    setLoading(true);
    try {
      const r = await call('adminListUsers', {
        tab,
        search,
        role: role || null,
        plan: plan || null,
        cursor: reset ? null : cursor,
        pageSize: 25,
      });
      setRows(prev => reset ? r.rows : [...prev, ...r.rows]);
      setNextCursor(r.nextCursor);
    } catch (err) {
      showToast(err?.message || 'Failed to load users', 'error');
    }
    setLoading(false);
  }, [tab, search, role, plan, cursor, showToast]);

  useEffect(() => { loadStats(); }, [loadStats]);

  // Reset list whenever filters change.
  useEffect(() => {
    setCursor(null);
    setRows([]);
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    searchDebounceRef.current = setTimeout(() => loadPage(true), 250);
    return () => { if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, search, role, plan]);

  const loadMore = async () => {
    if (!nextCursor) return;
    setCursor(nextCursor);
    await loadPage(false);
  };

  const topBarRight = (
    <button
      onClick={() => { loadStats(); loadPage(true); }}
      style={{
        padding: '8px 14px', borderRadius: 8,
        background: 'transparent', border: `1px solid ${C.border}`,
        color: C.textDim, fontSize: 12, fontWeight: 600, cursor: 'pointer',
        display: 'inline-flex', alignItems: 'center', gap: 6,
      }}
    >
      <Icon name="refresh" size={14} /> Refresh
    </button>
  );

  return (
    <AdminShell
      screen="users"
      title="Users"
      subtitle="Manage and monitor all users on the platform."
      topBarRight={topBarRight}
    >
      <StatStrip stats={stats} loading={!stats} />

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 280px', gap: 16 }}>
        <div style={{ minWidth: 0 }}>
          {/* Tabs */}
          <div style={{ display: 'flex', gap: 4, marginBottom: 12, borderBottom: `1px solid ${C.border}` }}>
            {TABS.map(t => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                style={{
                  padding: '10px 16px', background: 'transparent', border: 0,
                  borderBottom: `2px solid ${tab === t.id ? C.accent : 'transparent'}`,
                  color: tab === t.id ? C.text : C.textDim,
                  fontSize: 13, fontWeight: tab === t.id ? 600 : 500,
                  cursor: 'pointer', marginBottom: -1,
                }}
              >
                {t.label}
              </button>
            ))}
          </div>

          {/* Table */}
          <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, overflow: 'hidden' }}>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 720 }}>
                <thead>
                  <tr style={{ background: C.card2 }}>
                    {['User', 'Email', 'Status', 'Role', 'Plan', 'Joined', 'Last Active'].map(h => (
                      <th key={h} style={{ padding: '10px 14px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: C.textDim, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map(u => <UserRow key={u.uid} user={u} onOpen={(x) => setOpenUid(x.uid)} />)}
                  {!loading && rows.length === 0 && (
                    <tr><td colSpan={7} style={{ padding: 40, textAlign: 'center', color: C.textDim, fontSize: 13 }}>
                      No users match these filters.
                    </td></tr>
                  )}
                </tbody>
              </table>
            </div>
            <div style={{ padding: 12, borderTop: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ fontSize: 11, color: C.textDim }}>
                {loading ? 'Loading…' : `${rows.length} loaded${stats?.total ? ` · ${fmtNumber(stats.total)} total` : ''}`}
              </div>
              {nextCursor && (
                <button onClick={loadMore} disabled={loading} style={{
                  padding: '7px 14px', borderRadius: 6,
                  background: 'transparent', border: `1px solid ${C.border}`,
                  color: C.textDim, fontSize: 11, fontWeight: 600, cursor: 'pointer',
                }}>
                  Load more
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Right rail — filters */}
        <aside style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 16, alignSelf: 'flex-start' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
            <h3 style={{ margin: 0, fontSize: 13, fontWeight: 700, color: C.text }}>Filters</h3>
            <button
              onClick={() => { setSearch(''); setRole(''); setPlan(''); }}
              style={{ background: 'transparent', border: 0, color: C.accent, fontSize: 11, fontWeight: 600, cursor: 'pointer' }}>
              Reset
            </button>
          </div>

          <FilterLabel>Search by username</FilterLabel>
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Lowercase prefix"
            style={{ width: '100%', padding: '8px 10px', background: '#0a0a14', border: `1px solid ${C.border}`, borderRadius: 6, color: C.text, fontSize: 12, marginBottom: 12 }}
          />

          <FilterLabel>Role</FilterLabel>
          <select value={role} onChange={e => setRole(e.target.value)} style={selectStyle}>
            <option value="">All roles</option>
            <option value="user">User</option>
            <option value="moderator">Moderator</option>
            <option value="admin">Admin</option>
          </select>

          <FilterLabel>Plan</FilterLabel>
          <select value={plan} onChange={e => setPlan(e.target.value)} style={selectStyle}>
            <option value="">All plans</option>
            <option value="free">Free</option>
            <option value="lite">Lite</option>
            <option value="pro">Pro</option>
          </select>
        </aside>
      </div>

      {openUid && (
        <UserDrawer
          uid={openUid}
          onClose={() => setOpenUid(null)}
          onChanged={() => { loadStats(); loadPage(true); }}
        />
      )}
    </AdminShell>
  );
}

const selectStyle = {
  width: '100%', padding: '8px 10px',
  background: '#0a0a14', border: `1px solid ${C.border}`, borderRadius: 6,
  color: C.text, fontSize: 12, marginBottom: 12,
  appearance: 'none',
  cursor: 'pointer',
};

function FilterLabel({ children }) {
  return <div style={{ fontSize: 10, fontWeight: 700, color: C.textDim, marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{children}</div>;
}
