// Help center article: Which currency can I withdraw as real money?
// Edit the text freely. Block model:
//   { p } paragraph · { h2 } heading · { list:[...] } bullets · { steps:[...] } numbered
//   { faq:[[q,a],...] } · { note } callout · { cta:[{ to, label }] } related links
// Top-level: summary (1-2 sentences, answer-first), updated (YYYY-MM-DD), body [].

export default {
  summary: "Gems. Gems are the only currency you can withdraw as real money. Coins stay inside the app for spending and earning, so to cash out you convert your Coins into Gems first, then withdraw the Gems once you are identity-verified. The minimum withdrawal is 1,000 Gems.",
  updated: "2026-06-06",
  body: [
    {
      p: "Short answer: Gems are your cash-out currency. Coins are not directly withdrawable, they are the in-app currency you spend and earn with."
    },
    {
      h2: "The cash-out path"
    },
    {
      steps: [
        "Earn or hold Coins from tips, paid streams, memberships, and more.",
        "Convert Coins into Gems. A commission applies, set by your rank.",
        "Complete identity verification if you have not already.",
        "Withdraw your Gems, with a minimum of 1,000 Gems per withdrawal."
      ]
    },
    {
      h2: "Why two currencies"
    },
    {
      p: "Coins keep in-app spending quick and frictionless. Gems are treated as real money, so they live behind verification and a short safety hold on withdrawal. Splitting them keeps everyday activity simple while protecting the money you actually take out."
    },
    {
      note: "Withdrawals are paid to a cryptocurrency wallet address you provide. There is no direct bank payout, see the withdrawing articles for how to turn that into cash."
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
          to: "/platform/help/do-i-need-to-be-verified-to-withdraw-gems",
          label: "Verification to withdraw"
        }
      ]
    }
  ]
};
