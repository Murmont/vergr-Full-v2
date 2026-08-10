// Help center article: Are my messages and calls private?
// Block model: { p } | { h2 } | { list:[] } | { steps:[] } | { faq:[[q,a]] } | { note } | { cta:[{to,label}] }

export default {
  summary: "Yes. Direct messages, group chats, and squad chats are private and are not scanned by automated moderation or read by moderators. Voice and video calls connect directly between devices (peer-to-peer). Only public surfaces, like live stream chat, are moderated. Privacy controls for who can reach you live in Settings, then Privacy.",
  updated: "2026-06-18",
  body: [
    {
      p: "Privacy in your conversations is a core promise, so it is worth being precise about what that means and where the lines are."
    },
    {
      h2: "Your private chats are not moderated"
    },
    {
      p: "Direct messages, group chats, and squad chats are private spaces. They are not run through the automated content checks that public posts go through, and they are not read by moderators. Nobody is sitting in the middle of your private conversations. That is also why there is no \"report this message for review\" button inside a private chat, because there is no review of private chats."
    },
    {
      h2: "Where messages live"
    },
    {
      list: [
        "Your private message contents are delivered over a dedicated, secure connection rather than being stored alongside ordinary app data for moderators to query.",
        "They are kept private to you and the people in the chat.",
        "They are not used to build a public profile of you, and they are not surfaced anywhere public."
      ]
    },
    {
      h2: "Calls"
    },
    {
      p: "One-to-one voice and video calls connect directly between the two devices (peer-to-peer). The audio and video flow between you and the other person rather than being recorded and stored by VERGR."
    },
    {
      h2: "What is public, and therefore moderated"
    },
    {
      p: "To keep public spaces safe, the surfaces that everyone can see are moderated. These are not your private chats:"
    },
    {
      list: [
        "Posts and other public content.",
        "Live-stream chat.",
        "Live stream chat and the tips sent in it."
      ]
    },
    {
      h2: "Controlling who can reach you"
    },
    {
      p: "Privacy is also about who is allowed to start a conversation in the first place. In Settings, then Privacy, you can limit who can message you, turn message requests on or off, control read receipts, and manage blocked users."
    },
    {
      note: "Honesty matters here: private chats are kept off public and moderated systems, but you should not treat them as a place for secrets that would be catastrophic if a device were lost or compromised. Standard account security still applies."
    },
    {
      faq: [
        [
          "Can a moderator read my DMs if someone complains?",
          "No. Private DMs, group chats, and squad chats are not read by moderators. The tools for a bad private chat are blocking and leaving."
        ],
        [
          "Are my calls recorded?",
          "One-to-one calls connect device-to-device and are not recorded or stored by VERGR."
        ],
        [
          "Why is stream chat different?",
          "Live stream chat is public, so it is moderated to keep that shared space safe. Your private messages are not."
        ]
      ]
    },
    {
      cta: [
        {
          to: "/platform/help/how-do-i-report-a-message-or-a-conversation",
          label: "Reporting and blocking"
        },
        {
          to: "/platform/help/how-do-message-requests-work",
          label: "How message requests work"
        }
      ]
    }
  ]
};
