// New Address (v2) — ports design's NewAddressScreen. Calls
// addWhitelistedAddress callable (PIN-gated server-side + TOTP if enrolled).

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useWalletUnlock } from '../../../context/WalletUnlockContext';
import {
  WalletCard, WalletButton, Callout, SectionLabel,
  Modal, WALLET_TOKENS,
} from '../../../components/wallet/primitives';
import { addWhitelistedAddress, getMyWalletSecurityStatus } from '../../../firebase/walletCallables';
import Icon from '../../../components/Icon';
import { useEffect } from 'react';

// Supported wallets on Base. EVM-compatible only — Phantom etc. are Solana
// and excluded. "Other" lets the user name their own custom wallet.
const WALLET_TYPES = [
  { id: 'coinbase',  name: 'Coinbase Wallet' },
  { id: 'metamask',  name: 'MetaMask' },
  { id: 'rainbow',   name: 'Rainbow' },
  { id: 'trust',     name: 'Trust Wallet' },
  { id: 'ledger',    name: 'Ledger' },
  { id: 'trezor',    name: 'Trezor' },
  { id: 'rabby',     name: 'Rabby' },
  { id: 'safe',      name: 'Safe (Gnosis Safe)' },
  { id: 'exchange',  name: 'Exchange wallet' },
  { id: 'other',     name: 'Other (custom)' },
];

export default function NewAddressScreen() {
  const navigate = useNavigate();
  const { requirePin, unlockToken } = useWalletUnlock();
  const [address, setAddress] = useState('');
  const [walletType, setWalletType] = useState('coinbase');
  const [customName, setCustomName] = useState('');
  const [totp, setTotp] = useState('');
  const [needsTotp, setNeedsTotp] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [done, setDone] = useState(null);

  useEffect(() => {
    getMyWalletSecurityStatus().then(s => setNeedsTotp(!!s?.totpEnrolled)).catch(() => {});
  }, []);

  // Compose the label sent to the server: for known wallets it's just the name;
  // for "other" the user provides their own. Capped at 40 chars by the server.
  const isOther = walletType === 'other';
  const typeName = WALLET_TYPES.find(w => w.id === walletType)?.name || 'Wallet';
  const label = (isOther ? customName.trim() : typeName).slice(0, 40);

  const valid = /^0x[a-fA-F0-9]{40}$/.test(address);
  const labelOK = label.length >= 1 && label.length <= 40;
  const totpOK = !needsTotp || /^\d{6}$/.test(totp);
  const formOK = valid && labelOK && totpOK && !submitting;

  const submit = () => {
    requirePin(async (tok) => {
      setSubmitting(true);
      setError(null);
      try {
        const res = await addWhitelistedAddress({
          address, label, totpCode: needsTotp ? totp : undefined,
          unlockToken: tok || unlockToken,
        });
        setDone(res);
      } catch (e) {
        setError(e?.message || 'Could not add address. Try again.');
      } finally {
        setSubmitting(false);
      }
    });
  };

  return (
    <div style={{ maxWidth: 640, margin: '0 auto' }}>
      <WalletButton variant="ghost" size="sm" icon="arrow_back"
                    onClick={() => navigate('/wallet/withdraw')}>
        Back to withdraw
      </WalletButton>
      <div style={{ marginTop: 16, marginBottom: 24 }}>
        <div style={{ fontSize: 11, letterSpacing: '0.12em', textTransform: 'uppercase', color: WALLET_TOKENS.violetLight, fontWeight: 600 }}>
          New whitelisted address
        </div>
        <h1 style={{ fontFamily: 'Syne, sans-serif', fontWeight: 700, fontSize: 28, marginTop: 8, letterSpacing: '-0.02em' }}>
          Add a withdrawal address.
        </h1>
        <p style={{ color: WALLET_TOKENS.textSecondary, fontSize: 14, marginTop: 8 }}>
          A 24-hour cooldown protects you from rushed mistakes. Send a 1-gem test before larger amounts.
        </p>
      </div>

      <WalletCard>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          <Field label="Network" help="Only Base is supported right now. Other networks are coming.">
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '12px 14px', borderRadius: 10,
              background: WALLET_TOKENS.surface2,
              border: `1px solid ${WALLET_TOKENS.hairline}`, fontSize: 13,
            }}>
              <span>Base (USDC)</span>
              <Icon name="lock" size={14} className="text-zinc-500" />
            </div>
          </Field>

          <Field label="Wallet address"
                 error={address && !valid ? "That doesn't look like a valid 0x address." : null}
                 success={valid ? 'Valid address.' : null}>
            <div style={{ position: 'relative' }}>
              <input value={address} onChange={(e) => setAddress(e.target.value.trim())}
                placeholder="0x..."
                style={{
                  width: '100%', padding: '12px 40px 12px 14px',
                  fontFamily: 'DM Mono, monospace', fontSize: 13,
                  background: WALLET_TOKENS.surface2,
                  border: `1px solid ${WALLET_TOKENS.hairlineStrong}`,
                  borderRadius: 10, color: WALLET_TOKENS.text, outline: 'none',
                }} />
              {address && (
                <div style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)' }}>
                  <Icon name={valid ? 'check_circle' : 'cancel'} size={18}
                        className={valid ? 'text-emerald-400' : 'text-rose-400'} />
                </div>
              )}
            </div>
          </Field>

          <Field label="Wallet type" help="Pick the app or hardware wallet you'll receive USDC into.">
            <select value={walletType}
                    onChange={(e) => setWalletType(e.target.value)}
                    style={{
                      width: '100%', padding: '12px 14px', fontSize: 13,
                      background: WALLET_TOKENS.surface2,
                      border: `1px solid ${WALLET_TOKENS.hairlineStrong}`,
                      borderRadius: 10, color: WALLET_TOKENS.text, outline: 'none',
                      appearance: 'none',
                      backgroundImage: `linear-gradient(45deg, transparent 50%, ${WALLET_TOKENS.textMuted} 50%), linear-gradient(135deg, ${WALLET_TOKENS.textMuted} 50%, transparent 50%)`,
                      backgroundPosition: 'calc(100% - 18px) 18px, calc(100% - 13px) 18px',
                      backgroundSize: '5px 5px',
                      backgroundRepeat: 'no-repeat',
                      paddingRight: 36,
                    }}>
              {WALLET_TYPES.map(w => (
                <option key={w.id} value={w.id}>{w.name}</option>
              ))}
            </select>
          </Field>

          {isOther && (
            <Field label="Custom name" help={`${customName.length}/40`}>
              <input value={customName}
                     onChange={(e) => setCustomName(e.target.value.slice(0, 40))}
                     placeholder="e.g. My hardware wallet"
                     maxLength={40}
                     style={{
                       width: '100%', padding: '12px 14px', fontSize: 13,
                       background: WALLET_TOKENS.surface2,
                       border: `1px solid ${WALLET_TOKENS.hairlineStrong}`,
                       borderRadius: 10, color: WALLET_TOKENS.text, outline: 'none',
                     }} />
            </Field>
          )}

          {needsTotp && (
            <Field label="2FA code">
              <input value={totp}
                onChange={(e) => setTotp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder="000000"
                inputMode="numeric"
                style={{
                  width: '100%', padding: '14px 18px',
                  fontSize: 20, letterSpacing: '0.4em', textAlign: 'center',
                  fontFamily: 'DM Mono, monospace',
                  background: WALLET_TOKENS.surface2,
                  border: `1px solid ${WALLET_TOKENS.hairlineStrong}`,
                  borderRadius: 10, color: WALLET_TOKENS.text, outline: 'none',
                }} />
            </Field>
          )}
        </div>

        <div style={{ marginTop: 22 }}>
          <Callout tone="info" icon="info" title="What happens next">
            We add the address with a 24-hour cooldown. Send a 1-gem test before any larger withdrawal — industry-standard safety net.
          </Callout>
        </div>

        {error && (
          <div style={{
            marginTop: 14, padding: '10px 14px', borderRadius: 10,
            background: 'rgba(240,64,96,0.10)', border: '1px solid rgba(240,64,96,0.28)',
            color: '#FCA5A5', fontSize: 13,
          }}>{error}</div>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 22 }}>
          <WalletButton variant="secondary" onClick={() => navigate('/wallet/withdraw')}>Cancel</WalletButton>
          <WalletButton variant="primary" disabled={!formOK} onClick={submit} iconRight="arrow_forward">
            {submitting ? 'Adding…' : 'Add address'}
          </WalletButton>
        </div>
      </WalletCard>

      <Modal open={!!done} onClose={() => { setDone(null); navigate('/wallet/withdraw'); }} width={460}>
        <div style={{ textAlign: 'center' }}>
          <div style={{
            width: 64, height: 64, margin: '0 auto 16px',
            borderRadius: '50%', display: 'grid', placeItems: 'center',
            background: 'rgba(34,197,94,0.14)',
            border: '1px solid rgba(34,197,94,0.40)',
          }}>
            <Icon name="check" size={30} className="text-emerald-400" />
          </div>
          <div style={{ fontFamily: 'Syne, sans-serif', fontWeight: 700, fontSize: 22, marginBottom: 8 }}>
            Address added
          </div>
          <div style={{ color: WALLET_TOKENS.textSecondary, fontSize: 13, lineHeight: 1.55, marginBottom: 18 }}>
            Usable in 24 hours. We'll let you know when the cooldown clears.
          </div>
          <WalletButton variant="primary" onClick={() => navigate('/wallet/withdraw')}>Done</WalletButton>
        </div>
      </Modal>
    </div>
  );
}

function Field({ label, children, help, error, success }) {
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
        <label style={{ fontSize: 12, color: WALLET_TOKENS.textMuted, fontWeight: 600 }}>{label}</label>
        {help && <span style={{ fontSize: 11, color: WALLET_TOKENS.textMuted }}>{help}</span>}
      </div>
      {children}
      {error && <div style={{ fontSize: 12, color: '#FCA5A5', marginTop: 4 }}>{error}</div>}
      {success && <div style={{ fontSize: 12, color: '#86EFAC', marginTop: 4 }}>{success}</div>}
    </div>
  );
}
