// Help center article: Where do I see the status of my withdrawal?
// Edit the text freely. Block model:
//   { p } paragraph · { h2 } heading · { list:[...] } bullets · { steps:[...] } numbered
//   { faq:[[q,a],...] } · { note } callout · { cta:[{ to, label }] } related links
// Top-level: summary (1-2 sentences, answer-first), updated (YYYY-MM-DD), body [].

export default {
  summary: "In your wallet. Open the withdraw or transaction history section and your withdrawal shows its current state, from pending through the hold, to sent. You can track it the whole way without contacting anyone.",
  updated: "2026-06-06",
  body: [
    {
      p: "There is no guessing about where your money is. Your wallet tracks every withdrawal through each stage."
    },
    {
      h2: "Where to look"
    },
    {
      steps: [
        "Open your wallet.",
        "Go to your withdrawal history or transaction history.",
        "Find the withdrawal and read its status."
      ]
    },
    {
      h2: "What the statuses mean"
    },
    {
      list: [
        "Pending or on hold: the request is in its 3-day fraud-review window. You can still cancel it here.",
        "Processing: the hold has passed and it is queued in the next outbound batch.",
        "Sent: the crypto transfer has been dispatched and settles on the network. This is final."
      ]
    },
    {
      h2: "If something looks off"
    },
    {
      p: "If a withdrawal is taking longer than expected, it may be under additional review. That is a safety step, not a problem with your account. If you are unsure, reach out to support with the withdrawal details."
    },
    {
      cta: [
        {
          to: "/platform/help/how-long-does-a-withdrawal-take",
          label: "Withdrawal timing"
        },
        {
          to: "/platform/help/why-was-my-withdrawal-put-under-review",
          label: "Why a review happens"
        }
      ]
    }
  ]
};
