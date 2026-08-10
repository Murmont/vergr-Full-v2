// Help center article: How do I cash out my Gems?
// Edit the text freely. Block model:
//   { p } paragraph · { h2 } heading · { list:[...] } bullets · { steps:[...] } numbered
//   { faq:[[q,a],...] } · { note } callout · { cta:[{ to, label }] } related links
// Top-level: summary (1-2 sentences, answer-first), updated (YYYY-MM-DD), body [].

export default {
  summary: "Be identity-verified, set a withdrawal address, then request a withdrawal of at least 1,000 Gems. After a 3-day hold for fraud review, it is sent to your crypto wallet. A 2% spread plus any network cost applies, and you see the exact amount before you confirm.",
  updated: "2026-06-06",
  body: [
    {
      p: "Cashing out Gems is straightforward once your account is set up for payouts. Here is the full step-by-step."
    },
    {
      h2: "One-time setup"
    },
    {
      list: [
        "Complete identity verification. It is required before any real-money payout.",
        "Add and confirm a withdrawal address (the crypto wallet you want to be paid to)."
      ]
    },
    {
      h2: "Cash out, step by step"
    },
    {
      steps: [
        "Open your wallet and go to the withdraw screen.",
        "Choose your saved withdrawal address.",
        "Enter an amount of at least 1,000 Gems.",
        "Review the fees and the exact payout amount shown.",
        "Confirm. The request enters a 3-day hold for fraud review.",
        "After the hold, it is sent in the next outbound batch and settles to your wallet."
      ]
    },
    {
      h2: "Fees"
    },
    {
      p: "A 2% platform spread applies, plus any standard network cost for the transfer. Both are reflected in the amount shown before you confirm, so there are no surprises."
    },
    {
      note: "Crypto payouts cannot be reversed. Verify your withdrawal address carefully before confirming. During the early part of the hold, you can still cancel a pending withdrawal."
    },
    {
      cta: [
        {
          to: "/platform/help/how-do-i-withdraw-my-earnings",
          label: "Withdraw earnings"
        },
        {
          to: "/platform/help/what-is-a-withdrawal-address-and-how-do-i-set-it",
          label: "Set a withdrawal address"
        },
        {
          to: "/platform/help/why-is-there-a-hold-on-my-withdrawal",
          label: "Why the hold"
        }
      ]
    }
  ]
};
