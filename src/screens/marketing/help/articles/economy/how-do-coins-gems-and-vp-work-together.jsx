// Help center article: How do Coins, Gems, and VP work together?
// Edit the text freely. Block model:
//   { p } paragraph · { h2 } heading · { list:[...] } bullets · { steps:[...] } numbered
//   { faq:[[q,a],...] } · { note } callout · { cta:[{ to, label }] } related links
// Top-level: summary (1-2 sentences, answer-first), updated (YYYY-MM-DD), body [].

export default {
  summary: "Coins are what you spend and earn inside the app. Gems are what you cash out as real money. VP is your progress that lowers the fee you pay to turn Coins into Gems. Put simply: earn Coins, build VP as you go, convert Coins to Gems at a better rate the higher your rank, then withdraw.",
  updated: "2026-06-06",
  body: [
    {
      p: "Three things, one loop. Once you see how they connect, the whole economy makes sense."
    },
    {
      h2: "What each one is"
    },
    {
      list: [
        "Coins (VC) are the in-app currency. You buy them, win them in tournaments, and receive them as tips. You spend them on event tickets, tips, boosts, and more.",
        "Gems are the only thing you withdraw as real money. You get Gems by converting Coins.",
        "VP (Vergr Points) is your standing. You earn it by being active, and it sets your rank."
      ]
    },
    {
      h2: "How they connect"
    },
    {
      steps: [
        "You earn Coins by competing, streaming, and getting tipped, or you buy them.",
        "While you are active, you build VP, which raises your rank over time.",
        "When you want cash, you convert Coins into Gems. A commission applies, and your rank decides how big it is: higher rank, smaller cut.",
        "You withdraw your Gems once you are identity-verified. The minimum is 1,000 Gems."
      ]
    },
    {
      h2: "Why it is built this way"
    },
    {
      p: "Coins keep everyday spending simple and fast. Gems are kept separate because they are real money, so cashing out runs through verification and a short safety hold. VP rewards the people who put the most in by giving them a better conversion rate, so loyal users keep more of what they earn."
    },
    {
      note: "VP only affects your conversion commission. It is not a currency, you cannot spend it or withdraw it."
    },
    {
      cta: [
        {
          to: "/platform/help/what-is-the-difference-between-coins-and-gems",
          label: "Coins vs Gems"
        },
        {
          to: "/platform/help/how-do-i-convert-coins-into-gems",
          label: "Convert to Gems"
        },
        {
          to: "/platform/help/what-is-vp-and-how-do-i-earn-it",
          label: "Earning VP"
        }
      ]
    }
  ]
};
