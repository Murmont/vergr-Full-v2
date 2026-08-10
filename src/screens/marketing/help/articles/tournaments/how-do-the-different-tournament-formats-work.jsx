// Help center article: How do the different tournament formats work?
// Edit the text freely. Block model:
//   { p } paragraph · { h2 } heading · { list:[...] } bullets · { steps:[...] } numbered
//   { faq:[[q,a],...] } · { note } callout · { cta:[{ to, label }] } related links
// Top-level: summary (1-2 sentences, answer-first), updated (YYYY-MM-DD), body [].

export default {
  summary: "VERGR supports single elimination, double elimination, round robin, Swiss, and battle royale. Single elimination is one loss and out; double elimination gives a second chance; round robin has everyone play everyone; Swiss matches similar records each round; battle royale scores placement across games. You see the format before you enter.",
  updated: "2026-06-06",
  body: [
    {
      p: "VERGR runs the formats real esports use, so a host can pick the shape that fits their event. You always see which format a tournament uses before you register, so you know what you are signing up for."
    },
    {
      h2: "Single elimination"
    },
    {
      p: "Lose once and you are out. It is the fastest format and the most dramatic, every match matters. Great for big fields and quick events."
    },
    {
      h2: "Double elimination"
    },
    {
      p: "One loss drops you into a lower bracket rather than knocking you out. A second loss ends your run. This is kinder to players who have a single bad game, and it tends to crown a more deserving winner."
    },
    {
      h2: "Round robin"
    },
    {
      p: "Everyone plays everyone, and the final standings decide it. There is no early elimination, so every player gets a full set of games. Ideal for smaller, fairer fields."
    },
    {
      h2: "Swiss"
    },
    {
      p: "Each round you face an opponent on a similar record to yours. Nobody is eliminated early, and after a set number of rounds the standings settle it. It balances a large field without endless games."
    },
    {
      h2: "Battle royale"
    },
    {
      p: "Your placement across several games adds up to a score. Instead of head-to-head brackets, you are competing for the best finishes over multiple matches."
    },
    {
      note: "Matches in any format can be a single game or a best-of series, depending on what the host sets."
    },
    {
      cta: [
        {
          to: "/platform/help/what-is-a-best-of-series-bo1-bo3-bo5",
          label: "Best-of series explained"
        },
        {
          to: "/platform/help/how-do-tournaments-work-on-vergr",
          label: "How tournaments work"
        }
      ]
    }
  ]
};
