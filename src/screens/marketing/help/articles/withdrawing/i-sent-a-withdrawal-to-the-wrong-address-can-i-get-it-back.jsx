// Help center article: I sent a withdrawal to the wrong address, can I get it back?
// Edit the text freely. Block model:
//   { p } paragraph · { h2 } heading · { list:[...] } bullets · { steps:[...] } numbered
//   { faq:[[q,a],...] } · { note } callout · { cta:[{ to, label }] } related links
// Top-level: summary (1-2 sentences, answer-first), updated (YYYY-MM-DD), body [].

export default {
  summary: "No. Once a crypto withdrawal has been sent, it cannot be reversed, even if it went to the wrong address. That is how crypto works, not a VERGR policy. This is why you should always double-check the address before confirming, and why withdrawal addresses are whitelisted in advance.",
  updated: "2026-06-06",
  body: [
    {
      p: "This is the hard one, so here is the honest answer: no, a crypto withdrawal sent to the wrong address cannot be recovered. Not by VERGR, not by anyone. It is a feature of how crypto works, transfers are final and irreversible once they are on the network."
    },
    {
      h2: "Why it cannot be reversed"
    },
    {
      p: "A crypto transfer is not like a card payment a bank can claw back. Once it is confirmed on the network, it is done. There is no central party who can undo it, which is exactly why getting the address right matters so much."
    },
    {
      h2: "How VERGR helps you avoid it"
    },
    {
      list: [
        "Withdrawal addresses are whitelisted in advance, so you set and confirm an address before you ever send to it.",
        "A PIN and two-factor authentication guard the action.",
        "The 3-day hold gives a window to cancel before anything is sent.",
        "The address and amount are shown for you to check before you confirm."
      ]
    },
    {
      note: "Always verify the full address carefully, and when possible send a small test amount first to a new destination. Once it is sent, it is gone."
    },
    {
      cta: [
        {
          to: "/platform/help/what-is-a-whitelisted-withdrawal-address-and-why-do-i-need-one",
          label: "Whitelisted addresses"
        },
        {
          to: "/platform/help/how-do-i-cancel-a-pending-withdrawal",
          label: "Cancel before it sends"
        }
      ]
    }
  ]
};
