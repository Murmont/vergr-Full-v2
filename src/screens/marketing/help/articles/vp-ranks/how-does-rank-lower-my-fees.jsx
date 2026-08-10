// Help center article: How does rank lower my fees?
// Edit the text freely. Block model:
//   { p } paragraph · { h2 } heading · { list:[...] } bullets · { steps:[...] } numbered
//   { faq:[[q,a],...] } · { note } callout · { cta:[{ to, label }] } related links
// Top-level: summary (1-2 sentences, answer-first), updated (YYYY-MM-DD), body [].

export default {
  summary: "Your VP sets the commission on converting Coins to Gems. It starts at 30% and steps down to a 15% floor reached at 100,000 VP. So the more VP you earn, the more of your earnings you keep each time you cash out. VP does not change the tip fee, which stays a flat 10%.",
  updated: "2026-06-06",
  body: [
    {
      p: "The fee rank affects is the conversion commission, the cut taken when you turn Coins into withdrawable Gems. That is where ranking up pays you back."
    },
    {
      h2: "How it works"
    },
    {
      p: "The commission is calculated from your lifetime VP. It is 30% at the start and steps down at a few VP thresholds, reaching a 15% floor at 100,000 VP and never dropping below it. Earning VP is what trims it, so competing, posting, and engaging all help."
    },
    {
      h2: "What it means in practice"
    },
    {
      list: [
        "A low-rank player converting 1,000 Coins loses 30% to commission.",
        "A high-VP player converting the same 1,000 Coins loses only 15%.",
        "Over many conversions, that difference adds up to a meaningful amount of kept earnings."
      ]
    },
    {
      h2: "The one fee rank does not touch"
    },
    {
      p: "Tips are always a flat 10%, no matter your rank or plan. Rank only changes the conversion commission. Keeping the tip fee flat keeps creator payouts simple and predictable for everyone."
    },
    {
      cta: [
        {
          to: "/platform/help/what-is-the-conversion-commission",
          label: "The conversion commission"
        },
        {
          to: "/platform/help/what-is-the-conversion-rate-at-each-rank",
          label: "Rate at each rank"
        },
        {
          to: "/platform/help/how-do-i-rank-up",
          label: "How to rank up"
        }
      ]
    }
  ]
};
