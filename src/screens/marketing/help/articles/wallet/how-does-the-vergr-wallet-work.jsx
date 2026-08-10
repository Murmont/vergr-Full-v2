// Help center article: How does the VERGR wallet work?
// Edit the text freely. Block model:
//   { p } paragraph · { h2 } heading · { list:[...] } bullets · { steps:[...] } numbered
//   { faq:[[q,a],...] } · { note } callout · { cta:[{ to, label }] } related links
// Top-level: summary (1-2 sentences, answer-first), updated (YYYY-MM-DD), body [].

export default {
  summary: "The wallet is where your Coins and Gems live. You buy and earn Coins, spend them on tips, tournaments, and boosts, and convert them to Gems to withdraw. It has its own section with a PIN on sensitive actions, a full transaction history, and the convert and withdraw tools.",
  updated: "2026-06-06",
  body: [
    {
      p: "The wallet is the money hub of VERGR. Everything to do with Coins and Gems happens here, and it has its own dedicated section so it stays clean and secure."
    },
    {
      h2: "What is inside"
    },
    {
      list: [
        "Your Coin and Gem balances at a glance.",
        "Buy Coins through the Shop.",
        "Convert Coins into Gems.",
        "Withdraw Gems to a crypto wallet address.",
        "A full transaction history you can filter and get receipts from.",
        "Security settings, including your PIN and withdrawal addresses."
      ]
    },
    {
      h2: "How the flow works"
    },
    {
      p: "You add Coins by buying them or earning them through tips and competition. You spend Coins on tips, tournament entries, boosts, and subscriptions. When you want real money out, you convert Coins to Gems and withdraw. Gems are the only side that cashes out."
    },
    {
      h2: "Security"
    },
    {
      p: "Because it holds your money, the wallet asks for your PIN on sensitive actions, supports two-factor authentication, and only sends withdrawals to addresses you have whitelisted. When you are done, there is an exit option that takes you back to the main app."
    },
    {
      cta: [
        {
          to: "/platform/help/how-do-i-convert-coins-into-gems",
          label: "Convert Coins to Gems"
        },
        {
          to: "/platform/help/how-do-i-see-my-transaction-history",
          label: "Transaction history"
        }
      ]
    }
  ]
};
