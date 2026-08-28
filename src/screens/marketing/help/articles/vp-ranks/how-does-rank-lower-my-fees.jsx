// Help center article: How does rank lower my fees?
// Edit the text freely. Block model:
//   { p } paragraph · { h2 } heading · { list:[...] } bullets · { steps:[...] } numbered
//   { faq:[[q,a],...] } · { note } callout · { cta:[{ to, label }] } related links
// Top-level: summary (1-2 sentences, answer-first), updated (YYYY-MM-DD), body [].
//
// REWRITTEN 2026-08-23. The old version contradicted itself inside its own
// summary: "Your VP sets the share Vergr keeps ... VP does not change what you
// are paid at all". That was a half-finished correction. The 30%-to-15% VP
// ladder (COMMISSION_RATES) charges NOTHING: no caller anywhere debits it, and
// the constants carry a do-not-display warning. The only real rate is the
// revenue share, 50% to 80%, keyed to lifetime gross earnings.
// Verified against functions/coinLedger.js and src/utils/vpSystem.js.

export default {
  summary: "It does not. Rank has no effect on fees or on what you are paid. There is no fee on any surface, and your revenue share is set by your lifetime earnings alone.",
  updated: "2026-08-23",
  body: [
    {
      p: "This one comes up a lot, so the short answer first: rank does not lower a fee, because there is no fee to lower. Vergr does not take a cut when someone tips you, buys a membership, buys a ticket, or unlocks your content. The full amount counts as revenue your content generated."
    },
    {
      h2: "What actually decides what you keep"
    },
    {
      p: "One number, and it is not VP. Your revenue share is set by your lifetime gross earnings on Vergr. It starts at 50% and rises to 80% as you earn more, and it never goes backwards."
    },
    {
      note: "Rank does not move it. Your subscription plan does not move it either. Lite and Pro earn VP faster, which gets you cosmetics and perks sooner, but they do not change the share of a single cent."
    },
    {
      h2: "Why we keep it separate"
    },
    {
      p: "Money should not depend on how much time you spend in the app. Tying payouts to an activity score would quietly punish creators who post less often but earn well, and it would turn every ranking decision into a pay decision. Keeping rank out of the money means your payout is predictable and you can work out what you will be paid without reading a table."
    },
    {
      h2: "So what is rank for?"
    },
    {
      list: [
        "Your crest and name colour in live chat.",
        "Your entrance when you join a live stream.",
        "Profile accents and themes you equip yourself.",
        "Stream Boost tokens, which pay for a public stream so you do not have to.",
        "A VP earn rate that rises half a percent per level."
      ]
    },
    {
      p: "All of it is status and convenience. None of it touches your payout, on purpose."
    },
    {
      cta: [
        {
          to: "/platform/help/what-fees-does-vergr-charge",
          label: "What Vergr charges"
        },
        {
          to: "/platform/help/what-do-i-unlock-at-each-rank",
          label: "What you unlock at each rank"
        }
      ]
    }
  ]
};
