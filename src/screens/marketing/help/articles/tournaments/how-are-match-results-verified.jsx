// Help center article: How are match results verified?
// Edit the text freely. Block model:
//   { p } paragraph · { h2 } heading · { list:[...] } bullets · { steps:[...] } numbered
//   { faq:[[q,a],...] } · { note } callout · { cta:[{ to, label }] } related links
// Top-level: summary (1-2 sentences, answer-first), updated (YYYY-MM-DD), body [].

export default {
  summary: "Results are confirmed by more than just your word. Every match uses a unique lobby code, and depending on the game the system can read the scoreboard automatically, both players can agree on the outcome, and moderators can confirm or settle anything unclear. High-value matches add a webcam and anti-cheat scan.",
  updated: "2026-06-06",
  body: [
    {
      p: "Verification is what makes a VERGR prize trustworthy. Because real rewards are on the line, results are not taken on a single player's say-so. Several layers work together."
    },
    {
      h2: "The layers"
    },
    {
      list: [
        "A unique lobby code per match ties the in-game session to your VERGR match.",
        "Automatic scoreboard reading, where the game supports it, can confirm the result from a stream.",
        "Both players reporting the same outcome confirms a match instantly.",
        "Moderators can confirm a result or step in to settle anything unclear."
      ]
    },
    {
      h2: "When players disagree"
    },
    {
      p: "If you and your opponent report different outcomes, the match goes to a dispute, and a moderator decides it using whatever evidence is available, like screenshots, stream footage, or the lobby code. The honest result wins out."
    },
    {
      h2: "Extra checks at high stakes"
    },
    {
      p: "The highest-value tournaments add a webcam requirement and an anti-cheat scan, so the people competing for the biggest rewards are verified beyond just the match result. Live cheat detection can also flag suspicious play for a moderator."
    },
    {
      cta: [
        {
          to: "/platform/help/how-do-i-report-my-match-result",
          label: "Report a result"
        },
        {
          to: "/platform/help/what-happens-if-my-opponent-and-i-disagree-on-the-result",
          label: "When players disagree"
        }
      ]
    }
  ]
};
