// Help center article: How do I manage my linked accounts?
// Rewritten 2026-09-21: it claimed linking helped "confirm you are a real
// player", supported verification and used each platform's sign-in for every
// account. Only Twitch and Discord sign in; every other row is a typed handle.
// Block model: { p } | { h2 } | { list:[] } | { steps:[] } | { faq:[[q,a]] } | { note } | { cta:[{to,label}] }

export default {
  summary: "Go to Settings, then Connected accounts. Connect Twitch or Discord through their sign-in, add or remove any other handle, and handles you add show on your profile.",
  updated: "2026-09-21",
  body: [
    {
      p: "Connected accounts is one screen for two kinds of thing: real connections (Twitch and Discord) that do something on VERGR, and handles (YouTube, Steam, PlayStation, Xbox and others) that show on your profile so people can find you there."
    },
    {
      h2: "Connect, change or remove an account"
    },
    {
      steps: [
        "Open Settings, then Connected accounts.",
        "To connect Twitch or Discord, tap Connect and sign in to that platform.",
        "To add a handle, tap Connect next to the platform and type it in.",
        "To remove any of them, tap Disconnect. The change is immediate."
      ]
    },
    {
      faq: [
        [
          "I added the wrong handle. How do I fix it?",
          "Disconnect it, then add the right one. Your profile updates straight away."
        ],
        [
          "Does connecting share my password?",
          "No. Twitch and Discord use their own sign-in, so VERGR never sees your password. Other handles are only text you type, with no sign-in at all."
        ],
        [
          "Will connecting Twitch or Discord show them on my profile?",
          "No. Those two are connected for what they do. To show them on your profile, add them in Edit Profile, Social Links."
        ]
      ]
    },
    {
      cta: [
        {
          to: "/platform/help/which-accounts-can-i-connect",
          label: "Which accounts can I connect?"
        },
        {
          to: "/platform/help/why-connect-my-accounts",
          label: "Why connect my accounts?"
        }
      ]
    }
  ]
};
