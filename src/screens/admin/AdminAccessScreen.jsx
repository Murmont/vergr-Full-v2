// AdminAccessScreen — founder-only UI to manage sub-admins.
//
// Three sections:
//   1. Active admins   — current roster, edit screens, revoke
//   2. Pending invites — email + scopes + cancel
//   3. Invite form     — email + multi-select screen list

import { useEffect, useState, useCallback } from 'react';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { useUI } from '../../context/UIContext';
import useAdminAccess from '../../hooks/useAdminAccess';
import Icon from '../../components/Icon';
import AdminShell, { ADMIN_COLORS as C, ADMIN_NAV } from './AdminShell';

// ⚠ 'support' is NOT a sidebar screen (the queue lives inside Announcements ->
// Channels, and an agent answers from the ordinary app), so deriving this list
// from ADMIN_NAV alone meant nobody could ever be made a support agent. It is
// listed here because functions/adminAccess.js ADMIN_SCREENS grants it on its own.
const ALL_SCREEN_OPTIONS = [
  ...ADMIN_NAV.map(n => ({ id: n.id, label: n.label })),
  { id: 'support', label: 'Support agent' },
];

function ScreenChips({ value, onChange }) {
  const has = (id) => value.includes(id) || value.includes('*');
  const toggle = (id) => {
    if (value.includes('*')) {
      // converting from full → specific
      onChange(ALL_SCREEN_OPTIONS.map(o => o.id).filter(x => x !== id));
      return;
    }
    onChange(has(id) ? value.filter(v => v !== id) : [...value, id]);
  };
  const setAll = () => onChange(['*']);
  return (
    <div>
      <button
        onClick={setAll}
        style={{
          padding: '6px 10px', borderRadius: 6,
          background: value.includes('*') ? C.accent : 'transparent',
          border: `1px solid ${value.includes('*') ? C.accent : C.border}`,
          color: value.includes('*') ? '#fff' : C.textDim,
          fontSize: 11, fontWeight: 600, cursor: 'pointer', marginRight: 6, marginBottom: 6,
        }}
      >
        All screens (founder-equivalent)
      </button>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
        {ALL_SCREEN_OPTIONS.map(opt => (
          <button
            key={opt.id}
            onClick={() => toggle(opt.id)}
            style={{
              padding: '6px 10px', borderRadius: 6,
              background: has(opt.id) ? `${C.accent}30` : 'transparent',
              border: `1px solid ${has(opt.id) ? C.accent : C.border}`,
              color: has(opt.id) ? C.text : C.textDim,
              fontSize: 11, fontWeight: 500, cursor: 'pointer',
            }}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  );
}

// ONE-TIME SETUP for Vergr Admin, the separate operator console.
//
// Founder, 2026-09-19: the admin must not be the public @Vergr account and must
// not be reachable from the web — "then i will create a user with an email no
// one knows and isnt subscribed to anything, this email shouldnt be a user
// account ... so that if someone with bad intent looks there will actually be
// nothing to find."
//
// This arms an email address for ONE HOUR. The next Firebase Auth account
// created with it becomes the operator: a custom claim, no profile, no wallet,
// no presence. The address is stored only as a sha256 hash, so this panel is
// the last place it is ever written down.
function OperatorSetup() {
  const { showToast } = useUI();
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [armedUntil, setArmedUntil] = useState(0);

  const arm = async () => {
    if (!email.trim()) return showToast('Email required', 'error');
    setBusy(true);
    try {
      const fn = httpsCallable(getFunctions(undefined, 'europe-west1'), 'inviteAdmin');
      const res = await fn({ email: email.trim(), operator: true });
      setArmedUntil(res?.data?.expiresAt || Date.now() + 3600e3);
      setEmail('');
      showToast('Operator armed. Create the account in Vergr Admin within the hour.', 'success');
    } catch (err) {
      showToast(err?.message || 'Could not arm the operator', 'error');
    }
    setBusy(false);
  };

  return (
    <div style={{ padding: 18, background: C.card, border: `1px solid ${C.border}`, borderRadius: 12 }}>
      <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700, color: C.text }}>Vergr Admin operator</h3>
      <p style={{ margin: '6px 0 14px', fontSize: 12, color: C.textDim, lineHeight: 1.5 }}>
        Arms an email for one hour. Open Vergr Admin (the desktop app), choose
        &ldquo;First run&rdquo;, and create the account with that email and a password only
        you know. It gets no profile and appears nowhere in the app.
      </p>
      <input
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="operator email"
        style={{
          width: '100%', padding: '10px 12px', background: C.card2,
          border: `1px solid ${C.border}`, borderRadius: 8, color: C.text,
          fontSize: 13, outline: 'none', boxSizing: 'border-box',
        }}
      />
      <button
        type="button"
        onClick={arm}
        disabled={busy}
        style={{
          width: '100%', marginTop: 12, padding: '10px 12px', borderRadius: 8,
          border: 'none', background: busy ? '#2a2a40' : C.accent, color: '#fff',
          fontSize: 13, fontWeight: 700, cursor: busy ? 'default' : 'pointer',
        }}
      >
        {busy ? 'Arming…' : 'Arm operator setup'}
      </button>
      {armedUntil > 0 && (
        <p style={{ margin: '10px 0 0', fontSize: 12, color: C.textDim }}>
          Armed until {new Date(armedUntil).toLocaleTimeString()}. After that it expires and you arm it again.
        </p>
      )}
    </div>
  );
}

function InviteForm({ onInvited }) {
  const { showToast } = useUI();
  const [email, setEmail] = useState('');
  const [screens, setScreens] = useState([]);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!email.trim()) return showToast('Email required', 'error');
    if (screens.length === 0) return showToast('Pick at least one screen', 'error');
    setBusy(true);
    try {
      const fn = httpsCallable(getFunctions(undefined, 'europe-west1'), 'inviteAdmin');
      await fn({ email: email.trim(), allowedScreens: screens });
      showToast('Invite sent', 'success');
      setEmail('');
      setScreens([]);
      onInvited?.();
    } catch (err) {
      showToast(err?.message || 'Invite failed', 'error');
    }
    setBusy(false);
  };

  return (
    <div style={{ padding: 18, background: C.card, border: `1px solid ${C.border}`, borderRadius: 12 }}>
      <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700, color: C.text }}>Invite a sub-admin</h3>
      <p style={{ margin: '6px 0 14px', fontSize: 12, color: C.textDim }}>
        Send an invite to anyone with a VERGR account. They&apos;ll see a notification
        and can accept from Settings → Admin Access.
      </p>

      <label style={{ display: 'block', marginBottom: 14 }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: C.textDim, marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          Email
        </div>
        <input
          type="email"
          value={email}
          onChange={e => setEmail(e.target.value)}
          placeholder="someone@example.com"
          style={{
            width: '100%', padding: '10px 12px',
            background: '#0a0a14', border: `1px solid ${C.border}`, borderRadius: 8,
            color: C.text, fontSize: 13,
          }}
        />
      </label>

      <div style={{ marginBottom: 14 }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: C.textDim, marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          Allowed screens
        </div>
        <ScreenChips value={screens} onChange={setScreens} />
      </div>

      <button
        onClick={submit}
        disabled={busy}
        style={{
          padding: '10px 16px', borderRadius: 8, border: 0,
          background: busy ? '#555' : C.accent, color: '#fff',
          fontSize: 13, fontWeight: 700, cursor: busy ? 'wait' : 'pointer',
          display: 'inline-flex', alignItems: 'center', gap: 8,
        }}
      >
        <Icon name={busy ? 'hourglass_top' : 'send'} size={16} />
        {busy ? 'Sending…' : 'Send invite'}
      </button>
    </div>
  );
}

// Solid pills (no translucent washes). pending_2fa = accepted the invite but has
// not finished authenticator setup, so every admin call still refuses them.
const STATUS_PILL = {
  active:      { label: 'Active',          bg: '#123524', fg: '#4ade80' },
  pending_2fa: { label: 'Setting up 2FA',  bg: '#3a2a08', fg: '#f5c842' },
  revoked:     { label: 'Revoked',         bg: '#3a1420', fg: '#f04060' },
};

function AdminRow({ admin, onChanged }) {
  const { showToast } = useUI();
  const [editing, setEditing] = useState(false);
  const [screens, setScreens] = useState(admin.allowedScreens || []);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    try {
      const fn = httpsCallable(getFunctions(undefined, 'europe-west1'), 'setAdminScreens');
      await fn({ uid: admin.uid, allowedScreens: screens });
      showToast('Scopes updated', 'success');
      setEditing(false);
      onChanged?.();
    } catch (err) {
      showToast(err?.message || 'Update failed', 'error');
    }
    setBusy(false);
  };

  const revoke = async () => {
    if (!window.confirm(`Revoke admin access for ${admin.email}?`)) return;
    setBusy(true);
    try {
      const fn = httpsCallable(getFunctions(undefined, 'europe-west1'), 'revokeAdminAccess');
      await fn({ uid: admin.uid });
      showToast('Access revoked', 'success');
      onChanged?.();
    } catch (err) {
      showToast(err?.message || 'Revoke failed', 'error');
    }
    setBusy(false);
  };

  return (
    <div style={{ padding: 14, background: C.card, border: `1px solid ${C.border}`, borderRadius: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: editing ? 12 : 0 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: C.text }}>
            {admin.displayName || admin.email}
          </div>
          <div style={{ fontSize: 11, color: C.textDim, marginTop: 2 }}>
            {admin.email}
            <span style={{
              marginLeft: 8,
              padding: '2px 6px', borderRadius: 4, fontSize: 9, fontWeight: 700,
              background: STATUS_PILL[admin.status]?.bg || '#3a1420',
              color:      STATUS_PILL[admin.status]?.fg || '#f04060',
              textTransform: 'uppercase', letterSpacing: '0.05em',
            }}>{STATUS_PILL[admin.status]?.label || admin.status}</span>
          </div>
          {!editing && (
            <div style={{ fontSize: 11, color: C.textDim, marginTop: 6, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
              {(admin.allowedScreens || []).map(s => (
                <span key={s} style={{
                  padding: '2px 8px', borderRadius: 999,
                  background: `${C.accent}25`, color: C.text, fontSize: 10, fontWeight: 600,
                }}>{s === '*' ? 'all' : s}</span>
              ))}
            </div>
          )}
        </div>
        {(admin.status === 'active' || admin.status === 'pending_2fa') && (
          <div style={{ display: 'flex', gap: 6 }}>
            {!editing && (
              <button onClick={() => { setEditing(true); setScreens(admin.allowedScreens || []); }}
                style={{ padding: '7px 12px', borderRadius: 6, background: 'transparent', border: `1px solid ${C.border}`, color: C.textDim, fontSize: 11, fontWeight: 600, cursor: 'pointer' }}>
                Edit scopes
              </button>
            )}
            <button onClick={revoke} disabled={busy}
              style={{ padding: '7px 12px', borderRadius: 6, background: 'transparent', border: `1px solid #f04060`, color: '#f04060', fontSize: 11, fontWeight: 600, cursor: 'pointer' }}>
              Revoke
            </button>
          </div>
        )}
      </div>
      {editing && (
        <>
          <ScreenChips value={screens} onChange={setScreens} />
          <div style={{ marginTop: 10, display: 'flex', gap: 6 }}>
            <button onClick={save} disabled={busy}
              style={{ padding: '7px 12px', borderRadius: 6, background: C.accent, color: '#fff', border: 0, fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>
              {busy ? 'Saving…' : 'Save'}
            </button>
            <button onClick={() => setEditing(false)}
              style={{ padding: '7px 12px', borderRadius: 6, background: 'transparent', border: `1px solid ${C.border}`, color: C.textDim, fontSize: 11, cursor: 'pointer' }}>
              Cancel
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function InviteRow({ invite, onChanged }) {
  const { showToast } = useUI();
  const [busy, setBusy] = useState(false);
  const revoke = async () => {
    if (!window.confirm(`Cancel invite for ${invite.email}?`)) return;
    setBusy(true);
    try {
      const fn = httpsCallable(getFunctions(undefined, 'europe-west1'), 'revokeAdminInvite');
      await fn({ inviteId: invite.id });
      showToast('Invite cancelled', 'success');
      onChanged?.();
    } catch (err) {
      showToast(err?.message || 'Cancel failed', 'error');
    }
    setBusy(false);
  };
  const expIn = invite.expiresAt ? Math.max(0, Math.round((invite.expiresAt - Date.now()) / 86400000)) : null;
  return (
    <div style={{
      padding: 14, background: C.card, border: `1px solid ${C.border}`,
      borderRadius: 10, display: 'flex', alignItems: 'center', gap: 12,
    }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: C.text }}>{invite.email}</div>
        <div style={{ fontSize: 11, color: C.textDim, marginTop: 4, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
          {(invite.allowedScreens || []).map(s => (
            <span key={s} style={{
              padding: '2px 8px', borderRadius: 999,
              background: `${C.accent2}25`, color: C.text, fontSize: 10, fontWeight: 600,
            }}>{s === '*' ? 'all' : s}</span>
          ))}
        </div>
        {expIn !== null && (
          <div style={{ fontSize: 10, color: C.textMuted, marginTop: 6 }}>
            Expires in {expIn} day{expIn === 1 ? '' : 's'}
          </div>
        )}
      </div>
      <button onClick={revoke} disabled={busy}
        style={{ padding: '7px 12px', borderRadius: 6, background: 'transparent', border: `1px solid ${C.border}`, color: C.textDim, fontSize: 11, fontWeight: 600, cursor: 'pointer' }}>
        Cancel
      </button>
    </div>
  );
}

export default function AdminAccessScreen() {
  const { isFounder } = useAdminAccess();
  const { showToast } = useUI();
  const [data, setData] = useState({ admins: [], invites: [] });
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const fn = httpsCallable(getFunctions(undefined, 'europe-west1'), 'listAdmins');
      const r = await fn();
      setData(r.data || { admins: [], invites: [] });
    } catch (err) {
      showToast(err?.message || 'Failed to load admins', 'error');
    }
    setLoading(false);
  }, [showToast]);

  useEffect(() => {
    if (isFounder) reload();
  }, [isFounder, reload]);

  return (
    <AdminShell
      screen="access"
      title="Admin Access"
      subtitle="Invite sub-admins and manage their screen-level permissions."
    >
      {!isFounder ? (
        <div style={{
          padding: 40, textAlign: 'center', background: C.card,
          border: `1px solid ${C.border}`, borderRadius: 12, color: C.textDim,
        }}>
          <Icon name="lock" size={36} className="opacity-40 mx-auto" />
          <h3 style={{ marginTop: 12, fontSize: 16, color: C.text }}>Founder only</h3>
          <p style={{ marginTop: 4, fontSize: 12 }}>Only the platform owner can invite or manage other admins.</p>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 360px', gap: 20 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            <section>
              <h3 style={{ margin: '0 0 10px', fontSize: 13, fontWeight: 700, color: C.text, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Active admins ({data.admins.filter(a => a.status === 'active').length})
              </h3>
              {loading ? (
                <div style={{ color: C.textDim, fontSize: 12 }}>Loading…</div>
              ) : data.admins.length === 0 ? (
                <div style={{ color: C.textDim, fontSize: 12 }}>No sub-admins yet. Invite the first one →</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {data.admins.map(a => (
                    <AdminRow key={a.uid} admin={a} onChanged={reload} />
                  ))}
                </div>
              )}
            </section>

            <section>
              <h3 style={{ margin: '0 0 10px', fontSize: 13, fontWeight: 700, color: C.text, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Pending invites ({data.invites.length})
              </h3>
              {data.invites.length === 0 ? (
                <div style={{ color: C.textDim, fontSize: 12 }}>No pending invites.</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {data.invites.map(inv => (
                    <InviteRow key={inv.id} invite={inv} onChanged={reload} />
                  ))}
                </div>
              )}
            </section>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            <OperatorSetup />
            <InviteForm onInvited={reload} />
          </div>
        </div>
      )}
    </AdminShell>
  );
}
