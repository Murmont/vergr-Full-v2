export default {
  summary: "Your history shows transaction types like Purchase, Tip, Access and Membership. Each tells you what moved and why — money in from buying Coins, Coins out as a tip, and so on.",
  updated: "2026-06-07",
  body: [
    { h2: "Common transaction types" },
    { list: [
      "Purchase: you bought Coins with money.",
      "Tip sent / Tip received: Coins you sent to, or the revenue share you accrued from, a tip.",
      "Revenue share: your share of what your content earned, at your rank’s rate.",
      "Access / Membership: Coins spent on a paid stream pass or a creator membership, or received as a creator.",
      "Boost: Coins spent on a Stream Boost or quality boost.",
      "Payout: your revenue share, paid by Vergr.",
      "Revenue share: the portion of what your content earns that Vergr keeps.",
    ]},
    { p: "A positive amount means it came into your balance; a negative amount means it left." },
    { cta: [
      { to: "/platform/help/what-fees-does-vergr-charge", label: "What fees apply" },
      { to: "/platform/help/how-do-i-see-my-transaction-history", label: "Transaction history" }
    ]}
  ]
};
