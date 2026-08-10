// Two-Factor Authentication UI (Settings → Security).
//   <TwoFactorSetupModal>  — enroll: QR + manual secret → confirm code → recovery codes.
//   <StepUpModal>          — prompt for a current code, verify, resolve on success.
// Backed by functions/accountSecurity.js via accountSecurityCallables.
import { useState, useEffect } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { useUI } from '../../context/UIContext';
import {
  enrollAccountTotp, confirmAccountTotpEnrollment, verifyAccountTotp,
} from '../../firebase/accountSecurityCallables';

function Backdrop({ children, onClose }) {
  return (
    <div onClick={onClose} className="fixed inset-0 z-[200] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
      <div onClick={e => e.stopPropagation()}
        className="w-full max-w-md bg-surface-1 border border-white/10 rounded-2xl p-5 max-h-[90vh] overflow-y-auto">
        {children}
      </div>
    </div>
  );
}

const codeInput = "w-full bg-surface-2 border border-white/10 rounded-xl py-3 px-4 text-center text-xl tracking-[0.3em] font-dmmono text-text-primary outline-none focus:border-brand-violet/50";

// ── Enrollment flow ──────────────────────────────────────────────────────
export function TwoFactorSetupModal({ onClose, onEnrolled }) {
  const { showToast } = useUI();
  const [step, setStep] = useState('loading'); // loading | scan | confirm | recovery
  const [info, setInfo] = useState(null); // { otpauthUrl, secret }
  const [code, setCode] = useState('');
  const [recovery, setRecovery] = useState([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    enrollAccountTotp()
      .then(d => { if (alive) { setInfo(d); setStep('scan'); } })
      .catch(err => {
        showToast(err?.message || 'Could not start 2FA setup', 'error');
        onClose();
      });
    return () => { alive = false; };
  }, []); // eslint-disable-line

  const confirm = async () => {
    if (!/^\d{6}$/.test(code) || busy) return;
    setBusy(true);
    try {
      const d = await confirmAccountTotpEnrollment({ code });
      setRecovery(d.recoveryCodes || []);
      setStep('recovery');
      showToast('Two-factor authentication enabled', 'success');
    } catch (err) {
      showToast(err?.message || 'Invalid code', 'error');
    }
    setBusy(false);
  };

  return (
    <Backdrop onClose={step === 'recovery' ? undefined : onClose}>
      {step === 'loading' && <p className="text-center text-text-muted py-8">Preparing setup…</p>}

      {step === 'scan' && info && (
        <>
          <h3 className="text-lg font-bold mb-1">Set up two-factor authentication</h3>
          <p className="text-xs text-text-muted mb-4">Scan this QR code with Google Authenticator, Authy, or any TOTP app.</p>
          <div className="flex justify-center mb-4 bg-white p-3 rounded-xl w-fit mx-auto">
            <QRCodeSVG value={info.otpauthUrl} size={176} />
          </div>
          <div className="mb-4">
            <p className="text-[11px] text-text-muted mb-1">Or enter this key manually:</p>
            <code className="block bg-surface-2 rounded-lg px-3 py-2 text-xs font-dmmono break-all text-brand-violet-light">{info.secret}</code>
          </div>
          <button onClick={() => setStep('confirm')} className="btn-primary">I've added it</button>
          <button onClick={onClose} className="w-full mt-2 text-sm text-text-muted py-2">Cancel</button>
        </>
      )}

      {step === 'confirm' && (
        <>
          <h3 className="text-lg font-bold mb-1">Enter the 6-digit code</h3>
          <p className="text-xs text-text-muted mb-4">Type the current code shown in your authenticator app.</p>
          <input className={codeInput} inputMode="numeric" maxLength={6} value={code}
            onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            onKeyDown={e => e.key === 'Enter' && confirm()} autoFocus placeholder="000000" />
          <button onClick={confirm} disabled={!/^\d{6}$/.test(code) || busy} className="btn-primary mt-4 disabled:opacity-50">
            {busy ? 'Verifying…' : 'Verify & enable'}
          </button>
          <button onClick={() => setStep('scan')} className="w-full mt-2 text-sm text-text-muted py-2">Back</button>
        </>
      )}

      {step === 'recovery' && (
        <>
          <h3 className="text-lg font-bold mb-1">Save your recovery codes</h3>
          <p className="text-xs text-text-muted mb-4">Each code works once if you lose your authenticator. Store them somewhere safe — they won't be shown again.</p>
          <div className="grid grid-cols-2 gap-2 mb-4 bg-surface-2 rounded-xl p-3">
            {recovery.map(c => <code key={c} className="text-sm font-dmmono text-center text-text-primary">{c}</code>)}
          </div>
          <button
            onClick={() => { navigator.clipboard?.writeText(recovery.join('\n')); showToast('Recovery codes copied', 'success'); }}
            className="btn-secondary mb-2">Copy codes</button>
          <button onClick={() => { onEnrolled?.(); onClose(); }} className="btn-primary">Done</button>
        </>
      )}
    </Backdrop>
  );
}

// ── Step-up prompt ───────────────────────────────────────────────────────
// Calls onSuccess(code) only after the code passes. When `verify` is true
// (default) it confirms the code via verifyAccountTotp; when false it just hands
// the entered code back (for callables like disable that verify it themselves —
// avoids double-consuming a one-shot recovery code).
export function StepUpModal({ title = 'Confirm it\'s you', verify = true, onClose, onSuccess }) {
  const { showToast } = useUI();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    const val = code.trim();
    if (!val || busy) return;
    setBusy(true);
    try {
      if (verify) await verifyAccountTotp({ code: val });
      onSuccess(val);
    } catch (err) {
      showToast(err?.message || 'Invalid code', 'error');
      setBusy(false);
    }
  };

  return (
    <Backdrop onClose={onClose}>
      <h3 className="text-lg font-bold mb-1">{title}</h3>
      <p className="text-xs text-text-muted mb-4">Enter your 6-digit authenticator code (or a recovery code) to continue.</p>
      <input className={codeInput} value={code} autoFocus
        onChange={e => setCode(e.target.value.replace(/\s/g, ''))}
        onKeyDown={e => e.key === 'Enter' && submit()} placeholder="000000" />
      <button onClick={submit} disabled={!code.trim() || busy} className="btn-primary mt-4 disabled:opacity-50">
        {busy ? 'Verifying…' : 'Verify'}
      </button>
      <button onClick={onClose} className="w-full mt-2 text-sm text-text-muted py-2">Cancel</button>
    </Backdrop>
  );
}
