// Help center article: How do I clip a moment as a viewer?
// Block model: { p } | { h2 } | { list:[] } | { steps:[] } | { faq:[[q,a]] } | { note } | { cta:[{to,label}] }

export default {
  summary: "Tap the clip button on the player and VERGR grabs the moment that just happened, the last 30 seconds on the free plan, 60 on Lite, 90 on Pro. It is one tap, no editing: the clip saves straight to your profile as a clip post. There is a per-stream limit on the free and Lite plans, and clipping needs a supported device.",
  updated: "2026-06-18",
  body: [
    {
      p: "You do not have to be the broadcaster to keep a great moment. Viewers can clip live too. When something good happens, tap the clip button on the player and VERGR captures the seconds that just went by, no rewinding or setup needed."
    },
    {
      h2: "Clip it"
    },
    {
      steps: [
        "While watching live, tap the clip button on the player right after the good moment.",
        "VERGR grabs the last stretch of the stream automatically (30s on free, 60s on Lite, 90s on Pro).",
        "The clip saves to your profile as a clip post. You will see a 'Clip saved to your profile' confirmation.",
        "From there you can share it like any other post."
      ]
    },
    {
      h2: "What to expect"
    },
    {
      list: [
        "One tap, no editor: there is no trim or title step. It captures the recent moment and posts it.",
        "It saves to YOUR profile as your clip (the stream's title is included in the clip for context).",
        "Per-stream limits: 3 clips on free, 5 on Lite, unlimited on Pro.",
        "Clip length grows with your plan: 30, 60, or 90 seconds."
      ]
    },
    {
      note: "If you tap clip too early in a stream, VERGR may say it needs a few more seconds of footage. Give it a moment and tap again once there is enough to grab.",
    },
    {
      faq: [
        [
          "Can I clip on any device?",
          "Most browsers can clip directly. On devices that cannot capture locally (some Apple and in-app webviews), VERGR falls back to making the clip on its servers, so it still works, just a moment slower."
        ],
        [
          "Can I trim the clip or rename it before it posts?",
          "Not from the viewer clip button. It captures the recent moment and posts it as-is to your profile. You can manage the post afterward like any other."
        ],
        [
          "Why did clipping say the limit was reached?",
          "Free and Lite have a per-stream clip cap (3 and 5). Pro removes the cap. The message tells you which plan limit you hit."
        ]
      ]
    },
    {
      cta: [
        {
          to: "/platform/help/how-do-i-share-a-stream",
          label: "Share a stream"
        },
        {
          to: "/platform/help/how-do-i-share-a-clip",
          label: "Share a clip"
        }
      ]
    }
  ]
};
