export default {
  summary: "Your history shows transaction types like Purchase, Tip, Conversion, Tournament, Withdrawal, and Fee. Each tells you what moved and why — money in from buying Coins, Coins out as a tip, Gems out as a withdrawal, and so on.",
  updated: "2026-06-07",
  body: [
    { h2: "Common transaction types" },
    { list: [
      "Purchase: you bought Coins with money.",
      "Tip sent / Tip received: Coins you sent to, or received from, another user (tips have a flat 10% fee).",
      "Conversion: Coins converted into Gems, minus the rank-based commission.",
      "Tournament entry / Tournament prize: Coins escrowed to join, or won as a prize.",
      "Boost: Coins spent on a Stream Boost or quality boost.",
      "Withdrawal: Gems cashed out to your crypto address.",
      "Fee / Commission: the platform's cut on a conversion or withdrawal.",
    ]},
    { p: "A positive amount means it came into your balance; a negative amount means it left." },
    { cta: [
      { to: "/platform/help/what-fees-does-vergr-charge", label: "What fees apply" },
      { to: "/platform/help/how-do-i-see-my-transaction-history", label: "Transaction history" }
    ]}
  ]
};
