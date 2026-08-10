// PinUnlockModal — the global modal that pops on requirePin() when the
// in-memory unlock token is missing or stale. Mounted once in WalletLayout.
//
// Submits to verifyWalletPin → stores the returned HMAC token in
// WalletUnlockContext + resolves the pending callback.

import { useEffect, useState } from 'react';
import { Modal, PinPad, WALLET_TOKENS, WalletButton } from './primitives';
import { useWalletUnlock } from '../../context/WalletUnlockContext';
import { verifyWalletPin } from '../../firebase/walletCallables';
import { bioAvailable, bioEnrolled, bioEnroll, bioUnlock } from '../../utils/nativeBiometric';
import Icon from '../Icon';

export default function PinUnlockModal() {
  const { _pinPromptOpen, _resolveUnlock, _cancelUnlock } = useWalletUnlock();
  const [pin, setPin] = useState('');
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  // P9: native biometric unlock (Android shell only).
  const [bioReady, setBioReady] = useState(false);   // available + already enrolled
  const [bioOffer, setBioOffer] = useState(false);    // available but not enrolled → offer
  const [rememberBio, setRememberBio] = useState(true);

  // Reset state every time the modal opens
  useEffect(() => {
    if (_pinPromptOpen) {
      setPin(''); setError(null); setSubmitting(false);
      const avail = bioAvailable();
      const enrolled = avail && bioEnrolled();
      setBioReady(enrolled);
      setBioOffer(avail && !enrolled);
      setRememberBio(true);
      // If enrolled, prompt the fingerprint straight away (TikTok/WhatsApp feel).
      if (enrolled) tryBiometric();
    }
  }, [_pinPromptOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  const tryBiometric = async () => {
    const storedPin = await bioUnlock('wallet_pin', 'Unlock your VERGR wallet');
    if (storedPin) submit(storedPin, false);
  };

  const submit = async (value, allowEnroll = true) => {
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await verifyWalletPin({ pin: value });
      if (res?.unlockToken) {
        // Opt-in: remember this verified PIN behind biometric for next time.
        if (allowEnroll && bioOffer && rememberBio) {
          bioEnroll(value).catch(() => {});
        }
        _resolveUnlock(res.unlockToken);
      } else {
        throw new Error('Server did not return an unlock token.');
      }
    } catch (e) {
      // Surface server-side error messages — they already include lockout
      // countdown text ("Wrong PIN. Locked for 3 minutes." etc).
      const msg = e?.message?.replace(/^[a-z\-]+:\s*/i, '') || 'Could not verify PIN. Try again.';
      setError(msg);
      setPin('');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal open={_pinPromptOpen} onClose={_cancelUnlock} width={420}>
      <div style={{ textAlign: 'center', padding: '8px 4px 4px' }}>
        <div style={{
          width: 56, height: 56, margin: '0 auto 16px',
          borderRadius: '50%', display: 'grid', placeItems: 'center',
          background: 'rgba(123,31,255,0.10)',
          border: `1px solid rgba(123,31,255,0.30)`,
          color: WALLET_TOKENS.violetLight,
        }}>
          <Icon name="lock" size={26} />
        </div>
        <div style={{ fontFamily: 'Syne, sans-serif', fontWeight: 700, fontSize: 22, marginBottom: 6 }}>
          Unlock your wallet
        </div>
        <div style={{ color: WALLET_TOKENS.textSecondary, fontSize: 13, marginBottom: 24 }}>
          Enter your 6-digit wallet PIN to continue.
        </div>
        {bioReady && (
          <button
            onClick={tryBiometric}
            disabled={submitting}
            style={{
              display: 'flex', alignItems: 'center', gap: 8, margin: '0 auto 18px',
              padding: '10px 18px', borderRadius: 12, cursor: 'pointer',
              background: 'rgba(180, 79, 255,0.10)', border: '1px solid rgba(180, 79, 255,0.30)',
              color: WALLET_TOKENS.cyan || '#B44FFF', fontWeight: 700, fontSize: 14,
            }}>
            <Icon name="fingerprint" size={20} /> Unlock with fingerprint
          </button>
        )}
        <PinPad value={pin} onChange={setPin} onComplete={submit} error={!!error} disabled={submitting} />
        {bioOffer && (
          <label style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            marginTop: 16, color: WALLET_TOKENS.textSecondary, fontSize: 13, cursor: 'pointer',
          }}>
            <input type="checkbox" checked={rememberBio} onChange={(e) => setRememberBio(e.target.checked)} />
            <Icon name="fingerprint" size={16} /> Enable fingerprint unlock next time
          </label>
        )}
        {error && (
          <div style={{
            marginTop: 18, padding: '10px 14px', borderRadius: 10,
            background: 'rgba(240,64,96,0.10)',
            border: '1px solid rgba(240,64,96,0.28)',
            color: '#FCA5A5', fontSize: 13,
          }}>{error}</div>
        )}
        <div style={{ marginTop: 20, display: 'flex', justifyContent: 'center', gap: 8 }}>
          <WalletButton variant="ghost" size="sm" onClick={_cancelUnlock}>Cancel</WalletButton>
        </div>
      </div>
    </Modal>
  );
}
