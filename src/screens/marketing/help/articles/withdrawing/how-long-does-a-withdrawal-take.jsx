// Help center article: How long does a withdrawal take?
// Edit the text freely. Block model:
//   { p } paragraph · { h2 } heading · { list:[...] } bullets · { steps:[...] } numbered
//   { faq:[[q,a],...] } · { note } callout · { cta:[{ to, label }] } related links
// Top-level: summary (1-2 sentences, answer-first), updated (YYYY-MM-DD), body [].

export default {
  summary: "After you request a withdrawal there is a 3-day hold for fraud review, then it is sent in the next outbound batch. The crypto transfer itself then settles on the network, usually quickly. You can track the status in your wallet the whole time.",
  updated: "2026-06-06",
  body: [
    {
      p: "A withdrawal is not instant, and that is on purpose, the short wait is what protects your money. Here is the timeline."
    },
    {
      h2: "The steps and timing"
    },
    {
      steps: [
        "You request a withdrawal of at least 1,000 Gems.",
        "It enters a 3-day hold for fraud review. This window is your protection against an account being drained.",
        "After the hold, it is sent in the next outbound batch.",
        "The crypto transfer settles on the network, usually quickly."
      ]
    },
    {
      h2: "Tracking it"
    },
    {
      p: "You can see the status of your withdrawal in your wallet at every stage, from pending through to sent. There is no guessing, the wallet shows you where it is."
    },
    {
      note: "During the first part of the hold, a pending withdrawal can be cancelled if you change your mind. Once it is sent, it cannot be reversed."
    },
    {
      cta: [
        {
          to: "/platform/help/why-is-there-a-hold-on-my-withdrawal",
          label: "Why the hold"
        },
        {
          to: "/platform/help/where-do-i-see-the-status-of-my-withdrawal",
          label: "Track your withdrawal"
        }
      ]
    }
  ]
};
