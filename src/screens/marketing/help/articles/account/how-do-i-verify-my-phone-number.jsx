export default {
  summary: "VERGR sends a six-digit SMS code to your number. Enter the code in the app and your number is verified. The code expires in ten minutes, so enter it promptly.",
  updated: "2026-06-06",
  body: [
    { p: "Verifying your phone number lets VERGR send you security codes for two-factor authentication and, if you signed up by phone, confirms your identity." },
    { h2: "How to verify" },
    { steps: [
      "When prompted, enter your mobile number including the country code.",
      "Tap Send Code.",
      "Open your messages app and find the SMS from VERGR with a six-digit code.",
      "Type the code into the app within ten minutes."
    ]},
    { h2: "Troubleshooting" },
    { list: [
      "Double-check the country code. For example, UK numbers start with +44, not 0.",
      "Tap Resend if the code has not arrived after two minutes.",
      "Some prepaid or VoIP numbers do not receive automated SMS. Try a different number.",
      "If you are in a country with limited SMS delivery, try signing up with email or Google instead."
    ]},
    { cta: [
      { to: "/platform/help/how-do-i-sign-up-with-my-phone-number", label: "Signing up with a phone number" },
      { to: "/platform/help/how-do-i-set-up-two-factor-authentication", label: "Setting up two-factor authentication" }
    ]}
  ]
};
