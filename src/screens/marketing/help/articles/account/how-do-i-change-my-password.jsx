export default {
  summary: "Go to Settings, then Security, and tap Change Password. Enter your current password and your new one. If you signed up with Google you do not have a VERGR password and cannot set one from here.",
  updated: "2026-06-06",
  body: [
    { p: "Changing your password regularly is good practice, especially if you think your account may have been accessed without your knowledge." },
    { h2: "How to change your password" },
    { steps: [
      "Go to Settings (tap your avatar, then the gear icon).",
      "Tap Security.",
      "Tap Change Password.",
      "Enter your current password.",
      "Enter your new password and confirm it.",
      "Tap Save."
    ]},
    { h2: "Good password habits" },
    { list: [
      "Use at least 12 characters with a mix of letters, numbers, and symbols.",
      "Do not reuse a password from another site.",
      "Use a password manager so you do not have to remember it.",
      "Enable two-factor authentication for an extra layer of protection."
    ]},
    { note: "If you cannot remember your current password, use the 'Forgot password' flow on the login screen to reset it via email instead." },
    { cta: [
      { to: "/platform/help/i-forgot-my-password-how-do-i-reset-it", label: "Forgot your password?" },
      { to: "/platform/help/how-do-i-set-up-two-factor-authentication", label: "Two-factor authentication" }
    ]}
  ]
};
