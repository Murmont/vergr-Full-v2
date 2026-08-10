// Help center article: How do I appeal a ban or a moderation decision?

export default {
  summary: "Submit an appeal from the app against the specific decision, with a real written explanation (a minimum length is enforced, one-word appeals are rejected). It goes to a reviewer who was not the original decision-maker. One pending appeal per decision; if you are locked out entirely, email support@vergr.app from your account's email address.",
  updated: "2026-07-02",
  body: [
    {
      h2: "How to appeal"
    },
    {
      steps: [
        "Find the enforcement notice: removed content, mute, or ban message.",
        "Open the appeal option and write what actually happened. The form requires a genuine explanation (at least a few sentences), because \"this is wrong\" gives a reviewer nothing to check.",
        "Submit. The appeal enters a dedicated queue, separate from the report queue.",
        "A reviewer looks at the original evidence plus your explanation, and either overturns the decision (restriction lifted, content restored where possible) or upholds it with the appeal closed."
      ]
    },
    {
      h2: "What makes an appeal effective"
    },
    {
      list: [
        "Facts over feelings: what happened, when, and why the decision misread it.",
        "Context the moderator could not see: an inside joke read as a threat, a shared account that was actually compromised, a result dispute with evidence.",
        "Honesty: if you did break a rule but the punishment feels disproportionate, say exactly that. Proportionality arguments get real consideration; denial of the obvious does not."
      ]
    },
    {
      h2: "The limits"
    },
    {
      list: [
        "One pending appeal per decision: duplicates are automatically rejected.",
        "Appeals are not a retry button: a rejected appeal on unchanged facts stays rejected.",
        "Completely locked out? Email support@vergr.app from the email address on the account."
      ]
    },
    {
      cta: [
        { to: "/platform/help/my-account-was-muted-or-banned-what-do-i-do", label: "Handling a restriction" },
        { to: "/platform/help/how-does-vergr-handle-reports", label: "How moderation works" }
      ]
    }
  ]
};
