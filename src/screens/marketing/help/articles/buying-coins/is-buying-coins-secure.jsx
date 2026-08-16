// Help center article: Is buying Coins secure?

export default {
  summary: "Yes. Payments run through a dedicated secure checkout, your card details go to the payment processor, never to VERGR, and nothing about your card is stored on your VERGR account. Coins are credited the moment the payment clears, and every purchase is written to your transaction history.",
  updated: "2026-07-02",
  body: [
    {
      h2: "How the payment is protected"
    },
    {
      list: [
        "The checkout opens in a secure, encrypted payment window run by the payment processor. You type your card details there, not into VERGR.",
        "VERGR never sees or stores your card number. What your account records is the result: the amount paid and the Coins credited.",
        "Apple Pay and instant bank transfer never expose card numbers at all.",
        "Every purchase appears in your wallet's transaction history with a reference, so there is always a paper trail."
      ]
    },
    {
      h2: "Protecting your account side"
    },
    {
      list: [
        "Your wallet can be locked behind a PIN and two-factor authentication in Wallet Security settings.",
        "Payouts only go to details you set up and verified, so even a compromised login cannot redirect your earnings.",
        "If you ever see a charge you do not recognise, contact support@vergr.app within 30 days: confirmed erroneous charges are refunded to the original payment method."
      ]
    },
    {
      note: "One habit worth keeping: only ever buy Coins inside the app or on vergr.app. Nobody from VERGR will ever ask you to pay through a link in a DM."
    },
    {
      cta: [
        { to: "/platform/help/what-payment-methods-can-i-use-to-buy-coins", label: "Payment methods" },
        { to: "/platform/help/my-payment-failed-what-do-i-do", label: "If a payment fails" }
      ]
    }
  ]
};
