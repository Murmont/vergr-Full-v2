// Help center article: What happens if my opponent and I disagree on the result?
// Edit the text freely. Block model:
//   { p } paragraph · { h2 } heading · { list:[...] } bullets · { steps:[...] } numbered
//   { faq:[[q,a],...] } · { note } callout · { cta:[{ to, label }] } related links
// Top-level: summary (1-2 sentences, answer-first), updated (YYYY-MM-DD), body [].

export default {
  summary: "If you both report different outcomes, the match goes to a dispute. A moderator reviews the evidence, like screenshots, stream footage, and the lobby code, and decides the result. You may be prompted to upload your own proof. The honest result wins, and false reporting can carry consequences.",
  updated: "2026-06-06",
  body: [
    {
      p: "Disagreements happen, and VERGR has a clear process so they do not stall a tournament or let anyone cheat their way through. It is built so the truthful player wins out."
    },
    {
      h2: "It goes to a dispute"
    },
    {
      p: "When two players report conflicting outcomes, the match is marked disputed instead of advancing. That pauses it for review rather than guessing."
    },
    {
      h2: "A moderator decides"
    },
    {
      p: "A Vanguard moderator reviews the match using whatever evidence exists, the lobby code, automatic scoreboard reads, stream footage, and any screenshots either player provides. Both sides may be prompted to upload proof, like a photo of the final score. The moderator then sets the correct result and the bracket continues."
    },
    {
      h2: "Protect yourself"
    },
    {
      list: [
        "Keep a screenshot of the final score, especially in close or high-stakes matches.",
        "Use the lobby code correctly, it is strong evidence you played the right match.",
        "Stream your match if you can, footage settles disputes fast."
      ]
    },
    {
      note: "Deliberately reporting a false result is a serious rule break and can lead to a disqualification or worse. Honesty is always the safer play."
    },
    {
      cta: [
        {
          to: "/platform/help/how-do-disputes-get-resolved",
          label: "How disputes are resolved"
        },
        {
          to: "/platform/help/how-do-i-report-a-player-for-cheating-in-a-tournament",
          label: "Report cheating"
        }
      ]
    }
  ]
};
