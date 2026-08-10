// Help center article: Can my squad enter a tournament as a team?
// Edit the text freely. Block model:
//   { p } paragraph · { h2 } heading · { list:[...] } bullets · { steps:[...] } numbered
//   { faq:[[q,a],...] } · { note } callout · { cta:[{ to, label }] } related links
// Top-level: summary (1-2 sentences, answer-first), updated (YYYY-MM-DD), body [].

export default {
  summary: "Yes. Squad tournaments let your team enter as a unit and play squad against squad. A squad win pays into the shared squad treasury rather than one wallet. Squads can also vote on which members represent them, and pick backups, for important matches.",
  updated: "2026-06-06",
  body: [
    {
      p: "Yes, squads compete as teams in squad tournaments. Instead of solo brackets, the bracket runs squad against squad, and the results count toward the squad leaderboard."
    },
    {
      h2: "How team entry works"
    },
    {
      p: "In a squad tournament, your squad enters as a unit and fields a roster. You play other squads, and your wins build your squad's reputation and standing. A strong squad climbing the leaderboard starts getting noticed and invited to bigger events."
    },
    {
      h2: "Choosing who plays"
    },
    {
      p: "For important matches, a squad can vote on which members will represent it, and select backups in case someone cannot play. That keeps team selection fair and avoids last-minute scrambles."
    },
    {
      h2: "How winnings are handled"
    },
    {
      p: "When a squad wins, the prize goes into the shared squad treasury, not a single player's wallet. From there it is shared through the squad's payout process, which uses approvals so it is never one person's call."
    },
    {
      cta: [
        {
          to: "/platform/help/how-do-squad-tournament-winnings-get-split",
          label: "How winnings are split"
        },
        {
          to: "/platform/help/what-is-the-squad-treasury-and-how-does-it-work",
          label: "The squad treasury"
        }
      ]
    }
  ]
};
