// Help center article: My payment failed, what do I do?

export default {
  summary: "First, check nothing was actually charged: a failed payment usually means no money moved. Then retry, most failures are one-off card declines or bank blocks on a first-time merchant. If it keeps failing, try another method (card, Apple Pay, instant bank, or crypto) or ask your bank to allow the payment.",
  updated: "2026-07-02",
  body: [
    {
      h2: "The usual causes, in order of likelihood"
    },
    {
      list: [
        "Your bank blocked it. Banks often decline the first payment to a merchant they have not seen before. A quick approve in your banking app, or a call to the bank, fixes it permanently.",
        "3D Secure was not completed. If the verification popup from your bank was closed or timed out, the payment cancels. Retry and complete the confirmation step.",
        "Insufficient funds or an expired card: worth ruling out before anything else.",
        "A temporary glitch. Payment networks hiccup, a retry a few minutes later often just works."
      ]
    },
    {
      h2: "What to do"
    },
    {
      steps: [
        "Check your bank app: if there is no charge (or a reversed hold), you are safe to retry.",
        "Retry the purchase, completing any bank confirmation popup that appears.",
        "Still failing? Switch method: a different card, Apple Pay, instant bank transfer, or crypto.",
        "If every method fails, contact support@vergr.app with the time and rough amount, and we will look at what the processor reported."
      ]
    },
    {
      note: "If money DID leave your account but no Coins arrived, that is a different situation with its own article, linked below. Do not file a chargeback as a first move, it freezes your whole account's money features."
    },
    {
      cta: [
        { to: "/platform/help/i-paid-but-my-coins-did-not-arrive-what-do-i-do", label: "Paid but no Coins?" },
        { to: "/platform/help/what-is-a-chargeback-and-what-happens-if-i-file-one", label: "Why chargebacks hurt" }
      ]
    }
  ]
};
