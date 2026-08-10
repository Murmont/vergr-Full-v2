// Help center article: What fees apply when I withdraw?
// Edit the text freely. Block model:
//   { p } paragraph · { h2 } heading · { list:[...] } bullets · { steps:[...] } numbered
//   { faq:[[q,a],...] } · { note } callout · { cta:[{ to, label }] } related links
// Top-level: summary (1-2 sentences, answer-first), updated (YYYY-MM-DD), body [].

export default {
  summary: "Withdrawing carries a 2% platform spread, applied when your Gems are converted for payout. Any standard network cost for the crypto transfer may also apply. All fees are shown before you confirm, so you always see the exact amount you will receive first.",
  updated: "2026-06-06",
  body: [
    {
      p: "There are no surprise charges on a withdrawal. The fees are clear and you see them before you confirm anything."
    },
    {
      h2: "The fees"
    },
    {
      list: [
        "A 2% platform spread, applied when your Gems are converted for the payout.",
        "Any standard network cost for the crypto transfer itself, which depends on the network."
      ]
    },
    {
      h2: "You see it before you confirm"
    },
    {
      p: "Before you commit to a withdrawal, the exact amount you will receive after fees is shown. There is no hidden deduction discovered later, what you see is what lands."
    },
    {
      h2: "Worth remembering"
    },
    {
      p: "The bigger fee on your earnings overall is usually the conversion commission when you turn Coins into Gems, which drops as you rank up. The withdrawal spread itself is a flat 2%. Ranking up is the main lever for keeping more of what you earn."
    },
    {
      cta: [
        {
          to: "/platform/help/what-is-the-conversion-commission",
          label: "Conversion commission"
        },
        {
          to: "/platform/help/how-do-i-withdraw-my-earnings",
          label: "How to withdraw"
        }
      ]
    }
  ]
};
