// Help center article: How do I send a direct message?
// Edit the text freely. Block model:
//   { p } paragraph · { h2 } heading · { list:[...] } bullets · { steps:[...] } numbered
//   { faq:[[q,a],...] } · { note } callout · { cta:[{ to, label }] } related links
// Top-level: summary (1-2 sentences, answer-first), updated (YYYY-MM-DD), body [].

export default {
  summary: "Open Messages, tap new message, search for the person, and start typing. You can send text, photos, clips, and voice messages, and start voice or video calls. If you do not follow each other, your first message may arrive as a message request. Conversations are private.",
  updated: "2026-06-06",
  body: [
    {
      p: "Direct messaging on VERGR works the way you would expect, and your conversations are private, they are not stored on a server to be read later."
    },
    {
      h2: "How to send a DM"
    },
    {
      steps: [
        "Open Messages from the menu.",
        "Tap new message.",
        "Search for the person by username and select them.",
        "Type your message and send."
      ]
    },
    {
      h2: "What you can send"
    },
    {
      p: "Beyond text, you can share photos, clips, and voice messages, and jump into a voice or video call right from the conversation. Group chats work the same way, with multiple people in one thread."
    },
    {
      h2: "Message requests"
    },
    {
      p: "If you message someone who does not follow you, your message may land in their message requests rather than their main inbox, so people are not bombarded by strangers. They can accept it to start chatting. You can control who is allowed to message you in your settings."
    },
    {
      note: "Your messages and calls are private. Only public surfaces are moderated, never your DMs."
    },
    {
      cta: [
        {
          to: "/platform/help/how-do-message-requests-work",
          label: "Message requests"
        },
        {
          to: "/platform/help/are-my-direct-messages-private",
          label: "Are my DMs private?"
        }
      ]
    }
  ]
};
