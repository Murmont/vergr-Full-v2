// Help center article: What does each plan include?
// Edit the text freely. Block model:
//   { p } paragraph · { h2 } heading · { list:[...] } bullets · { steps:[...] } numbered
//   { faq:[[q,a],...] } · { note } callout · { cta:[{ to, label }] } related links
// Top-level: summary (1-2 sentences, answer-first), updated (YYYY-MM-DD), body [].
//
// REWRITTEN 2026-08-19 after auditing every claim against the enforcing code.
// Two classes of error were removed and must not come back:
//   1. Features that have no tier check and are free for everyone (squads,
//      voice and video messages, post boosts, custom banners, co-streaming,
//      paid streams). Do not list them as plan perks.
//   2. "Paid plans earn VP faster so you reach a better revenue share sooner."
//      This is FALSE. The share ladder is keyed to LIFETIME GROSS EARNINGS
//      alone (functions/coinLedger.js shareForEarnings). VP and plan have no
//      effect on it whatsoever.

export default {
  summary: "A full breakdown of Free, Lite ($4.99/mo) and Pro ($9.99/mo): streaming quality and limits, VP earn rate, upload limits, and the creator tools each one unlocks. Your revenue share is the same on every plan.",
  updated: "2026-08-19",
  body: [
    {
      p: "Here is the detailed version of what each VERGR plan gives you, so you can see exactly where the lines are before you decide. Read it as a ladder: each plan includes everything below it and adds more. And remember the rule that does not change: your plan never affects your revenue share."
    },
    {
      h2: "Free"
    },
    {
      list: [
        "The full social platform: posting, clips, shorts, articles, watching, and chat.",
        "Public streaming once you reach 100 followers plus a one-time 50-coin Stream Boost, at 480p, up to 30 minutes a day.",
        "Free squad streaming with your crew, no follower requirement.",
        "Create and join squads, voice hangouts, and squad streams.",
        "Voice messages, video messages, and co-streaming with a guest.",
        "Post boosts, paid streams, and a custom profile banner.",
        "200MB uploads."
      ]
    },
    {
      note: "Squads, voice and video messages, post boosts, custom banners and co-streaming are open to everyone. They are not plan features and never have been."
    },
    {
      h2: "Lite, $4.99 per month"
    },
    {
      p: "Everything in Free, plus the things that matter most if you stream and post often:"
    },
    {
      list: [
        "Public streaming from day one at 720p, with no follower gate and no Stream Boost needed.",
        "Four hours of streaming a day, up from 30 minutes.",
        "No ads anywhere in the app.",
        "1.5× VP on every action, plus 1,000 VP and 50 boost coins the moment you pay, and again with every monthly renewal. Boost coins buy boosts and VP packs.",
        "1GB uploads.",
        "Scheduled posts and scheduled direct messages.",
        "Creator analytics and the content calendar in Creator Studio.",
        "Hide Vergr branding on your vergr.me page."
      ]
    },
    {
      h2: "Pro, $9.99 per month"
    },
    {
      p: "Everything in Lite, plus the full creator toolkit:"
    },
    {
      list: [
        "1080p streaming with no daily limit.",
        "Past broadcasts saved as replays for 90 days.",
        "2× VP on every action, plus 3,000 VP and 150 boost coins the moment you pay, and again with every monthly renewal. Boost coins buy boosts and VP packs.",
        "5GB uploads, and photos kept at full 4K instead of being resized.",
        "The full vergr.me design kit: custom themes, per-element colours, video and animated backgrounds, and custom CSS.",
        "Lead capture with export and webhooks, plus tracking pixels on your vergr.me page.",
        "Advanced analytics on your audience and content.",
        "An animated avatar and a Pro badge."
      ]
    },
    {
      h2: "What stays the same on every plan"
    },
    {
      p: "Your revenue share depends on your lifetime earnings and nothing else. It is not affected by your plan, and it is not affected by your VP rank. Paid plans buy you capability and reach: better streaming, bigger uploads, more creator tools. They do not buy you a better rate on money you earn, and there is no plan that lets you keep more."
    },
    {
      note: "You can pay monthly with a card, through Google Play on the Android app, or with Coins, around 500 for Lite and 1,000 for Pro. You can change plans anytime from settings."
    },
    {
      faq: [
        [
          "Which plan is best for streaming?",
          "Lite is the entry point for serious streaming because it removes the follower gate, lifts quality to 720p and raises the daily allowance to four hours. Pro is for 1080p, unlimited hours, and keeping your broadcasts as replays."
        ],
        [
          "Do uploads really differ that much?",
          "Yes. 200MB on Free, 1GB on Lite, 5GB on Pro. Pro is also the only plan where photos are not resized down, so full 4K images stay 4K."
        ],
        [
          "Does a plan improve my revenue share?",
          "No. Your share is set by your lifetime gross earnings alone, from 50% rising to 80%. Neither your plan nor your VP rank changes it."
        ],
        [
          "What is VP for, then?",
          "VP drives your rank, badges, ring colours and prestige. It is a status ladder, not a money one, and it is entirely separate from your revenue share."
        ]
      ]
    },
    {
      cta: [
        {
          to: "/platform/help/what-are-the-vergr-plans",
          label: "Plans overview"
        },
        {
          to: "/platform/help/what-is-vp-vergr-points",
          label: "What VP does"
        }
      ]
    }
  ]
};
