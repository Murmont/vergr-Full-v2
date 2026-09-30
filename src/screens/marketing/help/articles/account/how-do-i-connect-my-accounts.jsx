// Help center article: How do I connect my accounts?
// Was "How do I connect my gaming accounts?" until 2026-09-21 (old URL 301s here).
// It promised real stats, playtime and Xbox achievements on your profile; none
// of that existed. What is below is what the Connected accounts screen does.
export default {
  summary: "Go to Settings, then Connected accounts. Twitch and Discord connect through their own sign-in; for everything else you type your handle, and it shows on your profile.",
  updated: "2026-09-21",
  body: [
    { p: "Connected accounts do two different jobs. Twitch and Discord are real connections that do something on VERGR. Every other row is a handle you add so people who open your profile can find you there too." },
    { h2: "Connect Twitch or Discord" },
    { steps: [
      "Open Settings, then Connected accounts.",
      "Tap Connect next to Twitch or Discord.",
      "Sign in to that platform in the window that opens and approve the connection.",
      "You come back to VERGR with the account connected."
    ]},
    { h2: "Add any other handle" },
    { steps: [
      "Open Settings, then Connected accounts.",
      "Tap Connect next to the platform (for example YouTube, Steam, PlayStation or Xbox).",
      "Type your handle or ID and save.",
      "It now shows on your profile, under your bio."
    ]},
    { h2: "What each one does" },
    { list: [
      "Twitch: go live on Twitch as usual and your stream also shows live on VERGR, with chat synced both ways.",
      "Discord: bring your Discord server over as a VERGR group, with community role rewards.",
      "YouTube and Steam: shown on your profile, and tapping them opens your channel or Steam page.",
      "PlayStation, Xbox, Riot, Battle.net, Epic and EA: your ID shows on your profile, and tapping it copies the ID so someone can add you."
    ]},
    { note: "Twitch and Discord are not shown on your profile just because you connected them. If you want people to see them, add them in Edit Profile, Social Links." },
    { cta: [
      { to: "/platform/help/which-accounts-can-i-connect", label: "Which accounts can I connect?" },
      { to: "/platform/help/how-do-i-disconnect-a-linked-account", label: "Disconnect an account" }
    ]}
  ]
};
