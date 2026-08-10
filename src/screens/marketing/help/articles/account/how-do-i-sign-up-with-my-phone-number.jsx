export default {
  summary: "Tap Sign Up, choose the phone number option, enter your number, and enter the verification code you receive by SMS. You will then pick a username and finish setting up your profile.",
  updated: "2026-06-06",
  body: [
    { p: "Signing up with a phone number is a good option if you do not want to use an email address or Google. Your number is used for verification only and is not shown on your profile." },
    { h2: "Steps" },
    { steps: [
      "Tap Sign Up on the VERGR home screen.",
      "Choose 'Phone number' as your sign-up method.",
      "Enter your mobile number including the country code.",
      "Tap Send Code. A six-digit code arrives by SMS within a minute.",
      "Enter the code in the app to verify your number.",
      "Choose a username, confirm your date of birth, and add a profile photo to finish."
    ]},
    { note: "If the code does not arrive, check that you entered the correct country code and tap Resend. Some network filters delay SMS. If the problem continues, try signing up with email or Google instead." },
    { cta: [
      { to: "/platform/help/how-do-i-create-an-account", label: "All sign-up methods" },
      { to: "/platform/help/how-do-i-verify-my-phone-number", label: "Verifying your phone number" }
    ]}
  ]
};
