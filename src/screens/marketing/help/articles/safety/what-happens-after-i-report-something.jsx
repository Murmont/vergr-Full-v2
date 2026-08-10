// Help center article: What happens after I report something?

export default {
  summary: "Your report lands in the moderation queue, where a human moderator from the Vanguard reviews it and either acts (content removed, user muted or banned) or rejects it with the report closed. Reports involving minors are prioritised automatically, and content that collects several reports gets escalated even before review.",
  updated: "2026-07-02",
  body: [
    {
      h2: "The journey of a report"
    },
    {
      steps: [
        "Your report is filed with a pending status and joins the moderation queue. If the reason involves a minor, it is marked critical and jumps the queue.",
        "A Vanguard moderator claims it, looks at the reported content or account, and any details you added.",
        "They decide: uphold (the content comes down and the user faces consequences scaled to the offence) or reject (nothing wrong found, report closed).",
        "Hard cases do not just get guessed at: they escalate up the chain to senior moderators and beyond."
      ]
    },
    {
      h2: "A few things worth knowing"
    },
    {
      list: [
        "You stay anonymous: the person you reported is never told who reported them.",
        "Multiple reports matter: if the same thing draws several pending reports, it is flagged for urgent attention automatically.",
        "One report per person per item: you cannot stack duplicate reports, and neither can anyone else stack them against you unfairly.",
        "False reporting cuts both ways: deliberately abusive reports are themselves a conduct violation."
      ]
    },
    {
      note: "Reports are reviewed by real people, so timing varies with queue depth. Critical categories are handled first by design."
    },
    {
      cta: [
        { to: "/platform/help/how-does-vergr-handle-reports", label: "Who reviews reports" },
        { to: "/platform/help/how-do-i-appeal-a-ban-or-a-moderation-decision", label: "If you were the one reported" }
      ]
    }
  ]
};
