// Help center article: How is the bracket seeded?

export default {
  summary: "The host picks one of three seeding modes when creating the tournament: Random (everyone is shuffled when it starts), Manual (join order sets the seeds), or Rating (seeded by Tournament Points, so the strongest players are spread apart). Battle royale events have no seeding, everyone is in one lobby.",
  updated: "2026-07-02",
  body: [
    {
      h2: "The three modes"
    },
    {
      list: [
        "Random: the bracket is shuffled at start. Fair, unpredictable, and the default flavour for casual events. Randomised seeding is only about pairings, it never affects who wins a match.",
        "Manual: join order becomes seed order, first to register is seed 1. Hosts use it for events where seeds were decided elsewhere (a qualifier, a community vote).",
        "Rating: seeded by Tournament Points, highest first. Like classic esports seeding, it keeps the strongest players on opposite sides of the bracket so the best-versus-best happens in the final, not round one."
      ]
    },
    {
      h2: "What seeding means for you"
    },
    {
      p: "Your seed decides who you meet and when, never how a match is decided. In Rating-seeded events, playing more tournaments raises your TP, which nudges your seeding over time. In multi-stage events, later stages can inherit standings from the earlier stage: your group-stage performance carries into the playoff bracket."
    },
    {
      cta: [
        { to: "/platform/help/what-are-tournament-points-tp", label: "Tournament Points" },
        { to: "/platform/help/where-do-i-see-the-bracket-and-standings", label: "Viewing the bracket" }
      ]
    }
  ]
};
