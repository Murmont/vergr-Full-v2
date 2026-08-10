// Help center article: Can I withdraw in regular money instead of crypto?
// Edit the text freely. Block model:
//   { p } paragraph · { h2 } heading · { list:[...] } bullets · { steps:[...] } numbered
//   { faq:[[q,a],...] } · { note } callout · { cta:[{ to, label }] } related links
// Top-level: summary (1-2 sentences, answer-first), updated (YYYY-MM-DD), body [].

export default {
  summary: "Not directly. VERGR pays out in crypto, so withdrawals go to a cryptocurrency wallet address you control, not straight to a bank. To end up with regular money, you withdraw to a wallet and then cash out through an exchange that supports your bank. The withdraw screen points you to a recommended option.",
  updated: "2026-06-06",
  body: [
    {
      p: "Being upfront: there is no direct fiat or bank payout at the moment. Withdrawals are crypto-only. That does not mean you cannot end up with cash in your bank, it just takes one extra step through an exchange."
    },
    {
      h2: "Getting to regular money"
    },
    {
      steps: [
        "Convert your Coins to Gems in the wallet.",
        "Withdraw your Gems to a crypto wallet address you control.",
        "Send that crypto to an exchange that operates in your country and supports bank withdrawals.",
        "Cash out from the exchange to your bank."
      ]
    },
    {
      h2: "Finding an exchange"
    },
    {
      p: "The withdraw screen includes a helper that recommends a reputable exchange supporting the payout currency and bank cash-out. Choose one available where you live and follow its own withdrawal process for the final step."
    },
    {
      note: "The first step is a crypto transfer, which cannot be reversed if sent to the wrong address. Always double-check the wallet address before confirming."
    },
    {
      cta: [
        {
          to: "/platform/help/how-do-i-withdraw-to-my-bank-account",
          label: "Withdraw to a bank"
        },
        {
          to: "/platform/help/how-do-i-cash-out-my-gems",
          label: "Cash out Gems"
        }
      ]
    }
  ]
};
