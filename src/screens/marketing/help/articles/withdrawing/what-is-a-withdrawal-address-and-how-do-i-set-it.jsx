// Help center article: What is a withdrawal address and how do I set it?
// Edit the text freely. Block model:
//   { p } paragraph · { h2 } heading · { list:[...] } bullets · { steps:[...] } numbered
//   { faq:[[q,a],...] } · { note } callout · { cta:[{ to, label }] } related links
// Top-level: summary (1-2 sentences, answer-first), updated (YYYY-MM-DD), body [].

export default {
  summary: "A withdrawal address is the cryptocurrency wallet address your payouts are sent to. You add it in your wallet security settings, where it is whitelisted so withdrawals can only ever go to an address you have approved. Set it once, confirm it carefully, and future withdrawals use it.",
  updated: "2026-06-06",
  body: [
    {
      p: "Since payouts are in crypto, you need to tell VERGR where to send them. That destination is your withdrawal address, and it is a security feature as much as a setting."
    },
    {
      h2: "What it is"
    },
    {
      p: "It is the address of a crypto wallet you control. VERGR uses a whitelist: withdrawals can only be sent to an address you have added and approved in advance. That way, even if someone got into your account, they could not redirect your money to an address you never authorized."
    },
    {
      h2: "How to set it"
    },
    {
      steps: [
        "Open your wallet and go to the security settings.",
        "Find withdrawal addresses and choose to add a new one.",
        "Paste the address from your own crypto wallet. Copy and paste, do not type it by hand.",
        "Confirm it. You may be asked for your PIN or two-factor code to approve the change.",
        "Once whitelisted, it is available to select on the withdraw screen."
      ]
    },
    {
      note: "Crypto transfers cannot be reversed. Make sure the address is correct and on the right network before approving it. Sending to a wrong address means the funds are gone."
    },
    {
      cta: [
        {
          to: "/platform/help/what-is-a-whitelisted-withdrawal-address-and-why-do-i-need-one",
          label: "Whitelisted addresses"
        },
        {
          to: "/platform/help/how-do-i-add-or-remove-a-withdrawal-address",
          label: "Add or remove an address"
        },
        {
          to: "/platform/help/how-do-i-withdraw-my-earnings",
          label: "How to withdraw"
        }
      ]
    }
  ]
};
