// Help center article: How do I report a message or a conversation?
// Block model: { p } | { h2 } | { list:[] } | { steps:[] } | { faq:[[q,a]] } | { note } | { cta:[{to,label}] }

export default {
  summary: "Direct messages, group chats, and squad chats are private and are not read or moderated by anyone, so there is no content-report button inside a private conversation. If someone is bothering you, block them, which stops all their messages and calls, and leave or delete the chat. Reporting for review applies to public content like posts, streams, and tournament chat.",
  updated: "2026-06-18",
  body: [
    {
      p: "It helps to know how moderation actually works here, because it changes the answer. Your private conversations are genuinely private: direct messages, group chats, and squad chats are not scanned by automated systems and are not read by moderators. That privacy is the point, and it is also why there is no \"report this message\" button inside a private chat for someone to review, because nobody is reviewing private chats."
    },
    {
      h2: "What to do about an abusive private chat"
    },
    {
      p: "Since no moderator sees inside your private chats, the tools are about cutting the person off, and they are immediate and in your control:"
    },
    {
      steps: [
        "Open the conversation and tap the header to open the chat details.",
        "Tap Block. A blocked person can no longer message or call you.",
        "Optionally Clear Chat History or Delete Chat to remove it from your inbox.",
        "In a group, an admin can remove the member from Group Info."
      ]
    },
    {
      p: "You can review and undo blocks any time in Settings, then Blocked Users."
    },
    {
      h2: "What can be reported for review"
    },
    {
      p: "Reporting in the moderation sense, where a human or automated system looks at the content, applies to public surfaces, because those are the only places content is moderated:"
    },
    {
      list: [
        "Posts and other public content: use the report option on the item.",
        "Live streams: report from the stream.",
        "Tournament spectator chat and stream tips: these public chats are moderated.",
        "These reports go to the Vanguard moderation queue for review."
      ]
    },
    {
      note: "Keeping private chats unmoderated is a deliberate choice for your privacy. The trade-off is that safety in private chats is handled by blocking and leaving, not by reporting content for someone else to read."
    },
    {
      faq: [
        [
          "If I block someone, do they know?",
          "They are not sent a notification. They simply can no longer reach you by message or call."
        ],
        [
          "Someone is breaking the rules in a public stream chat. What do I report?",
          "Use the report option on that public surface. Public chats (stream and tournament) are moderated, unlike private DMs."
        ],
        [
          "Can I get a private message reviewed by a moderator?",
          "No. Private DMs, group chats, and squad chats are not read by anyone. Block and leave is the path for those."
        ]
      ]
    },
    {
      cta: [
        {
          to: "/platform/help/are-my-messages-and-calls-private",
          label: "Are my messages private?"
        },
        {
          to: "/platform/help/how-do-i-leave-or-delete-a-conversation",
          label: "Leave or delete a conversation"
        }
      ]
    }
  ]
};
