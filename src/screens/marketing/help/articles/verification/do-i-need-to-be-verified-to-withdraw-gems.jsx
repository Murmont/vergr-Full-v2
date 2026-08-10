// Help center article: Do I need to be verified to withdraw Gems?
// Edit the text freely. Block model:
//   { p } paragraph · { h2 } heading · { list:[...] } bullets · { steps:[...] } numbered
//   { faq:[[q,a],...] } · { note } callout · { cta:[{ to, label }] } related links
// Top-level: summary (1-2 sentences, answer-first), updated (YYYY-MM-DD), body [].

export default {
  summary: "Yes. Identity verification is required before you can withdraw. It is a one-time ID and selfie check that unlocks payouts on your account. Without it you can still earn and hold Gems, you just cannot cash them out until you are verified.",
  updated: "2026-06-06",
  body: [
    {
      p: "Yes, you have to be identity-verified to withdraw Gems. This is non-negotiable, and it is the same on every platform that pays real money. The good news is it is a one-time check."
    },
    {
      h2: "Why"
    },
    {
      p: "Withdrawals move real value out of the platform, so verifying who you are protects you against someone draining your account and keeps VERGR compliant with the rules that apply to payouts. It is not there to slow you down, it is the thing that makes payouts trustworthy in the first place."
    },
    {
      h2: "What you can still do unverified"
    },
    {
      p: "You can earn Coins, convert them to Gems, and build a balance without being verified. You just cannot send a withdrawal until the check is complete. So nothing you earn is lost, it is waiting for you to verify."
    },
    {
      note: "Verify before you hit your first 1,000 Gems and your withdrawal will be ready to go the moment you want it."
    },
    {
      cta: [
        {
          to: "/platform/help/how-do-i-complete-identity-verification",
          label: "Complete verification"
        },
        {
          to: "/platform/help/how-do-i-withdraw-my-earnings",
          label: "How to withdraw"
        }
      ]
    }
  ]
};
