export default {
  summary: "VERGR does not show a per-device session list, but if you think someone else is logged in, you can end every other session at once with Sign Out All Devices in Settings → Security, then change your password and turn on two-factor authentication.",
  updated: "2026-06-07",
  body: [
    { p: "Rather than managing individual devices, VERGR gives you a single, decisive control: sign out everywhere and re-secure the account." },
    { h2: "If you suspect unauthorized access" },
    { steps: [
      "Go to Settings → Security.",
      "Tap Sign Out All Devices — this ends every active session, including the intruder's.",
      "Change your password (Settings → Security → Change Password).",
      "Turn on Two-Factor Authentication so a password alone is not enough to log in.",
      "If your wallet might be at risk, reset your wallet PIN and review your whitelisted addresses."
    ]},
    { note: "VERGR will never message you asking for your password, PIN, or 2FA code. Anyone who does is trying to take your account." },
    { cta: [
      { to: "/platform/help/how-do-i-log-out-of-all-devices", label: "Sign out of all devices" },
      { to: "/platform/help/how-do-i-set-up-two-factor-authentication", label: "Set up 2FA" }
    ]}
  ]
};
