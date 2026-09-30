export default {
  summary: "Go to Settings, then Linked Accounts, find the platform you want to remove, and tap Disconnect. The link is removed from VERGR immediately. You may also want to revoke access from the other platform's own settings.",
  updated: "2026-06-06",
  body: [
    { p: "Disconnecting removes the connection from VERGR. It does not affect your VERGR account or anything you have on the platform itself." },
    { h2: "Steps to disconnect" },
    { steps: [
      "Go to Settings.",
      "Tap Linked Accounts.",
      "Find the account you want to remove.",
      "Tap Disconnect and confirm."
    ]},
    { h2: "After disconnecting" },
    { list: [
      "A handle you added (YouTube, Steam, PlayStation, Xbox and so on) stops showing on your profile.",
      "If you disconnected Twitch, your Twitch stream no longer mirrors on VERGR.",
      "If you disconnected Discord, groups you already brought over stay, but nothing new syncs."
    ]},
    { p: "Twitch and Discord were connected through their own sign-in, so to fully revoke VERGR's access also remove VERGR from that platform's connected apps: on Twitch, Settings then Connections; on Discord, User Settings then Authorized Apps. Other handles were only typed in, so there is nothing to revoke." },
    { cta: [
      { to: "/platform/help/how-do-i-connect-my-accounts", label: "Connecting accounts" },
      { to: "/platform/help/which-accounts-can-i-connect", label: "Which accounts can I connect?" }
    ]}
  ]
};
