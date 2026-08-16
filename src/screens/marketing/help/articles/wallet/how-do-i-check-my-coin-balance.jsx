// Help center article: How do I check my Coin balance?
// Edit the text freely. Block model:
//   { p } paragraph · { h2 } heading · { list:[...] } bullets · { steps:[...] } numbered
//   { faq:[[q,a],...] } · { note } callout · { cta:[{ to, label }] } related links
// Top-level: summary (1-2 sentences, answer-first), updated (YYYY-MM-DD), body [].

export default {
  summary:
    "Your Coin balance is at the top of your wallet. Open the wallet from your profile menu, and the balance sits above your recent activity.",
  updated: "2026-08-16",
  body: [
    {
      p: "Your Coin balance is the first thing on the wallet screen, so it takes one tap to check.",
    },
    { h2: "Open your wallet" },
    {
      steps: [
        "Tap your avatar to open the profile menu.",
        "Choose Coins.",
        "Your balance is at the top of the screen.",
      ],
    },
    { h2: "What the balance means" },
    {
      list: [
        "It is the Coins you currently have available to spend.",
        "It goes down when you tip, unlock content, buy a membership or start a boost.",
        "It goes up when you buy a Coin pack.",
        "Coins are a licence to use features. They have no cash value and cannot be transferred or redeemed for money.",
      ],
    },
    {
      note:
        "Looking for what you have earned rather than what you can spend? Creator earnings are not in the wallet. VERGR pays you a share of the revenue your content generates, and you track it in Creator Studio under Earnings.",
    },
    {
      cta: [
        { to: "/platform/help/how-do-i-open-my-wallet", label: "Open your wallet" },
        { to: "/platform/help/how-do-i-see-my-transaction-history", label: "Transaction history" },
        { to: "/platform/help/how-do-i-see-my-earnings", label: "See your earnings" },
      ],
    },
  ],
};
