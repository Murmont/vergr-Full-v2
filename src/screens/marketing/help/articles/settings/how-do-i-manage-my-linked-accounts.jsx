// Help center article: How do I manage my linked accounts?
// Block model: { p } | { h2 } | { list:[] } | { steps:[] } | { faq:[[q,a]] } | { note } | { cta:[{to,label}] }

export default {
  summary: "Go to Settings then Linked accounts to connect or disconnect your gaming and streaming accounts (like Steam, Twitch, YouTube, Discord, and Xbox). Linking shows them on your profile and helps with verification and discovery. You can disconnect any of them at any time, and doing so removes that connection from your profile.",
  updated: "2026-06-18",
  body: [
    {
      p: "Linked accounts connect your gaming and streaming identities to your VERGR profile. They make you easier to recognise, help confirm you are a real player, and let people find you across platforms. You manage all of them from one place in Settings."
    },
    {
      h2: "Connect or disconnect an account"
    },
    {
      steps: [
        "Open Settings, then Linked accounts.",
        "To link one, pick the platform and sign in to authorise the connection.",
        "To remove one, choose it and disconnect.",
        "Your profile updates to reflect what is connected."
      ]
    },
    {
      h2: "Which accounts you can link"
    },
    {
      list: [
        "Gaming and streaming platforms such as Steam, Twitch, YouTube, Discord, and Xbox.",
        "Linked accounts can appear on your profile so people see where else to find you.",
        "Connecting can support verification and better recommendations."
      ]
    },
    {
      note: "Disconnecting a linked account removes the connection and anything tied to it on your profile. It does not delete your account on that other platform, just the link to VERGR.",
    },
    {
      faq: [
        [
          "Why should I link my accounts?",
          "It builds trust (you are a real player), surfaces you to the right people, and ties your gaming presence together. It is optional, but it helps."
        ],
        [
          "I linked the wrong account. How do I fix it?",
          "Disconnect it from Linked accounts, then link the correct one. The change is immediate."
        ],
        [
          "Does linking share my password?",
          "No. Linking uses each platform's secure sign-in to authorise the connection. VERGR never sees your password for those accounts."
        ]
      ]
    },
    {
      cta: [
        {
          to: "/platform/help/which-gaming-accounts-can-i-link",
          label: "Which accounts can I link?"
        },
        {
          to: "/platform/help/why-should-i-link-my-gaming-accounts",
          label: "Why link my accounts?"
        }
      ]
    }
  ]
};
