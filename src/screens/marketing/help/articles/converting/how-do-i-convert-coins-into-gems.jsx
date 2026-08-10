// Help center article: How do I convert Coins into Gems?
// Edit the text freely. Block model:
//   { p } paragraph · { h2 } heading · { list:[...] } bullets · { steps:[...] } numbered
//   { faq:[[q,a],...] } · { note } callout · { cta:[{ to, label }] } related links
// Top-level: summary (1-2 sentences, answer-first), updated (YYYY-MM-DD), body [].

export default {
  summary: "In your wallet, choose convert, pick how many Coins, and confirm. A commission applies based on your VP, from 30% down to a 15% floor at 100,000 VP. The Gems are then yours to withdraw.",
  updated: "2026-06-06",
  body: [
    {
      p: "Converting is how Coins become withdrawable. You do it in the wallet, and it only takes a few taps."
    },
    {
      h2: "How to convert"
    },
    {
      steps: [
        "Open your wallet and choose convert.",
        "Enter how many Coins you want to turn into Gems.",
        "Check the rate and the commission for your rank.",
        "Confirm. The Gems land in your wallet."
      ]
    },
    {
      h2: "The commission"
    },
    {
      p: "Converting carries a commission, and this is where your VP matters. It starts at 30% and steps down to a 15% floor at 100,000 VP. So the more you build your VP, the more you keep on every conversion."
    },
    {
      h2: "Lowering what you pay"
    },
    {
      p: "There is no trick to it: earn VP, climb the ranks, and your conversion rate improves. If you convert often, ranking up pays for itself."
    },
    {
      cta: [
        {
          to: "/platform/help/what-is-vp-vergr-points",
          label: "How VP lowers your fees"
        },
        {
          to: "/platform/help/how-do-i-withdraw-my-earnings",
          label: "Withdraw your Gems"
        }
      ]
    }
  ]
};
