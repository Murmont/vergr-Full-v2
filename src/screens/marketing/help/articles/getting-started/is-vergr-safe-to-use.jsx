// Help center article: Is VERGR safe to use?
// Edit the text freely. Block model:
//   { p } paragraph · { h2 } heading · { list:[...] } bullets · { steps:[...] } numbered
//   { faq:[[q,a],...] } · { note } callout · { cta:[{ to, label }] } related links
// Top-level: summary (1-2 sentences, answer-first), updated (YYYY-MM-DD), body [].

export default {
  summary: "Yes. Your account is protected by standard sign-in security, your wallet adds a PIN, two-factor authentication, and whitelisted withdrawal addresses, and your private messages stay on your device rather than being stored on a server. There are also strong tools to block, report, and control who can reach you.",
  updated: "2026-06-06",
  body: [
    {
      p: "VERGR is built to be safe on two fronts: protecting your account and money, and protecting you from other people. Here is how both work."
    },
    {
      h2: "Your account and wallet"
    },
    {
      p: "Your login is protected with standard account security, and you can add two-factor authentication for an extra layer. The wallet goes further: a PIN guards sensitive actions, and withdrawals can only go to addresses you have added to a whitelist, so even someone who got into your session could not send your money somewhere new without clearing those checks."
    },
    {
      h2: "Your privacy"
    },
    {
      p: "Direct messages and group chats are private. Your conversations are not stored on a central server to be read later, they stay on your device. You also control who can message you, who can see your content, and you can block anyone instantly. Private messages are not scanned by moderation tools, only public surfaces are."
    },
    {
      h2: "Staying safe from other users"
    },
    {
      list: [
        "Block someone and they can no longer interact with you.",
        "Report any user, post, message, or stream for review.",
        "Filter out words you do not want to see.",
        "Control who can send you message requests."
      ]
    },
    {
      note: "VERGR is 18+, and a published Code of Conduct plus the Vanguard moderator program back up all of this with real enforcement."
    },
    {
      cta: [
        {
          to: "/platform/help/how-do-i-keep-myself-safe-on-vergr",
          label: "Safety tips"
        },
        {
          to: "/platform/help/is-my-vergr-wallet-secure",
          label: "Wallet security"
        }
      ]
    }
  ]
};
