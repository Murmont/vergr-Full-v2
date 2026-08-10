export default {
  summary: "Go to Settings, then Linked Accounts, and tap Connect next to the platform you want to add. You will be taken through that platform's login flow and returned to VERGR once the link is confirmed.",
  updated: "2026-06-06",
  body: [
    { p: "Linking your gaming accounts shows your real stats on your profile, lets your Twitch streams surface on VERGR automatically, and confirms your in-game identity to the people who follow you." },
    { h2: "How to connect an account" },
    { steps: [
      "Go to Settings.",
      "Tap Linked Accounts.",
      "Find the platform you want to connect (Steam, Twitch, YouTube, Discord, Xbox, Epic, and others).",
      "Tap Connect.",
      "Log in to that platform in the browser window that opens.",
      "Approve the permissions VERGR requests.",
      "You are returned to VERGR with the account linked."
    ]},
    { h2: "What linking unlocks" },
    { list: [
      "Steam: your PC game identity and playtime shown on your profile.",
      "Twitch: your Twitch stream appears on VERGR when you go live there, with chat bridged.",
      "YouTube and Discord: shown on your profile for social linking.",
      "Xbox: game library and achievement matching for supported titles."
    ]},
    { note: "VERGR only requests read permissions. It cannot post, make purchases, or change settings on your linked accounts." },
    { cta: [
      { to: "/platform/help/which-gaming-accounts-can-i-link", label: "Which accounts can I link?" },
      { to: "/platform/help/why-should-i-link-my-gaming-accounts", label: "Why linking helps" }
    ]}
  ]
};
