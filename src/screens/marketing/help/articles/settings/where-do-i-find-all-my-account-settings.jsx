// Help center article: Where do I find all my account settings?
// Block model: { p } | { h2 } | { list:[] } | { steps:[] } | { faq:[[q,a]] } | { note } | { cta:[{to,label}] }

export default {
  summary: "Open Settings from your profile or the main menu. That hub holds everything: your account, display, notifications, privacy, security, linked accounts, language, storage, permissions, and your plan. Each card opens a focused page so you are never hunting through one giant list.",
  updated: "2026-06-18",
  body: [
    {
      p: "Everything you can adjust about your account lives in one place: Settings. You get there from your profile or the main menu, and from there it branches into clearly labelled sections so you can go straight to what you need."
    },
    {
      h2: "Open Settings"
    },
    {
      steps: [
        "Tap your avatar or open the main menu.",
        "Choose Settings.",
        "Pick the section you want from the cards: Account, Display, Notifications, Privacy, Security, Linked accounts, Language, Storage, Permissions, or Plan."
      ]
    },
    {
      h2: "What is where"
    },
    {
      list: [
        "Account: your email, password, date of birth, and account actions like data download and deletion.",
        "Display: theme, text size, and reduced motion.",
        "Notifications: which alerts you receive and on which device.",
        "Privacy: who can see, message, and find you.",
        "Security: PIN, two-factor authentication, and devices.",
        "Linked accounts: your connected gaming and streaming accounts.",
        "Language, Storage, and Permissions: your language preference, cache, and device access.",
        "Plan: your VERGR plan and subscription."
      ]
    },
    {
      note: "The Settings hub shows your current app version at the bottom. That is handy when you are checking whether you are up to date or reporting an issue.",
    },
    {
      faq: [
        [
          "Where is the wallet?",
          "The wallet is its own secure area, not inside Settings. Open it from your profile or the wallet shortcut. Wallet security options (PIN, two-factor) live under Security in Settings."
        ],
        [
          "I cannot find a setting.",
          "Use the section labels above. Most settings sit in the card that matches their job: display things under Display, privacy things under Privacy, and so on."
        ]
      ]
    },
    {
      cta: [
        {
          to: "/platform/help/how-do-i-change-my-display-settings",
          label: "Change display settings"
        },
        {
          to: "/platform/help/how-do-i-manage-my-linked-accounts",
          label: "Manage linked accounts"
        }
      ]
    }
  ]
};
