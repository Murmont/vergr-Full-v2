// Help center article: How do I withdraw to my bank account?
// Edit the text freely. Block model:
//   { p } paragraph · { h2 } heading · { list:[...] } bullets · { steps:[...] } numbered
//   { faq:[[q,a],...] } · { note } callout · { cta:[{ to, label }] } related links
// Top-level: summary (1-2 sentences, answer-first), updated (YYYY-MM-DD), body [].

export default {
  summary: "Payouts are crypto-only right now, so there is no direct bank withdrawal. The usual route is to withdraw your Gems to a crypto wallet, then use an exchange that supports cashing out to your bank. The withdraw screen has a helper that points you to a recommended option.",
  updated: "2026-06-06",
  body: [
    {
      p: "Let us be straight about this: VERGR pays out in crypto, not directly to a bank. So there is no \"withdraw to my bank\" button. But getting your earnings into your bank is still doable in two steps."
    },
    {
      h2: "The two-step route"
    },
    {
      steps: [
        "Withdraw your Gems from VERGR to a crypto wallet address you control.",
        "Move that crypto to an exchange that supports cashing out to your bank in your country.",
        "Cash out from the exchange to your bank account."
      ]
    },
    {
      h2: "Help finding an option"
    },
    {
      p: "On the withdraw screen there is a helper that points you toward a reputable exchange that supports the payout currency and bank withdrawals, so you are not guessing where to send it. Pick one that operates in your country."
    },
    {
      note: "Because the first step is a crypto transfer, double-check your wallet address before confirming. Crypto payouts cannot be reversed if sent to the wrong address."
    },
    {
      cta: [
        {
          to: "/platform/help/can-i-withdraw-in-regular-money-instead-of-crypto",
          label: "Crypto vs regular money"
        },
        {
          to: "/platform/help/how-do-i-withdraw-my-earnings",
          label: "How to withdraw"
        }
      ]
    }
  ]
};
