// Help center article: What can I spend Coins on?
// Edit the text freely. Block model:
//   { p } paragraph · { h2 } heading · { list:[...] } bullets · { steps:[...] } numbered
//   { faq:[[q,a],...] } · { note } callout · { cta:[{ to, label }] } related links
// Top-level: summary (1-2 sentences, answer-first), updated (YYYY-MM-DD), body [].

export default {
  summary: "Coins are the in-app currency, so almost everything you pay for inside VERGR uses them: event tickets and season passes, tips to creators, Stream Boosts, subscriptions, creator memberships, and squad contributions. Earning is separate from spending, and is paid by Vergr as a revenue share.",
  updated: "2026-06-06",
  body: [
    {
      p: "Coins are how money moves around inside VERGR. Here is where they actually go."
    },
    {
      h2: "What Coins pay for"
    },
    {
      list: [
        "Event tickets and season passes. Buy a ticket, or a host's season pass, to watch a ticketed event.",
        "Tips. Send Coins to creators on their posts, profiles, and live streams.",
        "Stream Boosts. Spend Coins to boost a stream for more discovery and the ability to notify followers.",
        "Subscriptions. Pay for a Lite or Pro plan with Coins instead of a card.",
        "Creator memberships. Subscribe to a creator's Fan or Super Fan tier.",
        "Squad contributions. Pool Coins into a squad treasury to fund what the squad does together."
      ]
    },
    {
      h2: "Coins vs earning"
    },
    {
      p: "Coins are for spending inside the app. They are a licence to use features, they have no cash value, and they cannot be transferred or redeemed for money. Earning is a separate thing: if people pay for your content, Vergr pays you a share of that revenue."
    },
    {
      cta: [
        {
          to: "/platform/help/what-are-vc-coins",
          label: "What are Coins"
        },
        {
          to: "/platform/help/how-do-i-buy-vc-coins",
          label: "Buy Coins"
        },
        {
          to: "/platform/help/how-do-coins-and-vp-work-together",
          label: "How Coins and VP work"
        }
      ]
    }
  ]
};
