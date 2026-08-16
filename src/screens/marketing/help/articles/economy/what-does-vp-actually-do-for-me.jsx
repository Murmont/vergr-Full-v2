// Help center article: What does VP actually do for me?
// Edit the text freely. Block model:
//   { p } paragraph · { h2 } heading · { list:[...] } bullets · { steps:[...] } numbered
//   { faq:[[q,a],...] } · { note } callout · { cta:[{ to, label }] } related links
// Top-level: summary (1-2 sentences, answer-first), updated (YYYY-MM-DD), body [].

export default {
  summary: "VP sets your rank and unlocks avatar rings, badges, and status across the platform. VP is a status ladder, not a money ladder: the share of revenue Vergr pays a creator is set by their lifetime earnings, not by VP.",
  updated: "2026-06-06",
  body: [
    {
      p: "VP can look like just a number, but it has a direct effect on your money. Here is what it really buys you."
    },
    {
      h2: "Lower fees, the big one"
    },
    {
      p: "VP does not change what you are paid. Your revenue share starts at 50% and rises to 80% as your lifetime earnings grow, and nothing about VP, your rank or your subscription moves it. What VP buys is standing: rings, badges, and progression."
    },
    {
      h2: "Status and recognition"
    },
    {
      list: [
        "Avatar rings and badges that show your rank wherever you appear.",
        "A higher place on the leaderboards.",
        "Visible proof of how active and established you are, which matters when people decide who to follow, squad with, or tip."
      ]
    },
    {
      h2: "What VP is not"
    },
    {
      p: "VP is not a currency. You cannot spend it or send it. Its entire job is to track your standing and reward it with a better revenue share and recognition. So you never have to choose between spending VP and keeping it, just keep earning it."
    },
    {
      cta: [
        {
          to: "/platform/help/how-do-i-earn-vp",
          label: "Earning VP"
        },
        {
          to: "/platform/help/how-does-rank-lower-my-fees",
          label: "How rank lowers fees"
        },
        {
          to: "/platform/help/what-are-the-vergr-ranks",
          label: "The ranks"
        }
      ]
    }
  ]
};
