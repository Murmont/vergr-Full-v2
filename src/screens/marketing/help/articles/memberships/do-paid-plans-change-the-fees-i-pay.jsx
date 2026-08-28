// Help center article: Do paid plans change the fees I pay?
//
// REWRITTEN 2026-08-19. The previous version said Vergr keeps 30% of what your
// content earns, falling to 15% "as your VP rank climbs". Both halves were
// wrong and they contradicted this article's own summary:
//   - The VP ladder it described is COMMISSION_RATES / commissionForVP, which
//     has ZERO callers in functions/ or src/. Nothing charges it.
//   - The real rate is the revenue share in functions/coinLedger.js
//     (REVENUE_SHARE_RATES + shareForEarnings): the creator KEEPS 50% rising to
//     80%, keyed to LIFETIME GROSS EARNINGS, never to VP and never to plan.
// Do not reintroduce a VP-based rate here without a caller to point at.

export default {
  summary: "No. Your rate is the same on every plan. You keep 50% of what your content earns, rising to 80% as your lifetime earnings grow, and that ladder is decided by your earnings alone, never by your plan and never by your rank.",
  updated: "2026-08-19",
  body: [
    {
      p: "It is a fair question, because many platforms sell fee discounts as a subscription perk. VERGR deliberately does not. Whether you are on Free, Lite, or Pro, the money maths is identical."
    },
    {
      h2: "The rates, on every plan"
    },
    {
      list: [
        "Tips: nothing is deducted when a tip is sent. The full amount counts as revenue your content generated, and you accrue your share of it.",
        "Your revenue share: you keep 50% at the start, rising to 80% as your lifetime earnings grow. The ladder is decided only by what you have earned in total, never by your plan and never by your rank.",
        "Creator memberships, unlocks, tickets and season passes: same share, same ladder.",
        "There is no separate platform fee, service fee or transaction fee on any of these. The share is taken once, when you accrue."
      ]
    },
    {
      h2: "So what do paid plans actually do for earnings?"
    },
    {
      p: "Indirectly, quite a lot, but never through the rate. Lite and Pro give you better streaming quality, longer sessions, bigger uploads and scheduling and analytics tools. Those help you reach more people, and reaching more people is what moves you up the earnings ladder. What a plan cannot do is move you up the ladder without the earnings."
    },
    {
      p: "Lite multiplies the VP you earn by 1.5x and Pro by 2x. VP drives your rank, badges and prestige. It does not touch your revenue share."
    },
    {
      note: "If you see anything anywhere suggesting a paid plan gets you a better rate, cheaper fees or discounted coins, it is wrong: no such discount exists."
    },
    {
      cta: [
        { to: "/platform/help/what-fees-does-vergr-charge", label: "What VERGR charges" },
        { to: "/platform/help/what-does-each-plan-include", label: "What plans actually include" }
      ]
    }
  ]
};
