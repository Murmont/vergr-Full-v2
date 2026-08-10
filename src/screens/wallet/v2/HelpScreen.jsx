// Help (v2) — ports the design's HelpScreen.

import { useState } from 'react';
import { WalletCard, WalletButton, SectionLabel, WALLET_TOKENS } from '../../../components/wallet/primitives';
import Icon from '../../../components/Icon';

const FAQ = [
  { q: 'Why is there a 3-day hold on withdrawals?',
    a: "It gives you time to cancel if anyone ever uses your session without permission. Industry standard. Cancellable for one hour after submission." },
  { q: 'How do gems differ from coins?',
    a: "Coins are the spend currency. You buy them to tip, join tournaments, support creators. Gems are the earn currency. They cash out." },
  { q: 'What is my conversion rate?',
    a: "It depends on your VP level. Rookie (L1) keeps 70% of converted value. Each level up keeps more. L100 keeps 90%." },
  { q: 'Can I withdraw to any wallet?',
    a: "Any USDC-on-Base address. We support most major wallets (MetaMask, Coinbase, Rainbow, Trust). You whitelist addresses first, then a 24-hour cooldown protects you from rushed mistakes." },
  { q: 'Where do my deposits go?',
    a: "Reserves are split across hot (≤10%), warm (~30%), and cold (~60%) wallets. Hot is Circle MPC custody; warm + cold are self-sovereign multisig Safes. Audited monthly via Proof of Reserves." },
  { q: 'I lost my PIN — what now?',
    a: "PIN reset requires re-running KYC + a 7-day waiting period. We can't reset it from a password reset alone — that's by design, so an email compromise can't drain the wallet." },
];

export default function HelpScreen() {
  return (
    <div style={{ maxWidth: 720, margin: '0 auto' }}>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontFamily: 'Syne, sans-serif', fontWeight: 700, fontSize: 30, letterSpacing: '-0.02em' }}>
          Help &amp; support.
        </h1>
        <p style={{ color: WALLET_TOKENS.textSecondary, fontSize: 14, marginTop: 8 }}>
          Real humans, real answers. Most questions covered below.
        </p>
      </div>

      <WalletCard style={{ marginBottom: 16 }}>
        <SectionLabel>Talk to support</SectionLabel>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <WalletButton variant="primary" iconRight="arrow_forward" onClick={() => window.location.href = 'mailto:support@vergr.app'}>
            Open a ticket
          </WalletButton>
          <WalletButton variant="secondary">Live chat</WalletButton>
        </div>
        <div style={{ color: WALLET_TOKENS.textMuted, fontSize: 13, marginTop: 12 }}>
          Average response under 4 hours. Faster for KYC L2+.
        </div>
      </WalletCard>

      <WalletCard padding={8}>
        {FAQ.map((item, i) => <FaqItem key={i} {...item} last={i === FAQ.length - 1} />)}
      </WalletCard>
    </div>
  );
}

function FaqItem({ q, a, last }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ borderBottom: last ? '0' : `1px solid ${WALLET_TOKENS.hairline}` }}>
      <button onClick={() => setOpen(o => !o)} style={{
        width: '100%', padding: 16, textAlign: 'left',
        background: 'transparent', border: 'none', cursor: 'pointer',
        color: WALLET_TOKENS.text,
        display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12,
      }}>
        <span style={{ fontWeight: 500, fontSize: 14 }}>{q}</span>
        <Icon name="expand_more" size={18}
              style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s', color: WALLET_TOKENS.textMuted }} />
      </button>
      {open && (
        <div style={{ padding: '0 16px 16px', color: WALLET_TOKENS.textSecondary, fontSize: 14, lineHeight: 1.65 }}>
          {a}
        </div>
      )}
    </div>
  );
}
