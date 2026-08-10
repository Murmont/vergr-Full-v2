// Help center article: How do I change my chat settings?
// Block model: { p } | { h2 } | { list:[] } | { steps:[] } | { faq:[[q,a]] } | { note } | { cta:[{to,label}] }

export default {
  summary: "Per-chat options live in the chat's details, opened from the header of any conversation. There you can mute notifications, set a nickname, change the chat wallpaper, see shared media, clear the history, block the person, or delete the chat. Who can message you, read receipts, and similar account-wide options live in Settings, then Privacy.",
  updated: "2026-06-18",
  body: [
    {
      p: "There are two layers to chat settings: options for one specific conversation, and account-wide options that apply to all your messaging. Here is where each one is."
    },
    {
      h2: "Settings for one conversation"
    },
    {
      p: "Open a conversation and tap its header (the name or photo at the top) to open the chat details. From there you can:"
    },
    {
      list: [
        "Mute notifications for that chat, so it stops pinging you without leaving it.",
        "Set a nickname for the other person that only you see.",
        "Change the wallpaper (chat background) from a set of built-in backgrounds or your own uploaded image.",
        "Browse shared media: photos, videos, files, links, and voice messages exchanged in that chat.",
        "Clear the chat history on your device.",
        "Block the other person.",
        "Delete the chat."
      ]
    },
    {
      p: "For a group, the same header opens Group Info, where admins can also rename the group, change its photo, manage members, and restrict posting to admins."
    },
    {
      h2: "Account-wide messaging settings"
    },
    {
      p: "Options that apply to all your chats live in Settings. The main ones are under Privacy:"
    },
    {
      list: [
        "Receive messages: who is allowed to start a conversation with you (Everyone, or only people you follow or who follow you).",
        "Message requests: whether people with no connection can send you a request at all.",
        "Read receipts: whether you send and see the blue read ticks. Turning this off is mutual.",
        "Blocked users: review and unblock people you have blocked."
      ]
    },
    {
      note: "Changing the wallpaper in a one-to-one chat changes it just for that chat. In a group, only the group creator can change the group's background."
    },
    {
      faq: [
        [
          "Where do I turn off read receipts?",
          "Settings, then Privacy. Turning off read receipts is mutual: you stop sending them and stop seeing other people's."
        ],
        [
          "Will a nickname I set be visible to the other person?",
          "No. Nicknames are private to you. They only change how that person's name shows up for you."
        ]
      ]
    },
    {
      cta: [
        {
          to: "/platform/help/how-do-i-leave-or-delete-a-conversation",
          label: "Leave or delete a conversation"
        },
        {
          to: "/platform/help/are-my-messages-and-calls-private",
          label: "Are my messages private?"
        }
      ]
    }
  ]
};
