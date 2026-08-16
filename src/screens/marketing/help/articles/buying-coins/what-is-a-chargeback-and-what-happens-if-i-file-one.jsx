// Help center article: What is a chargeback and what happens if I file one?

export default {
  summary: "A chargeback is asking your bank to forcibly reverse a payment instead of resolving it with the seller. On VERGR it has serious consequences: the purchased Coins are reversed, anything already spent from them is debited, payouts are blocked for 180 days, and the account can be suspended. Real payment problems are fixed faster and consequence-free by emailing support first.",
  updated: "2026-07-02",
  body: [
    {
      h2: "What a chargeback is"
    },
    {
      p: "When you dispute a charge with your card issuer, the bank claws the money back from the seller by force. It exists to protect people from fraud, and for genuine fraud it is the right tool. The problem is when it is used as a shortcut for things support would fix anyway, because the platform cannot tell the difference between a fraud victim and someone reversing a purchase they already spent."
    },
    {
      h2: "What happens on VERGR if you file one"
    },
    {
      list: [
        "The Coins from that purchase are reversed out of your wallet.",
        "If you already spent them, the spent amount is debited from your balance.",
        "Payouts are blocked on your account for 180 days after any chargeback or payment dispute.",
        "The account can be suspended or terminated, and chargeback fees can apply."
      ]
    },
    {
      h2: "What to do instead"
    },
    {
      p: "Email support@vergr.app first with the date and amount. Duplicate charges, coins that did not arrive, and unauthorised charges are all refundable through support within 30 days, with none of the consequences above. If someone genuinely stole your card and bought Coins with it, tell support that too: unauthorised-use refunds exist precisely for that case."
    },
    {
      cta: [
        { to: "/platform/help/can-i-get-a-refund-on-a-coin-purchase", label: "How refunds actually work" },
        { to: "/platform/help/i-paid-but-my-coins-did-not-arrive-what-do-i-do", label: "Coins did not arrive?" }
      ]
    }
  ]
};
