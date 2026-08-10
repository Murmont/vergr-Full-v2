export default {
  summary: "Go to Settings, then Linked Accounts, find the platform you want to remove, and tap Disconnect. The link is removed from VERGR immediately. You may also want to revoke access from the other platform's own settings.",
  updated: "2026-06-06",
  body: [
    { p: "Disconnecting a linked account stops VERGR from reading data from that platform. It does not affect your VERGR account or any history you have on the platform itself." },
    { h2: "Steps to disconnect" },
    { steps: [
      "Go to Settings.",
      "Tap Linked Accounts.",
      "Find the account you want to remove.",
      "Tap Disconnect and confirm."
    ]},
    { h2: "After disconnecting" },
    { list: [
      "Tournament auto-verification that relied on that account will no longer work. You will need to verify matches manually or through another method.",
      "If you disconnected Twitch, your Twitch stream will no longer mirror on VERGR.",
      "Your stats from that platform are removed from your VERGR profile."
    ]},
    { p: "To fully revoke VERGR's access, also go to that platform's security settings and remove VERGR from your connected apps. For Steam this is in Account Details under Manage Steam Guard and authorized applications. For Twitch it is in Settings under Connections." },
    { cta: [
      { to: "/platform/help/how-do-i-connect-my-gaming-accounts", label: "Connecting gaming accounts" },
      { to: "/platform/help/which-gaming-accounts-can-i-link", label: "Which accounts can I link?" }
    ]}
  ]
};
