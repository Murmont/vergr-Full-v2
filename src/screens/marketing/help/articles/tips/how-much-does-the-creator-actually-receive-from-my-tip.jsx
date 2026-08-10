// Help center article: How much does the creator actually receive from my tip?
// Edit the text freely. Block model:
//   { p } paragraph · { h2 } heading · { list:[...] } bullets · { steps:[...] } numbered
//   { faq:[[q,a],...] } · { note } callout · { cta:[{ to, label }] } related links
// Top-level: summary (1-2 sentences, answer-first), updated (YYYY-MM-DD), body [].

export default {
  summary: "The creator keeps 90% of every tip. VERGR takes a flat 10% fee, the same for everyone on every plan, so if you tip 100 Coins the creator receives 90. The amount is rounded down to a whole Coin, and the creator sees the net figure land in their balance.",
  updated: "2026-06-06",
  body: [
    {
      p: "When you tip, the creator gets the vast majority. The platform fee is a flat 10%, and that is the entire cut, no hidden extras."
    },
    {
      h2: "The math"
    },
    {
      list: [
        "You send a tip of N Coins.",
        "VERGR takes 10%.",
        "The creator receives 90% of N, rounded down to a whole Coin.",
        "Example: tip 100 Coins, the creator gets 90. Tip 500, they get 450."
      ]
    },
    {
      h2: "Why so little is taken"
    },
    {
      p: "VERGR is built so creators keep what their audience gives them. A flat 10% is deliberately simple and low, no rising tiers, no plan that quietly takes more, no ads skimming reach. The fee is the same whether the creator is on the free plan or Pro."
    },
    {
      note: "The 10% tip fee does not change with rank. Rank only affects the commission on converting Coins to Gems, which is a separate step."
    },
    {
      faq: [
        [
          "Does the creator pay anything to receive a tip?",
          "No extra step. The 10% is already taken at send time, so the figure that lands in their balance is theirs to keep, spend, or convert."
        ],
        [
          "Do I pay a fee on top of my tip?",
          "No. You pay exactly the tip amount you choose. The 10% comes out of that amount, it is not added on top."
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
