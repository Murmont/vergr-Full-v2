// Help center article: How do I leave or delete a conversation?
// Block model: { p } | { h2 } | { list:[] } | { steps:[] } | { faq:[[q,a]] } | { note } | { cta:[{to,label}] }

export default {
  summary: "Open the conversation, tap the header for details, and choose what you need: Clear Chat History wipes the messages on your device, Delete Chat removes the conversation from your inbox, and in a group, Leave Group takes you out of it. Deleting a one-to-one chat only affects your side, the other person keeps their copy.",
  updated: "2026-06-18",
  body: [
    {
      p: "There are three different actions here and they do different things. Pick the one that matches what you actually want: tidy up, get a chat out of your inbox, or get out of a group."
    },
    {
      h2: "Clear chat history"
    },
    {
      p: "This clears the messages in a conversation on your device while keeping the conversation itself in your inbox. Open the chat, tap the header to open details, and choose Clear Chat History. It is the gentle option when a thread is just cluttered."
    },
    {
      h2: "Delete a chat"
    },
    {
      p: "This removes the whole conversation from your inbox. Open the chat details and choose Delete Chat. In a one-to-one chat this is your side only: the other person still has their copy and their messages. If you later start chatting with them again, it begins a fresh thread rather than dragging the old one back."
    },
    {
      steps: [
        "Open the conversation.",
        "Tap the header (name or photo) to open the details.",
        "Choose Clear Chat History to wipe messages but keep the chat, or Delete Chat to remove it from your inbox.",
        "Confirm when asked."
      ]
    },
    {
      h2: "Leave a group"
    },
    {
      p: "To get out of a group, open it, tap the header to open Group Info, and choose Leave Group. A short \"left the group\" note is posted in the thread so the others know. If you are an admin, leaving does not delete the group for everyone else."
    },
    {
      note: "Blocking is separate from all of this. Deleting or leaving a chat does not block the person. If you also want to stop them contacting you, block them from the chat details."
    },
    {
      faq: [
        [
          "If I delete a one-to-one chat, does it delete for the other person?",
          "No. It only clears your side. They keep their copy of the conversation."
        ],
        [
          "Can I rejoin a group after leaving?",
          "Only if it is public, or if an admin adds you back to a private group."
        ],
        [
          "What is the difference between clear and delete?",
          "Clear keeps the conversation in your inbox but empties it. Delete removes the conversation from your inbox entirely."
        ]
      ]
    },
    {
      cta: [
        {
          to: "/platform/help/how-do-i-change-my-chat-settings",
          label: "Change your chat settings"
        },
        {
          to: "/platform/help/how-do-i-add-or-remove-people-from-a-group-chat",
          label: "Add or remove people in a group"
        }
      ]
    }
  ]
};
