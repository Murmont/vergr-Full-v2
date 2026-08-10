export default {
  summary: "You choose each post's audience when you create it: Public (anyone), Followers (only people who follow you), or Squad (only your squad). Your account-wide content privacy and a private profile can further limit who sees your posts.",
  updated: "2026-06-07",
  body: [
    { h2: "Per-post audience" },
    { list: [
      "Public: visible to everyone, including in search and Explore.",
      "Followers: only people who follow you can see it.",
      "Squad: only members of your squad can see it.",
    ]},
    { h2: "How to set it" },
    { p: "In the composer, use the visibility picker (next to your name) before you post. You can pick a different audience for every post." },
    { h2: "Account-level limits" },
    { p: "If you set a private profile, even your public posts are only visible to approved followers. The 'Who can view my content' privacy setting applies an account-wide default too." },
    { cta: [
      { to: "/platform/help/how-do-i-control-who-can-see-my-content", label: "Account-wide content privacy" },
      { to: "/platform/help/how-do-i-make-my-profile-private", label: "Private profile" }
    ]}
  ]
};
