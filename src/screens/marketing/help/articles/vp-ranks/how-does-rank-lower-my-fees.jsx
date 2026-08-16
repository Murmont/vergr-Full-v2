// Help center article: How does rank lower my fees?
// Edit the text freely. Block model:
//   { p } paragraph · { h2 } heading · { list:[...] } bullets · { steps:[...] } numbered
//   { faq:[[q,a],...] } · { note } callout · { cta:[{ to, label }] } related links
// Top-level: summary (1-2 sentences, answer-first), updated (YYYY-MM-DD), body [].

export default {
  summary: "Your VP sets the share Vergr keeps of what your content earns. It starts at 30% and steps down to a 15% floor reached at 100,000 VP. VP does not change what you are paid at all: your revenue share is set by your lifetime earnings.",
  updated: "2026-06-06",
  body: [
    {
      p: "What rank affects is the share Vergr keeps of what your content earns. That is where ranking up pays you back."
    },
    {
      h2: "How it works"
    },
    {
      p: "The share Vergr keeps is calculated from your lifetime VP. It is 30% at the start and steps down at a few VP thresholds, reaching a 15% floor at 100,000 VP and never dropping below it. Earning VP is what trims it, so competing, posting, and engaging all help."
    },
    {
      h2: "What it means in practice"
    },
    {
      list: [
        "At the lowest rank, Vergr keeps 30% of what your content earns.",
        "At the highest rank, Vergr keeps only 15%.",
        "Over many conversions, that difference adds up to a meaningful amount of kept earnings."
      ]
    },
    {
      h2: "The one fee rank does not touch"
    },
    {
      p: "Your rank does not change what you are paid, and neither does your plan. Only lifetime earnings do. Keeping rank out of the money keeps creator payouts simple and predictable for everyone."
    },
    {
      cta: [
        {
          to: "/platform/help/what-fees-does-vergr-charge",
          label: "What VERGR charges"
        },
        {
          to: "/platform/help/what-do-i-unlock-at-each-rank",
          label: "What each rank unlocks"
        },
        {
          to: "/platform/help/how-do-i-rank-up",
          label: "How to rank up"
        }
      ]
    }
  ]
};
