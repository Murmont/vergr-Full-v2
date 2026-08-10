export default {
  summary: "Open VERGR and tap Log In, then use the same method you signed up with: email and password, Google, or phone number. If you are already logged in on your device, the app opens straight to your feed.",
  updated: "2026-06-06",
  body: [
    { p: "You stay logged in on your device until you choose to log out. If the app asks you to log in again, it means your session expired or you logged out on another device." },
    { h2: "Logging in" },
    { steps: [
      "Open the VERGR app.",
      "Tap Log In.",
      "Choose the same method you used to sign up.",
      "Email: enter your email and password.",
      "Google: tap 'Continue with Google' and pick your account.",
      "Phone: enter your number, receive the SMS code, and enter it."
    ]},
    { h2: "Forgot which method you used?" },
    { p: "Try Google first. Many users signed up with Google even if they did not realise it. If that does not work, try email with the address you would have used. If you are still stuck, use 'Forgot password' to trigger a reset email — if the address exists in our system, you will receive one." },
    { note: "If you have two-factor authentication enabled, you will be asked for a code from your authenticator app after your password. Keep your authenticator app accessible." },
    { cta: [
      { to: "/platform/help/i-forgot-my-password-how-do-i-reset-it", label: "Resetting your password" },
      { to: "/platform/help/how-do-i-set-up-two-factor-authentication", label: "Two-factor authentication" }
    ]}
  ]
};
