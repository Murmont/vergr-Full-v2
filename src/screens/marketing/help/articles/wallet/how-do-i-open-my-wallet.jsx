export default {
  summary: "Tap your balance or the wallet icon to open the wallet. It has its own dedicated space with a PIN gate. The first time, you set up a PIN; after that you unlock with it to view balances and make transactions.",
  updated: "2026-06-07",
  body: [
    { h2: "Opening the wallet" },
    { steps: [
      "Tap your coin/gem balance or the wallet entry in the menu.",
      "If it is your first time, set up a wallet PIN.",
      "Enter your PIN to unlock.",
      "You land on the wallet home with your balances and quick actions."
    ]},
    { h2: "What's inside" },
    { list: [
      "Balances for Coins and Gems.",
      "Buy, Convert, Withdraw, and Deposit actions.",
      "Transaction history.",
      "Security settings (PIN, whitelisted addresses) and KYC.",
    ]},
    { cta: [
      { to: "/platform/help/why-is-my-wallet-asking-for-a-pin", label: "Why the PIN?" },
      { to: "/platform/help/how-does-the-vergr-wallet-work", label: "How the wallet works" }
    ]}
  ]
};
