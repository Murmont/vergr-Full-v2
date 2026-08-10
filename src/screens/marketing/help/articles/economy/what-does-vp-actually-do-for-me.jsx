// Help center article: What does VP actually do for me?
// Edit the text freely. Block model:
//   { p } paragraph · { h2 } heading · { list:[...] } bullets · { steps:[...] } numbered
//   { faq:[[q,a],...] } · { note } callout · { cta:[{ to, label }] } related links
// Top-level: summary (1-2 sentences, answer-first), updated (YYYY-MM-DD), body [].

export default {
  summary: "VP sets your rank, and more VP lowers the commission you pay when converting Coins to Gems, from 30% down to a 15% floor at 100,000 VP. It also unlocks avatar rings, badges, and status across the platform. The practical payoff: the more VP you have, the more of your earnings you keep when you cash out.",
  updated: "2026-06-06",
  body: [
    {
      p: "VP can look like just a number, but it has a direct effect on your money. Here is what it really buys you."
    },
    {
      h2: "Lower fees, the big one"
    },
    {
      p: "Your VP decides the commission taken when you convert Coins into withdrawable Gems. It starts at 30%, and it steps down as your VP grows, reaching a 15% floor at 100,000 VP. For anyone who cashes out regularly, that gap is real money kept in your pocket."
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
      p: "VP is not a currency. You cannot spend it, send it, or withdraw it. Its entire job is to track your standing and reward it with lower fees and recognition. So you never have to choose between spending VP and keeping it, just keep earning it."
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
