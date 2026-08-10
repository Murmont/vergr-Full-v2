// Help center article: Is my VERGR wallet secure?
// Edit the text freely. Block model:
//   { p } paragraph · { h2 } heading · { list:[...] } bullets · { steps:[...] } numbered
//   { faq:[[q,a],...] } · { note } callout · { cta:[{ to, label }] } related links
// Top-level: summary (1-2 sentences, answer-first), updated (YYYY-MM-DD), body [].

export default {
  summary: "Yes. Your wallet is protected by a PIN on sensitive actions, optional two-factor authentication, and a withdrawal address whitelist so funds can only go to addresses you have approved. Combined with identity verification and short review holds on payouts, it is built so your earnings stay yours.",
  updated: "2026-06-06",
  body: [
    {
      p: "Yes, the VERGR wallet is built with several layers of protection, because it holds your earnings. No single thing is the lock, it is the combination that keeps your money safe."
    },
    {
      h2: "The protections"
    },
    {
      list: [
        "A wallet PIN that guards sensitive actions, so opening the app is not enough to move money.",
        "Two-factor authentication you can switch on for an extra layer at sign-in and on key actions.",
        "A withdrawal address whitelist, so payouts can only ever go to addresses you have added and approved yourself.",
        "Identity verification before any payout, which stops a stranger cashing out a hijacked account.",
        "A short review hold on withdrawals, giving time to catch anything suspicious before money leaves."
      ]
    },
    {
      h2: "Your part"
    },
    {
      p: "Security is a partnership. Turn on two-factor authentication, keep your PIN private, never share codes or your password with anyone (VERGR will never ask), and double-check a withdrawal address before confirming, since crypto payouts cannot be reversed."
    },
    {
      cta: [
        {
          to: "/platform/help/how-do-i-set-up-two-factor-authentication",
          label: "Set up 2FA"
        },
        {
          to: "/platform/help/how-do-i-set-up-my-wallet-pin",
          label: "Set up your PIN"
        }
      ]
    }
  ]
};
