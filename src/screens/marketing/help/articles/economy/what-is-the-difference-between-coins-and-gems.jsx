// Help center article: What is the difference between Coins and Gems?
// Edit the text freely. Block model:
//   { p } paragraph · { h2 } heading · { list:[...] } bullets · { steps:[...] } numbered
//   { faq:[[q,a],...] } · { note } callout · { cta:[{ to, label }] } related links
// Top-level: summary (1-2 sentences, answer-first), updated (YYYY-MM-DD), body [].

export default {
  summary: "Coins are what you spend inside VERGR. Gems are what you withdraw as real money. You convert Coins into Gems when you want to cash out.",
  updated: "2026-06-06",
  body: [
    {
      p: "This one trips up a lot of new people, so here it is plainly. Coins move around inside the app. Gems come out as money."
    },
    {
      h2: "Coins"
    },
    {
      list: [
        "The in-app currency.",
        "Used for tips, stream passes, subscriptions, and boosts.",
        "Bought in the Shop, or earned by competing and getting tipped."
      ]
    },
    {
      h2: "Gems"
    },
    {
      list: [
        "The withdrawable currency.",
        "Created by converting your Coins.",
        "Cashed out to a crypto wallet, with a 1,000-Gem minimum."
      ]
    },
    {
      h2: "Why two currencies?"
    },
    {
      p: "Keeping spending and cashing-out separate makes the economy clearer and the payouts cleaner. When you earn Coins and want real money, you convert to Gems and withdraw. That conversion is also where your rank pays off, because a higher rank means a smaller cut."
    },
    {
      cta: [
        {
          to: "/platform/help/how-do-i-convert-coins-into-gems",
          label: "How to convert"
        },
        {
          to: "/platform/help/what-is-vp-vergr-points",
          label: "How rank lowers your cut"
        }
      ]
    }
  ]
};
