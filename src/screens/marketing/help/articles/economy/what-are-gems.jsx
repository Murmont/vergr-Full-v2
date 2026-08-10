// Help center article: What are Gems?
// Edit the text freely. Block model:
//   { p } paragraph · { h2 } heading · { list:[...] } bullets · { steps:[...] } numbered
//   { faq:[[q,a],...] } · { note } callout · { cta:[{ to, label }] } related links
// Top-level: summary (1-2 sentences, answer-first), updated (YYYY-MM-DD), body [].

export default {
  summary: "Gems are the withdrawable currency on VERGR. You get them by converting Coins, and you cash them out to a crypto wallet. The minimum withdrawal is 1,000 Gems.",
  updated: "2026-06-06",
  body: [
    {
      p: "Gems are the side of the economy you cash out. Coins are for spending inside VERGR; Gems are for taking value out."
    },
    {
      h2: "How you get Gems"
    },
    {
      p: "You convert Coins into Gems. The rate depends on your rank, since a higher rank means a smaller commission on the conversion. Once you hold Gems, you can request a withdrawal."
    },
    {
      h2: "Cashing out Gems"
    },
    {
      list: [
        "The minimum withdrawal is 1,000 Gems.",
        "Withdrawals go to a crypto wallet address you set up and verify.",
        "There is a short hold for fraud review before a payout is sent.",
        "Any fees are shown before you confirm."
      ]
    },
    {
      note: "You need to complete a one-time identity check before you can withdraw. That is standard for anything that pays out real money."
    },
    {
      cta: [
        {
          to: "/platform/help/how-do-i-convert-coins-into-gems",
          label: "Convert Coins to Gems"
        },
        {
          to: "/platform/help/how-do-i-withdraw-my-earnings",
          label: "How to withdraw"
        },
        {
          to: "/platform/help/what-is-the-minimum-withdrawal",
          label: "Minimum withdrawal"
        }
      ]
    }
  ]
};
