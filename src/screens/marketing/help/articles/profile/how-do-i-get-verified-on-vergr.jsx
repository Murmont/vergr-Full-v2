// Help center article: How do I get verified on VERGR?
// Edit the text freely. Block model:
//   { p } paragraph · { h2 } heading · { list:[...] } bullets · { steps:[...] } numbered
//   { faq:[[q,a],...] } · { note } callout · { cta:[{ to, label }] } related links
// Top-level: summary (1-2 sentences, answer-first), updated (YYYY-MM-DD), body [].

export default {
  summary: "There are two kinds of \"verified\" on VERGR. Identity verification (KYC) is a one-time ID and selfie check that unlocks the wallet and payouts. The creator verification badge is earned through the Creator Studio by meeting its requirements. They are separate things.",
  updated: "2026-06-06",
  body: [
    {
      p: "\"Getting verified\" can mean two different things on VERGR, so here is both, because people often mix them up."
    },
    {
      h2: "Identity verification (for the money features)"
    },
    {
      p: "This is the one-time identity check, sometimes called KYC. You submit a government ID and a selfie, and once approved it unlocks the wallet, receiving tips, and withdrawals. It is required for anything that handles real money, and it protects you and the platform. Most checks are quick."
    },
    {
      h2: "The creator verification badge"
    },
    {
      p: "This is the badge that marks you as an established creator. It is earned through the Creator Studio by meeting its requirements rather than by submitting an ID. It is about your standing as a creator, not about unlocking money features."
    },
    {
      h2: "Which one do you need?"
    },
    {
      list: [
        "Want to withdraw earnings? You need identity verification.",
        "Want the creator badge on your profile? Work toward it in the Creator Studio."
      ]
    },
    {
      cta: [
        {
          to: "/platform/help/how-do-i-complete-identity-verification",
          label: "Complete identity verification"
        },
        {
          to: "/platform/help/how-do-i-get-the-creator-verification-badge",
          label: "Get the creator badge"
        }
      ]
    }
  ]
};
