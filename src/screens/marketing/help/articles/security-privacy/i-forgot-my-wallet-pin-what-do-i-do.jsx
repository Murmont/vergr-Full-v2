export default {
  summary: "You can reset your wallet PIN from the wallet's Security section. Resetting requires confirming your identity through your account login and two-factor authentication if you have it on. If you are locked out, contact support — your balance is safe while you recover access.",
  updated: "2026-06-07",
  body: [
    { p: "Your wallet PIN is separate from your account password. It is stored securely (hashed), so nobody at VERGR can read it — which is also why it cannot simply be looked up for you. It has to be reset." },
    { h2: "Resetting your PIN" },
    { steps: [
      "Open your wallet and go to the Security area.",
      "Choose Reset PIN.",
      "Confirm your identity (account login, plus your two-factor code if 2FA is enabled).",
      "Set a new PIN."
    ]},
    { h2: "If you cannot reset it" },
    { p: "If you have lost access to your account or 2FA as well, contact support at support@vergr.app. Your Coins and Gems remain in your wallet the whole time — a forgotten PIN never causes loss of funds." },
    { note: "Never share your PIN. VERGR support will never ask you for it." },
    { cta: [
      { to: "/platform/help/how-do-i-set-up-my-wallet-pin", label: "Setting up your PIN" },
      { to: "/platform/help/how-do-i-set-up-two-factor-authentication", label: "Two-factor authentication" }
    ]}
  ]
};
