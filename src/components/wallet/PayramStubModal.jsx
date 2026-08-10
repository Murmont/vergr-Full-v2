// PayramStubModal — functional placeholder shown when the user attempts
// any PayRam-bound flow in Session 1 (Buy → "Continue to PayRam", Withdraw
// bank tab → "Continue to PayRam"). PayRam wiring lands in the next
// session; do NOT swap in any dead processor (MoonPay/Cryptomus/Tebex/
// NOWPayments/etc.) as a "fallback".

import { Modal, WALLET_TOKENS, WalletButton } from './primitives';
import Icon from '../Icon';

export default function PayramStubModal({ open, onClose, context = 'buy' }) {
  const ctx = context === 'withdraw'
    ? {
        title: 'Bank withdrawals: coming next session',
        body: 'We\'re wiring PayRam\'s off-ramp to send EUR to your bank. Until that lands you can still withdraw to a self-custody crypto wallet on Base.',
      }
    : {
        title: 'Card checkout: coming next session',
        body: 'Buying coins by card goes through PayRam\'s embedded onramp. The integration lands in the next session. Hang tight.',
      };
  return (
    <Modal open={open} onClose={onClose} width={460}>
      <div style={{ textAlign: 'center' }}>
        <div style={{
          width: 60, height: 60, margin: '0 auto 18px',
          borderRadius: '50%', display: 'grid', placeItems: 'center',
          background: 'rgba(123,31,255,0.10)',
          border: `1px solid rgba(123,31,255,0.30)`,
          color: WALLET_TOKENS.violetLight,
        }}>
          <Icon name="schedule" size={28} />
        </div>
        <div style={{ fontFamily: 'Syne, sans-serif', fontWeight: 700, fontSize: 22, marginBottom: 10 }}>
          {ctx.title}
        </div>
        <div style={{
          color: WALLET_TOKENS.textSecondary, fontSize: 14,
          lineHeight: 1.55, maxWidth: 360, margin: '0 auto 24px',
        }}>{ctx.body}</div>
        <WalletButton variant="primary" onClick={onClose}>Got it</WalletButton>
      </div>
    </Modal>
  );
}
