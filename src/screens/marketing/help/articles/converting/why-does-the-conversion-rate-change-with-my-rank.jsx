// Help center article: Why does the conversion rate change with my rank?
// Edit the text freely. Block model:
//   { p } paragraph · { h2 } heading · { list:[...] } bullets · { steps:[...] } numbered
//   { faq:[[q,a],...] } · { note } callout · { cta:[{ to, label }] } related links
// Top-level: summary (1-2 sentences, answer-first), updated (YYYY-MM-DD), body [].

export default {
  summary: "Because VERGR rewards the people who put the most in. Instead of charging everyone the same flat conversion fee, the commission steps down as your VP rises, from 30% to a 15% floor at 100,000 VP. The more active and established you are, the more of your Coins you keep when you turn them into Gems.",
  updated: "2026-06-06",
  body: [
    {
      p: "The conversion rate is tied to your rank on purpose. It is a loyalty system, not a random fee. Climbing pays you back every single time you cash out."
    },
    {
      h2: "The logic"
    },
    {
      p: "A flat fee treats a brand-new account and a long-time competitor exactly the same. VERGR does the opposite: the players who compete, create, and stay active build VP, climb the ranks, and unlock a smaller cut on conversion. So the people contributing most to the platform keep the most of their earnings."
    },
    {
      h2: "How much it moves"
    },
    {
      p: "At the start the commission is 30%. It steps down at a few VP thresholds as you earn, reaching a 15% floor at 100,000 VP, and it never goes below 15%. Earning VP through competing, posting, and engaging is what brings it down."
    },
    {
      note: "The rate follows your rank, not your subscription plan. Paid plans earn VP faster (so they reach lower rates sooner), but the rate itself is set by rank."
    },
    {
      cta: [
        {
          to: "/platform/help/what-is-the-conversion-rate-at-each-rank",
          label: "Rate at each rank"
        },
        {
          to: "/platform/help/how-do-i-lower-my-conversion-commission",
          label: "Lower your commission"
        },
        {
          to: "/platform/help/what-are-the-vergr-ranks",
          label: "The ranks"
        }
      ]
    }
  ]
};
