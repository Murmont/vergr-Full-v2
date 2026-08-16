// Help center article: How do I set up my wallet PIN?
// Edit the text freely. Block model:
//   { p } paragraph · { h2 } heading · { list:[...] } bullets · { steps:[...] } numbered
//   { faq:[[q,a],...] } · { note } callout · { cta:[{ to, label }] } related links
// Top-level: summary (1-2 sentences, answer-first), updated (YYYY-MM-DD), body [].

export default {
  summary: "When you first open the wallet you are prompted to create a PIN. It guards sensitive wallet actions, so even with your phone unlocked nobody can spend your Coins without it. You can set or change it from the wallet security settings.",
  updated: "2026-06-06",
  body: [
    {
      p: "Your wallet PIN is a short code that protects the money side of your account. It is separate from your login, so even on an unlocked phone, sensitive wallet actions need the PIN."
    },
    {
      h2: "Setting it up"
    },
    {
      p: "The first time you open the wallet, you are prompted to create a PIN. Choose something you will remember but others could not guess, and confirm it. From then on, the wallet asks for it when you do something sensitive, like buying a large Coin pack."
    },
    {
      h2: "Changing it"
    },
    {
      steps: [
        "Open the wallet and go to its security settings.",
        "Choose to change your PIN.",
        "Enter your current PIN, then your new one.",
        "Confirm to save."
      ]
    },
    {
      note: "Never share your PIN. VERGR support will never ask you for it. If you forget it, there is a recovery process tied to your verified identity."
    },
    {
      cta: [
        {
          to: "/platform/help/i-forgot-my-wallet-pin-what-do-i-do",
          label: "Forgot your PIN?"
        },
        {
          to: "/platform/help/is-my-vergr-wallet-secure",
          label: "Wallet security"
        }
      ]
    }
  ]
};
