// WalletOnboarding — first-time wallet setup. Three steps:
//   1. Welcome  (mandatory)
//   2. PIN setup + confirm  (mandatory)
//   3. 2FA + recovery codes  (optional / skippable)
// On completion, the server stamps users/wallets/{uid}.onboardingCompleted = true
// inside setupWalletPin, so we don't need a separate write here.

import { useState } from 'react';
import {
  Modal, PinPad, WALLET_TOKENS, WalletButton, Callout, fmtNum,
} from './primitives';
import Icon from '../Icon';
import { useWalletUnlock } from '../../context/WalletUnlockContext';
import {
  setupWalletPin, verifyWalletPin,
  enrollWalletTotp, confirmWalletTotpEnrollment,
} from '../../firebase/walletCallables';

const COMMON_PINS = new Set(['123456','654321','012345','111111','000000','123123','456789']);

function validatePinFormat(pin) {
  if (!/^\d{6}$/.test(pin)) return 'PIN must be six digits.';
  if (/^(\d)\1{5}$/.test(pin)) return 'PIN too easy — avoid repeated digits.';
  if (COMMON_PINS.has(pin)) return 'Avoid common sequences like 123456.';
  return null;
}

export default function WalletOnboarding({ open, onComplete }) {
  const [step, setStep] = useState('welcome'); // welcome | pin | confirm | done-pin | 2fa | 2fa-scan | 2fa-verify | 2fa-codes | done
  const [pin, setPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [savedPin, setSavedPin] = useState('');
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  // 2FA state
  const [otpauthUrl, setOtpauthUrl] = useState(null);
  const [base32, setBase32] = useState(null);
  const [totpCode, setTotpCode] = useState('');
  const [recoveryCodes, setRecoveryCodes] = useState([]);
  const [codesSaved, setCodesSaved] = useState(false);

  const { _resolveUnlock } = useWalletUnlock();

  const reset = () => {
    setPin(''); setConfirmPin(''); setSavedPin(''); setError(null); setSubmitting(false);
    setOtpauthUrl(null); setBase32(null); setTotpCode(''); setRecoveryCodes([]); setCodesSaved(false);
  };

  // ── Step handlers ──────────────────────────────────────────────────
  const handlePinComplete = (value) => {
    const err = validatePinFormat(value);
    if (err) {
      setError(err);
      setTimeout(() => { setPin(''); setError(null); }, 1500);
      return;
    }
    setSavedPin(value);
    setError(null);
    setStep('confirm');
  };

  const handleConfirmComplete = async (value) => {
    if (value !== savedPin) {
      setError("PINs don't match. Try again.");
      setTimeout(() => { setConfirmPin(''); setError(null); }, 1500);
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await setupWalletPin({ pin: value });
      // Immediately verify so we get a fresh unlock token in memory for the
      // optional 2FA enrollment which requires it.
      const res = await verifyWalletPin({ pin: value });
      if (res?.unlockToken) _resolveUnlock(res.unlockToken);
      setStep('2fa');
    } catch (e) {
      setError(e?.message || 'Could not save PIN. Try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const startTotp = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const res = await enrollWalletTotp({ unlockToken: getToken() });
      setOtpauthUrl(res.otpauthUrl);
      setBase32(res.base32);
      setStep('2fa-scan');
    } catch (e) {
      setError(e?.message || 'Could not start 2FA enrollment.');
    } finally {
      setSubmitting(false);
    }
  };

  const confirmTotp = async () => {
    if (!/^\d{6}$/.test(totpCode)) {
      setError('Enter the 6-digit code from your authenticator.');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await confirmWalletTotpEnrollment({ code: totpCode });
      setRecoveryCodes(res.recoveryCodes || []);
      setStep('2fa-codes');
    } catch (e) {
      setError(e?.message || 'Code is wrong or expired.');
    } finally {
      setSubmitting(false);
    }
  };

  // The PIN-modal unlock token may not be available via the context's public
  // shape (it isn't exposed). We read it through the same context hook.
  const unlockCtx = useWalletUnlock();
  const getToken = () => unlockCtx.unlockToken;

  const downloadRecovery = () => {
    const text = [
      'VERGR Wallet — recovery codes',
      '====================================',
      'Each code works ONCE. Store somewhere safe.',
      '',
      ...recoveryCodes,
      '',
      `Generated: ${new Date().toISOString()}`,
    ].join('\n');
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'vergr-wallet-recovery-codes.txt';
    document.body.appendChild(a); a.click();
    document.body.removeChild(a); URL.revokeObjectURL(url);
  };

  const copyAll = () => {
    navigator.clipboard?.writeText(recoveryCodes.join('\n'));
  };

  const finish = () => { onComplete?.(); reset(); };

  // ── Step indicator ────────────────────────────────────────────────
  const stepIdx = step === 'welcome' ? 0
                : ['pin','confirm'].includes(step) ? 1
                : ['2fa','2fa-scan','2fa-verify','2fa-codes'].includes(step) ? 2
                : 3;

  return (
    <Modal open={open} onClose={null /* mandatory — no close */} width={560}>
      <StepDots current={stepIdx} />

      {/* ── Welcome ───────────────────────────────────────────── */}
      {step === 'welcome' && (
        <div style={{ textAlign: 'center', padding: '8px 4px' }}>
          <div style={{
            width: 72, height: 72, margin: '8px auto 20px',
            borderRadius: '50%', display: 'grid', placeItems: 'center',
            background: `linear-gradient(135deg, ${WALLET_TOKENS.violet}, ${WALLET_TOKENS.pink})`,
          }}>
            <Icon name="account_balance_wallet" size={36} className="text-white" />
          </div>
          <div style={{ fontFamily: 'Syne, sans-serif', fontWeight: 700, fontSize: 24, marginBottom: 10 }}>
            Welcome to your wallet
          </div>
          <div style={{ color: WALLET_TOKENS.textSecondary, fontSize: 14, lineHeight: 1.6, maxWidth: 420, margin: '0 auto 24px' }}>
            Coins for spending. Gems for earning. We'll set up a 6-digit PIN and
            an optional second factor so you stay in control. Takes about a minute.
          </div>
          <WalletButton variant="primary" size="lg" onClick={() => setStep('pin')} iconRight="arrow_forward">
            Get started
          </WalletButton>
        </div>
      )}

      {/* ── PIN ──────────────────────────────────────────────── */}
      {step === 'pin' && (
        <div style={{ textAlign: 'center' }}>
          <Eyebrow>Step 1 · PIN</Eyebrow>
          <Headline>Set a 6-digit PIN</Headline>
          <Sub>You'll enter this before withdrawing, viewing your deposit address, or changing wallet settings. Not the same as your account password.</Sub>
          <PinPad value={pin} onChange={setPin} onComplete={handlePinComplete} error={!!error} disabled={submitting} />
          {error && <ErrorLine>{error}</ErrorLine>}
        </div>
      )}

      {step === 'confirm' && (
        <div style={{ textAlign: 'center' }}>
          <Eyebrow>Step 1 · Confirm</Eyebrow>
          <Headline>Once more</Headline>
          <Sub>Type the same six digits again to confirm.</Sub>
          <PinPad value={confirmPin} onChange={setConfirmPin} onComplete={handleConfirmComplete} error={!!error} disabled={submitting} />
          {error && <ErrorLine>{error}</ErrorLine>}
          <div style={{ marginTop: 18 }}>
            <WalletButton variant="ghost" size="sm" onClick={() => { setStep('pin'); setConfirmPin(''); setPin(''); setSavedPin(''); }}>
              ← Restart
            </WalletButton>
          </div>
        </div>
      )}

      {/* ── 2FA gate ─────────────────────────────────────────── */}
      {step === '2fa' && (
        <div style={{ textAlign: 'center' }}>
          <Eyebrow>Step 2 · Two-factor</Eyebrow>
          <Headline>Add 2FA (recommended)</Headline>
          <Sub>Required for withdrawals over €100, adding withdrawal addresses, and disabling 2FA itself. Takes about 60 seconds.</Sub>
          <div style={{
            display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12,
            maxWidth: 460, margin: '0 auto',
          }}>
            <ChoiceCard tone="violet" icon="shield" title="Set up 2FA" sub="~60 seconds" onClick={startTotp} disabled={submitting} />
            <ChoiceCard tone="neutral" icon="schedule" title="Skip for now" sub="Add it later in Security" onClick={() => setStep('done')} />
          </div>
          {error && <ErrorLine>{error}</ErrorLine>}
        </div>
      )}

      {step === '2fa-scan' && (
        <div style={{ maxWidth: 480, margin: '0 auto' }}>
          <Eyebrow>Step 2 · Scan</Eyebrow>
          <Headline center>Scan in your app</Headline>
          <Sub center>Google Authenticator, 1Password, Authy, Bitwarden — anything that does TOTP.</Sub>
          <div style={{
            margin: '0 auto 16px', width: 200, height: 200, borderRadius: 16,
            background: '#fff', display: 'grid', placeItems: 'center',
          }}>
            {/* Lightweight QR via Google Chart API (no extra dep). otpauthUrl is short,
                won't hit URL limits. */}
            {otpauthUrl ? (
              <img
                src={`https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(otpauthUrl)}`}
                alt="2FA QR code" width="180" height="180"
                style={{ display: 'block' }}
              />
            ) : <span style={{ color: '#000', fontSize: 12 }}>Loading…</span>}
          </div>
          <div style={{ fontSize: 11, color: WALLET_TOKENS.textMuted, textAlign: 'center', marginBottom: 6 }}>
            Or enter this code manually:
          </div>
          <div className="font-dmmono" style={{
            padding: 12, borderRadius: 8, background: WALLET_TOKENS.surface2,
            border: `1px solid ${WALLET_TOKENS.hairline}`, fontSize: 12,
            wordBreak: 'break-all', textAlign: 'center', letterSpacing: '0.05em',
          }}>{base32}</div>
          <div style={{ display: 'flex', gap: 10, justifyContent: 'center', marginTop: 18 }}>
            <WalletButton variant="ghost" onClick={() => setStep('2fa')}>Back</WalletButton>
            <WalletButton variant="primary" onClick={() => setStep('2fa-verify')} iconRight="arrow_forward">Continue</WalletButton>
          </div>
        </div>
      )}

      {step === '2fa-verify' && (
        <div style={{ maxWidth: 420, margin: '0 auto', textAlign: 'center' }}>
          <Eyebrow>Step 2 · Verify</Eyebrow>
          <Headline>Enter the code</Headline>
          <Sub>Six digits from your authenticator app.</Sub>
          <input
            value={totpCode}
            onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            placeholder="000000"
            autoFocus
            inputMode="numeric"
            style={{
              fontFamily: 'DM Mono, monospace',
              fontSize: 28, letterSpacing: '0.4em',
              textAlign: 'center', height: 64,
              padding: '0 24px', width: '100%', maxWidth: 280,
              background: WALLET_TOKENS.surface2,
              border: `1px solid ${WALLET_TOKENS.hairlineStrong}`,
              borderRadius: 12, color: WALLET_TOKENS.text,
              outline: 'none',
            }}
          />
          {error && <ErrorLine>{error}</ErrorLine>}
          <div style={{ marginTop: 20 }}>
            <WalletButton variant="primary" full disabled={totpCode.length !== 6 || submitting} onClick={confirmTotp}>
              {submitting ? 'Verifying…' : 'Verify'}
            </WalletButton>
          </div>
          <div style={{ marginTop: 10 }}>
            <WalletButton variant="ghost" size="sm" onClick={() => setStep('2fa-scan')}>← Back to QR</WalletButton>
          </div>
        </div>
      )}

      {step === '2fa-codes' && (
        <div style={{ maxWidth: 520, margin: '0 auto' }}>
          <Eyebrow>Step 2 · Recovery</Eyebrow>
          <Headline center>Save these now</Headline>
          <Sub center>Each code works once. We can't recover them for you. Print, store in a password manager, or download.</Sub>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            {recoveryCodes.map((c, i) => (
              <div key={i} className="font-dmmono" style={{
                padding: '12px 14px', borderRadius: 8, fontSize: 14,
                textAlign: 'center', letterSpacing: '0.05em',
                background: WALLET_TOKENS.surface2,
                border: `1px solid ${WALLET_TOKENS.hairline}`,
              }}>{c}</div>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 10, justifyContent: 'center', marginTop: 16 }}>
            <WalletButton variant="secondary" size="sm" onClick={copyAll} icon="content_copy">Copy all</WalletButton>
            <WalletButton variant="secondary" size="sm" onClick={downloadRecovery} icon="download">Download .txt</WalletButton>
          </div>
          <label style={{
            display: 'flex', alignItems: 'center', gap: 12, justifyContent: 'center',
            marginTop: 24, fontSize: 14, cursor: 'pointer',
          }}>
            <input type="checkbox" checked={codesSaved} onChange={(e) => setCodesSaved(e.target.checked)}
                   style={{ accentColor: WALLET_TOKENS.violetLight, width: 16, height: 16 }} />
            <span>I've saved my recovery codes</span>
          </label>
          <div style={{ marginTop: 20 }}>
            <WalletButton variant="primary" full disabled={!codesSaved} onClick={() => setStep('done')}>
              Finish setup
            </WalletButton>
          </div>
        </div>
      )}

      {/* ── Done ─────────────────────────────────────────────── */}
      {step === 'done' && (
        <div style={{ textAlign: 'center' }}>
          <div style={{
            width: 84, height: 84, margin: '4px auto 20px',
            borderRadius: '50%', display: 'grid', placeItems: 'center',
            background: 'rgba(34,197,94,0.16)',
            border: '1px solid rgba(34,197,94,0.40)',
          }}>
            <Icon name="check" size={40} className="text-emerald-400" />
          </div>
          <div style={{ fontFamily: 'Syne, sans-serif', fontWeight: 700, fontSize: 28, marginBottom: 10 }}>
            You're in
          </div>
          <div style={{ color: WALLET_TOKENS.textSecondary, fontSize: 14, marginBottom: 24, lineHeight: 1.55 }}>
            PIN set. {recoveryCodes.length ? '2FA enabled.' : '2FA: skipped (enable later in Security).'}
            <br />Your wallet is ready.
          </div>
          <WalletButton variant="primary" size="lg" onClick={finish} iconRight="arrow_forward">
            Open my wallet
          </WalletButton>
        </div>
      )}
    </Modal>
  );
}

// ── Small local helpers ────────────────────────────────────────────
const Eyebrow = ({ children }) => (
  <div style={{
    fontSize: 10, letterSpacing: '0.12em', textTransform: 'uppercase',
    color: WALLET_TOKENS.violetLight, fontWeight: 600, marginBottom: 12, textAlign: 'center',
  }}>{children}</div>
);
const Headline = ({ children, center = true }) => (
  <div style={{
    fontFamily: 'Syne, sans-serif', fontWeight: 700, fontSize: 28,
    marginBottom: 10, textAlign: center ? 'center' : 'left',
  }}>{children}</div>
);
const Sub = ({ children, center = true }) => (
  <div style={{
    color: WALLET_TOKENS.textSecondary, fontSize: 14, lineHeight: 1.55,
    marginBottom: 28, textAlign: center ? 'center' : 'left',
    maxWidth: 420, margin: center ? '0 auto 28px' : '0 0 28px',
  }}>{children}</div>
);
const ErrorLine = ({ children }) => (
  <div style={{ marginTop: 18, color: '#FCA5A5', fontSize: 13 }}>{children}</div>
);
const ChoiceCard = ({ tone, icon, title, sub, onClick, disabled }) => (
  <button onClick={onClick} disabled={disabled} style={{
    padding: 18, textAlign: 'left', borderRadius: 12,
    background: tone === 'violet'
      ? 'linear-gradient(135deg, rgba(123,31,255,0.16), rgba(123,31,255,0.04))'
      : WALLET_TOKENS.surface2,
    border: tone === 'violet'
      ? '1px solid rgba(123,31,255,0.40)'
      : `1px solid ${WALLET_TOKENS.hairline}`,
    color: WALLET_TOKENS.text, cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.6 : 1,
    transition: 'all 0.15s',
  }}>
    <Icon name={icon} size={22} className={tone === 'violet' ? 'text-violet-300' : 'text-zinc-400'} />
    <div style={{ fontWeight: 600, marginTop: 10 }}>{title}</div>
    <div style={{ color: WALLET_TOKENS.textMuted, fontSize: 12, marginTop: 2 }}>{sub}</div>
  </button>
);
const StepDots = ({ current }) => (
  <div style={{ display: 'flex', gap: 16, justifyContent: 'center', marginBottom: 28 }}>
    {['Start', 'PIN', '2FA', 'Done'].map((label, i) => (
      <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{
          width: 18, height: 18, borderRadius: '50%',
          background: current > i ? WALLET_TOKENS.success
                    : current === i ? WALLET_TOKENS.violet
                    : WALLET_TOKENS.surface2,
          border: current >= i ? '0' : `1px solid ${WALLET_TOKENS.hairlineStrong}`,
          display: 'grid', placeItems: 'center',
          fontSize: 10, fontWeight: 700, color: '#fff',
        }}>{current > i ? <Icon name="check" size={10} /> : i + 1}</div>
        <span style={{
          fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase',
          color: current >= i ? WALLET_TOKENS.text : WALLET_TOKENS.textMuted,
          fontWeight: current === i ? 700 : 500,
        }}>{label}</span>
      </div>
    ))}
  </div>
);
