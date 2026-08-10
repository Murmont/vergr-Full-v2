// Help center article: What is the conversion rate at each rank?
// Edit the text freely. Block model:
//   { p } paragraph · { h2 } heading · { list:[...] } bullets · { steps:[...] } numbered
//   { faq:[[q,a],...] } · { note } callout · { cta:[{ to, label }] } related links
// Top-level: summary (1-2 sentences, answer-first), updated (YYYY-MM-DD), body [].

export default {
  summary: "The conversion commission steps down with your lifetime VP, from 30% at the start to a 15% floor reached at 100,000 VP. The approximate band for each of the 11 ranks is below. Your exact rate is always shown in the wallet before you confirm a conversion.",
  updated: "2026-06-16",
  body: [
    {
      p: "The commission is set by your total VP, dropping at a few thresholds rather than every level. It reaches its 15% floor at 100,000 VP and never goes lower. Here is roughly where each rank sits, from most expensive to cheapest."
    },
    {
      h2: "Approximate rate by rank"
    },
    {
      list: [
        "Rookie: 30% down to 20%.",
        "Contender: 20% down to 18%.",
        "Rival: 18%.",
        "Challenger: 18% down to the 15% floor.",
        "Elite: 15%.",
        "Champion: 15%.",
        "Veteran: 15%.",
        "Legend: 15%.",
        "Mythic: 15%.",
        "Ascendant: 15%.",
        "Immortal: 15%, the lowest possible rate."
      ]
    },
    {
      h2: "Why a range, not one number"
    },
    {
      p: "The lower ranks span the VP thresholds where the rate steps down, so they are shown as a band: early on you pay near the top of the range, and you reach the bottom as your VP climbs. From around 100,000 VP onward every rank sits at the 15% floor. The rate never rises and never goes below 15%."
    },
    {
      note: "These are approximate. The precise commission for your current level is displayed in the wallet on the convert screen, so you always see the exact figure before you confirm."
    },
    {
      cta: [
        {
          to: "/platform/help/why-does-the-conversion-rate-change-with-my-rank",
          label: "Why rate changes with rank"
        },
        {
          to: "/platform/help/how-do-i-lower-my-conversion-commission",
          label: "Lower your commission"
        }
      ]
    }
  ]
};
