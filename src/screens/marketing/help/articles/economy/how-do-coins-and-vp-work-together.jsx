// Help center article: How do Coins and VP work together?
// Edit the text freely. Block model:
//   { p } paragraph · { h2 } heading · { list:[...] } bullets · { steps:[...] } numbered
//   { faq:[[q,a],...] } · { note } callout · { cta:[{ to, label }] } related links
// Top-level: summary (1-2 sentences, answer-first), updated (YYYY-MM-DD), body [].

export default {
  summary:
    "Coins are what you spend on VERGR. VP is the progress score that sets your rank. They are separate: spending Coins earns VP, but VP is never money and can never be spent.",
  updated: "2026-08-16",
  body: [
    {
      p: "There are two numbers on your account and they do completely different jobs. Coins are what you spend. VP is how far you have come. Mixing them up is the single most common confusion, so here is the clean split.",
    },
    { h2: "Coins" },
    {
      p: "Coins are a licence to use VERGR features. You buy them in packs, and you spend them on tips, creator memberships, paid stream access, unlocks and boosts. Coins have no cash value, cannot be transferred to another person, and cannot be redeemed for money.",
    },
    { h2: "VP (VERGR Points)" },
    {
      p: "VP is a progress score. You earn it by using the platform, and it moves you up the rank ladder. VP is not a balance and cannot be spent on anything. What it does is unlock rank perks and improve the revenue share rate a creator earns.",
    },
    { h2: "How the two connect" },
    {
      list: [
        "Spending Coins earns VP, so activity moves your rank.",
        "VP never converts into Coins, and Coins never convert into VP.",
        "A higher rank means a creator keeps a larger share of the revenue their content generates.",
        "Neither one can be withdrawn, transferred or cashed out.",
      ],
    },
    {
      note:
        "Creator earnings are a separate thing from both. If people are paying for your content, VERGR pays you a share of that revenue on a schedule, and you track it in Creator Studio, not in your wallet.",
    },
    {
      cta: [
        { to: "/platform/help/what-are-vc-coins", label: "What are Coins?" },
        { to: "/platform/help/what-is-vp-vergr-points", label: "What is VP?" },
        { to: "/platform/help/how-do-i-see-my-earnings", label: "See your earnings" },
      ],
    },
  ],
};
