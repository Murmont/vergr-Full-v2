// Help center article: How do I report my match result?
// Edit the text freely. Block model:
//   { p } paragraph · { h2 } heading · { list:[...] } bullets · { steps:[...] } numbered
//   { faq:[[q,a],...] } · { note } callout · { cta:[{ to, label }] } related links
// Top-level: summary (1-2 sentences, answer-first), updated (YYYY-MM-DD), body [].

export default {
  summary: "After your match, open the match screen and report the outcome, who won. If both players agree, it is confirmed and the bracket advances. For many games the result can be picked up automatically too. In a best-of series you report each game as you go.",
  updated: "2026-06-06",
  body: [
    {
      p: "Reporting your result is the final step of a match, and it is quick. The system uses your report, plus other verification, to advance the bracket."
    },
    {
      h2: "How to report"
    },
    {
      steps: [
        "When the match ends, open the match screen.",
        "Report the outcome, whether you won or lost.",
        "If it is a best-of series, report each game as it finishes.",
        "Once confirmed, the bracket advances automatically."
      ]
    },
    {
      h2: "How it gets confirmed"
    },
    {
      p: "If both players report the same outcome, the match is confirmed straight away. For many games, the result can also be read automatically from a stream, and a moderator can confirm it. So an honest report from both sides is the fastest path, but it is not the only safeguard."
    },
    {
      h2: "If you disagree"
    },
    {
      p: "If you and your opponent report conflicting results, the match goes to a dispute and a moderator settles it. You may be asked to upload evidence like a screenshot of the final score, so keep one if a match is close."
    },
    {
      cta: [
        {
          to: "/platform/help/what-happens-if-my-opponent-and-i-disagree-on-the-result",
          label: "If you disagree"
        },
        {
          to: "/platform/help/how-are-match-results-verified",
          label: "How verification works"
        }
      ]
    }
  ]
};
