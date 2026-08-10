export default {
  summary: "The wallet has its own navigation. Tap Exit Wallet (or the back/close control) to return to the main app. Your wallet re-locks automatically, so leaving it is safe.",
  updated: "2026-06-07",
  body: [
    { p: "Because the wallet is its own dedicated space, you leave it explicitly rather than with the normal app tabs." },
    { h2: "Getting back to the app" },
    { steps: [
      "Find the Exit Wallet button (or the back/close control in the wallet header).",
      "Tap it to return to the main app.",
      "The wallet re-locks, so you'll enter your PIN next time you open it."
    ]},
    { note: "You do not need to 'log out' of the wallet — it secures itself with the PIN and auto-lock." },
    { cta: [
      { to: "/platform/help/how-do-i-open-my-wallet", label: "Opening the wallet" },
      { to: "/platform/help/why-is-my-wallet-asking-for-a-pin", label: "The wallet PIN" }
    ]}
  ]
};
