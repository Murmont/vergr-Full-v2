// Help center article: What streaming quality do I get on my plan?
// Block model: { p } | { h2 } | { list:[] } | { steps:[] } | { faq:[[q,a]] } | { note } | { cta:[{to,label}] }

export default {
  summary: "Free streams at 480p, Lite at 720p, and Pro at 1080p with co-streaming on top. VERGR runs one clean quality per stream rather than a stack of versions, so the rule is simple: set your encoder at or below your plan's cap and it stays smooth. Push past the cap and the system eases it back to protect your viewers from buffering.",
  updated: "2026-06-18",
  body: [
    {
      p: "Your streaming quality is set by your plan, and it is deliberately straightforward. There are three tiers, each with a clear resolution cap, and the system keeps your stream inside that cap so playback stays stable for everyone watching."
    },
    {
      h2: "Quality by plan"
    },
    {
      list: [
        "Free: up to 480p. A clean, watchable stream that runs well on modest upload speeds.",
        "Lite: up to 720p, from day one. Sharper, and no follower requirement.",
        "Pro: up to 1080p, plus co-streaming so you can bring a guest on screen with you."
      ]
    },
    {
      p: "VERGR streams a single quality rather than transcoding into a ladder of resolutions. That keeps things fast and reliable, and it means the most important setting is your own encoder. Set it at or below your plan's cap and you are set."
    },
    {
      h2: "If your stream looks softer than expected"
    },
    {
      p: "Two things cause that. Either your plan caps you below the resolution you had in mind, or your encoder bitrate ran over the cap and the system trimmed it down to keep playback smooth. The fix is the same: match your encoder to your plan's quality. If you want a higher ceiling, upgrading the plan raises the cap."
    },
    {
      note: "Higher resolution needs more upload bandwidth. If your connection is tight, a stable 480p beats a stuttering 1080p every time. The system will also lower quality automatically if your connection starts struggling, then recover when it settles."
    },
    {
      faq: [
        [
          "Can I stream in 4K?",
          "No. The top cap is 1080p on Pro. Streaming one clean 1080p feed to every viewer is the design, rather than chasing a resolution most people will not watch at."
        ],
        [
          "Does a higher plan improve my viewers' experience too?",
          "It raises the quality ceiling of the stream itself. Each viewer still needs enough bandwidth on their end to watch at that quality smoothly."
        ],
        [
          "What is co-streaming?",
          "On Pro you can invite a co-host so two people share one broadcast. Both stay live, linked into the same composite, while their viewer counts stay separate."
        ]
      ]
    },
    {
      cta: [
        {
          to: "/platform/help/why-does-my-stream-look-lower-quality-than-i-set",
          label: "Why is my stream lower quality?"
        },
        {
          to: "/platform/help/what-are-the-vergr-plans",
          label: "Compare the plans"
        }
      ]
    }
  ]
};
