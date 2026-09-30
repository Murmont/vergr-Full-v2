// Shared helpers for admin screens — TOTP step-up prompt + guarded-call hook
// + a few small utilities (call shortcut, formatters, common cell types).

import { useState, useCallback } from 'react';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { useUI } from '../../context/UIContext';
import Icon from '../../components/Icon';
import { ADMIN_COLORS as C } from './AdminShell';

export const call = (name, data) =>
  httpsCallable(getFunctions(undefined, 'europe-west1'), name)(data).then(r => r.data);

export const fmtNumber = (n) => (n ?? 0).toLocaleString();
export const fmtMoney  = (n, cur = '$') => `${cur}${(n ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export const fmtDate   = (ms) => ms ? new Date(ms).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : '—';
export const fmtTime   = (ms) => ms ? new Date(ms).toLocaleString() : '—';
export const fmtRelative = (ms) => {
  if (!ms) return '—';
  const diff = Date.now() - ms;
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  if (diff < 30 * 86_400_000) return `${Math.floor(diff / 86_400_000)}d ago`;
  return fmtDate(ms);
};

export function StepUpPrompt({ onSubmit, onCancel, busy }) {
  const [code, setCode] = useState('');
  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 300,
    }}>
      <div style={{
        background: C.card, border: `1px solid ${C.border}`, borderRadius: 12,
        padding: 22, width: 360, maxWidth: '90vw',
      }}>
        <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: C.text }}>Verify with TOTP</h3>
        <p style={{ margin: '6px 0 14px', fontSize: 12, color: C.textDim }}>
          Enter the 6-digit code from your authenticator app to confirm this destructive action.
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

// Wraps an async fn — auto-prompts for TOTP if the server raises STEP_UP_REQUIRED.
export function useGuardedCall() {
  const { showToast } = useUI();
  const [stepUp, setStepUp] = useState(null);
  const [busy, setBusy] = useState(false);

  const guarded = useCallback(async (fn) => {
    try {
      return await fn();
    } catch (err) {
      const msg = (err?.message || '').toLowerCase();
      const isStepUp = (err?.code === 'functions/failed-precondition' && msg.includes('step-up'))
                    || msg.includes('step_up_required');
      if (!isStepUp) {
        showToast(err?.message || 'Action failed', 'error');
        throw err;
      }
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
    overlay: stepUp ? <StepUpPrompt onSubmit={stepUp.submit} onCancel={stepUp.cancel} busy={busy} /> : null,
  };
}

// Simple confirm dialog with a reason textarea — used by every destructive action.
export function ReasonPrompt({ title, message, placeholder = 'Reason (required)', extraField, danger = true, onConfirm, onCancel }) {
  const [reason, setReason] = useState('');
  const [extra, setExtra] = useState(extraField?.defaultValue ?? '');
  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)', zIndex: 250,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 22, width: 460, maxWidth: '92vw' }}>
        <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: C.text }}>{title}</h3>
        <p style={{ margin: '6px 0 14px', fontSize: 12, color: C.textDim, lineHeight: 1.5 }}>{message}</p>
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

export function KpiCard({ icon, color, label, value, sub }) {
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

export function Tabs({ tabs, active, onChange }) {
  return (
    <div style={{ display: 'flex', gap: 4, marginBottom: 16, borderBottom: `1px solid ${C.border}`, overflowX: 'auto' }}>
      {tabs.map(t => (
        <button
          key={t.id}
          onClick={() => onChange(t.id)}
          style={{
            padding: '10px 16px', background: 'transparent', border: 0,
            borderBottom: `2px solid ${active === t.id ? C.accent : 'transparent'}`,
            color: active === t.id ? C.text : C.textDim,
            fontSize: 13, fontWeight: active === t.id ? 600 : 500,
            cursor: 'pointer', marginBottom: -1, whiteSpace: 'nowrap',
          }}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

// CSV of rows ALREADY LOADED on screen: costs no reads. Quotes every cell and
// doubles embedded quotes, so commas, quotes and newlines in a report reason
// cannot break a column. A leading = + - @ is prefixed with ' so a spreadsheet
// never runs a cell as a formula (CSV injection).
export function downloadCsv(filename, columns, rows) {
  const cell = (v) => {
    let s = v === null || v === undefined ? '' : String(v);
    if (/^[=+\-@]/.test(s)) s = `'${s}`;
    return `"${s.replace(/"/g, '""')}"`;
  };
  const lines = [columns.map((c) => cell(c.label)).join(',')];
  for (const r of rows) lines.push(columns.map((c) => cell(c.get(r))).join(','));
  const blob = new Blob([lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
