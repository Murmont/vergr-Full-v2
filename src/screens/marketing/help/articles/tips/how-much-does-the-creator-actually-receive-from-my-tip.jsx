// Help center article: How much does the creator actually receive from my tip?
// Edit the text freely. Block model:
//   { p } paragraph · { h2 } heading · { list:[...] } bullets · { steps:[...] } numbered
//   { faq:[[q,a],...] } · { note } callout · { cta:[{ to, label }] } related links
// Top-level: summary (1-2 sentences, answer-first), updated (YYYY-MM-DD), body [].

export default {
  summary: "A tip is revenue VERGR earns, and VERGR pays the creator a share of it. That share starts at 50% and rises to 80% as their lifetime earnings grow. The amount is rounded down to a whole Coin, and the creator sees the net figure land in their balance.",
  updated: "2026-06-06",
  body: [
    {
      p: "Nothing is taken at the moment you send. The whole tip is revenue VERGR earns, and VERGR then pays the creator their revenue share of it."
    },
    {
      h2: "The math"
    },
    {
      list: [
        "You send a tip of N Coins.",
        "VERGR earns the tip as revenue.",
        "The creator is credited their revenue share of N, rounded down to a whole Coin.",
        "Example: tip 100 Coins, the creator gets 90. Tip 500, they get 450."
      ]
    },
    {
      h2: "Why so little is taken"
    },
    {
      p: "VERGR is built so creators keep the majority of what their audience gives them. One rate, applied once, no plan that quietly takes more, no ads skimming reach. The fee is the same whether the creator is on the free plan or Pro."
    },
    {
      note: "Your rank does not change your share. The share is set by your lifetime earnings only."
    },
    {
      faq: [
        [
          "Does the creator pay anything to receive a tip?",
          "No extra step. The creator share is applied at send time, so the figure that lands is already theirs."
        ],
        [
          "Do I pay a fee on top of my tip?",
          "No. You pay exactly the tip amount you choose, and nothing is added on top."
        ]
      ]
    },
    {
      cta: [
        {
          to: "/platform/help/what-is-the-fee-on-a-tip",
          label: "The tip fee"
        },
        {
          to: "/platform/help/how-do-i-tip-a-creator",
          label: "How to tip"
        }
      ]
    }
  ]
};
