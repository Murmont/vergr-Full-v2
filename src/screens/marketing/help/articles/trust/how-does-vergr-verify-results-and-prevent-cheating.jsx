// Help center article: How does VERGR verify results and prevent cheating?

export default {
  summary: "Three layers. For supported games (CS2, Dota 2, Overwatch 2, Apex Legends) results are detected straight from the game itself, no honour system. For everything else a human referee from the moderation team confirms the result before any prize moves. And around both, automated screening plus a ranked moderator team watch for cheating, with disputes and appeals if something goes wrong.",
  updated: "2026-07-02",
  body: [
    {
      h2: "Layer 1: results read from the game"
    },
    {
      p: "For CS2, Dota 2, Overwatch 2, and Apex Legends, VERGR connects to the game's own data feed and detects who won automatically. Nobody types in a score, so there is nothing to lie about. Prizes for these games can pay out as soon as the game reports the result."
    },
    {
      h2: "Layer 2: human referees for everything else"
    },
    {
      p: "Games without a reliable data feed (VALORANT, FIFA, Fortnite, fighting games, and so on) are refereed. A moderator from the Vanguard, VERGR's paid moderation team, is assigned to the match, watches the evidence, and confirms the winner. That is also why tournaments in these games need a scheduled start time: a referee has to be there. No prize moves until the result is confirmed."
    },
    {
      h2: "Layer 3: anti-cheat and enforcement"
    },
    {
      list: [
        "Automated screening reviews match footage and flags suspicious play for human review.",
        "Screenshots and recordings can be required as match evidence in disputes.",
        "Confirmed cheating means voided results, forfeited winnings, and bans.",
        "Disputes escalate up a real chain: moderator, senior moderator, commander, with the founder as the final layer."
      ]
    },
    {
      note: "If you believe a result was wrong or an opponent cheated, open a dispute from the match screen rather than arguing in chat: disputes are what pause payouts and trigger review."
    },
    {
      cta: [
        { to: "/platform/help/how-do-disputes-get-resolved", label: "How disputes work" },
        { to: "/platform/help/what-do-vanguard-moderators-do", label: "Who the referees are" }
      ]
    }
  ]
};
