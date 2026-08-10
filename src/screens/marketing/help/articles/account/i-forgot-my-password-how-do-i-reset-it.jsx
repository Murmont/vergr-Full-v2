export default {
  summary: "Tap 'Forgot password' on the login screen, enter your email address, and VERGR sends you a reset link. Click the link in your email, set a new password, and you are back in.",
  updated: "2026-06-06",
  body: [
    { p: "Password resets are fast. If you use Google sign-in you do not have a VERGR password to reset — just tap 'Continue with Google' to log in." },
    { h2: "Steps to reset your password" },
    { steps: [
      "On the login screen, tap 'Forgot password'.",
      "Enter the email address linked to your VERGR account.",
      "Tap Send Reset Link.",
      "Open your email and click the link from VERGR.",
      "Enter your new password and confirm it.",
      "Log in with your new password."
    ]},
    { h2: "Did not get the email?" },
    { list: [
      "Check your spam or junk folder.",
      "Make sure you used the correct email address.",
      "Wait two minutes and check again. Sometimes email delivery is slightly delayed.",
      "If you still have no email, try the sign-up flow to see whether the address is registered at all."
    ]},
    { note: "Reset links expire after one hour. If yours has expired, go through the forgot-password flow again to get a fresh link." },
    { cta: [
      { to: "/platform/help/how-do-i-log-in", label: "Logging in" },
      { to: "/platform/help/how-do-i-set-up-two-factor-authentication", label: "Two-factor authentication" }
    ]}
  ]
};
