// Help center article: My payment will not go through, what do I do?

export default {
  summary: "Most declined payments are the bank being cautious about a first-time merchant: approve the payment in your banking app or tell the bank to allow it, then retry. If it keeps failing, switch method: card, Apple Pay, instant bank transfer, and crypto are all available. Never file a chargeback for a payment that simply failed, nothing was taken.",
  updated: "2026-07-02",
  body: [
    {
      h2: "Quick fixes"
    },
    {
      steps: [
        "Complete the bank confirmation: if a verification popup from your bank appeared and was closed or timed out, the payment cancels itself. Retry and finish that step.",
        "Check your banking app for a declined or blocked notification: approving it there usually whitelists future payments too.",
        "Rule out the basics: enough funds, card not expired, billing details correct.",
        "Try a different method: another card, Apple Pay, instant bank transfer, or cryptocurrency."
      ]
    },
    {
      h2: "Still stuck?"
    },
    {
      p: "Contact support@vergr.app with the time of the attempt and the method used. Support can see what the payment processor reported and tell you exactly why it was refused."
    },
    {
      note: "A failed payment means no money moved, at most a temporary hold that your bank releases on its own within a few days. If money DID leave and no Coins arrived, that is the situation covered in the linked article below."
    },
    {
      cta: [
        { to: "/platform/help/my-payment-failed-what-do-i-do", label: "Failed payments in detail" },
        { to: "/platform/help/i-paid-but-my-coins-did-not-arrive-what-do-i-do", label: "Paid but no Coins" }
      ]
    }
  ]
};
