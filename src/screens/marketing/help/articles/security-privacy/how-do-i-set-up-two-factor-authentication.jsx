// Help center article: How do I set up two-factor authentication?
// Edit the text freely. Block model:
//   { p } paragraph · { h2 } heading · { list:[...] } bullets · { steps:[...] } numbered
//   { faq:[[q,a],...] } · { note } callout · { cta:[{ to, label }] } related links
// Top-level: summary (1-2 sentences, answer-first), updated (YYYY-MM-DD), body [].

export default {
  summary: "Go to your security settings and turn on two-factor authentication. You scan a QR code with an authenticator app, then enter the six-digit code it generates to confirm. After that, signing in and sensitive actions ask for a fresh code, so a password alone is not enough to get into your account.",
  updated: "2026-06-06",
  body: [
    {
      p: "Two-factor authentication (2FA) is the single best thing you can do to protect your account. It means that even if someone got your password, they still could not get in without the rotating code on your phone."
    },
    {
      h2: "How to set it up"
    },
    {
      steps: [
        "Open your security settings.",
        "Choose to set up two-factor authentication.",
        "Scan the QR code with an authenticator app on your phone.",
        "Enter the six-digit code the app shows to confirm the link.",
        "Save your backup details somewhere safe in case you lose your phone."
      ]
    },
    {
      h2: "What changes afterward"
    },
    {
      p: "Once 2FA is on, signing in and sensitive actions ask for a current code from your authenticator app. It refreshes every 30 seconds, so it cannot be reused or guessed. This is especially worth doing if you hold a balance you plan to withdraw."
    },
    {
      note: "Keep your backup codes somewhere safe. If you lose access to your authenticator app, those are how you get back in."
    },
    {
      cta: [
        {
          to: "/platform/help/is-my-vergr-wallet-secure",
          label: "Wallet security"
        },
        {
          to: "/platform/help/how-do-i-review-my-security-settings",
          label: "Review security settings"
        }
      ]
    }
  ]
};
