// Help center article: Is my VERGR wallet secure?
// Edit the text freely. Block model:
//   { p } paragraph · { h2 } heading · { list:[...] } bullets · { steps:[...] } numbered
//   { faq:[[q,a],...] } · { note } callout · { cta:[{ to, label }] } related links
// Top-level: summary (1-2 sentences, answer-first), updated (YYYY-MM-DD), body [].

export default {
  summary: "Yes. Your wallet is protected by a PIN on sensitive actions and optional two-factor authentication. Combined with identity verification and scheduled payouts, it is built so your earnings stay yours.",
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
        "Creator payments that only ever go to payout details you set up and verified yourself.",
        "Identity verification before any payout, which stops a stranger being paid from a hijacked account.",
        "A scheduled payout run, giving time to catch anything suspicious before money leaves."
      ]
    },
    {
      h2: "Your part"
    },
    {
      p: "Security is a partnership. Turn on two-factor authentication, keep your PIN private, and never share codes or your password with anyone (VERGR will never ask)."
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
