// Help center article: I can not log in, what do I do?

export default {
  summary: "Use Forgot password on the login screen for a reset email (check spam). If two-factor is blocking you because you lost your authenticator, sign in with one of the recovery codes you saved at setup. Wrong-password loops on a correct password usually mean a typo in the email address, or an account created with a different sign-in method.",
  updated: "2026-07-02",
  body: [
    {
      h2: "Password problems"
    },
    {
      steps: [
        "Double-check the email address first: the most common \"wrong password\" is actually a wrong email.",
        "Use Forgot password on the login screen. The reset email can take a minute, and spam folders love it.",
        "Remember how you signed up: if the account was created with a social login, use that same button rather than a password."
      ]
    },
    {
      h2: "Two-factor problems"
    },
    {
      list: [
        "Lost or new phone: sign in using one of the recovery codes you were shown when you set 2FA up. Each code works once.",
        "Codes rejected: authenticator codes are time-based, so a phone with a wrong clock generates wrong codes. Set the phone's time to automatic and try again.",
        "No recovery codes saved: contact support@vergr.app from the email address on the account, identity checks will apply before 2FA is removed."
      ]
    },
    {
      h2: "Everything correct and still stuck?"
    },
    {
      p: "Reload the page or update the app, then try once more. If the account was suspended, the login screen will say so rather than failing silently, and the appeal route applies."
    },
    {
      cta: [
        { to: "/platform/help/i-forgot-my-password-how-do-i-reset-it", label: "Password reset" },
        { to: "/platform/help/my-account-was-muted-or-banned-what-do-i-do", label: "If the account is restricted" }
      ]
    }
  ]
};
