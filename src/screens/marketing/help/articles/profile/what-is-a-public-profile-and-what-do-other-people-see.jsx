export default {
  summary: "Your public profile shows your username, display name, avatar, banner, bio, follower and following counts, VP rank, social links, and your public posts and clips. Private posts, your wallet, and personal details like your email are never shown.",
  updated: "2026-06-06",
  body: [
    { p: "Anyone who visits your profile page — whether they follow you or not — sees your public profile. You control what goes on it." },
    { h2: "What is visible to everyone" },
    { list: [
      "Username and display name.",
      "Profile photo and banner.",
      "Bio.",
      "Follower count and following count.",
      "VP rank badge and rank tier.",
      "Social links you have added.",
      "Posts, clips, and articles set to Public.",
      "Your linked gaming accounts and their stats, if you have made them public.",
      "Squad memberships."
    ]},
    { h2: "What is never shown publicly" },
    { list: [
      "Your email address or phone number.",
      "Your wallet balance and transaction history.",
      "Your date of birth.",
      "Posts set to Followers-only or Squad-only.",
      "Your direct messages."
    ]},
    { h2: "Making your profile private" },
    { p: "If you go to Settings and set your profile to private, your posts and follower list are hidden from non-followers. Your username and avatar remain searchable so people can still find and follow-request you." },
    { cta: [
      { to: "/platform/help/how-do-i-make-my-profile-private", label: "Making your profile private" },
      { to: "/platform/help/how-do-i-edit-my-profile", label: "Editing your profile" }
    ]}
  ]
};
