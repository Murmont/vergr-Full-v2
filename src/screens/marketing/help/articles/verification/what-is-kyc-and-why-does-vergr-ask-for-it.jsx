// Help center article: What is KYC and why does VERGR ask for it?
// Edit the text freely. Block model:
//   { p } paragraph · { h2 } heading · { list:[...] } bullets · { steps:[...] } numbered
//   { faq:[[q,a],...] } · { note } callout · { cta:[{ to, label }] } related links
// Top-level: summary (1-2 sentences, answer-first), updated (YYYY-MM-DD), body [].

export default {
  summary: "KYC means \"know your customer\", the standard identity check any platform handling real money runs. On VERGR it is a one-time government-ID and selfie check that confirms you are a real, eligible person over 18. It unlocks the wallet and payouts and helps stop fraud and underage use.",
  updated: "2026-06-06",
  body: [
    {
      p: "KYC stands for \"know your customer\". It is the identity check that banks, exchanges, and any serious money platform run, and VERGR uses it for the same reasons. If you have ever signed up to a crypto exchange or a payment app, you have done KYC before."
    },
    {
      h2: "What it involves"
    },
    {
      p: "You submit a government-issued ID and take a selfie so it can be matched to the document. That confirms you are a real person, that you are who you say you are, and that you meet the 18+ requirement. It is a one-time process for standard use."
    },
    {
      h2: "Why VERGR asks"
    },
    {
      list: [
        "To unlock the wallet, paid tournaments, and withdrawals safely.",
        "To stop fraud and stop anyone draining a stolen account.",
        "To keep underage users out of the money features.",
        "To stay compliant with the rules that apply to real-money platforms."
      ]
    },
    {
      note: "Your ID and selfie are handled securely for verification. They are not posted anywhere or shared with other users."
    },
    {
      cta: [
        {
          to: "/platform/help/is-my-id-and-selfie-data-safe",
          label: "Is my ID data safe?"
        },
        {
          to: "/platform/help/what-are-the-verification-levels-and-what-does-each-unlock",
          label: "Verification levels"
        }
      ]
    }
  ]
};
