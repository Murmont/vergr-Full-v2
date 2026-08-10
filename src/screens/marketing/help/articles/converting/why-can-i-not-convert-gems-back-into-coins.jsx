// Help center article: Why can I not convert Gems back into Coins?
// Edit the text freely. Block model:
//   { p } paragraph · { h2 } heading · { list:[...] } bullets · { steps:[...] } numbered
//   { faq:[[q,a],...] } · { note } callout · { cta:[{ to, label }] } related links
// Top-level: summary (1-2 sentences, answer-first), updated (YYYY-MM-DD), body [].

export default {
  summary: "Conversion only runs one way, Coins into Gems, because Gems are your real-money payout balance and Coins are the in-app spending balance. Once you have converted to Gems, the intended next step is to withdraw. If you want more Coins, you buy them, which keeps the in-app side and the cash-out side cleanly separated.",
  updated: "2026-06-06",
  body: [
    {
      p: "Coins flow into Gems, but not the other way around. That is by design, and it keeps the economy clear and safe."
    },
    {
      h2: "Two balances, two jobs"
    },
    {
      p: "Coins are for everything you do inside VERGR: entries, tips, boosts, memberships. Gems are the one thing you cash out. Once Coins become Gems, they have effectively moved into the payout lane, where they wait for you to withdraw. Letting them flow back would blur that line and undo the safety structure around real money."
    },
    {
      h2: "What to do instead"
    },
    {
      list: [
        "Want to keep spending in-app? Buy Coins. That is the supply side of the in-app balance.",
        "Want cash? Withdraw your Gems once verified, the minimum is 1,000 Gems.",
        "Not sure how much to convert? Only convert what you intend to cash out, and leave the rest as Coins for spending."
      ]
    },
    {
      h2: "Convert thoughtfully"
    },
    {
      p: "Because the direction is one-way and a commission applies, it is worth converting in deliberate amounts rather than back and forth. Your exact rate shows in the wallet before you confirm, so you always know what you are getting."
    },
    {
      cta: [
        {
          to: "/platform/help/how-do-i-convert-coins-into-gems",
          label: "How to convert"
        },
        {
          to: "/platform/help/how-do-i-buy-vc-coins",
          label: "Buy Coins"
        },
        {
          to: "/platform/help/how-do-i-withdraw-my-earnings",
          label: "Withdraw Gems"
        }
      ]
    }
  ]
};
