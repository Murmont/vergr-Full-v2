// Help center article: What is a best-of series (Bo1, Bo3, Bo5)?
// Edit the text freely. Block model:
//   { p } paragraph · { h2 } heading · { list:[...] } bullets · { steps:[...] } numbered
//   { faq:[[q,a],...] } · { note } callout · { cta:[{ to, label }] } related links
// Top-level: summary (1-2 sentences, answer-first), updated (YYYY-MM-DD), body [].

export default {
  summary: "A best-of series decides a match over several games instead of one. Bo1 is a single game, Bo3 is first to two wins, and Bo5 is first to three. Longer series reward consistency and reduce the impact of one unlucky game. The host sets the series length, and you see it before you play.",
  updated: "2026-06-06",
  body: [
    {
      p: "A best-of series means a match is decided over multiple games rather than a single one. It is the standard way serious competition reduces flukes, the better player over several games wins, not whoever got the better start in one."
    },
    {
      h2: "What the numbers mean"
    },
    {
      list: [
        "Bo1 (best of one): a single game decides the match.",
        "Bo3 (best of three): first to two game wins takes the match.",
        "Bo5 (best of five): first to three game wins takes the match."
      ]
    },
    {
      h2: "Why it matters"
    },
    {
      p: "Longer series reward consistency and skill over luck. In a Bo1, one bad round can end you. In a Bo3 or Bo5, you can drop a game and still come back, so the result reflects who actually played better across the match. That is why bigger, higher-stakes matches usually run longer series."
    },
    {
      h2: "How you report it"
    },
    {
      p: "In a series, you report each game as you go, and a live scoreboard tracks the count. The match completes automatically when one side reaches the wins needed. The host sets the series length, and it is shown before you play."
    },
    {
      note: "Some formats, like battle royale, run single games rather than series. You always see the match setup before it starts."
    },
    {
      cta: [
        {
          to: "/platform/help/how-do-i-report-my-match-result",
          label: "Reporting results"
        },
        {
          to: "/platform/help/how-do-the-different-tournament-formats-work",
          label: "Tournament formats"
        }
      ]
    }
  ]
};
