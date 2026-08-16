export default {
  summary: "Go to Settings → Security. From there you can change your password, turn on two-factor authentication, and sign out of all devices. Your wallet has its own Security section for your PIN and two-factor settings.",
  updated: "2026-06-07",
  body: [
    { p: "VERGR splits security into two places: account-level (Settings) and wallet-level (inside the wallet)." },
    { h2: "Account security (Settings → Security)" },
    { list: [
      "Change Password — sends a reset email to your address.",
      "Two-Factor Authentication — turn on an authenticator-app code for logins.",
      "Sign Out All Devices — ends every active session everywhere.",
    ]},
    { h2: "Wallet security (inside the wallet)" },
    { list: [
      "Wallet PIN — required to view balances and approve purchases.",
      "Verified payout details — the only destination your earnings can go to.",
    ]},
    { h2: "Recommended setup" },
    { p: "Turn on 2FA, set a wallet PIN you do not use anywhere else, and whitelist only addresses you control. That combination protects both your account and your funds." },
    { cta: [
      { to: "/platform/help/how-do-i-set-up-two-factor-authentication", label: "Set up 2FA" },
      { to: "/platform/help/how-do-i-log-out-of-all-devices", label: "Sign out everywhere" }
    ]}
  ]
};
