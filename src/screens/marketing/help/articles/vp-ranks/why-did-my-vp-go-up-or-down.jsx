// Help center article: Why did my VP go up or down?
// Edit the text freely. Block model:
//   { p } paragraph · { h2 } heading · { list:[...] } bullets · { steps:[...] } numbered
//   { faq:[[q,a],...] } · { note } callout · { cta:[{ to, label }] } related links
// Top-level: summary (1-2 sentences, answer-first), updated (YYYY-MM-DD), body [].

export default {
  summary: "VP goes up when you do things that earn it, streaming, posting, completing creator quests, referring friends, and staying active. It generally does not drop on its own; your total VP is cumulative. If your displayed level seemed to change unexpectedly, it is usually a quest reward landing or progress within a level being recalculated.",
  updated: "2026-06-06",
  body: [
    {
      p: "VP is cumulative, you build it over time, and it normally only moves up. If you noticed a change, here is what is most likely behind it."
    },
    {
      h2: "Why VP went up"
    },
    {
      list: [
        "You finished a stream. Session VP is awarded once the broadcast ends and the session is tallied.",
        "A creator quest paid out. Quests award VP on completion.",
        "A referral landed. When a friend signs up with your link, you both get a VP boost.",
        "General activity. Ongoing participation keeps VP ticking up."
      ]
    },
    {
      h2: "Why it might look like it went down"
    },
    {
      p: "Your lifetime VP is not taken away for normal activity. What can look like a drop is usually the progress bar within a level resetting after you level up (you start the next level near empty), or a pending reward that had been shown optimistically settling to its final value. The level number itself does not fall."
    },
    {
      note: "VP is separate from Coins. Spending Coins never reduces your VP."
    },
    {
      faq: [
        [
          "Does losing a match cost me VP?",
          "No. You earn VP for entering and placing; a loss simply earns less than a win. Your existing VP is not deducted."
        ],
        [
          "My stream VP has not shown up yet, why?",
          "VP for a stream is granted once the broadcast has fully ended and the session is tallied, which can lag the moment you hit Stop."
        ]
      ]
    },
    {
      cta: [
        {
          to: "/platform/help/how-do-i-earn-vp",
          label: "Earning VP"
        },
        {
          to: "/platform/help/what-is-vp-and-how-do-i-earn-it",
          label: "VP explained"
        }
      ]
    }
  ]
};
