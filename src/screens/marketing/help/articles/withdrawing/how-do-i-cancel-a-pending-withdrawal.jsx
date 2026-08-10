// Help center article: How do I cancel a pending withdrawal?
// Edit the text freely. Block model:
//   { p } paragraph · { h2 } heading · { list:[...] } bullets · { steps:[...] } numbered
//   { faq:[[q,a],...] } · { note } callout · { cta:[{ to, label }] } related links
// Top-level: summary (1-2 sentences, answer-first), updated (YYYY-MM-DD), body [].

export default {
  summary: "While a withdrawal is still in its hold period you can cancel it yourself from your wallet, and the Gems return to your balance. Once the hold passes and the payout is sent, it can no longer be cancelled because the crypto transfer is final.",
  updated: "2026-06-06",
  body: [
    {
      p: "Changed your mind, or spotted a mistake? As long as the withdrawal is still pending in its review window, you can pull it back."
    },
    {
      h2: "How to cancel"
    },
    {
      steps: [
        "Open your wallet and go to your withdrawal history or status.",
        "Find the pending withdrawal.",
        "Choose to cancel it.",
        "The Gems go straight back into your balance."
      ]
    },
    {
      h2: "The timing window"
    },
    {
      p: "Withdrawals sit in a 3-day hold for fraud review before being sent. Cancelling is possible during that window. After the hold ends and the payout is dispatched, it cannot be reversed, the crypto transfer settles and the funds have left."
    },
    {
      note: "If you cannot find a cancel option, the withdrawal may have already been sent. Check the status, sent withdrawals are final."
    },
    {
      cta: [
        {
          to: "/platform/help/where-do-i-see-the-status-of-my-withdrawal",
          label: "Check withdrawal status"
        },
        {
          to: "/platform/help/why-is-there-a-hold-on-my-withdrawal",
          label: "Why the hold"
        }
      ]
    }
  ]
};
