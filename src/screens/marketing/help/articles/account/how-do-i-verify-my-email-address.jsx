export default {
  summary: "After signing up with email, VERGR sends a verification link to your inbox. Click it and your address is confirmed. If you did not receive it, check your spam folder or request a new link from settings.",
  updated: "2026-06-06",
  body: [
    { p: "A verified email address means VERGR can send you important account notices and lets you reset your password if you ever get locked out." },
    { h2: "Verify during sign-up" },
    { steps: [
      "After you register with an email address, check your inbox for a message from VERGR.",
      "Open the email and click the 'Verify email' link.",
      "The link opens the app and confirms your address automatically."
    ]},
    { h2: "Did not get the email?" },
    { list: [
      "Check your spam or promotions folder.",
      "Make sure you typed the address correctly during sign-up.",
      "Go to Settings, find Email, and tap Resend verification.",
      "Add noreply@vergr.app to your contacts to help future emails land in your inbox."
    ]},
    { note: "Verification links expire after 24 hours. If yours has expired, request a new one from Settings." },
    { cta: [
      { to: "/platform/help/how-do-i-create-an-account", label: "Creating an account" },
      { to: "/platform/help/i-forgot-my-password-how-do-i-reset-it", label: "Resetting your password" }
    ]}
  ]
};
