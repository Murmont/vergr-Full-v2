// Help center article: What is the conversion commission?
// Edit the text freely. Block model:
//   { p } paragraph · { h2 } heading · { list:[...] } bullets · { steps:[...] } numbered
//   { faq:[[q,a],...] } · { note } callout · { cta:[{ to, label }] } related links
// Top-level: summary (1-2 sentences, answer-first), updated (YYYY-MM-DD), body [].

export default {
  summary: "When you convert Coins into Gems, VERGR takes a commission based on your VP. It starts at 30% and steps down to a 15% floor reached at 100,000 VP. So the more VP you earn, the more of your Coins you keep on every conversion.",
  updated: "2026-06-06",
  body: [
    {
      p: "The conversion commission is the cut taken when you turn Coins into withdrawable Gems. It is the main place your rank pays off, so it is worth understanding."
    },
    {
      h2: "How much it is"
    },
    {
      p: "The commission is tied to your VP, not your subscription plan. It starts at 30% and steps down at a few VP thresholds, reaching a 15% floor at 100,000 VP. So a regular converter has a real incentive to keep earning VP."
    },
    {
      h2: "Why it scales with rank"
    },
    {
      p: "Rather than charging everyone the same flat rate, VERGR rewards activity and loyalty. The players who put the most in (earning VP through competing, posting, and engaging) keep the most when they cash out. It is a thank-you for sticking around, not a penalty for being new."
    },
    {
      h2: "Lowering it"
    },
    {
      p: "There is no shortcut: earn VP, climb the ranks, and your rate improves automatically. Paid plans earn VP faster, so they reach the lower rates sooner, but the commission itself is set by rank."
    },
    {
      note: "This commission only applies to conversion. Tips are a separate flat 10%, and that one does not change with rank."
    },
    {
      cta: [
        {
          to: "/platform/help/how-do-i-convert-coins-into-gems",
          label: "How to convert"
        },
        {
          to: "/platform/help/what-is-vp-vergr-points",
          label: "How VP lowers your fees"
        }
      ]
    }
  ]
};
