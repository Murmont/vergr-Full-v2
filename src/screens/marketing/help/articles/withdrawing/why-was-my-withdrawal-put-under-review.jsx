// Help center article: Why was my withdrawal put under review?
// Edit the text freely. Block model:
//   { p } paragraph · { h2 } heading · { list:[...] } bullets · { steps:[...] } numbered
//   { faq:[[q,a],...] } · { note } callout · { cta:[{ to, label }] } related links
// Top-level: summary (1-2 sentences, answer-first), updated (YYYY-MM-DD), body [].

export default {
  summary: "Every withdrawal goes through a standard 3-day fraud-review hold, that part is routine and applies to everyone. Occasionally a withdrawal gets extra review (for example a first payout, a new address, or an unusually large amount). This is a protection step, not an accusation, and it clears once the check is done.",
  updated: "2026-06-06",
  body: [
    {
      p: "A review can feel alarming, but it is almost always routine. It exists to protect your money, especially against someone trying to drain a compromised account."
    },
    {
      h2: "The standard hold"
    },
    {
      p: "Every withdrawal sits in a 3-day fraud-review window before it is sent. This is normal and happens to all withdrawals. During the early part of it you can even cancel the request yourself."
    },
    {
      h2: "Why some get extra review"
    },
    {
      list: [
        "It is your first withdrawal from the account.",
        "You are paying out to a newly added address.",
        "The amount is unusually large compared to your history.",
        "Recent account activity triggered a routine safety check."
      ]
    },
    {
      h2: "What to do"
    },
    {
      p: "Usually nothing, the review clears on its own and the payout proceeds. Make sure your identity verification is complete and your withdrawal address is correct, since those are the most common things a review confirms. If it stays under review longer than expected, contact support with the withdrawal details and they can look into it."
    },
    {
      note: "A review is a security measure, not a penalty. Keeping your account verified and your address whitelisted helps everything go smoothly."
    },
    {
      cta: [
        {
          to: "/platform/help/why-is-there-a-hold-on-my-withdrawal",
          label: "Why the hold"
        },
        {
          to: "/platform/help/where-do-i-see-the-status-of-my-withdrawal",
          label: "Check status"
        }
      ]
    }
  ]
};
