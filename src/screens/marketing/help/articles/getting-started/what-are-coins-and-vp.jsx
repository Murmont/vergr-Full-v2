// Help center article: What are Coins and VP?
// Edit the text freely. Block model:
//   { p } paragraph · { h2 } heading · { list:[...] } bullets · { steps:[...] } numbered
//   { faq:[[q,a],...] } · { note } callout · { cta:[{ to, label }] } related links
// Top-level: summary (1-2 sentences, answer-first), updated (YYYY-MM-DD), body [].

export default {
  summary:
    "Coins are what you buy and spend on VERGR. VP is the score that raises your rank. Coins are spent, VP is earned, and neither is money you can take out.",
  updated: "2026-08-16",
  body: [
    {
      p: "New accounts see two numbers and reasonably want to know which one matters. Short version: you spend Coins, you accumulate VP.",
    },
    { h2: "Coins" },
    {
      list: [
        "Bought in packs, from a small starter pack up to large bulk packs.",
        "Spent on tips, creator memberships, paid stream access, unlocks and boosts.",
        "A licence to use features. No cash value, non-transferable, not redeemable for money.",
        "One worldwide price, charged in US dollars.",
      ],
    },
    { h2: "VP (VERGR Points)" },
    {
      list: [
        "Earned by using the platform: posting, streaming, supporting creators.",
        "Sets your rank, which unlocks perks and improves a creator's revenue share rate.",
        "Not a balance. VP cannot be spent, transferred or cashed out.",
      ],
    },
    { h2: "What about getting paid?" },
    {
      p: "If people pay for your content, that is revenue VERGR earns, and VERGR pays you a share of it on a schedule. It is not a balance you draw on, and you do not request it. You track what you have earned in Creator Studio.",
    },
    {
      note:
        "Nothing on VERGR can be withdrawn, converted or sent to another user. Coins go in and get spent on features; creator revenue share is paid out to you by VERGR.",
    },
    {
      cta: [
        { to: "/platform/help/what-are-vc-coins", label: "More about Coins" },
        { to: "/platform/help/what-is-vp-vergr-points", label: "More about VP" },
        { to: "/platform/help/how-do-i-make-money-on-vergr", label: "How creators earn" },
      ],
    },
  ],
};
