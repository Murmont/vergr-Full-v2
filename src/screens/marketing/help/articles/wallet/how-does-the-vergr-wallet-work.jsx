// Help center article: How does the VERGR wallet work?
// Edit the text freely. Block model:
//   { p } paragraph · { h2 } heading · { list:[...] } bullets · { steps:[...] } numbered
//   { faq:[[q,a],...] } · { note } callout · { cta:[{ to, label }] } related links
// Top-level: summary (1-2 sentences, answer-first), updated (YYYY-MM-DD), body [].

export default {
  summary: "The wallet is where your Coins live. You buy Coins and spend them on tips, stream passes, memberships and boosts. It has its own section with a PIN on sensitive actions and a full purchase history.",
  updated: "2026-06-06",
  body: [
    {
      p: "The wallet is where you buy and spend Coins. It has its own dedicated section so it stays clean and secure. Creator earnings are separate and live in Creator Studio."
    },
    {
      h2: "What is inside"
    },
    {
      list: [
        "Your Coin balance at a glance.",
        "Buy Coins through the Shop.",
        "Buy Coins.",
        "Buy a Coin pack.",
        "A full transaction history you can filter and get receipts from.",
        "Security settings, including your PIN and two-factor authentication."
      ]
    },
    {
      h2: "How the flow works"
    },
    {
      p: "You add Coins by buying them. You spend Coins on tips, stream passes, boosts, and subscriptions. Earning is separate: when people pay for your content, Vergr pays you a share of that revenue on a schedule. Coins themselves never cash out."
    },
    {
      h2: "Security"
    },
    {
      p: "Because it holds your Coins, the wallet asks for your PIN on sensitive actions and supports two-factor authentication. When you are done, there is an exit option that takes you back to the main app."
    },
    {
      cta: [
        {
          to: "/platform/help/how-do-coins-and-vp-work-together",
          label: "How Coins and VP work"
        },
        {
          to: "/platform/help/how-do-i-see-my-transaction-history",
          label: "Transaction history"
        }
      ]
    }
  ]
};
