// Help center article: How do message requests work?
// Block model: { p } | { h2 } | { list:[] } | { steps:[] } | { faq:[[q,a]] } | { note } | { cta:[{to,label}] }

export default {
  summary: "If someone you do not have a connection with messages you, it arrives as a message request instead of landing straight in your inbox. You can accept it to start chatting or ignore it to remove it. By default, people you follow or who follow you skip requests and reach you directly. You control all of this in Privacy settings.",
  updated: "2026-06-18",
  body: [
    {
      p: "Message requests are the buffer between you and people you have no connection with. They stop strangers from dropping straight into your main inbox, while still letting genuine messages through once you say yes."
    },
    {
      h2: "What happens when a request comes in"
    },
    {
      p: "A pending request shows up in your Requests list, separate from your normal conversations. You see who it is from. Nothing is added to your inbox until you decide."
    },
    {
      steps: [
        "Open Messages and go to Requests.",
        "Review who wants to connect.",
        "Tap Accept to move it into your inbox and start chatting, or Ignore to remove the request."
      ]
    },
    {
      h2: "Who reaches you directly"
    },
    {
      p: "By default, people you follow or who follow you skip the request step and message you directly, because there is already a connection. People with no connection go through requests first. You can tighten or loosen this."
    },
    {
      h2: "Control who can message you"
    },
    {
      list: [
        "Receive messages: choose Everyone, or limit it to people you follow or who follow you. If someone outside your allowed group tries to start a chat, they are turned away.",
        "Message requests: keep this on to let people with no connection send a request, or turn it off so only your existing connections can start a conversation.",
        "Both live in Settings, then Privacy."
      ]
    },
    {
      note: "Ignoring a request just removes it, it does not tell the other person. If someone is bothering you, block them so they cannot message or call you at all."
    },
    {
      faq: [
        [
          "Does accepting a request follow them back?",
          "No. Accepting only lets the conversation into your inbox. Following is separate."
        ],
        [
          "Can I stop requests entirely?",
          "Yes. Turn off message requests in Privacy, and only people you follow or who follow you (depending on your Receive messages setting) will be able to start a chat."
        ]
      ]
    },
    {
      cta: [
        {
          to: "/platform/help/how-do-i-send-a-direct-message",
          label: "Send a direct message"
        },
        {
          to: "/platform/help/are-my-messages-and-calls-private",
          label: "Are my messages private?"
        }
      ]
    }
  ]
};
