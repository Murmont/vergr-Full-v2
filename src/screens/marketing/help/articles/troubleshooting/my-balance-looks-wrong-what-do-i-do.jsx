// Help center article: My balance looks wrong, what do I do?

export default {
  summary: "Open your wallet's transaction history before anything else: every Coin movement is recorded there, and nine times out of ten the \"missing\" amount is an auto-renewal, a stream pass, or a tip you forgot about. If a specific transaction genuinely looks wrong, contact support with its reference.",
  updated: "2026-07-02",
  body: [
    {
      h2: "Check the history first"
    },
    {
      p: "The wallet keeps a full ledger: Coin purchases, tips sent, paid stream access and membership renewals. Find the moment your balance changed and the line item will usually explain itself."
    },
    {
      h2: "The usual suspects"
    },
    {
      list: [
        "A creator membership auto-renewed: they renew every 30 days automatically until cancelled.",
        "Tip maths: sending a tip costs the full amount, and receiving one credits your revenue share of it. Both sides are itemised.",
        "A payout in transit: it has left the ledger but has not reached you yet.",
        "Coins are what you spend; your creator earnings are separate and live in Creator Studio.",
        "A scheduled payout that has not landed yet."
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
        { to: "/platform/help/what-fees-does-vergr-charge", label: "What VERGR charges" },
        { to: "/platform/help/how-do-i-pause-or-cancel-a-creator-membership", label: "Stopping auto-renewals" }
      ]
    }
  ]
};
