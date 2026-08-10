// Help center article: What payment methods can I use to buy Coins?
// Edit the text freely. Block model:
//   { p } paragraph · { h2 } heading · { list:[...] } bullets · { steps:[...] } numbered
//   { faq:[[q,a],...] } · { note } callout · { cta:[{ to, label }] } related links
// Top-level: summary (1-2 sentences, answer-first), updated (YYYY-MM-DD), body [].

export default {
  summary: "You can buy Coins with a debit or credit card or with cryptocurrency through the in-app checkout. Google Pay and Apple Pay are not supported yet. Both card and crypto work in every region VERGR operates in, and your Coins land in your wallet once the payment clears.",
  updated: "2026-06-06",
  body: [
    {
      p: "Buying Coins is done through the in-app Shop, and there are two payment methods available today."
    },
    {
      h2: "Card"
    },
    {
      p: "Pay with a debit or credit card in the checkout popup. It is the quickest route for most people, and your Coins appear in your wallet as soon as the payment clears. Your full card details are never stored by VERGR."
    },
    {
      h2: "Cryptocurrency"
    },
    {
      p: "Prefer not to use a card? You can pay in crypto through the same checkout, including common stablecoins and major coins. It works in every region VERGR operates in."
    },
    {
      h2: "Not supported yet"
    },
    {
      p: "Google Pay and Apple Pay are not available for Coin purchases right now. They are on the list, but for now card and crypto cover everything."
    },
    {
      note: "Bigger packs give a better rate per Coin, and the top two packs include bonus VP."
    },
    {
      cta: [
        {
          to: "/platform/help/how-do-i-buy-vc-coins",
          label: "How to buy Coins"
        },
        {
          to: "/platform/help/why-can-i-not-pay-with-google-pay-or-apple-pay",
          label: "Why no Google or Apple Pay?"
        }
      ]
    }
  ]
};
