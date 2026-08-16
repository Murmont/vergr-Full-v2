export default {
  summary: "The wallet PIN protects your Coins. It is required to unlock the wallet and to approve sensitive actions like a purchase. After you unlock, it stays open for a short window, then re-locks so a stranger with your unlocked phone cannot spend your Coins.",
  updated: "2026-06-07",
  body: [
    { p: "Your wallet holds real value, so it is gated separately from the rest of the app with a PIN you set." },
    { h2: "When you'll be asked" },
    { list: [
      "Opening the wallet.",
      "Approving a purchase or other sensitive action.",
      "After the unlock window expires (it re-locks on its own).",
    ]},
    { h2: "Why it works this way" },
    { p: "The short unlock window means you do not re-enter your PIN for every tap, but the wallet still re-locks automatically so it is not left open. Your PIN is stored hashed — nobody at VERGR can read it." },
    { cta: [
      { to: "/platform/help/how-do-i-set-up-my-wallet-pin", label: "Set up your PIN" },
      { to: "/platform/help/i-forgot-my-wallet-pin-what-do-i-do", label: "Forgot your PIN?" }
    ]}
  ]
};
