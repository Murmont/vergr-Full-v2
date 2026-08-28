// Help center article: What do I unlock at each rank?
// Edit the text freely. Block model:
//   { p } paragraph · { h2 } heading · { list:[...] } bullets · { steps:[...] } numbered
//   { faq:[[q,a],...] } · { note } callout · { cta:[{ to, label }] } related links
// Top-level: summary (1-2 sentences, answer-first), updated (YYYY-MM-DD), body [].
//
// REWRITTEN 2026-08-23 against src/utils/rankUnlocks.js, which is the table the
// app actually reads. Two claims were removed because they are false:
//   1. "Climbing ranks increases the share you keep" — it does not, the share is
//      keyed to lifetime earnings alone.
//   2. "A coloured avatar ring ... everywhere you appear" — rank never colours
//      an avatar ring. That ring belongs to live and status. Rank shows in live
//      chat and on your stream entrance, and nowhere else.
// If you add a reward, add it to rankUnlocks.js first, then describe it here.

export default {
  summary: "Every level gives you something: a faster VP earn rate at all 100 of them, plus crests, chat colours, profile accents and themes, Stream Boost tokens, and a bigger entrance when you join a live stream. Rank does not change what you are paid.",
  updated: "2026-08-23",
  body: [
    {
      p: "Rank is status and convenience. There are no dead levels: each one pays something, and you can see the full list on your levels page under What you unlock."
    },
    {
      h2: "Every single level"
    },
    {
      p: "Your VP earn rate goes up half a percent per level, so everything you do earns a little faster than it did before. By level 100 you are earning just under one and a half times base VP. It is small per level and it compounds over the whole ladder."
    },
    {
      h2: "Live chat"
    },
    {
      list: [
        "Your crest sits beside your name, and it changes each time you enter a new rank band.",
        "From level 3 your name is tinted to your rank colour.",
        "From level 63 you can switch on a slow gradient sweep across your name."
      ]
    },
    {
      note: "Rank shows in live chat and on your stream entrance only. It never colours your avatar ring anywhere in the app, because that ring means you are live or have a status up, and two signals fighting over one ring makes both meaningless."
    },
    {
      h2: "Walking into a live stream"
    },
    {
      list: [
        "People who follow you see your entry ribbon from the start.",
        "From level 31 the whole room sees it, including people who have never met you.",
        "From level 71 light travels the edge of the ribbon as it lands.",
        "From level 91 it shimmers, and the room hears you arrive."
      ]
    },
    {
      h2: "Your profile"
    },
    {
      p: "Accent colours unlock across the ladder, from Violet at level 2 up to Immortal white at level 100, and profile themes unlock alongside them. You equip them yourself on the Appearance tab of your levels page. They colour the page, not your avatar."
    },
    {
      h2: "Stream Boost tokens"
    },
    {
      p: "Seven of these across the ladder, at levels 5, 14, 26, 41, 50, 76 and 93. Each one pays for a public stream that would otherwise cost you 50 coins. If that stream earns 50 coins in tips, the token comes back to you, exactly as the coins would have."
    },
    {
      h2: "What rank does NOT do"
    },
    {
      p: "It does not change your revenue share, which is set by your lifetime earnings and nothing else. It does not give you moderator powers. It does not affect who sees your posts."
    },
    {
      cta: [
        {
          to: "/platform/help/how-does-rank-lower-my-fees",
          label: "Does rank lower my fees?"
        },
        {
          to: "/platform/help/what-is-vp-and-how-do-i-earn-it",
          label: "How to earn VP"
        }
      ]
    }
  ]
};
