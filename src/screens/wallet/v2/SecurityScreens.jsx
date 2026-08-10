// Security screens (v2) — hub + PIN change + TOTP + addresses + deposit.
// All wire to functions/wallet.js callables. PIN screens use PinPad,
// TOTP uses speakeasy enrollment via enrollWalletTotp / confirmWalletTotpEnrollment.

import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  WalletCard, WalletButton, Pill, PinPad, SectionLabel, Callout,
  Modal, WALLET_TOKENS, fmtNum, fmtEUR,
} from '../../../components/wallet/primitives';
import Icon from '../../../components/Icon';
import { useUser } from '../../../context/UserContext';
import { useWalletUnlock } from '../../../context/WalletUnlockContext';
import { bioAvailable, bioEnrolled, bioClear } from '../../../utils/nativeBiometric';
import {
  getMyWalletSecurityStatus,
  changeWalletPin,
  enrollWalletTotp, confirmWalletTotpEnrollment, disableWalletTotp,
  removeWhitelistedAddress,
} from '../../../firebase/walletCallables';

// ╔══════════════════════════════════════════════════════════════╗
// ║  SECURITY HUB                                                ║
// ╚══════════════════════════════════════════════════════════════╝
export function SecurityScreen() {
  const navigate = useNavigate();
  const { wallet } = useUser();
  const [status, setStatus] = useState(null);
  // P9: native biometric unlock (Android shell only).
  const [bioCan, setBioCan] = useState(false);
  const [bioOn, setBioOn] = useState(false);

  useEffect(() => {
    getMyWalletSecurityStatus().then(setStatus).catch(() => {});
    setBioCan(bioAvailable());
    setBioOn(bioEnrolled());
  }, []);

  const addrs = wallet?.whitelistedAddresses || [];

  return (
    <div style={{ maxWidth: 920, margin: '0 auto' }}>
      <div style={{ marginBottom: 24 }}>
        <div style={{ fontSize: 11, letterSpacing: '0.12em', textTransform: 'uppercase', color: WALLET_TOKENS.violetLight, fontWeight: 600 }}>Security</div>
        <h1 style={{ fontFamily: 'Syne, sans-serif', fontWeight: 700, fontSize: 30, marginTop: 8, letterSpacing: '-0.02em' }}>
          Your wallet, locked down.
        </h1>
        <p style={{ color: WALLET_TOKENS.textSecondary, fontSize: 14, marginTop: 8 }}>
          Three checks: PIN, 2FA, KYC. All three on means every move is verified.
        </p>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <SecBlock icon="lock" title="PIN"
                  status={status?.pinSet
                    ? <Pill tone="success" size="sm">Set</Pill>
                    : <Pill tone="warning" size="sm">Not set</Pill>}>
          <div style={{ display: 'flex', gap: 10, marginTop: 8 }}>
            <WalletButton variant="secondary" size="sm" onClick={() => navigate('/wallet/security/pin')}>
              {status?.pinSet ? 'Change PIN' : 'Set PIN'}
            </WalletButton>
          </div>
        </SecBlock>

        {bioCan && (
          <SecBlock icon="fingerprint" title="Fingerprint unlock"
                    status={bioOn
                      ? <Pill tone="success" size="sm">On</Pill>
                      : <Pill tone="neutral" size="sm">Off</Pill>}>
            <div style={{ fontSize: 13, color: WALLET_TOKENS.textSecondary, marginBottom: 10 }}>
              {bioOn
                ? 'Unlock your wallet with your fingerprint or face. Your PIN is encrypted in this device\'s secure hardware.'
                : 'Turn this on the next time you enter your PIN — tick "Enable fingerprint unlock".'}
            </div>
            {bioOn && (
              <WalletButton variant="secondary" size="sm" onClick={() => { bioClear(); setBioOn(false); }}>
                Turn off
              </WalletButton>
            )}
          </SecBlock>
        )}

        <SecBlock icon="shield" title="Two-factor auth"
                  status={status?.totpEnrolled
                    ? <Pill tone="success" size="sm">Active</Pill>
                    : <Pill tone="neutral" size="sm">Off</Pill>}>
          {status?.totpEnrolled && (
            <div style={{ fontSize: 13, color: WALLET_TOKENS.textSecondary, marginBottom: 10 }}>
              {fmtNum(status?.totpRecoveryCodesRemaining ?? 0)} of 10 recovery codes remaining
            </div>
          )}
          <div style={{ display: 'flex', gap: 10 }}>
            <WalletButton variant="secondary" size="sm" onClick={() => navigate('/wallet/security/totp')}>
              Manage 2FA
            </WalletButton>
          </div>
        </SecBlock>

        <SecBlock icon="account_balance_wallet" title="Whitelisted addresses"
                  status={<Pill tone="violet" size="sm">{addrs.length} of 10</Pill>}>
          <div style={{ marginTop: 8 }}>
            <WalletButton variant="secondary" size="sm" onClick={() => navigate('/wallet/security/addresses')}>
              Manage addresses
            </WalletButton>
          </div>
        </SecBlock>

        <SecBlock icon="qr_code_2" title="Deposit address"
                  status={<Pill tone="violet" size="sm">USDC on Base</Pill>}>
          <div style={{ marginTop: 8 }}>
            <WalletButton variant="secondary" size="sm" onClick={() => navigate('/wallet/security/deposit')}>
              View QR
            </WalletButton>
          </div>
        </SecBlock>
      </div>
    </div>
  );
}

function SecBlock({ icon, title, status, children }) {
  return (
    <WalletCard>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 14 }}>
        <div style={{
          width: 40, height: 40, borderRadius: 10,
          background: WALLET_TOKENS.surface2,
          display: 'grid', placeItems: 'center',
          color: WALLET_TOKENS.textSecondary,
        }}>
          <Icon name={icon} size={18} />
        </div>
        <h2 style={{ flex: 1, fontFamily: 'Syne, sans-serif', fontWeight: 700, fontSize: 18 }}>{title}</h2>
        {status}
      </div>
      {children}
    </WalletCard>
  );
}

// ╔══════════════════════════════════════════════════════════════╗
// ║  PIN CHANGE                                                  ║
// ╚══════════════════════════════════════════════════════════════╝
export function SecurityPinScreen() {
  const navigate = useNavigate();
  const [phase, setPhase] = useState('current'); // current | new | confirm | done
  const [oldPin, setOldPin] = useState('');
  const [newPin, setNewPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  const onNew = (v) => {
    if (/^(\d)\1{5}$/.test(v) || ['123456','654321','000000'].includes(v)) {
      setError('PIN too easy. Avoid repeats and obvious sequences.');
      setTimeout(() => { setNewPin(''); setError(null); }, 1500);
      return;
    }
    if (v === oldPin) {
      setError('New PIN must differ from current PIN.');
      setTimeout(() => { setNewPin(''); setError(null); }, 1500);
      return;
    }
    setPhase('confirm');
  };

  const onConfirm = async (v) => {
    if (v !== newPin) {
      setError("PINs don't match. Try again.");
      setTimeout(() => { setConfirmPin(''); setError(null); }, 1500);
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await changeWalletPin({ oldPin, newPin });
      setPhase('done');
    } catch (e) {
      setError(e?.message || 'Could not change PIN.');
      setPhase('current'); setOldPin(''); setNewPin(''); setConfirmPin('');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={{ maxWidth: 480, margin: '0 auto', textAlign: 'center' }}>
      <div style={{ textAlign: 'left' }}>
        <WalletButton variant="ghost" size="sm" icon="arrow_back"
                      onClick={() => navigate('/wallet/security')}>
          Back
        </WalletButton>
      </div>
      <div style={{ marginTop: 32 }}>
        {phase === 'current' && (
          <PinPhase title="Enter current PIN"
                    sub="Confirm it's you before we change anything."
                    value={oldPin} onChange={setOldPin}
                    onComplete={() => { setPhase('new'); }} error={error} />
        )}
        {phase === 'new' && (
          <PinPhase title="New PIN"
                    sub="Pick six digits you'll remember. Not your bank PIN."
                    value={newPin} onChange={setNewPin}
                    onComplete={onNew} error={error} />
        )}
        {phase === 'confirm' && (
          <PinPhase title="Confirm new PIN"
                    sub="Type it again, just to be sure."
                    value={confirmPin} onChange={setConfirmPin}
                    onComplete={onConfirm} error={error}
                    disabled={submitting} />
        )}
        {phase === 'done' && (
          <div>
            <div style={{
              width: 80, height: 80, margin: '0 auto 20px', borderRadius: '50%',
              background: 'rgba(34,197,94,0.14)', border: '1px solid rgba(34,197,94,0.40)',
              display: 'grid', placeItems: 'center',
            }}>
              <Icon name="check" size={36} className="text-emerald-400" />
            </div>
            <div style={{ fontFamily: 'Syne, sans-serif', fontWeight: 700, fontSize: 28 }}>
              PIN updated
            </div>
            <div style={{ color: WALLET_TOKENS.textSecondary, marginTop: 8 }}>
              Your new PIN unlocks the wallet from now on.
            </div>
            <div style={{ marginTop: 24 }}>
              <WalletButton variant="primary" onClick={() => navigate('/wallet/security')}>Done</WalletButton>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function PinPhase({ title, sub, value, onChange, onComplete, error, disabled }) {
  return (
    <div>
      <div style={{ fontFamily: 'Syne, sans-serif', fontWeight: 700, fontSize: 26, marginBottom: 8 }}>{title}</div>
      <div style={{ color: WALLET_TOKENS.textSecondary, marginBottom: 28 }}>{sub}</div>
      <PinPad value={value} onChange={onChange} onComplete={onComplete} error={!!error} disabled={disabled} />
      {error && <div style={{ marginTop: 16, color: '#FCA5A5', fontSize: 13 }}>{error}</div>}
    </div>
  );
}

// ╔══════════════════════════════════════════════════════════════╗
// ║  TOTP                                                        ║
// ╚══════════════════════════════════════════════════════════════╝
export function SecurityTotpScreen() {
  const navigate = useNavigate();
  const { requirePin, unlockToken } = useWalletUnlock();
  const [status, setStatus] = useState(null);
  const [step, setStep] = useState(null); // null | scan | verify | codes
  const [otpauth, setOtpauth] = useState(null);
  const [base32, setBase32] = useState(null);
  const [code, setCode] = useState('');
  const [recoveryCodes, setRecoveryCodes] = useState([]);
  const [error, setError] = useState(null);
  const [disableOpen, setDisableOpen] = useState(false);
  const [disableCode, setDisableCode] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const refresh = () => getMyWalletSecurityStatus().then(setStatus).catch(() => {});
  useEffect(() => { refresh(); }, []);

  const start = () => {
    requirePin(async (tok) => {
      try {
        const res = await enrollWalletTotp({ unlockToken: tok || unlockToken });
        setOtpauth(res.otpauthUrl);
        setBase32(res.base32);
        setStep('scan');
      } catch (e) { setError(e?.message); }
    });
  };

  const verify = async () => {
    setSubmitting(true); setError(null);
    try {
      const res = await confirmWalletTotpEnrollment({ code });
      setRecoveryCodes(res.recoveryCodes || []);
      setStep('codes');
      refresh();
    } catch (e) {
      setError(e?.message || 'Code is wrong or expired.');
    } finally {
      setSubmitting(false);
    }
  };

  const disable = () => {
    requirePin(async (tok) => {
      setSubmitting(true); setError(null);
      try {
        await disableWalletTotp({ code: disableCode, unlockToken: tok || unlockToken });
        setDisableOpen(false); setDisableCode(''); refresh();
      } catch (e) { setError(e?.message); }
      finally { setSubmitting(false); }
    });
  };

  // Enrolled view
  if (status?.totpEnrolled && !step) {
    return (
      <div style={{ maxWidth: 640, margin: '0 auto' }}>
        <WalletButton variant="ghost" size="sm" icon="arrow_back" onClick={() => navigate('/wallet/security')}>Back</WalletButton>
        <h1 style={{ fontFamily: 'Syne, sans-serif', fontWeight: 700, fontSize: 28, marginTop: 16, marginBottom: 20 }}>
          Two-factor auth.
        </h1>

        <WalletCard style={{
          background: 'linear-gradient(135deg, rgba(34,197,94,0.10), rgba(34,197,94,0.02))',
          border: '1px solid rgba(34,197,94,0.30)',
          marginBottom: 16,
        }}>
          <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
            <div style={{
              width: 56, height: 56, borderRadius: 14,
              background: 'rgba(34,197,94,0.18)', display: 'grid', placeItems: 'center',
              color: '#86EFAC',
            }}>
              <Icon name="shield" size={28} />
            </div>
            <div>
              <div style={{ fontFamily: 'Syne, sans-serif', fontWeight: 700, fontSize: 20 }}>2FA is active.</div>
              <div style={{ color: WALLET_TOKENS.textSecondary, fontSize: 13, marginTop: 4 }}>
                Required for withdrawals over {fmtEUR(100)}, address whitelisting, and PIN change.
              </div>
            </div>
          </div>
        </WalletCard>

        <WalletCard style={{ marginBottom: 16 }}>
          <SectionLabel>Recovery codes</SectionLabel>
          <div style={{ fontSize: 13, color: WALLET_TOKENS.textSecondary, marginBottom: 10 }}>
            {fmtNum(status?.totpRecoveryCodesRemaining ?? 0)} of 10 remaining. Each works once.
          </div>
        </WalletCard>

        <WalletCard style={{ border: '1px solid rgba(240,64,96,0.30)' }}>
          <div style={{ fontWeight: 600, color: '#FCA5A5', marginBottom: 8 }}>Disable 2FA</div>
          <div style={{ color: WALLET_TOKENS.textSecondary, fontSize: 13, marginBottom: 14 }}>
            Withdrawals over {fmtEUR(100)} will no longer require a code. Requires PIN + a current 2FA code.
          </div>
          <WalletButton variant="danger" size="sm" onClick={() => setDisableOpen(true)}>Disable 2FA</WalletButton>
        </WalletCard>

        <Modal open={disableOpen} onClose={() => setDisableOpen(false)} width={420} title="Disable 2FA">
          <div style={{ color: WALLET_TOKENS.textSecondary, fontSize: 13, marginBottom: 16 }}>
            Enter a current 6-digit code from your authenticator.
          </div>
          <input value={disableCode} onChange={(e) => setDisableCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                 placeholder="000000" inputMode="numeric"
                 style={{
                   width: '100%', padding: '14px 18px', fontSize: 22,
                   letterSpacing: '0.4em', textAlign: 'center',
                   fontFamily: 'DM Mono, monospace',
                   background: WALLET_TOKENS.surface2, color: WALLET_TOKENS.text,
                   border: `1px solid ${WALLET_TOKENS.hairlineStrong}`,
                   borderRadius: 10, outline: 'none',
                 }} />
          {error && <div style={{ marginTop: 10, color: '#FCA5A5', fontSize: 13 }}>{error}</div>}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 18 }}>
            <WalletButton variant="secondary" onClick={() => setDisableOpen(false)}>Cancel</WalletButton>
            <WalletButton variant="danger" disabled={disableCode.length !== 6 || submitting} onClick={disable}>Disable</WalletButton>
          </div>
        </Modal>
      </div>
    );
  }

  // Not enrolled OR mid-enrollment
  return (
    <div style={{ maxWidth: 560, margin: '0 auto' }}>
      <WalletButton variant="ghost" size="sm" icon="arrow_back" onClick={() => navigate('/wallet/security')}>Back</WalletButton>
      <h1 style={{ fontFamily: 'Syne, sans-serif', fontWeight: 700, fontSize: 28, marginTop: 16, marginBottom: 20 }}>
        Set up two-factor auth.
      </h1>

      {!step && (
        <WalletCard>
          <div style={{ color: WALLET_TOKENS.textSecondary, fontSize: 14, marginBottom: 20 }}>
            Three steps. About a minute. We support Google Authenticator, 1Password, Authy, Bitwarden, or any TOTP app.
          </div>
          <WalletButton variant="primary" onClick={start} iconRight="arrow_forward">Start setup</WalletButton>
          {error && <div style={{ marginTop: 12, color: '#FCA5A5', fontSize: 13 }}>{error}</div>}
        </WalletCard>
      )}

      {step === 'scan' && (
        <WalletCard>
          <div style={{ fontWeight: 600, marginBottom: 12 }}>Scan with your authenticator app.</div>
          <div style={{ display: 'grid', placeItems: 'center', marginBottom: 20 }}>
            <div style={{ width: 200, height: 200, background: '#fff', borderRadius: 12, display: 'grid', placeItems: 'center' }}>
              <img src={`https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(otpauth || '')}`}
                   width="180" height="180" alt="2FA QR" />
            </div>
          </div>
          <div style={{ fontSize: 12, color: WALLET_TOKENS.textMuted, textAlign: 'center', marginBottom: 6 }}>
            Or enter manually:
          </div>
          <div className="font-dmmono" style={{
            padding: 12, borderRadius: 8, background: WALLET_TOKENS.surface2,
            border: `1px solid ${WALLET_TOKENS.hairline}`, fontSize: 12,
            wordBreak: 'break-all', textAlign: 'center', letterSpacing: '0.05em',
          }}>{base32}</div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 18 }}>
            <WalletButton variant="ghost" onClick={() => setStep(null)}>Cancel</WalletButton>
            <WalletButton variant="primary" onClick={() => setStep('verify')} iconRight="arrow_forward">Continue</WalletButton>
          </div>
        </WalletCard>
      )}

      {step === 'verify' && (
        <WalletCard>
          <div style={{ fontWeight: 600, marginBottom: 12 }}>Enter the 6-digit code from your app.</div>
          <input value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                 placeholder="000000" inputMode="numeric" autoFocus
                 style={{
                   width: '100%', padding: '14px 18px', fontSize: 24,
                   letterSpacing: '0.4em', textAlign: 'center',
                   fontFamily: 'DM Mono, monospace',
                   background: WALLET_TOKENS.surface2, color: WALLET_TOKENS.text,
                   border: `1px solid ${WALLET_TOKENS.hairlineStrong}`,
                   borderRadius: 10, outline: 'none',
                 }} />
          {error && <div style={{ marginTop: 10, color: '#FCA5A5', fontSize: 13 }}>{error}</div>}
          <div style={{ marginTop: 18 }}>
            <WalletButton variant="primary" full disabled={code.length !== 6 || submitting} onClick={verify}>
              {submitting ? 'Verifying…' : 'Verify'}
            </WalletButton>
          </div>
        </WalletCard>
      )}

      {step === 'codes' && (
        <WalletCard>
          <Callout tone="warning" icon="warning" title="Save these now">
            Each code works once. We can't recover them. Print, store in a password manager, or download.
          </Callout>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 16 }}>
            {recoveryCodes.map((c, i) => (
              <div key={i} className="font-dmmono" style={{
                padding: '10px 14px', borderRadius: 8, fontSize: 14,
                textAlign: 'center', letterSpacing: '0.05em',
                background: WALLET_TOKENS.surface2,
                border: `1px solid ${WALLET_TOKENS.hairline}`,
              }}>{c}</div>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
            <WalletButton variant="secondary" size="sm" icon="content_copy"
                          onClick={() => navigator.clipboard?.writeText(recoveryCodes.join('\n'))}>
              Copy all
            </WalletButton>
            <WalletButton variant="secondary" size="sm" icon="download" onClick={() => downloadCodes(recoveryCodes)}>
              Download .txt
            </WalletButton>
          </div>
          <div style={{ marginTop: 22 }}>
            <WalletButton variant="primary" full onClick={() => navigate('/wallet/security')}>Done</WalletButton>
          </div>
        </WalletCard>
      )}
    </div>
  );
}

function downloadCodes(codes) {
  const text = ['VERGR Wallet — recovery codes', '====================================', ...codes].join('\n');
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = 'vergr-wallet-recovery-codes.txt';
  document.body.appendChild(a); a.click();
  document.body.removeChild(a); URL.revokeObjectURL(url);
}

// ╔══════════════════════════════════════════════════════════════╗
// ║  ADDRESSES                                                   ║
// ╚══════════════════════════════════════════════════════════════╝
export function SecurityAddressesScreen() {
  const navigate = useNavigate();
  const { wallet } = useUser();
  const { requirePin, unlockToken } = useWalletUnlock();
  const [error, setError] = useState(null);
  const addrs = wallet?.whitelistedAddresses || [];

  const remove = (address) => {
    if (!confirm('Remove this address?')) return;
    requirePin(async (tok) => {
      try { await removeWhitelistedAddress({ address, unlockToken: tok || unlockToken }); }
      catch (e) { setError(e?.message); }
    });
  };

  return (
    <div style={{ maxWidth: 760, margin: '0 auto' }}>
      <WalletButton variant="ghost" size="sm" icon="arrow_back" onClick={() => navigate('/wallet/security')}>Back</WalletButton>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginTop: 16, marginBottom: 22, gap: 16, flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ fontFamily: 'Syne, sans-serif', fontWeight: 700, fontSize: 28 }}>Whitelisted addresses.</h1>
          <p style={{ color: WALLET_TOKENS.textSecondary, marginTop: 8, fontSize: 14 }}>
            Withdrawals can only go to addresses you've whitelisted.
          </p>
        </div>
        <WalletButton variant="primary" icon="add" onClick={() => navigate('/wallet/withdraw/new-address')}>
          Add address
        </WalletButton>
      </div>

      {error && (
        <div style={{ marginBottom: 12, padding: '10px 14px', borderRadius: 10,
                      background: 'rgba(240,64,96,0.10)', border: '1px solid rgba(240,64,96,0.28)',
                      color: '#FCA5A5', fontSize: 13 }}>{error}</div>
      )}

      <WalletCard padding={8}>
        {addrs.length === 0 ? (
          <div style={{ padding: 48, textAlign: 'center', color: WALLET_TOKENS.textMuted, fontSize: 14 }}>
            <Icon name="account_balance_wallet" size={36} />
            <div style={{ marginTop: 8 }}>No whitelisted addresses yet.</div>
          </div>
        ) : addrs.map((a, i) => {
          const onCooldown = a.usableAfter && a.usableAfter > Date.now();
          return (
            <div key={a.address} style={{
              display: 'flex', alignItems: 'center', gap: 16,
              padding: 16, borderBottom: i < addrs.length - 1 ? `1px solid ${WALLET_TOKENS.hairline}` : 'none',
            }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 4 }}>
                  <span style={{ fontWeight: 500 }}>{a.label}</span>
                  <Pill tone="neutral" size="sm">Base</Pill>
                  {onCooldown && <Pill tone="warning" size="sm">Cooldown</Pill>}
                </div>
                <div className="font-dmmono" style={{ fontSize: 12, color: WALLET_TOKENS.textMuted, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {a.address}
                </div>
                {a.addedAt && (
                  <div className="font-dmmono" style={{ fontSize: 11, color: WALLET_TOKENS.textMuted, marginTop: 4 }}>
                    Added {new Date(a.addedAt).toLocaleDateString()}
                  </div>
                )}
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={() => navigator.clipboard?.writeText(a.address)} style={{
                  background: 'transparent', border: 'none', color: WALLET_TOKENS.textSecondary,
                  cursor: 'pointer', padding: 8,
                }} title="Copy"><Icon name="content_copy" size={16} /></button>
                <button onClick={() => remove(a.address)} style={{
                  background: 'transparent', border: 'none', color: '#FCA5A5',
                  cursor: 'pointer', padding: 8, fontSize: 12,
                }}>Remove</button>
              </div>
            </div>
          );
        })}
      </WalletCard>
    </div>
  );
}

// ╔══════════════════════════════════════════════════════════════╗
// ║  DEPOSIT ADDRESS                                             ║
// ╚══════════════════════════════════════════════════════════════╝
export function SecurityDepositScreen() {
  const navigate = useNavigate();
  const { profile } = useUser();
  // Per CLAUDE.md: per-user attribution via hex-encoded `vergr:{uid}` payload
  // in the tx `data` field. Until Phase 3 wires Circle webhook, we still show
  // a stable destination + the memo the user must include.
  const address = '0x4f9eb4609bbbd0133344adbf5bbdf3df0dc5d8c9'; // Sandbox hot wallet
  const memo = `vergr:${profile?.uid?.slice(0, 12) || 'pending'}`;

  return (
    <div style={{ maxWidth: 720, margin: '0 auto' }}>
      <WalletButton variant="ghost" size="sm" icon="arrow_back" onClick={() => navigate('/wallet/security')}>Back</WalletButton>
      <div style={{ marginTop: 16, marginBottom: 22 }}>
        <div style={{ fontSize: 11, letterSpacing: '0.12em', textTransform: 'uppercase', color: WALLET_TOKENS.violetLight, fontWeight: 600 }}>
          Deposit address
        </div>
        <h1 style={{ fontFamily: 'Syne, sans-serif', fontWeight: 700, fontSize: 28, marginTop: 8 }}>
          Send USDC to your wallet.
        </h1>
        <p style={{ color: WALLET_TOKENS.textSecondary, fontSize: 14, marginTop: 8 }}>
          USDC on Base only. Other networks or tokens will be lost.
        </p>
      </div>

      <div style={{ marginBottom: 16 }}>
        <Callout tone="info" icon="info" title="Most users never need this">
          Buying coins via card or bank routes through PayRam — funds reach the platform automatically. Use this screen only if you're depositing USDC from your own crypto wallet.
        </Callout>
      </div>

      <WalletCard>
        <div className="vg-walletDeposit-grid" style={{
          display: 'grid', gap: 24,
          gridTemplateColumns: '240px 1fr',
          alignItems: 'flex-start',
        }}>
          <div style={{ display: 'grid', placeItems: 'center' }}>
            <div style={{ width: 220, height: 220, background: '#fff', borderRadius: 12, display: 'grid', placeItems: 'center' }}>
              <img src={`https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(address)}`}
                   width="200" height="200" alt="Deposit QR" />
            </div>
          </div>
          <div>
            <SectionLabel>Wallet address (Base)</SectionLabel>
            <div style={{ display: 'flex', gap: 8, marginBottom: 18 }}>
              <div className="font-dmmono" style={{
                flex: 1, padding: '12px 14px', borderRadius: 10,
                background: WALLET_TOKENS.surface2, border: `1px solid ${WALLET_TOKENS.hairline}`,
                fontSize: 12, wordBreak: 'break-all',
              }}>{address}</div>
              <WalletButton variant="secondary" size="sm" icon="content_copy"
                            onClick={() => navigator.clipboard?.writeText(address)}>Copy</WalletButton>
            </div>

            <Callout tone="warning" icon="warning" title="Memo required">
              Include this memo (hex-encoded in the transaction <code>data</code> field) or your deposit can't be credited.
              <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                <div className="font-dmmono" style={{
                  flex: 1, padding: '8px 12px', borderRadius: 6,
                  background: 'rgba(0,0,0,0.30)', color: '#FCA5A5', fontSize: 12,
                }}>{memo}</div>
                <WalletButton variant="secondary" size="sm" icon="content_copy"
                              onClick={() => navigator.clipboard?.writeText(memo)}>Copy</WalletButton>
              </div>
            </Callout>
          </div>
        </div>
      </WalletCard>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginTop: 16 }} className="vg-walletDeposit-warns">
        <Callout tone="warning" icon="warning" title="Base network only">
          Ethereum mainnet, Polygon, Arbitrum, Solana = funds lost.
        </Callout>
        <Callout tone="warning" icon="warning" title="USDC only">
          USDT, ETH, any other token = funds lost.
        </Callout>
      </div>

      <style>{`
        @media (max-width: 720px) {
          .vg-walletDeposit-grid { grid-template-columns: 1fr !important; }
          .vg-walletDeposit-warns { grid-template-columns: 1fr !important; }
        }
      `}</style>
    </div>
  );
}
