export default {
  summary: "Deleting your account removes your profile, posts, and personal data from VERGR. Some records may be kept briefly where the law requires it (for example financial and anti-fraud records tied to payments). Withdraw any Gem balance before deleting — deletion does not pay out your wallet.",
  updated: "2026-06-07",
  body: [
    { p: "Account deletion is permanent. Make sure you are ready before you confirm it." },
    { h2: "What gets removed" },
    { list: [
      "Your public profile, posts, clips, and content.",
      "Your personal account information.",
      "Your presence across the app — you stop appearing in search, feeds, and follower lists.",
    ]},
    { h2: "What may be retained" },
    { p: "Where law requires it, VERGR may keep limited records for a period — for example transaction and identity records connected to payments, withdrawals, and fraud prevention. These are retained for compliance, not used to rebuild your profile." },
    { note: "Cash out first. Withdraw your Gems before deleting — a deleted account cannot recover or pay out a remaining balance." },
    { cta: [
      { to: "/platform/help/how-do-i-delete-my-account", label: "How to delete your account" },
      { to: "/platform/help/how-do-i-cash-out-my-gems", label: "Cash out your Gems first" }
    ]}
  ]
};
