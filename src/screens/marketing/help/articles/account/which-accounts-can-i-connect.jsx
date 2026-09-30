// Help center article: Which accounts can I connect?
// Was "Which gaming accounts can I link?" until 2026-09-21 (old URL 301s here).
// Block model: { p } | { h2 } | { list:[] } | { steps:[] } | { faq:[[q,a]] } | { note } | { cta:[{to,label}] }
export default {
  summary: "You can connect Twitch and Discord, and add your handle for YouTube, Steam, PlayStation, Xbox, Riot Games, Battle.net, Epic Games and EA. Handles show on your profile; Twitch and Discord do something on VERGR instead.",
  updated: "2026-09-21",
  body: [
    { h2: "Connections that do something" },
    { list: [
      "Twitch: mirrors your Twitch streams on VERGR, with chat synced both ways.",
      "Discord: brings your Discord server over as a VERGR group, with community role rewards."
    ]},
    { h2: "Handles shown on your profile" },
    { list: [
      "YouTube and Steam, which open your channel or Steam page when tapped.",
      "PlayStation Network, Xbox, Riot Games, Battle.net, Epic Games and EA, which copy your ID when tapped."
    ]},
    { p: "Links to anything else, like Instagram, TikTok, X or your website, go in Edit Profile, Social Links." },
    { note: "You can remove any of them at any time from the same Connected accounts screen." },
    { cta: [
      { to: "/platform/help/how-do-i-connect-my-accounts", label: "How to connect an account" },
      { to: "/platform/help/how-do-i-disconnect-a-linked-account", label: "Disconnect an account" }
    ]}
  ]
};
