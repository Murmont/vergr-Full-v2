// Help center article: How do tournaments work on VERGR?
// Edit the text freely. Block model:
//   { p } paragraph · { h2 } heading · { list:[...] } bullets · { steps:[...] } numbered
//   { faq:[[q,a],...] } · { note } callout · { cta:[{ to, label }] } related links
// Top-level: summary (1-2 sentences, answer-first), updated (YYYY-MM-DD), body [].

export default {
  summary: "VERGR tournaments are skill-based competitions in real games. Competing is free — fans buy spectator tickets to watch, and those sales (plus any host top-up) fund the prize purse. You register, play your matches, results get verified, and the winner is paid in Coins. Formats range from single elimination to round robin.",
  updated: "2026-06-06",
  body: [
    {
      p: "A VERGR tournament is a real competition, decided by how well you play. You join, you get matched against other players or squads, you play your games, and the results are checked before the bracket moves on. Win, and the prize lands in your wallet in Coins. There is no chance element, no draw, no spinning anything. Skill decides it."
    },
    {
      h2: "Free to compete, ticketed to watch"
    },
    {
      p: "Competing is always free — there's no entry fee to play. Instead, fans buy a spectator ticket (a price the host sets) to watch and support the event. A share of every ticket, plus any Coins the host adds, forms the prize purse. So a bigger, more popular audience means a bigger reward for the winner — and nobody pays to compete."
    },
    {
      h2: "The formats"
    },
    {
      p: "VERGR supports the formats real esports run on, so a host can pick the shape that fits their event:"
    },
    {
      list: [
        "Single elimination: lose once and you are out. Fast and brutal.",
        "Double elimination: one loss drops you to a lower bracket, a second knocks you out, so a single bad game does not end your run.",
        "Round robin: everyone plays everyone, and standings decide it. Great for smaller, fair fields.",
        "Swiss: you face opponents on a similar record each round, no early elimination.",
        "Battle royale: placement across several games adds up to your score."
      ]
    },
    {
      p: "Matches can be a single game or a best-of series (best of three or best of five) depending on what the host sets. You always see the format before you commit."
    },
    {
      h2: "How results get verified"
    },
    {
      p: "This is the part that makes prizes trustworthy. Every match has its own unique lobby code that you use in-game, and results are confirmed by more than just your word. Depending on the game, the system can read the scoreboard from a stream automatically, and a moderator can step in to confirm or settle anything that is unclear. If both players disagree on the outcome, the match goes to a dispute and a moderator decides it. Higher-value tournaments add extra checks, including a webcam requirement and an anti-cheat scan, so the people competing for the biggest rewards are verified."
    },
    {
      h2: "Getting paid"
    },
    {
      p: "When a tournament finishes, the prize is paid out in Coins to the winner, winner takes all. If a squad wins, the prize goes to the squad treasury to be shared. On top of the Coins, everyone who competes earns Tournament Points that move you up the global rankings, so even a run that does not win still counts for something."
    },
    {
      note: "VERGR tournaments are skill-based competition, not gambling. Outcomes come from execution and decisions, results are verified, and there are no chance-based mechanics anywhere in the system."
    },
    {
      faq: [
        [
          "Does it cost anything to compete?",
          "No. Competing is free on VERGR — there's no entry fee. The prize purse is funded by spectator ticket sales and any amount the host adds, not by competitor stakes."
        ],
        [
          "Do I need to be verified to compete?",
          "Competing for free in a ticketed event does not require identity verification. Buying a ticket (or hosting a paid event) does, because real value is involved. The highest-value competitions add a webcam and anti-cheat check."
        ],
        [
          "What if my opponent cheats or no-shows?",
          "No-shows are forfeited after a grace period, and cheating can be reported and is reviewed by moderators. Confirmed cheating means disqualification."
        ]
      ]
    },
    {
      cta: [
        {
          to: "/platform/help/how-do-i-join-a-tournament",
          label: "How to join a tournament"
        },
        {
          to: "/platform/help/how-do-i-create-a-tournament",
          label: "How to host one"
        },
        {
          to: "/platform/help/is-vergr-gambling",
          label: "Is this gambling? (no)"
        }
      ]
    }
  ]
};
