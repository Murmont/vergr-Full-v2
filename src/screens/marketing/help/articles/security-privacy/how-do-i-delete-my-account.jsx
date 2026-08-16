// Help center article: How do I delete my account?
// Edit the text freely. Block model:
//   { p } paragraph · { h2 } heading · { list:[...] } bullets · { steps:[...] } numbered
//   { faq:[[q,a],...] } · { note } callout · { cta:[{ to, label }] } related links
// Top-level: summary (1-2 sentences, answer-first), updated (YYYY-MM-DD), body [].

export default {
  summary: "You can delete your account from your settings under account deletion. It is permanent: your profile, posts, and data are removed. Any unpaid earnings are lost, because you cannot recover funds after the account is gone. Verification may be required to confirm it is really you.",
  updated: "2026-06-06",
  body: [
    {
      p: "You are always free to leave VERGR, and deleting your account is built into your settings. Just know that it is permanent, so a couple of steps beforehand matter."
    },
    {
      h2: "Before you delete"
    },
    {
      list: [
        "Settle up first. Any unspent Coins and any unpaid revenue share are lost when the account is deleted, and cannot be recovered afterwards.",
        "Download your data if you want a copy of anything.",
        "Settle anything in progress, like an active membership or a pending payout."
      ]
    },
    {
      h2: "How to delete"
    },
    {
      steps: [
        "Open Settings and find the account deletion option.",
        "Read what will be removed.",
        "Confirm. You may need to verify it is really you."
      ]
    },
    {
      h2: "What happens"
    },
    {
      p: "Your profile, posts, and personal data are removed. This cannot be undone, and your username may become available for someone else. Some records may be retained where law requires it (for example, transaction records for compliance), but your active presence on the platform is gone."
    },
    {
      cta: [
        {
          to: "/platform/help/what-happens-to-my-data-when-i-delete-my-account",
          label: "What happens to my data"
        },
        {
          to: "/platform/help/how-do-i-see-my-earnings",
          label: "See your earnings"
        }
      ]
    }
  ]
};
