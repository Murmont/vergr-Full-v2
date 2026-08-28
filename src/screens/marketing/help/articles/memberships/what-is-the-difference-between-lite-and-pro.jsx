// Help center article: What is the difference between Lite and Pro?
// Edit the text freely. Block model:
//   { p } paragraph · { h2 } heading · { list:[...] } bullets · { steps:[...] } numbered
//   { faq:[[q,a],...] } · { note } callout · { cta:[{ to, label }] } related links
// Top-level: summary (1-2 sentences, answer-first), updated (YYYY-MM-DD), body [].
//
// REWRITTEN 2026-08-19 against the enforcing code. Prices are USD, matching
// src/utils/tierSystem.js and what Play and PayRam actually charge; the old
// euro figures were wrong. Voice messages, post boosts, custom banners and
// co-streaming were removed because they have no tier check and are free.

export default {
  summary: "Lite ($4.99/mo) removes the streaming follower gate, gives 720p streaming for four hours a day, faster VP, 1GB uploads and scheduling tools. Pro ($9.99/mo) adds 1080p with no daily limit, 90-day replays, advanced analytics and 5GB uploads. Neither changes your revenue share.",
  updated: "2026-08-19",
  body: [
    {
      p: "Lite and Pro both unlock serious streaming and creating, but they sit at different levels. Here is the difference, plainly."
    },
    {
      h2: "Lite, $4.99 per month"
    },
    {
      p: "Lite is the entry point for people who want to stream and post properly. It removes the follower requirement so you can go live from day one, bumps streaming to 720p and your daily allowance from 30 minutes to four hours, removes ads, earns VP at 1.5× with a monthly VP and coin bonus, lifts uploads to 1GB, and adds scheduled posts, scheduled DMs, chat auto-translate and the Creator Studio analytics and calendar."
    },
    {
      h2: "Pro, $9.99 per month"
    },
    {
      p: "Pro is the full kit. On top of everything in Lite, you get 1080p streaming with no daily limit, every broadcast saved as a 90-day replay, 2× VP with a bigger monthly bonus, 5GB uploads with photos kept at full 4K, the complete vergr.me design kit with lead capture and tracking, advanced analytics, and an animated avatar with a Pro badge."
    },
    {
      h2: "Which should you pick?"
    },
    {
      list: [
        "Pick Lite if you mainly want to stream at solid quality without a follower gate, and post more.",
        "Pick Pro if you stream long sessions, want your broadcasts kept as replays, or you are running your vergr.me page as a real landing page."
      ]
    },
    {
      note: "Your revenue share is the same on Free, Lite and Pro. It is set by your lifetime earnings alone. Upgrading buys capability, never a better rate."
    },
    {
      faq: [
        [
          "Do I need Lite or Pro to co-stream?",
          "No. Co-streaming with a guest is open to everyone on every plan."
        ],
        [
          "Do I need a paid plan to create a squad or send voice messages?",
          "No. Squads, voice messages, video messages, post boosts, paid streams and custom banners are free for all accounts."
        ]
      ]
    },
    {
      cta: [
        {
          to: "/platform/help/what-does-each-plan-include",
          label: "Full breakdown"
        },
        {
          to: "/platform/help/how-do-i-upgrade-my-plan",
          label: "Upgrade"
        }
      ]
    }
  ]
};
