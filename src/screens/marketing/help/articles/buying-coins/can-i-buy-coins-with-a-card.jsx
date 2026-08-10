// Help center article: Can I buy Coins with a card?
// Edit the text freely. Block model:
//   { p } paragraph · { h2 } heading · { list:[...] } bullets · { steps:[...] } numbered
//   { faq:[[q,a],...] } · { note } callout · { cta:[{ to, label }] } related links
// Top-level: summary (1-2 sentences, answer-first), updated (YYYY-MM-DD), body [].

export default {
  summary: "Yes. A debit or credit card is the quickest way to buy Coins. Open the Shop, pick a pack or custom amount, and pay by card in the checkout popup. Your Coins appear as soon as the payment clears. VERGR never stores your full card details.",
  updated: "2026-06-06",
  body: [
    {
      p: "Card is the fastest and most common way to top up. It clears in seconds for most people and the Coins are usable right away."
    },
    {
      h2: "How to pay by card"
    },
    {
      steps: [
        "Open the Shop from the wallet or the top of the app.",
        "Choose a Coin pack or enter a custom amount.",
        "Select the card option in the checkout popup.",
        "Enter your card details and confirm.",
        "Your Coins land in your wallet once the payment clears."
      ]
    },
    {
      h2: "Your card is handled safely"
    },
    {
      p: "Card payments run through a secure checkout, and VERGR does not store your full card number. If a payment is declined, it is usually your bank, not VERGR, double-check the details or try crypto instead."
    },
    {
      note: "Google Pay and Apple Pay are not supported yet, only card and crypto."
    },
    {
      cta: [
        {
          to: "/platform/help/what-payment-methods-can-i-use-to-buy-coins",
          label: "All payment methods"
        },
        {
          to: "/platform/help/my-payment-failed-what-do-i-do",
          label: "Payment failed?"
        }
      ]
    }
  ]
};
