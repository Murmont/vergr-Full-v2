// Help center article: How do I create a tournament?
// Edit the text freely. Block model:
//   { p } paragraph · { h2 } heading · { list:[...] } bullets · { steps:[...] } numbered
//   { faq:[[q,a],...] } · { note } callout · { cta:[{ to, label }] } related links
// Top-level: summary (1-2 sentences, answer-first), updated (YYYY-MM-DD), body [].

export default {
  summary: "Open Create Tournament, pick the game and format, set your ticket price, capacity, and how much of each ticket funds the prize purse, add a banner and schedule, then publish and share the link. Competitors play free; fans buy tickets. You keep most of each sale (10% platform fee). You can host solo or for your squad.",
  updated: "2026-06-06",
  body: [
    {
      p: "Anyone can host a tournament on VERGR, not just official events. The create flow walks you through every setting, enforces the limits so you cannot set up something unfair, and handles the bracket, the prize, and result verification for you once it is live. Here is how to put one together properly."
    },
    {
      h2: "Set it up"
    },
    {
      steps: [
        "Open Create Tournament from the Tournaments section.",
        "Pick the game. The system knows how each supported game is verified, so this also sets how results get confirmed.",
        "Choose a format: single elimination, double elimination, round robin, Swiss, or battle royale, and whether matches are single games or a best-of series.",
        "Set the maximum number of players or squads, then your ticket price, how many tickets are available (capacity), and the share of each ticket that funds the prize purse. Optionally add your own Coins to the purse.",
        "Add a banner and a clear schedule so people know when to show up.",
        "Publish, then share the event link so fans can buy tickets. It also appears in the Tournaments list for competitors to find and join free."
      ]
    },
    {
      h2: "How tickets, the purse, and fees work"
    },
    {
      p: "Competitors play free — there's no entry fee. Fans buy spectator tickets in Coins at the price you set. VERGR takes a flat 10% of each ticket sale; you choose how much of the rest goes into the prize purse versus your own earnings. The purse (your chosen share of sales plus any Coins you add) pays out to the winner. Capacity is worth setting thoughtfully: it caps how many can watch live, which helps everyone plan for the event."
    },
    {
      h2: "Hosting for your squad"
    },
    {
      p: "If you run a squad, you can host on behalf of it, and you can add to the prize purse from the squad treasury so your community has something bigger to compete for. Squad-hosted events are a strong way to build a reputation and pull in new members."
    },
    {
      h2: "Your job as host"
    },
    {
      p: "Hosting comes with responsibility. Set clear rules before tickets go on sale, pick a realistic schedule, and be available around match times so the event runs smoothly. For games that are not auto-verified, plan to have a moderator on hand to confirm results. The clearer you are up front, the fewer disputes you deal with later, and the more fans and players will trust your next event."
    },
    {
      note: "Promote your event everywhere: share the link, drop a ticket card in DMs and squad chats, and even sell tickets live on stream. You can also offer a season pass that unlocks all your ticketed events."
    },
    {
      faq: [
        [
          "Can I make money hosting?",
          "Yes. You earn from ticket sales — you keep each sale minus the flat 10% platform fee and the share you chose to route into the prize purse. The bigger the audience you bring, the more you make. Season passes add a recurring revenue stream from your most loyal fans."
        ],
        [
          "What format should I pick?",
          "Single elimination is fast and simple for a first event. Round robin is fairer for small groups. Double elimination is kinder to players who have one bad game. Pick based on how many people and how much time you have."
        ],
        [
          "Can I cancel a tournament?",
          "Yes. If you cancel before it starts, every ticket is refunded to buyers and any purse top-up you added is returned. Everyone is notified automatically."
        ]
      ]
    },
    {
      cta: [
        {
          to: "/platform/help/how-do-tournaments-work-on-vergr",
          label: "How tournaments work"
        },
        {
          to: "/platform/help/what-is-a-squad",
          label: "Hosting with a squad"
        }
      ]
    }
  ]
};
