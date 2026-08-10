// Help center article: Why is there a hold on my withdrawal?
// Edit the text freely. Block model:
//   { p } paragraph · { h2 } heading · { list:[...] } bullets · { steps:[...] } numbered
//   { faq:[[q,a],...] } · { note } callout · { cta:[{ to, label }] } related links
// Top-level: summary (1-2 sentences, answer-first), updated (YYYY-MM-DD), body [].

export default {
  summary: "Withdrawals have a 3-day hold for fraud review before they are sent. It is a protection layer: if your account were ever compromised, the hold gives time to catch and stop an unauthorised payout before money leaves. During the early part of the hold you can cancel the withdrawal yourself.",
  updated: "2026-06-06",
  body: [
    {
      p: "The hold on a withdrawal can feel like a wait, but it is genuinely there for you, not against you. It is a standard safety layer for moving real money."
    },
    {
      h2: "What the hold does"
    },
    {
      p: "When you request a withdrawal, it sits in a 3-day review window before being sent. That window is the chance to catch anything suspicious, most importantly, if someone got into your account and tried to cash out your balance, the hold gives time to spot and stop it before the money is gone."
    },
    {
      h2: "You stay in control"
    },
    {
      p: "During the early part of the hold, you can cancel a pending withdrawal yourself if you change your mind or notice something wrong. That is another reason the window exists, it leaves room to undo a mistake."
    },
    {
      h2: "After the hold"
    },
    {
      p: "Once the review window passes, the withdrawal is sent in the next batch and the crypto transfer settles. From that point it cannot be reversed, which is exactly why the hold comes first."
    },
    {
      cta: [
        {
          to: "/platform/help/how-long-does-a-withdrawal-take",
          label: "Withdrawal timing"
        },
        {
          to: "/platform/help/how-do-i-cancel-a-pending-withdrawal",
          label: "Cancel a withdrawal"
        }
      ]
    }
  ]
};
