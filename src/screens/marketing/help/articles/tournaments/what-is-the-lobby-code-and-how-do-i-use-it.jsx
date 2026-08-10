// Help center article: What is the lobby code and how do I use it?
// Edit the text freely. Block model:
//   { p } paragraph · { h2 } heading · { list:[...] } bullets · { steps:[...] } numbered
//   { faq:[[q,a],...] } · { note } callout · { cta:[{ to, label }] } related links
// Top-level: summary (1-2 sentences, answer-first), updated (YYYY-MM-DD), body [].

export default {
  summary: "Each match gets a unique lobby code (like VERGR-XXXX) that ties your in-game lobby to your VERGR match. You enter or display it in-game in the way your game requires, so the system and moderators can confirm you are playing the right match against the right opponent. It is a core part of keeping results fair.",
  updated: "2026-06-06",
  body: [
    {
      p: "The lobby code is a small but important part of keeping tournaments honest. It is a unique code for your specific match that links your in-game session to your VERGR match, so results can be trusted."
    },
    {
      h2: "What it is"
    },
    {
      p: "When your match is ready, you get a unique code, in the form VERGR followed by a short string. It belongs to that one match only. It is how the platform proves the game you played is the game you are reporting."
    },
    {
      h2: "How to use it"
    },
    {
      p: "Depending on the game, you use the code in a specific way, for example putting it in your in-game name, a lobby name, or showing it on a match screen. The match screen tells you which method your game uses. Set it up before you start so verification can pick it up."
    },
    {
      h2: "Why it exists"
    },
    {
      p: "The code lets the system read and confirm your match automatically where the game supports it, and lets moderators verify you played the right opponent in the right lobby. It is one of the layers that makes a VERGR prize trustworthy instead of relying purely on players' word."
    },
    {
      cta: [
        {
          to: "/platform/help/how-are-match-results-verified",
          label: "How results are verified"
        },
        {
          to: "/platform/help/how-do-i-check-in-for-my-match",
          label: "Checking in"
        }
      ]
    }
  ]
};
