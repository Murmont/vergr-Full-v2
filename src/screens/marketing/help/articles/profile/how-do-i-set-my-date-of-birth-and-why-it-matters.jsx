export default {
  summary: "Your date of birth is set when you sign up and is used to verify you are 18 or older. It is stored privately, never shown on your profile, and cannot be changed after it is confirmed.",
  updated: "2026-06-06",
  body: [
    { p: "VERGR uses your date of birth as an age gate, not a profile field. Other users never see it." },
    { h2: "Why it matters" },
    { list: [
      "Real-money tournaments and Coin purchases are restricted to adults in most countries.",
      "Withdrawal processing and KYC verification are legally age-gated.",
      "VERGR's Terms of Service require users to be 18 or older."
    ]},
    { h2: "Can I change my date of birth?" },
    { p: "Not through the app. Your date of birth is locked once you confirm it during sign-up. If you entered it incorrectly, contact VERGR support with proof of your real date of birth. The support team can correct an error if you provide valid ID." },
    { note: "Entering a false date of birth to bypass the age gate violates the Terms of Service and can result in a permanent ban, including forfeiture of any wallet balance." },
    { cta: [
      { to: "/platform/help/why-do-i-have-to-be-18-plus", label: "Why VERGR requires 18+" },
      { to: "/platform/help/what-is-kyc-and-why-does-vergr-ask-for-it", label: "Identity verification" }
    ]}
  ]
};
