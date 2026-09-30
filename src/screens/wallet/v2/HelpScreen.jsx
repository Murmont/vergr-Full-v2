// Help (v2) — ports the design's HelpScreen.

import { useState } from 'react';
import { WalletCard, WalletButton, SectionLabel, WALLET_TOKENS } from '../../../components/wallet/primitives';
import Icon from '../../../components/Icon';

const FAQ = [
  { q: 'Can I cash out my coins?',
    a: "No. Coins are a licence to use VERGR features: they have no cash value and cannot be withdrawn, converted or transferred. Creators are paid a share of the revenue their content earns, automatically, on VERGR's schedule." },
  { q: 'What can I spend coins on?',
    a: "Tipping creators, creator memberships, access to paid live streams, unlocking paid content, event tickets, and boosting your own stream." },
  { q: 'How do creators get paid?',
    a: "Creators never request a payout. VERGR works out the revenue share it owes and pays it automatically on a schedule, monthly to begin with, once the balance reaches $100. Identity verification and an account at least 30 days old are required first." },
  { q: 'Can I get a refund on a coin purchase?',
    a: "Coins are delivered immediately, so purchases are non-refundable once they land. Erroneous, duplicate or unauthorised charges can be refunded: write to support@vergr.app within 30 days." },
  { q: 'I lost my PIN — what now?',
    a: "Write to support@vergr.app from the email on your account. A PIN is never reset by a password reset alone, so somebody who gets into your email still cannot take over your wallet." },
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
          {/* Was "Live chat", a button with no handler: there is no chat. */}
          <WalletButton variant="secondary" onClick={() => { window.location.href = '/help'; }}>Help Center</WalletButton>
        </div>
        <div style={{ color: WALLET_TOKENS.textMuted, fontSize: 13, marginTop: 12 }}>
          We answer at support@vergr.app.
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
