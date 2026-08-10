// Help center article: How do I cancel my subscription?
// Edit the text freely. Block model:
//   { p } paragraph · { h2 } heading · { list:[...] } bullets · { steps:[...] } numbered
//   { faq:[[q,a],...] } · { note } callout · { cta:[{ to, label }] } related links
// Top-level: summary (1-2 sentences, answer-first), updated (YYYY-MM-DD), body [].

export default {
  summary: "Open your subscription settings and choose to cancel. You keep your plan's features until the end of the period you have already paid for, then you drop back to Free. There is no penalty for cancelling, and you can resubscribe any time.",
  updated: "2026-06-06",
  body: [
    {
      p: "Cancelling a plan is straightforward and there is no catch. You will not lose what you have already paid for."
    },
    {
      h2: "How to cancel"
    },
    {
      steps: [
        "Open your settings and go to subscription.",
        "Choose to cancel your plan.",
        "Confirm. You will see the date your plan runs until."
      ]
    },
    {
      h2: "What happens after"
    },
    {
      p: "You keep all your Lite or Pro features until the end of the period you already paid for. When that runs out, your account drops back to the Free plan. Nothing you created disappears, you just return to Free limits on things like streaming quality and uploads."
    },
    {
      note: "You can resubscribe whenever you like, and you can switch between Lite and Pro from the same settings."
    },
    {
      cta: [
        {
          to: "/platform/help/what-are-the-vergr-plans",
          label: "The plans"
        },
        {
          to: "/platform/help/how-do-i-upgrade-my-plan",
          label: "Upgrade again"
        }
      ]
    }
  ]
};
