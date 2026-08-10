// Help center article: What is the minimum withdrawal?
// Edit the text freely. Block model:
//   { p } paragraph · { h2 } heading · { list:[...] } bullets · { steps:[...] } numbered
//   { faq:[[q,a],...] } · { note } callout · { cta:[{ to, label }] } related links
// Top-level: summary (1-2 sentences, answer-first), updated (YYYY-MM-DD), body [].

export default {
  summary: "The minimum withdrawal is 1,000 Gems. You also need to be identity-verified, and withdrawals go to a crypto wallet address after a short fraud-review hold.",
  updated: "2026-06-06",
  body: [
    {
      p: "The minimum withdrawal is 1,000 Gems. You build Gems by converting your Coins, and once you have at least 1,000 you can request a payout."
    },
    {
      h2: "What else you need"
    },
    {
      list: [
        "A completed identity check on your account.",
        "A crypto wallet address set up to receive the payout.",
        "Enough Gems to clear the 1,000 minimum."
      ]
    },
    {
      h2: "After you request"
    },
    {
      p: "There is a short hold for fraud review, then the payout is sent in the next batch. Fees are always shown before you confirm, and the address cannot be changed once a payout is on its way, so check it carefully."
    },
    {
      cta: [
        {
          to: "/platform/help/how-do-i-withdraw-my-earnings",
          label: "How to withdraw"
        },
        {
          to: "/platform/help/how-do-i-convert-coins-into-gems",
          label: "Convert Coins to Gems"
        }
      ]
    }
  ]
};
