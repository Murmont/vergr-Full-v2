// Help center article: How do I reduce the commission charged when I withdraw?
// Edit the text freely. Block model:
//   { p } paragraph · { h2 } heading · { list:[...] } bullets · { steps:[...] } numbered
//   { faq:[[q,a],...] } · { note } callout · { cta:[{ to, label }] } related links
// Top-level: summary (1-2 sentences, answer-first), updated (YYYY-MM-DD), body [].

export default {
  summary: "The biggest cut on your earnings is the conversion commission when you turn Coins into Gems, and that steps down as your VP grows, from 30% to a 15% floor. So the real way to keep more is to earn VP. The withdrawal step itself is a flat 2% spread that VP does not change.",
  updated: "2026-06-06",
  body: [
    {
      p: "There are two separate charges on the way to cash, and it helps to know which one you can actually move."
    },
    {
      h2: "The two charges"
    },
    {
      list: [
        "Conversion commission: taken when you convert Coins to Gems. This is the big one, 30% stepping down to a 15% floor at 100,000 VP, and it shrinks as you earn more VP.",
        "Withdrawal spread: a flat 2% when Gems are paid out, plus any network cost. This one does not change with rank."
      ]
    },
    {
      h2: "How to keep more"
    },
    {
      p: "Focus on rank. Earning VP through tournaments, creator quests, and referrals lowers your conversion commission level by level, which is where most of the savings live. Paid plans earn VP faster (1.5x on Lite, 2x on Pro), so they reach the lower rates sooner."
    },
    {
      h2: "Practical tips"
    },
    {
      list: [
        "If you are about to rank up, converting after you cross the threshold means a smaller commission on that conversion.",
        "Convert deliberate amounts rather than constantly, you only pay the commission on what you convert.",
        "The exact rate is shown in the wallet before you confirm, so you can always check first."
      ]
    },
    {
      cta: [
        {
          to: "/platform/help/what-is-the-conversion-commission",
          label: "Conversion commission"
        },
        {
          to: "/platform/help/what-fees-apply-when-i-withdraw",
          label: "Withdrawal fees"
        },
        {
          to: "/platform/help/how-do-i-lower-my-conversion-commission",
          label: "Lower your commission"
        }
      ]
    }
  ]
};
