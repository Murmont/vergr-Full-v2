// Help center article: How do I change the app language?
// Block model: { p } | { h2 } | { list:[] } | { steps:[] } | { faq:[[q,a]] } | { note } | { cta:[{to,label}] }
//
// ⚠ The "Translate messages and posts" section is removed while translation is
// switched off (src/utils/translationSwitch.js, 2026-09-16). Restore it from git
// history when TRANSLATION_ENABLED goes back to true.

export default {
  summary: "Go to Settings then Language and pick your language. VERGR uses it to suggest posts, streams and people who speak it.",
  updated: "2026-09-16",
  body: [
    {
      p: "VERGR is a global community. Setting your language helps the app surface posts, live streams and people in the language you speak."
    },
    {
      h2: "Set your language preference"
    },
    {
      steps: [
        "Open Settings, then Language.",
        "Choose your language from the list.",
        "Save. Your preference is remembered for your account."
      ]
    },
    {
      faq: [
        [
          "Does changing my language translate the whole app?",
          "Not yet. It sets your language preference for your account, which shapes what VERGR suggests to you."
        ]
      ]
    },
    {
      cta: [
        {
          to: "/platform/help/where-do-i-find-all-my-account-settings",
          label: "All your settings"
        },
        {
          to: "/platform/help/is-vergr-available-in-my-country",
          label: "Is VERGR available in my country?"
        }
      ]
    }
  ]
};
