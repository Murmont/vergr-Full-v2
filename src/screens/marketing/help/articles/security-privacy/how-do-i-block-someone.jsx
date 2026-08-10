// Help center article: How do I block someone?
// Edit the text freely. Block model:
//   { p } paragraph · { h2 } heading · { list:[...] } bullets · { steps:[...] } numbered
//   { faq:[[q,a],...] } · { note } callout · { cta:[{ to, label }] } related links
// Top-level: summary (1-2 sentences, answer-first), updated (YYYY-MM-DD), body [].

export default {
  summary: "Open the person's profile or your chat with them, open the menu, and choose Block. Once blocked, they can no longer message you, follow you, or interact with your content. You can unblock them later from your privacy settings if you change your mind.",
  updated: "2026-06-06",
  body: [
    {
      p: "Blocking someone cuts them off from you completely, and it is instant. Use it whenever someone is bothering you, no explanation needed."
    },
    {
      h2: "How to block"
    },
    {
      steps: [
        "Open the person's profile, or open your conversation with them.",
        "Open the menu (the three-dot or options icon).",
        "Choose Block and confirm."
      ]
    },
    {
      h2: "What blocking does"
    },
    {
      list: [
        "They can no longer message you or call you.",
        "They cannot follow you or interact with your posts.",
        "They are removed from your interactions going forward."
      ]
    },
    {
      h2: "Changing your mind"
    },
    {
      p: "If you want to undo it, you can unblock the person from your privacy settings, where your blocked list lives. Blocking is not permanent unless you want it to be."
    },
    {
      note: "If someone is breaking the rules, consider reporting them as well as blocking, so moderators can act beyond your own account."
    },
    {
      cta: [
        {
          to: "/platform/help/how-do-i-unblock-someone",
          label: "Unblock someone"
        },
        {
          to: "/platform/help/how-do-i-report-someone",
          label: "Report someone"
        }
      ]
    }
  ]
};
