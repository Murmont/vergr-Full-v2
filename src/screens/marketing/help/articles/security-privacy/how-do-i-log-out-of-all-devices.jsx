export default {
  summary: "Go to Settings → Security and tap Sign Out All Devices. This ends every active session everywhere, so you (and anyone else) will need to log in again. Use it if you lost a device or think someone else has access.",
  updated: "2026-06-07",
  body: [
    { h2: "How to sign out everywhere" },
    { steps: [
      "Open Settings → Security.",
      "Tap Sign Out All Devices.",
      "Confirm. All sessions end immediately.",
      "Log back in on your own device."
    ]},
    { h2: "When to use it" },
    { list: [
      "You lost or sold a phone or computer that was logged in.",
      "You used VERGR on a shared or public device.",
      "You suspect someone has your password.",
    ]},
    { p: "For full peace of mind, follow it up by changing your password and enabling two-factor authentication so the account cannot simply be logged into again." },
    { cta: [
      { to: "/platform/help/how-do-i-see-which-devices-are-logged-into-my-account", label: "Suspected unauthorized access" },
      { to: "/platform/help/how-do-i-change-my-password", label: "Change your password" }
    ]}
  ]
};
