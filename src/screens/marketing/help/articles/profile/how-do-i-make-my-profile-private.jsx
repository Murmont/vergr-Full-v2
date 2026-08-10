export default {
  summary: "Go to Settings, then Privacy, and toggle on Private Profile. Once private, only your approved followers can see your posts and clips. New followers will need to send a follow request for you to approve.",
  updated: "2026-06-06",
  body: [
    { p: "A private profile does not make you invisible — your username and avatar still appear in search — but it keeps your content away from people who are not following you." },
    { h2: "How to make your profile private" },
    { steps: [
      "Tap the gear icon to go to Settings.",
      "Tap Privacy.",
      "Toggle on Private Profile.",
      "Confirm when prompted."
    ]},
    { h2: "What changes when you go private" },
    { list: [
      "Your posts, clips, and articles are visible only to your current followers.",
      "New followers must send a request that you approve or decline.",
      "Existing followers are not affected.",
      "Your username, avatar, and follower counts are still visible in search."
    ]},
    { h2: "Going public again" },
    { p: "Turn off Private Profile in the same settings screen. All pending follow requests are auto-approved and your content becomes public immediately. You do not need to re-approve your current followers." },
    { cta: [
      { to: "/platform/help/how-do-i-control-who-can-see-my-content", label: "Controlling who sees your content" },
      { to: "/platform/help/how-do-i-block-someone", label: "Blocking users" }
    ]}
  ]
};
