// Help center article: What are the verification levels and what does each unlock?
// Edit the text freely. Block model:
//   { p } paragraph · { h2 } heading · { list:[...] } bullets · { steps:[...] } numbered
//   { faq:[[q,a],...] } · { note } callout · { cta:[{ to, label }] } related links
// Top-level: summary (1-2 sentences, answer-first), updated (YYYY-MM-DD), body [].

export default {
  summary: "Verification works in levels. With no verification you can buy, tip, and earn but not withdraw. An ID and selfie check unlocks converting Coins to Gems and a starter withdrawal limit. Adding proof of address raises your limits, and for large deposits a source-of-funds step raises them further.",
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
        "No verification: you can buy Coins, tip, earn, and deposit. You cannot withdraw.",
        "ID and selfie: unlocks converting Coins to Gems and a starter monthly withdrawal limit.",
        "ID, selfie, plus proof of address: raises your daily and monthly withdrawal limits significantly.",
        "The above plus a source-of-funds step (asked for on large deposits): raises your limits to the top tier."
      ]
    },
    {
      h2: "Which level do you need?"
    },
    {
      p: "Most people are fine with the ID and selfie level. You only need to add proof of address or source of funds if you start withdrawing larger amounts and bump into a limit. The app will tell you when a step is needed, so you are never guessing."
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
