// Help center article: How do I withdraw my earnings?
// Edit the text freely. Block model:
//   { p } paragraph · { h2 } heading · { list:[...] } bullets · { steps:[...] } numbered
//   { faq:[[q,a],...] } · { note } callout · { cta:[{ to, label }] } related links
// Top-level: summary (1-2 sentences, answer-first), updated (YYYY-MM-DD), body [].

export default {
  summary: "Convert your Coins to Gems, then request a withdrawal to a crypto wallet address. The minimum is 1,000 Gems, there is a short hold for fraud review, and you need to be identity-verified first.",
  updated: "2026-06-06",
  body: [
    {
      p: "Cashing out is a two-step idea: turn Coins into Gems, then withdraw the Gems. Here is the whole thing."
    },
    {
      h2: "Before you can withdraw"
    },
    {
      p: "You need to complete a one-time identity check. It is required for anything that pays out real money, and it unlocks withdrawals on your account."
    },
    {
      h2: "How to withdraw"
    },
    {
      steps: [
        "Convert your Coins into Gems in the wallet.",
        "Go to the withdraw screen and set up the crypto wallet address you want to be paid to.",
        "Request a withdrawal of at least 1,000 Gems.",
        "Confirm. The amount and any fees are shown before you commit."
      ]
    },
    {
      h2: "What happens next"
    },
    {
      p: "Your request goes through a short hold for fraud review, then it is sent in the next outbound batch. You can track the status from your wallet."
    },
    {
      note: "Double-check your withdrawal address before you confirm. Crypto payouts cannot be reversed if they go to the wrong address."
    },
    {
      h2: "Can I withdraw to my bank?"
    },
    {
      p: "Payouts are crypto-only right now. If you want it in your bank, the usual route is to withdraw to a wallet and then use an exchange that supports cashing out to your bank. There is a helper on the withdraw screen that points you in the right direction."
    },
    {
      cta: [
        {
          to: "/platform/help/how-do-i-convert-coins-into-gems",
          label: "Convert Coins to Gems"
        },
        {
          to: "/platform/help/what-is-the-minimum-withdrawal",
          label: "Minimum withdrawal"
        }
      ]
    }
  ]
};
