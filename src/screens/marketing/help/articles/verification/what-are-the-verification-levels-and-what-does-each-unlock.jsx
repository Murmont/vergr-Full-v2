// Help center article: What are the verification levels and what does each unlock?
// Edit the text freely. Block model:
//   { p } paragraph · { h2 } heading · { list:[...] } bullets · { steps:[...] } numbered
//   { faq:[[q,a],...] } · { note } callout · { cta:[{ to, label }] } related links
// Top-level: summary (1-2 sentences, answer-first), updated (YYYY-MM-DD), body [].

export default {
  summary: "Verification works in levels. With no verification you can buy, tip, and earn, but Vergr cannot pay you. An ID and selfie check lets Vergr pay you up to a starter monthly ceiling. Adding proof of address raises that ceiling, and for large deposits a source-of-funds step raises them further.",
  updated: "2026-06-06",
  body: [
    {
      p: "Verification on VERGR is tiered, so you only do as much as your activity requires. The more you want to move, the more confirmation is needed, which is standard for anything that pays out real money."
    },
    {
      h2: "The levels"
    },
    {
      list: [
        "No verification: you can buy Coins, tip, and earn. Vergr cannot pay you a revenue share until you verify.",
        "ID and selfie: lets Vergr pay you, up to a starter monthly ceiling.",
        "ID, selfie, plus proof of address: raises your monthly payout ceiling significantly.",
        "The above plus a source-of-funds step (asked for on large deposits): raises your limits to the top tier."
      ]
    },
    {
      h2: "Which level do you need?"
    },
    {
      p: "Most people are fine with the ID and selfie level. You only need to add proof of address or source of funds if you start earning larger amounts and bump into a payout ceiling. The app will tell you when a step is needed, so you are never guessing."
    },
    {
      note: "Each step is one-time. Once you have cleared a level, your higher limits stay unlocked."
    },
    {
      cta: [
        {
          to: "/platform/help/how-do-i-complete-identity-verification",
          label: "Complete verification"
        },
        {
          to: "/platform/help/what-documents-do-i-need-for-verification",
          label: "Documents you need"
        }
      ]
    }
  ]
};
