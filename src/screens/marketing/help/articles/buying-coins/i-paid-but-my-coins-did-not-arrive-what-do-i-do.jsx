// Help center article: I paid but my Coins did not arrive, what do I do?

export default {
  summary: "Give it a few minutes: Coins are usually instant, and the system also re-checks recent payments automatically, so a delayed confirmation catches up on its own shortly. If 30 minutes pass with a confirmed charge and no Coins, contact support@vergr.app with the date, amount, and payment method, and it will be credited manually.",
  updated: "2026-07-02",
  body: [
    {
      p: "Coins normally land in your wallet within seconds of the payment clearing. When they do not, it is almost always a delay between your bank confirming and the confirmation reaching VERGR, and there is a safety net for exactly that."
    },
    {
      h2: "What to do, in order"
    },
    {
      steps: [
        "Wait a few minutes and check your wallet again. VERGR automatically re-checks recent payments every few minutes, so delayed confirmations are picked up without you doing anything.",
        "Confirm the money actually left: look for the charge in your bank or card app. A pending authorisation that later disappears means the payment never completed, and nothing is owed.",
        "Check your wallet's transaction history: if the purchase shows there, the Coins are in (the balance figure can occasionally lag a reload).",
        "Still nothing after 30 minutes with a confirmed charge? Email support@vergr.app with the date, the amount, and the payment method used. Confirmed payments are always credited."
      ]
    },
    {
      note: "Please contact support before your bank. A chargeback filed while the Coins are simply in transit will reverse the purchase, freeze withdrawals on your account for months, and can suspend the account, all for a problem support fixes in one email."
    },
    {
      cta: [
        { to: "/platform/help/what-is-a-chargeback-and-what-happens-if-i-file-one", label: "Chargebacks explained" },
        { to: "/platform/help/is-buying-coins-secure", label: "How purchases are protected" }
      ]
    }
  ]
};
