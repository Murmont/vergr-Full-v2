// Help center article: How do I report someone?
// Edit the text freely. Block model:
//   { p } paragraph · { h2 } heading · { list:[...] } bullets · { steps:[...] } numbered
//   { faq:[[q,a],...] } · { note } callout · { cta:[{ to, label }] } related links
// Top-level: summary (1-2 sentences, answer-first), updated (YYYY-MM-DD), body [].

export default {
  summary: "Open the person's profile, post, message, or stream, open the menu, and choose Report. Pick a reason and add detail if you can. Reports go to moderators for review, and you can block the person at the same time. Reporting is confidential.",
  updated: "2026-06-06",
  body: [
    {
      p: "If someone is breaking the rules or making your experience worse, report them. It is quick, it is confidential, and it lets moderators act beyond just your own account."
    },
    {
      h2: "How to report"
    },
    {
      steps: [
        "Open the profile, post, message, or stream involved.",
        "Open the menu (the three-dot or options icon).",
        "Choose Report.",
        "Pick the reason that fits, and add detail if you can.",
        "Submit. Consider blocking the person too, for your own peace of mind."
      ]
    },
    {
      h2: "What happens next"
    },
    {
      p: "Your report goes into the moderation queue, where the Vanguard moderator team and the platform review it against the Code of Conduct. Action can range from a warning to a mute or a ban, depending on what is found. Reports are confidential, so the person does not see who reported them."
    },
    {
      note: "Reporting and blocking are separate. Blocking protects you right now; reporting helps protect everyone by getting the behaviour reviewed."
    },
    {
      cta: [
        {
          to: "/platform/help/what-happens-after-i-report-something",
          label: "After you report"
        },
        {
          to: "/platform/help/how-do-i-block-someone",
          label: "Block someone"
        }
      ]
    }
  ]
};
