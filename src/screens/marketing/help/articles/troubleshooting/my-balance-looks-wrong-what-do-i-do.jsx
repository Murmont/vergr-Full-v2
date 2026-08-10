// Help center article: My balance looks wrong, what do I do?

export default {
  summary: "Open your wallet's transaction history before anything else: every Coin and Gem movement is recorded there, and nine times out of ten the \"missing\" amount is an auto-renewal, a stream pass, a tip fee, or a withdrawal hold you forgot about. If a specific transaction genuinely looks wrong, contact support with its reference.",
  updated: "2026-07-02",
  body: [
    {
      h2: "Check the history first"
    },
    {
      p: "The wallet keeps a full ledger: purchases, tips sent and received (with the 10% fee shown), paid stream access, membership renewals, conversions, and withdrawals. Find the moment your balance changed and the line item will usually explain itself."
    },
    {
      h2: "The usual suspects"
    },
    {
      list: [
        "A creator membership auto-renewed: they renew every 30 days automatically until cancelled.",
        "Tip maths: sending a tip costs the full amount, but receiving one credits 90% (the flat 10% fee). Both sides are itemised.",
        "A withdrawal in its hold period: withdrawn Gems leave the balance immediately but pay out after the hold, so the money is in transit, not gone.",
        "Coins vs Gems confusion: they are separate balances. Converting moves value from one to the other, minus your commission rate.",
        "A pending withdrawal: requesting one holds the Gems while the security window runs, so they leave your spendable balance before they arrive."
      ]
    },
    {
      h2: "If it is genuinely wrong"
    },
    {
      steps: [
        "Reload the app first: a stale screen can show an old number.",
        "Note the transaction reference from the history line that looks wrong.",
        "Email support@vergr.app with the reference, what you expected, and what you see. Balances are fully auditable, so discrepancies are checkable to the exact transaction."
      ]
    },
    {
      cta: [
        { to: "/platform/help/what-is-the-conversion-commission", label: "How conversion is calculated" },
        { to: "/platform/help/how-do-i-pause-or-cancel-a-creator-membership", label: "Stopping auto-renewals" }
      ]
    }
  ]
};
