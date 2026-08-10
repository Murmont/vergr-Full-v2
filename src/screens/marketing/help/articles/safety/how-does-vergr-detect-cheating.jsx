// Help center article: How does VERGR detect cheating?

export default {
  summary: "Several ways at once: match footage is screened automatically for known cheat patterns, results that look statistically impossible get flagged, human referees watch paid matches in games without automatic detection, and player reports feed the same review queue. Confirmed cheating voids results, forfeits winnings, and bans the account.",
  updated: "2026-07-02",
  body: [
    {
      h2: "The detection layers"
    },
    {
      list: [
        "Automated footage screening: recorded match video is analysed for the visual fingerprints of known cheats (aim assistance, wallhack-style behaviour) and suspicious sequences are flagged for human review. The signature list is kept current.",
        "Game-data sanity checks: for games with direct data feeds, the numbers themselves are checked, and performances that do not add up get attention.",
        "Human referees: paid matches in games without automatic result detection have a moderator watching, which is also a cheating check.",
        "Player reports: reporting a player for cheating in a tournament routes to moderators with the match evidence attached."
      ]
    },
    {
      h2: "What counts as cheating"
    },
    {
      p: "Unauthorised software or hardware assistance, scripts and bots, exploiting bugs, playing on someone else's behalf, and match-fixing (deliberate losses or pre-arranged outcomes). If it corrupts the honesty of a competition, it is in scope."
    },
    {
      h2: "What happens to cheaters"
    },
    {
      list: [
        "The affected results are voided and prizes clawed back.",
        "Winnings tied to cheating are forfeited.",
        "The account is banned, and ban evasion attempts extend the problem to the new account.",
        "Wrongly flagged? The appeal process applies to cheating calls like any other decision, and a flag is reviewed by humans before punishment lands."
      ]
    },
    {
      cta: [
        { to: "/platform/help/how-do-i-report-a-player-for-cheating-in-a-tournament", label: "Reporting a cheater" },
        { to: "/platform/help/i-was-flagged-for-review-what-does-that-mean-and-how-do-i-appeal", label: "If you were flagged" }
      ]
    }
  ]
};
