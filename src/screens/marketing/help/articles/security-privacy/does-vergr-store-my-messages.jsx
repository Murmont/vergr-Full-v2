export default {
  summary: "No. Your direct messages are delivered through a real-time relay and are not stored as readable text on VERGR servers. VERGR keeps only the minimum needed to run a conversation — things like unread counts — not your message content. DMs are not scanned by moderation AI.",
  updated: "2026-06-07",
  body: [
    { p: "VERGR treats private chats as private. The content of your one-to-one and group messages is not kept in a readable database on the platform." },
    { h2: "What is and isn't stored" },
    { list: [
      "Message text and media: delivered through a relay, not stored as readable content on VERGR servers.",
      "Conversation metadata: minimal info like who the conversation is with and unread counts, so the app works.",
      "Moderation: private DMs are NOT read by VERGR's content-moderation AI. That AI only runs on public surfaces like posts and live-stream chat.",
    ]},
    { h2: "What this means for you" },
    { p: "You can speak freely in DMs. If someone harasses you, you can still report the conversation — that sends the specific reported content to moderators, but VERGR is not monitoring your chats in the background." },
    { cta: [
      { to: "/platform/help/are-my-direct-messages-private", label: "Are my DMs private?" },
      { to: "/platform/help/how-do-i-report-a-message-or-a-conversation", label: "Reporting a message" }
    ]}
  ]
};
