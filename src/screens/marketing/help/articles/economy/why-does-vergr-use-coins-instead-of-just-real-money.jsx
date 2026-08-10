// Help center article: Why does VERGR use Coins instead of just real money?
// Edit the text freely. Block model:
//   { p } paragraph · { h2 } heading · { list:[...] } bullets · { steps:[...] } numbered
//   { faq:[[q,a],...] } · { note } callout · { cta:[{ to, label }] } related links
// Top-level: summary (1-2 sentences, answer-first), updated (YYYY-MM-DD), body [].

export default {
  summary: "Coins keep everyday actions inside the app fast, simple, and consistent for everyone, no matter their currency or country. Real-money movement (cashing out) is kept separate as Gems so it can run through proper verification and safety checks. It is the same split most apps use: an in-app balance for spending, a verified path for payouts.",
  updated: "2026-06-06",
  body: [
    {
      p: "It is a fair question, and the answer is about speed, fairness, and safety, not hiding anything."
    },
    {
      h2: "One simple unit for everyone"
    },
    {
      p: "VERGR is global. People join with different currencies and from different places. A single in-app unit (Coins) means a tournament entry, a tip, or a boost costs the same to everyone and works the same everywhere. No live exchange rates flickering on every button, no confusion about what something actually costs."
    },
    {
      h2: "Instant, frictionless spending"
    },
    {
      p: "Tipping a streamer mid-broadcast or jumping into a quick match should be one tap. Coins make that possible. If every small action moved real money directly, each one would drag through payment checks and delays. Coins let the fun parts stay instant."
    },
    {
      h2: "Real money gets real protection"
    },
    {
      p: "When it is time to take money out, that is exactly when extra care belongs. So cashing out uses Gems, which sit behind identity verification and a short safety hold. Separating the spend balance from the payout balance is what lets the in-app side stay quick while the money-out side stays secure."
    },
    {
      note: "Nothing is locked away. Coins convert to Gems whenever you want, and Gems withdraw to a wallet address you control."
    },
    {
      cta: [
        {
          to: "/platform/help/how-do-coins-gems-and-vp-work-together",
          label: "How it all fits together"
        },
        {
          to: "/platform/help/how-do-i-convert-coins-into-gems",
          label: "Convert to Gems"
        }
      ]
    }
  ]
};
