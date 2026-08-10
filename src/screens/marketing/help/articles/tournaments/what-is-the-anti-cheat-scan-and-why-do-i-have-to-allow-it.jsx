// Help center article: What is the anti-cheat scan and why do I have to allow it?
// Edit the text freely. Block model:
//   { p } paragraph · { h2 } heading · { list:[...] } bullets · { steps:[...] } numbered
//   { faq:[[q,a],...] } · { note } callout · { cta:[{ to, label }] } related links
// Top-level: summary (1-2 sentences, answer-first), updated (YYYY-MM-DD), body [].

export default {
  summary: "For higher-stakes tournaments, VERGR runs an anti-cheat scan that checks for known cheat tools running on your device. It protects the integrity of the prize so honest players are not beaten by cheats. You consent before it runs, and it is focused on detecting cheats, not snooping on your files.",
  updated: "2026-06-06",
  body: [
    {
      p: "The anti-cheat scan exists for one reason: when real rewards are on the line, the players competing for them deserve to know nobody is cheating. It is part of what makes high-stakes VERGR tournaments trustworthy."
    },
    {
      h2: "What it does"
    },
    {
      p: "For eligible tournaments, the scan checks your device for known cheat tools, the kind of software that gives an unfair advantage. It runs before your match and periodically during it, matching against a list of known cheats. If something flags, a moderator reviews it, the system does not auto-punish you."
    },
    {
      h2: "Why you have to allow it"
    },
    {
      p: "You consent before the scan runs, because it is your device. Allowing it is the price of entry for competing where real money is involved, the same way an in-person tournament might check your equipment. If you do not consent, you cannot compete in that tournament, but you can still spectate."
    },
    {
      h2: "What it is not"
    },
    {
      p: "The scan is focused on detecting cheats, not reading your personal files or watching what you do outside the game. It is a targeted integrity check tied to the match, and it stops when the match does."
    },
    {
      note: "AI flags are reviewed by a human moderator before any action. The scan suggests, a moderator decides."
    },
    {
      cta: [
        {
          to: "/platform/help/why-do-high-stakes-tournaments-require-a-webcam",
          label: "Why a webcam at high stakes"
        },
        {
          to: "/platform/help/how-does-vergr-detect-cheating",
          label: "How cheating is detected"
        }
      ]
    }
  ]
};
